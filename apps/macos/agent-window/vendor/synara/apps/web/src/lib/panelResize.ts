// FILE: panelResize.ts
// Purpose: Pure DOM helpers for chat/split panel resizing — the drag overlay that
//          keeps pointer events in the React layer over Electron <webview>s, the
//          cross-surface occlusion notification, and the composer width feasibility
//          probe. Extracted from the chat route so the route file holds
//          orchestration, not low-level DOM measurement.
// Layer: Web panel layout utilities

import { SINGLE_CHAT_PANE_SCOPE_ID } from "./chatPaneScope";
import { findNearestMeasurableAncestor } from "./domLayout";
import { notifyNativeSurfaceOcclusionChange } from "./nativeSurfaceOcclusion";

// Minimum width (px) the composer's left controls cluster needs before it overflows.
// Kept intentionally lean: this is only a soft buffer, since canComposerHandlePanelWidth
// also blocks on real overflow (hasComposerOverflow / overflowsViewport). A smaller value
// lets the right dock and split panes resize across a much wider range before the probe
// stops the drag, while the overflow checks still prevent the composer from clipping.
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 160;
// The footer progressively hides labels and relocates its leading controls as
// the composer narrows. A wide right-actions row measured at pointer-down is
// therefore not a fixed lower bound: it can be hundreds of pixels wider than
// the compact tier the drag will render. Keep only a compact-tier allowance in
// the snapshot so a large model/review control row cannot pin the dock at its
// starting width.
const COMPOSER_COMPACT_MIN_RIGHT_ACTIONS_WIDTH_PX = 192;

export interface ComposerWidthResizeSession {
  /** Return whether a candidate panel width leaves the composer readable. */
  shouldAcceptWidth: (nextWidth: number) => boolean;
  /** Keep a fast drag from freezing when one pointer event jumps past the limit. */
  clampWidth?: (nextWidth: number) => number;
  /** Reserved for callers that need to release drag-local resources. */
  dispose?: () => void;
}

/**
 * Snapshot the composer's fixed-width constraints at pointer-down time.
 *
 * `canComposerHandlePanelWidth` is intentionally strict and is still used by
 * embedded split panes. A right-dock drag, however, calls its width guard once
 * per animation frame. Re-querying every form, computed style and bounding box
 * there forces a synchronous layout on every pointermove, which makes a heavy
 * review/diff pane feel several frames behind the pointer. The fixed controls
 * do not change during one drag, so derive the minimum usable composer width
 * once and project the chat viewport linearly as the dock grows.
 */
export function createComposerWidthResizeSession(input: {
  currentPanelWidth: number;
  paneScopeId?: string;
}): ComposerWidthResizeSession {
  const paneScopeId = input.paneScopeId ?? SINGLE_CHAT_PANE_SCOPE_ID;
  const composerForm = findComposerForm(paneScopeId);
  if (!composerForm) {
    return { shouldAcceptWidth: () => true };
  }

  const composerViewport = findNearestMeasurableAncestor(composerForm);
  if (!composerViewport) {
    return { shouldAcceptWidth: () => true };
  }

  const viewportStyle = window.getComputedStyle(composerViewport);
  const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
  const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
  const viewportContentWidth = Math.max(
    0,
    composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
  );
  const composerRightActions = composerForm.querySelector<HTMLElement>(
    "[data-chat-composer-actions='right']",
  );
  const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
  const composerFooter = composerForm.querySelector<HTMLElement>(
    "[data-chat-composer-footer='true']",
  );
  const composerFooterGap = composerFooter
    ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
      Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
      0
    : 0;
  const minimumComposerWidth =
    COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX +
    Math.min(composerRightActionsWidth, COMPOSER_COMPACT_MIN_RIGHT_ACTIONS_WIDTH_PX) +
    composerFooterGap;
  const maximumPanelWidth =
    input.currentPanelWidth + viewportContentWidth - minimumComposerWidth;

  return {
    shouldAcceptWidth: (nextPanelWidth) => {
      // A narrower dock always gives the composer more room. Keeping this
      // monotonic escape hatch lets a drag recover from an already cramped
      // window instead of trapping the user at the starting width.
      if (nextPanelWidth <= input.currentPanelWidth) {
        return true;
      }
      // Both desktop side panels consume space from the chat viewport. A wider
      // candidate therefore reduces the measured viewport by the same delta.
      const projectedViewportWidth =
        viewportContentWidth + input.currentPanelWidth - nextPanelWidth;
      return projectedViewportWidth + 0.5 >= minimumComposerWidth;
    },
    clampWidth: (nextPanelWidth) =>
      Math.min(nextPanelWidth, Math.max(input.currentPanelWidth, maximumPanelWidth)),
  };
}

// Probe whether the composer can render at `nextWidth` without overflowing its
// viewport or violating its minimum control width. Applies the width, measures,
// then resets — callers own the real commit.
export function canComposerHandlePanelWidth(input: {
  nextWidth: number;
  paneScopeId?: string;
  applyWidth: (width: number) => void;
  resetWidth: () => void;
}): boolean {
  const paneScopeId = input.paneScopeId ?? SINGLE_CHAT_PANE_SCOPE_ID;
  const composerForm = findComposerForm(paneScopeId);
  if (!composerForm) return true;

  // The form can be nested inside boxless wrappers (e.g. ChatView's
  // `display: contents` landing wrapper); measuring those as the viewport would
  // reject every width and freeze dock/split resizing.
  const composerViewport = findNearestMeasurableAncestor(composerForm);
  if (!composerViewport) return true;

  input.applyWidth(input.nextWidth);

  const viewportStyle = window.getComputedStyle(composerViewport);
  const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
  const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
  const viewportContentWidth = Math.max(
    0,
    composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
  );
  const formRect = composerForm.getBoundingClientRect();
  const composerFooter = composerForm.querySelector<HTMLElement>(
    "[data-chat-composer-footer='true']",
  );
  const composerRightActions = composerForm.querySelector<HTMLElement>(
    "[data-chat-composer-actions='right']",
  );
  const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
  const composerFooterGap = composerFooter
    ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
      Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
      0
    : 0;
  const minimumComposerWidth =
    COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
  const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
  const overflowsViewport = formRect.width > viewportContentWidth + 0.5;
  const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth;

  input.resetWidth();

  return !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth;
}

// Finds the composer for one pane without depending on CSS selector escaping.
function findComposerForm(paneScopeId: string): HTMLElement | null {
  const composerForms = document.querySelectorAll<HTMLElement>("[data-chat-composer-form='true']");
  for (const composerForm of composerForms) {
    if (composerForm.dataset.chatPaneScope === paneScopeId) {
      return composerForm;
    }
  }
  return null;
}

// Electron <webview> can swallow pointermove during drag; this keeps resizing in the React layer.
export function createPanelResizeOverlay(cursor = "col-resize"): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.setAttribute("data-panel-resize-overlay", "true");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "2147483647";
  overlay.style.cursor = cursor;
  overlay.style.background = "transparent";
  document.body.append(overlay);
  notifyNativeSurfaceOcclusionChange();
  return overlay;
}

export function removePanelResizeOverlay(overlay: HTMLDivElement): void {
  overlay.remove();
  notifyNativeSurfaceOcclusionChange();
}

export function attachPanelPointerOverlaySession(
  overlay: HTMLElement,
  handlers: {
    onMove: (event: PointerEvent) => void;
    onRelease: () => void;
    onAbort: () => void;
  },
): () => void {
  const onMove = (event: PointerEvent) => {
    if (event.buttons === 0) {
      handlers.onAbort();
      return;
    }
    handlers.onMove(event);
  };
  const onRelease = () => handlers.onRelease();
  const onAbort = () => handlers.onAbort();

  overlay.addEventListener("pointermove", onMove);
  overlay.addEventListener("pointerup", onRelease);
  overlay.addEventListener("pointercancel", onAbort);
  window.addEventListener("blur", onAbort);
  document.addEventListener("mouseleave", onAbort);

  return () => {
    overlay.removeEventListener("pointermove", onMove);
    overlay.removeEventListener("pointerup", onRelease);
    overlay.removeEventListener("pointercancel", onAbort);
    window.removeEventListener("blur", onAbort);
    document.removeEventListener("mouseleave", onAbort);
  };
}
