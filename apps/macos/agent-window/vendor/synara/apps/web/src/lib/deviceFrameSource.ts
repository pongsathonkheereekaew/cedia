// FILE: deviceFrameSource.ts
// Purpose: Deliver encoded device video frames from the Cedia host to a pane's decoder.
// Layer: Web transport helper
// Exports: DeviceFrameSource contract and the pane-facing factory
// Depends on: @synara/shared/deviceFrame (frame type); the native factory installed by
//             src/native-device.ts before the bundle boots.

import type { DeviceFrame } from "@synara/shared/deviceFrame";
import type { DeviceUdid, DesktopBridge } from "@synara/contracts";

// The Agent Window's host bridge is declared by the full Synara app entrypoint.
// This focused transport module is also imported by native-only builds, so
// keep the shared contract available to TypeScript consumers that do
// not include Synara's browser environment declaration.
declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}

export interface DeviceFrameSourceHandlers {
  readonly onFrame: (frame: DeviceFrame) => void;
  /**
   * The stream dropped. The pane resets its decoder because the next connection
   * starts a new stream generation with its own parameter sets.
   */
  /** Optional transport error detail is kept separate from the stable reason. */
  readonly onReset: (reason: DeviceFrameSourceResetReason, error?: unknown) => void;
}

export type DeviceFrameSourceResetReason = "closed" | "error" | "decode-failed";

export interface DeviceFrameSource {
  /**
   * Ask the host for fresh parameter sets and an IDR after a gap or decode
   * error. Debounced; returns true when the request actually went out.
   */
  readonly requestResync: () => boolean;
  /** Idempotent; a source is single-use and cannot be restarted after close. */
  readonly close: () => void;
}

export interface DeviceFrameSourceOptions {
  readonly udid: DeviceUdid;
  readonly handlers: DeviceFrameSourceHandlers;
  /** Clock seam consumed by the native factory (resync cooldown). */
  readonly now?: () => number;
  readonly resyncCooldownMs?: number;
}

/**
 * Host-owned implementation installed by `native-device.ts`. Cedia's windows
 * receive the frame envelope over authenticated Electron IPC; there is no
 * WebSocket fallback (Cedia §10 item 60) — a missing factory is a broken
 * install that must fail loudly.
 */
export type NativeDeviceFrameFactory = (
  options: DeviceFrameSourceOptions,
) => DeviceFrameSource | null;

export function createDeviceFrameSource(options: DeviceFrameSourceOptions): DeviceFrameSource {
  // `globalThis` is a known in-process object; the installer (native-device.ts)
  // plants the factory before the bundle boots in both the standalone and the
  // dock entries, so reading it with a checked `in`/`typeof` guard is enough.
  const globals = globalThis as { __cediaNativeDeviceFrameSource?: unknown };
  const candidate =
    "__cediaNativeDeviceFrameSource" in globals ? globals.__cediaNativeDeviceFrameSource : undefined;
  if (typeof candidate !== "function") {
    throw new Error("Cedia device frame source is missing: native factory was not installed.");
  }
  // `typeof` above established functionness; the installer is in-process code
  // that plants exactly this signature.
  const nativeFactory = candidate as NativeDeviceFrameFactory;
  const source = nativeFactory(options);
  if (!source) {
    throw new Error("Cedia device frame source failed to attach for this device.");
  }
  return source;
}
