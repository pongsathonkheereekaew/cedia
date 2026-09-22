// FILE: settingsNavigation.ts
// Purpose: Share the settings topic taxonomy between the main sidebar and the settings screen.
// Layer: Route/UI support
// Exports: section ids, nav items, and search normalization helper

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
  "advanced",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];
export type SettingsNavGroupId = "personal" | "coding" | "system" | "archived";

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
  { id: "personal", label: "Personal" },
  { id: "coding", label: "Coding" },
  { id: "system", label: "System" },
  { id: "archived", label: "Archived" },
];

export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  {
    id: "general",
    group: "personal",
    label: "General",
    description: "Choose defaults for new chats, navigation, and the Environment panel.",
    icon: "settings-gear-4",
    eyebrow: "Workflow defaults",
  },
  {
    id: "profile",
    group: "personal",
    label: "Profile",
    description: "Your local display name, handle, and avatar.",
    icon: "user",
    eyebrow: "Your identity",
  },
  {
    id: "appearance",
    group: "personal",
    label: "Appearance",
    description: "Customize the theme, typography, density, and time format.",
    icon: "color-palette",
    eyebrow: "Visual language",
  },
  {
    id: "notifications",
    group: "personal",
    label: "Notifications",
    description: "Choose how Cedia tells you when work finishes or needs attention.",
    icon: "bell",
    eyebrow: "Alerts",
  },
  {
    id: "behavior",
    group: "personal",
    label: "Chat behavior",
    description: "Control live responses, follow-ups, review defaults, and safety confirmations.",
    icon: "settings-slider-hor",
    eyebrow: "Interaction rules",
  },
  {
    id: "shortcuts",
    group: "personal",
    label: "Keybindings",
    description: "Capture, customize, and add shortcuts for every Cedia command.",
    icon: "shortcut",
    eyebrow: "Key bindings",
  },
  {
    id: "providers",
    group: "coding",
    label: "Agent providers",
    description: "Choose visible coding agents and manage their installed CLI tools.",
    icon: "puzzle",
    eyebrow: "Coding agents",
  },
  {
    id: "models",
    group: "coding",
    label: "Models & writing",
    description: "Choose the model used for Git writing and add custom model slugs.",
    icon: "brain",
    eyebrow: "Model configuration",
  },
  {
    id: "advanced",
    group: "system",
    label: "System tools",
    description: "Manage sessions, recovery tools, low-level keybindings, and version details.",
    icon: "toolbox",
    eyebrow: "System tools",
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
