// FILE: ProvidersSettingsPanel.tsx
// Purpose: Route the providers settings section to the OMP-owned surface. The
// generic multi-CLI installer workflow is gone: Cedia ships OMP as its only
// execution runtime, so provider install rows never mounted.
// Layer: Settings panel

import { ThreadId, type ProviderKind } from "@synara/contracts";
import { PROVIDER_DESCRIPTORS } from "@synara/shared/providerMetadata";
import { useMemo, useSyncExternalStore, type ReactNode } from "react";

import type { AppSettings, AppSettingsBinding } from "~/appSettings";
import { resolveCediaRuntimeSessionId } from "./CediaRuntimeProviderState";
import { OmpProviderSettingsPanel } from "./OmpProviderSettingsPanel";
import { readSidebarUiState, subscribeSidebarUiState } from "../Sidebar.uiState";
import {
  resolveSplitViewFocusedThreadId,
  selectSplitView,
  useSplitViewStore,
} from "../../splitViewStore";
import { useStore } from "../../store";
import { createThreadSelector } from "../../storeSelectors";


type ProviderInstallTextKey =
  | "claudeBinaryPath"
  | "codexBinaryPath"
  | "codexHomePath"
  | "cursorBinaryPath"
  | "cursorApiEndpoint"
  | "devinBinaryPath"
  | "antigravityBinaryPath"
  | "grokBinaryPath"
  | "droidBinaryPath"
  | "openCodeBinaryPath"
  | "openCodeServerUrl"
  | "piBinaryPath"
  | "piAgentDir";
type ProviderInstallPasswordKey = "openCodeServerPassword";
type ProviderInstallPasswordConfiguredKey = "openCodeServerPasswordConfigured";
type ProviderInstallBooleanKey = "openCodeExperimentalWebSockets";

type ProviderInstallTextField = {
  readonly kind: "text";
  readonly settingsKey: ProviderInstallTextKey;
  readonly label: string;
  readonly placeholder: string;
  readonly description: ReactNode;
};
type ProviderInstallPasswordField = {
  readonly kind: "password";
  readonly settingsKey: ProviderInstallPasswordKey;
  readonly configuredKey: ProviderInstallPasswordConfiguredKey;
  readonly label: string;
  readonly placeholder: string;
  readonly description: ReactNode;
};
type ProviderInstallBooleanField = {
  readonly kind: "boolean";
  readonly settingsKey: ProviderInstallBooleanKey;
  readonly label: string;
  readonly description: ReactNode;
};
type ProviderInstallField =
  | ProviderInstallTextField
  | ProviderInstallPasswordField
  | ProviderInstallBooleanField;
type ProviderInstallSettings = {
  readonly provider: ProviderKind;
  readonly docs: ReadonlyArray<{ readonly label: string; readonly href: string }>;
  readonly fields: readonly ProviderInstallField[];
};


const PROVIDER_INSTALL_SETTINGS: readonly ProviderInstallSettings[] = [
  {
    provider: "codex",
    docs: [
      { label: "Install", href: "https://help.openai.com/en/articles/11096431" },
      { label: "Update", href: "https://help.openai.com/en/articles/11096431" },
      { label: "Config", href: "https://github.com/openai/codex/blob/main/docs/config.md" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "codexBinaryPath",
        label: "Codex binary path",
        placeholder: "Codex binary path",
        description: (
          <>
            Leave blank to use <code>codex</code> from your PATH.
          </>
        ),
      },
      {
        kind: "text",
        settingsKey: "codexHomePath",
        label: "CODEX_HOME path",
        placeholder: "CODEX_HOME",
        description: "Optional custom Codex home and config directory.",
      },
    ],
  },
  {
    provider: "claudeAgent",
    docs: [
      { label: "Install", href: "https://code.claude.com/docs/en/installation" },
      { label: "Update", href: "https://code.claude.com/docs/en/installation#update-claude-code" },
      { label: "Config", href: "https://code.claude.com/docs/en/settings" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "claudeBinaryPath",
        label: "Claude binary path",
        placeholder: "Claude binary path",
        description: (
          <>
            Leave blank to use <code>claude</code> from your PATH.
          </>
        ),
      },
    ],
  },
  {
    provider: "cursor",
    docs: [
      { label: "Install", href: "https://docs.cursor.com/en/cli/installation" },
      { label: "Update", href: "https://docs.cursor.com/en/cli/installation#updates" },
      { label: "Config", href: "https://docs.cursor.com/en/cli/overview" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "cursorBinaryPath",
        label: "Cursor binary path",
        placeholder: "Cursor Agent or Cursor CLI path",
        description: (
          <>
            Leave blank to use <code>cursor-agent</code> from your PATH. Cursor editor CLI paths are
            accepted too.
          </>
        ),
      },
      {
        kind: "text",
        settingsKey: "cursorApiEndpoint",
        label: "Cursor API endpoint",
        placeholder: "https://api2.cursor.sh",
        description: "Optional Cursor API endpoint override passed to `cursor-agent -e`.",
      },
    ],
  },
  {
    provider: "antigravity",
    docs: [
      { label: "Install", href: "https://antigravity.google/docs/cli-using" },
      { label: "Reference", href: "https://antigravity.google/docs/cli-reference" },
      { label: "Hooks", href: "https://antigravity.google/docs/hooks" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "antigravityBinaryPath",
        label: "Antigravity binary path",
        placeholder: "Antigravity CLI binary path",
        description: (
          <>
            Leave blank to use <code>agy</code> from your PATH.
          </>
        ),
      },
    ],
  },
  {
    provider: "grok",
    docs: [
      { label: "Install", href: "https://docs.x.ai/build/overview" },
      { label: "Headless", href: "https://docs.x.ai/build/cli/headless-scripting" },
      { label: "Config", href: "https://docs.x.ai/build/overview" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "grokBinaryPath",
        label: "Grok binary path",
        placeholder: "Grok binary path",
        description: (
          <>
            Leave blank to use <code>grok</code> from your PATH.
          </>
        ),
      },
    ],
  },
  {
    provider: "droid",
    docs: [
      {
        label: "Quickstart",
        href: "https://docs.factory.ai/cli/getting-started/quickstart.md",
      },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "droidBinaryPath",
        label: "Droid binary path",
        placeholder: "droid",
        description: (
          <>
            Leave blank to use <code>droid</code> from your PATH.
          </>
        ),
      },
    ],
  },
  {
    provider: "devin",
    docs: [
      { label: "Install", href: "https://docs.devin.ai/cli" },
      { label: "Commands", href: "https://docs.devin.ai/cli/reference/commands" },
      { label: "Config", href: "https://docs.devin.ai/cli/reference/configuration/config-file" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "devinBinaryPath",
        label: "Devin binary path",
        placeholder: "devin",
        description: (
          <>
            Leave blank to use <code>devin</code> from your PATH. Authenticate with{" "}
            <code>devin auth login</code> or set WINDSURF_API_KEY.
          </>
        ),
      },
    ],
  },
  {
    provider: "opencode",
    docs: [
      { label: "Install", href: "https://opencode.ai/docs/" },
      { label: "Update", href: "https://opencode.ai/docs/cli/" },
      { label: "Config", href: "https://opencode.ai/docs/config/" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "openCodeBinaryPath",
        label: "OpenCode binary path",
        placeholder: "OpenCode binary path",
        description: (
          <>
            Leave blank to use <code>opencode</code> from your PATH.
          </>
        ),
      },
      {
        kind: "text",
        settingsKey: "openCodeServerUrl",
        label: "OpenCode server URL",
        placeholder: "http://127.0.0.1:4096",
        description: "Optional existing OpenCode server URL. Leave blank to spawn a local server.",
      },
      {
        kind: "password",
        settingsKey: "openCodeServerPassword",
        configuredKey: "openCodeServerPasswordConfigured",
        label: "OpenCode server password",
        placeholder: "OpenCode server password",
        description: "Optional password for an externally managed OpenCode server.",
      },
      {
        kind: "boolean",
        settingsKey: "openCodeExperimentalWebSockets",
        label: "OpenAI response WebSockets",
        description:
          "Use Opencode's experimental OpenAI response WebSocket transport for managed local servers.",
      },
    ],
  },
  {
    provider: "pi",
    docs: [
      { label: "Install", href: "https://pi.dev/docs/latest" },
      { label: "Update", href: "https://pi.dev/docs/latest/settings" },
      { label: "Config", href: "https://pi.dev/docs/latest/settings" },
    ],
    fields: [
      {
        kind: "text",
        settingsKey: "piBinaryPath",
        label: "Pi binary path",
        placeholder: "Pi binary path",
        description: (
          <>
            Leave blank to use <code>pi</code> from your PATH.
          </>
        ),
      },
      {
        kind: "text",
        settingsKey: "piAgentDir",
        label: "Pi agent directory",
        placeholder: "Pi agent directory",
        description: "Optional custom Pi agent directory for auth, models, skills, and commands.",
      },
    ],
  },
];

function isProviderInstallFieldDirty(
  field: ProviderInstallField,
  settings: AppSettings,
  defaults: AppSettings,
): boolean {
  return field.kind === "password"
    ? settings[field.configuredKey] !== defaults[field.configuredKey]
    : settings[field.settingsKey] !== defaults[field.settingsKey];
}

function isProviderInstallConfigDirty(
  config: ProviderInstallSettings,
  settings: AppSettings,
  defaults: AppSettings,
): boolean {
  return config.fields.some((field) => isProviderInstallFieldDirty(field, settings, defaults));
}

export function isProviderInstallSettingsDirty(
  settings: AppSettings,
  defaults: AppSettings,
): boolean {
  return PROVIDER_INSTALL_SETTINGS.some((config) =>
    isProviderInstallConfigDirty(config, settings, defaults),
  );
}


const EMPTY_SETTINGS_THREAD_ROUTE_KEY = "";
const SETTINGS_THREAD_ROUTE_SEPARATOR = "\u0000";

/**
 * The settings route has no `:threadId` of its own. The shell remembers the
 * last task route while navigating away from chat, so provider settings can
 * keep reading the same task runtime that the composer just used. A compact
 * string snapshot keeps `useSyncExternalStore` stable even though the storage
 * reader returns a fresh object on every call.
 */
function readSettingsThreadRouteKey(): string {
  const route = readSidebarUiState().lastThreadRoute;
  if (!route) return EMPTY_SETTINGS_THREAD_ROUTE_KEY;
  return [route.threadId, route.splitViewId ?? ""].join(SETTINGS_THREAD_ROUTE_SEPARATOR);
}

function useSettingsRuntimeSessionId(explicitSessionId: string | null | undefined): string | null {
  const rememberedRouteKey = useSyncExternalStore(
    (listener) => subscribeSidebarUiState(() => listener()),
    readSettingsThreadRouteKey,
    () => EMPTY_SETTINGS_THREAD_ROUTE_KEY,
  );
  const [rememberedThreadId, rememberedSplitViewId] = useMemo(() => {
    if (rememberedRouteKey.length === 0) {
      return [null, null] as const;
    }
    const [threadId, splitViewId] = rememberedRouteKey.split(SETTINGS_THREAD_ROUTE_SEPARATOR);
    return [threadId ? ThreadId.makeUnsafe(threadId) : null, splitViewId || null] as const;
  }, [rememberedRouteKey]);
  const rememberedSplitView = useSplitViewStore(
    useMemo(() => selectSplitView(rememberedSplitViewId), [rememberedSplitViewId]),
  );
  const taskId = rememberedSplitView
    ? (resolveSplitViewFocusedThreadId(rememberedSplitView) ?? rememberedThreadId)
    : rememberedThreadId;
  const rememberedThread = useStore(
    useMemo(() => createThreadSelector(taskId), [taskId]),
  );

  return resolveCediaRuntimeSessionId(explicitSessionId, rememberedThread);
}

export type ProvidersSettingsPanelProps = AppSettingsBinding & {
  readonly active: boolean;
  readonly resetEpoch: number;
  readonly updateSettingsAndWait: (patch: Partial<AppSettings>) => Promise<void>;
  /** Optional explicit runtime session, primarily for embedded settings callers. */
  readonly sessionId?: string | null;
};

/**
 * Cedia currently ships OMP as its only execution runtime. Select the OMP
 * surface before mounting the generic CLI workflow so unsupported provider
 * queries and refresh effects are never started in the shipped build.
 */
export function ProvidersSettingsPanel(props: ProvidersSettingsPanelProps) {
  const runtimeSessionId = useSettingsRuntimeSessionId(props.sessionId);
  if (PROVIDER_DESCRIPTORS.length === 1 && PROVIDER_DESCRIPTORS[0]?.kind === "omp") {
    return <OmpProviderSettingsPanel active={props.active} sessionId={runtimeSessionId} />;
  }
  // No generic multi-CLI installer surface exists anymore; render nothing rather
  // than mounting unsupported provider queries.
  return null;
}
