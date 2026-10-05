// FILE: RightDock.tsx
// Purpose: Tabbed multi-pane right sidebar shell (browser, diff, terminal, sidechat, git).
// Layer: Chat right-dock UI
// Depends on: ui/sidebar primitive, right-dock pane metadata, and a caller-provided pane renderer.

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Schema } from "effect";

import { cn } from "~/lib/utils";
import { useIsMobile } from "~/hooks/useMediaQuery";
import { getLocalStorageItem } from "~/hooks/useLocalStorage";
import {
  type DockPaneRuntimeMode,
  EMPTY_PANE_ID_SET,
  reconcileKeepMountedPaneIds,
} from "~/lib/dockPaneActivation";
import {
  PanelRightCloseIcon,
  PlusIcon,
} from "~/lib/icons";
import type {
  RightDockPane,
  RightDockPaneKind,
  RightDockThreadState,
} from "~/rightDockStore.logic";
import { resolveActivePane } from "~/rightDockStore.logic";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import {
  Sidebar,
  SIDEBAR_OFFCANVAS_MOTION_CLASS,
  SIDEBAR_OFFCANVAS_MOTION_SUPPRESSED_CLASS,
  SidebarProvider,
  SidebarRail,
  type SidebarResizableOptions,
} from "../ui/sidebar";
import { CHAT_BACKGROUND_CLASS_NAME } from "./composerPickerStyles";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import {
  DOCK_HEADER_ICON_BUTTON_CLASS,
  SurfaceTabChip,
} from "./chatHeaderControls";
import {
  getRightDockPaneMeta,
  type RightDockLauncherItem,
  resolveRightDockPaneIcon,
  resolveRightDockPaneLabel,
} from "./rightDockPaneMeta";
import { useDesktopTopBarWindowControlsGutterClassName } from "~/hooks/useDesktopTopBarGutter";

// Shared sizing defaults for dock hosts: the resize floor for a single readable pane and the
// "half the shell, but never cramped" opening width. The thread route tunes its own values
// around the composer; simpler hosts (e.g. the /pull-requests route) use these as-is.
export const RIGHT_DOCK_MIN_WIDTH = 26 * 16;
export const RIGHT_DOCK_DEFAULT_WIDTH = "max(28rem, calc(50vw - 8rem))";
export const RIGHT_DOCK_WIDTH_STORAGE_KEY = "chat_right_dock_width";
const RIGHT_DOCK_CHAT_MIN_WIDTH = 320;
const RIGHT_DOCK_WIDTH_VAR = "--cedia-right-dock-width";
const RIGHT_DOCK_MAX_WIDTH_VAR = "--cedia-right-dock-max-width";

// Pane kinds whose content has a natural width, opened at that size rather than
// at the even split. The device pane frames a portrait phone, so its useful
// width is whatever lets the phone reach full height: a ~19.5:9 chassis stays
// height-bound well past 480px, and opening narrower only shrinks the device
// while leaving empty space above and below it.
const RIGHT_DOCK_PREFERRED_WIDTH: Partial<Record<RightDockPaneKind, number>> = {
  device: 38 * 16,
};

interface RightDockProps {
  state: RightDockThreadState;
  minWidth: number;
  defaultWidth: string;
  shouldAcceptWidth: (context: {
    nextWidth: number;
    wrapper: HTMLElement;
  }) => boolean;
  paneLabelOverrides?: Record<string, string | undefined>;
  // Per-pane tab glyph overrides (same shape as label overrides) — e.g. a pull request pane
  // swapping the generic kind icon for its live state glyph.
  paneIconOverrides?: Record<string, ReactNode | undefined>;
  addMenuKinds: readonly RightDockPaneKind[];
  launcherItems?: readonly RightDockLauncherItem[];
  // Single-pane hosts omit selection so their lone tab label is static; multi-pane chat hosts
  // provide the callback and keep the normal selectable-tab behavior.
  onSelectPane?: ((paneId: string) => void) | undefined;
  onClosePane: (paneId: string) => void;
  onCollapse: () => void;
  /**
   * Hosts that also render a closed-state toggle can align the dock's open-state
   * button with that control. Standalone dock hosts keep the historical label.
   */
  collapseLabel?: string;
  collapseTooltip?: string;
  /** The host has a persistent 48px right rail that owns the panel toggle. */
  collapseInShell?: boolean;
  /** Optional drag-local width guard; avoids synchronous layout probes per frame. */
  beginResize?: SidebarResizableOptions["beginResize"];
  onOpenChange: (open: boolean) => void;
  onAddPane: (kind: RightDockPaneKind) => void;
  motionKey?: string;
  activePaneRuntimeMode?: DockPaneRuntimeMode;
  browserRuntimeMode?: DockPaneRuntimeMode;
  renderPane: (
    pane: RightDockPane,
    context: {
      runtimeMode: DockPaneRuntimeMode;
      isActive: boolean;
      isVisible: boolean;
    },
  ) => ReactNode;
}

function RightDockLauncher(props: {
  items: readonly RightDockLauncherItem[];
  onOpen: (kind: RightDockPaneKind) => void;
}) {
  return (
    <nav
      aria-label="Open a panel"
      className="flex h-full min-h-0 w-full items-stretch justify-center overflow-y-auto p-1"
    >
      <div className="flex w-full min-w-0 flex-col gap-1">
        {props.items.map(({ kind, Icon, label }) => (
          <Button
            key={kind}
            variant="subtle"
            size="xl"
            className="h-11 w-full justify-start gap-3 rounded-xl px-4 text-[length:var(--app-font-size-ui-lg,13px)] font-normal"
            aria-label={`Open ${label}`}
            onClick={() => props.onOpen(kind)}
          >
            <Icon className="size-4 shrink-0" />
            <span>{label}</span>
          </Button>
        ))}
      </div>
    </nav>
  );
}

function RightDockTab(props: {
  pane: RightDockPane;
  label: string;
  icon?: ReactNode;
  active: boolean;
  onSelect?: (() => void) | undefined;
  onClose: () => void;
}) {
  return (
    <SurfaceTabChip
      active={props.active}
      title={props.label}
      label={props.label}
      labelClassName="max-w-[10rem]"
      icon={props.icon ?? resolveRightDockPaneIcon(props.pane)}
      closeLabel={`Close ${props.label}`}
      onSelect={props.onSelect}
      onClose={props.onClose}
    />
  );
}

// Persist which keep-mounted panes (e.g. terminals) have been activated so they
// stay in the DOM while another tab is selected, pruned to live panes so closed
// panes drop out and the set never leaks across thread switches. The set is
// The rendered set is derived synchronously so a kept pane never unmounts for a
// frame. A layout effect commits that set for the next render without mutating a
// ref during render (which is unsafe when React replays or abandons work).
function useKeepMountedPaneIds(
  panes: readonly RightDockPane[],
  activePane: RightDockPane | null,
): ReadonlySet<string> {
  const [committedPaneIds, setCommittedPaneIds] =
    useState<ReadonlySet<string>>(EMPTY_PANE_ID_SET);
  const activePaneId = activePane?.id ?? null;
  const activePaneKind = activePane?.kind ?? null;
  const renderedPaneIds = reconcileKeepMountedPaneIds({
    previous: committedPaneIds,
    panes,
    activePaneId,
    activePaneKind,
  });

  useLayoutEffect(() => {
    setCommittedPaneIds((current) => {
      const next = reconcileKeepMountedPaneIds({
        previous: current,
        panes,
        activePaneId,
        activePaneKind,
      });
      if (
        next.size === current.size &&
        [...next].every((paneId) => current.has(paneId))
      ) {
        return current;
      }
      return next;
    });
  }, [activePaneId, activePaneKind, panes]);

  return renderedPaneIds;
}

export function RightDock(props: RightDockProps) {
  const activePane = resolveActivePane(props.state);
  const onSelectPane = props.onSelectPane;
  const activePaneRuntimeMode = props.activePaneRuntimeMode ?? "live";
  const browserRuntimeMode = props.browserRuntimeMode ?? "live";
  // The dock is the right-most surface when open, so its header sits under the
  // fixed Windows caption cluster — reserve the same gutter the chat header uses.
  const desktopTopBarWindowControlsGutterClassName =
    useDesktopTopBarWindowControlsGutterClassName();

  const keepMountedPaneIds = useKeepMountedPaneIds(
    props.state.panes,
    activePane,
  );
  // Measure the available shell for the first-open default. Once the user drags
  // the divider, the shared sidebar primitive restores their saved width.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const isMobile = useIsMobile();
  // No in-card maximize: the width loop behind it fought the drawer
  // ("infinite extend") and crowded the tab strip. The dock fills its card.
  const [maxDockWidth, setMaxDockWidth] = useState<number | null>(null);
  const minWidth = props.minWidth;
  useLayoutEffect(() => {
    if (!props.collapseInShell || isMobile) {
      setMaxDockWidth(null);
      return;
    }
    const wrapper = contentRef.current?.closest<HTMLElement>(
      "[data-slot='sidebar-wrapper']",
    );
    if (!wrapper) {
      return;
    }
    // The route's outer shell owns the left thread sidebar. Measuring that shell (rather
    // than the dock's immediate chat column) keeps the clamp correct when the left rail
    // expands/collapses while the viewport itself stays the same width.
    const shell =
      wrapper.closest<HTMLElement>("[data-sidebar-side='left']") ??
      wrapper.parentElement;
    if (!shell) {
      return;
    }
    const updateMaxDockWidth = () => {
      const shellWidth = shell.getBoundingClientRect().width;
      const leftSidebarWidth =
        shell
          .querySelector<HTMLElement>("[data-slot='sidebar'][data-side='left']")
          ?.getBoundingClientRect().width ?? 0;
      const rightRailWidth =
        shell
          .querySelector<HTMLElement>("[data-right-tool-rail]")
          ?.getBoundingClientRect().width ?? 0;
      // Skip while the row is not measurable. The clamp only ever NARROWS:
      // maxDockWidth starts null (no cap) and updateMaxDockWidth can only
      // lower the painted width, never raise it. Running it on a zero shell
      // (first paint / hidden harness, shellWidth 0, no sidebar/rail widths)
      // collapses the cap to minWidth (256px) and the live-width rewrite
      // below then stamps 256px over the good restore ("all drags frozen
      // at 256"). A real narrow shell still reports its rail width, so it
      // keeps clamping.
      if (shellWidth <= 0 || (leftSidebarWidth <= 0 && rightRailWidth <= 0)) {
        return;
      }
      const availableWidth = Math.max(
        0,
        shellWidth - leftSidebarWidth - rightRailWidth,
      );
      // availableWidth already excludes the rail: clamp to (row − rail −
      // chat-min) so a big persisted width can't squeeze the conversation to
      // zero in narrow shells (the "121px conversation" failure). Floor at
      // minWidth so the clamp never inverts.
      const nextMaxDockWidth = Math.max(
        minWidth,
        Math.min(availableWidth / 2, 27.5 * 16),
        // Cedia 3-card row: cap the dock at 27.5rem (440px) — never 50vw.
        Math.min(availableWidth - RIGHT_DOCK_CHAT_MIN_WIDTH, 27.5 * 16),
      );
      // Enforce the clamp on the live width too: maxDockWidth only caps the
      // CSS min() for FUTURE renders, but a 544px --sidebar-width restored
      // from storage stays painted until something rewrites it.
      const liveWidth = wrapper.style.getPropertyValue("--sidebar-width");
      if (liveWidth) {
        const livePx = Number.parseFloat(liveWidth);
        if (Number.isFinite(livePx) && livePx > nextMaxDockWidth) {
          wrapper.style.setProperty("--sidebar-width", `${nextMaxDockWidth}px`);
        }
      }
    };
    updateMaxDockWidth();
    const observer = new ResizeObserver(updateMaxDockWidth);
    observer.observe(shell);
    const leftSidebar = shell.querySelector<HTMLElement>(
      "[data-slot='sidebar'][data-side='left']",
    );
    if (leftSidebar) {
      observer.observe(leftSidebar);
    }
    return () => {
      observer.disconnect();
      setMaxDockWidth(null);
    };
  }, [isMobile, props.collapseInShell]);
  const activePaneKind = activePane?.kind ?? null;
  useEffect(() => {
    if (!props.state.open) {
      return;
    }
    const wrapper = contentRef.current?.closest<HTMLElement>(
      "[data-slot='sidebar-wrapper']",
    );
    const shell = wrapper?.parentElement;
    if (!wrapper || !shell) {
      return;
    }
    // A user-resized dock is durable across pane switches, collapse/reopen, and
    // relaunch. The SidebarRail owns the write and initial restore; this effect
    // only supplies a first-open width when no saved value exists.
    let persistedWidth: number | null = null;
    try {
      persistedWidth = getLocalStorageItem(
        RIGHT_DOCK_WIDTH_STORAGE_KEY,
        Schema.Finite,
      );
    } catch {
      // A corrupt storage entry is handled by the SidebarRail's normal fallback.
    }
    if (persistedWidth !== null) {
      return;
    }
    // A phone-shaped pane has a natural width: half the shell leaves the device
    // stranded in empty space, so kinds that render a fixed-aspect object open
    // at their own comfortable size instead of the even split.
    const preferredWidth = activePaneKind
      ? RIGHT_DOCK_PREFERRED_WIDTH[activePaneKind]
      : undefined;
    const openWidth =
      preferredWidth ?? Math.round(shell.getBoundingClientRect().width / 2);
    if (openWidth > 0) {
      wrapper.style.setProperty(
        "--sidebar-width",
        `${Math.max(minWidth, openWidth)}px`,
      );
    }
  }, [props.state.open, minWidth, activePaneKind]);
  const renderedPanes = props.state.panes.filter(
    (pane) => pane.id === activePane?.id || keepMountedPaneIds.has(pane.id),
  );
  // Motion: the drawer transition runs on EVERY open/close (same 300ms token
  // as the left card). Suppression is mount-only (first paint / remount with
  // a new motionKey) — never on toggle. The old motionKey-gated suppression
  // re-fired on open/close and stapled `transition-none` onto the closing
  // frame, so close always snapped ("close reads faster than left"). The
  // 2-frame delay dance couldn't fix it: any suppression that touches the
  // toggle commit kills the animation. Mount-only suppression can't.
  const [motionState, setMotionState] = useState<{
    key: RightDockProps["motionKey"];
    allow: boolean;
  }>(() => ({ key: props.motionKey, allow: !props.state.open }));
  const shouldSuppressChromeMotion = !(
    motionState.key === props.motionKey && motionState.allow
  );

  useEffect(() => {
    if (!shouldSuppressChromeMotion) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      setMotionState({ key: props.motionKey, allow: true });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [props.motionKey, shouldSuppressChromeMotion]);

  // Same token the left card uses (ui/sidebar SIDEBAR_OFFCANVAS_MOTION_CLASS):
  // gap + container animate width in lockstep, 300ms soft drawer. A local
  // copy would drift the next time the left token changes — import it.
  const chromeMotionClass = shouldSuppressChromeMotion
    ? SIDEBAR_OFFCANVAS_MOTION_SUPPRESSED_CLASS
    : SIDEBAR_OFFCANVAS_MOTION_CLASS;

  return (
    <SidebarProvider
      defaultOpen={false}
      open={props.state.open}
      onOpenChange={props.onOpenChange}
      // In-flow like the left card: the provider is a flex item in the shared
      // card, NOT a zero-width shell with an absolute overlay. The Sidebar gap
      // reserves dock width in the row and the container slides it — same
      // width-drawer motion as the left panel, no sweep under the rail.
      // min-w-0: never force the shared card wider than the row (the rail
      // spilling 47px past the card edge in the narrow harness).
      className="min-h-0 min-w-0 flex-none overflow-hidden bg-transparent"
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        reopenOnDrag
        className={cn(
          // Card chrome lives on the ChatRightCards wrapper (one shared card
          // with the rail) — no per-panel border/seam here, or the edge
          // doubles where dock meets rail (the "two cards" look).
          "border-0 bg-transparent shadow-none",
          "text-foreground",
          // Cedia card layout: below-header geometry (top clears the 46px
          // window header + 4px stage gap, bottom 4px — no status-bar notch,
          // the mockup has no footer) arrives via the shell outlet inline
          // style so the width slide here stays untouched.
          "cedia-dock-card",
          // Drawer motion ONLY from the shared token: the Sidebar base owns
          // `transition-[width] duration-200 ease-linear`. The plain
          // `transition-none` loses to the base on specificity, so the 200ms
          // linear always wins — neutralize with `!` (same as the suppressed
          // token). Scoped to OPEN: `transition-none!` emits
          // `transition-property: none`, which also beats the drawer token —
          // leaving it on for close kills the w-0 animation ("fast close").
          // On close it drops off and the drawer transition animates w-0.
          props.state.open && "transition-none!",
          chromeMotionClass,
          // Width-drawer close like the left card: a closed offcanvas panel
          // rests at w-0 (width transition) instead of display:none — the old
          // `hidden` snapped with no transition ("missing transition").
          !props.state.open && "w-0 overflow-hidden",
          // In-flow width drawer like the left card: the gap reserves layout
          // and the panel width animates in lockstep (no clip-path wipe).
          // Stays pinned against the rail card, never translated under it.
          props.collapseInShell && "md:translate-x-0!",
        )}
        data-dock-maximized={undefined}
        // NOT inert on the Sidebar root: inert + w-0 would freeze the resize
        // rail and the tool-rail portal siblings ("tools dead", "can't drag").
        // Pane content gates its own inert per-pane below (isVisible), and the
        // wrapper card owns the one card surface (transparentSurface below),
        // so pane content keeps the theme background without a second edge.
        innerClassName={CHAT_BACKGROUND_CLASS_NAME}
        transparentSurface
        gapClassName={chromeMotionClass}
        resizable={useMemo(
          () => ({
            minWidth: props.minWidth,
            // Upper clamp for the stored-width restore path (clampSidebarWidth
            // does min(stored, maxWidth)): the dock can never exceed the row
            // cap, so a stale 800px+ value settles to the cap on mount instead
            // of squeezing the conversation to zero. 440px + 48px rail: the
            // rail's restore effect clamps via the same maxWidth, so both
            // clamps agree (a restore key WITHOUT maxWidth skips the clamp
            // and the 16rem provider default wins — "all restores stuck
            // at 256"). Memoized: an inline literal recreates `resizable`
            // every render and re-runs the restore effect mid-drag.
            maxWidth: 27.5 * 16 + 48,
            storageKey: RIGHT_DOCK_WIDTH_STORAGE_KEY,
            ...(props.beginResize ? { beginResize: props.beginResize } : {}),
            shouldAcceptWidth: (context) => {
              // Same 440+48 ceiling as maxWidth above.
              const maxAllowed = 27.5 * 16 + 48;
              if (context.nextWidth > maxAllowed) return false;
              return props.shouldAcceptWidth(context);
            },
          }),
          [props.beginResize, props.minWidth, props.shouldAcceptWidth],
        )}
      >
        <div
          ref={contentRef}
          data-right-dock-content
          // Clip the sliding panel: at w-0 mid-transition the pane content
          // (tabs, launcher) must narrow with the card, not spill over the
          // rail or center. Same overflow contract as the left card container.
          // min-w-0: the panel yields inside the shared card instead of forcing
          // it wider than the row allows (the "gap on the right" overflow).
          className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden"
        >
          <div
            className={cn(
              // One solid piece: no divider under the dock tab row — the wrapper
              // card owns the only border. A hairline here would read as a
              // second piece inside the right column.
              // min-w-0: tabs yield inside a narrow card instead of pushing the
              // trailing buttons (maximize/add) out of the card or under the
              // pane text (the "leak and lap" overlap). items-center keeps the
              // 28px icon buttons on the row midline with the tab chips.
              "flex min-w-0 shrink-0 items-center",
              props.collapseInShell && "cedia-chrome-header",
              "gap-1 px-1 [-webkit-app-region:no-drag]",
              desktopTopBarWindowControlsGutterClassName,
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              {/* Cedia (§3.E): the header always exposes the active pane, including
                  a single pane so its close action remains reachable. Two or more
                  panes keep the same tab row for switching. */}
              {props.state.panes.length > 0
                ? props.state.panes.map((pane) => (
                    <RightDockTab
                      key={pane.id}
                      pane={pane}
                      label={resolveRightDockPaneLabel(
                        pane,
                        props.paneLabelOverrides,
                      )}
                      icon={props.paneIconOverrides?.[pane.id]}
                      active={pane.id === props.state.activePaneId}
                      onSelect={
                        onSelectPane ? () => onSelectPane(pane.id) : undefined
                      }
                      onClose={() => props.onClosePane(pane.id)}
                    />
                  ))
                : null}
            </div>
            {props.state.panes.length > 0 && props.addMenuKinds.length > 0 ? (
              <Menu modal={false}>
                <MenuTrigger
                  render={
                    <Button
                      variant="chrome"
                      size="icon-xs"
                      aria-label="Add panel"
                      title="Add panel"
                      className={DOCK_HEADER_ICON_BUTTON_CLASS}
                    />
                  }
                >
                  <PlusIcon className="size-3.5" />
                </MenuTrigger>
                <ComposerPickerMenuPopup
                  align="end"
                  side="bottom"
                  className="w-44 min-w-44"
                >
                  {props.addMenuKinds.map((kind) => {
                    const { Icon, label } = getRightDockPaneMeta(kind);
                    return (
                      <MenuItem
                        key={kind}
                        onClick={() => props.onAddPane(kind)}
                      >
                        <Icon className="size-3.5 shrink-0" />
                        <span>{label}</span>
                      </MenuItem>
                    );
                  })}
                </ComposerPickerMenuPopup>
              </Menu>
            ) : null}
            {/* Maximize lives in the window header (like the left panel,
                which has no in-card maximize). An in-card maximize next to
                the tab strip crowds the narrow card, overlaps pane text, and
                its width loop fights the drawer ("infinite extend"). The dock
                fills its card by default; no in-card control needed. */}
            {props.collapseInShell ? null : (
              <IconButton
                variant="chrome"
                size="icon-xs"
                label={props.collapseLabel ?? "Collapse panel"}
                tooltip={props.collapseTooltip ?? "Collapse panel"}
                tooltipSide="bottom"
                className={DOCK_HEADER_ICON_BUTTON_CLASS}
                onClick={props.onCollapse}
              >
                <PanelRightCloseIcon />
              </IconButton>
            )}
          </div>
          <div className="relative min-h-0 flex-1">
            {activePane === null && props.launcherItems ? (
              <RightDockLauncher
                items={props.launcherItems}
                onOpen={props.onAddPane}
              />
            ) : null}
            {renderedPanes.map((pane) => {
              const isActive = pane.id === activePane?.id;
              const isVisible = isActive && props.state.open;
              // Keep-mounted panes that are not the active tab are already
              // hydrated; browser panes may use an explicit runtime mode so a
              // floating browser can own the live guest while the dock stays preview-only.
              const runtimeMode: DockPaneRuntimeMode =
                pane.kind === "browser"
                  ? browserRuntimeMode
                  : isActive
                    ? activePaneRuntimeMode
                    : "live";
              return (
                <div
                  key={pane.id}
                  className={cn(
                    "absolute inset-0 flex min-h-0 w-full",
                    isActive ? undefined : "invisible pointer-events-none",
                  )}
                  aria-hidden={isVisible ? undefined : true}
                  inert={isVisible ? undefined : true}
                  data-native-browser-surface={
                    pane.kind === "browser" &&
                    isActive &&
                    runtimeMode === "live"
                      ? "true"
                      : undefined
                  }
                >
                  {props.renderPane(pane, { runtimeMode, isActive, isVisible })}
                </div>
              );
            })}
          </div>
        </div>
        {/* Resize affordance for the dock↔center seam: the dock's own shell rail
            (same primitive the left card uses). Always mounted while the dock
            is mounted (open or width-collapsed): unmounting it on close kills
            the drag handle entirely ("can't drag to resize"). Closed-state
            reopen also rides this rail's drag, not just the tool icons.
            The full 16px hit target stays INSIDE the dock container: the
            provider shell + shared card both clip overflow, so the old -left-3
            offset parked 12px of the handle outside the clip where the center
            card wins the hit test and every real pointerdown misses
            ("drag to resize dead"). Same inside-the-clip contract as the left
            content-seam rail. */}
        <SidebarRail className="left-0!" />
      </Sidebar>
    </SidebarProvider>
  );
}

export default RightDock;
