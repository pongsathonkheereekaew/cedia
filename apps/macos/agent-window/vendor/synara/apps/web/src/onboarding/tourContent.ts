// FILE: tourContent.ts
// Purpose: Copy for the "what Cedia can do" tour: one card per shipped surface.
// Layer: Web content (no React)

import type { LucideIcon } from "~/lib/icons";
import {
  BotIcon,
  ClockIcon,
  GitForkIcon,
  GitPullRequestIcon,
  GlobeIcon,
  KeyboardIcon,
  TerminalIcon,
} from "~/lib/icons";

export interface TourCard {
  readonly id: string;
  /** Short tab label. */
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly highlights: ReadonlyArray<string>;
  readonly icon: LucideIcon;
}

export const TOUR_CARDS: ReadonlyArray<TourCard> = [
  {
    id: "agents",
    label: "One agent",
    title: "Run OMP in one workspace",
    description:
      "OMP is the only harness: it brings your models and tools, and Cedia owns the durable task, environment, transcript, and delivery workflow around it.",
    highlights: [
      "Switch models mid-thread",
      "One transcript per task",
      "Approvals before tools run",
    ],
    icon: BotIcon,
  },
  {
    id: "tasks",
    label: "Tasks & worktrees",
    title: "One task, one isolated environment",
    description:
      "Each task owns one body of work: its conversation, provider session, working environment, tool activity, and Git changes. Run tasks in parallel on managed Git worktrees so two agents never edit the same checkout.",
    highlights: ["Managed worktrees", "Forks from any message", "Subagents and side chats"],
    icon: GitForkIcon,
  },
  {
    id: "review",
    label: "Review & PRs",
    title: "From objective to evidence",
    description:
      "A task is complete only after you understand and verify its result, not when the provider reports it is finished. Inspect diffs, run terminals, then commit, push, and open a pull request without leaving the workspace.",
    highlights: [
      "Diff review with file tree",
      "Commit → push → PR",
      "Native pull-request workspace",
    ],
    icon: GitPullRequestIcon,
  },
  {
    id: "browser",
    label: "Browser & devices",
    title: "Verify in a real browser or simulator",
    description:
      "Agents drive a visible, task-owned browser you can watch and annotate. On macOS, an iOS Simulator pane streams the device so agents can build, launch, and tap through an app while you follow along.",
    highlights: ["Shared Chromium surface", "Element annotations", "iOS Simulator pane"],
    icon: GlobeIcon,
  },
  {
    id: "automations",
    label: "Automations & goals",
    title: "Hand off work that should keep moving",
    description:
      "Schedule recurring runs, attach a persistent goal to a thread so it keeps going after each clean turn, and let Cedia bring you back when something needs attention. Scheduled does not mean autonomous approval.",
    highlights: [
      "Interval, daily, cron schedules",
      "Natural-language stop conditions",
      "Thread goals",
    ],
    icon: ClockIcon,
  },
  {
    id: "gateway",
    label: "Agent Gateway",
    title: "Let agents operate Cedia itself",
    description:
      "A built-in MCP surface lets a supported provider session create tasks, wait on them, read transcripts, and steer other threads. Pair Codex, Claude Code, or Claude Desktop from outside with scoped, revocable credentials.",
    highlights: ["Parallel task batches", "External MCP pairing", "Approval boundaries"],
    icon: TerminalIcon,
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    title: "Keep your hands on the keyboard",
    description:
      "Everything in the workspace has a shortcut, and the keymap is editable from Settings. A few worth learning on day one:",
    highlights: [],
    icon: KeyboardIcon,
  },
];

/** Keybinding commands surfaced on the shortcuts card and the final step. */
export const TOUR_SHORTCUT_COMMANDS = [
  { command: "chat.new", label: "New task" },
  { command: "sidebar.addProject", label: "Add project" },
  { command: "sidebar.search", label: "Search sidebar" },
  { command: "terminal.toggle", label: "Toggle terminal" },
  { command: "diff.toggle", label: "Toggle diff" },
] as const;
