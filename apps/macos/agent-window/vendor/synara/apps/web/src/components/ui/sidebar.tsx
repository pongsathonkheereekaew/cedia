import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useIsMobile } from "~/hooks/useMediaQuery";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { Schema } from "effect";
import { SidebarToggleIcon } from "../SidebarToggleIcon";

const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_MOBILE = "calc(100vw - var(--spacing(3)))";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_RESIZE_DEFAULT_MIN_WIDTH = 16 * 16;
/**
 * Cedia icon rail (item 71; owner decision 2026-10-02). Collapsed metrics are
 * measured against the Codex reference (47px rail, ~40px icon pitch): the rail
 * reuses the existing 3rem icon token, and the snap threshold mirrors the
 * approved drag mock (full 264px, snap midpoint, 48px rail).
 */
const SIDEBAR_ICON_RAIL_PX = 48;
const SIDEBAR_RAIL_SNAP_PX = 156;
/** Minimum rightward drag from the collapsed rail that reopens the sidebar. */
const SIDEBAR_RAIL_REOPEN_PX = 24;

/**
 * Soft "drawer" easing for the offcanvas open/close slide, overriding the shell's
 * default `duration-200 ease-linear` (which reads as stepped on wide surfaces). It
 * front-loads the motion and settles softly. Apply to BOTH the sliding container
 * (Sidebar `className`) and the layout `gapClassName` so they animate in lockstep.
 * Shared by the thread sidebar (left) and the right dock so the two slides match.
 */
const SIDEBAR_OFFCANVAS_MOTION_CLASS =
  "will-change-[transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:duration-0!";

/**
 * Suppresses the slide entirely — for first mount or a reposition/remount where
 * animating from the old geometry would look wrong. `!` beats the base duration/ease.
 */
const SIDEBAR_OFFCANVAS_MOTION_SUPPRESSED_CLASS = "transition-none! duration-0!";

type SidebarContextProps = {
  state: "expanded" | "collapsed";
  open: boolean;
  /** True when the route shell owns one fixed sidebar trigger for all states. */
  shellNavigationOwner: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

type SidebarResizableOptions = {
  maxWidth?: number;
  minWidth?: number;
  onResize?: (width: number) => void;
  /**
   * Create a drag-local width guard.  The guard is created once at pointer-down
   * and evaluated without re-measuring the DOM on every pointermove.  Heavy
   * layout probes belong here rather than in `shouldAcceptWidth`, which is the
   * legacy per-frame hook.
   */
  beginResize?: (context: {
    currentWidth: number;
    rail: HTMLButtonElement;
    side: "left" | "right";
    sidebarRoot: HTMLElement;
    wrapper: HTMLElement;
  }) => {
    shouldAcceptWidth: (nextWidth: number) => boolean;
    /** Clamp an over-wide candidate to the nearest readable width, if known. */
    clampWidth?: (nextWidth: number) => number;
    dispose?: () => void;
  } | null;
  shouldAcceptWidth?: (context: {
    currentWidth: number;
    nextWidth: number;
    rail: HTMLButtonElement;
    side: "left" | "right";
    sidebarRoot: HTMLElement;
    wrapper: HTMLElement;
  }) => boolean;
  storageKey?: string;
};

type SidebarResolvedResizableOptions = {
  maxWidth: number;
  minWidth: number;
  onResize?: (width: number) => void;
  beginResize?: SidebarResizableOptions["beginResize"];
  shouldAcceptWidth?: (context: {
    currentWidth: number;
    nextWidth: number;
    rail: HTMLButtonElement;
    side: "left" | "right";
    sidebarRoot: HTMLElement;
    wrapper: HTMLElement;
  }) => boolean;
  storageKey: string | null;
};

type SidebarInstanceContextProps = {
  resizable: SidebarResolvedResizableOptions | null;
  side: "left" | "right";
  collapsible: "offcanvas" | "icon" | "none";
  reopenOnDrag?: boolean;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);
const SidebarInstanceContext = React.createContext<SidebarInstanceContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

function SidebarProvider({
  defaultOpen: defaultOpenProp,
  open: openProp,
  onOpenChange: setOpenProp,
  shellNavigationOwner = false,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  shellNavigationOwner?: boolean;
}) {
  const defaultOpen = defaultOpenProp ?? true;
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen);
  const open = openProp ?? _open;
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value;
      if (setOpenProp) {
        setOpenProp(openState);
      } else {
        _setOpen(openState);
      }
    },
    [setOpenProp, open],
  );

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open);
  }, [isMobile, setOpen]);

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed";

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      isMobile,
      open,
      openMobile,
      shellNavigationOwner,
      setOpen,
      setOpenMobile,
      state,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, shellNavigationOwner, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        className={cn(
          "group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar",
          className,
        )}
        data-slot="sidebar-wrapper"
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

// Resolves user-facing resizable options into concrete bounds, or null when resizing
// is unavailable (mobile / non-collapsible / disabled). Shared by Sidebar and the
// detached content-seam rail so both agree on identical resize behavior.
function resolveSidebarResizable(
  resizable: boolean | SidebarResizableOptions,
  { collapsible, isMobile }: { collapsible: "offcanvas" | "icon" | "none"; isMobile: boolean },
): SidebarResolvedResizableOptions | null {
  if (isMobile || collapsible === "none" || !resizable) {
    return null;
  }
  const options = typeof resizable === "boolean" ? {} : resizable;
  return {
    maxWidth: options.maxWidth ?? Number.POSITIVE_INFINITY,
    minWidth: options.minWidth ?? SIDEBAR_RESIZE_DEFAULT_MIN_WIDTH,
    storageKey: options.storageKey ?? null,
    ...(options.onResize ? { onResize: options.onResize } : {}),
    ...(options.beginResize ? { beginResize: options.beginResize } : {}),
    ...(options.shouldAcceptWidth ? { shouldAcceptWidth: options.shouldAcceptWidth } : {}),
  };
}

// Supplies the per-instance sidebar context (side + resolved resize options) to a
// SidebarRail rendered OUTSIDE its <Sidebar> — e.g. the content-seam rail, which must
// stack above the chat card. Without this the detached rail has no resize config and
// silently degrades to toggle-only (the "can't drag" regression). Provide the SAME
// `resizable`/`side` here as on the matching <Sidebar>. Must be used inside a SidebarProvider.
function SidebarInstanceProvider({
  side,
  resizable,
  collapsible: collapsibleProp,
  reopenOnDrag,
  children,
}: {
  side: "left" | "right";
  resizable: boolean | SidebarResizableOptions;
  collapsible?: "offcanvas" | "icon" | "none";
  reopenOnDrag?: boolean;
  children: React.ReactNode;
}) {
  const collapsible = collapsibleProp ?? "offcanvas";
  const { isMobile } = useSidebar();
  const resolvedResizable = React.useMemo(
    () => resolveSidebarResizable(resizable, { collapsible, isMobile }),
    [collapsible, isMobile, resizable],
  );
  const value = React.useMemo<SidebarInstanceContextProps>(
    () => ({
      collapsible,
      resizable: resolvedResizable,
      side,
      ...(reopenOnDrag ? { reopenOnDrag: true as const } : {}),
    }),
    [collapsible, reopenOnDrag, resolvedResizable, side],
  );
  return (
    <SidebarInstanceContext.Provider value={value}>{children}</SidebarInstanceContext.Provider>
  );
}

function Sidebar({
  side: sideProp,
  variant: variantProp,
  collapsible: collapsibleProp,
  resizable: resizableProp,
  reopenOnDrag: reopenOnDragProp,
  className,
  gapClassName,
  innerClassName,
  transparentSurface: transparentSurfaceProp,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "icon" | "none";
  resizable?: boolean | SidebarResizableOptions;
  gapClassName?: string;
  innerClassName?: string;
  transparentSurface?: boolean;
  /** Allow a closed offcanvas panel to reopen on an inward drag. */
  reopenOnDrag?: boolean;
}) {
  const side = sideProp ?? "left";
  const variant = variantProp ?? "sidebar";
  const collapsible = collapsibleProp ?? "offcanvas";
  const resizable = resizableProp ?? false;
  const transparentSurface = transparentSurfaceProp ?? false;
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();
  const resolvedResizable = React.useMemo<SidebarResolvedResizableOptions | null>(
    () => resolveSidebarResizable(resizable, { collapsible, isMobile }),
    [collapsible, isMobile, resizable],
  );
  const instanceContextValue = React.useMemo<SidebarInstanceContextProps>(
    () => ({
      collapsible,
      side,
      resizable: resolvedResizable,
      ...(reopenOnDragProp ? { reopenOnDrag: true as const } : {}),
    }),
    [collapsible, reopenOnDragProp, resolvedResizable, side],
  );

  if (collapsible === "none") {
    return (
      <SidebarInstanceContext.Provider value={instanceContextValue}>
        <div
          className={cn(
            "flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground",
            innerClassName,
            className,
          )}
          data-slot="sidebar"
          {...props}
        >
          {children}
        </div>
      </SidebarInstanceContext.Provider>
    );
  }

  if (isMobile) {
    return (
      <SidebarInstanceContext.Provider value={instanceContextValue}>
        <Sheet onOpenChange={setOpenMobile} open={openMobile} {...props}>
          <SheetPopup
            className={cn(
              "w-(--sidebar-width) max-w-none bg-sidebar p-0 text-sidebar-foreground",
              className,
            )}
            data-mobile="true"
            data-sidebar="sidebar"
            data-slot="sidebar"
            showCloseButton={false}
            side={side}
            style={
              {
                "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
              } as React.CSSProperties
            }
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Sidebar</SheetTitle>
              <SheetDescription>Displays the mobile sidebar.</SheetDescription>
            </SheetHeader>
            <div className={cn("flex h-full w-full flex-col", innerClassName)}>{children}</div>
          </SheetPopup>
        </Sheet>
      </SidebarInstanceContext.Provider>
    );
  }

  return (
    <SidebarInstanceContext.Provider value={instanceContextValue}>
      <div
        className={cn(
          "group peer hidden text-sidebar-foreground md:block",
          // Cedia card row: no display:none on collapse. The gap + container
          // widths animate to 0 (left overrides the icon widths in _chat.tsx,
          // right uses offcanvas w-0), so open/close slides instead of snapping.
          // A zero-width flex item still takes both row gaps — pull 4px back on
          // the leading side so the collapsed seam is one gap, not two. Icon
          // mode only: the offcanvas dock keeps its own outlet geometry.
          state === "collapsed" && collapsible === "icon" && "-ml-1",
        )}
        data-collapsible={state === "collapsed" ? collapsible : ""}
        data-side={side}
        data-slot="sidebar"
        data-state={state}
        data-variant={variant}
      >
        {/* This is what handles the sidebar gap on desktop */}
        <div
          className={cn(
            "relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear",
            "group-data-[collapsible=offcanvas]:w-0",
            "group-data-[side=right]:rotate-180",
            variant === "floating" || variant === "inset"
              ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
              : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
            // Agent-window cutover: the 48px rail lives outside <Sidebar> (shell-mounted),
            // so the gap reserves only the thread-panel width in both states.
            gapClassName,
          )}
          data-slot="sidebar-gap"
        />
        <div
          className={cn(
            // Cedia card row: the left thread card is an in-flow flex item, NOT
            // a viewport overlay. The old `fixed left-0 h-svh` painted over the
            // shell-mounted 48px rail and used different bottom-edge math than
            // the in-flow center card. In-flow + same-row top/bottom as the
            // other cards; the gap div still reserves width + animates close.
            // Clip horizontally so the open→close width slide reads as motion
            // (content slides under the shrinking edge instead of squashing).
            "relative z-[1] hidden h-full min-h-0 w-(--sidebar-width) shrink-0 overflow-x-clip transition-[width] duration-200 ease-linear md:flex",
            // Cedia card row: no display:none on collapse — a collapsed offcanvas
            // panel rests at w-0 (width transition) with the dock's clip-path
            // reveal, so the row slides instead of snapping.
            variant === "floating" || variant === "inset"
              ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
              : cn(
                  "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
                  // Skip container border when innerClassName provides its own.
                  !transparentSurface &&
                    !(collapsible === "icon" && state === "collapsed") &&
                    "group-data-[side=left]:border-r group-data-[side=right]:border-l",
                ),
            className,
          )}
          data-slot="sidebar-container"
          {...props}
        >
          {/* The inner surface is the safe place for visual skinning. The outer shell owns
              fixed positioning, width transitions, and the resize rail hit area. */}
          <div
            className={cn(
              // Sizing is scoped by variant in JS (not by utility order): the
              // floating surface is inset-anchored (h/w auto), every other
              // variant fills the container (h/w full). The old shared
              // `h-full w-full` base plus floating `h-auto w-auto` overrides
              // left the winner to CSS source order — nondeterministic.
              // Cedia card row: clip the inner card too so a w-0 collapse hides
              // the panel content instead of spilling it into the 4px seam.
              "relative z-0 flex flex-col overflow-hidden group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow-sm/5",
              variant === "floating"
                ? "m-0 h-full w-full"
                : "h-full w-full",
              !transparentSurface && "bg-sidebar",
              innerClassName,
            )}
            data-sidebar="sidebar"
            data-slot="sidebar-inner"
          >
            {children}
          </div>
        </div>
      </div>
    </SidebarInstanceContext.Provider>
  );
}

function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<typeof Button>) {
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar();
  const isOpen = isMobile ? openMobile : open;

  return (
    <Button
      // Cedia: no pressed-fill behind the toggle. Upstream paints the open
      // state with the secondary-button background; in this shell that reads
      // as a stray grey box, and the glyph already carries the state (the
      // filled panel inside SidebarToggleIcon). Keep the brighter ink only.
      className={cn(
        "size-7 transition-colors duration-200 motion-reduce:transition-none",
        isOpen && "text-[var(--color-text-foreground)]",
        className,
      )}
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      size="icon-xs"
      variant="ghost"
      {...props}
      aria-pressed={isOpen}
    >
      <SidebarToggleIcon
        side="left"
        open={isOpen}
        // Keep the glyph's optical origin fixed while the sidebar animates.
        // The shell button itself is already fixed; a state-dependent
        // translate made the icon visibly jump by half a pixel on every toggle.
        className="motion-reduce:transform-none"
      />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
}

// Desktop headers lose access to the in-sidebar trigger after an off-canvas close,
// so this companion control reuses the same trigger and only appears when hidden.
// Traffic-light clearance is owned solely by the host header's
// DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS gutter — this control adds no offset of
// its own, so the toggle sits at the same x whether the sidebar is open or closed.
function SidebarHeaderTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { isMobile, open } = useSidebar();

  if (!isMobile && open) {
    return null;
  }

  return <SidebarTrigger className={className} onClick={onClick} {...props} />;
}

function clampSidebarWidth(width: number, options: SidebarResolvedResizableOptions): number {
  return Math.max(options.minWidth, Math.min(width, options.maxWidth));
}

function SidebarRail({
  placement: placementProp,
  reopenOnDrag = false,
  className,
  onClick,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onLostPointerCapture,
  ...props
}: React.ComponentProps<"button"> & {
  /** `content-seam` sits on the chat column edge above the card; `sidebar-shell` stays on the sidebar container. */
  placement?: "sidebar-shell" | "content-seam";
  /** Allow a detached seam to reopen an offcanvas panel on inward drag. */
  reopenOnDrag?: boolean;
}) {
  const placement = placementProp ?? "sidebar-shell";
  const { open, setOpen, toggleSidebar } = useSidebar();
  const sidebarInstance = React.useContext(SidebarInstanceContext);
  const side = sidebarInstance?.side ?? "left";
  const isContentSeam = placement === "content-seam";
  const railRef = React.useRef<HTMLButtonElement | null>(null);
  const suppressClickRef = React.useRef(false);
  const resizeStateRef = React.useRef<{
    moved: boolean;
    pointerId: number;
    pendingWidth: number;
    startCollapsed: boolean;
    rail: HTMLButtonElement;
    rafId: number | null;
    sidebarRoot: HTMLElement;
    side: "left" | "right";
    startWidth: number;
    startX: number;
    transitionTargets: Array<{
      element: HTMLElement;
      duration: { priority: string; value: string };
      delay: { priority: string; value: string };
    }>;
    width: number;
    wrapper: HTMLElement;
    bodyCursor: { priority: string; value: string };
    bodyUserSelect: { priority: string; value: string };
    acceptWidth: (nextWidth: number) => boolean;
    clampWidth?: (nextWidth: number) => number;
    disposeResize?: () => void;
  } | null>(null);
  const resolvedResizable = sidebarInstance?.resizable ?? null;
  // Cedia icon rail (item 71): in icon mode the rail also accepts drags while
  // collapsed, so the 48px rail can be dragged back open. The right dock
  // opts in via reopenOnDrag (Sidebar `reopenOnDrag` prop) for the same
  // closed-state behavior on its offcanvas shell.
  const iconSnap = (sidebarInstance?.collapsible ?? "offcanvas") === "icon";
  const canReopenOnDrag = iconSnap || reopenOnDrag || sidebarInstance?.reopenOnDrag === true;
  const canResize = resolvedResizable !== null && (open || canReopenOnDrag);
  const railLabel = canResize ? "Resize Sidebar" : "Toggle Sidebar";
  const railTitle = canResize ? "Drag to resize sidebar" : "Toggle Sidebar";
  const stopResize = React.useCallback(
    (pointerId: number) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }
      if (resizeState.rafId !== null) {
        window.cancelAnimationFrame(resizeState.rafId);
      }
      resizeState.transitionTargets.forEach(({ element, duration, delay }) => {
        if (duration.value) {
          element.style.setProperty("transition-duration", duration.value, duration.priority);
        } else {
          element.style.removeProperty("transition-duration");
        }
        if (delay.value) {
          element.style.setProperty("transition-delay", delay.value, delay.priority);
        } else {
          element.style.removeProperty("transition-delay");
        }
      });
      resizeState.disposeResize?.();
      // Cedia icon rail: a drag that started collapsed changes no width, so there
      // is nothing to persist (the snap path below persists the restored width).
      if (resizeState.moved && !resizeState.startCollapsed && resolvedResizable?.storageKey && typeof window !== "undefined") {
        setLocalStorageItem(resolvedResizable.storageKey, resizeState.width, Schema.Finite);
      }
      if (resizeState.moved && !resizeState.startCollapsed) {
        resolvedResizable?.onResize?.(resizeState.width);
      }
      resizeStateRef.current = null;
      if (resizeState.rail.hasPointerCapture(pointerId)) {
        resizeState.rail.releasePointerCapture(pointerId);
      }
      const bodyStyle = document.body.style;
      if (resizeState.bodyCursor.value) {
        bodyStyle.setProperty("cursor", resizeState.bodyCursor.value, resizeState.bodyCursor.priority);
      } else {
        bodyStyle.removeProperty("cursor");
      }
      if (resizeState.bodyUserSelect.value) {
        bodyStyle.setProperty("user-select", resizeState.bodyUserSelect.value, resizeState.bodyUserSelect.priority);
      } else {
        bodyStyle.removeProperty("user-select");
      }
    },
    [resolvedResizable],
  );
  // The resolved options object may be recreated by a parent render. Keep the
  // unmount cleanup pointed at the latest callback without making the cleanup
  // effect itself tear down an active drag on every render.
  const stopResizeRef = React.useRef(stopResize);
  stopResizeRef.current = stopResize;

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      onPointerDown?.(event);
      if (event.defaultPrevented) return;
      if (!resolvedResizable || event.button !== 0 || (!open && !canReopenOnDrag)) return;
      if (resizeStateRef.current) return;

      const wrapper = event.currentTarget.closest<HTMLElement>("[data-slot='sidebar-wrapper']");
      const sidebarRoot =
        event.currentTarget.closest<HTMLElement>("[data-slot='sidebar']") ??
        wrapper?.querySelector<HTMLElement>("[data-slot='sidebar']") ??
        null;
      if (!wrapper || !sidebarRoot) {
        return;
      }

      const sidebarContainer = sidebarRoot.querySelector<HTMLElement>(
        "[data-slot='sidebar-container']",
      );
      if (!sidebarContainer) {
        return;
      }

      // Icon-mode containers include the persistent rail; --sidebar-width
      // stores only the adjacent panel. Counting the rail here made every
      // pointer-down grow the panel by another 48px, even on a plain click.
      const startWidth = sidebarContainer.getBoundingClientRect().width -
        (iconSnap && open ? SIDEBAR_ICON_RAIL_PX : 0);
      const initialWidth = clampSidebarWidth(startWidth, resolvedResizable);
      const bodyStyle = document.body.style;
      const transitionTargets = [
        sidebarRoot.querySelector<HTMLElement>("[data-slot='sidebar-gap']"),
        sidebarRoot.querySelector<HTMLElement>("[data-slot='sidebar-container']"),
      ]
        .filter((element): element is HTMLElement => element !== null)
        .map((element) => ({
          element,
          duration: {
            priority: element.style.getPropertyPriority("transition-duration"),
            value: element.style.getPropertyValue("transition-duration"),
          },
          delay: {
            priority: element.style.getPropertyPriority("transition-delay"),
            value: element.style.getPropertyValue("transition-delay"),
          },
        }));
      transitionTargets.forEach(({ element }) => {
        // A width transition is useful for open/close but makes a pointer drag
        // chase the previous frame.  Keep the override important because the
        // Cedia dock applies an important transition-property utility.
        element.style.setProperty("transition-duration", "0ms", "important");
        element.style.setProperty("transition-delay", "0ms", "important");
      });

      event.preventDefault();
      event.stopPropagation();
      const sideForResize = sidebarInstance?.side ?? "left";
      const resizeSession = resolvedResizable.beginResize?.({
        currentWidth: initialWidth,
        rail: event.currentTarget,
        side: sideForResize,
        sidebarRoot,
        wrapper,
      });
      const acceptWidth = resizeSession?.shouldAcceptWidth
        ? resizeSession.shouldAcceptWidth
        : (nextWidth: number) =>
            resolvedResizable.shouldAcceptWidth?.({
              currentWidth: initialWidth,
              nextWidth,
              rail: event.currentTarget,
              side: sideForResize,
              sidebarRoot,
              wrapper,
            }) ?? true;
      resizeStateRef.current = {
        moved: false,
        pointerId: event.pointerId,
        pendingWidth: initialWidth,
        rail: event.currentTarget,
        rafId: null,
        sidebarRoot,
        side: sideForResize,
        startCollapsed: !open,
        startWidth: initialWidth,
        startX: event.clientX,
        transitionTargets,
        width: initialWidth,
        wrapper,
        bodyCursor: {
          priority: bodyStyle.getPropertyPriority("cursor"),
          value: bodyStyle.getPropertyValue("cursor"),
        },
        bodyUserSelect: {
          priority: bodyStyle.getPropertyPriority("user-select"),
          value: bodyStyle.getPropertyValue("user-select"),
        },
        acceptWidth,
        ...(resizeSession?.clampWidth
          ? { clampWidth: resizeSession.clampWidth }
          : {}),
        ...(resizeSession?.dispose
          ? { disposeResize: resizeSession.dispose }
          : {}),
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [canReopenOnDrag, iconSnap, onPointerDown, open, resolvedResizable, sidebarInstance?.side],
  );

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      onPointerMove?.(event);
      if (event.defaultPrevented) return;
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId || !resolvedResizable) return;

      event.preventDefault();
      const delta =
        resizeState.side === "right"
          ? resizeState.startX - event.clientX
          : event.clientX - resizeState.startX;
      if (Math.abs(delta) > 2) {
        resizeState.moved = true;
      }
      if (!resizeState.moved) return;
      // In icon mode the drag may travel down to the rail itself; otherwise the
      // full-sidebar minimum would pin the pointer at 208px and the snap below
      // could never trigger.
      const effectiveBounds =
        iconSnap && resolvedResizable.minWidth > SIDEBAR_ICON_RAIL_PX
          ? { ...resolvedResizable, minWidth: SIDEBAR_ICON_RAIL_PX }
          : resolvedResizable;
      resizeState.pendingWidth = clampSidebarWidth(
        resizeState.startWidth + delta,
        effectiveBounds,
      );
      if (resizeState.rafId !== null) {
        return;
      }

      resizeState.rafId = window.requestAnimationFrame(() => {
        const activeResizeState = resizeStateRef.current;
        if (!activeResizeState) return;

        activeResizeState.rafId = null;
        const nextWidth =
          activeResizeState.clampWidth?.(activeResizeState.pendingWidth) ??
          activeResizeState.pendingWidth;
        const accepted = activeResizeState.acceptWidth(nextWidth);
        if (!accepted) {
          return;
        }

        // Cedia icon rail: a drag that started from the collapsed rail only
        // decides reopen on release; never move the full-width var under it.
        if (!activeResizeState.startCollapsed) {
          activeResizeState.wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);
        }
        activeResizeState.width = nextWidth;
      });
    },
    [onPointerMove, resolvedResizable],
  );

  const endResizeInteraction = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState || resizeState.pointerId !== event.pointerId) return;

      event.preventDefault();
      suppressClickRef.current = resizeState.moved;
      const endDelta =
        resizeState.side === "right" ? resizeState.startX - event.clientX : event.clientX - resizeState.startX;
      // Pointer-up can arrive before the last queued animation frame. Commit
      // that final coordinate synchronously so persistence never trails the
      // divider and the panel does not snap back one frame on release.
      if (resizeState.rafId !== null) {
        window.cancelAnimationFrame(resizeState.rafId);
        resizeState.rafId = null;
      }
      const effectiveBounds =
        iconSnap && resolvedResizable?.minWidth !== undefined &&
        resolvedResizable.minWidth > SIDEBAR_ICON_RAIL_PX
          ? { ...resolvedResizable, minWidth: SIDEBAR_ICON_RAIL_PX }
          : resolvedResizable;
      const eventWidth = effectiveBounds
        ? clampSidebarWidth(resizeState.startWidth + endDelta, effectiveBounds)
        : resizeState.pendingWidth;
      const finalWidth =
        resizeState.clampWidth?.(eventWidth) ?? eventWidth;
      if (
        resolvedResizable &&
        resizeState.moved &&
        resizeState.acceptWidth(finalWidth) &&
        !resizeState.startCollapsed
      ) {
        resizeState.wrapper.style.setProperty("--sidebar-width", `${finalWidth}px`);
        resizeState.width = finalWidth;
      }
      const wasCollapsed = resizeState.startCollapsed;
      stopResize(event.pointerId);
      // Cedia icon rail (item 71): snap shut or back open on release. A plain
      // click (no move) falls through to the click-to-toggle path unchanged.
      if (!canReopenOnDrag) return;
      if (iconSnap && !wasCollapsed && resizeState.moved && finalWidth <= SIDEBAR_RAIL_SNAP_PX) {
        // Collapse to the icon rail and restore the pre-drag full width (also
        // persisted) so reopening returns to the full sidebar.
        resizeState.wrapper.style.setProperty("--sidebar-width", resizeState.startWidth + "px");
        if (resolvedResizable?.storageKey && typeof window !== "undefined") {
          setLocalStorageItem(resolvedResizable.storageKey, resizeState.startWidth, Schema.Finite);
        }
        setOpen(false);
      } else if (wasCollapsed && endDelta >= SIDEBAR_RAIL_REOPEN_PX) {
        setOpen(true);
      }
    },
    [canReopenOnDrag, iconSnap, resolvedResizable, setOpen, stopResize],
  );

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    onPointerUp?.(event);
    if (event.defaultPrevented) return;
    endResizeInteraction(event);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
    onPointerCancel?.(event);
    if (event.defaultPrevented) return;
    endResizeInteraction(event);
  };

  const handleLostPointerCapture = (event: React.PointerEvent<HTMLButtonElement>) => {
    onLostPointerCapture?.(event);
    if (event.defaultPrevented) return;
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    suppressClickRef.current = resizeState.moved;
    stopResize(event.pointerId);
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      event.preventDefault();
      return;
    }
    // A resize rail is a drag handle, not a toggle: clicks on it must fall
    // through to whatever is beside it (the tool rail icons). The old code
    // called toggleSidebar() here, so any click that landed on the rail's
    // 16px strip toggled the dock instead of reaching the tool icon beneath
    // ("tools dead": rail icons unclickable while the dock is open).
    if (resolvedResizable) {
      event.preventDefault();
      return;
    }
    toggleSidebar();
  };

  React.useEffect(() => {
    if (!resolvedResizable?.storageKey || typeof window === "undefined") return;
    // A parent rerender recreates the inline `resizable` options object and
    // would otherwise re-run this restore effect during an active drag. The
    // persisted value is the width from the previous completed drag, so
    // applying it here can snap the divider back mid-gesture and make the next
    // sequential resize appear frozen. The active pointer owns the inline CSS
    // width until pointer-up persists its final coordinate.
    if (resizeStateRef.current) return;
    const rail = railRef.current;
    if (!rail) return;
    const wrapper = rail.closest<HTMLElement>("[data-slot='sidebar-wrapper']");
    if (!wrapper) return;

    const storedWidth = getLocalStorageItem(resolvedResizable.storageKey, Schema.Finite);
    if (storedWidth === null) return;
    const clampedWidth = clampSidebarWidth(storedWidth, resolvedResizable);
    wrapper.style.setProperty("--sidebar-width", `${clampedWidth}px`);
    resolvedResizable.onResize?.(clampedWidth);
  }, [resolvedResizable]);

  React.useEffect(() => {
    if (open) return;
    const resizeState = resizeStateRef.current;
    if (resizeState) {
      suppressClickRef.current = resizeState.moved;
      stopResize(resizeState.pointerId);
    }
  }, [open, stopResize]);

  React.useEffect(() => {
    const stopActiveResize = () => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;
      suppressClickRef.current = resizeState.moved;
      stopResize(resizeState.pointerId);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        stopActiveResize();
      }
    };
    window.addEventListener("blur", stopActiveResize);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", stopActiveResize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [stopResize]);

  React.useEffect(() => {
    return () => {
      const resizeState = resizeStateRef.current;
      if (resizeState) {
        suppressClickRef.current = resizeState.moved;
        stopResizeRef.current(resizeState.pointerId);
      }
    };
  }, []);

  return (
    <button
      aria-label={railLabel}
      className={cn(
        isContentSeam
          ? [
              /* Resize hit-area on the chat card seam. The visible divider is the card's
                 border-inline edge (follows the rounded corner); hovering this rail
                 intensifies that border via :has() in index.css — no overlay line here.
                 This rail lives OUTSIDE <Sidebar>, so `in-data-[side]` cursor variants
                 never match (no [data-side] ancestor). Set the cursor directly:
                 `col-resize` (the ↔ handle) when resizing is available — matching the
                 body cursor used during the drag — else `pointer` for the toggle. */
              "absolute inset-y-0 z-20 hidden w-4 sm:flex",
              canResize ? "cursor-col-resize" : "cursor-pointer",
              // The center card clips its children at the border. Keep the
              // full hit target inside that clip so the visible seam receives
              // pointer-down instead of selecting conversation text.
              side === "left" ? "left-0" : "right-0",
            ]
          : [
              /* Legacy: rail anchored to the sidebar shell (right dock, etc.). */
              "-translate-x-1/2 group-data-[side=left]:-right-4 absolute inset-y-0 z-[1] hidden w-4 transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-sidebar-border group-data-[side=right]:left-0 sm:flex [[data-collapsible=offcanvas][data-state=collapsed]_&]:pointer-events-none",
              "in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
              "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
              "group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full",
              "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
              "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
            ],
        className,
      )}
      data-sidebar="rail"
      data-placement={placement}
      data-slot="sidebar-rail"
      onClick={handleClick}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      ref={railRef}
      tabIndex={-1}
      title={railTitle}
      type="button"
      {...props}
    />
  );
}

function SidebarInset({
  className,
  children,
  surfaceClassName,
  ...props
}: React.ComponentProps<"main"> & {
  surfaceClassName?: string;
}) {
  return (
    <main
      className={cn(
        // Keep caller layout classes on the outer shell so route-level height and
        // overflow constraints still apply after the inner-surface refactor.
        "relative flex min-h-0 min-w-0 w-full flex-1 flex-col bg-transparent",
        "md:peer-data-[variant=sidebar]:peer-data-[side=left]:peer-data-[state=expanded]:-ms-[var(--sidebar-width)]",
        "md:peer-data-[variant=sidebar]:peer-data-[side=left]:peer-data-[state=expanded]:w-[calc(100%+var(--sidebar-width))]",
        "md:peer-data-[variant=sidebar]:peer-data-[side=left]:peer-data-[state=expanded]:ps-[var(--sidebar-width)]",
        "md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ms-2 md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ms-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm/5",
        className,
      )}
      data-slot="sidebar-inset"
      {...props}
    >
      {/* Inner surface lives inside the content-box so rounded corners
          and bg are visible even when padding offsets the sidebar area. */}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col text-inherit",
          surfaceClassName ?? "bg-background",
        )}
        data-slot="sidebar-inset-surface"
      >
        {children}
      </div>
    </main>
  );
}

function SidebarInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return (
    <Input
      className={cn("h-8 w-full bg-background shadow-none", className)}
      data-sidebar="input"
      data-slot="sidebar-input"
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2 p-2", className)}
      data-sidebar="header"
      data-slot="sidebar-header"
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2 p-2", className)}
      data-sidebar="footer"
      data-slot="sidebar-footer"
      {...props}
    />
  );
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cn("mx-2 w-auto bg-sidebar-border", className)}
      data-sidebar="separator"
      data-slot="sidebar-separator"
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <ScrollArea hideScrollbars scrollFade className="h-auto min-h-0 flex-1">
      <div
        className={cn(
          "flex w-full min-w-0 flex-col gap-2 group-data-[collapsible=icon]:overflow-hidden",
          className,
        )}
        data-sidebar="content"
        data-slot="sidebar-content"
        {...props}
      />
    </ScrollArea>
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      data-sidebar="group"
      data-slot="sidebar-group"
      {...props}
    />
  );
}

function SidebarGroupLabel({ className, render, ...props }: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn(
      "flex h-8 shrink-0 items-center rounded-lg px-2 font-medium text-sidebar-foreground text-xs outline-hidden ring-ring/60 transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-1 [&>svg]:size-4 [&>svg]:shrink-0",
      "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
      className,
    ),
    "data-sidebar": "group-label",
    "data-slot": "sidebar-group-label",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps(defaultProps, props),
    render,
  });
}

function SidebarGroupAction({ className, render, ...props }: useRender.ComponentProps<"button">) {
  const defaultProps = {
    className: cn(
      "absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-lg p-0 text-sidebar-foreground outline-hidden ring-ring/60 transition-transform hover:bg-[var(--sidebar-accent)] focus-visible:ring-1 [&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0",
      // Increases the hit area of the button on mobile.
      "after:-inset-2 after:absolute md:after:hidden",
      "group-data-[collapsible=icon]:hidden",
      className,
    ),
    "data-sidebar": "group-action",
    "data-slot": "sidebar-group-action",
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps(defaultProps, props),
    render,
  });
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("w-full text-sm", className)}
      data-sidebar="group-content"
      data-slot="sidebar-group-content"
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      data-sidebar="menu"
      data-slot="sidebar-menu"
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      className={cn("group/menu-item relative", className)}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
      {...props}
    />
  );
}

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-xl p-2 text-left text-sm outline-hidden ring-ring/60 transition-[width,height,padding] hover:bg-[var(--sidebar-accent)] focus-visible:ring-1 active:bg-[var(--sidebar-accent-active)] active:text-[var(--sidebar-accent-foreground)] disabled:pointer-events-none disabled:opacity-50 group-has-data-[sidebar=menu-action]/menu-item:pe-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-[var(--sidebar-selected)] data-[active=true]:text-[var(--sidebar-accent-foreground)] data-[state=open]:hover:bg-[var(--sidebar-accent)] group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! [&>span:last-child]:truncate [&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-8 text-sm",
        lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
        sm: "h-7 text-xs",
      },
      variant: {
        default: "hover:bg-[var(--sidebar-accent)]",
        outline:
          "bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-[var(--sidebar-accent)] hover:shadow-[0_0_0_1px_var(--sidebar-border)]",
      },
    },
  },
);

function SidebarMenuButton({
  isActive: isActiveProp,
  variant: variantProp,
  size: sizeProp,
  tooltip,
  className,
  render,
  ...props
}: useRender.ComponentProps<"button"> & {
  isActive?: boolean;
  tooltip?: string | React.ComponentProps<typeof TooltipPopup>;
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const isActive = isActiveProp ?? false;
  // `variant`/`size` come from cva's VariantProps, whose types admit an explicit
  // `null` (meaning "use the cva defaultVariants"). Only `undefined` may fall back
  // here, so `??` would not preserve behavior.
  const variant = variantProp === undefined ? "default" : variantProp;
  const size = sizeProp === undefined ? "default" : sizeProp;
  const { isMobile, state } = useSidebar();

  const defaultProps = {
    className: cn(sidebarMenuButtonVariants({ size, variant }), className),
    "data-active": isActive,
    "data-sidebar": "menu-button",
    "data-size": size,
    "data-slot": "sidebar-menu-button",
  };

  const buttonProps = mergeProps<"button">(defaultProps, props);

  const buttonElement = useRender({
    defaultTagName: "button",
    props: buttonProps,
    render,
  });

  if (!tooltip) {
    return buttonElement;
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    };
  }

  return (
    <Tooltip>
      <TooltipTrigger render={buttonElement as React.ReactElement<Record<string, unknown>>} />
      <TooltipPopup
        align="center"
        hidden={state !== "collapsed" || isMobile}
        side="right"
        {...tooltip}
      />
    </Tooltip>
  );
}

function SidebarMenuAction({
  className,
  showOnHover: showOnHoverProp,
  render,
  ...props
}: useRender.ComponentProps<"button"> & {
  showOnHover?: boolean;
}) {
  const showOnHover = showOnHoverProp ?? false;
  const defaultProps = {
    className: cn(
      "sidebar-icon-button absolute top-1.5 right-1 flex aspect-square w-5 cursor-pointer p-0 text-sidebar-foreground outline-hidden ring-ring/60 transition-transform [&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0",
      // Increases the hit area of the button on mobile.
      "after:-inset-2 after:absolute md:after:hidden",
      "peer-data-[size=sm]/menu-button:top-1",
      "peer-data-[size=default]/menu-button:top-1.5",
      "peer-data-[size=lg]/menu-button:top-2.5",
      "group-data-[collapsible=icon]:hidden",
      showOnHover &&
        "group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 peer-data-[active=true]/menu-button:text-[var(--sidebar-accent-foreground)] md:opacity-0",
      className,
    ),
    "data-sidebar": "menu-action",
    "data-slot": "sidebar-menu-action",
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

function SidebarMenuBadge({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute right-1 flex h-5 min-w-5 select-none items-center justify-center rounded-lg px-1 font-medium text-sidebar-foreground text-xs tabular-nums",
        "peer-data-[active=true]/menu-button:text-[var(--sidebar-accent-foreground)]",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      data-sidebar="menu-badge"
      data-slot="sidebar-menu-badge"
      {...props}
    />
  );
}

function SidebarMenuSkeleton({
  className,
  showIcon: showIconProp,
  ...props
}: React.ComponentProps<"div"> & {
  showIcon?: boolean;
}) {
  const showIcon = showIconProp ?? false;
  // Random width between 50 to 90%, chosen once per mount so the bar doesn't
  // jitter on re-renders (lazy state init keeps the impure call out of render).
  const [width] = React.useState(() => `${Math.floor(Math.random() * 40) + 50}%`);

  return (
    <div
      className={cn("flex h-8 items-center gap-2 rounded-lg px-2", className)}
      data-sidebar="menu-skeleton"
      data-slot="sidebar-menu-skeleton"
      {...props}
    >
      {showIcon && <Skeleton className="size-4 rounded-lg" data-sidebar="menu-skeleton-icon" />}
      <Skeleton
        className="h-4 max-w-(--skeleton-width) flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  );
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      className={cn(
        "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-sidebar-border border-l px-2.5 py-0.5",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      data-sidebar="menu-sub"
      data-slot="sidebar-menu-sub"
      {...props}
    />
  );
}

function SidebarMenuSubItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      className={cn("group/menu-sub-item relative", className)}
      data-sidebar="menu-sub-item"
      data-slot="sidebar-menu-sub-item"
      {...props}
    />
  );
}

function SidebarMenuSubButton({
  size: sizeProp,
  isActive: isActiveProp,
  className,
  render,
  ...props
}: useRender.ComponentProps<"a"> & {
  size?: "sm" | "md";
  isActive?: boolean;
}) {
  const size = sizeProp ?? "md";
  const isActive = isActiveProp ?? false;
  const defaultProps = {
    className: cn(
      "-translate-x-px flex h-7 min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2 text-sidebar-foreground outline-hidden ring-ring/60 hover:bg-[var(--sidebar-accent)] focus-visible:ring-1 active:bg-[var(--sidebar-accent-active)] active:text-[var(--sidebar-accent-foreground)] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0",
      "data-[active=true]:bg-[var(--sidebar-selected)] data-[active=true]:text-[var(--sidebar-accent-foreground)]",
      size === "sm" && "text-xs",
      size === "md" && "text-sm",
      "group-data-[collapsible=icon]:hidden",
      className,
    ),
    "data-active": isActive,
    "data-sidebar": "menu-sub-button",
    "data-size": size,
    "data-slot": "sidebar-menu-sub-button",
  };

  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(defaultProps, props),
    render,
  });
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeaderTrigger,
  SidebarHeader,
  SidebarInput,
  SidebarInstanceProvider,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  SIDEBAR_OFFCANVAS_MOTION_CLASS,
  SIDEBAR_OFFCANVAS_MOTION_SUPPRESSED_CLASS,
  useSidebar,
};

export type { SidebarResizableOptions };
