// Window augmentation for vendor sources that root tests import relatively
// (e.g. apps/macos/agent-window/test). It mirrors the `declare global` half of
// apps/macos/agent-window/vendor/synara/apps/web/src/vite-env.d.ts, which the
// root program does not include; the vite/client half is intentionally not
// repeated here. Uses a relative import so no new path mapping is needed.
import type {
  DesktopBridge,
  NativeApi,
} from "./agent-window/vendor/synara/packages/contracts/src/index";

declare global {
  interface Window {
    nativeApi?: NativeApi;
    desktopBridge?: DesktopBridge;
  }
}

export {};
