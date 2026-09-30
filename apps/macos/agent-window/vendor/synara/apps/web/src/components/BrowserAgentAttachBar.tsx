// FILE: BrowserAgentAttachBar.tsx
// Purpose: Explicit per-tab attach for OMP browser driving (plan §8.2 O10).
// Layer: Web UI component
//
// Attaching is the consent: the active tab's debugger opens on a per-thread loopback
// CDP endpoint and the runtime's browser.cdpUrl steers onto it, so OMP browser tools
// attach to this tab instead of launching a browser. Detaching all closes the endpoint
// and clears the steering. Nothing here touches user Chrome, profiles, or extensions.

import { useCallback, useEffect, useState } from "react";
import type { ThreadId } from "@synara/contracts";

import { ensureNativeApi, readNativeApi } from "~/nativeApi";
import { getOmpSettingsApi } from "../lib/ompSettingsReactQuery";
import { Button } from "./ui/button";

interface AttachStatus {
  readonly attached: boolean;
  readonly cdpUrl?: string;
  readonly tabs: readonly { readonly tabId: string; readonly url: string; readonly title: string }[];
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

/**
 * Names the steering conflict when the browser relay is on: OMP resolves relay
 * before cdpUrl, so an attached endpoint sits idle while driving goes to the user's
 * Chrome. Pure so the rule is pinned without a bridge.
 */
export function steeringConflictWarning(relayValue: unknown): string | null {
  if (relayValue !== true) return null;
  return "Browser relay is on and takes precedence over the agent endpoint: driving goes to your Chrome, not the attached tab.";
}

/**
 * Names the disabled-prelude loss: with the browser eval prelude off, OMP never
 * calls into any browser backend, so an attached endpoint waits for no one. Pure so
 * the rule is pinned without a bridge.
 */
export function browserDisabledWarning(enabledValue: unknown): string | null {
  if (enabledValue !== false) return null;
  return "Browser tools are disabled: OMP will not drive any browser until the Browser tool is enabled.";
}

export interface BrowserAgentAttachDeps {
  readonly agentAttach: (input: { threadId: ThreadId; tabId: string }) => Promise<{ cdpUrl: string; tabId: string }>;
  readonly agentDetach: (input: { threadId: ThreadId; tabId?: string }) => Promise<{ attached: boolean; cdpUrl?: string }>;
  readonly setBrowserCdpUrl: (cdpUrl: string) => Promise<unknown>;
  readonly confirm: (message: string) => Promise<boolean>;
  /** Prepended to the attach confirm when the UI already knows steering loses. */
  readonly confirmPreamble?: string;
}

/** Attach one tab and steer the runtime onto the endpoint; returns false when cancelled. */
export async function attachBrowserTabForAgent(
  deps: BrowserAgentAttachDeps,
  threadId: ThreadId,
  tabId: string,
): Promise<boolean> {
  const confirmed = await deps.confirm(
    `${deps.confirmPreamble ? `${deps.confirmPreamble} ` : ""}Attach this tab for agent driving? OMP browser tools will attach to it instead of launching a browser. Detach when done.`,
  );
  if (!confirmed) return false;
  const attached = await deps.agentAttach({ threadId, tabId });
  await deps.setBrowserCdpUrl(attached.cdpUrl);
  return true;
}

/** Detach all tabs, close the endpoint and clear steering; returns false when cancelled. */
export async function detachBrowserTabsForAgent(deps: BrowserAgentAttachDeps, threadId: ThreadId): Promise<boolean> {
  const confirmed = await deps.confirm(
    "Detach all tabs from agent driving? The endpoint closes and browser steering returns to default.",
  );
  if (!confirmed) return false;
  await deps.agentDetach({ threadId });
  await deps.setBrowserCdpUrl("");
  return true;
}

function liveDeps(confirmPreamble?: string): BrowserAgentAttachDeps {
  const native = ensureNativeApi();
  const browser = native.browser;
  if (typeof browser.agentAttach !== "function" || typeof browser.agentDetach !== "function") {
    throw new Error("Agent tab driving is unavailable in this window.");
  }
  const agentAttach = browser.agentAttach;
  const agentDetach = browser.agentDetach;
  return {
    agentAttach: (input) => agentAttach(input),
    agentDetach: (input) => agentDetach(input),
    setBrowserCdpUrl: (cdpUrl) => getOmpSettingsApi().setOmpSetting({ path: "browser.cdpUrl", value: cdpUrl }),
    confirm: (message) => native.dialogs.confirm(message),
    ...(confirmPreamble === undefined ? {} : { confirmPreamble }),
  };
}

export function BrowserAgentAttachBar({
  threadId,
  activeTabId,
}: {
  readonly threadId: ThreadId;
  readonly activeTabId: string | null;
}) {
  const bridge = readNativeApi();
  const capable =
    typeof bridge?.browser?.agentAttach === "function" &&
    typeof bridge?.browser?.agentDetach === "function" &&
    typeof bridge?.browser?.agentEndpoint === "function";
  const [status, setStatus] = useState<AttachStatus | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!capable) return;
    const agentEndpoint = ensureNativeApi().browser.agentEndpoint;
    if (typeof agentEndpoint !== "function") return;
    try {
      setStatus(await agentEndpoint({ threadId }));
    } catch (error_) {
      setError(describe(error_, "Agent driving status is unavailable."));
    }
    try {
      const api = getOmpSettingsApi();
      const [relay, enabled] = await Promise.all([
        api.getOmpSettingValue("browser.relay"),
        api.getOmpSettingValue("browser.enabled"),
      ]);
      const found: string[] = [];
      if (relay.state === "available") {
        const warning = steeringConflictWarning(relay.value);
        if (warning) found.push(warning);
      }
      if (enabled.state === "available") {
        const warning = browserDisabledWarning(enabled.value);
        if (warning) found.push(warning);
      }
      setWarnings(found);
    } catch {
      setWarnings([]);
    }
  }, [capable, threadId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onAttach = useCallback(async () => {
    if (!activeTabId || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await attachBrowserTabForAgent(liveDeps(warnings.length > 0 ? warnings.join(" ") : undefined), threadId, activeTabId)) await refresh();
    } catch (error_) {
      setError(describe(error_, "Attaching the tab for agent driving failed."));
    } finally {
      setBusy(false);
    }
  }, [activeTabId, busy, refresh, warnings, threadId]);

  const onDetachAll = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await detachBrowserTabsForAgent(liveDeps(), threadId)) await refresh();
    } catch (error_) {
      setError(describe(error_, "Detaching the tabs failed."));
    } finally {
      setBusy(false);
    }
  }, [busy, refresh, threadId]);

  if (!capable) return null;
  const count = status?.tabs.length ?? 0;
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-border/60 px-2 py-1" data-testid="browser-agent-attach">
      <span className="truncate text-[11px] text-muted-foreground">
        {status?.attached ? `Agent driving: ${count} tab${count === 1 ? "" : "s"}` : "Agent driving off"}
      </span>
      <div className="ml-auto flex shrink-0 gap-1">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy || !activeTabId}
          onClick={() => void onAttach()}
          aria-label="Attach active tab for agent driving"
        >
          {busy ? "Working…" : "Attach tab"}
        </Button>
        {status?.attached ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => void onDetachAll()}
            aria-label="Detach all tabs from agent driving"
          >
            Detach all
          </Button>
        ) : null}
      </div>
      {warnings.map((warning) => (
        <p key={warning} role="alert" className="text-[11px] leading-relaxed text-destructive">{warning}</p>
      ))}
      {error ? (
        <p role="alert" className="text-[11px] leading-relaxed text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
