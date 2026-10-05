import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import type {
  DurableStore,
} from "./store.ts";
import type {
  ForgeReviewActor,
  ForgeReviewCapabilities,
  ForgeReviewCheck,
  ForgeReviewCheckStatus,
  ForgeReviewComment,
  ForgeReviewCommit,
  ForgeReviewDiffRequest,
  ForgeReviewDiffResult,
  ForgeReviewDetail,
  ForgeReviewFile,
  ForgeReviewListRequest,
  ForgeReviewListBucket,
  ForgeReviewMutationKind,
  ForgeReviewListResult,
  ForgeReviewListState,
  ForgeReviewOperation,
  ForgeReviewProvider,
  ForgeReviewProviderCapability,
  ForgeReviewRef,
  ForgeReviewRepository,
  ForgeReviewReview,
  ForgeReviewReviewState,
  ForgeReviewSnapshot,
  ForgeReviewState,
  ForgeReviewSummary,
  ForgeReviewRequest,
} from "../../../packages/protocol/src/index.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_AUTH_TIMEOUT_MS = 5_000;
const DEFAULT_OUTPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_PATCH_BYTES = 6 * 1024 * 1024;
const MAX_REVIEW_LIMIT = 100;
const MAX_LIST_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_DETAIL_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_COMMENT_COUNT = 1_000;
const MAX_COMMIT_COUNT = 1_000;
const MAX_FILE_COUNT = 1_000;

export type ForgeReviewErrorCode =
  | "forge_review_unavailable"
  | "project_not_found"
  | "project_not_git"
  | "remote_unavailable"
  | "unsupported_provider"
  | "unsupported_host"
  | "invalid_url"
  | "repository_mismatch"
  | "unauthenticated"
  | "provider_unavailable"
  | "invalid_request"
  | "stale_snapshot"
  | "stale_anchor"
  | "command_conflict"
  | "mutation_unknown"
  | "unsupported_mutation"
  | "permission_denied"
  | "provider_failed"
  | "output_truncated";

export class ForgeReviewError extends Error {
  readonly code: ForgeReviewErrorCode;
  readonly status: number;

  constructor(code: ForgeReviewErrorCode, message: string, status = 400) {
    super(message);
    this.name = "ForgeReviewError";
    this.code = code;
    this.status = status;
  }
}

export interface ForgeCommandRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  /** Optional JSON body for provider API requests. The runner remains shell-free. */
  readonly stdin?: string;
}

export interface ForgeCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | string | null;
  readonly timedOut: boolean;
  readonly truncated: boolean;
}

export type ForgeCommandRunner = (request: ForgeCommandRequest) => Promise<ForgeCommandResult>;

export interface ForgeReviewOptions {
  readonly store: DurableStore;
  readonly runner?: ForgeCommandRunner;
  readonly githubExecutable?: string;
  readonly gitlabExecutable?: string;
  readonly gitExecutable?: string;
  readonly timeoutMs?: number;
  readonly authTimeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxPatchBytes?: number;
  /** Explicitly configured GitHub Enterprise hosts. github.com is always included. */
  readonly githubHosts?: readonly string[];
  /** Explicitly configured self-hosted GitLab hosts. gitlab.com is always included. */
  readonly gitlabHosts?: readonly string[];
  readonly now?: () => Date;
}

export interface ForgeReviewService {
  capabilities(): Promise<ForgeReviewCapabilities>;
  list(request: ForgeReviewListRequest): Promise<ForgeReviewListResult>;
  detail(request: ForgeReviewRequest): Promise<ForgeReviewDetail>;
  diff(request: ForgeReviewDiffRequest): Promise<ForgeReviewDiffResult>;
}

interface ParsedRepository {
  readonly provider: ForgeReviewProvider;
  readonly hostname: string;
  readonly path: string;
  readonly url: string;
}

interface ParsedReviewUrl extends ParsedRepository {
  readonly number?: number;
}

interface ResolvedProject {
  readonly id: string;
  readonly path: string;
  readonly repository: ParsedRepository;
}

interface NormalizedResult {
  readonly text: string;
  readonly truncated: boolean;
}

const GITHUB_LIST_FIELDS = [
  "number", "title", "url", "state", "isDraft", "author", "createdAt", "updatedAt",
  "headRefName", "headRefOid", "baseRefName", "baseRefOid", "mergedAt", "reviewRequests", "mergeStateStatus", "mergeable",
].join(",");
const GITHUB_DETAIL_FIELDS = [
  "number", "title", "url", "state", "isDraft", "author", "createdAt", "updatedAt", "body",
  "headRefName", "headRefOid", "baseRefName", "baseRefOid", "mergedAt", "reviewRequests", "comments", "reviews", "commits",
  "statusCheckRollup", "mergeStateStatus", "mergeable", "changedFiles", "files", "additions", "deletions",
].join(",");

export function defaultForgeCommandRunner(request: ForgeCommandRequest): Promise<ForgeCommandResult> {
  // Finder-launched packaged apps often receive a reduced PATH. Keep the normal command first,
  // then try fixed system locations on ENOENT only; this stays shell-free and never searches a
  // user-controlled directory. An explicit path is attempted exactly once.
  const candidates = request.command.includes("/")
    ? [request.command]
    : [request.command, `/opt/homebrew/bin/${request.command}`, `/usr/local/bin/${request.command}`, `/usr/bin/${request.command}`, `/bin/${request.command}`];
  const execute = (candidateIndex: number): Promise<ForgeCommandResult> => new Promise(resolve => {
    const command = candidates[candidateIndex] ?? request.command;
    const child = execFile(command, [...request.args], {
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      timeout: request.timeoutMs,
      maxBuffer: request.maxOutputBytes,
      encoding: "utf8",
      windowsHide: true,
      // Never invoke a shell. A provider URL or repository path is always a data argument.
      shell: false,
      env: { ...process.env, GH_PAGER: "cat", PAGER: "cat", GIT_PAGER: "cat" },
    }, (error, stdout, stderr) => {
      const failure = error as (NodeJS.ErrnoException & { killed?: boolean; signal?: string; code?: string | number }) | null;
      if (failure?.code === "ENOENT" && candidateIndex + 1 < candidates.length) {
        void execute(candidateIndex + 1).then(resolve);
        return;
      }
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        code: failure?.code ?? (failure === null ? 0 : null),
        timedOut: failure?.killed === true || failure?.signal === "SIGTERM",
        truncated: failure?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      });
    });
    if (request.stdin !== undefined && child.stdin) {
      // A provider can reject an input body before consuming it (for example an
      // invalid auth/argument response). Node reports that as an `error` event
      // on stdin; attach the handler before writing so EPIPE never becomes an
      // unhandled process error. The exec callback still owns the result
      // classification (writes are marked unknown when the provider did not
      // confirm an outcome).
      child.stdin.once("error", () => undefined);
      child.stdin.end(request.stdin);
    }
  });
  return execute(0);
}

function text(value: unknown, field: string, maxLength = 32_768): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
}

function optionalText(value: unknown, maxLength = 32_768): string | undefined {
  return text(value, "value", maxLength);
}

function multilineText(value: unknown, maxLength = 2 * 1024 * 1024): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return undefined;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return undefined;
  return value;
}

function optionalMultilineText(value: unknown, maxLength = 2 * 1024 * 1024): string | undefined {
  return multilineText(value, maxLength);
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseJson(textValue: string, provider: ForgeReviewProvider): unknown {
  try { return JSON.parse(textValue); }
  catch { throw new ForgeReviewError("provider_failed", `${provider} returned invalid review data`, 502); }
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function normalizeRepoPath(value: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(value); }
  catch { throw new ForgeReviewError("invalid_url", "Repository URL contains invalid escaping", 400); }
  const cleaned = decoded.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  const segments = cleaned.split("/");
  if (segments.length < 2 || segments.some(segment => !segment || segment === "." || segment === ".." || /[\u0000-\u001f\u007f]/.test(segment))) {
    throw new ForgeReviewError("invalid_url", "Repository URL must name a repository path", 400);
  }
  return segments.join("/");
}

function repositoryUrl(hostname: string, path: string): string {
  return `https://${hostname}/${path}`;
}

function parseRemote(value: string, providerForHost: (hostname: string) => ForgeReviewProvider | undefined): ParsedRepository {
  const raw = value.trim();
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?![/\\])(.+)$/.exec(raw);
  if (scp?.[1] && scp[2]) {
    const hostname = normalizeHost(scp[1]);
    const provider = providerForHost(hostname);
    if (!provider) throw new ForgeReviewError("unsupported_host", `Forge host ${hostname} is not configured`, 400);
    const path = normalizeRepoPath(scp[2]);
    return { provider, hostname, path, url: repositoryUrl(hostname, path) };
  }
  let parsed: URL;
  try { parsed = new URL(raw); }
  catch { throw new ForgeReviewError("remote_unavailable", "Project origin is not a supported Forge URL", 409); }
  if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ForgeReviewError("remote_unavailable", "Project origin is not a supported Forge URL", 409);
  }
  const hostname = normalizeHost(parsed.hostname);
  const provider = providerForHost(hostname);
  if (!provider) throw new ForgeReviewError("unsupported_host", `Forge host ${hostname} is not configured`, 400);
  const path = normalizeRepoPath(parsed.pathname);
  return { provider, hostname, path, url: repositoryUrl(hostname, path) };
}

function parseReviewUrl(value: string, providerForHost: (hostname: string) => ForgeReviewProvider | undefined, allowRepository = true): ParsedReviewUrl {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096) throw new ForgeReviewError("invalid_url", "A Forge URL is required", 400);
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new ForgeReviewError("invalid_url", "Forge URL is invalid", 400); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ForgeReviewError("invalid_url", "Forge URL must be an HTTPS URL without credentials or query state", 400);
  }
  const hostname = normalizeHost(parsed.hostname);
  const provider = providerForHost(hostname);
  if (!provider) throw new ForgeReviewError("unsupported_host", `Forge host ${hostname} is not configured`, 400);
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(parsed.pathname); }
  catch { throw new ForgeReviewError("invalid_url", "Forge URL contains invalid escaping", 400); }
  const segments = decodedPath.split("/").filter(Boolean);
  let numberValue: number | undefined;
  let pathSegments: string[];
  if (provider === "github") {
    const marker = segments.indexOf("pull");
    if (marker >= 2 && marker + 1 < segments.length && marker === 2) {
      if (marker + 2 !== segments.length || !/^\d+$/.test(segments[marker + 1]!)) throw new ForgeReviewError("invalid_url", "GitHub pull-request URL is invalid", 400);
      numberValue = Number(segments[marker + 1]);
      pathSegments = segments.slice(0, marker);
    } else {
      if (!allowRepository) throw new ForgeReviewError("invalid_url", "A pull-request URL is required", 400);
      pathSegments = segments;
    }
  } else {
    const marker = segments.indexOf("-");
    if (marker >= 1 && marker + 2 < segments.length && segments[marker + 1] === "merge_requests") {
      if (marker + 3 !== segments.length || !/^\d+$/.test(segments[marker + 2]!)) throw new ForgeReviewError("invalid_url", "GitLab merge-request URL is invalid", 400);
      numberValue = Number(segments[marker + 2]);
      pathSegments = segments.slice(0, marker);
    } else {
      if (!allowRepository) throw new ForgeReviewError("invalid_url", "A merge-request URL is required", 400);
      pathSegments = segments;
    }
  }
  if (!numberValue || !Number.isSafeInteger(numberValue) || numberValue <= 0) numberValue = undefined;
  const path = normalizeRepoPath(pathSegments.join("/"));
  return { provider, hostname, path, url: repositoryUrl(hostname, path), ...(numberValue === undefined ? {} : { number: numberValue }) };
}

function normalizeState(value: unknown): ForgeReviewListState {
  return value === "open" || value === "closed" || value === "merged" || value === "all" ? value : "open";
}

function stateForGitHub(value: ForgeReviewListState): string {
  return value;
}

function stateForGitLab(value: ForgeReviewListState): readonly string[] {
  return value === "open" ? [] : value === "closed" ? ["--closed"] : value === "merged" ? ["--merged"] : ["--all"];
}

function stateFromProvider(value: unknown, provider: ForgeReviewProvider, merged?: unknown): ForgeReviewState {
  if (provider === "github") {
    if (merged !== undefined && merged !== null) return "merged";
    const state = typeof value === "string" ? value.toLowerCase() : "";
    return state === "open" ? "open" : state === "merged" ? "merged" : "closed";
  }
  const state = typeof value === "string" ? value.toLowerCase() : "";
  return state === "opened" || state === "open" ? "open" : state === "merged" ? "merged" : "closed";
}

function actor(value: unknown): ForgeReviewActor | undefined {
  const item = record(value);
  const login = optionalText(item.login) ?? optionalText(item.username) ?? optionalText(item.name);
  if (!login) return undefined;
  return {
    login,
    ...(optionalText(item.name) === undefined ? {} : { name: optionalText(item.name) }),
    ...(optionalText(item.avatarUrl) ?? optionalText(item.avatar_url) ? { avatarUrl: optionalText(item.avatarUrl) ?? optionalText(item.avatar_url) } : {}),
  };
}

function actors(value: unknown): readonly ForgeReviewActor[] {
  return array(value).slice(0, 100).map(actor).filter((item): item is ForgeReviewActor => item !== undefined);
}

function ref(branch: unknown, sha: unknown): { branch?: string; sha?: string } | undefined {
  const value = { ...(optionalText(branch, 512) === undefined ? {} : { branch: optionalText(branch, 512) }), ...(optionalText(sha, 256) === undefined ? {} : { sha: optionalText(sha, 256) }) };
  return Object.keys(value).length === 0 ? undefined : value;
}

function counts(value: { comments?: unknown; reviews?: unknown; commits?: unknown; checks?: unknown }): ForgeReviewSummary["counts"] {
  const count = (candidate: unknown): number | null => number(candidate) ?? (Array.isArray(candidate) ? candidate.length : null);
  return { comments: count(value.comments), reviews: count(value.reviews), commits: count(value.commits), checks: count(value.checks) };
}

function merge(value: unknown, status: unknown): ForgeReviewSummary["merge"] {
  const mergeState = typeof value === "string" ? value.toLowerCase() : "";
  const statusText = optionalText(status, 128);
  const state = mergeState === "mergeable" || mergeState === "clean" || statusText === "clean"
    ? "mergeable"
    : mergeState === "conflicting" || mergeState === "dirty" || statusText === "dirty"
      ? "conflicts"
      : "unknown";
  return { state, ...(statusText === undefined ? {} : { status: statusText }) };
}

function summaryFromGitHub(value: unknown, repository: ParsedRepository, stateOverride?: ForgeReviewState): ForgeReviewSummary {
  const item = record(value);
  const numberValue = number(item.number);
  if (!numberValue || !optionalText(item.title) || !optionalText(item.url)) throw new ForgeReviewError("provider_failed", "GitHub returned an incomplete pull request", 502);
  const comments = item.comments;
  const reviews = item.reviews;
  const commits = item.commits;
  const checks = item.statusCheckRollup;
  return {
    provider: "github",
    number: numberValue,
    title: optionalText(item.title)!,
    url: optionalText(item.url)!,
    state: stateOverride ?? stateFromProvider(item.state, "github", item.mergedAt),
    draft: bool(item.isDraft),
    ...(actor(item.author) === undefined ? {} : { author: actor(item.author) }),
    ...(optionalText(item.createdAt) === undefined ? {} : { createdAt: optionalText(item.createdAt) }),
    ...(optionalText(item.updatedAt) === undefined ? {} : { updatedAt: optionalText(item.updatedAt) }),
    refs: { ...(ref(item.headRefName, item.headRefOid) === undefined ? {} : { head: ref(item.headRefName, item.headRefOid) }), ...(ref(item.baseRefName, item.baseRefOid) === undefined ? {} : { base: ref(item.baseRefName, item.baseRefOid) }) },
    counts: counts({ comments, reviews, commits, checks }),
    ...(actors(item.reviewRequests).length === 0 ? {} : { requestedReviewers: actors(item.reviewRequests) }),
    merge: merge(item.mergeable, item.mergeStateStatus),
  };
}

function githubRestSummary(value: unknown, repository: ParsedRepository, stateOverride?: ForgeReviewState): ForgeReviewSummary {
  const item = record(value);
  return summaryFromGitHub({
    number: item.number,
    title: item.title,
    url: item.html_url ?? item.url,
    state: item.state,
    isDraft: item.draft ?? item.isDraft,
    author: item.user,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    headRefName: record(item.head).ref,
    headRefOid: record(item.head).sha,
    baseRefName: record(item.base).ref,
    baseRefOid: record(item.base).sha,
    mergedAt: item.merged_at,
    reviewRequests: [...array(item.requested_reviewers), ...array(item.requested_teams)],
    mergeStateStatus: item.mergeable_state,
    mergeable: item.mergeable,
  }, repository, stateOverride);
}

function summaryFromGitLab(value: unknown, repository: ParsedRepository): ForgeReviewSummary {
  const item = record(value);
  const numberValue = number(item.iid) ?? number(item.number);
  const title = optionalText(item.title);
  const url = optionalText(item.web_url) ?? optionalText(item.url);
  if (!numberValue || !title || !url) throw new ForgeReviewError("provider_failed", "GitLab returned an incomplete merge request", 502);
  const diffRefs = record(item.diff_refs);
  return {
    provider: "gitlab",
    number: numberValue,
    title,
    url,
    state: stateFromProvider(item.state, "gitlab"),
    draft: bool(item.draft, bool(item.work_in_progress)),
    ...(actor(item.author) === undefined ? {} : { author: actor(item.author) }),
    ...(optionalText(item.created_at) === undefined ? {} : { createdAt: optionalText(item.created_at) }),
    ...(optionalText(item.updated_at) === undefined ? {} : { updatedAt: optionalText(item.updated_at) }),
    refs: {
      ...(ref(item.source_branch, item.sha ?? diffRefs.head_sha) === undefined ? {} : { head: ref(item.source_branch, item.sha ?? diffRefs.head_sha) }),
      ...(ref(item.target_branch, diffRefs.base_sha) === undefined ? {} : { base: ref(item.target_branch, diffRefs.base_sha) }),
    },
    counts: counts({ comments: item.user_notes_count ?? item.notes, reviews: item.approvals, commits: item.commits, checks: item.head_pipeline === undefined || item.head_pipeline === null ? item.pipelines : 1 }),
    ...(actors(item.reviewers).length === 0 ? {} : { requestedReviewers: actors(item.reviewers) }),
    merge: merge(item.merge_status, item.detailed_merge_status),
  };
}

function reviewComment(value: unknown, provider: ForgeReviewProvider): ForgeReviewComment | undefined {
  const item = record(value);
  const rawId = item.id ?? item.databaseId ?? item.note_id;
  const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : undefined;
  const body = optionalMultilineText(item.body) ?? optionalMultilineText(item.note);
  if (!id || body === undefined) return undefined;
  const position = record(item.position);
  const lineValue = number(item.line) ?? number(item.position) ?? number(position.new_line) ?? number(position.old_line);
  const pathValue = optionalText(item.path) ?? optionalText(position.new_path) ?? optionalText(position.old_path);
  const sideValue = item.side === "LEFT" || item.side === "left" ? "left" as const : item.side === "RIGHT" || item.side === "right" ? "right" as const : number(position.new_line) === undefined && number(position.old_line) !== undefined ? "left" as const : number(position.new_line) === undefined ? undefined : "right" as const;
  return {
    id,
    body,
    ...(actor(item.author ?? item.user) === undefined ? {} : { author: actor(item.author ?? item.user) }),
    ...(optionalText(item.url) ?? optionalText(item.html_url) ?? optionalText(item.web_url) ? { url: optionalText(item.url) ?? optionalText(item.html_url) ?? optionalText(item.web_url) } : {}),
    ...(optionalText(item.createdAt) ?? optionalText(item.created_at) ? { createdAt: optionalText(item.createdAt) ?? optionalText(item.created_at) } : {}),
    ...(optionalText(item.updatedAt) ?? optionalText(item.updated_at) ? { updatedAt: optionalText(item.updatedAt) ?? optionalText(item.updated_at) } : {}),
    ...(pathValue === undefined ? {} : { path: pathValue }),
    ...(lineValue === undefined ? {} : { line: lineValue }),
    ...(sideValue === undefined ? {} : { side: sideValue }),
  };
}

function review(value: unknown): ForgeReviewReview | undefined {
  const item = record(value);
  const rawId = item.id ?? item.databaseId ?? item.note_id;
  const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : undefined;
  if (!id) return undefined;
  const rawState = String(item.state ?? item.status ?? "").toLowerCase();
  const state: ForgeReviewReviewState = rawState === "approved" ? "approved" : rawState === "changes_requested" || rawState === "changes requested" ? "changes_requested" : rawState === "commented" ? "commented" : rawState === "pending" ? "pending" : rawState === "dismissed" ? "dismissed" : "unknown";
  return {
    id,
    state,
    body: optionalMultilineText(item.body) ?? optionalMultilineText(item.note) ?? "",
    ...(actor(item.author ?? item.user) === undefined ? {} : { author: actor(item.author ?? item.user) }),
    ...(optionalText(item.url) ?? optionalText(item.html_url) ?? optionalText(item.web_url) ? { url: optionalText(item.url) ?? optionalText(item.html_url) ?? optionalText(item.web_url) } : {}),
    ...(optionalText(item.submittedAt) ?? optionalText(item.submitted_at) ? { submittedAt: optionalText(item.submittedAt) ?? optionalText(item.submitted_at) } : {}),
    ...(optionalText(item.commit_id) ?? optionalText(item.commitSha) ? { commitSha: optionalText(item.commit_id) ?? optionalText(item.commitSha) } : {}),
  };
}

function commit(value: unknown): ForgeReviewCommit | undefined {
  const item = record(value);
  const sha = optionalText(item.oid, 256) ?? optionalText(item.sha, 256) ?? optionalText(item.id, 256);
  if (!sha) return undefined;
  const authorValue = actor(item.author ?? array(item.authors)[0] ?? item.committer ?? record(item.commit).author);
  const headline = optionalMultilineText(item.messageHeadline, 32_768);
  const body = optionalMultilineText(item.messageBody, 32_768);
  const message = optionalMultilineText(item.message, 32_768)
    ?? (headline === undefined ? body : body === undefined ? headline : `${headline}\n\n${body}`)
    ?? optionalMultilineText(record(item.commit).message, 32_768)
    ?? "";
  return {
    sha,
    message,
    ...(authorValue === undefined ? {} : { author: authorValue }),
    ...(optionalText(item.committedDate) ?? optionalText(item.committed_date) ?? optionalText(item.created_at) ? { committedAt: optionalText(item.committedDate) ?? optionalText(item.committed_date) ?? optionalText(item.created_at) } : {}),
    ...(optionalText(item.url) ?? optionalText(item.web_url) ?? optionalText(item.resourcePath) ? { url: optionalText(item.url) ?? optionalText(item.web_url) ?? optionalText(item.resourcePath) } : {}),
  };
}

function check(value: unknown): ForgeReviewCheck | undefined {
  const item = record(value);
  const pipelineId = number(item.id);
  const name = optionalText(item.name) ?? optionalText(item.context) ?? optionalText(item.title) ?? optionalText(item.ref) ?? (pipelineId === undefined ? undefined : `pipeline #${pipelineId}`);
  if (!name) return undefined;
  const rawStatus = String(item.status ?? item.state ?? "").toLowerCase();
  const status: ForgeReviewCheckStatus = rawStatus === "queued" || rawStatus === "requested" ? "queued" : rawStatus === "in_progress" || rawStatus === "running" || rawStatus === "pending" ? "in_progress" : rawStatus === "completed" || rawStatus === "success" || rawStatus === "passed" || rawStatus === "failure" || rawStatus === "failed" || rawStatus === "cancelled" || rawStatus === "canceled" || rawStatus === "neutral" || rawStatus === "skipped" ? "completed" : "unknown";
  const rawConclusion = optionalText(item.conclusion) ?? optionalText(item.result);
  const conclusion = rawConclusion ?? (["success", "passed", "failure", "failed", "cancelled", "canceled", "neutral", "skipped"].includes(rawStatus) ? rawStatus : undefined);
  return {
    name,
    status,
    ...(conclusion === undefined ? {} : { conclusion }),
    ...(optionalText(item.detailsUrl) ?? optionalText(item.details_url) ?? optionalText(item.target_url) ?? optionalText(item.targetUrl) ?? optionalText(item.web_url) ? { url: optionalText(item.detailsUrl) ?? optionalText(item.details_url) ?? optionalText(item.target_url) ?? optionalText(item.targetUrl) ?? optionalText(item.web_url) } : {}),
  };
}

function file(value: unknown): ForgeReviewFile | undefined {
  const item = record(value);
  const path = optionalText(item.path) ?? optionalText(item.new_path) ?? optionalText(item.old_path);
  if (!path) return undefined;
  return {
    path,
    ...(number(item.additions) === undefined ? {} : { additions: number(item.additions) }),
    ...(number(item.deletions) === undefined ? {} : { deletions: number(item.deletions) }),
    ...(optionalMultilineText(item.patch ?? item.diff, 2 * 1024 * 1024) === undefined ? {} : { patch: optionalMultilineText(item.patch ?? item.diff, 2 * 1024 * 1024) }),
  };
}

function tokenizeGitHeader(value: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quoted = false;
  const octalBytes: number[] = [];
  const flushOctalBytes = (): void => {
    if (octalBytes.length === 0) return;
    // Git quotes the UTF-8 bytes of non-ASCII paths as C-style octal. Decode
    // the complete run as UTF-8; converting each byte with fromCharCode would
    // turn `\303\251` into the mojibake `Ã©`.
    token += Buffer.from(octalBytes).toString("utf8");
    octalBytes.length = 0;
  };
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === '"') {
      flushOctalBytes();
      quoted = !quoted;
      continue;
    }
    if (character === "\\") {
      const next = value[index + 1];
      if (next === undefined) { flushOctalBytes(); token += character; continue; }
      // Git uses C-style octal escapes for non-printable path bytes in quoted headers.
      if (/[0-7]/.test(next)) {
        let digits = next;
        let cursor = index + 2;
        while (digits.length < 3 && cursor < value.length && /[0-7]/.test(value[cursor]!)) {
          digits += value[cursor]!;
          cursor += 1;
        }
        octalBytes.push(Number.parseInt(digits, 8));
        index = cursor - 1;
      } else {
        flushOctalBytes();
        const escapes: Record<string, string> = { a: "\x07", b: "\b", t: "\t", n: "\n", v: "\v", f: "\f", r: "\r" };
        token += escapes[next] ?? next;
        index += 1;
      }
      continue;
    }
    if (!quoted && /\s/.test(character)) {
      flushOctalBytes();
      if (token.length > 0) { tokens.push(token); token = ""; }
      continue;
    }
    flushOctalBytes();
    token += character;
  }
  flushOctalBytes();
  if (token.length > 0) tokens.push(token);
  return tokens;
}

export function patchHeaderPaths(line: string): readonly [string, string] | undefined {
  const header = line.slice("diff --git ".length);
  if (header.startsWith('"')) {
    const tokens = tokenizeGitHeader(header);
    return tokens.length >= 2 ? [tokens[0]!, tokens[1]!] : undefined;
  }
  // Unquoted paths may contain spaces. The second path is introduced by the literal ` b/`
  // marker emitted by git, so split on that marker instead of whitespace tokenization.
  const separator = header.indexOf(" b/");
  if (separator >= 0) return [header.slice(0, separator), header.slice(separator + 1)];
  const tokens = tokenizeGitHeader(header);
  return tokens.length >= 2 ? [tokens[0]!, tokens[1]!] : undefined;
}

export function patchPath(value: string, prefix: "a/" | "b/"): string | undefined {
  const path = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  return optionalText(path, 4_096);
}

function parsePatchFiles(patch: string): ForgeReviewFile[] {
  const files: ForgeReviewFile[] = [];
  const lines = patch.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.startsWith("diff --git ")) continue;
    const paths = patchHeaderPaths(line);
    if (!paths) continue;
    const path = patchPath(paths[1], "b/") ?? patchPath(paths[0], "a/");
    if (!path) continue;
    let additions = 0;
    let deletions = 0;
    for (let next = index + 1; next < lines.length && !lines[next]!.startsWith("diff --git "); next += 1) {
      if (lines[next]!.startsWith("+") && !lines[next]!.startsWith("+++")) additions += 1;
      if (lines[next]!.startsWith("-") && !lines[next]!.startsWith("---")) deletions += 1;
    }
    // Binary/rename-only entries have no line evidence. Leave counts absent instead of
    // manufacturing zeroes that look like provider-reported statistics.
    files.push({ path, ...(additions === 0 ? {} : { additions }), ...(deletions === 0 ? {} : { deletions }) });
    if (files.length >= MAX_FILE_COUNT) break;
  }
  return files;
}

function snapshot(value: unknown, now: () => Date, extras: { headSha?: string; baseSha?: string; truncated: boolean; identity?: unknown }): ForgeReviewSnapshot {
  // The hash names the immutable review revision, rather than a response shape. Detail and diff
  // therefore share a hash when they describe the same provider/head/base even though one carries
  // comments and the other carries patch bytes. List snapshots intentionally hash their item set.
  const serialized = JSON.stringify(extras.identity ?? value);
  const hash = createHash("sha256").update(serialized).digest("hex");
  return {
    hash,
    capturedAt: now().toISOString(),
    ...(extras.headSha === undefined ? {} : { headSha: extras.headSha }),
    ...(extras.baseSha === undefined ? {} : { baseSha: extras.baseSha }),
    truncated: extras.truncated,
  };
}

function mapProviderFailure(provider: ForgeReviewProvider, result: ForgeCommandResult, operation: ForgeReviewOperation): ForgeReviewError {
  if (result.truncated) return new ForgeReviewError("output_truncated", `${provider} ${operation} output exceeded its safety limit`, 502);
  const diagnostic = result.stderr.replace(/\s+/g, " ").trim().slice(0, 240);
  if (result.timedOut) return new ForgeReviewError("provider_unavailable", `${provider} ${operation} timed out`, 503);
  if (result.code === "ENOENT") return new ForgeReviewError("provider_unavailable", `${provider} CLI is not installed`, 503);
  if (/not logged|authentication|authenticate|unauthorized|401|403/i.test(diagnostic)) return new ForgeReviewError("unauthenticated", `${provider} CLI is not authenticated for this host`, 401);
  return new ForgeReviewError("provider_failed", diagnostic || `${provider} could not complete ${operation}`, 502);
}

function jsonRecords(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  const recordValue = record(value);
  if (Array.isArray(recordValue.items)) return recordValue.items;
  if (Array.isArray(recordValue.merge_requests)) return recordValue.merge_requests;
  return [value];
}

function asRepository(value: ParsedRepository): ForgeReviewRepository {
  return { provider: value.provider, hostname: value.hostname, path: value.path, url: value.url };
}

function providerHostSet(values: readonly string[] | undefined, fallback: string): Set<string> {
  const hosts = new Set<string>([fallback]);
  for (const value of values ?? []) {
    const host = normalizeHost(value);
    if (/^[a-z0-9.-]+$/.test(host) && host.includes(".")) hosts.add(host);
  }
  return hosts;
}

export function createForgeReview(options: ForgeReviewOptions): ForgeReviewService {
  const runner = options.runner ?? defaultForgeCommandRunner;
  const gitExecutable = options.gitExecutable ?? "git";
  const githubExecutable = options.githubExecutable ?? "gh";
  const gitlabExecutable = options.gitlabExecutable ?? "glab";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const authTimeoutMs = options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES;
  const maxPatchBytes = options.maxPatchBytes ?? DEFAULT_PATCH_BYTES;
  const now = options.now ?? (() => new Date());
  const githubHosts = providerHostSet(options.githubHosts, "github.com");
  const gitlabHosts = providerHostSet(options.gitlabHosts, "gitlab.com");
  const providerForHost = (hostname: string): ForgeReviewProvider | undefined => {
    const host = normalizeHost(hostname);
    if (githubHosts.has(host)) return "github";
    if (gitlabHosts.has(host)) return "gitlab";
    return undefined;
  };

  async function run(request: ForgeCommandRequest, provider: ForgeReviewProvider, operation: ForgeReviewOperation): Promise<NormalizedResult> {
    const result = await runner(request);
    if (result.code !== 0 && result.code !== null) throw mapProviderFailure(provider, result, operation);
    if (result.timedOut) throw mapProviderFailure(provider, result, operation);
    if (result.truncated) throw new ForgeReviewError("output_truncated", `${provider} ${operation} output exceeded its safety limit`, 502);
    return { text: result.stdout, truncated: false };
  }

  async function authenticate(provider: ForgeReviewProvider, hostname: string): Promise<"available" | "unauthenticated" | "unavailable"> {
    const command = provider === "github" ? githubExecutable : gitlabExecutable;
    const result = await runner({ command, args: ["auth", "status", "--hostname", hostname], timeoutMs: authTimeoutMs, maxOutputBytes: 64 * 1024 });
    if (result.code === 0 && !result.timedOut && !result.truncated) return "available";
    if (result.code === "ENOENT") return "unavailable";
    if (result.timedOut || result.truncated) return "unavailable";
    return "unauthenticated";
  }

  async function viewer(provider: ForgeReviewProvider, hostname: string): Promise<ForgeReviewActor | undefined> {
    const command = provider === "github" ? githubExecutable : gitlabExecutable;
    const args = provider === "github" ? ["api", "user", "--hostname", hostname] : ["api", "user", "--hostname", hostname];
    const result = await runner({ command, args, timeoutMs: authTimeoutMs, maxOutputBytes: 64 * 1024 });
    if (result.code !== 0 || result.timedOut || result.truncated) return undefined;
    try { return actor(parseJson(result.stdout, provider)); } catch { return undefined; }
  }

  async function project(projectId: string): Promise<ResolvedProject> {
    if (typeof projectId !== "string" || projectId.length === 0 || projectId.length > 512) throw new ForgeReviewError("invalid_request", "projectId is required", 400);
    const item = options.store.getProject(projectId);
    if (!item) throw new ForgeReviewError("project_not_found", "The selected project is not registered with Cedia", 404);
    let path: string;
    try { path = realpathSync(item.path); }
    catch { throw new ForgeReviewError("project_not_git", "The selected project folder is unavailable", 409); }
    const result = await runner({ command: gitExecutable, args: ["remote", "get-url", "origin"], cwd: path, timeoutMs: Math.min(timeoutMs, 5_000), maxOutputBytes: 64 * 1024 });
    if (result.stderr.includes("not a git repository") || result.stderr.includes("No such file or directory")) throw new ForgeReviewError("project_not_git", "The selected project is not a readable Git repository", 409);
    if (result.code !== 0 || result.timedOut || result.truncated || !result.stdout.trim()) throw new ForgeReviewError("remote_unavailable", "The selected project has no readable origin remote", 409);
    return { id: item.id, path, repository: parseRemote(result.stdout.trim().split(/\r?\n/)[0]!, providerForHost) };
  }

  async function target(projectId: string, url: string | undefined, requestedProvider: ForgeReviewProvider | undefined, needsNumber: boolean): Promise<{ project: ResolvedProject; target: ParsedReviewUrl }> {
    const selected = await project(projectId);
    let parsed: ParsedReviewUrl;
    if (url === undefined) {
      parsed = { ...selected.repository };
    } else {
      parsed = parseReviewUrl(url, providerForHost);
    }
    if (requestedProvider !== undefined && requestedProvider !== parsed.provider) throw new ForgeReviewError("unsupported_provider", "Requested provider does not match the project origin", 400);
    if (selected.repository.provider !== parsed.provider || selected.repository.hostname !== parsed.hostname || selected.repository.path.toLowerCase() !== parsed.path.toLowerCase()) {
      throw new ForgeReviewError("repository_mismatch", "The requested review is outside the selected Cedia project", 403);
    }
    if (needsNumber && parsed.number === undefined) throw new ForgeReviewError("invalid_url", "A pull or merge-request URL is required", 400);
    return { project: selected, target: parsed };
  }

  function reviewRepoArg(repository: ParsedRepository): string {
    return repository.provider === "github" ? `${repository.hostname}/${repository.path}` : repository.url;
  }

  async function list(request: ForgeReviewListRequest): Promise<ForgeReviewListResult> {
    const limit = request.limit === undefined ? 50 : request.limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REVIEW_LIMIT) throw new ForgeReviewError("invalid_request", `limit must be between 1 and ${MAX_REVIEW_LIMIT}`, 400);
    const state = normalizeState(request.state);
    const bucket: ForgeReviewListBucket = request.bucket ?? "all";
    if (bucket === "team" && (typeof request.team !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(request.team))) throw new ForgeReviewError("invalid_request", "The team bucket requires an organization/team slug", 400);
    if (bucket !== "team" && request.team !== undefined) throw new ForgeReviewError("invalid_request", "team is only valid for the team review bucket", 400);
    const cursor = request.cursor === undefined ? 1 : /^\d{1,6}$/.test(request.cursor) ? Number(request.cursor) : NaN;
    if (!Number.isSafeInteger(cursor) || cursor < 1 || cursor > 100_000) throw new ForgeReviewError("invalid_request", "Invalid review list cursor", 400);
    const resolved = await target(request.projectId, request.url, request.provider, false);
    const { target: repository } = resolved;
    const auth = await authenticate(repository.provider, repository.hostname);
    if (auth === "unavailable") throw new ForgeReviewError("provider_unavailable", `${repository.provider} CLI is not installed`, 503);
    if (auth === "unauthenticated") throw new ForgeReviewError("unauthenticated", `${repository.provider} CLI is not authenticated for ${repository.hostname}`, 401);
    const currentViewer = await viewer(repository.provider, repository.hostname);
    let raw: readonly unknown[];
    let providerTruncated = false;
    let nextCursor: string | undefined;
    let normalizedFromGithubRest = false;
    if (repository.provider === "github") {
      if (cursor > 1 || bucket !== "all" || state === "merged") {
        // `gh pr list` has no page cursor. Once a caller asks for the next page, use the
        // authenticated REST endpoint with a fixed page/limit and normalize its response into
        // the same provider-neutral summary shape.
        normalizedFromGithubRest = true;
        const stateQuery = state === "all" ? "" : state === "open" ? "is:open" : state === "closed" ? "is:closed" : "is:merged";
        const bucketQuery = bucket === "authored" ? `author:${currentViewer?.login ?? "@me"}` : bucket === "needs_review" ? `review-requested:${currentViewer?.login ?? "@me"}` : bucket === "team" ? `team-review-requested:${request.team}` : undefined;
        const query = ["repo:" + repository.path, "is:pr", stateQuery, bucketQuery].filter(Boolean).join(" ");
        const path = bucket === "all" && state !== "merged" ? `repos/${repository.path}/pulls?state=${state === "all" ? "all" : state === "open" ? "open" : "closed"}&per_page=${limit}&page=${cursor}` : `search/issues?q=${encodeURIComponent(query)}&per_page=${limit}&page=${cursor}`;
        const output = await run({ command: githubExecutable, args: ["api", path, "--hostname", repository.hostname], timeoutMs, maxOutputBytes: Math.min(maxOutputBytes, MAX_LIST_OUTPUT_BYTES) }, "github", "list");
        raw = jsonRecords(parseJson(output.text, repository.provider));
        if (raw.length === limit) nextCursor = String(cursor + 1);
      } else {
        const output = await run({ command: githubExecutable, args: ["pr", "list", "--repo", reviewRepoArg(repository), "--state", stateForGitHub(state), "--limit", String(limit), "--json", GITHUB_LIST_FIELDS], timeoutMs, maxOutputBytes: Math.min(maxOutputBytes, MAX_LIST_OUTPUT_BYTES) }, "github", "list");
        raw = jsonRecords(parseJson(output.text, repository.provider));
        normalizedFromGithubRest = false;
        if (raw.length === limit) nextCursor = "2";
      }
    } else {
      if (bucket !== "all") throw new ForgeReviewError("unsupported_provider", "GitLab review buckets are unavailable until the provider exposes reviewer search", 409);
      // GitLab caps --per-page at 100. Fetch a second page when the first page is full so a
      // requested limit of 100 can still distinguish exactly 100 rows from an additional row.
      const pageSize = Math.min(100, limit + 1);
      const collected: unknown[] = [];
      let lastPage = cursor - 1;
      for (let page = cursor; page <= 64 && collected.length <= limit; page += 1) {
        lastPage = page;
        const output = await run({ command: gitlabExecutable, args: ["mr", "list", "--repo", reviewRepoArg(repository), ...stateForGitLab(state), "--page", String(page), "--per-page", String(pageSize), "--output", "json"], timeoutMs, maxOutputBytes: Math.min(maxOutputBytes, MAX_LIST_OUTPUT_BYTES) }, "gitlab", "list");
        const pageItems = jsonRecords(parseJson(output.text, repository.provider));
        collected.push(...pageItems);
        if (pageItems.length < pageSize) break;
        if (collected.length > limit) { providerTruncated = true; break; }
      }
      raw = collected;
      if (providerTruncated) nextCursor = String(lastPage + 1);
    }
    const truncated = providerTruncated || raw.length > limit;
    const items = raw.slice(0, limit).map(item => repository.provider === "github" ? (normalizedFromGithubRest ? githubRestSummary(item, repository, state === "merged" ? "merged" : undefined) : summaryFromGitHub(item, repository)) : summaryFromGitLab(item, repository));
    const payload = { provider: repository.provider, repository: asRepository(repository), items, bucket, ...(nextCursor === undefined ? {} : { nextCursor }), ...(currentViewer === undefined ? {} : { viewer: currentViewer }) };
    return { ...payload, truncated, snapshot: snapshot(payload, now, { truncated }) };
  }

  async function gitlabDetailSupplements(repository: ParsedRepository, numberValue: number): Promise<{
    notes?: readonly unknown[];
    commits?: readonly unknown[];
    approvals?: readonly unknown[];
    pipelines?: readonly unknown[];
    changes?: readonly unknown[];
    diffs?: readonly unknown[];
    unavailable: readonly ("comments" | "reviews" | "commits" | "checks" | "files")[];
    truncated: boolean;
  }> {
    const projectPath = encodeURIComponent(repository.path);
    const endpoints = {
      discussions: `projects/${projectPath}/merge_requests/${numberValue}/discussions`,
      commits: `projects/${projectPath}/merge_requests/${numberValue}/commits`,
      approvals: `projects/${projectPath}/merge_requests/${numberValue}/approvals`,
      pipelines: `projects/${projectPath}/merge_requests/${numberValue}/pipelines`,
      changes: `projects/${projectPath}/merge_requests/${numberValue}/changes`,
      diffs: `projects/${projectPath}/merge_requests/${numberValue}/diffs`,
    } as const;
    const pageSize = 100;
    type ReadResult = { available: boolean; value?: unknown; truncated: boolean };
    const invoke = async (endpoint: string): Promise<ReadResult> => {
      const result = await runner({ command: gitlabExecutable, args: ["api", "--hostname", repository.hostname, endpoint, "--output", "json"], timeoutMs, maxOutputBytes: Math.min(maxOutputBytes, MAX_DETAIL_OUTPUT_BYTES) });
      if (result.code !== 0 || result.timedOut || result.truncated) return { available: false, truncated: result.truncated };
      try { return { available: true, value: parseJson(result.stdout, "gitlab"), truncated: false }; }
      catch { return { available: false, truncated: false }; }
    };
    const paged = async (endpoint: string, cap: number, extract: (value: unknown) => readonly unknown[]): Promise<{ available: boolean; items: readonly unknown[]; truncated: boolean }> => {
      const items: unknown[] = [];
      let truncated = false;
      let available = true;
      for (let page = 1; page <= 64; page += 1) {
        const result = await invoke(`${endpoint}?page=${page}&per_page=${pageSize}`);
        if (!result.available) { available = false; truncated ||= result.truncated; break; }
        const pageItems = extract(result.value);
        items.push(...pageItems);
        const objectValue = record(result.value);
        if (bool(objectValue.overflow) || pageItems.some(item => bool(record(item).collapsed) || bool(record(item).too_large))) truncated = true;
        const totalPages = number(objectValue.total_pages);
        const hasNext = totalPages === undefined ? pageItems.length >= pageSize : page < totalPages;
        if (items.length > cap) { truncated = true; break; }
        if (!hasNext) break;
      }
      if (items.length > cap) truncated = true;
      return { available, items: items.slice(0, cap), truncated };
    };
    const [discussionValue, commitValue, approvalValue, pipelineValue, changesValue, diffValue] = await Promise.all([
      paged(endpoints.discussions, MAX_COMMENT_COUNT, value => array(value)),
      paged(endpoints.commits, MAX_COMMIT_COUNT, value => array(value)),
      invoke(endpoints.approvals),
      paged(endpoints.pipelines, MAX_COMMENT_COUNT, value => array(value)),
      paged(endpoints.changes, MAX_FILE_COUNT, value => array(record(value).changes)),
      paged(endpoints.diffs, MAX_FILE_COUNT, value => array(record(value).diffs ?? record(value).items ?? value)),
    ]);
    const notes = discussionValue.items.flatMap(value => array(record(value).notes));
    const notesTruncated = notes.length > MAX_COMMENT_COUNT;
    const approvals = approvalValue.available ? array(record(approvalValue.value).approved_by).map(value => {
      const entry = record(value);
      const user = entry.user;
      const id = record(user).id ?? entry.user_id;
      return id === undefined ? undefined : { id: String(id), state: "approved", body: "", author: user };
    }).filter(value => value !== undefined).slice(0, MAX_COMMENT_COUNT) : undefined;
    const unavailable: ("comments" | "reviews" | "commits" | "checks" | "files")[] = [];
    if (!discussionValue.available) unavailable.push("comments");
    if (!approvalValue.available) unavailable.push("reviews");
    if (!commitValue.available) unavailable.push("commits");
    if (!pipelineValue.available) unavailable.push("checks");
    // `/changes` is available on older GitLab versions; `/diffs` carries collapsed/too_large
    // metadata on newer versions. Either response is enough to make file availability honest.
    if (!changesValue.available && !diffValue.available) unavailable.push("files");
    const changes = changesValue.available ? changesValue.items : undefined;
    const diffs = diffValue.available ? diffValue.items : undefined;
    return {
      ...(discussionValue.available ? { notes: notes.slice(0, MAX_COMMENT_COUNT) } : {}),
      ...(commitValue.available ? { commits: commitValue.items.slice(0, MAX_COMMIT_COUNT) } : {}),
      ...(approvals === undefined ? {} : { approvals }),
      ...(pipelineValue.available ? { pipelines: pipelineValue.items.slice(0, MAX_COMMENT_COUNT) } : {}),
      ...(changes === undefined ? {} : { changes: changes.slice(0, MAX_FILE_COUNT) }),
      ...(diffs === undefined ? {} : { diffs: diffs.slice(0, MAX_FILE_COUNT) }),
      unavailable,
      truncated: discussionValue.truncated || notesTruncated || commitValue.truncated || pipelineValue.truncated || changesValue.truncated || diffValue.truncated || approvalValue.truncated,
    };
  }

  async function detail(request: ForgeReviewRequest): Promise<ForgeReviewDetail> {
    const resolved = await target(request.projectId, request.url, undefined, true);
    const repository = resolved.target;
    const auth = await authenticate(repository.provider, repository.hostname);
    if (auth === "unavailable") throw new ForgeReviewError("provider_unavailable", `${repository.provider} CLI is not installed`, 503);
    if (auth === "unauthenticated") throw new ForgeReviewError("unauthenticated", `${repository.provider} CLI is not authenticated for ${repository.hostname}`, 401);
    let output: NormalizedResult;
    if (repository.provider === "github") output = await run({ command: githubExecutable, args: ["pr", "view", String(repository.number), "--repo", reviewRepoArg(repository), "--json", GITHUB_DETAIL_FIELDS], timeoutMs, maxOutputBytes: Math.min(maxOutputBytes, MAX_DETAIL_OUTPUT_BYTES) }, "github", "detail");
    else output = await run({ command: gitlabExecutable, args: ["mr", "view", String(repository.number), "--repo", reviewRepoArg(repository), "--output", "json"], timeoutMs, maxOutputBytes: Math.min(maxOutputBytes, MAX_DETAIL_OUTPUT_BYTES) }, "gitlab", "detail");
    const raw = parseJson(output.text, repository.provider);
    const supplemental = repository.provider === "gitlab" ? await gitlabDetailSupplements(repository, repository.number!) : undefined;
    if (supplemental?.truncated) throw new ForgeReviewError("output_truncated", "GitLab review collections exceeded the host safety limit", 502);
    const rawWithSupplements = supplemental === undefined ? raw : { ...record(raw), ...supplemental };
    const summary = repository.provider === "github" ? summaryFromGitHub(rawWithSupplements, repository) : summaryFromGitLab(rawWithSupplements, repository);
    const item = record(rawWithSupplements);
    const supplementalUnavailable = new Set<"comments" | "reviews" | "commits" | "checks" | "files">(repository.provider === "gitlab" && Array.isArray(item.unavailable) ? item.unavailable.filter((value): value is "comments" | "reviews" | "commits" | "checks" | "files" => value === "comments" || value === "reviews" || value === "commits" || value === "checks" || value === "files") : []);
    const collection = (value: unknown, unavailableKey: "comments" | "reviews" | "commits" | "checks" | "files"): readonly unknown[] => {
      if (Array.isArray(value)) return value;
      if (repository.provider === "gitlab" && supplementalUnavailable.has(unavailableKey)) throw new ForgeReviewError("provider_unavailable", `GitLab ${unavailableKey} are unavailable for this merge request`, 503);
      return [];
    };
    const comments = collection(item.comments ?? item.notes ?? item.discussions, "comments").slice(0, MAX_COMMENT_COUNT).map(value => reviewComment(value, repository.provider)).filter((value): value is ForgeReviewComment => value !== undefined);
    const reviews = collection(item.reviews ?? item.approvals, "reviews").slice(0, MAX_COMMENT_COUNT).map(review).filter((value): value is ForgeReviewReview => value !== undefined);
    const commits = collection(item.commits, "commits").slice(0, MAX_COMMIT_COUNT).map(commit).filter((value): value is ForgeReviewCommit => value !== undefined);
    const checks = array(item.statusCheckRollup ?? item.pipelines ?? record(item.pipeline).jobs ?? (item.head_pipeline ? [item.head_pipeline] : [])).slice(0, MAX_COMMENT_COUNT).map(check).filter((value): value is ForgeReviewCheck => value !== undefined);
    if (repository.provider === "gitlab" && checks.length === 0 && item.statusCheckRollup === undefined && item.pipelines === undefined && item.pipeline === undefined && item.head_pipeline === undefined && supplementalUnavailable.has("checks")) throw new ForgeReviewError("provider_unavailable", "GitLab checks are unavailable for this merge request", 503);
    const files = collection(item.files ?? item.changes ?? item.diffs, "files").slice(0, MAX_FILE_COUNT).map(file).filter((value): value is ForgeReviewFile => value !== undefined);
    const headSha = summary.refs.head?.sha;
    const baseSha = summary.refs.base?.sha;
    const rawChangedFiles = number(item.changedFiles) ?? (typeof item.changes_count === "string" && /^\d+$/.test(item.changes_count) ? Number(item.changes_count) : undefined);
    const changedFiles = rawChangedFiles;
    const truncated = bool(item.truncated)
      || array(item.comments ?? item.notes ?? item.discussions).length > MAX_COMMENT_COUNT
      || array(item.reviews ?? item.approvals).length > MAX_COMMENT_COUNT
      || array(item.commits).length > MAX_COMMIT_COUNT
      || array(item.files ?? item.changes ?? item.diffs).length > MAX_FILE_COUNT
      || changedFiles !== undefined && files.length < changedFiles;
    const detailPayload = {
      ...summary,
      repository: asRepository(repository),
      body: optionalMultilineText(item.body, 2 * 1024 * 1024) ?? optionalMultilineText(item.description, 2 * 1024 * 1024) ?? null,
      ref: { number: summary.number, url: summary.url },
      comments, reviews, commits, checks, files,
      ...(changedFiles === undefined ? {} : { changedFiles }),
    };
    return { ...detailPayload, snapshot: snapshot(detailPayload, now, { headSha, baseSha, truncated, identity: { provider: summary.provider, number: summary.number, url: summary.url, refs: summary.refs } }) };
  }

  async function diff(request: ForgeReviewDiffRequest): Promise<ForgeReviewDiffResult> {
    const resolved = await target(request.projectId, request.url, undefined, true);
    const repository = resolved.target;
    const auth = await authenticate(repository.provider, repository.hostname);
    if (auth === "unavailable") throw new ForgeReviewError("provider_unavailable", `${repository.provider} CLI is not installed`, 503);
    if (auth === "unauthenticated") throw new ForgeReviewError("unauthenticated", `${repository.provider} CLI is not authenticated for ${repository.hostname}`, 401);
    const currentBefore = await detail(request);
    const requestedHead = request.headSha;
    const requestedBase = request.baseSha;
    if (requestedHead !== undefined && requestedHead !== currentBefore.snapshot.headSha || requestedBase !== undefined && requestedBase !== currentBefore.snapshot.baseSha) {
      throw new ForgeReviewError("stale_snapshot", "The pull or merge request moved; reload its detail before reviewing the diff", 409);
    }
    const diffCommand: ForgeCommandRequest = repository.provider === "github"
      ? { command: githubExecutable, args: ["pr", "diff", String(repository.number), "--repo", reviewRepoArg(repository)], timeoutMs, maxOutputBytes: maxPatchBytes }
      : { command: gitlabExecutable, args: ["mr", "diff", String(repository.number), "--repo", reviewRepoArg(repository)], timeoutMs, maxOutputBytes: maxPatchBytes };
    const diffProcess = await runner(diffCommand);
    if (diffProcess.timedOut || (diffProcess.code !== 0 && !diffProcess.truncated)) throw mapProviderFailure(repository.provider, diffProcess, "diff");
    const output: NormalizedResult = { text: diffProcess.stdout, truncated: diffProcess.truncated };
    const patch = output.text;
    const files = parsePatchFiles(patch);
    // A diff command returns no refs, so read the provider's structured detail before and after the
    // patch to bind it to one exact head/base pair. This keeps stale review comments from following
    // a force push that races the CLI calls.
    const current = await detail(request);
    const headSha = current.snapshot.headSha;
    const baseSha = current.snapshot.baseSha;
    if (headSha !== currentBefore.snapshot.headSha || baseSha !== currentBefore.snapshot.baseSha) {
      throw new ForgeReviewError("stale_snapshot", "The pull or merge request moved; reload its detail before reviewing the diff", 409);
    }
    const changedFiles = (current as ForgeReviewDetail & { changedFiles?: number }).changedFiles;
    const truncated = output.truncated || changedFiles !== undefined && files.length < changedFiles;
    const payload = { provider: repository.provider, repository: asRepository(repository), ref: current.ref, files, patch };
    return { ...payload, truncated, snapshot: snapshot(payload, now, { headSha, baseSha, truncated, identity: { provider: current.provider, number: current.number, url: current.url, refs: current.refs } }) };
  }

  async function capabilities(): Promise<ForgeReviewCapabilities> {
    const providers: ForgeReviewProviderCapability[] = [];
    const add = async (provider: ForgeReviewProvider, host: string, command: string): Promise<void> => {
      const state = await authenticate(provider, host);
      const operations: readonly ForgeReviewOperation[] = state === "available" ? ["list", "detail", "diff"] : [];
      providers.push({ provider, hostname: host, state, ...(state === "unauthenticated" ? { reason: `Authenticate ${command} for ${host}` } : state === "unavailable" ? { reason: `${command} CLI is not installed` } : {}), operations });
    };
    await Promise.all([
      ...[...githubHosts].sort().map(host => add("github", host, githubExecutable)),
      ...[...gitlabHosts].sort().map(host => add("gitlab", host, gitlabExecutable)),
    ]);
    providers.sort((left, right) => `${left.provider}:${left.hostname}`.localeCompare(`${right.provider}:${right.hostname}`));
    const writes: readonly ForgeReviewMutationKind[] = providers.some(item => item.provider === "github" && item.state === "available")
      ? ["issue_comment", "review", "reply", "resolve_thread", "edit", "reviewers", "draft", "state", "merge"]
      : [];
    return { providers, writes };
  }

  return { capabilities, list, detail, diff };
}

export const FORGE_REVIEW_LIMIT = MAX_REVIEW_LIMIT;
