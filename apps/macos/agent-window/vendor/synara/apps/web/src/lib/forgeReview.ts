import type { ProjectId } from "@synara/contracts";
import type {
  ForgeReviewActor,
  ForgeReviewCapabilities,
  ForgeReviewCheck,
  ForgeReviewComment,
  ForgeReviewCommit,
  ForgeReviewCommitRef,
  ForgeReviewDetail,
  ForgeReviewDiffResult,
  ForgeReviewFile,
  ForgeReviewListResult,
  ForgeReviewListBucket,
  ForgeReviewListState,
  ForgeReviewInlineComment,
  ForgeReviewMerge,
  ForgeReviewProvider,
  ForgeReviewRef,
  ForgeReviewRefs,
  ForgeReviewRepository,
  ForgeReviewReview,
  ForgeReviewSnapshot,
  ForgeReviewState,
  ForgeReviewSummary,
} from "../../../../../../../../../packages/protocol/src/index.ts";
import type {
  ForgeReviewMutationRequest,
  ForgeReviewMutationResult,
  ForgeReviewWorkflowRequest,
  ForgeReviewWorkflowResult,
} from "../../../../../../../../../packages/protocol/src/forge-review-workflow.ts";
import { ensureNativeApi } from "~/nativeApi";

/** The renderer consumes the Cedia-owned DTOs; provider CLI details stay in the host. */
export type {
  ForgeReviewActor,
  ForgeReviewCapabilities,
  ForgeReviewCheck,
  ForgeReviewComment,
  ForgeReviewCommit,
  ForgeReviewCommitRef,
  ForgeReviewDetail,
  ForgeReviewDiffResult,
  ForgeReviewFile,
  ForgeReviewListResult,
  ForgeReviewListBucket,
  ForgeReviewListState,
  ForgeReviewInlineComment,
  ForgeReviewMerge,
  ForgeReviewProvider,
  ForgeReviewRef,
  ForgeReviewRefs,
  ForgeReviewRepository,
  ForgeReviewReview,
  ForgeReviewSnapshot,
  ForgeReviewState,
  ForgeReviewSummary,
};
export type ForgeProvider = ForgeReviewProvider;

export interface ForgeReviewListInput {
  readonly projectId: ProjectId;
  readonly url?: string;
  readonly provider?: ForgeReviewProvider;
  readonly state?: ForgeReviewListState;
  readonly bucket?: ForgeReviewListBucket;
  readonly team?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ForgeReviewDetailInput {
  readonly projectId: ProjectId;
  readonly url: string;
}

export interface ForgeReviewDiffInput extends ForgeReviewDetailInput {
  readonly headSha?: string;
  readonly baseSha?: string;
}

export interface ForgeReviewOmpInput extends ForgeReviewDetailInput {
  readonly snapshotHash?: string;
  readonly headSha?: string;
  readonly baseSha?: string;
  readonly prompt?: string;
  readonly reviewInstructions?: string;
  readonly attachedContext?: readonly { readonly name: string; readonly text?: string }[];
  readonly threadId?: string;
  readonly commandId?: string;
  readonly modelSelection?: unknown;
}

export interface ForgeReviewOmpResult {
  readonly threadId?: string | null;
  readonly taskId?: string | null;
  readonly commandId?: string | null;
  readonly mode?: "review" | "ask";
  readonly status?: string;
  readonly snapshot?: ForgeReviewSnapshot;
  readonly taskAssociation?: ForgeReviewTaskAssociation;
  readonly associationWarning?: string;
}

export interface ForgeReviewInstructions {
  readonly projectId: string;
  readonly revision: number;
  readonly text: string;
  readonly examples: readonly string[];
  readonly updatedAt: string | null;
}

export interface ForgeReviewInstructionsWriteInput {
  readonly projectId: ProjectId;
  readonly text: string;
  readonly examples?: readonly string[];
  readonly expectedRevision?: number;
}

export interface ForgeReviewTaskAssociation {
  readonly projectId: ProjectId;
  readonly provider: ForgeReviewProvider;
  readonly hostname: string;
  readonly repositoryPath: string;
  readonly number: number;
  readonly snapshotHash: string;
  readonly headSha?: string;
  readonly baseSha?: string;
  readonly revision: number;
  readonly threadId: string;
  readonly commandId?: string;
  readonly dispatchMode?: "prompt" | "queue" | "steer";
  readonly updatedAt: string | null;
}

export interface ForgeReviewTaskAssociationInput {
  readonly projectId: ProjectId;
  readonly provider: ForgeReviewProvider;
  readonly hostname: string;
  readonly repositoryPath: string;
  readonly number: number;
  readonly snapshotHash: string;
  readonly headSha?: string;
  readonly baseSha?: string;
}

export interface ForgeReviewTaskAssociationWriteInput extends ForgeReviewTaskAssociationInput {
  readonly threadId: string;
  readonly commandId?: string;
  readonly dispatchMode?: "prompt" | "queue" | "steer";
  readonly expectedRevision?: number;
}

export interface ForgeReviewInlineDraftInput extends ForgeReviewTaskAssociationInput {}

export interface ForgeReviewInlineDraftWriteInput extends ForgeReviewInlineDraftInput {
  readonly comments: readonly ForgeReviewInlineComment[];
  readonly expectedRevision?: number;
}

export interface ForgeReviewInlineDraft {
  readonly draftId: string;
  readonly revision: number;
  readonly comments: readonly ForgeReviewInlineComment[];
  readonly updatedAt: string | null;
}

export interface ForgeReviewDraftReadInput {
  readonly projectId: ProjectId;
  readonly provider: ForgeReviewProvider;
  readonly hostname: string;
  readonly repositoryPath: string;
  readonly number: number;
  readonly url?: string;
  readonly snapshotHash?: string;
  readonly headSha?: string;
  readonly baseSha?: string;
}

export interface ForgeReviewDraftWriteInput extends ForgeReviewDraftReadInput {
  readonly snapshotHash?: string;
  readonly headSha?: string;
  readonly baseSha?: string;
  readonly text: string;
  readonly expectedRevision?: number;
}

export interface ForgeReviewDraftApi {
  readonly read: (
    input: ForgeReviewDraftReadInput,
  ) => Promise<ForgeReviewDraft>;
  readonly write: (
    input: ForgeReviewDraftWriteInput,
  ) => Promise<ForgeReviewDraft>;
}

export interface ForgeReviewInlineDraftApi {
  readonly read: (input: ForgeReviewInlineDraftInput) => Promise<ForgeReviewInlineDraft>;
  readonly write: (input: ForgeReviewInlineDraftWriteInput) => Promise<ForgeReviewInlineDraft>;
}

export interface ForgeReviewDraftContent {
  readonly kind?: string;
  readonly projectId?: string;
  readonly hostname?: string;
  readonly provider?: ForgeReviewProvider;
  readonly repository?: string;
  readonly number?: number;
  readonly url?: string;
  readonly snapshotHash?: string;
  readonly headSha?: string;
  readonly baseSha?: string;
}

export interface ForgeReviewDraft {
  readonly text: string;
  readonly revision: number;
  readonly content?: ForgeReviewDraftContent;
  readonly snapshotHash?: string;
  readonly headSha?: string;
  readonly baseSha?: string;
  readonly url?: string;
}

export interface ForgeReviewTaskResult {
  readonly threadId: string;
  readonly status: "queued" | "running" | "completed" | "error" | "empty" | "truncated";
  readonly text: string;
  readonly truncated?: boolean;
  readonly reason?: string;
  readonly updatedAt?: string;
}

export interface ForgeReviewApi {
  readonly capabilities: () => Promise<ForgeReviewCapabilities>;
  readonly list: (input: ForgeReviewListInput) => Promise<ForgeReviewListResult>;
  readonly detail: (input: ForgeReviewDetailInput) => Promise<ForgeReviewDetail>;
  readonly diff: (input: ForgeReviewDiffInput) => Promise<ForgeReviewDiffResult>;
  readonly reviewWithOmp: (input: ForgeReviewOmpInput) => Promise<ForgeReviewOmpResult>;
  readonly ask: (input: ForgeReviewOmpInput) => Promise<ForgeReviewOmpResult>;
  readonly workflow: (input: ForgeReviewWorkflowRequest) => Promise<ForgeReviewWorkflowResult>;
  readonly mutate: (input: ForgeReviewMutationRequest) => Promise<ForgeReviewMutationResult>;
  readonly readInstructions: (projectId: ProjectId) => Promise<ForgeReviewInstructions>;
  readonly writeInstructions: (input: ForgeReviewInstructionsWriteInput) => Promise<ForgeReviewInstructions>;
  readonly readTaskAssociation: (input: ForgeReviewTaskAssociationInput) => Promise<ForgeReviewTaskAssociation | null>;
  readonly writeTaskAssociation: (input: ForgeReviewTaskAssociationWriteInput) => Promise<ForgeReviewTaskAssociation>;
  /** Inline review comments have their own PR-snapshot CAS record. */
  readonly inlineDrafts: ForgeReviewInlineDraftApi;
  readonly readTaskResult?: (threadId: string) => Promise<ForgeReviewTaskResult>;
  readonly drafts: ForgeReviewDraftApi;
}

type CediaNamespace = { readonly forgeReview?: ForgeReviewApi };

/** Resolve only the Cedia Forge Review bridge. There is no fallback to Synara pullRequests. */
export function getForgeReviewApi(): ForgeReviewApi {
  const cedia = (ensureNativeApi() as unknown as { readonly cedia?: CediaNamespace }).cedia;
  const api = cedia?.forgeReview;
  if (!api) {
    throw new Error("Code Review is unavailable until the Cedia forge bridge is connected.");
  }
  return api;
}

export const forgeReviewQueryKeys = {
  all: ["cedia", "forge-review"] as const,
  capabilities: () => ["cedia", "forge-review", "capabilities"] as const,
  list: (input: ForgeReviewListInput) =>
    [
      "cedia",
      "forge-review",
      "list",
      input.projectId,
      input.provider ?? null,
      input.state ?? "open",
      input.bucket ?? "all",
      input.team ?? null,
      input.url ?? null,
      input.cursor ?? null,
    ] as const,
  detail: (input: ForgeReviewDetailInput | null) =>
    ["cedia", "forge-review", "detail", input?.projectId ?? null, input?.url ?? null] as const,
  diff: (input: ForgeReviewDiffInput | null) =>
    [
      "cedia",
      "forge-review",
      "diff",
      input?.projectId ?? null,
      input?.url ?? null,
      input?.headSha ?? null,
      input?.baseSha ?? null,
    ] as const,
  workflow: (input: ForgeReviewWorkflowRequest | null) =>
    [
      "cedia",
      "forge-review",
      "workflow",
      input?.projectId ?? null,
      input?.url ?? null,
      input?.section ?? null,
      input?.cursor ?? null,
    ] as const,
  task: (identity: string) => ["cedia", "forge-review", "task", identity] as const,
};

export function formatForgeReviewState(review: Pick<ForgeReviewSummary, "state" | "draft">): string {
  if (review.state === "open" && review.draft) return "Draft";
  return review.state === "open" ? "Open" : review.state === "merged" ? "Merged" : "Closed";
}

export function formatForgeReviewCount(value: number | null | undefined, empty = "—"): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : empty;
}

export function formatForgeReviewTimestamp(value: string | null | undefined): string {
  if (!value) return "Unknown date";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Unknown date";
  const delta = Date.now() - parsed;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta >= 0 && delta < minute) return "just now";
  if (delta >= 0 && delta < hour) return `${Math.max(1, Math.floor(delta / minute))}m ago`;
  if (delta >= 0 && delta < day) return `${Math.max(1, Math.floor(delta / hour))}h ago`;
  if (delta >= 0 && delta < 30 * day) return `${Math.max(1, Math.floor(delta / day))}d ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(parsed);
}

export function formatForgeReviewError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Code Review data is unavailable right now.";
}
