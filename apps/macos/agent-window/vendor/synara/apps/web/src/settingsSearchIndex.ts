// FILE: settingsSearchIndex.ts
// Purpose: Declarative, searchable index of settings rows/sections so the sidebar can
//          surface matches by title/description the same way the editor file search does.
// Layer: Route/UI support
// Exports: entry type, the index, section label lookup, and the ranking helper

import { rankProviderDiscoveryItems } from "~/lib/providerDiscovery";
import { isCediaHostRuntime } from "./appSettings";
import {
  settingRowAnchorId,
  SETTINGS_NAV_ITEMS,
  settingsSectionVisible,
  type SettingsSectionId,
} from "./settingsNavigation";
import type { HostCapability } from "./capabilityGate";

/**
 * One searchable settings result. `title` usually matches a string SettingsRow heading so
 * the default anchor can be derived; `target: null` marks panel-only or conditional rows.
 */
export interface SettingsSearchEntry {
  id: string;
  section: SettingsSectionId;
  title: string;
  keywords: string;
  target?: string | null;
}

/** DOM id a result deep-links to, or null for panel-level entries with no anchored row. */
export function settingsSearchEntryTarget(entry: SettingsSearchEntry): string | null {
  return entry.target === undefined ? settingRowAnchorId(entry.title) : entry.target;
}

// Mirrors row titles/descriptions rendered in settings panels. Panels stay mounted but render
// null while inactive, so the sidebar cannot read every row at runtime; keep this list in sync
// when rows are added, renamed, hidden conditionally, or represented as panel-level results.
export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  // ── Remote ──────────────────────────────────────────────────────────────────
  {
    id: "remote:gateway",
    section: "remote",
    title: "Remote gateway",
    keywords:
      "Reach this Mac from another device. Tailscale tailnet address enrollment code pair device revoke controller",
    target: null,
  },
  {
    id: "remote:devices",
    section: "remote",
    title: "Paired devices",
    keywords: "Controllers that can call this Mac. revoke pairing device list phone browser",
    target: null,
  },

  // ── General ────────────────────────────────────────────────────────────────
  {
    id: "general:permissions",
    section: "general",
    title: "Permissions",
    keywords: "approvals ask for approval full access default permissions tools.approvalMode tools.approval",
    target: null,
  },
  {
    id: "general:power",
    section: "general",
    title: "Power",
    keywords: "prevent sleep keep awake power.sleepPrevention",
    target: null,
  },
  {
    id: "general:welcome-tour",
    section: "general",
    title: "Welcome tour",
    keywords:
      "Replay the first-run setup: feature tour and first project. onboarding welcome wizard getting started setup",
  },
  {
    id: "general:project-order",
    section: "general",
    title: "Project order",
    keywords: "Controls how projects are arranged in the main sidebar. sort updated created manual",
  },
  {
    id: "general:thread-order",
    section: "general",
    title: "Thread order",
    keywords:
      "Controls how threads are arranged inside each project in the main sidebar. sort updated created",
  },
  {
    id: "general:chats-section",
    section: "general",
    title: "Chats",
    keywords:
      "Show the standalone Chats list in the sidebar footer chats not tied to a project. sidebar section",
  },
  {
    id: "general:automation-run-threads",
    section: "general",
    title: "Automation runs",
    keywords:
      "Show the thread each standalone automation run creates in the sidebar. hide automation run threads clutter scheduled",
  },
  {
    id: "general:environment-default-open",
    section: "general",
    title: "Open by default",
    keywords:
      "Open the chat Environment panel automatically on normal threads. default closed open environment panel preference",
  },
  {
    id: "general:environment-usage",
    section: "general",
    title: "Usage",
    keywords: "Show the provider usage row in the chat Environment panel.",
  },
  {
    id: "general:environment-repository",
    section: "general",
    title: "Repository",
    keywords: "Show the GitHub repository link in the chat Environment panel. git changes worktree",
  },
  {
    id: "general:environment-pull-request",
    section: "general",
    title: "Pull request",
    keywords:
      "Show the open pull request CI checks and review comments in the chat Environment panel. pr fix github",
  },
  {
    id: "general:environment-editor",
    section: "general",
    title: "Editor",
    keywords:
      "Show the Editor section (Open in editor picker) in the chat Environment panel.",
  },
  {
    id: "general:environment-recap",
    section: "general",
    title: "Recap",
    keywords: "Show the auto-generated chat recap in the Environment panel.",
  },
  {
    id: "general:environment-pinned",
    section: "general",
    title: "Pinned messages",
    keywords: "Show the pinned-messages checklist in the Environment panel.",
  },
  {
    id: "general:environment-instructions",
    section: "general",
    title: "Project instructions",
    keywords: "Show project-level instructions in the Environment panel.",
  },
  {
    id: "general:environment-notepad",
    section: "general",
    title: "Notepad",
    keywords: "Show the per-thread notepad in the Environment panel.",
  },

  // ── Appearance ───────────────────────────────────────────────────────────────
  {
    id: "appearance:theme",
    section: "appearance",
    title: "Theme",
    keywords: "Cedia shared chrome stays solid and follows the IDE theme. Change it in the IDE window with Preferences: Color Theme; both windows repaint together.",
  },
  {
    id: "appearance:system-ui-font",
    section: "appearance",
    title: "Use system UI font",
    keywords: "Use the operating system interface font throughout Cedia.",
  },
  {
    id: "appearance:ui-density",
    section: "appearance",
    title: "UI density",
    keywords:
      "Control spacing in the sidebar, composer, chat gutters, and settings rows without changing font size. compact comfortable",
  },
  {
    id: "appearance:chat-width",
    section: "appearance",
    title: "Chat width",
    keywords:
      "Control how wide the chat column grows so tables and wide content get more room. standard wide full",
  },
  {
    id: "appearance:base-font-size",
    section: "appearance",
    title: "Base font size",
    keywords:
      "Adjust the app text base in pixels. Chat and UI typography scale proportionally. font",
  },
  {
    id: "appearance:terminal-font-size",
    section: "appearance",
    title: "Terminal font size",
    keywords: "Adjust terminal text independently from the app and chat font size.",
  },
  {
    id: "appearance:terminal-font",
    section: "appearance",
    title: "Terminal font",
    keywords:
      "Type any monospace font installed on this device e.g. Fira Code. system monospace family",
  },
  {
    id: "appearance:font-smoothing",
    section: "appearance",
    title: "Font smoothing",
    keywords: "Use macOS-style antialiasing for lighter, crisper text rendering.",
    target: null,
  },
  {
    id: "appearance:time-format",
    section: "appearance",
    title: "Time format",
    keywords:
      "System default follows your browser or OS clock preference. timestamp 12-hour 24-hour locale",
  },

  // ── Notifications ─────────────────────────────────────────────────────────────
  {
    id: "notifications:activity-toasts",
    section: "notifications",
    title: "Activity toasts",
    keywords:
      "Show an in-app toast when a chat or managed terminal agent finishes or needs input. alerts",
  },
  {
    id: "notifications:desktop-notifications",
    section: "notifications",
    title: "Desktop notifications",
    keywords:
      "Show an OS notification when a chat or managed terminal agent finishes or needs input while the app is in the background. alerts toast",
  },
  // ── Behavior ──────────────────────────────────────────────────────────────────
  {
    id: "behavior:follow-up-behavior",
    section: "behavior",
    title: "Follow-up behavior",
    keywords:
      "Choose whether messages sent during an active turn wait in the queue or steer the current run. Ctrl Cmd Enter opposite send",
  },
  {
    id: "behavior:assistant-output",
    section: "behavior",
    title: "Assistant output",
    keywords: "Show token-by-token output while a response is in progress. streaming",
  },
  {
    id: "behavior:effort-slider",
    section: "behavior",
    title: "Effort slider",
    keywords:
      "Show reasoning effort as a slider in the composer model menu once a chat has started. fast mode reasoning thinking level picker",
  },
  {
    id: "behavior:auto-open-simulator",
    section: "behavior",
    title: "Automatically open simulator",
    keywords:
      "Disable automatic iOS Simulator device pane opening. Use Simulator.app without the mirrored panel reopening. background launch",
  },
  {
    id: "behavior:diff-line-wrapping",
    section: "behavior",
    title: "Diff line wrapping",
    keywords: "Set the default wrap state when the diff panel opens. word wrap",
  },
  {
    id: "behavior:delete-confirmation",
    section: "behavior",
    title: "Delete confirmation",
    keywords: "Ask before deleting a thread and its chat history. safety confirm",
  },
  {
    id: "behavior:archive-confirmation",
    section: "behavior",
    title: "Archive confirmation",
    keywords: "Ask before archiving a thread. safety confirm",
  },
  {
    id: "behavior:terminal-close-confirmation",
    section: "behavior",
    title: "Terminal close confirmation",
    keywords: "Ask before closing a terminal tab and clearing its history. safety confirm",
  },

  // ── Keybindings ───────────────────────────────────────────────────────────────
  {
    id: "shortcuts:keyboard-shortcuts",
    section: "shortcuts",
    title: "Keybindings",
    keywords:
      "Every keyboard shortcut available in Cedia, grouped by context. keybindings hotkeys key combo cmd ctrl reference",
    target: null,
  },
  // ── Archived ──────────────────────────────────────────────────────────────────
  {
    id: "archived:archived-threads",
    section: "archived",
    title: "Archived threads",
    keywords: "View and restore archived threads. unarchive history",
    target: null,
  },

  // ── Legacy model aliases ───────────────────────────────────────────────────────
  // These terms still find the supported OMP provider surface after the old generic
  // provider-CLI editor was removed. Their keywords live on the backed catalog entry below.
  // ── AI / OMP ────────────────────────────────────────────────────────────────
  {
    id: "omp:settings",
    section: "omp",
    title: "OMP settings",
    keywords:
      "Live OMP runtime configuration. Search every schema path, inspect effective values and layer provenance, edit supported values, protected credentials, advanced settings, excluded provider endpoints ordering enabled fields",
    target: null,
  },

  // ── Providers ─────────────────────────────────────────────────────────────────
  {
    id: "providers:accounts",
    section: "providers",
    title: "Provider accounts",
    keywords:
      "Sign in through OMP, provide an API key, sign out, and see the credential state reported by the runtime.",
    target: null,
  },
  {
    id: "providers:catalog",
    section: "providers",
    title: "Live OMP catalog",
    keywords:
      "Upstream providers and models supplied by OMP at runtime. The model picker uses this catalog. Saved model slugs custom model model list Git writing model.",
    target: null,
  },

  // ── Advanced ──────────────────────────────────────────────────────────────────
  {
    id: "advanced:keybindings",
    section: "advanced",
    title: "Keybindings",
    keywords:
      "Open the persisted keybindings.json file to edit advanced bindings directly. shortcuts",
  },
  {
    id: "advanced:recovery-tools",
    section: "advanced",
    title: "Recovery tools",
    keywords:
      "Rebuild local project indexes without clearing existing chats when the local state gets out of sync.",
  },
  {
    id: "advanced:version",
    section: "advanced",
    title: "Version",
    keywords: "Current application version. about",
  },
] as const;

/**
 * Vendor settings that have no Cedia owner. Keep their index entries for the
 * vendor/browser surface, but do not deep-link Cedia users into controls whose
 * adapter endpoint rejects every read or write.
 */
const CEDIA_UNSUPPORTED_SETTINGS_ENTRY_IDS = new Set([
  "general:automation-run-threads",
  "general:environment-usage",
  "general:environment-pull-request",
  "general:environment-recap",
]);

const SETTINGS_SECTION_LABEL_BY_ID = new Map<SettingsSectionId, string>(
  SETTINGS_NAV_ITEMS.map((item) => [item.id, item.label]),
);

export function settingsSectionLabel(section: SettingsSectionId): string {
  return SETTINGS_SECTION_LABEL_BY_ID.get(section) ?? section;
}

/**
 * Fuzzy-rank settings rows for the sidebar search. Title carries the strongest intent;
 * the description/synonym keywords and the owning section label match more loosely so a
 * query like "appearance" or "wrap" still surfaces the right rows.
 */
export function rankSettingsSearchEntries(
  query: string,
  limit: number,
  capabilities?: readonly HostCapability[],
): readonly SettingsSearchEntry[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }
  // A result that deep-links into a destination the host reports as not implemented is not a
  // result: clicking it would land on a section that is gone from the nav (§3.B).
  const cediaHost = isCediaHostRuntime();
  const candidates = SETTINGS_SEARCH_ENTRIES.filter((entry) => {
    if (cediaHost && CEDIA_UNSUPPORTED_SETTINGS_ENTRY_IDS.has(entry.id)) return false;
    return settingsSectionVisible(entry.section, capabilities);
  });
  const ranked = rankProviderDiscoveryItems(candidates, trimmed, (entry) => [
    { value: entry.title },
    { value: entry.keywords, weight: 200 },
    { value: settingsSectionLabel(entry.section), weight: 400 },
  ]);
  return ranked.slice(0, limit);
}
