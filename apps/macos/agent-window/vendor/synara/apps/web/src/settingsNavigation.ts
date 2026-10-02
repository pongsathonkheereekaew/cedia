// FILE: settingsNavigation.ts
// Purpose: Share the settings topic taxonomy between the main sidebar and the settings screen.
// Layer: Route/UI support
// Exports: section ids, nav items, and search normalization helper

import { capabilityState, isCapabilityVisible, type HostCapability } from "./capabilityGate";

export const SETTINGS_SECTION_IDS = [
  // Cedia §10 item 60 keeps only backed sections: the general panel, notification
  // and behavior rows, the read-only keybindings sheet (editing lands with
  // §10 item 57), models, providers, system tools, and archived threads, plus the
  // local profile editors (name/handle/avatar persist in localStorage, no stats
  // RPC). Every other section id is gone, so old `?section=` deep links normalize
  // to general.
  "general",
  "profile",
  "appearance",
  "notifications",
  "behavior",
  "shortcuts",
  "archived",
  "models",
  "providers",
  "remote",
  "omp",
  "status",
  "advanced",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];
export type SettingsNavGroupId = "general" | "ai-omp" | "ide" | "archived";

/**
 * Deep-link scroll targets inside settings panels. Each id is shared by its DOM owner and callers
 * that navigate with `?target=…`; the settings route resolves every target after the active panel
 * mounts.
 */
export const SETTINGS_TARGETS = {
  providerUpdates: "provider-updates",
  environmentPanel: "environment-panel",
} as const;

export type SettingsNavItem = {
  id: SettingsSectionId;
  group: SettingsNavGroupId;
  label: string;
  description: string;
  /** Basename of a SVG under `/central-icons-reversed`. */
  icon: string;
  eyebrow: string;
};

export const SETTINGS_NAV_GROUPS: ReadonlyArray<{
  id: SettingsNavGroupId;
  label: string;
}> = [
  { id: "general", label: "General" },
  { id: "ai-omp", label: "AI/OMP" },
  { id: "ide", label: "IDE" },
  { id: "archived", label: "Archived" },
];

export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  {
    id: "general",
    group: "general",
    label: "General",
    description: "Choose defaults for new chats, navigation, and the Environment panel.",
    icon: "settings-gear-4",
    eyebrow: "Workflow defaults",
  },
  {
    id: "remote",
    group: "general",
    label: "Remote",
    description: "Reach this Mac from your tailnet: the gateway address, device enrollment, and paired devices.",
    icon: "globe",
    eyebrow: "This Mac, elsewhere",
  },
  {
    id: "profile",
    group: "general",
    label: "Profile",
    description: "Your local display name, handle, and avatar.",
    icon: "user",
    eyebrow: "Your identity",
  },
  {
    id: "appearance",
    group: "general",
    label: "Appearance",
    description: "Customize the theme, typography, density, and time format.",
    icon: "color-palette",
    eyebrow: "Visual language",
  },
  {
    id: "notifications",
    group: "general",
    label: "Notifications",
    description: "Choose how Cedia tells you when work finishes or needs attention.",
    icon: "bell",
    eyebrow: "Alerts",
  },
  {
    id: "behavior",
    group: "general",
    label: "Chat behavior",
    description: "Control live responses, follow-ups, review defaults, and safety confirmations.",
    icon: "settings-slider-hor",
    eyebrow: "Interaction rules",
  },
  {
    id: "shortcuts",
    group: "ide",
    label: "Keybindings",
    description: "Edit the real IDE keybindings file Cedia and the workbench share. OMP terminal shortcuts stay separate.",
    icon: "shortcut",
    eyebrow: "IDE key bindings",
  },
  {
    id: "providers",
    group: "ai-omp",
    label: "Agent providers",
    description: "Choose visible coding agents and manage their installed CLI tools.",
    icon: "puzzle",
    eyebrow: "Coding agents",
  },
  {
    id: "models",
    group: "ai-omp",
    label: "Models & writing",
    description: "Choose the model used for Git writing and add custom model slugs.",
    icon: "brain",
    eyebrow: "Model configuration",
  },
  {
    id: "omp",
    group: "ai-omp",
    label: "AI / OMP settings",
    description: "Inspect and edit the live OMP configuration with revision-safe writes.",
    icon: "brain",
    eyebrow: "Runtime configuration",
  },
  {
    id: "advanced",
    group: "ai-omp",
    label: "System tools",
    description: "Manage sessions, recovery tools, low-level keybindings, and version details.",
    icon: "toolbox",
    eyebrow: "System tools",
  },
  {
    id: "status",
    group: "ai-omp",
    label: "Capability status",
    description: "See what this Cedia host supports, what needs setup, and what is not implemented yet.",
    icon: "circle-info",
    eyebrow: "Cedia",
  },
  {
    id: "archived",
    group: "archived",
    label: "Archived threads",
    description: "Find and restore threads you previously archived.",
    icon: "archive",
    eyebrow: "Thread management",
  },
];

/**
 * Stable DOM id for a settings row, derived from its (string) title. Shared by the row that
 * renders the anchor and by the search index that deep-links to it via `?target=…`, so the
 * two can't drift. Panels stay mounted and render null while inactive, so the slug only needs
 * to be unique within a section.
 */
export function settingRowAnchorId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `setting-${slug}`;
}

export function normalizeSettingsSection(value: unknown): SettingsSectionId {
  if (typeof value !== "string") {
    return "general";
  }
  return SETTINGS_SECTION_IDS.find((candidate) => candidate === value) ?? "general";
}

/**
 * The host capability that backs a settings destination, when one does (§3.B/§3.D).
 *
 * Only a section whose whole content comes from one host integration is listed. A section
 * without an entry is core Cedia UI and never disappears.
 */
export const SETTINGS_SECTION_CAPABILITY_IDS: Readonly<Partial<Record<SettingsSectionId, string>>> = {
  omp: "omp.settings",
};

/**
 * Whether a settings destination may be offered.
 *
 * An `integration_missing` row is absent from the working UI, exactly like the sidebar's
 * automations row. A capability the host reports as needing setup stays visible, because its
 * panel has to explain itself; an unknown or unloaded snapshot changes nothing.
 */
export function settingsSectionVisible(
  id: SettingsSectionId,
  capabilities: readonly HostCapability[] | undefined,
): boolean {
  const capabilityId = SETTINGS_SECTION_CAPABILITY_IDS[id];
  return isCapabilityVisible(capabilityState(capabilities, capabilityId));
}

/** The destination a hidden section falls back to: the first one the host still backs. */
export function firstVisibleSettingsSection(
  capabilities: readonly HostCapability[] | undefined,
): SettingsSectionId {
  return SETTINGS_SECTION_IDS.find((candidate) => settingsSectionVisible(candidate, capabilities)) ?? "general";
}

/**
 * Resolve a `?section=` deep link.
 *
 * An unknown id already normalized to general. This adds the capability rule: a stored deep link
 * or an old profile must not reopen a destination the host reports as not implemented.
 */
export function resolveSettingsSection(
  value: unknown,
  capabilities: readonly HostCapability[] | undefined,
): SettingsSectionId {
  const requested = normalizeSettingsSection(value);
  return settingsSectionVisible(requested, capabilities) ? requested : firstVisibleSettingsSection(capabilities);
}
