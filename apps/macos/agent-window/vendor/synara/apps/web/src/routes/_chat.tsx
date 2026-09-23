import type { ResolvedKeybindingsConfig } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  goBackInAppHistory,
  goForwardInAppHistory,
  resolveAppNavigationState,
} from "../appNavigation";
import ShortcutsDialog from "../components/ShortcutsDialog";
import { RecentViewSwitcher } from "../components/RecentViewSwitcher";
import { CediaStatusBar } from "../components/cediaStatusBar";
import { shouldRenderTerminalWorkspace } from "../components/ChatView.logic";
import ThreadSidebar from "../components/Sidebar";
import {
  persistSidebarUiState,
  readSidebarUiState,
  subscribeSidebarUiState,
} from "../components/Sidebar.uiState";
import { isElectron } from "../env";
import { useTheme } from "../hooks/useTheme";
import { useHandleNewChat } from "../hooks/useHandleNewChat";
import { useTemporaryThreadLifecycle } from "../hooks/useTemporaryThreadLifecycle";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useRecentViewSwitcher } from "../hooks/useRecentViewSwitcher";
import { useLatestProjectStore } from "../latestProjectStore";
import {
  resolveCurrentProjectTargetId,
  resolveLatestProjectTargetId,
  resolveLatestProjectTargetIdWithFallback,
  resolveNewThreadTarget,
} from "../lib/projectShortcutTargets";
import { resolveInheritedThreadContext } from "../lib/threadBootstrap";
import { isTerminalFocused } from "../lib/terminalFocus";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { isKeyboardShortcutsHelpShortcut, resolveShortcutCommand } from "../keybindings";
import { useStore } from "../store";
import { createProjectLastActivityAtSelector } from "../storeSelectors";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { onServerMaintenanceUpdated } from "../wsNativeApi";
import { useProviderStatusesForLocalConfig } from "~/hooks/useProviderStatusesForLocalConfig";
import { useRefreshProviderStatusesNow } from "~/hooks/useProviderStatusRefresh";
import { resolveProviderSendAvailabilityWithRefresh } from "~/lib/providerAvailability";
import { toastManager } from "~/components/ui/toast";
import {
  Sidebar,
  SIDEBAR_OFFCANVAS_MOTION_CLASS,
  SIDEBAR_OFFCANVAS_MOTION_SUPPRESSED_CLASS,
  SidebarInstanceProvider,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from "~/components/ui/sidebar";
import { SidebarLeadingControls } from "~/components/SidebarHeaderNavigationControls";
import { DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS } from "~/hooks/useDesktopTopBarGutter";
import { CHAT_SURFACE_HEADER_HEIGHT_CLASS } from "~/components/chat/chatHeaderControls";
import type { SidebarResizableOptions } from "~/components/ui/sidebar";
import { cn, getNavigatorPlatform, isMacPlatform } from "~/lib/utils";
import { isIdeEmbeddedRuntime } from "../ide-mode";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

// Single source of truth for the thread sidebar resize behavior. Shared by <Sidebar>
// and the detached content-seam <SidebarRail> (via SidebarInstanceProvider) so the
// drag handle keeps working even though the rail lives outside <Sidebar> (above the card).
const THREAD_SIDEBAR_RESIZABLE: SidebarResizableOptions = {
  minWidth: THREAD_SIDEBAR_MIN_WIDTH,
  shouldAcceptWidth: ({ nextWidth, wrapper }) =>
    wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
  storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
};
const MAINTENANCE_EVENT_STALE_MS = 5 * 60 * 1000;

type MaintenanceToastId = ReturnType<typeof toastManager.add>;

function ThreadRetentionMaintenanceToast() {
  const toastIdRef = useRef<MaintenanceToastId | null>(null);

  useEffect(() => {
    return onServerMaintenanceUpdated((event) => {
      if (event.type !== "maintenance" || event.payload.task !== "thread-retention") {
        return;
      }

      // `deletedCount` is the legacy wire name; retention now archives.
      const { state, deletedCount: archivedCount, totalCount, error } = event.payload;
      const eventMs = Date.parse(event.payload.at);
      const isStaleEvent = Number.isFinite(eventMs)
        ? Date.now() - eventMs > MAINTENANCE_EVENT_STALE_MS
        : false;
      if (isStaleEvent && toastIdRef.current === null) {
        return;
      }

      if (state === "started") {
        toastIdRef.current = toastManager.add({
          type: "loading",
          title: "Archiving old chats...",
          description: "Preparing background maintenance.",
          timeout: 0,
          data: { allowCrossThreadVisibility: true },
        });
        return;
      }

      if (state === "progress") {
        const toastId =
          toastIdRef.current ??
          toastManager.add({
            type: "loading",
            title: "Archiving old chats...",
            timeout: 0,
            data: { allowCrossThreadVisibility: true },
          });
        toastIdRef.current = toastId;
        toastManager.update(toastId, {
          type: "loading",
          title: "Archiving old chats...",
          description:
            totalCount && totalCount > 0
              ? `${archivedCount ?? 0} of ${totalCount} chats archived.`
              : `${archivedCount ?? 0} chats archived.`,
          timeout: 0,
          data: { allowCrossThreadVisibility: true },
        });
        return;
      }

      if (state === "failed") {
        const toastId = toastIdRef.current;
        toastIdRef.current = null;
        if (toastId) {
          toastManager.update(toastId, {
            type: "warning",
            title: "Chat maintenance paused",
            description: error ?? "Old chats will be retried later.",
            timeout: 6000,
            data: { allowCrossThreadVisibility: true },
          });
          return;
        }
        toastManager.add({
          type: "warning",
          title: "Chat maintenance paused",
          description: error ?? "Old chats will be retried later.",
          timeout: 6000,
          data: { allowCrossThreadVisibility: true },
        });
        return;
      }

      const toastId = toastIdRef.current;
      toastIdRef.current = null;
      if (!toastId) return;
      toastManager.update(toastId, {
        type: "success",
        title: "Old chats archived",
        description:
          archivedCount && archivedCount > 0
            ? `${archivedCount} old chats moved to Settings → Archived, where you can restore them.`
            : "No old chats needed archiving.",
        timeout: 3500,
        data: { allowCrossThreadVisibility: true },
      });
    });
  }, []);

  return null;
}

function resolveBrowserNavigationShortcut(
  event: KeyboardEvent,
  platform: string,
): "back" | "forward" | null {
  const isMac = isMacPlatform(platform);
  const key = event.key.toLowerCase();

  if (
    isMac &&
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    (key === "[" || key === "]")
  ) {
    return key === "[" ? "back" : "forward";
  }

  if (
    !isMac &&
    event.altKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    (event.key === "ArrowLeft" || event.key === "ArrowRight")
  ) {
    return event.key === "ArrowLeft" ? "back" : "forward";
  }

  return null;
}

function isRecentViewSwitcherCommitKey(event: KeyboardEvent): boolean {
  return event.key === "Enter" || event.key === " " || event.key === "Spacebar";
}

function ChatRouteGlobalShortcuts() {
  const navigate = useNavigate();
  const { toggleSidebar } = useSidebar();
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadIdsSize = useThreadSelectionStore((state) => state.selectedThreadIds.size);
  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);
  const {
    activeContextThreadId,
    activeDraftThread,
    activeProjectId,
    activeThread,
    handleNewThread,
    projects,
  } = useHandleNewThread();
  const {
    recentSwitcherState,
    recentViewEntries,
    openOrAdvanceRecentSwitcher,
    commitRecentSwitcherSelection,
    cancelRecentSwitcher,
  } = useRecentViewSwitcher({
    activeContextThreadId,
    activeDraftThread,
    projects,
  });
  const { handleNewChat } = useHandleNewChat();
  const latestProjectId = useLatestProjectStore((state) => state.latestProjectId);
  const setLatestProjectId = useLatestProjectStore((state) => state.setLatestProjectId);
  const clearLatestProjectId = useLatestProjectStore((state) => state.clearLatestProjectId);
  const threadsHydrated = useStore((state) => state.threadsHydrated);
  const selectProjectLastActivityAt = useMemo(() => createProjectLastActivityAtSelector(), []);
  const projectLastActivityAt = useStore(selectProjectLastActivityAt);
  useTemporaryThreadLifecycle(activeContextThreadId);
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const keybindings = serverConfigQuery.data?.keybindings ?? EMPTY_KEYBINDINGS;
  const platform = getNavigatorPlatform();
  const providerStatuses = useProviderStatusesForLocalConfig();
  const refreshProviderStatuses = useRefreshProviderStatusesNow();
  const activeThreadTerminalState = activeContextThreadId
    ? selectThreadTerminalState(terminalStateByThreadId, activeContextThreadId)
    : null;
  const terminalOpen = activeThreadTerminalState?.terminalOpen ?? false;
  const activeProject =
    activeProjectId !== null
      ? (projects.find((project) => project.id === activeProjectId) ?? null)
      : null;
  const activeProjectScripts = activeProject?.kind === "project" ? activeProject.scripts : [];
  const terminalWorkspaceOpen = shouldRenderTerminalWorkspace({
    presentationMode: activeThreadTerminalState?.presentationMode ?? "drawer",
    terminalOpen,
  });
  const currentProjectId = resolveCurrentProjectTargetId(projects, activeProject?.id ?? null);
  const latestUsableProjectId = useMemo(
    () =>
      resolveLatestProjectTargetIdWithFallback(
        projects,
        latestProjectId,
        projectLastActivityAt,
      ),
    [latestProjectId, projectLastActivityAt, projects],
  );
  // Deliberately unscoped: the persisted id is only cleared once the project is gone from
  // the app entirely, not merely absent from the list a shortcut happens to look at.
  const persistedLatestProjectStillExists = resolveLatestProjectTargetId(projects, latestProjectId);
  const handleNewChatForActiveSurface = useCallback(() => handleNewChat(), [handleNewChat]);

  useEffect(() => {
    if (!currentProjectId) {
      return;
    }
    setLatestProjectId(currentProjectId);
  }, [currentProjectId, setLatestProjectId]);

  useEffect(() => {
    if (threadsHydrated && latestProjectId && persistedLatestProjectStillExists === null) {
      clearLatestProjectId(latestProjectId);
    }
  }, [clearLatestProjectId, latestProjectId, persistedLatestProjectStillExists, threadsHydrated]);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const shortcutContext = {
        terminalFocus: isTerminalFocused(),
        terminalOpen,
        terminalWorkspaceOpen,
      };

      if (recentSwitcherState && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelRecentSwitcher();
        return;
      }

      if (recentSwitcherState && isRecentViewSwitcherCommitKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        commitRecentSwitcherSelection();
        return;
      }

      if (isKeyboardShortcutsHelpShortcut(event, platform)) {
        event.preventDefault();
        event.stopPropagation();
        setShortcutsDialogOpen(true);
        return;
      }

      const appNavigationShortcut = isElectron
        ? resolveBrowserNavigationShortcut(event, platform)
        : null;
      if (appNavigationShortcut) {
        event.preventDefault();
        event.stopPropagation();
        const navigationState = resolveAppNavigationState();
        if (appNavigationShortcut === "back" && navigationState.canGoBack) {
          goBackInAppHistory();
        }
        if (appNavigationShortcut === "forward" && navigationState.canGoForward) {
          goForwardInAppHistory();
        }
        return;
      }

      if (event.key === "Escape" && selectedThreadIdsSize > 0) {
        event.preventDefault();
        clearSelection();
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, { context: shortcutContext });
      if (command === "sidebar.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleSidebar();
        return;
      }

      if (!command) return;

      if (command === "view.recent.next" || command === "view.recent.previous") {
        event.preventDefault();
        event.stopPropagation();
        // Ignore auto-repeat: holding Ctrl+Tab should not race-advance the selection.
        if (event.repeat) return;
        openOrAdvanceRecentSwitcher(command === "view.recent.next" ? "next" : "previous");
        return;
      }

      if (command === "chat.newChat" || command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        void handleNewChatForActiveSurface();
        return;
      }

      if (command === "chat.newLatestProject") {
        if (!latestUsableProjectId) return;
        event.preventDefault();
        event.stopPropagation();
        void handleNewThread(latestUsableProjectId);
        return;
      }

      if (command === "chat.newTerminal") {
        const target = resolveNewThreadTarget({ currentProjectId, latestUsableProjectId });
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        void handleNewThread(target.projectId, {
          ...(target.inheritContext
            ? resolveInheritedThreadContext({ activeThread, activeDraftThread })
            : {}),
          entryPoint: "terminal",
        });
        return;
      }

      if (
        command === "chat.newClaude" ||
        command === "chat.newCodex" ||
        command === "chat.newCursor"
      ) {
        const provider =
          command === "chat.newClaude"
            ? "claudeAgent"
            : command === "chat.newCodex"
              ? "codex"
              : "cursor";
        const target = resolveNewThreadTarget({ currentProjectId, latestUsableProjectId });
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        void (async () => {
          const providerAvailability = await resolveProviderSendAvailabilityWithRefresh({
            provider,
            statuses: providerStatuses,
            refreshStatuses: () => refreshProviderStatuses({ silent: true }),
          });
          if (!providerAvailability.usable) {
            toastManager.add({
              type: "error",
              title: providerAvailability.unavailableReason,
            });
            return;
          }
          await handleNewThread(target.projectId, { provider });
        })();
        return;
      }

      if (command !== "chat.new") return;
      // Fall back to the most recent project when none is focused and let the
      // shared bootstrap apply that project's preferred environment.
      const target = resolveNewThreadTarget({ currentProjectId, latestUsableProjectId });
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      void handleNewThread(target.projectId);
    };

    window.addEventListener("keydown", onWindowKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, { capture: true });
    };
  }, [
    activeDraftThread,
    activeThread,
    cancelRecentSwitcher,
    clearSelection,
    commitRecentSwitcherSelection,
    currentProjectId,
    handleNewChatForActiveSurface,
    handleNewThread,
    keybindings,
    latestUsableProjectId,
    openOrAdvanceRecentSwitcher,
    platform,
    providerStatuses,
    refreshProviderStatuses,
    recentSwitcherState,
    selectedThreadIdsSize,
    terminalOpen,
    terminalWorkspaceOpen,
    toggleSidebar,
  ]);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "toggle-sidebar") {
        toggleSidebar();
        return;
      }
      if (action !== "open-settings") return;
      void navigate({ to: "/settings" });
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate, toggleSidebar]);

  return (
    <>
      <ShortcutsDialog
        open={shortcutsDialogOpen}
        onOpenChange={setShortcutsDialogOpen}
        keybindings={keybindings}
        projectScripts={activeProjectScripts}
        platform={platform}
        context={{
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          terminalWorkspaceOpen,
        }}
      />
      {recentSwitcherState ? (
        <RecentViewSwitcher
          entries={recentViewEntries}
          selectedIndex={recentSwitcherState.selectedIndex}
        />
      ) : null}
    </>
  );
}

/** Subtle top-corner sheen on the sidebar gap. The sidebar always sits on the left, so
 *  the radial highlight is anchored to the top-left corner. */
const SIDEBAR_GAP_CLASS =
  "overflow-hidden before:absolute before:inset-0 before:bg-[radial-gradient(90%_75%_at_0%_0%,rgba(255,255,255,0.06),transparent_58%),linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.008))] dark:before:bg-[radial-gradient(90%_75%_at_0%_0%,rgba(255,255,255,0.04),transparent_58%),linear-gradient(180deg,rgba(255,255,255,0.018),rgba(255,255,255,0.006))]";

/** No inline-start/end border: the chat content card provides the edge (rounded + overlap).
 *  A sidebar border here draws a full-height vertical line through the titlebar seam. */
const SIDEBAR_INNER_CLASS = "app-sidebar-surface";

function ChatRouteLayout() {
  // The IDE embeds the chat surface in a compact dock. The host sets this flag
  // before importing the web bundle, so the first render can omit the standalone
  // thread sidebar and its titlebar controls while keeping the route/provider
  // context available to the Outlet.
  const isIdeEmbedded = isIdeEmbeddedRuntime();
  // Keep the shell toggle outside the route component's ephemeral state. The
  // route remounts when the active chat surface changes, so a plain useState
  // would reopen the sidebar every time the user navigates or relaunches Cedia.
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    isIdeEmbedded ? false : readSidebarUiState().sidebarOpen,
  );
  // Mirror the right dock: mount (and any remount from route changes) with motion
  // suppressed, then enable after the first painted frame. Animating from a stale
  // geometry flashes the transition strip. (Cedia addition.)
  const [sidebarMotionSuppressed, setSidebarMotionSuppressed] = useState(true);
  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => setSidebarMotionSuppressed(false));
    return () => window.cancelAnimationFrame(frameId);
  }, []);
  const sidebarMotionClass = sidebarMotionSuppressed
    ? SIDEBAR_OFFCANVAS_MOTION_SUPPRESSED_CLASS
    : SIDEBAR_OFFCANVAS_MOTION_CLASS;
  // The thread sidebar is a transparent vibrancy surface. That reads as dark glass over a
  // dark desktop, but in light mode dark wallpaper (or a black clear color) shows through
  // and the dark-ink labels go unreadable - so the sidebar is only transparent in dark
  // mode, and takes the solid sidebar token in light mode. (Cedia addition.)
  const { resolvedTheme } = useTheme();
  const handleSidebarOpenChange = useCallback((open: boolean) => {
    setSidebarOpen(open);
    persistSidebarUiState({ ...readSidebarUiState(), sidebarOpen: open });
  }, []);
  useEffect(() => subscribeSidebarUiState((state) => setSidebarOpen(state.sidebarOpen)), []);
  const resolvedSidebarOpen = isIdeEmbedded ? false : sidebarOpen;

  // The thread sidebar always lives on the left; the right dock is a separate surface.
  const sidebarElement = isIdeEmbedded ? null : (
    <Sidebar
      side="left"
      collapsible="offcanvas"
      // Match the right dock's soft drawer slide (shared token) instead of the
      // shell's default `ease-linear`. Applied to the container + gap in lockstep.
      className={cn(
        "text-foreground",
        sidebarMotionClass,
        // In light mode the sidebar is opaque (Cedia), so the container's own border-r
        // would stack with the content card's seam shadow into a dark edge; drop it and
        // let the seam carry the divider alone. Dark keeps the existing edge.
        resolvedTheme === "dark" ? null : "group-data-[side=left]:border-r-0",
      )}
      gapClassName={cn(
        SIDEBAR_GAP_CLASS,
        sidebarMotionClass,
        // The panel slides on the compositor thread while the gap/content resize on the
        // main thread: under load the content trails a few frames and the vacated strip
        // goes see-through (dark flicker). In light mode the gap carries the solid
        // sidebar token so the strip stays painted through the whole transition; dark
        // keeps the glass gap. (Cedia addition.)
        resolvedTheme === "dark" ? null : "bg-sidebar",
      )}
      innerClassName={cn(
        SIDEBAR_INNER_CLASS,
        // A backdrop blur over a transparent body resamples every animation frame and
        // flashes black while the panel slides (Chromium compositor quirk). In light mode
        // the surface is opaque anyway, so the blur is pure cost plus flicker risk: drop
        // it there and keep the glass in dark mode. (Cedia addition.)
        resolvedTheme === "dark" ? null : "[backdrop-filter:none] [-webkit-backdrop-filter:none]",
      )}
      transparentSurface={resolvedTheme === "dark"}
      resizable={THREAD_SIDEBAR_RESIZABLE}
    >
      <ThreadSidebar />
    </Sidebar>
  );

  // Chat column shell. The content-seam rail is the resize hit-area for the seam —
  // the visible straight divider + depth shadow live on the route surface (see
  // `.chat-content-card` in index.css). It sits OUTSIDE <Sidebar> so it stacks above
  // the card, so SidebarInstanceProvider re-supplies the same resize config/side it
  // would have gotten inside <Sidebar> (otherwise dragging to resize stops working).
  // `data-sidebar-side` on the provider selects the seam geometry.
  // Cedia §10 item 55: this column must be exactly the viewport tall. The shell used to
  // carry `h-svh` AND the status bar was appended after it inside the same column, so the
  // column measured `100svh + statusBarHeight` inside a `min-h-svh` wrapper: the bar was
  // pushed ~24px below the fold (measured in the packaged window, and only visible as
  // passing when the wrapper happened to be scrolled). The column owns the viewport height
  // and the shell flexes inside it, so the bar keeps its own row at the foot.
  const mainContentShell = (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {isIdeEmbedded ? null : (
        <SidebarInstanceProvider side="left" resizable={THREAD_SIDEBAR_RESIZABLE}>
          <SidebarRail placement="content-seam" />
        </SidebarInstanceProvider>
      )}
      <Outlet />
    </div>
  );

  // Keep one sidebar trigger in the fixed route shell. The trigger must not live
  // inside the sliding sidebar: doing so makes it travel a full sidebar width
  // during the off-canvas transition and creates a duplicate when the host header
  // takes over in the closed state. The gutter is zoom-aware and keeps it clear of
  // macOS traffic lights at the same x-coordinate in both states.
  const shellNavigationControls = (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[70] hidden items-center md:flex",
        CHAT_SURFACE_HEADER_HEIGHT_CLASS,
      )}
    >
      <SidebarLeadingControls
        className={cn(
          "pointer-events-auto",
          DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS,
        )}
      />
    </div>
  );

  return (
    <SidebarProvider
      defaultOpen
      open={resolvedSidebarOpen}
      onOpenChange={handleSidebarOpenChange}
      shellNavigationOwner={isElectron}
      // The provider shell is the static backdrop behind the sliding panel, the
      // shrinking gap and the growing content. Upstream leaves it transparent for the
      // glass window; in Cedia's opaque window any pixel it leaves uncovered paints
      // black, which flashed on every sidebar close in light mode. Opaque in light,
      // glass in dark. (Cedia addition.)
      // Cedia §10 item 55: the bundle-drawn status bar lives at the foot of this
      // column so it spans the content width under every route; hidden in the IDE
      className={resolvedTheme === "dark" ? "bg-[var(--app-shell-background)]" : "bg-background"}
      data-sidebar-side="left"
    >
      <ThreadRetentionMaintenanceToast />
      <ChatRouteGlobalShortcuts />
      {sidebarElement}
      <div className="flex h-svh min-h-0 min-w-0 flex-1 flex-col">
        {mainContentShell}
        {isIdeEmbedded ? null : <CediaStatusBar />}
      </div>
      {isElectron && !isIdeEmbedded ? shellNavigationControls : null}
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_chat")({
  component: ChatRouteLayout,
});
