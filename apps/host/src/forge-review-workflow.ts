import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  ForgeReviewActivityItem,
  ForgeReviewMutationOperation,
  ForgeReviewMutationRequest,
  ForgeReviewMutationResult,
  ForgeReviewMutationReceipt,
  ForgeReviewMutationKind,
  ForgeReviewPermissions,
  ForgeReviewReviewThread,
  ForgeReviewWorkflowCapabilities,
  ForgeReviewWorkflowRequest,
  ForgeReviewWorkflowResult,
} from "../../../packages/protocol/src/forge-review-workflow.ts";
import type {
  ForgeReviewActor,
  ForgeReviewComment,
  ForgeReviewDetail,
  ForgeReviewProvider,
  ForgeReviewRepository,
} from "../../../packages/protocol/src/index.ts";
import type { DurableStore } from "./store.ts";
import {
  ForgeReviewError,
  patchHeaderPaths,
  patchPath,
  type ForgeCommandRequest,
  type ForgeCommandResult,
  type ForgeReviewService,
} from "./forge-review.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_PAGE_SIZE = 100;
const MAX_BODY_CHARS = 1_000_000;
const MAX_INLINE_COMMENTS = 100;
const MAX_LOGIN_CHARS = 256;
const MAX_STDIN_BYTES = 4 * 1024 * 1024;
const RECEIPT_DIR = "forge-review-receipts";

export interface ForgeReviewWorkflowOptions {
  readonly store: DurableStore;
  readonly review: ForgeReviewService;
  readonly runner?: (request: ForgeCommandRequest) => Promise<ForgeCommandResult>;
  readonly githubExecutable?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly now?: () => Date;
}

export interface ForgeReviewWorkflowService {
  workflow(request: ForgeReviewWorkflowRequest): Promise<ForgeReviewWorkflowResult>;
  mutate(request: ForgeReviewMutationRequest): Promise<ForgeReviewMutationResult>;
}

type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, max = 4_096): string | undefined {
  return typeof value === "string" && value.length <= max ? value : undefined;
}

function requiredText(value: unknown, name: string, max = 4_096): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new ForgeReviewError("invalid_request", `${name} is required`, 400);
  return value;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function bool(value: unknown): boolean {
  return value === true;
}

function actor(value: unknown): ForgeReviewActor | undefined {
  const row = object(value);
  const login = text(row.login) ?? text(row.name) ?? text(row.username);
  if (!login) return undefined;
  return {
    login,
    ...(text(row.name) === undefined ? {} : { name: text(row.name) }),
    ...(text(row.avatar_url) === undefined && text(row.avatarUrl) === undefined ? {} : { avatarUrl: text(row.avatar_url) ?? text(row.avatarUrl) }),
  };
}

function reviewComment(value: unknown): ForgeReviewComment | undefined {
  const row = object(value);
  const id = text(row.id) ?? text(row.node_id);
  const body = text(row.body, MAX_BODY_CHARS);
  if (!id || body === undefined) return undefined;
  const line = numberValue(row.line) ?? numberValue(row.original_line);
  const rawSide = text(row.side) ?? text(row.original_side);
  const side = rawSide === "LEFT" || rawSide === "RIGHT" ? rawSide.toLowerCase() as "left" | "right" : undefined;
  return {
    id,
    body,
    ...(actor(row.user) === undefined ? {} : { author: actor(row.user) }),
    ...(text(row.html_url) === undefined ? {} : { url: text(row.html_url) }),
    ...(text(row.created_at) === undefined ? {} : { createdAt: text(row.created_at) }),
    ...(text(row.updated_at) === undefined ? {} : { updatedAt: text(row.updated_at) }),
    ...(text(row.path) === undefined ? {} : { path: text(row.path) }),
    ...(line === undefined ? {} : { line }),
    ...(side === undefined ? {} : { side }),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(row).sort().map(key => [key, canonical(row[key])]));
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function parseJson(value: string): unknown {
  try { return value.trim() ? JSON.parse(value) : {}; }
  catch { throw new ForgeReviewError("provider_failed", "GitHub returned invalid workflow data", 502); }
}

function boundedResult(value: unknown): Record<string, unknown> {
  const row = object(value);
  const result: Record<string, unknown> = { ok: true };
  for (const key of ["id", "node_id", "url", "html_url", "state", "draft", "merged", "mergeable", "sha", "commit_id", "message", "isDraft", "isResolved"]) {
    const candidate = row[key];
    if (typeof candidate === "string" || typeof candidate === "boolean" || typeof candidate === "number") result[key] = candidate;
  }
  return result;
}

function pageNumber(cursor: string | undefined): number {
  if (cursor === undefined) return 1;
  if (!/^\d{1,6}$/.test(cursor)) throw new ForgeReviewError("invalid_request", "Invalid workflow pagination cursor", 400);
  const page = Number(cursor);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) throw new ForgeReviewError("invalid_request", "Invalid workflow pagination cursor", 400);
  return page;
}

function pageSize(limit: number | undefined): number {
  const result = limit ?? 50;
  if (!Number.isSafeInteger(result) || result < 1 || result > MAX_PAGE_SIZE) throw new ForgeReviewError("invalid_request", `limit must be between 1 and ${MAX_PAGE_SIZE}`, 400);
  return result;
}

function githubRepo(repository: ForgeReviewRepository): string {
  if (repository.provider !== "github") throw new ForgeReviewError("unsupported_mutation", "GitHub workflow writes are unavailable for this provider", 409);
  return repository.path;
}

function endpoint(repository: ForgeReviewRepository, number: number, suffix: string): string {
  return `repos/${githubRepo(repository)}/pulls/${number}${suffix}`;
}

function issueEndpoint(repository: ForgeReviewRepository, number: number, suffix: string): string {
  return `repos/${githubRepo(repository)}/issues/${number}${suffix}`;
}

function timelineItem(value: unknown): ForgeReviewActivityItem | undefined {
  const row = object(value);
  const id = text(row.id) ?? text(row.node_id);
  if (!id) return undefined;
  const event = text(row.event);
  const kind: ForgeReviewActivityItem["kind"] = event === "commented" || event === "issue_comment" ? "comment" : event === "reviewed" || event === "pull_request_review" ? "review" : event === "committed" ? "commit" : "timeline";
  const body = text(row.body, MAX_BODY_CHARS) ?? text(object(row.source).body, MAX_BODY_CHARS) ?? (kind === "commit" ? text(row.message, MAX_BODY_CHARS) : undefined);
  const activityActor = actor(row.actor ?? row.user ?? (kind === "commit" ? row.author : undefined));
  const createdAt = text(row.created_at) ?? (kind === "commit" ? text(object(row.committer).date) ?? text(object(row.author).date) : undefined);
  const commitSha = text(row.sha, 256) ?? text(row.commit_id, 256) ?? text(object(row.commit).sha, 256) ?? text(object(row.commit).oid, 256);
  return {
    id,
    kind,
    ...(event === undefined ? {} : { event }),
    ...(body === undefined ? {} : { body }),
    ...(activityActor === undefined ? {} : { actor: activityActor }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(text(row.html_url) === undefined ? {} : { url: text(row.html_url) }),
    ...(commitSha === undefined ? {} : { commitSha }),
  };
}

function graphqlThreadRows(value: unknown): { items: ForgeReviewReviewThread[]; nextCursor?: string } {
  const data = object(object(value).data);
  const pull = object(object(data.repository).pullRequest);
  const connection = object(pull.reviewThreads);
  const items: ForgeReviewReviewThread[] = [];
  for (const value of array(connection.nodes)) {
    const row = object(value);
    const commentsConnection = object(row.comments);
    const comments = array(commentsConnection.nodes).map(comment => {
      const raw = object(comment);
      return reviewComment({
        ...raw,
        id: raw.fullDatabaseId === undefined ? raw.id : String(raw.fullDatabaseId),
        node_id: raw.id,
        user: raw.author,
        html_url: raw.url,
        created_at: raw.createdAt,
        updated_at: raw.updatedAt,
        commit_id: object(raw.commit).oid,
        original_line: raw.originalLine,
        side: raw.side ?? row.diffSide,
        path: raw.path ?? row.path,
        line: raw.line ?? row.line,
      });
    }).filter((comment): comment is ForgeReviewComment => comment !== undefined);
    const first = comments[0];
    const threadPath = text(row.path) ?? text(first?.path);
    const threadLine = numberValue(row.line) ?? numberValue(first?.line);
    const rawThreadSide = text(row.diffSide) ?? first?.side;
    const threadSide = rawThreadSide?.toLowerCase();
    const firstRaw = array(commentsConnection.nodes)[0];
    const threadCommit = text(row.commitSha) ?? text(object(object(firstRaw).commit).oid);
    const thread: ForgeReviewReviewThread = {
      id: requiredText(row.id, "review thread id", 512),
      isResolved: bool(row.isResolved),
      ...(row.isOutdated === undefined ? {} : { isOutdated: bool(row.isOutdated) }),
      ...(row.viewerCanReply === undefined ? {} : { viewerCanReply: bool(row.viewerCanReply) }),
      ...(row.viewerCanResolve === undefined ? {} : { viewerCanResolve: bool(row.viewerCanResolve) }),
      ...(row.viewerCanUnresolve === undefined ? {} : { viewerCanUnresolve: bool(row.viewerCanUnresolve) }),
      comments,
      commentsTruncated: bool(object(commentsConnection.pageInfo).hasNextPage),
      ...(threadPath === undefined ? {} : { path: threadPath }),
      ...(threadLine === undefined ? {} : { line: threadLine }),
      ...(threadSide === "left" || threadSide === "right" ? { side: threadSide } : {}),
      ...(threadCommit === undefined ? {} : { commitSha: threadCommit }),
      ...(object(commentsConnection.pageInfo).endCursor === undefined ? {} : { commentsNextCursor: text(object(commentsConnection.pageInfo).endCursor) }),
    };
    items.push(thread);
  }
  const pageInfo = object(connection.pageInfo);
  return { items, ...(bool(pageInfo.hasNextPage) && text(pageInfo.endCursor) ? { nextCursor: text(pageInfo.endCursor) } : {}) };
}

function mutationBody(operation: ForgeReviewMutationOperation): string | undefined {
  if (operation.kind === "issue_comment" || operation.kind === "reply") return operation.body;
  if (operation.kind === "review") return operation.body;
  if (operation.kind === "edit") return operation.body;
  if (operation.kind === "merge") return operation.body;
  return undefined;
}

function validateOperation(operation: ForgeReviewMutationOperation): void {
  if (!operation || typeof operation !== "object" || typeof operation.kind !== "string") throw new ForgeReviewError("invalid_request", "A workflow mutation operation is required", 400);
  if (!["issue_comment", "review", "reply", "resolve_thread", "edit", "reviewers", "draft", "state", "merge"].includes(operation.kind)) throw new ForgeReviewError("invalid_request", "Unsupported workflow mutation", 400);
  if ((operation.kind === "issue_comment" || operation.kind === "reply") && typeof operation.body !== "string") throw new ForgeReviewError("invalid_request", "Comment body is required", 400);
  if (operation.kind === "review" && typeof operation.event !== "string") throw new ForgeReviewError("invalid_request", "Review event is required", 400);
  if (operation.kind === "review" && operation.body !== undefined && typeof operation.body !== "string") throw new ForgeReviewError("invalid_request", "Review body must be a string", 400);
  if (operation.kind === "reply" && typeof operation.commentId !== "string") throw new ForgeReviewError("invalid_request", "commentId is required", 400);
  if (operation.kind === "resolve_thread" && (typeof operation.threadId !== "string" || typeof operation.resolved !== "boolean")) throw new ForgeReviewError("invalid_request", "threadId and resolved are required", 400);
  if (operation.kind === "edit" && (operation.title !== undefined && typeof operation.title !== "string" || operation.body !== undefined && typeof operation.body !== "string")) throw new ForgeReviewError("invalid_request", "Pull request title or body is invalid", 400);
  if (operation.kind === "reviewers" && [operation.users, operation.teams, operation.removeUsers, operation.removeTeams].some(value => value !== undefined && (!Array.isArray(value) || value.some(item => typeof item !== "string")))) throw new ForgeReviewError("invalid_request", "Reviewer lists must be strings", 400);
  if (operation.kind === "draft" && typeof operation.draft !== "boolean") throw new ForgeReviewError("invalid_request", "draft must be a boolean", 400);
  if (operation.kind === "state" && operation.state !== "open" && operation.state !== "closed") throw new ForgeReviewError("invalid_request", "state must be open or closed", 400);
  if (operation.kind === "merge" && typeof operation.method !== "string") throw new ForgeReviewError("invalid_request", "merge method is required", 400);
  if (mutationBody(operation) !== undefined && mutationBody(operation)!.length > MAX_BODY_CHARS) throw new ForgeReviewError("invalid_request", "Workflow text is too long", 400);
  if ((operation.kind === "issue_comment" || operation.kind === "reply") && operation.body.trim().length === 0) throw new ForgeReviewError("invalid_request", "Comment body is required", 400);
  if (operation.kind === "review") {
    if (operation.comments !== undefined && !Array.isArray(operation.comments)) throw new ForgeReviewError("invalid_request", "Inline review comments must be an array", 400);
    if (!["COMMENT", "APPROVE", "REQUEST_CHANGES"].includes(operation.event)) throw new ForgeReviewError("invalid_request", "Unsupported review event", 400);
    if ((operation.comments?.length ?? 0) > MAX_INLINE_COMMENTS) throw new ForgeReviewError("invalid_request", "Too many inline comments", 400);
    for (const comment of operation.comments ?? []) {
      if (!comment || typeof comment !== "object") throw new ForgeReviewError("invalid_request", "Invalid inline review anchor", 400);
      if (typeof comment.path !== "string" || !comment.path || comment.path.length > 4_096 || !Number.isSafeInteger(comment.line) || comment.line < 1 || comment.line > 10_000_000 || !["LEFT", "RIGHT"].includes(comment.side) || typeof comment.body !== "string" || !comment.body || comment.body.length > MAX_BODY_CHARS) throw new ForgeReviewError("invalid_request", "Invalid inline review anchor", 400);
      if (comment.startLine !== undefined && (!Number.isSafeInteger(comment.startLine) || comment.startLine < 1 || comment.startLine > comment.line || comment.startSide !== undefined && !["LEFT", "RIGHT"].includes(comment.startSide))) throw new ForgeReviewError("invalid_request", "Invalid inline review range", 400);
    }
  }
  if (operation.kind === "reply") {
    requiredText(operation.commentId, "commentId", 512);
    if (!/^\d+$/.test(operation.commentId) || !Number.isSafeInteger(Number(operation.commentId))) throw new ForgeReviewError("invalid_request", "GitHub reply commentId must be a numeric review comment id", 400);
  }
  if (operation.kind === "resolve_thread") requiredText(operation.threadId, "threadId", 512);
  if (operation.kind === "edit" && operation.title === undefined && operation.body === undefined) throw new ForgeReviewError("invalid_request", "Edit requires a title or body", 400);
  if (operation.kind === "edit" && (operation.title !== undefined && (operation.title.trim().length === 0 || operation.title.length > 1_000) || operation.body !== undefined && operation.body.length > MAX_BODY_CHARS)) throw new ForgeReviewError("invalid_request", "Pull request title or body is invalid", 400);
  if (operation.kind === "reviewers") {
    const all = [...operation.users ?? [], ...operation.teams ?? [], ...operation.removeUsers ?? [], ...operation.removeTeams ?? []];
    if (all.length > 100 || all.some(value => typeof value !== "string" || value.length === 0 || value.length > MAX_LOGIN_CHARS || !/^[A-Za-z0-9_.-]+$/.test(value))) throw new ForgeReviewError("invalid_request", "Invalid reviewer login", 400);
    if ((operation.users?.length ?? 0) + (operation.teams?.length ?? 0) > 0 && (operation.removeUsers?.length ?? 0) + (operation.removeTeams?.length ?? 0) > 0) throw new ForgeReviewError("invalid_request", "Add and remove reviewers in separate confirmed operations", 400);
  }
  if (operation.kind === "merge" && !["merge", "squash", "rebase"].includes(operation.method)) throw new ForgeReviewError("invalid_request", "Unsupported merge method", 400);
  if (operation.kind === "merge" && [operation.commitMessage, operation.subject, operation.body].some(value => value !== undefined && typeof value !== "string")) throw new ForgeReviewError("invalid_request", "Merge message fields must be strings", 400);
  if (operation.kind === "merge" && ((operation.commitMessage !== undefined && operation.commitMessage.length > MAX_BODY_CHARS) || (operation.subject !== undefined && operation.subject.length > 1_000))) throw new ForgeReviewError("invalid_request", "Merge message is too long", 400);
}

function patchLineAnchors(patch: string): Map<string, { left: Set<number>; right: Set<number> }> {
  const anchors = new Map<string, { left: Set<number>; right: Set<number> }>();
  let path: string | undefined;
  let oldLine = 0;
  let newLine = 0;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const paths = patchHeaderPaths(line);
      path = paths === undefined ? undefined : patchPath(paths[1], "b/") ?? patchPath(paths[0], "a/");
      if (path) anchors.set(path, { left: new Set(), right: new Set() });
      continue;
    }
    const hunk = /^@@ -(?<old>\d+)(?:,\d+)? \+(?<next>\d+)(?:,\d+)? @@/.exec(line);
    if (hunk?.groups) {
      oldLine = Number(hunk.groups.old);
      newLine = Number(hunk.groups.next);
      continue;
    }
    if (!path || !anchors.has(path) || line.startsWith("+++") || line.startsWith("---")) continue;
    const target = anchors.get(path)!;
    if (line.startsWith("+")) { target.right.add(newLine); newLine += 1; continue; }
    if (line.startsWith("-")) { target.left.add(oldLine); oldLine += 1; continue; }
    if (line.startsWith(" ")) { target.left.add(oldLine); target.right.add(newLine); oldLine += 1; newLine += 1; }
  }
  return anchors;
}

async function validateInlineAnchors(review: ForgeReviewService, projectId: string, detail: ForgeReviewDetail, operation: Extract<ForgeReviewMutationOperation, { kind: "review" }>, expectedHeadSha: string): Promise<void> {
  if (!operation.comments || operation.comments.length === 0) return;
  const diff = await review.diff({ projectId, url: detail.url, headSha: expectedHeadSha, baseSha: detail.snapshot.baseSha });
  if (diff.truncated) throw new ForgeReviewError("stale_anchor", "The diff is incomplete; reload before adding inline comments", 409);
  const anchors = patchLineAnchors(diff.patch);
  for (const comment of operation.comments) {
    const target = anchors.get(comment.path);
    const side = comment.side === "LEFT" ? target?.left : target?.right;
    const startSide = comment.startSide ?? comment.side;
    const start = startSide === "LEFT" ? target?.left : target?.right;
    if (!target || !side?.has(comment.line) || comment.startLine !== undefined && !start?.has(comment.startLine)) throw new ForgeReviewError("stale_anchor", `Inline comment line ${comment.path}:${comment.line} is not present in this revision`, 409);
  }
}

function permissionsFromRows(detail: ForgeReviewDetail, repositoryRow: unknown, viewerRow: unknown): ForgeReviewPermissions {
  const permissions = object(repositoryRow).permissions;
  const viewer = actor(viewerRow);
  const available = Object.keys(object(repositoryRow)).length > 0 && Object.keys(object(permissions)).length > 0 && viewer !== undefined;
  const canComment = available && (bool(object(permissions).pull) || bool(object(permissions).push) || bool(object(permissions).triage) || bool(object(permissions).maintain) || bool(object(permissions).admin));
  const sameAuthor = viewer !== undefined && detail.author?.login.toLowerCase() === viewer.login.toLowerCase();
  const canReview = canComment && !sameAuthor;
  const repositoryWrite = bool(object(permissions).push) || bool(object(permissions).maintain) || bool(object(permissions).admin);
  // GitHub lets the pull-request author edit/close their own request and
  // switch draft state even when repository permissions are read-only. Merge
  // remains repository-write gated below.
  const canEdit = available && (repositoryWrite || sameAuthor);
  const mergeMethods: ForgeReviewPermissions["mergeMethods"] = ["merge", "squash", "rebase"].filter(method => {
    const key = method === "merge" ? "allow_merge_commit" : method === "squash" ? "allow_squash_merge" : "allow_rebase_merge";
    return object(repositoryRow)[key] === undefined || bool(object(repositoryRow)[key]);
  }) as ForgeReviewPermissions["mergeMethods"];
  return {
    available,
    canComment,
    canReview,
    canEdit,
    canRequestReviewers: canEdit,
    canChangeState: canEdit,
    canMerge: available && repositoryWrite && detail.state === "open" && detail.merge?.state !== "conflicts",
    mergeMethods,
    ...(available ? {} : { reason: "GitHub did not return viewer/repository permissions" }),
  };
}

export function createForgeReviewWorkflow(options: ForgeReviewWorkflowOptions): ForgeReviewWorkflowService {
  const commandRunner = options.runner ?? (options.review as ForgeReviewService & { runner?: ForgeReviewWorkflowOptions["runner"] }).runner;
  if (!commandRunner) throw new Error("Forge review workflow needs the host command runner");
  const runCommand: NonNullable<ForgeReviewWorkflowOptions["runner"]> = commandRunner;
  const githubExecutable = options.githubExecutable ?? "gh";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES;
  const now = options.now ?? (() => new Date());
  const receiptDir = join(options.store.paths.stateDir, RECEIPT_DIR);
  mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
  const activeCommands = new Set<string>();

  async function ghApi(repository: ForgeReviewRepository, path: string, method = "GET", body?: unknown, isWrite = false): Promise<unknown> {
    if (repository.provider !== "github") throw new ForgeReviewError("unsupported_mutation", "The GitHub workflow is unavailable for this provider", 409);
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    if (serializedBody !== undefined && Buffer.byteLength(serializedBody, "utf8") > MAX_STDIN_BYTES) {
      throw new ForgeReviewError("invalid_request", "The workflow request body is too large", 400);
    }
    const request: ForgeCommandRequest = {
      command: githubExecutable,
      args: ["api", path, "--hostname", repository.hostname, "--method", method, ...(body === undefined ? [] : ["--input", "-"])],
      timeoutMs,
      maxOutputBytes,
      ...(serializedBody === undefined ? {} : { stdin: serializedBody }),
    };
    let result: ForgeCommandResult;
    try { result = await runCommand(request); }
    catch {
      if (isWrite) throw new ForgeReviewError("mutation_unknown", "The GitHub connection ended before the operation was confirmed", 503);
      throw new ForgeReviewError("provider_failed", "GitHub workflow data could not be read", 502);
    }
    if (result.timedOut || result.truncated || result.code === null) throw new ForgeReviewError(isWrite ? "mutation_unknown" : "provider_failed", "GitHub did not confirm the workflow operation", 503);
    if (result.code !== 0 && result.code !== null) {
      // A non-zero `gh` exit can still follow a provider-side write. Treat
      // network errors and every HTTP 5xx as ambiguous; only an explicit
      // provider rejection is safe to persist as failed and expose for retry.
      const transient = /network|connection|timed? ?out|timeout|eof|reset|broken pipe|temporar|gateway|\b5\d{2}\b/i.test(result.stderr);
      if (isWrite && transient) throw new ForgeReviewError("mutation_unknown", "GitHub did not confirm the workflow operation", 503);
      throw new ForgeReviewError("provider_failed", "GitHub rejected the workflow operation", 502);
    }
    let payload: unknown;
    try { payload = parseJson(result.stdout); }
    catch (error) {
      if (isWrite) throw new ForgeReviewError("mutation_unknown", "GitHub accepted a workflow request without a readable response", 503);
      throw error;
    }
    if (path === "graphql" && array(object(payload).errors).length > 0) throw new ForgeReviewError("provider_failed", "GitHub GraphQL rejected the workflow operation", 502);
    return payload;
  }

  async function workflow(request: ForgeReviewWorkflowRequest): Promise<ForgeReviewWorkflowResult> {
    if (request.section !== "overview" && request.section !== "activity" && request.section !== "threads") {
      throw new ForgeReviewError("invalid_request", "Workflow section must be overview, activity or threads", 400);
    }
    if (request.section !== "threads" && (request.threadId !== undefined || request.commentCursor !== undefined)) {
      throw new ForgeReviewError("invalid_request", "threadId and commentCursor are only valid for the threads section", 400);
    }
    if (request.commentCursor !== undefined && request.threadId === undefined) {
      throw new ForgeReviewError("invalid_request", "commentCursor requires threadId", 400);
    }
    const limit = pageSize(request.limit);
    const detail = await options.review.detail({ projectId: requiredText(request.projectId, "projectId"), url: requiredText(request.url, "url") });
    const section = request.section;
    const base: ForgeReviewWorkflowResult = {
      provider: detail.provider,
      repository: detail.repository,
      number: detail.number,
      ...(detail.snapshot.headSha === undefined ? {} : { headSha: detail.snapshot.headSha }),
      snapshotHash: detail.snapshot.hash,
      section,
    };
    if (section === "overview") {
      if (detail.provider !== "github") {
        const permissions: ForgeReviewPermissions = { available: false, canComment: false, canReview: false, canEdit: false, canRequestReviewers: false, canChangeState: false, canMerge: false, mergeMethods: [], reason: "GitHub permissions are unavailable for this provider" };
        const capabilities: ForgeReviewWorkflowCapabilities = { provider: detail.provider, reads: ["overview", "activity", "threads"], writes: [] };
        return { ...base, overview: { detail, permissions, capabilities } };
      }
      let repositoryRow: unknown = {};
      let viewerRow: unknown = {};
      try { repositoryRow = await ghApi(detail.repository, `repos/${detail.repository.path}`); } catch { /* availability stays explicit */ }
      try { viewerRow = await ghApi(detail.repository, "user"); } catch { /* availability stays explicit */ }
      const permissions = permissionsFromRows(detail, repositoryRow, viewerRow);
      const writes: readonly ForgeReviewMutationKind[] = ["issue_comment", "review", "reply", "resolve_thread", "edit", "reviewers", "draft", "state", "merge"];
      return { ...base, overview: { detail, permissions, capabilities: { provider: detail.provider, reads: ["overview", "activity", "threads"], writes } } };
    }
    if (detail.provider !== "github") throw new ForgeReviewError("unsupported_provider", "Paginated workflow activity and threads are currently available for GitHub only", 409);
    if (section === "threads") {
      const [owner, repo] = detail.repository.path.split("/");
      if (!owner || !repo || detail.repository.path.split("/").length !== 2) throw new ForgeReviewError("invalid_url", "GitHub repository path is invalid", 400);
      const query = `query($owner:String!,$repo:String!,$number:Int!,$after:String,$commentAfter:String,$first:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:$first,after:$after){nodes{id,isResolved,isOutdated,viewerCanReply,viewerCanResolve,viewerCanUnresolve,path,line,diffSide,comments(first:100,after:$commentAfter){nodes{id,fullDatabaseId,body,path,line,originalLine,url,createdAt,updatedAt,author{login,avatarUrl},commit{oid}},pageInfo{hasNextPage,endCursor}}},pageInfo{hasNextPage,endCursor}}}}}`;
      let cursor = request.cursor;
      for (let page = 0; page < 100; page += 1) {
        const payload = await ghApi(detail.repository, "graphql", "POST", { query, variables: { owner, repo, number: detail.number, after: cursor ?? null, commentAfter: request.commentCursor ?? null, first: request.threadId ? 100 : limit } });
        const threads = graphqlThreadRows(payload);
        const selected = request.threadId === undefined ? threads.items : threads.items.filter(thread => thread.id === request.threadId);
        if (request.threadId === undefined || selected.length > 0 || threads.nextCursor === undefined) {
          if (request.threadId !== undefined && selected.length === 0) throw new ForgeReviewError("stale_anchor", "The selected review thread is not part of this pull request", 409);
          return { ...base, threads: { items: selected, ...(request.threadId === undefined && threads.nextCursor !== undefined ? { nextCursor: threads.nextCursor } : {}), truncated: false } };
        }
        cursor = threads.nextCursor;
      }
      throw new ForgeReviewError("stale_anchor", "The selected review thread is not part of this pull request", 409);
    }
    const page = pageNumber(request.cursor);
    const rawPath = `${issueEndpoint(detail.repository, detail.number, "/timeline")}?per_page=${limit}&page=${page}`;
    const raw = array(await ghApi(detail.repository, rawPath));
    const items = raw.map(timelineItem).filter((item): item is ForgeReviewActivityItem => item !== undefined);
    return { ...base, activity: { items, ...(raw.length === limit ? { nextCursor: String(page + 1) } : {}), truncated: false } };
  }

  function receiptPath(commandId: string): string {
    return join(receiptDir, `${hash(commandId)}.json`);
  }

  function readReceipt(commandId: string): ForgeReviewMutationReceipt | undefined {
    const path = receiptPath(commandId);
    if (!existsSync(path)) return undefined;
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as ForgeReviewMutationReceipt;
      if (!value || value.commandId !== commandId || typeof value.requestHash !== "string") throw new Error("invalid receipt");
      if (value.state === "pending" && !activeCommands.has(commandId)) {
        const timestamp = now().toISOString();
        const recovered: ForgeReviewMutationReceipt = { ...value, state: "outcome_unknown", updatedAt: timestamp, error: { code: "mutation_unknown", message: "The host restarted while this GitHub operation was in flight; reconcile it before retrying" } };
        writeReceipt(recovered);
        return recovered;
      }
      return value;
    } catch {
      throw new ForgeReviewError("command_conflict", "The workflow command receipt is unreadable; create a new command id", 409);
    }
  }

  function writeReceipt(receipt: ForgeReviewMutationReceipt): void {
    const path = receiptPath(receipt.commandId);
    const temporary = `${path}.${hash(receipt.updatedAt)}.tmp`;
    writeFileSync(temporary, JSON.stringify(receipt), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
  }

  function claimReceipt(request: ForgeReviewMutationRequest, requestHash: string): ForgeReviewMutationResult | undefined {
    const existing = readReceipt(request.commandId);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new ForgeReviewError("command_conflict", "commandId was already used for a different workflow operation", 409);
      return { receipt: existing, ...(existing.result === undefined ? {} : { result: existing.result }) };
    }
    const timestamp = now().toISOString();
    const receipt: ForgeReviewMutationReceipt = { commandId: request.commandId, requestHash, state: "pending", createdAt: timestamp, updatedAt: timestamp };
    const path = receiptPath(request.commandId);
    try {
      const descriptor = openSync(path, "wx", 0o600);
      try { writeFileSync(descriptor, JSON.stringify(receipt), "utf8"); } finally { closeSync(descriptor); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const raced = readReceipt(request.commandId);
      if (!raced) throw new ForgeReviewError("command_conflict", "Could not claim workflow command receipt", 409);
      if (raced.requestHash !== requestHash) throw new ForgeReviewError("command_conflict", "commandId was already used for a different workflow operation", 409);
      return { receipt: raced, ...(raced.result === undefined ? {} : { result: raced.result }) };
    }
    activeCommands.add(request.commandId);
    return undefined;
  }

  function permissionFor(operation: ForgeReviewMutationOperation, permissions: ForgeReviewPermissions): boolean {
    if (!permissions.available) return false;
    if (operation.kind === "issue_comment" || operation.kind === "reply") return permissions.canComment;
    if (operation.kind === "review") return operation.event === "COMMENT" ? permissions.canComment : permissions.canReview;
    if (operation.kind === "resolve_thread") return permissions.canComment;
    if (operation.kind === "edit") return permissions.canEdit;
    if (operation.kind === "reviewers") return permissions.canRequestReviewers;
    if (operation.kind === "draft" || operation.kind === "state") return permissions.canChangeState;
    if (operation.kind === "merge") return permissions.canMerge && permissions.mergeMethods.includes(operation.method);
    return permissions.canReview;
  }

  async function targetThread(detail: ForgeReviewDetail, threadId: string): Promise<ForgeReviewReviewThread> {
    if (detail.repository.provider !== "github") throw new ForgeReviewError("unsupported_mutation", "Review thread mutations are available for GitHub only", 409);
    const [owner, repo] = detail.repository.path.split("/");
    const query = `query($owner:String!,$repo:String!,$number:Int!,$after:String,$commentAfter:String,$first:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:$first,after:$after){nodes{id,isResolved,isOutdated,viewerCanReply,viewerCanResolve,viewerCanUnresolve,path,line,diffSide,comments(first:100,after:$commentAfter){nodes{id,fullDatabaseId,body,path,line,originalLine,url,createdAt,updatedAt,author{login,avatarUrl},commit{oid}},pageInfo{hasNextPage,endCursor}}},pageInfo{hasNextPage,endCursor}}}}}`;
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const payload = await ghApi(detail.repository, "graphql", "POST", { query, variables: { owner, repo, number: detail.number, first: MAX_PAGE_SIZE, after: cursor ?? null, commentAfter: null } });
      const parsed = graphqlThreadRows(payload);
      const thread = parsed.items.find(item => item.id === threadId || item.comments.some(comment => comment.id === threadId));
      if (thread) return thread;
      if (parsed.nextCursor === undefined) break;
      cursor = parsed.nextCursor;
    }
    throw new ForgeReviewError("stale_anchor", "The selected review thread is not part of this pull request", 409);
  }

  async function dispatch(projectId: string, detail: ForgeReviewDetail, operation: ForgeReviewMutationOperation, expectedHeadSha: string): Promise<Record<string, unknown>> {
    const repository = detail.repository;
    if (repository.provider !== "github") throw new ForgeReviewError("unsupported_mutation", "GitHub workflow writes are unavailable for GitLab merge requests", 409);
    const number = detail.number;
    const api = (path: string, method = "GET", body?: unknown): Promise<unknown> => ghApi(repository, path, method, body, true);
    switch (operation.kind) {
      case "issue_comment":
        return boundedResult(await api(issueEndpoint(repository, number, "/comments"), "POST", { body: operation.body }));
      case "review": {
        await validateInlineAnchors(options.review, projectId, detail, operation, expectedHeadSha);
        const comments = operation.comments?.map(comment => ({ path: comment.path, line: comment.line, side: comment.side, body: comment.body, ...(comment.startLine === undefined ? {} : { start_line: comment.startLine }), ...(comment.startSide === undefined ? {} : { start_side: comment.startSide }) }));
        return boundedResult(await api(endpoint(repository, number, "/reviews"), "POST", { commit_id: expectedHeadSha, event: operation.event, ...(operation.body === undefined ? {} : { body: operation.body }), ...(comments === undefined || comments.length === 0 ? {} : { comments }) }));
      }
      case "reply":
        const replyThread = await targetThread(detail, operation.commentId);
        if (replyThread.viewerCanReply === false) throw new ForgeReviewError("permission_denied", "GitHub did not grant permission to reply to this thread", 403);
        return boundedResult(await api(endpoint(repository, number, "/comments"), "POST", { body: operation.body, in_reply_to: Number(operation.commentId) }));
      case "resolve_thread": {
        const resolveThread = await targetThread(detail, operation.threadId);
        if ((operation.resolved ? resolveThread.viewerCanResolve : resolveThread.viewerCanUnresolve) === false) throw new ForgeReviewError("permission_denied", "GitHub did not grant permission to change this thread", 403);
        const query = operation.resolved
          ? "mutation($input:ResolveReviewThreadInput!){resolveReviewThread(input:$input){thread{id,isResolved}}}"
          : "mutation($input:UnresolveReviewThreadInput!){unresolveReviewThread(input:$input){thread{id,isResolved}}}";
        return boundedResult(await api("graphql", "POST", { query, variables: { input: { threadId: operation.threadId } } }));
      }
      case "edit":
        return boundedResult(await api(endpoint(repository, number, ""), "PATCH", { ...(operation.title === undefined ? {} : { title: operation.title }), ...(operation.body === undefined ? {} : { body: operation.body }) }));
      case "reviewers": {
        const addUsers = [...operation.users ?? []]; const addTeams = [...operation.teams ?? []];
        const removeUsers = [...operation.removeUsers ?? []]; const removeTeams = [...operation.removeTeams ?? []];
        if (addUsers.length || addTeams.length) await api(endpoint(repository, number, "/requested_reviewers"), "POST", { ...(addUsers.length ? { reviewers: addUsers } : {}), ...(addTeams.length ? { team_reviewers: addTeams } : {}) });
        if (removeUsers.length || removeTeams.length) await api(endpoint(repository, number, "/requested_reviewers"), "DELETE", { ...(removeUsers.length ? { reviewers: removeUsers } : {}), ...(removeTeams.length ? { team_reviewers: removeTeams } : {}) });
        return { ok: true };
      }
      case "draft": {
        const pull = object(await api(endpoint(repository, number, "")));
        const nodeId = requiredText(pull.node_id, "GitHub pull request node id", 512);
        const query = operation.draft
          ? "mutation($input:ConvertPullRequestToDraftInput!){convertPullRequestToDraft(input:$input){pullRequest{isDraft}}}"
          : "mutation($input:MarkPullRequestReadyForReviewInput!){markPullRequestReadyForReview(input:$input){pullRequest{isDraft}}}";
        return boundedResult(await api("graphql", "POST", { query, variables: { input: { pullRequestId: nodeId } } }));
      }
      case "state":
        return boundedResult(await api(endpoint(repository, number, ""), "PATCH", { state: operation.state }));
      case "merge":
        return boundedResult(await api(endpoint(repository, number, "/merge"), "PUT", { sha: expectedHeadSha, merge_method: operation.method, ...(operation.commitMessage === undefined ? {} : { commit_message: operation.commitMessage }), ...(operation.subject === undefined ? {} : { commit_title: operation.subject }) }));
    }
  }

  async function mutate(request: ForgeReviewMutationRequest): Promise<ForgeReviewMutationResult> {
    const projectId = requiredText(request.projectId, "projectId");
    const url = requiredText(request.url, "url");
    const commandId = requiredText(request.commandId, "commandId", 256);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(commandId)) throw new ForgeReviewError("invalid_request", "commandId contains unsupported characters", 400);
    const expectedHeadSha = requiredText(request.expectedHeadSha, "expectedHeadSha", 256);
    validateOperation(request.operation);
    const requestHash = hash({ projectId, url, expectedHeadSha, operation: request.operation });
    const claimed = claimReceipt(request, requestHash);
    if (claimed) return claimed;
    const pending = readReceipt(commandId);
    if (!pending || pending.state !== "pending") throw new ForgeReviewError("command_conflict", "The workflow command could not be claimed", 409);
    const createdAt = pending.createdAt;
    let detail: ForgeReviewDetail;
    try {
      detail = await options.review.detail({ projectId, url });
      if (detail.provider !== "github") throw new ForgeReviewError("unsupported_mutation", "GitHub workflow writes are unavailable for GitLab merge requests", 409);
      if (detail.snapshot.headSha === undefined || detail.snapshot.headSha !== expectedHeadSha) throw new ForgeReviewError("stale_snapshot", "The pull request moved; reload it before publishing this operation", 409);
      const overview = await workflow({ projectId, url, section: "overview" });
      if (overview.overview && overview.overview.detail.snapshot.headSha !== expectedHeadSha) throw new ForgeReviewError("stale_snapshot", "The pull request moved while preparing this operation", 409);
      if (overview.overview && !permissionFor(request.operation, overview.overview.permissions)) throw new ForgeReviewError("permission_denied", "GitHub did not grant permission for this operation", 403);
      const result = await dispatch(projectId, detail, request.operation, expectedHeadSha);
      const timestamp = now().toISOString();
      const receipt: ForgeReviewMutationReceipt = { commandId, requestHash, state: "confirmed", createdAt, updatedAt: timestamp, result };
      writeReceipt(receipt);
      return { receipt, result };
    } catch (error) {
      if (error instanceof ForgeReviewError && error.code === "mutation_unknown") {
        const timestamp = now().toISOString();
        const receipt: ForgeReviewMutationReceipt = { commandId, requestHash, state: "outcome_unknown", createdAt, updatedAt: timestamp, error: { code: error.code, message: error.message } };
        writeReceipt(receipt);
        return { receipt };
      }
      const mapped = error instanceof ForgeReviewError ? error : new ForgeReviewError("provider_failed", "GitHub workflow operation failed", 502);
      const timestamp = now().toISOString();
      const receipt: ForgeReviewMutationReceipt = { commandId, requestHash, state: "failed", createdAt, updatedAt: timestamp, error: { code: mapped.code, message: mapped.message } };
      writeReceipt(receipt);
      throw mapped;
    } finally {
      activeCommands.delete(commandId);
    }
  }

  return { workflow, mutate };
}
