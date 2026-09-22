import {
  WS_GITHUB_PROJECT_PROVISIONING_CAPABILITY,
  WS_PROJECT_FILE_WATCH_CAPABILITY,
  type NativeApi,
} from "@synara/contracts";

// Cedia §10 item 60: the Synara WebSocket backend (./wsNativeApi) is never
// imported here. readNativeApi() answers only from window.nativeApi, which
// Cedia's bootstraps install before the bundle loads — a missing bridge reads
// undefined (the __root__ gate shows "connecting") and ensureNativeApi() throws
// loudly instead of opening a second data path.

let cachedDesktopApi: NativeApi | undefined;

export function readNativeApi(): NativeApi | undefined {
  if (typeof window === "undefined") return undefined;
  if (cachedDesktopApi && window.nativeApi === cachedDesktopApi) return cachedDesktopApi;

  if (window.nativeApi) {
    cachedDesktopApi = window.nativeApi;
    return cachedDesktopApi;
  }

  // Cedia §10 item 60: no WebSocket fallback. Cedia's bootstraps install
  // window.nativeApi before importing the bundle — and __root__ gates the whole
  // route tree on readNativeApi(), so a probe here must stay total and
  // side-effect free: absent bridge reads undefined until the bootstrap lands,
  // never a live Synara server object. Anything that needs the bridge uses
  // ensureNativeApi() and throws loudly instead.
  return undefined;
}

export function ensureNativeApi(): NativeApi {
  const api = readNativeApi();
  if (!api) {
    // Same rule, loud variant: a missing bridge is a broken install, never a
    // reason to open Synara's WebSocket server path.
    throw new Error("Cedia native bridge is missing: window.nativeApi was not installed.");
  }
  return api;
}

export function readNativeApiServerCapability(capability: string): boolean {
  if (typeof window === "undefined") return false;
  if (window.nativeApi) {
    if (capability === WS_GITHUB_PROJECT_PROVISIONING_CAPABILITY) {
      return typeof window.nativeApi.projects?.provisionFromGitHub === "function";
    }
    if (capability === WS_PROJECT_FILE_WATCH_CAPABILITY) {
      return typeof window.nativeApi.projects?.onFileChange === "function";
    }
    return false;
  }
  // No WebSocket backend to ask — without the bridge there are no capabilities.
  return false;
}

export function onNativeApiServerCapabilitiesChange(
  listener: () => void,
  options?: { readonly replayCurrent?: boolean },
): () => void {
  if (typeof window === "undefined") {
    if (options?.replayCurrent) listener();
    return () => undefined;
  }
  if (window.nativeApi) {
    if (options?.replayCurrent) listener();
    return () => undefined;
  }
  // No WebSocket backend to subscribe to — replay once so late-mounting callers
  // still settle, then stay quiet until the bridge lands and remounts them.
  if (options?.replayCurrent) listener();
  return () => undefined;
}
