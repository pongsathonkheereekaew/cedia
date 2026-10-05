// FILE: ChatHeader.tsx
// Purpose: Renders the chat top bar with project actions and panel toggles.
// Layer: Chat shell header
// Depends on: project action controls, git actions, and panel toggle callbacks

import {
  type EditorId,
  type ProjectId,
  type ProjectScript,
  PROVIDER_DISPLAY_NAMES,
  type ProviderKind,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@synara/contracts";
import { isGenericChatThreadTitle } from "@synara/shared/chatThreads";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FiGitBranch } from "react-icons/fi";
import { HiMiniArrowsPointingOut } from "react-icons/hi2";
import { TbExchange } from "react-icons/tb";
import type { ThreadPrimarySurface } from "../../types";
import GitActionsControl from "../GitActionsControl";
import {
  ArrowRightIcon,
  CheckIcon,
  HandoffIcon,
  HistoryIcon,
  MessageCircleIcon,
  PanelRightCloseIcon,
  PlusIcon,
  DeviceLaptopIcon,
  EllipsisIcon,
  CopyIcon,
  ExternalLinkIcon,
  TerminalIcon,
  XIcon,
} from "~/lib/icons";
import { formatRelativeTime } from "~/lib/relativeTime";
import {
  CHAT_HEADER_TOGGLE_CLASS_NAME,
  ChatHeaderButton,
  ChatHeaderIconButton,
  SurfaceChipIcon,
  SurfaceTabChip,
} from "./chatHeaderControls";
import { TaskTabStrip, useTaskTabs } from "./TaskTabs";
import { DiffStat } from "../ui/diff-stat";
import { IconButton } from "../ui/icon-button";
import { Badge } from "../ui/badge";
import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import { OpenInPicker } from "./OpenInPicker";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarHeaderNavigationControls } from "../SidebarHeaderNavigationControls";
import { useSidebar } from "../ui/sidebar";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { useAppSettings } from "../../appSettings";
import { useStore } from "../../store";
import {
  createSidebarThreadSummariesSelector,
  createThreadProjectIdSelector,
} from "../../storeSelectors";
import { sortThreadsForSidebar } from "../Sidebar.logic";
import { cn } from "~/lib/utils";
import { useOpenFavoriteEditorShortcut } from "~/hooks/useOpenFavoriteEditorShortcut";
import { useEditorLaunchers } from "~/hooks/useEditorLaunchers";
import type { RepoDiffTotals } from "~/hooks/useRepoDiffTotals";
import { ProviderIcon } from "../ProviderIcon";
import { ProviderUsageMenuControl } from "../ProviderUsageMenuControl";
import { EnvironmentToggle, type EnvironmentToggleState } from "./environment/EnvironmentToggle";
import { isIdeEmbeddedRuntime, openAgentsWindowFromIde } from "~/ide-mode";

/**
 * Width (px) below which collapsible header controls drop their text labels and
 * fold into icon-only buttons. Measured on the header element itself, so it fires
 * for any layout that narrows the chat column (split chat, right dock, small window).
 */
const HEADER_COMPACT_BREAKPOINT = 700;

interface ChatHeaderProps {
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  activeThreadEntryPoint: ThreadPrimarySurface;
  activeProvider: ProviderKind;
  activeProjectName: string | undefined;
  workspaceIdentityLabel?: {
    label: string;
    description: string;
  } | null;
  threadBreadcrumbs: ReadonlyArray<{
    threadId: ThreadId;
    title: string;
  }>;
  className?: string;
  hideSidebarControls?: boolean;
  hideHandoffControls?: boolean;
  // Empty-draft landings hide all thread-scoped chrome (title, Hand off, project
  // scripts, git/open-in) — the chat hasn't started yet — keeping only the sidebar
  // cluster plus the Environment and right-panel toggles.
  minimalChrome?: boolean;
  isGitRepo: boolean;
  openInTarget: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  diffToggleShortcutLabel: string | null;
  handoffBadgeLabel: string | null;
  handoffActionLabel: string;
  handoffDisabled: boolean;
  handoffActionTargetProviders: ReadonlyArray<ProviderKind>;
  handoffBadgeSourceProvider: ProviderKind | null;
  handoffBadgeTargetProvider: ProviderKind | null;
  gitCwd: string | null;
  diffTotals: RepoDiffTotals;
  showGitActions?: boolean;
  showDiffToggle?: boolean;
  diffOpen: boolean;
  diffDisabledReason?: string | null;
  rightDockOpen?: boolean;
  onToggleRightDock?: () => void;
  surfaceMode?: "single" | "split";
  isSidechat?: boolean;
  // When provided, the header collapses the
  // Open-in-editor + git-actions + diff-toggle cluster into one Environment button that
  // drives the Environment panel; otherwise the legacy cluster is rendered.
  environment?: EnvironmentToggleState | null;
  chatLayoutAction?: {
    kind: "split" | "maximize";
    label: string;
    shortcutLabel: string | null;
    onClick: () => void;
  } | null;
  changeThreadAction?: {
    label: string;
    onClick: () => void;
  } | null;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleDiff: () => void;
  onRegisterCommitAndPushTrigger?: (trigger: (() => void) | null) => void;
  onCreateHandoff: (targetProvider: ProviderKind) => void;
  onNavigateToThread: (threadId: ThreadId) => void;
  onRenameThread: () => void;
  /** Optional caller-owned items for the overflow menu. The header owns the stable
   * ellipsis trigger/popover while ChatView supplies actions that need thread state. */
  moreMenuItems?: React.ReactNode;
  onCloseThreadPane?: () => void;
}

export type ChatHeaderThreadIconKind = "none" | "provider" | "terminal";

export function resolveChatHeaderThreadIconKind(
  entryPoint: ThreadPrimarySurface,
  title?: string,
): ChatHeaderThreadIconKind {
  if (entryPoint === "chat" && isGenericChatThreadTitle(title)) {
    return "none";
  }
  return entryPoint === "terminal" ? "terminal" : "provider";
}

export function ChatHeader({
  activeThreadId,
  activeThreadTitle,
  activeThreadEntryPoint,
  activeProvider,
  activeProjectName,
  workspaceIdentityLabel,
  threadBreadcrumbs,
  className,
  hideSidebarControls: hideSidebarControlsProp,
  hideHandoffControls: hideHandoffControlsProp,
  minimalChrome: minimalChromeProp,
  isGitRepo,
  openInTarget,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  diffToggleShortcutLabel,
  handoffBadgeLabel,
  handoffActionLabel,
  handoffDisabled,
  handoffActionTargetProviders,
  handoffBadgeSourceProvider,
  handoffBadgeTargetProvider,
  gitCwd,
  diffTotals,
  showGitActions: showGitActionsProp,
  showDiffToggle: showDiffToggleProp,
  diffOpen,
  diffDisabledReason: diffDisabledReasonProp,
  rightDockOpen: rightDockOpenProp,
  onToggleRightDock,
  surfaceMode: surfaceModeProp,
  isSidechat: isSidechatProp,
  environment: environmentProp,
  chatLayoutAction: chatLayoutActionProp,
  changeThreadAction: changeThreadActionProp,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleDiff,
  onRegisterCommitAndPushTrigger,
  onCreateHandoff,
  onNavigateToThread,
  onRenameThread,
  moreMenuItems,
  onCloseThreadPane,
}: ChatHeaderProps) {
  const hideSidebarControls = hideSidebarControlsProp ?? false;
  const hideHandoffControls = hideHandoffControlsProp ?? false;
  const minimalChrome = minimalChromeProp ?? false;
  const showGitActions = showGitActionsProp ?? true;
  const showDiffToggle = showDiffToggleProp ?? true;
  const diffDisabledReason = diffDisabledReasonProp ?? null;
  const rightDockOpen = rightDockOpenProp ?? false;
  const surfaceMode = surfaceModeProp ?? "single";
  const isSidechat = isSidechatProp ?? false;
  const environment = environmentProp ?? null;
  const chatLayoutAction = chatLayoutActionProp ?? null;
  const changeThreadAction = changeThreadActionProp ?? null;
  const editorLaunchers = useEditorLaunchers({
    keybindings,
    availableEditors,
    openInTarget,
  });
  const PrimaryEditorIcon = editorLaunchers.primaryOption?.Icon ?? DeviceLaptopIcon;
  const headerRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const {
    additions: diffAdditions,
    deletions: diffDeletions,
    hasChanges: showDiffTotals,
  } = diffTotals;

  // Own the open-favorite editor shortcut here so it survives regardless of which editor UI
  // is mounted (the legacy Open-in button, the Environment panel's Editor section, or
  // neither while the panel is closed). The header is always present for a project thread.
  useOpenFavoriteEditorShortcut({
    keybindings,
    availableEditors,
    openInTarget,
    enabled: Boolean(activeProjectName),
  });

  const isSplitPane = surfaceMode === "split";
  // Split-chat creation moved to a shortcut only; the header keeps just the inline
  // "maximize" affordance for an already-split focused pane.
  const inlineChatLayoutAction = chatLayoutAction?.kind === "maximize" ? chatLayoutAction : null;
  const threadIconKind = resolveChatHeaderThreadIconKind(activeThreadEntryPoint, activeThreadTitle);
  const showSidechatTitleChip = isSidechat && compact;
  const ideEmbedded = isIdeEmbeddedRuntime();
  // Cedia (item 71): the shell owns one fixed toggle+arrows cluster, static in
  // both states. Only the title glides with the sidebar width. Clearance is
  // driven by open state (not peer CSS — the header is nested deep inside the
  // content column, never a direct peer sibling, so peer-data never matched
  // and the title slid under the fixed arrows). 56px clears the floating
  // cluster on top of the outer 90px traffic-light gutter (total ~146px).
  const { open: sidebarOpen, isMobile: sidebarIsMobile, shellNavigationOwner } = useSidebar();
  const needsFixedClusterClearance =
    shellNavigationOwner && !sidebarIsMobile && !sidebarOpen && !ideEmbedded;
  const taskTabs = useTaskTabs(activeThreadId);
  // Cedia task tabs (§3.E): while the thread panel is closed the header shows
  // state-derived cross-project tabs instead of the thread name, so running
  // work and pending answers stay reachable. Open panel, IDE dock, mobile and
  // sidechat keep the title; an empty strip falls back to the title too.
  const showTaskTabs =
    !ideEmbedded &&
    !sidebarIsMobile &&
    !sidebarOpen &&
    !minimalChrome &&
    !isSidechat &&
    taskTabs.length > 0;
  // Dock thread switcher (embedded only): the dock has no thread sidebar, so the
  // header carries recent threads of the active thread's project (Cursor's history
  // pattern, our styling). New tasks and the Agents window already have buttons.
  const activeProjectId = useStore(
    useMemo(() => createThreadProjectIdSelector(activeThreadId), [activeThreadId]),
  );
  const threadSummaries = useStore(useMemo(createSidebarThreadSummariesSelector, []));
  const { settings: headerSettings } = useAppSettings();
  const recentDockThreads = useMemo(() => {
    if (!ideEmbedded || !activeProjectId) {
      return [];
    }
    return sortThreadsForSidebar(
      threadSummaries.filter(
        (summary) => summary.projectId === activeProjectId && summary.id !== activeThreadId,
      ),
      headerSettings.sidebarThreadSortOrder,
    ).slice(0, 8);
  }, [ideEmbedded, activeProjectId, threadSummaries, activeThreadId, headerSettings.sidebarThreadSortOrder]);
  const dispatchIdeAction = (action: "newTask" | "focus"): void => {
    window.dispatchEvent(new CustomEvent("cedia:ide-action", { detail: { action } }));
  };

  // Cedia (item 71 wobble fix): freeze the compact breakpoint while the sidebar
  // animates. The content column gains ~208px during the 300ms icon-rail slide and
  // crosses the 700px threshold mid-flight; flipping Hand off/IDE labels there
  // resized the header mid-slide and shook the thread title. Hold the last value
  // until the slide settles.
  const [sidebarAnimating, setSidebarAnimating] = useState(false);
  useEffect(() => {
    setSidebarAnimating(true);
    const timer = window.setTimeout(() => setSidebarAnimating(false), 320);
    return () => window.clearTimeout(timer);
  }, [sidebarOpen]);
  const sidebarAnimatingRef = useRef(sidebarAnimating);
  sidebarAnimatingRef.current = sidebarAnimating;
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => {
      if (sidebarAnimatingRef.current && !isSplitPane) return;
      setCompact(isSplitPane || el.clientWidth < HEADER_COMPACT_BREAKPOINT);
    };
    measure();
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
  }, [isSplitPane]);

  const renderProviderIcon = (provider: ProviderKind | null, className: string) => {
    return (
      <ProviderIcon
        provider={provider}
        tone="header"
        className={className}
        fallback={<FiGitBranch className={className} />}
      />
    );
  };

  // Single-chat surfaces own one fixed corner toggle above the right rail
  // (mirroring the left shell cluster above the left rail): far-right and
  // stable across dock open/close and content resizes. It flips the dock
  // through an atomic store toggle, sharing no layout with the header flow.
  // Hosts without that corner slot (split/editor surfaces) keep the legacy
  // in-flow diff toggle here.
  const togglesRightDock = onToggleRightDock !== undefined;
  const rightPanelToggleControl = showDiffToggle && !togglesRightDock ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className={cn(
              CHAT_HEADER_TOGGLE_CLASS_NAME,
              togglesRightDock || !showDiffTotals
                ? "!size-7 [&_svg,&_[data-slot=central-icon]]:mx-0"
                : null,
            )}
            pressed={togglesRightDock ? rightDockOpen : diffOpen}
            onPressedChange={togglesRightDock ? onToggleRightDock : onToggleDiff}
            aria-label={togglesRightDock ? "Toggle right sidebar" : "Toggle diff panel"}
            variant="default"
            size="xs"
            disabled={
              togglesRightDock ? false : !isGitRepo || (diffDisabledReason !== null && !diffOpen)
            }
          >
            {!togglesRightDock && showDiffTotals ? (
              <DiffStat
                className="font-system-ui text-[length:var(--app-font-size-ui-sm,11px)] sm:text-[length:var(--app-font-size-ui-xs,10px)] font-normal tracking-normal"
                insertions={diffAdditions}
                deletions={diffDeletions}
              />
            ) : null}
            <SurfaceChipIcon icon={PanelRightCloseIcon} className="size-4" />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">
        {togglesRightDock
          ? rightDockOpen
            ? "Close right sidebar"
            : "Open right sidebar"
          : !isGitRepo
            ? "Diff panel is unavailable because this project is not a git repository."
            : diffDisabledReason && !diffOpen
              ? diffDisabledReason
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
      </TooltipPopup>
    </Tooltip>
  ) : null;
  return (
    <div ref={headerRef} className={cn("flex min-h-0 min-w-0 flex-1 items-center gap-2", className)}>
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center",
          "overflow-hidden",
          // Reserve visible task navigation before shrinking the action strip.
          // Include the fixed navigation cluster clearance in this minimum.
          showTaskTabs && (needsFixedClusterClearance ? "min-w-[7.5rem]" : "min-w-16"),
          // Cedia (item 71): one gap in both sidebar states, plus 56px
          // clearance for the fixed toggle+arrows while collapsed (outer
          // header supplies the 90px traffic-light gutter). Driven by open
          // state on the sidebar's own 300ms soft-drawer curve (see
          // SIDEBAR_OFFCANVAS_MOTION_CLASS in ui/sidebar.tsx), so the title
          // glides in lockstep with the panel instead of snapping or
          // wobbling: controls stay static, only the title moves.
          "gap-2 sm:gap-3",
          "transition-[padding-inline-start] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
          needsFixedClusterClearance && "md:ps-14",
          // Cedia window header: hideSidebarControls means the title row is
          // foreign-owned (route header above the cards): the in-card surface
          // needs no leading-cluster clearance there.
          hideSidebarControls && "md:ps-0!",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2",
            minimalChrome && "hidden",
          )}
        >
          {showTaskTabs ? (
            <TaskTabStrip
              tabs={taskTabs}
              activeThreadId={activeThreadId}
              onSelect={onNavigateToThread}
            />
          ) : (
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col",
            )}
          >
            {threadBreadcrumbs.length > 0 ? (
              <div className="flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-muted-foreground/55">
                {threadBreadcrumbs.map((breadcrumb, index) => (
                  <React.Fragment key={breadcrumb.threadId}>
                    {index > 0 ? (
                      <span className="shrink-0 text-muted-foreground/35">/</span>
                    ) : null}
                    <button
                      type="button"
                      className="min-w-0 truncate transition-colors hover:text-foreground/80"
                      title={breadcrumb.title}
                      onClick={() => onNavigateToThread(breadcrumb.threadId)}
                    >
                      {breadcrumb.title}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            ) : null}
            <div className={cn("flex min-w-0 items-center gap-2")}>
              <div
                className={cn(
                  "flex min-w-0 items-center gap-2",
                  showSidechatTitleChip &&
                    "rounded-lg bg-secondary py-1 pl-2 pr-1 text-secondary-foreground",
                )}
              >
                {threadIconKind === "none" ? null : (
                  <span
                    className="inline-flex size-3.5 shrink-0 items-center justify-center"
                    title={
                      threadIconKind === "terminal"
                        ? "Terminal"
                        : PROVIDER_DISPLAY_NAMES[activeProvider]
                    }
                  >
                    {threadIconKind === "terminal" ? (
                      <TerminalIcon className="size-3.5 text-[var(--color-text-accent)]" />
                    ) : (
                      renderProviderIcon(activeProvider, "size-3.5")
                    )}
                  </span>
                )}
                <h2
                  className="max-w-[clamp(12rem,42vw,36rem)] truncate font-system-ui text-[length:var(--app-font-size-ui,12px)] font-normal text-foreground"
                  title={activeThreadTitle}
                  onDoubleClick={() => onRenameThread()}
                >
                  {activeThreadTitle}
                </h2>
                {workspaceIdentityLabel ? (
                  <span
                    data-testid="shared-folder-label"
                    aria-label={workspaceIdentityLabel.description}
                    title={workspaceIdentityLabel.description}
                    className="inline-flex shrink-0 items-center rounded-full border border-[color:var(--color-border-light)] px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {workspaceIdentityLabel.label}
                  </span>
                ) : null}
                {showSidechatTitleChip && onCloseThreadPane ? (
                  <IconButton
                    variant="chrome"
                    size="icon-xs"
                    label="Close selected Side"
                    tooltip="Close selected Side"
                    tooltipSide="bottom"
                    className="size-5 rounded-lg [-webkit-app-region:no-drag] [&_svg]:size-3"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseThreadPane();
                    }}
                  >
                    <XIcon />
                  </IconButton>
                ) : null}
              </div>
              {!hideHandoffControls && handoffBadgeLabel ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Badge
                        variant="outline"
                        className="hidden !h-6 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-[10px] sm:inline-flex"
                      >
                        <span className="inline-flex size-4 shrink-0 items-center justify-center">
                          {renderProviderIcon(handoffBadgeSourceProvider, "size-3")}
                        </span>
                        <ArrowRightIcon className="size-2.5 shrink-0 opacity-45" />
                        <span className="inline-flex size-4 shrink-0 items-center justify-center">
                          {renderProviderIcon(handoffBadgeTargetProvider, "size-3")}
                        </span>
                      </Badge>
                    }
                  />
                  <TooltipPopup side="bottom">{handoffBadgeLabel}</TooltipPopup>
                </Tooltip>
              ) : null}
            </div>
          </div>
          )}
        </div>
      </div>
      <div
        className={cn(
          "flex items-center gap-2 [-webkit-app-region:no-drag]",
          // A wide tool panel must not clip the selected task out of its header.
          // Keep actions reachable by scrolling and keyboard focus at tight widths.
          showTaskTabs ? "min-w-0 overflow-x-auto" : "shrink-0",
        )}
      >
        {!minimalChrome && !hideHandoffControls && !environment ? (
          <ProviderUsageMenuControl provider={activeProvider} />
        ) : null}
        {!minimalChrome && !hideHandoffControls ? (
          <Menu modal={false}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <MenuTrigger
                    render={
                      <ChatHeaderButton
                        type="button"
                        tone="outline"
                        className={compact ? "gap-1" : "gap-1.5"}
                        aria-label={handoffActionLabel}
                        disabled={handoffDisabled || handoffActionTargetProviders.length === 0}
                      />
                    }
                  >
                    <HandoffIcon className="size-[1em] shrink-0 opacity-80" />
                    {!compact ? <span className="truncate font-normal">Hand off</span> : null}
                  </MenuTrigger>
                }
              />
              <TooltipPopup side="bottom">{handoffActionLabel}</TooltipPopup>
            </Tooltip>
            <ComposerPickerMenuPopup align="end" side="bottom" className="w-48 min-w-48">
              {handoffActionTargetProviders.map((provider) => (
                <MenuItem key={provider} onClick={() => onCreateHandoff(provider)}>
                  {/* opacity-100 opts brand icons out of the option row's 80% icon dim. */}
                  {renderProviderIcon(provider, "size-3.5 shrink-0 opacity-100")}
                  <span>Handoff to {PROVIDER_DISPLAY_NAMES[provider]}</span>
                </MenuItem>
              ))}
            </ComposerPickerMenuPopup>
          </Menu>
        ) : null}
        {ideEmbedded ? (
          <>
            <Menu modal={false}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <MenuTrigger
                      render={
                        <ChatHeaderIconButton
                          type="button"
                          label="Recent threads"
                          tone="outline"
                          className="[&_svg]:size-3.5"
                        >
                          <HistoryIcon aria-hidden className="size-3.5" />
                        </ChatHeaderIconButton>
                      }
                    />
                  }
                />
                <TooltipPopup side="bottom">Recent threads</TooltipPopup>
              </Tooltip>
              <ComposerPickerMenuPopup align="start" side="bottom" className="w-64 min-w-64">
                {recentDockThreads.length === 0 ? (
                  <span className="block truncate px-2.5 py-1.5 text-[length:var(--app-font-size-ui,12px)] text-muted-foreground/70">
                    No other threads in this project
                  </span>
                ) : (
                  recentDockThreads.map((thread) => (
                    <MenuItem key={thread.id} onClick={() => onNavigateToThread(thread.id)}>
                      <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                    </MenuItem>
                  ))
                )}
              </ComposerPickerMenuPopup>
            </Menu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ChatHeaderButton
                    type="button"
                    tone="outline"
                    className="gap-1.5 font-normal"
                    aria-label="New task"
                    onClick={() => dispatchIdeAction("newTask")}
                  >
                    <PlusIcon aria-hidden className="size-3.5" />
                    {!compact ? <span>New task</span> : null}
                  </ChatHeaderButton>
                }
              />
              <TooltipPopup side="bottom">Start a new task</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ChatHeaderButton
                    type="button"
                    tone="outline"
                    className="gap-1.5 font-normal"
                    aria-label="Open Agents Window"
                    onClick={() => {
                      void openAgentsWindowFromIde().catch((error) => console.error(error));
                    }}
                  >
                    <ExternalLinkIcon aria-hidden className="size-3.5" />
                    {!compact ? <span>Agents Window</span> : null}
                  </ChatHeaderButton>
                }
              />
              <TooltipPopup side="bottom">Open Agents Window</TooltipPopup>
            </Tooltip>
          </>
        ) : null}
        {!minimalChrome && activeProjectScripts ? (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            hideInlineLabel={compact}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        ) : null}

        {!minimalChrome && environment && activeProjectName && showGitActions ? (
          <GitActionsControl
            gitCwd={gitCwd}
            activeThreadId={activeThreadId}
            hideQuickActionLabel={compact}
            visibleWhen="pull-available"
          />
        ) : null}

        {inlineChatLayoutAction ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <ChatHeaderIconButton
                  type="button"
                  label={inlineChatLayoutAction.label}
                  onClick={inlineChatLayoutAction.onClick}
                >
                  <HiMiniArrowsPointingOut className="size-3.5" />
                </ChatHeaderIconButton>
              }
            />
            <TooltipPopup side="bottom">{inlineChatLayoutAction.label}</TooltipPopup>
          </Tooltip>
        ) : null}

        {/* Change thread stays as a standalone control (split/sidechat only). */}
        {changeThreadAction ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <ChatHeaderIconButton
                  type="button"
                  label={changeThreadAction.label}
                  onClick={changeThreadAction.onClick}
                >
                  <TbExchange className="size-3.5" />
                </ChatHeaderIconButton>
              }
            />
            <TooltipPopup side="bottom">{changeThreadAction.label}</TooltipPopup>
          </Tooltip>
        ) : null}

        {/* IDE is a direct, Cursor-style handoff to the preferred native editor. The
            existing editor picker remains available in Environment, while this compact
            action keeps the common switch-to-IDE path one click away. */}
        {!ideEmbedded && activeProjectName && openInTarget ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <ChatHeaderButton
                  type="button"
                  tone="outline"
                  className="gap-1.5 font-normal"
                  aria-label="Open in IDE"
                  disabled={!editorLaunchers.preferredEditor}
                  onClick={() => editorLaunchers.openInEditor(editorLaunchers.preferredEditor)}
                >
                  <PrimaryEditorIcon aria-hidden className="size-3.5" />
                  <span>IDE</span>
                </ChatHeaderButton>
              }
            />
            <TooltipPopup side="bottom">Open workspace in IDE</TooltipPopup>
          </Tooltip>
        ) : null}

        {(
          <Menu modal={false}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <MenuTrigger
                    render={
                      <ChatHeaderIconButton
                        type="button"
                        label="More actions"
                        tone="outline"
                        className="[&_svg]:size-3.5"
                      >
                        <EllipsisIcon aria-hidden className="size-3.5" />
                      </ChatHeaderIconButton>
                    }
                  />
                }
              />
              <TooltipPopup side="bottom">More actions</TooltipPopup>
            </Tooltip>
            <ComposerPickerMenuPopup align="end" side="bottom" className="w-52 min-w-52">
              {moreMenuItems && !ideEmbedded ? <MenuItem
                disabled={!editorLaunchers.preferredEditor || !openInTarget}
                onClick={() => editorLaunchers.openInEditor(editorLaunchers.preferredEditor)}
              ><ExternalLinkIcon className="size-3.5 shrink-0" /><span className="min-w-0 flex-1">Open in IDE</span></MenuItem> : null}
              {moreMenuItems ?? (
                <>
                  <MenuItem onClick={onRenameThread}>
                    <span className="min-w-0 flex-1">Rename</span>
                  </MenuItem>
                  <MenuItem
                    disabled={!openInTarget}
                    onClick={() => {
                      if (!openInTarget) return;
                      void navigator.clipboard?.writeText(openInTarget);
                    }}
                  >
                    <CopyIcon className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">Copy workspace path</span>
                  </MenuItem>
                  <MenuItem
                    disabled={!editorLaunchers.preferredEditor || !openInTarget}
                    onClick={() => editorLaunchers.openInEditor(editorLaunchers.preferredEditor)}
                  >
                    <ExternalLinkIcon className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">Open in IDE</span>
                  </MenuItem>
                </>
              )}
            </ComposerPickerMenuPopup>
          </Menu>
        )}

        {/* Environment: one button consolidating Open-in-editor and most git actions into
            the Environment panel. Pull still appears in this action cluster when the
            branch is behind. The right-side panel control stays beside it, acting as the
            multi-pane dock toggle on single chats and the legacy diff toggle in split hosts.
            Falls back to the legacy controls when no environment is resolved. */}
        {environment ? (
          <>
            <EnvironmentToggle environment={environment} />
            {rightPanelToggleControl}
          </>
        ) : (
          <>
            {/* Open in editor: dedicated split-button with an editor switcher; the project
                action control now lives beside Hand off as its own project command surface. */}
            {!minimalChrome && activeProjectName ? (
              <OpenInPicker
                keybindings={keybindings}
                availableEditors={availableEditors}
                openInTarget={openInTarget}
              />
            ) : null}

            {!minimalChrome && activeProjectName && showGitActions ? (
              <GitActionsControl
                gitCwd={gitCwd}
                activeThreadId={activeThreadId}
                hideQuickActionLabel={compact}
                onRegisterCommitAndPushTrigger={onRegisterCommitAndPushTrigger}
              />
            ) : null}
            {rightPanelToggleControl}
          </>
        )}
      </div>
    </div>
  );
}
