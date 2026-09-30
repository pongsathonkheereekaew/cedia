// FILE: CediaContextSurface.tsx
// Purpose: Show runtime-owned context usage and the maintenance controls above the composer.
// Layer: Chat composer UI

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { copyTextToClipboard } from "../../hooks/useCopyToClipboard";
import { ContextCompactionIcon, CopyIcon, HistoryIcon } from "~/lib/icons";
import { newCommandId } from "~/lib/utils";
import { Button } from "../ui/button";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  serverContextAbortCompactionMutationOptions,
  serverContextDropImagesMutationOptions,
  serverContextShakeMutationOptions,
  serverContextQueryOptions,
  serverHistoryClearMutationOptions,
  serverHistoryFreshMutationOptions,
  serverHistoryQueryOptions,
  serverHistoryTranscriptQueryOptions,
  serverMemoryMutationOptions,
  serverMemoryQueryOptions,
  type CediaContextAnswer,
  type CediaContextShakeMode,
  type CediaContextShakeResult,
  type CediaContextUsage,
  type CediaHistoryAnswer,
  type CediaMemoryBackend,
  type CediaMemoryAnswer,
  type CediaMnemopiState,
  type CediaHindsightState,
  type CediaTranscriptAnswer,
} from "../../lib/serverReactQuery";

function errorMessage(error: unknown, fallback = "The Cedia context runtime is unavailable."): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return fallback;
  }
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && code.trim().length > 0
    ? `${error.message} (${code})`
    : error.message;
}

function tokenCount(value: number): string {
  return value.toLocaleString("en-US");
}

function UsageSummary({ usage }: { readonly usage: CediaContextUsage }) {
  return (
    <section aria-label="Context usage" className="space-y-1.5">
      <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>{tokenCount(usage.usedTokens)} / {tokenCount(usage.contextWindow)} tokens</span>
        <span>{usage.anchored ? "Anchored context window" : "Default context window"}</span>
      </div>
      <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
        <span>Prompt: {tokenCount(usage.systemPromptTokens)}</span>
        <span>Tools: {tokenCount(usage.systemToolsTokens)}</span>
        <span>Context: {tokenCount(usage.systemContextTokens)}</span>
        <span>Skills: {tokenCount(usage.skillsTokens)}</span>
        <span>Messages: {tokenCount(usage.messagesTokens)}</span>
      </div>
    </section>
  );
}

function removedLabel(removed: number): string {
  return removed === 0
    ? "No images to remove"
    : `${removed} image${removed === 1 ? "" : "s"} removed`;
}

function shakeModeLabel(mode: CediaContextShakeMode): string {
  switch (mode) {
    case "elide": return "Elide tool results";
    case "images": return "Reduce images";
    case "thinking": return "Reduce thinking blocks";
  }
}

function shakeCount(value: number | undefined): string {
  return value === undefined ? "not reported" : tokenCount(value);
}

function shakeHasNoReduction(result: CediaContextShakeResult): boolean {
  return result.toolResultsDropped === 0 &&
    result.blocksDropped === 0 &&
    (result.imagesDropped === undefined || result.imagesDropped === 0) &&
    (result.thinkingBlocksDropped === undefined || result.thinkingBlocksDropped === 0) &&
    result.tokensFreed === 0;
}

function shakeResultLabel(result: CediaContextShakeResult): string {
  return shakeHasNoReduction(result)
    ? `Nothing to reduce with ${shakeModeLabel(result.mode).toLowerCase()}`
    : `Strategy: ${shakeModeLabel(result.mode)}`;
}

function memoryBackendLabel(backend: CediaMemoryBackend): string {
  switch (backend) {
    case "off": return "Off";
    case "local": return "Local";
    case "hindsight": return "Hindsight";
    case "mnemopi": return "Mnemopi";
    case "sharpshooter": return "Sharpshooter";
  }
}

function memoryCount(value: number): string {
  return value.toLocaleString("en-US");
}

function recallState(value: boolean): string {
  return value ? "happened" : "not yet";
}

function MnemopiState({ state }: { readonly state: CediaMnemopiState }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground" aria-label="Mnemopi runtime state">
      <span>Last retained turn: {memoryCount(state.lastRetainedTurn)}</span>
      <span>First-turn recall: {recallState(state.hasRecalledForFirstTurn)}</span>
      <span>Recall targets: {memoryCount(state.recallTargets)}</span>
      <span>Global target: {state.hasGlobalTarget ? "present" : "absent"}</span>
    </div>
  );
}

function HindsightState({ state }: { readonly state: CediaHindsightState }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground" aria-label="Hindsight runtime state">
      <span>Bank: {state.bankId}</span>
      <span>Banks: {memoryCount(state.banksSet)}</span>
      <span>Retain tags: {memoryCount(state.retainTags)}</span>
      <span>Recall tags: {memoryCount(state.recallTags)}</span>
      <span>Tag match: {state.recallTagsMatch ?? "not reported"}</span>
      <span>Last retained turn: {memoryCount(state.lastRetainedTurn)}</span>
      <span>First-turn recall: {recallState(state.hasRecalledForFirstTurn)}</span>
    </div>
  );
}

function MemorySection({
  state,
  busy,
  error,
  onApply,
}: {
  readonly state: CediaMemoryAnswer | null | undefined;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onApply?: () => void;
}) {
  if (!state) return null;
  if (state.state === "unavailable") {
    return (
      <section aria-label="Memory" className="space-y-1.5 border-t border-border/60 pt-2">
        <p role="alert" className="text-[11px] leading-relaxed text-muted-foreground">{state.reason}</p>
      </section>
    );
  }

  const detail = state.mnemopi || state.hindsight ? (
    <div className="space-y-1.5">
      {state.mnemopi ? <MnemopiState state={state.mnemopi} /> : null}
      {state.hindsight ? <HindsightState state={state.hindsight} /> : null}
    </div>
  ) : (
    <p className="text-[11px] leading-relaxed text-muted-foreground">The runtime reports no live memory state.</p>
  );
  return (
    <section aria-label="Memory" className="space-y-1.5 border-t border-border/60 pt-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-[12px] font-medium text-foreground/85">Memory</span>
          <span className="text-[11px] text-muted-foreground">Runtime backend: {memoryBackendLabel(state.backend)}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={onApply ?? (() => undefined)}
          aria-label="Re-apply the selected memory backend to this session"
        >
          Apply backend
        </Button>
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Re-applies the selected backend to this session. Change the backend in OMP settings.
      </p>
      {state.applied ? (
        <p role="status" className="text-[11px] leading-relaxed text-muted-foreground">Backend applied to this session.</p>
      ) : null}
      <section aria-label="Runtime memory state">{detail}</section>
      {error ? <p role="alert" className="text-[11px] leading-relaxed text-destructive">{error}</p> : null}
    </section>
  );
}

function HistorySection({
  history,
  transcript,
  contextBusy,
  historyBusy,
  transcriptBusy,
  clearBusy,
  freshBusy,
  clearConfirmationPending,
  freshConfirmationPending,
  historyError,
  transcriptError,
  transcriptNotice,
  onReadHistory,
  onCopyTranscript,
  onClearContext,
  onFreshSession,
}: {
  readonly history: CediaHistoryAnswer | null | undefined;
  readonly transcript: CediaTranscriptAnswer | null | undefined;
  readonly contextBusy: boolean;
  readonly historyBusy: boolean;
  readonly transcriptBusy: boolean;
  readonly clearBusy: boolean;
  readonly freshBusy: boolean;
  readonly clearConfirmationPending: boolean;
  readonly freshConfirmationPending: boolean;
  readonly historyError: string | null;
  readonly transcriptError: string | null;
  readonly transcriptNotice: string | null;
  readonly onReadHistory?: () => void;
  readonly onCopyTranscript?: () => void;
  readonly onClearContext?: () => void;
  readonly onFreshSession?: () => void;
}) {
  const destructiveBusy = contextBusy || historyBusy || clearBusy || freshBusy;
  return (
    <section aria-label="History" className="space-y-1.5 border-t border-border/60 pt-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <HistoryIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[12px] font-medium text-foreground/85">History</span>
          <span className="text-[10px] text-muted-foreground">Runtime checkpoint and rewind facts</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={historyBusy}
          onClick={onReadHistory ?? (() => undefined)}
          aria-label={history ? "Refresh session history" : "Read session history"}
        >
          {historyBusy ? "Reading…" : history ? "Refresh history" : "Read history"}
        </Button>
      </div>

      {!history ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">History has not been read yet.</p>
      ) : history.state === "unavailable" ? (
        <p role="alert" className="text-[11px] leading-relaxed text-muted-foreground">{history.reason}</p>
      ) : (
        <div className="space-y-1.5">
          {history.checkpoint ? (
            <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              <span>Checkpoint: {tokenCount(history.checkpoint.messageCount)} messages</span>
              <span>Started: {history.checkpoint.startedAt}</span>
            </div>
          ) : null}
          {history.lastRewind ? (
            <div className="space-y-0.5 text-[11px] text-muted-foreground">
              <p>Last rewind completed: {history.lastRewind.rewoundAt}</p>
              <p>{history.lastRewind.report}</p>
              {history.lastRewind.reportTruncated ? (
                <p>This rewind report was truncated by the runtime.</p>
              ) : null}
            </div>
          ) : null}
          {!history.checkpoint && !history.lastRewind ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">No checkpoint or rewind has been recorded yet.</p>
          ) : null}
        </div>
      )}

      <div className="flex min-w-0 flex-wrap gap-1">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={destructiveBusy}
          onClick={onClearContext ?? (() => undefined)}
          aria-label={clearConfirmationPending ? "Confirm clearing context" : "Clear context"}
        >
          {clearConfirmationPending ? "Confirm clear" : "Clear context"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={destructiveBusy}
          onClick={onFreshSession ?? (() => undefined)}
          aria-label={freshConfirmationPending ? "Confirm rotating provider state" : "Rotate provider state"}
        >
          {freshConfirmationPending ? "Confirm rotate" : "Rotate provider state"}
        </Button>
      </div>
      {clearConfirmationPending ? (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Clear context clears the conversation context in place while keeping this session/task. History stays recoverable through the runtime&apos;s own reset boundary. Click Confirm clear to continue.
        </p>
      ) : null}
      {freshConfirmationPending ? (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Rotate provider state starts a fresh provider session for this same task. Click Confirm rotate to continue.
        </p>
      ) : null}
      {historyError ? <p role="alert" className="text-[11px] leading-relaxed text-destructive">{historyError}</p> : null}

      <section aria-label="Session transcript" className="space-y-1.5 border-t border-border/60 pt-2">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="text-[12px] font-medium text-foreground/85">Transcript</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={transcriptBusy}
            onClick={onCopyTranscript ?? (() => undefined)}
            aria-label="Copy session transcript"
          >
            <CopyIcon className="size-3" />
            {transcriptBusy ? "Reading…" : "Copy transcript"}
          </Button>
        </div>
        {!transcript ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">Transcript will be read from the runtime when you copy it.</p>
        ) : transcript.state === "unavailable" ? (
          <p role="alert" className="text-[11px] leading-relaxed text-muted-foreground">{transcript.reason}</p>
        ) : (
          <>
            {transcript.truncated ? (
              <p className="text-[10px] leading-relaxed text-muted-foreground">The runtime marked this transcript as truncated; the copied text may be partial.</p>
            ) : null}
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/50 p-1.5 text-[10px] leading-relaxed text-foreground/80">{transcript.text}</pre>
            <p className="text-[10px] text-muted-foreground">{tokenCount(transcript.bytes)} bytes</p>
          </>
        )}
        {transcriptNotice ? <p role="status" className="text-[11px] leading-relaxed text-muted-foreground">{transcriptNotice}</p> : null}
        {transcriptError ? <p role="alert" className="text-[11px] leading-relaxed text-destructive">{transcriptError}</p> : null}
      </section>
    </section>
  );
}

export interface CediaContextPanelProps {
  readonly state: CediaContextAnswer | null;
  readonly memory?: CediaMemoryAnswer | null;
  readonly history?: CediaHistoryAnswer | null;
  readonly transcript?: CediaTranscriptAnswer | null;
  readonly removedImages?: number | null;
  readonly dropConfirmationPending?: boolean;
  readonly shakeResult?: CediaContextShakeResult | null;
  readonly shakeConfirmationPending?: boolean;
  readonly shakeConfirmationMode?: CediaContextShakeMode | null;
  readonly busy?: boolean;
  readonly memoryBusy?: boolean;
  readonly historyBusy?: boolean;
  readonly transcriptBusy?: boolean;
  readonly clearBusy?: boolean;
  readonly freshBusy?: boolean;
  readonly clearConfirmationPending?: boolean;
  readonly freshConfirmationPending?: boolean;
  readonly cancelError?: string | null;
  readonly dropError?: string | null;
  readonly shakeError?: string | null;
  readonly memoryError?: string | null;
  readonly historyError?: string | null;
  readonly transcriptError?: string | null;
  readonly transcriptNotice?: string | null;
  readonly onCancelCompaction?: () => void;
  readonly onDropImages?: () => void;
  readonly onReduceContext?: (mode: CediaContextShakeMode) => void;
  readonly onApplyMemory?: () => void;
  readonly onReadHistory?: () => void;
  readonly onCopyTranscript?: () => void;
  readonly onClearContext?: () => void;
  readonly onFreshSession?: () => void;
}

/** Pure context rendering used by the hook-backed surface and renderer tests. */
export function CediaContextPanel({
  state,
  memory = null,
  history = null,
  transcript = null,
  removedImages = null,
  dropConfirmationPending = false,
  shakeResult = null,
  shakeConfirmationPending = false,
  shakeConfirmationMode = null,
  busy = false,
  memoryBusy = false,
  historyBusy = false,
  transcriptBusy = false,
  clearBusy = false,
  freshBusy = false,
  clearConfirmationPending = false,
  freshConfirmationPending = false,
  cancelError = null,
  dropError = null,
  shakeError = null,
  memoryError = null,
  historyError = null,
  transcriptError = null,
  transcriptNotice = null,
  onCancelCompaction,
  onDropImages,
  onReduceContext,
  onApplyMemory,
  onReadHistory,
  onCopyTranscript,
  onClearContext,
  onFreshSession,
}: CediaContextPanelProps) {
  if (state?.state === "unavailable") {
    return (
      <ComposerStackedPanel
        data-testid="cedia-context-surface"
        aria-label="Cedia context"
        className="px-2.5 py-2"
      >
        <p role="alert" className="text-[11px] leading-relaxed text-muted-foreground">{state.reason}</p>
      </ComposerStackedPanel>
    );
  }

  if (!state) return null;

  const shownRemovedImages = removedImages ?? (state.state === "available" ? state.removed : undefined);
  const shownShake = shakeResult ?? (state.state === "available" ? state.shake : undefined);
  const shakeModes: readonly CediaContextShakeMode[] = ["elide", "images", "thinking"];
  return (
    <ComposerStackedPanel
      data-testid="cedia-context-surface"
      aria-label="Cedia context"
      className="space-y-2 px-2.5 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <ContextCompactionIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[12px] font-medium text-foreground/85">Context</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {state.compacting ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={onCancelCompaction ?? (() => undefined)}
              aria-label="Cancel compaction"
            >
              Cancel compaction
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={onDropImages ?? (() => undefined)}
            aria-label={dropConfirmationPending ? "Confirm dropping images" : "Drop images"}
          >
            {dropConfirmationPending ? "Confirm drop" : "Drop images"}
          </Button>
        </div>
      </div>

      <section aria-label="Reduce context" className="space-y-1.5 border-t border-border/60 pt-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[12px] font-medium text-foreground/85">Reduce context</span>
          <span className="text-[10px] text-muted-foreground">Choose a runtime strategy</span>
        </div>
        <div className="flex min-w-0 flex-wrap gap-1">
          {shakeModes.map((mode) => {
            const confirmation = shakeConfirmationPending && shakeConfirmationMode === mode;
            return (
              <Button
                key={mode}
                type="button"
                variant="ghost"
                size="xs"
                disabled={busy}
                onClick={() => onReduceContext?.(mode)}
                aria-label={confirmation ? `Confirm reduce context using ${shakeModeLabel(mode)}` : `Reduce context using ${shakeModeLabel(mode)}`}
              >
                {confirmation ? "Confirm reduce" : shakeModeLabel(mode)}
              </Button>
            );
          })}
        </div>
        {shakeConfirmationPending && shakeConfirmationMode ? (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Reducing {shakeModeLabel(shakeConfirmationMode).toLowerCase()} rewrites the stored transcript. Click Confirm reduce to continue.
          </p>
        ) : null}
      </section>

      {state.usage ? (
        <UsageSummary usage={state.usage} />
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">Context size not available</p>
      )}

      <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground" aria-label="Context maintenance">
        <span>Compaction: {state.compacting ? "active" : "idle"}</span>
        <span>Speculation: {state.speculation}</span>
      </div>

      {dropConfirmationPending ? (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Dropping images rewrites the stored transcript. Click Confirm drop to continue.
        </p>
      ) : null}
      {shownRemovedImages !== null && shownRemovedImages !== undefined ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground" role="status">
          {removedLabel(shownRemovedImages)}
        </p>
      ) : null}
      {shownShake ? (
        <section aria-label="Context reduction result" className="space-y-1 border-t border-border/60 pt-2" role="status">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{shakeResultLabel(shownShake)}</p>
          <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
            <span>Tool results dropped: {tokenCount(shownShake.toolResultsDropped)}</span>
            <span>Blocks dropped: {tokenCount(shownShake.blocksDropped)}</span>
            <span>Images dropped: {shakeCount(shownShake.imagesDropped)}</span>
            <span>Thinking blocks dropped: {shakeCount(shownShake.thinkingBlocksDropped)}</span>
            <span>Tokens reclaimed: {tokenCount(shownShake.tokensFreed)}</span>
          </div>
          {shownShake.artifactId ? (
            <p className="text-[10px] leading-relaxed text-muted-foreground">Artifact: {shownShake.artifactId}</p>
          ) : null}
        </section>
      ) : null}
      {cancelError ? <p role="alert" className="text-[11px] leading-relaxed text-destructive">{cancelError}</p> : null}
      {dropError ? <p role="alert" className="text-[11px] leading-relaxed text-destructive">{dropError}</p> : null}
      {shakeError ? <p role="alert" className="text-[11px] leading-relaxed text-destructive">{shakeError}</p> : null}
      <HistorySection
        history={history}
        transcript={transcript}
        contextBusy={busy}
        historyBusy={historyBusy}
        transcriptBusy={transcriptBusy}
        clearBusy={clearBusy}
        freshBusy={freshBusy}
        clearConfirmationPending={clearConfirmationPending}
        freshConfirmationPending={freshConfirmationPending}
        historyError={historyError}
        transcriptError={transcriptError}
        transcriptNotice={transcriptNotice}
        onReadHistory={onReadHistory}
        onCopyTranscript={onCopyTranscript}
        onClearContext={onClearContext}
        onFreshSession={onFreshSession}
      />
      <MemorySection state={memory} busy={busy || memoryBusy} error={memoryError} onApply={onApplyMemory} />
    </ComposerStackedPanel>
  );
}

export function CediaContextSurface({ sessionId }: { readonly sessionId: string }) {
  const queryClient = useQueryClient();
  const contextQuery = useQuery(serverContextQueryOptions(sessionId, sessionId.length > 0));
  const memoryQuery = useQuery(serverMemoryQueryOptions(sessionId, sessionId.length > 0));
  const historyQuery = useQuery(serverHistoryQueryOptions(sessionId, false));
  const transcriptQuery = useQuery(serverHistoryTranscriptQueryOptions(sessionId, false));
  const dropMutation = useMutation(serverContextDropImagesMutationOptions({ sessionId, queryClient }));
  const shakeMutation = useMutation(serverContextShakeMutationOptions({ sessionId, queryClient }));
  const cancelMutation = useMutation(serverContextAbortCompactionMutationOptions({ sessionId, queryClient }));
  const memoryMutation = useMutation(serverMemoryMutationOptions({ sessionId, queryClient }));
  const clearMutation = useMutation(serverHistoryClearMutationOptions({ sessionId, queryClient }));
  const freshMutation = useMutation(serverHistoryFreshMutationOptions({ sessionId, queryClient }));
  const [dropConfirmationPending, setDropConfirmationPending] = useState(false);
  const [removedImages, setRemovedImages] = useState<number | null>(null);
  const [shakeConfirmationMode, setShakeConfirmationMode] = useState<CediaContextShakeMode | null>(null);
  const [shakeResult, setShakeResult] = useState<CediaContextShakeResult | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [shakeError, setShakeError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [historyRequested, setHistoryRequested] = useState(false);
  const [transcriptRequested, setTranscriptRequested] = useState(false);
  const [clearConfirmationPending, setClearConfirmationPending] = useState(false);
  const [freshConfirmationPending, setFreshConfirmationPending] = useState(false);
  const [historyActionError, setHistoryActionError] = useState<string | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [transcriptNotice, setTranscriptNotice] = useState<string | null>(null);

  const onCancelCompaction = useCallback(() => {
    const state = contextQuery.data;
    if (cancelMutation.isPending || dropMutation.isPending || shakeMutation.isPending || state?.state !== "available" || !state.compacting) return;
    setCancelError(null);
    void cancelMutation.mutateAsync({ commandId: newCommandId() }).catch((error) => {
      setCancelError(errorMessage(error));
    });
  }, [cancelMutation, contextQuery.data, dropMutation.isPending, shakeMutation.isPending]);

  const onDropImages = useCallback(() => {
    if (dropMutation.isPending || cancelMutation.isPending || shakeMutation.isPending) return;
    if (!dropConfirmationPending) {
      setDropConfirmationPending(true);
      return;
    }
    setDropConfirmationPending(false);
    setRemovedImages(null);
    setDropError(null);
    void dropMutation.mutateAsync({ commandId: newCommandId() })
      .then((answer) => {
        if (answer.state === "available") setRemovedImages(answer.removed ?? 0);
        else setDropError(answer.reason);
      })
      .catch((error) => {
        setDropError(errorMessage(error));
      });
  }, [cancelMutation.isPending, dropConfirmationPending, dropMutation, shakeMutation.isPending]);

  const onReduceContext = useCallback((mode: CediaContextShakeMode) => {
    if (shakeMutation.isPending || dropMutation.isPending || cancelMutation.isPending) return;
    if (shakeConfirmationMode !== mode) {
      setShakeConfirmationMode(mode);
      return;
    }
    setShakeConfirmationMode(null);
    setShakeResult(null);
    setShakeError(null);
    void shakeMutation.mutateAsync({ commandId: newCommandId(), mode })
      .then((answer) => {
        if (answer.state === "available" && answer.shake) setShakeResult(answer.shake);
        else if (answer.state === "unavailable") setShakeError(answer.reason);
      })
      .catch((error) => {
        setShakeError(errorMessage(error));
      });
  }, [cancelMutation.isPending, dropMutation.isPending, shakeConfirmationMode, shakeMutation]);

  const onApplyMemory = useCallback(() => {
    if (memoryMutation.isPending) return;
    void memoryMutation.mutateAsync({ commandId: newCommandId() }).catch(() => undefined);
  }, [memoryMutation]);

  const onReadHistory = useCallback(() => {
    if (historyQuery.isFetching) return;
    setHistoryRequested(true);
    setHistoryActionError(null);
    void historyQuery.refetch().catch((error) => {
      setHistoryActionError(errorMessage(error, "The Cedia history runtime is unavailable."));
    });
  }, [historyQuery]);

  const onCopyTranscript = useCallback(() => {
    if (transcriptQuery.isFetching) return;
    setTranscriptRequested(true);
    setTranscriptError(null);
    setTranscriptNotice(null);
    void transcriptQuery.refetch()
      .then(async (result) => {
        if (result.error) {
          setTranscriptError(errorMessage(result.error, "The session transcript is unavailable."));
          return;
        }
        const answer = result.data;
        if (!answer) return;
        if (answer.state === "unavailable") {
          setTranscriptError(answer.reason);
          return;
        }
        await copyTextToClipboard(answer.text);
        setTranscriptNotice(answer.truncated
          ? "Transcript copied. The runtime marked it truncated, so the copied text may be partial."
          : "Transcript copied.");
      })
      .catch((error) => {
        setTranscriptError(errorMessage(error, "The session transcript could not be copied."));
      });
  }, [transcriptQuery]);

  const refreshAfterHistoryMutation = useCallback(async () => {
    setHistoryRequested(true);
    await Promise.all([historyQuery.refetch(), contextQuery.refetch()]);
  }, [contextQuery, historyQuery]);

  const onClearContext = useCallback(() => {
    if (clearMutation.isPending || freshMutation.isPending) return;
    if (!clearConfirmationPending) {
      setClearConfirmationPending(true);
      setFreshConfirmationPending(false);
      return;
    }
    setClearConfirmationPending(false);
    setHistoryActionError(null);
    void clearMutation.mutateAsync({ commandId: newCommandId() })
      .then(refreshAfterHistoryMutation)
      .catch((error) => {
        setHistoryActionError(errorMessage(error, "The Cedia context runtime is unavailable."));
      });
  }, [clearConfirmationPending, clearMutation, freshMutation.isPending, refreshAfterHistoryMutation]);

  const onFreshSession = useCallback(() => {
    if (clearMutation.isPending || freshMutation.isPending) return;
    if (!freshConfirmationPending) {
      setFreshConfirmationPending(true);
      setClearConfirmationPending(false);
      return;
    }
    setFreshConfirmationPending(false);
    setHistoryActionError(null);
    void freshMutation.mutateAsync({ commandId: newCommandId() })
      .then(refreshAfterHistoryMutation)
      .catch((error) => {
        setHistoryActionError(errorMessage(error, "The Cedia provider session could not be rotated."));
      });
  }, [clearMutation, freshConfirmationPending, freshMutation, refreshAfterHistoryMutation]);

  const state = contextQuery.data ?? (contextQuery.isError
    ? { state: "unavailable" as const, reason: errorMessage(contextQuery.error) }
    : null);
  const memory = memoryQuery.data ?? (memoryQuery.isError
    ? { state: "unavailable" as const, reason: errorMessage(memoryQuery.error, "The Cedia memory runtime is unavailable.") }
    : null);
  const history = historyRequested
    ? historyQuery.data ?? (historyQuery.isError
      ? { state: "unavailable" as const, reason: errorMessage(historyQuery.error, "The Cedia history runtime is unavailable.") }
      : null)
    : null;
  const transcript = transcriptRequested
    ? transcriptQuery.data ?? (transcriptQuery.isError
      ? { state: "unavailable" as const, reason: errorMessage(transcriptQuery.error, "The session transcript is unavailable.") }
      : null)
    : null;
  const busy = dropMutation.isPending || shakeMutation.isPending || cancelMutation.isPending;
  return (
    <CediaContextPanel
      state={state}
      memory={memory}
      history={history}
      transcript={transcript}
      removedImages={removedImages}
      dropConfirmationPending={dropConfirmationPending}
      shakeResult={shakeResult}
      shakeConfirmationPending={shakeConfirmationMode !== null}
      shakeConfirmationMode={shakeConfirmationMode}
      busy={busy}
      memoryBusy={memoryMutation.isPending}
      historyBusy={historyQuery.isFetching}
      transcriptBusy={transcriptQuery.isFetching}
      clearBusy={clearMutation.isPending}
      freshBusy={freshMutation.isPending}
      clearConfirmationPending={clearConfirmationPending}
      freshConfirmationPending={freshConfirmationPending}
      cancelError={cancelError}
      dropError={dropError}
      shakeError={shakeError}
      memoryError={memoryMutation.isError ? errorMessage(memoryMutation.error, "The Cedia memory runtime is unavailable.") : null}
      historyError={historyActionError}
      transcriptError={transcriptError}
      transcriptNotice={transcriptNotice}
      onCancelCompaction={onCancelCompaction}
      onDropImages={onDropImages}
      onReduceContext={onReduceContext}
      onApplyMemory={onApplyMemory}
      onReadHistory={onReadHistory}
      onCopyTranscript={onCopyTranscript}
      onClearContext={onClearContext}
      onFreshSession={onFreshSession}
    />
  );
}
