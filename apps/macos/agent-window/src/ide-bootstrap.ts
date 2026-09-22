/**
 * Bootstrap the shared Cedia Agent UI inside a Code-OSS webview.
 *
 * The webview never receives a native API or credentials.  It gets a small
 * request/response transport backed by acquireVsCodeApi, then reuses the same
 * NativeApi/DesktopBridge adapter as the standalone Agents Window.
 */

import {
  createCediaDesktopBridge,
  createCediaNativeApi,
  type AgentWindowBridge,
} from "./cedia-adapter";
import { installNativeDeviceFrameSource } from "./native-device";
import { openNativeAgentIntent } from "./native-handoff";
import { decodeSessionIdFromHash, openAgentsWindowFromIde } from "../vendor/synara/apps/web/src/ide-mode";
import type { DesktopBridge, NativeApi } from "@synara/contracts";

import { AGENT_WINDOW_CHANNEL as CEDIA_AGENT_CHANNEL } from "../../src/bridge-contract.ts";
const RESPONSE_TIMEOUT_MS = 60_000;

interface VsCodeWebviewApi {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => unknown;
}

interface CediaAgentResponse {
  readonly type: "cedia-agent-response";
  readonly id: string;
  readonly result?: unknown;
  readonly error?: unknown;
}

interface CediaAgentContextMessage {
  readonly type: "cedia-agent-context";
  readonly cwd: unknown;
  readonly sessionId?: unknown;
}

interface CediaAgentActionMessage {
  readonly type: "cedia-agent-action";
  readonly action: unknown;
  readonly text?: unknown;
}

interface PendingRequest {
  readonly reject: (error: Error) => void;
  readonly resolve: (value: unknown) => void;
  readonly timer: number;
}

interface IdeContext {
  cwd: string | null;
  sessionId?: string;
}

interface HostThemeSnapshot {
  mode: "light" | "dark";
  themeName?: string;
  colors?: Record<string, string>;
}

// These are the workbench tokens that define Cedia's shared chrome. Keep the
// list explicit and small: the standalone Agent receives presentation values,
// never arbitrary CSS or editor syntax rules.
const HOST_THEME_VARIABLES = [
  "--vscode-editor-background",
  "--vscode-editor-foreground",
  "--vscode-foreground",
  "--vscode-descriptionForeground",
  "--vscode-disabledForeground",
  "--vscode-sideBar-background",
  "--vscode-sideBar-foreground",
  "--vscode-sideBar-border",
  "--vscode-sideBarSectionHeader-background",
  "--vscode-panel-background",
  "--vscode-panel-border",
  "--vscode-titleBar-activeBackground",
  "--vscode-statusBar-background",
  "--vscode-statusBar-foreground",
  "--vscode-editorGroupHeader-tabsBackground",
  "--vscode-tab-activeBackground",
  "--vscode-tab-inactiveBackground",
  "--vscode-tab-activeForeground",
  "--vscode-tab-inactiveForeground",
  "--vscode-input-background",
  "--vscode-input-foreground",
  "--vscode-input-border",
  "--vscode-textCodeBlock-background",
  "--vscode-editorWidget-background",
  "--vscode-editorWidget-border",
  "--vscode-menu-background",
  "--vscode-menu-border",
  "--vscode-dropdown-background",
  "--vscode-focusBorder",
  "--vscode-contrastBorder",
  "--vscode-textLink-foreground",
  "--vscode-textLink-activeForeground",
  "--vscode-button-background",
  "--vscode-button-foreground",
  "--vscode-button-hoverBackground",
  "--vscode-badge-background",
  "--vscode-icon-foreground",
  "--vscode-list-hoverBackground",
  "--vscode-list-activeSelectionBackground",
  "--vscode-list-activeSelectionForeground",
  "--vscode-testing-iconPassed",
  "--vscode-testing-iconFailed",
  "--vscode-gitDecoration-addedResourceForeground",
  "--vscode-gitDecoration-deletedResourceForeground",
] as const;

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cedia-ide-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorFromValue(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string" && value.length > 0) return new Error(value);
  if (value && typeof value === "object" && typeof (value as { message?: unknown }).message === "string") {
    return new Error((value as { message: string }).message);
  }
  return new Error("Cedia Agent request failed");
}

function isResponse(value: unknown): value is CediaAgentResponse {
  return object(value).type === "cedia-agent-response" && typeof object(value).id === "string";
}

function isContextMessage(value: unknown): value is CediaAgentContextMessage {
  return object(value).type === "cedia-agent-context";
}

function isActionMessage(value: unknown): value is CediaAgentActionMessage {
  return object(value).type === "cedia-agent-action";
}

class IdeWebviewBridge implements AgentWindowBridge {
  readonly #api: VsCodeWebviewApi;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #listeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>();
  readonly #onMessage: (event: MessageEvent<unknown>) => void;
  #disposed = false;

  constructor(api: VsCodeWebviewApi) {
    this.#api = api;
    this.#onMessage = (event) => {
      const message = event.data;
      if (isResponse(message)) {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        this.#pending.delete(message.id);
        window.clearTimeout(pending.timer);
        if (message.error !== undefined) pending.reject(errorFromValue(message.error));
        else pending.resolve(message.result);
        return;
      }
      const type = object(message).type;
      if (type === "cedia-agent-event") {
        const channel = object(message).channel;
        if (typeof channel !== "string") return;
        const listeners = this.#listeners.get(channel);
        if (!listeners) return;
        const payload = object(message).payload;
        for (const listener of listeners) listener(event, payload);
        return;
      }
      if (typeof type !== "string") return;
      const listeners = this.#listeners.get(type);
      if (!listeners) return;
      for (const listener of listeners) listener(event, message);
    };
    window.addEventListener("message", this.#onMessage);
  }

  invoke(channel: string, input?: unknown): Promise<unknown> {
    if (channel !== CEDIA_AGENT_CHANNEL) {
      return Promise.reject(new Error(`Cedia IDE bridge rejects unsupported channel: ${channel}`));
    }
    if (this.#disposed) return Promise.reject(new Error("Cedia IDE bridge is disposed"));
    const id = randomId();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Cedia Agent request timed out: ${channel}`));
      }, RESPONSE_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
      this.#api.postMessage({ type: "cedia-agent-request", id, channel, input });
    });
  }

  send(channel: string, input?: unknown): void {
    if (channel !== CEDIA_AGENT_CHANNEL) {
      throw new Error(`Cedia IDE bridge rejects unsupported channel: ${channel}`);
    }
    this.#api.postMessage({ type: "cedia-agent-event", channel, input });
  }

  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void {
    const listeners = this.#listeners.get(channel) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(channel, listeners);
  }

  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void {
    const listeners = this.#listeners.get(channel);
    listeners?.delete(listener);
    if (listeners?.size === 0) this.#listeners.delete(channel);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    window.removeEventListener("message", this.#onMessage);
    for (const pending of this.#pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error("Cedia IDE bridge disposed"));
    }
    this.#pending.clear();
    this.#listeners.clear();
  }
}

function contextFromState(value: unknown): IdeContext {
  const state = object(value);
  const context = object(state.context ?? state.cediaAgentContext);
  const cwd = typeof context.cwd === "string" && context.cwd.length > 0 ? context.cwd : null;
  const sessionId = typeof context.sessionId === "string" && context.sessionId.length > 0
    ? context.sessionId
    : undefined;
  return { cwd, ...(sessionId ? { sessionId } : {}) };
}

function contextFromMessage(value: CediaAgentContextMessage, previous: IdeContext): IdeContext {
  const cwd = typeof value.cwd === "string" && value.cwd.length > 0 ? value.cwd : null;
  const sessionId = typeof value.sessionId === "string" && value.sessionId.length > 0
    ? value.sessionId
    : previous.sessionId;
  return { cwd, ...(sessionId ? { sessionId } : {}) };
}

function actionFromMessage(
  value: CediaAgentActionMessage,
  dispatch: (action: "focus" | "newTask" | "appendContext", text?: string) => void,
): void {
  const action = value.action;
  if (action !== "focus" && action !== "newTask" && action !== "appendContext") return;
  dispatch(action, typeof value.text === "string" ? value.text : undefined);
}

function readHostThemeSnapshot(fallback: unknown): HostThemeSnapshot {
  const row = object(fallback);
  const fallbackMode = row.mode === "light" ? "light" : "dark";
  const classes = `${document.documentElement?.className ?? ""} ${document.body?.className ?? ""}`;
  const mode = /\bvscode-light\b|\bvscode-high-contrast-light\b/.test(classes)
    ? "light"
    : /\bvscode-dark\b|\bvscode-high-contrast\b/.test(classes)
      ? "dark"
      : fallbackMode;
  const colors: Record<string, string> = {};
  try {
    const styles = [document.documentElement, document.body].filter(Boolean).map(node => getComputedStyle(node));
    for (const name of HOST_THEME_VARIABLES) {
      for (const style of styles) {
        const value = style.getPropertyValue(name).trim();
        if (value && (typeof CSS === "undefined" || typeof CSS.supports !== "function" || CSS.supports("color", value))) {
          colors[name] = value;
          break;
        }
      }
    }
  } catch {
    // Browser tests and older webview hosts may not expose computed styles.
  }
  const currentThemeName = document.body?.dataset.vscodeThemeName || document.body?.dataset.vscodeThemeId;
  const themeName = currentThemeName || (typeof row.themeName === "string" && row.themeName.trim().length > 0
    ? row.themeName.trim()
    : undefined);
  return {
    mode,
    ...(themeName ? { themeName } : {}),
    ...(Object.keys(colors).length > 0 ? { colors } : {}),
  };
}

async function boot(): Promise<void> {
  const acquire = (globalThis as { acquireVsCodeApi?: () => VsCodeWebviewApi }).acquireVsCodeApi;
  if (typeof acquire !== "function") throw new Error("Cedia IDE webview bridge is unavailable");
  const vscode = acquire();
  const bridge = new IdeWebviewBridge(vscode);
  const initialContext = contextFromState(vscode.getState?.());
  let context = initialContext;
  let synchronizeContext = async (): Promise<void> => {};
  let ideUiReady = false;
  const queuedActions: Array<{ action: "focus" | "newTask" | "appendContext"; text?: string }> = [];
  const dispatchIdeAction = (
    action: "focus" | "newTask" | "appendContext",
    text?: string,
  ): void => {
    if (!ideUiReady) {
      queuedActions.push({ action, ...(text !== undefined ? { text } : {}) });
      return;
    }
    window.dispatchEvent(new CustomEvent("cedia:ide-action", {
      detail: { action, ...(text !== undefined ? { text } : {}) },
    }));
  };

  window.__CEDIA_IDE_EMBEDDED__ = true;
  window.__CEDIA_IDE_BRIDGE__ = bridge;
  window.__CEDIA_IDE_CONTEXT__ = context;
  document.documentElement.dataset.cediaIdeEmbedded = "true";
  document.documentElement.classList.add("cedia-ide-embedded");

  const onMessage = (event: MessageEvent<unknown>): void => {
    if (isContextMessage(event.data)) {
      context = contextFromMessage(event.data, context);
      window.__CEDIA_IDE_CONTEXT__ = context;
      window.dispatchEvent(new CustomEvent("cedia:ide-context", { detail: context }));
      void synchronizeContext().catch(error => console.error("Cedia IDE task handoff failed", error));
      return;
    }
    if (isActionMessage(event.data)) {
      if (event.data.action === "openAgents") {
        void openAgentsWindowFromIde().catch(error => console.error("Cedia Agent handoff failed", error));
      } else actionFromMessage(event.data, dispatchIdeAction);
    }
  };
  window.addEventListener("message", onMessage);
  const onIdeUiReady = (): void => {
    ideUiReady = true;
    for (const action of queuedActions.splice(0)) {
      dispatchIdeAction(action.action, action.text);
    }
  };
  window.addEventListener("cedia:ide-ui-ready", onIdeUiReady, { once: true });

  const bootstrapResult = object(await bridge.invoke(CEDIA_AGENT_CHANNEL, {
    kind: "bootstrap",
    ...(context.cwd ? { cwd: context.cwd } : {}),
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
  }));
  // The extension host supplies the active theme name/kind, while this
  // webview can see the effective Code-OSS CSS variables. Publish both so a
  // separately opened Agent Window paints the same surfaces and controls.
  let lastPublishedTheme = "";
  const publishHostTheme = (): void => {
    const snapshot = readHostThemeSnapshot(bootstrapResult.theme);
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastPublishedTheme) return;
    lastPublishedTheme = serialized;
    (globalThis as { __CEDIA_HOST_THEME__?: HostThemeSnapshot }).__CEDIA_HOST_THEME__ = snapshot;
    window.dispatchEvent(new CustomEvent("cedia:host-theme"));
    vscode.postMessage({ type: "cedia-agent-theme", snapshot });
  };
  publishHostTheme();
  const themeObserver = typeof MutationObserver === "function" && document.body
    ? new MutationObserver(publishHostTheme)
    : undefined;
  themeObserver?.observe(document.body, { attributes: true, attributeFilter: ["class", "style", "data-vscode-theme-name", "data-vscode-theme-id"] });
  // Some Code-OSS releases replace the theme stylesheet without changing the
  // body class. A low-frequency comparison catches that case without tying
  // theme repainting to the app's render loop.
  const themePoll = window.setInterval(publishHostTheme, 1_000);
  const sessionId = typeof bootstrapResult.sessionId === "string" && bootstrapResult.sessionId.length > 0
    ? bootstrapResult.sessionId
    : context.sessionId ?? decodeSessionIdFromHash(window.location.hash);
  const cwd = typeof bootstrapResult.cwd === "string" && bootstrapResult.cwd.length > 0
    ? bootstrapResult.cwd
    : context.cwd;
  const homeDir = typeof bootstrapResult.homeDir === "string" && bootstrapResult.homeDir.length > 0
    ? bootstrapResult.homeDir
    : cwd;
  context = { cwd: cwd ?? null, ...(sessionId ? { sessionId } : {}) };
  window.__CEDIA_IDE_CONTEXT__ = context;
  if (sessionId && !decodeSessionIdFromHash(window.location.hash)) {
    window.location.hash = `/${encodeURIComponent(sessionId)}`;
  }

  const disposeDeviceFrames = installNativeDeviceFrameSource(bridge);
  const nativeApi = createCediaNativeApi({ bridge });
  window.nativeApi = nativeApi as NativeApi;
  window.desktopBridge = createCediaDesktopBridge({ bridge });

  // Load the shared app-side persistence only after the scoped bridge and native
  // API globals exist. Several Synara modules inspect those globals at module load.
  const { installSharedUiDraftBridge } = await import("../vendor/synara/apps/web/src/sharedUiDraftBridge");
  const sharedDraftBridge = installSharedUiDraftBridge(bridge);
  window.__CEDIA_DRAFT_FLUSH__ = sharedDraftBridge.flush;
  if (sessionId) await sharedDraftBridge.hydrateThread(sessionId);
  let contextHandoffs = Promise.resolve();
  synchronizeContext = () => {
    const nextContext = context;
    contextHandoffs = contextHandoffs.catch(() => undefined).then(async () => {
      if (nextContext.sessionId) {
        await sharedDraftBridge.hydrateThread(nextContext.sessionId);
        window.location.hash = `/${encodeURIComponent(nextContext.sessionId)}`;
      } else if (nextContext.cwd) {
        await openNativeAgentIntent(nativeApi, { scheme: "file", path: nextContext.cwd }, undefined,
          id => { window.location.hash = `/${encodeURIComponent(id)}`; });
      }
    });
    return contextHandoffs;
  };
  await synchronizeContext();

  const openInEditor = nativeApi.shell.openInEditor;
  nativeApi.shell.openInEditor = async (target: string, editor: string) => {
    await sharedDraftBridge.flush();
    await openInEditor(target, editor);
  };
  const { useWorkspacePathsStore } = await import("../vendor/synara/apps/web/src/workspacePathsStore");
  if (homeDir) useWorkspacePathsStore.getState().setServerWorkspacePaths({ homeDir });

  const notifyActiveSession = (): void => {
    const activeSessionId = decodeSessionIdFromHash(window.location.hash);
    if (!activeSessionId) return;
    void bridge.invoke(CEDIA_AGENT_CHANNEL, {
      kind: "activeSession",
      sessionId: activeSessionId,
    }).catch(() => undefined);
  };
  const dispatchCommand = nativeApi.orchestration.dispatchCommand;
  nativeApi.orchestration.dispatchCommand = async (command: unknown) => {
    const result = await dispatchCommand(command);
    // An unsent draft becomes durable without changing its route/id.
    if (object(command).type === "thread.turn.start") notifyActiveSession();
    return result;
  };
  const onHashChange = (): void => {
    const activeSessionId = decodeSessionIdFromHash(window.location.hash);
    if (activeSessionId) {
      context = { ...context, sessionId: activeSessionId };
      window.__CEDIA_IDE_CONTEXT__ = context;
      window.dispatchEvent(new CustomEvent("cedia:ide-context", { detail: context }));
    }
    notifyActiveSession();
  };
  window.addEventListener("hashchange", onHashChange);

  try {
    await import("../vendor/synara/apps/web/src/main");
    notifyActiveSession();
    vscode.postMessage({ type: "cedia-agent-ready" });
  } finally {
    // The shared app owns all subsequent UI listeners; keep the bridge's context
    // and response listener alive until the webview is disposed.
  }

  const dispose = (): void => {
    window.removeEventListener("message", onMessage);
    window.removeEventListener("hashchange", onHashChange);
    window.clearInterval(themePoll);
    themeObserver?.disconnect();
    void sharedDraftBridge.flush().finally(() => {
      sharedDraftBridge.dispose();
      delete window.__CEDIA_DRAFT_FLUSH__;
      disposeDeviceFrames();
      bridge.dispose();
    });
  };
  window.addEventListener("pagehide", dispose, { once: true });
}

void boot().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const root = document.getElementById("root");
  if (root) root.textContent = `Cedia Agent panel could not start: ${message}`;
  console.error(error);
});
