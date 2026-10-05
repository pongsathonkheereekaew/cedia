// FILE: AgentRunTimelineRow.tsx
// Purpose: Arc-style per-turn agent-run block: a disclosure header (state dot +
//          queue line + elapsed) that expands in place to the turn's tool-call
//          groups with a live tail, an approval-gate card before writes, and a
//          result fold with a Review action.
// Layer: Web chat presentation component
// Exports: AgentRunTimelineRow, AgentRunApprovalResponder, AgentRunResultSummary
// Depends on: ToolCallGroupSummaryRow/TimelineWorkEntryRow (fold precedent),
//          ComposerPendingApprovalPanel (approval card), ReviewChangesButton,
//          DisclosureRegion/DisclosureChevron (shared disclosure motion)

import { useId, useState, type ReactNode } from "react";
import type { ApprovalRequestId, ProviderApprovalDecision, TurnId } from "@synara/contracts";
import { pluralize } from "@synara/shared/text";
import { formatElapsed, type PendingApproval, type WorkLogEntry } from "../../session-logic";
import type { TimestampFormat } from "../../appSettings";
import { cn } from "~/lib/utils";
import { MUTED_LABEL_TEXT_CLASS_NAME } from "~/surfaceStyles";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";
import { ReviewChangesButton } from "./ReviewChangesButton";
import { ToolCallGroupSummaryRow } from "./ToolCallGroupSummaryRow";
import { prefersCompactWorkEntryRow, TimelineWorkEntryRow } from "./TimelineWorkEntryRow";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
import {
  capOpenWorkEntryRenderChunks,
  planWorkEntryRenderChunks,
  resolveWorkEntryChunkFold,
  type AgentRunState,
} from "./MessagesTimeline.logic";
/** Visible tool rows before the overflow folds; mirrors the transcript tail cap. */
const AGENT_RUN_MAX_VISIBLE_ENTRIES = 6;

export type AgentRunApprovalResponder = (
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  lifecycleGeneration?: string,
  requestKind?: PendingApproval["requestKind"],
) => Promise<void>;

export interface AgentRunResultSummary {
  filesChanged: number;
  onReview: () => void;
}

interface AgentRunTimelineRowProps {
  turnId: TurnId;
  state: AgentRunState;
  queueLine: string | null;
  workEntries: WorkLogEntry[];
  pendingApproval: PendingApproval | null;
  onRespondApproval?: AgentRunApprovalResponder | undefined;
  resultSummary: AgentRunResultSummary | null;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  /** An open run follows the newest call like ToolCallGroupSummaryRow's liveEntry. */
  followLive?: boolean;
  chatMetaFontSizePx: number;
  textFontSizePx?: number;
  markdownCwd: string | undefined;
  timestampFormat: TimestampFormat;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onOpenAgentActivity?: (activityId: string) => void;
  onOpenAutomation?: (automationId: string) => void;
}

const AGENT_RUN_STATE_LABEL: Record<AgentRunState, string> = {
  running: "running",
  settled: "finished",
  needs_continue: "needs continue",
  outcome_unknown: "outcome unknown",
};

function AgentRunStateDot({ state }: { state: AgentRunState }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        state === "running"
          ? "animate-pulse bg-primary"
          : state === "settled"
            ? "bg-muted-foreground/50"
            : "bg-destructive",
      )}
    />
  );
}

export function AgentRunTimelineRow(props: AgentRunTimelineRowProps) {
  const {
    turnId,
    state,
    queueLine,
    workEntries,
    pendingApproval,
    onRespondApproval,
    resultSummary,
    defaultOpen,
    open: openProp,
    onToggle,
    followLive,
    chatMetaFontSizePx,
    textFontSizePx: textFontSizePxProp,
    markdownCwd,
    timestampFormat,
    onImageExpand,
    onOpenAgentActivity,
    onOpenAutomation,
  } = props;
  const textFontSizePx = textFontSizePxProp ?? chatMetaFontSizePx;
  const regionId = useId();
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const open = openProp ?? internalOpen;
  const firstEntry = workEntries[0];
  const lastEntry = workEntries[workEntries.length - 1];
  // Settled runs measure first-to-last tool call; a live run measures from its
  // first call to now (a render-time snapshot that refreshes with streaming).
  const elapsedEnd = state === "running" ? new Date().toISOString() : lastEntry?.createdAt;
  const elapsed =
    firstEntry && elapsedEnd ? (formatElapsed(firstEntry.createdAt, elapsedEnd) ?? null) : null;
  // Manual open/closed overrides for the run's folded tool-group lines, mirroring
  // the transcript's toolGroupSummaryOverrides (whose meaning is "show rows past
  // the live cap" and must stay separate).
  const [toolGroupOverrides, setToolGroupOverrides] = useState<Record<string, boolean>>({});
  const [listExpanded, setListExpanded] = useState(false);
  const [approvalResponding, setApprovalResponding] = useState(false);

  const isLive = followLive === true || state === "running";
  const plannedChunks = planWorkEntryRenderChunks(workEntries, { tailIsLive: isLive });
  const cappedPlan = capOpenWorkEntryRenderChunks(plannedChunks, {
    expanded: listExpanded,
    maxVisibleEntries: AGENT_RUN_MAX_VISIBLE_ENTRIES,
    keep: "last",
  });


  const summaryLine = [
    `Agent run ${AGENT_RUN_STATE_LABEL[state]}`,
    `${workEntries.length} ${pluralize(workEntries.length, "step")}`,
    ...(queueLine ? [queueLine] : []),
    ...(elapsed ? [elapsed] : []),
    ...(pendingApproval ? ["waiting for approval"] : []),
    ...(resultSummary ? [`${resultSummary.filesChanged} ${pluralize(resultSummary.filesChanged, "file")} changed`] : []),
  ].join(" · ");

  const renderEntryRow = (workEntry: WorkLogEntry) => (
    <TimelineWorkEntryRow
      key={`agent-run-row:${workEntry.id}`}
      workEntry={workEntry}
      chatMetaFontSizePx={chatMetaFontSizePx}
      textFontSizePx={textFontSizePx}
      density={prefersCompactWorkEntryRow(workEntry) ? "compact" : "default"}
      markdownCwd={markdownCwd}
      onImageExpand={onImageExpand}
      timestampFormat={timestampFormat}
      {...(onOpenAgentActivity ? { onOpenAgentActivity } : {})}
      {...(onOpenAutomation ? { onOpenAutomation } : {})}
    />
  );

  const renderChunks = (): ReactNode => {
    if (workEntries.length === 0) {
      return (
        <p className={cn("px-0.5 py-1", MUTED_LABEL_TEXT_CLASS_NAME)}>
          {state === "running" ? "Starting…" : "No tool activity recorded for this run."}
        </p>
      );
    }
    return (
      <div>
        <div className="space-y-0.5">
          {cappedPlan.chunks.map((chunk) => {
            const fold = resolveWorkEntryChunkFold(chunk);
            if (!fold) return chunk.entries.map(renderEntryRow);
            const summaryKey = `agent-run:${turnId as string}:${chunk.id}${fold.keySuffix}`;
            return (
              <ToolCallGroupSummaryRow
                key={summaryKey}
                summary={fold.summary}
                liveEntry={chunk.liveEntry}
                open={toolGroupOverrides[summaryKey] ?? false}
                onToggle={(next) =>
                  setToolGroupOverrides((current) => ({ ...current, [summaryKey]: next }))
                }
                fontSizePx={textFontSizePx}
                renderChildren={() => (
                  <div className="space-y-0.5 pt-0.5">{fold.entries.map(renderEntryRow)}</div>
                )}
              />
            );
          })}
        </div>
        {cappedPlan.hasOverflow && (
          <div className="mt-1.5 flex items-center justify-start gap-2 px-0.5">
            <button
              type="button"
              className={cn(
                "font-system-ui transition-colors duration-150 hover:text-foreground",
                MUTED_LABEL_TEXT_CLASS_NAME,
              )}
              style={{ fontSize: `${chatMetaFontSizePx}px` }}
              onClick={() => setListExpanded(!listExpanded)}
            >
              {listExpanded ? "Show less" : `Show ${cappedPlan.hiddenEntryCount} more`}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <p role="status" aria-live="polite" className="sr-only">
        {summaryLine}
      </p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => (onToggle ? onToggle(!open) : setInternalOpen(!open))}
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 py-0.5 text-left transition-colors duration-200 hover:text-foreground",
          MUTED_LABEL_TEXT_CLASS_NAME,
        )}
        style={{ fontSize: `${textFontSizePx}px` }}
      >
        <AgentRunStateDot state={state} />
        <span className="min-w-0 truncate">
          Agent run
          {queueLine ? <span className="ml-1.5">{queueLine}</span> : null}
          {elapsed ? <span className="ml-1.5 tabular-nums">{elapsed}</span> : null}
        </span>
        <DisclosureChevron open={open} className="text-muted-foreground/70" />
      </button>
      <div id={regionId}>
        <DisclosureRegion open={open} contentClassName="space-y-1.5 pt-1 pb-0.5">
          {renderChunks()}
          {pendingApproval && onRespondApproval ? (
            <div className="pt-1">
              <ComposerPendingApprovalPanel
                approval={pendingApproval}
                pendingCount={1}
                isResponding={approvalResponding}
                onRespond={async (requestId, decision, lifecycleGeneration, requestKind) => {
                  setApprovalResponding(true);
                  try {
                    await onRespondApproval(requestId, decision, lifecycleGeneration, requestKind);
                  } finally {
                    setApprovalResponding(false);
                  }
                }}
              />
            </div>
          ) : null}
          {resultSummary ? (
            <div
              className={cn(
                "flex items-center justify-between gap-3 px-0.5 py-1",
                MUTED_LABEL_TEXT_CLASS_NAME,
              )}
              style={{ fontSize: `${textFontSizePx}px` }}
            >
              <span className="min-w-0 truncate">
                Edited {resultSummary.filesChanged}{" "}
                {pluralize(resultSummary.filesChanged, "file")}
              </span>
              <ReviewChangesButton
                style={{ fontSize: `${textFontSizePx}px` }}
                onClick={resultSummary.onReview}
              />
            </div>
          ) : null}
        </DisclosureRegion>
      </div>
    </div>
  );
}
