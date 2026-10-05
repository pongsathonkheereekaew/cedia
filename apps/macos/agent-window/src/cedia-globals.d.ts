/** Renderer globals installed by the Cedia bootstrap before the web app loads. */
export {};

declare global {
  interface Window {
    /** Resolves after Cedia's host-owned preference bridge accepts a local write. */
    __CEDIA_HOST_PREFERENCES_FLUSH__?: () => Promise<void>;
  }
}
