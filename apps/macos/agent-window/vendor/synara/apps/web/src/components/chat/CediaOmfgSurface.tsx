// FILE: CediaOmfgSurface.tsx
// Purpose: Forge a TTSR rule from a complaint: draft a candidate over an ephemeral turn,
//          review the bounded draft, and save it into the project or global rules directory
//          where the runtime registers it live. Both guards default to refusal, like the
//          terminal's overwrite and save-anyway confirms.
// Layer: Chat composer UI

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { BookIcon } from "~/lib/icons";
import { newCommandId } from "~/lib/utils";
import { Button } from "../ui/button";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  serverOmfgAbortMutationOptions,
  serverOmfgDraftMutationOptions,
  serverOmfgQueryOptions,
  serverOmfgSaveMutationOptions,
  type CediaOmfgAnswer,
} from "../../lib/serverReactQuery";

function errorMessage(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return "The Cedia rule-forging runtime is unavailable.";
  }
  return error.message;
}

export interface CediaOmfgPanelProps {
  readonly state: CediaOmfgAnswer | null;
  readonly complaint?: string;
  readonly drafting?: boolean;
  readonly saving?: boolean;
  readonly draftError?: string | null;
  readonly saveError?: string | null;
  readonly saved?: { readonly scope: string; readonly name: string; readonly path: string } | null;
  readonly scope?: "project" | "global";
  readonly overwrite?: boolean;
  readonly onComplaintChange?: (complaint: string) => void;
  readonly onScopeChange?: (scope: "project" | "global") => void;
  readonly onOverwriteChange?: (overwrite: boolean) => void;
  readonly onDraft?: () => void;
  readonly onAmend?: () => void;
  readonly onSave?: () => void;
  readonly onAbort?: () => void;
}

/** Pure rule-forging rendering used by the hook-backed surface and renderer tests. */
export function CediaOmfgPanel({
  state,
  complaint = "",
  drafting = false,
  saving = false,
  draftError = null,
  saveError = null,
  saved = null,
  scope = "project",
  overwrite = false,
  onComplaintChange,
  onScopeChange,
  onOverwriteChange,
  onDraft,
  onAmend,
  onSave,
  onAbort,
}: CediaOmfgPanelProps) {
  const busy = drafting || saving;
  const answer = state?.available === true ? state : null;
  const draftReady = answer !== null && answer.state === "ready" && answer.draft !== null;
  return (
    <ComposerStackedPanel
      data-testid="cedia-omfg-surface"
      aria-label="Rule forging"
      className="space-y-2 px-2.5 py-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <BookIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground/85">Forge rule</span>
        <span className="text-[10px] text-muted-foreground">
          draft from a complaint, save into the rules directory
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        <input
          type="text"
          value={complaint}
          disabled={busy}
          onChange={(event) => onComplaintChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onDraft?.();
          }}
          placeholder="What keeps going wrong…"
          aria-label="Rule complaint"
          className="min-w-0 flex-1 rounded-md border border-border/60 bg-background/50 px-2 py-1.5 text-[11px] text-foreground/85 outline-none placeholder:text-muted-foreground/70"
        />
        {drafting ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onAbort?.()}
            aria-label="Abort rule draft"
          >
            Abort
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy || complaint.trim().length === 0}
            onClick={() => onDraft?.()}
            aria-label="Draft rule"
          >
            Draft
          </Button>
        )}
      </div>

      {draftError ? (
        <p role="alert" className="text-[11px] leading-relaxed text-destructive">{draftError}</p>
      ) : null}

      {answer && answer.state !== "idle" ? (
        <div aria-label="Rule draft" className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
          {answer.state === "ready" && answer.draft !== null ? (
            <>
              <p className="text-[11px] font-medium text-foreground/85">
                {answer.ruleName ?? "Draft"}
                {answer.validated ? (
                  <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">validated</span>
                ) : (
                  <span className="ml-1.5 text-[10px] font-normal text-muted-foreground" title={answer.validationFeedback ?? undefined}>
                    unvalidated — saving needs opt-in
                  </span>
                )}
              </p>
              <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground/85">
                {answer.draft}
              </pre>
              {answer.draftTruncated ? (
                <p className="mt-0.5 text-[10px] text-muted-foreground">Draft truncated for review</p>
              ) : null}
              <div className="mt-1 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1">
                <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <select
                    aria-label="Rule save scope"
                    value={scope}
                    disabled={busy}
                    onChange={(event) => onScopeChange?.(event.target.value as "project" | "global")}
                    className="rounded-md border border-border/60 bg-background/50 px-1.5 py-1 text-[11px] text-foreground/85"
                  >
                    <option value="project">This project</option>
                    <option value="global">Global</option>
                  </select>
                </label>
                <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={overwrite}
                    disabled={busy}
                    onChange={(event) => onOverwriteChange?.(event.target.checked)}
                  />
                  Overwrite existing
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => onSave?.()}
                  aria-label="Save rule"
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={busy || complaint.trim().length === 0}
                  onClick={() => onAmend?.()}
                  aria-label="Amend rule with feedback"
                  title="Regenerate from this draft with the complaint above as feedback"
                >
                  Amend
                </Button>
              </div>
            </>
          ) : answer.state === "failed" ? (
            <p role="alert" className="mt-0.5 text-[11px] leading-relaxed text-destructive">
              {answer.reason ?? "The rule draft failed."}
            </p>
          ) : answer.state === "drafting" ? (
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">Drafting…</p>
          ) : null}
        </div>
      ) : null}

      {saved ? (
        <p role="status" className="text-[11px] leading-relaxed text-muted-foreground">
          Saved {saved.name} ({saved.scope}) — live now.
        </p>
      ) : null}
      {saveError ? (
        <p role="alert" className="text-[11px] leading-relaxed text-destructive">{saveError}</p>
      ) : null}
    </ComposerStackedPanel>
  );
}

export function CediaOmfgSurface({ sessionId }: { readonly sessionId: string }) {
  const queryClient = useQueryClient();
  const omfgQuery = useQuery(serverOmfgQueryOptions(sessionId, sessionId.length > 0));
  const draftMutation = useMutation(serverOmfgDraftMutationOptions({ sessionId, queryClient }));
  const saveMutation = useMutation(serverOmfgSaveMutationOptions({ sessionId, queryClient }));
  const abortMutation = useMutation(serverOmfgAbortMutationOptions({ sessionId, queryClient }));
  const [complaint, setComplaint] = useState("");
  const [scope, setScope] = useState<"project" | "global">("project");
  const [overwrite, setOverwrite] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ readonly scope: string; readonly name: string; readonly path: string } | null>(null);

  const pending = draftMutation.isPending || saveMutation.isPending || abortMutation.isPending;

  const onDraft = useCallback(async (feedback?: string) => {
    if (pending || complaint.trim().length === 0) return;
    setDraftError(null);
    setSaveError(null);
    setSaved(null);
    try {
      await draftMutation.mutateAsync(
        feedback === undefined
          ? { commandId: newCommandId(), complaint: complaint.trim() }
          : { commandId: newCommandId(), complaint: complaint.trim(), feedback },
      );
    } catch (error) {
      setDraftError(errorMessage(error));
    }
  }, [draftMutation, pending, complaint]);

  const onSave = useCallback(async () => {
    if (pending) return;
    setSaveError(null);
    try {
      const answer = await saveMutation.mutateAsync({ commandId: newCommandId(), scope, overwrite });
      setSaved({ scope: answer.scope, name: answer.name, path: answer.path });
      setComplaint("");
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  }, [saveMutation, pending, scope, overwrite]);

  const onAbort = useCallback(async () => {
    if (pending) return;
    setDraftError(null);
    try {
      await abortMutation.mutateAsync({ commandId: newCommandId() });
    } catch (error) {
      setDraftError(errorMessage(error));
    }
  }, [abortMutation, pending]);

  const state = omfgQuery.data ?? (omfgQuery.isError
    ? { available: false as const, reason: errorMessage(omfgQuery.error) }
    : null);
  // The draft answers the drafting state at once; the held candidate lands later and the
  // query above polls while it runs.
  const drafting = draftMutation.isPending || state?.available === true && state.state === "drafting";
  return (
    <CediaOmfgPanel
      state={state}
      complaint={complaint}
      drafting={drafting}
      saving={saveMutation.isPending}
      draftError={draftError}
      saveError={saveError}
      saved={saved}
      scope={scope}
      overwrite={overwrite}
      onComplaintChange={setComplaint}
      onScopeChange={setScope}
      onOverwriteChange={setOverwrite}
      onDraft={() => void onDraft()}
      onAmend={() => void onDraft(complaint.trim())}
      onSave={() => void onSave()}
      onAbort={() => void onAbort()}
    />
  );
}
