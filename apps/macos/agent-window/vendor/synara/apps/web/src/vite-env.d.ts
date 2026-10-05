/// <reference types="vite/client" />

import type { NativeApi, DesktopBridge } from "@synara/contracts";

interface ImportMetaEnv {
  readonly APP_VERSION: string;
  readonly VITE_FEEDBACK_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    nativeApi?: NativeApi;
    desktopBridge?: DesktopBridge;
    /** Resolves after Cedia's host-owned preference bridge accepts a local write. */
    __CEDIA_HOST_PREFERENCES_FLUSH__?: () => Promise<void>;
  }
}
