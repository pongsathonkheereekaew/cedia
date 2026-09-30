/** The Electron-main-process half of the Agent Window bridge.
 *
 * Why this is its own module: the handler and gateway in `agent-window-main.ts`
 * are shared with the IDE dock (the extension bundle imports them through
 * `agent-ide-webview.ts`), and this half is the only code that needs Electron
 * itself — `app.getPath("userData")` for the agents workspace file and
 * `nativeTheme` for the OS appearance. Keeping it separate is what lets the
 * extension bundle stay free of a `require("electron")` it can never resolve,
 * which is how `package:mac` builds the extension at all.
 *
 * The packaged desktop main process loads the built `out/vs/cedia/agent/main.cjs`
 * and calls `registerCediaAgentWindowBridge` (patch `0056`), so this module is
 * the entrypoint `scripts/build-agent-window.ts` bundles.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { AGENT_WINDOW_CHANNEL } from "./bridge-contract.ts";
import { createAgentBrowserService } from "./agent-window-browser.ts";
import { createAgentDeviceService } from "./agent-window-device.ts";
import { createAgentFilesService } from "./agent-window-files.ts";
import { createAgentGitService } from "./agent-window-git.ts";
import { createAgentTerminalService } from "./agent-window-terminal.ts";
import { createAgentHostGateway, createAgentWindowHandler, type GatewayOptions, type HandlerOptions } from "./agent-window-main.ts";
import { startAgentThemePublisher } from "./agent-window-theme-publisher.ts";
import {
  createCediaAppLifecycle,
  createCediaQuitDecision,
  createCediaShutdownJoin,
  registerCediaLoginItem,
  shouldOpenFirstWindowAtLaunch,
  type CediaAppLifecycle,
  type CediaLifecycleGateway,
} from "./app-lifecycle.ts";
import { AGENTS_WINDOW_WORKSPACE } from "./workbench-mode.ts";

interface IpcMain {
  handle(channel: string, listener: (event: unknown, input: unknown) => Promise<unknown>): void;
  removeHandler(channel: string): void;
  on?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  removeListener?(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
}
export interface AgentWindowBridgeOptions extends GatewayOptions, Omit<HandlerOptions, "request" | "ensure"> { ipcMain: IpcMain }

/** The workbench renderer's count-only dirty-state signal (§2.7). */
export const CEDIA_DIRTY_EDITORS_CHANNEL = "vscode:cedia-dirty-editors";

interface CediaDirtyEditorSender {
  once?(event: "destroyed", listener: () => void): void;
  removeListener?(event: "destroyed", listener: () => void): void;
}

export interface CediaDirtyEditorReader {
  update(event: unknown, count: unknown): void;
  read(): number;
  dispose(): void;
}

/**
 * Keep one count per trusted IDE renderer. The renderer sends only a number;
 * filenames and editor contents never cross this seam. A WebContents destroy
 * event removes its last value so a closed window cannot keep dirty state alive.
 */
export function createCediaDirtyEditorReader(options: {
  readonly isTrustedSender?: (event: unknown) => boolean;
} = {}): CediaDirtyEditorReader {
  const counts = new Map<CediaDirtyEditorSender, number>();
  const cleanups = new Map<CediaDirtyEditorSender, () => void>();

  const normalizeCount = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

  const senderFrom = (event: unknown): CediaDirtyEditorSender | undefined => {
    if (!event || typeof event !== "object") return undefined;
    const sender = (event as { sender?: unknown }).sender;
    return sender && typeof sender === "object" ? sender as CediaDirtyEditorSender : undefined;
  };

  const update = (event: unknown, value: unknown): void => {
    try {
      // A bundle paired with an older Code-OSS patch has no trusted-sender
      // callback. Ignore IPC in that case instead of accepting arbitrary senders.
      if (!options.isTrustedSender || !options.isTrustedSender(event)) return;
    } catch {
      return;
    }
    const sender = senderFrom(event);
    const count = normalizeCount(value);
    if (!sender || count === undefined) return;

    if (!counts.has(sender)) {
      const onDestroyed = () => {
        counts.delete(sender);
        cleanups.delete(sender);
      };
      sender.once?.("destroyed", onDestroyed);
      cleanups.set(sender, () => sender.removeListener?.("destroyed", onDestroyed));
    }
    counts.set(sender, count);
  };

  return {
    update,
    read: () => {
      let total = 0;
      for (const count of counts.values()) {
        total = Math.min(Number.MAX_SAFE_INTEGER, total + count);
      }
      return total;
    },
    dispose: () => {
      for (const cleanup of cleanups.values()) cleanup();
      cleanups.clear();
      counts.clear();
    },
  };
}

/**
 * The Code-OSS shutdown seam, narrowed to the one call Cedia makes on it.
 * `ILifecycleMainService.onWillShutdown` hands every listener a `ShutdownEvent`
 * whose `join(id, promise)` delays the real quit until that promise settles.
 */
export interface CediaLifecycleMainService {
  onWillShutdown(listener: (event: { join(id: string, promise: Promise<void>): void }) => void): unknown;
  /**
   * Patch `0062`. Optional so a checkout without the patch still installs the
   * shutdown join and the login item instead of failing the whole block.
   */
  registerQuitDecider?(decider: () => Promise<boolean>): unknown;
}

export interface CediaMainProcessLifecycleOptions extends GatewayOptions {
  readonly lifecycleMainService: CediaLifecycleMainService;
  /** Code-OSS's sender-validated IPC surface (patch `0063`). */
  readonly ipcMain?: Pick<IpcMain, "on" | "removeListener">;
  /** The app supplies this so Agent Window/webview senders cannot publish IDE state. */
  readonly isTrustedWorkbenchSender?: (event: unknown) => boolean;
  readonly log?: (message: string) => void;
  /** Test seam. The packaged main process leaves this unset and Electron is used. */
  readonly electronApp?: CediaElectronAppSurface;
  /** Test seam. The packaged main process leaves this unset and Electron's dialog is used. */
  readonly electronDialog?: CediaElectronDialogSurface;
  /** Test seam. The packaged main process leaves this unset and Electron's windows are counted. */
  readonly windowsOpen?: () => number;
  /** Test seam. The packaged main process leaves this unset and the real gateway is used. */
  readonly gateway?: CediaLifecycleGateway;
}

export interface CediaElectronAppSurface {
  readonly isPackaged: boolean;
  setLoginItemSettings(settings: { openAtLogin: boolean; openAsHidden?: boolean }): void;
  getLoginItemSettings(): { openAtLogin?: boolean; wasOpenedAtLogin?: boolean };
}

/** The one dialog call the pre-quit decision makes, narrowed so tests can answer it. */
export interface CediaElectronDialogSurface {
  showMessageBox(options: {
    readonly type?: "question";
    readonly buttons: readonly string[];
    readonly defaultId?: number;
    readonly cancelId?: number;
    readonly message: string;
    readonly detail?: string;
    readonly noLink?: boolean;
  }): Promise<{ readonly response: number }>;
}

/**
 * Install the Cedia application lifetime into Code-OSS's own lifecycle.
 *
 * Two things happen here, both owned by one coordinator so nothing competes for
 * the host:
 *
 * 1. Shutdown joins. Code-OSS waits for `onWillShutdown` joins before the process
 *    exits, so the host stops, its tasks pause and the durable `stopped` receipt is
 *    written first (plan §2.7 "Deliberate Quit"). No independent daemon is left
 *    behind, and a host that will not stop is logged rather than reported as a
 *    successful Quit.
 * 2. Login item. A packaged build registers itself as a macOS login item; a login
 *    launch then opens no work window and replays no task (plan §3.C login row).
 * 3. Quit decision. The same service asks Cedia before it records a quit, so the
 *    owner can answer Stop-and-quit or Cancel while cancelling is still real
 *    (plan §2.7 "Deliberate Quit", patch `0062`).
 *
 * Everything is one coordinator on purpose: nothing here may start a second host
 * or a second execution owner.
 */
export function installCediaMainProcessLifecycle(options: CediaMainProcessLifecycleOptions): {
  readonly loginItem: { enabled: boolean; reason?: string };
  shouldOpenFirstWindow(hasOpenableArguments: boolean): boolean;
  readonly lifecycle: CediaAppLifecycle;
  readonly dispose: () => void;
} {
  // Electron is only resolvable inside the real main process; tests and typecheck
  // pass their own surface, matching the theme publisher below.
  const electronApp = options.electronApp ?? (require("electron") as { app: CediaElectronAppSurface }).app;
  // The dialog and the window count are read lazily so a unit test that never
  // asks about a quit never needs Electron at all.
  const electronDialog = (): CediaElectronDialogSurface =>
    options.electronDialog ?? (require("electron") as { dialog: CediaElectronDialogSurface }).dialog;
  const windowsOpen = options.windowsOpen ?? ((): number => {
    const electron = require("electron") as { BrowserWindow?: { getAllWindows(): unknown[] } };
    return electron.BrowserWindow?.getAllWindows().length ?? 1;
  });
  const gateway = options.gateway ?? createAgentHostGateway(options);
  const dirtyEditors = createCediaDirtyEditorReader({ isTrustedSender: options.isTrustedWorkbenchSender });
  const onDirtyEditors = (event: unknown, ...args: unknown[]) => dirtyEditors.update(event, args[0]);
  options.ipcMain?.on?.(CEDIA_DIRTY_EDITORS_CHANNEL, onDirtyEditors);
  const lifecycle = createCediaAppLifecycle({
    gateway,
    readDirtyEditors: () => dirtyEditors.read(),
    confirmStopAndQuit: (state) => askBeforeStopping(state, electronDialog(), options.log),
    onChange: state => options.log?.(`Cedia host lifecycle: ${state.phase}`),
  });
  const join = createCediaShutdownJoin({ lifecycle, log: options.log });
  options.lifecycleMainService.onWillShutdown(event => event.join("cedia-host-shutdown", join()));
  const quitDecision = options.lifecycleMainService.registerQuitDecider?.(createCediaQuitDecision({ lifecycle, windowsOpen }));
  const loginItem = registerCediaLoginItem({
    isPackaged: electronApp.isPackaged,
    setLoginItemSettings: settings => electronApp.setLoginItemSettings(settings),
    log: options.log,
  });
  let wasOpenedAtLogin = false;
  try {
    wasOpenedAtLogin = electronApp.getLoginItemSettings().wasOpenedAtLogin === true;
  } catch {
    wasOpenedAtLogin = false;
  }
  return {
    loginItem,
    lifecycle,
    shouldOpenFirstWindow: hasOpenableArguments => shouldOpenFirstWindowAtLaunch({
      isPackaged: electronApp.isPackaged,
      wasOpenedAtLogin,
      hasOpenableArguments,
    }),
    dispose: () => {
      // The join is one-shot; the quit registration is not, so a caller that
      // reinstalls the lifecycle (a test, or a relaunch) cannot leave two
      // deciders deciding one quit.
      (quitDecision as { dispose?(): void } | undefined)?.dispose?.();
      options.ipcMain?.removeListener?.(CEDIA_DIRTY_EDITORS_CHANNEL, onDirtyEditors);
      dirtyEditors.dispose();
    },
  };
}

/**
 * Ask the owner whether a deliberate Quit may stop active work.
 *
 * The dialog is the real macOS one. A dialog that cannot be shown is not treated
 * as consent: Cedia keeps the application running and reports why, because
 * quitting on an unanswered prompt would stop work nobody agreed to stop.
 */
async function askBeforeStopping(
  state: { runningSessions: number; remotePaired: boolean; dirtyEditors: number },
  dialog: CediaElectronDialogSurface,
  log?: (message: string) => void,
): Promise<"stop" | "cancel"> {
  const work = state.runningSessions === 1 ? "1 task is still running" : `${state.runningSessions} tasks are still running`;
  const dirty = state.dirtyEditors > 0
    ? ` ${state.dirtyEditors === 1 ? "1 file has" : `${state.dirtyEditors} files have`} unsaved changes; Cedia will ask about them as the window closes.`
    : "";
  const remote = state.remotePaired ? " A paired device is connected and will lose access." : "";
  try {
    const answer = await dialog.showMessageBox({
      type: "question",
      buttons: ["Stop and Quit", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      message: "Quit Cedia and stop its work?",
      detail: `${work}.${dirty}${remote} Stop and Quit stops the running turns and holds queued work until you Continue the task.`,
    });
    const decision = answer.response === 0 ? "stop" : "cancel";
    log?.(decision === "stop" ? `Cedia stops ${state.runningSessions} running task(s) with the application` : "Cedia cancelled the quit");
    return decision;
  } catch (error) {
    log?.(`Cedia could not ask about quitting: ${error instanceof Error ? error.message : "the dialog failed"}`);
    return "cancel";
  }
}

/** The renderer channel one Mac window learns the other window's draft revision on (§2.5 item 1). */
// The channel name is not free: the Code-OSS preload refuses any subscription whose channel does
// not start with `vscode:` (`validateIPC`, measured by running the packaged window), so a Cedia
// event that the renderer subscribes to has to live in that namespace.
export const CEDIA_DRAFT_UPDATE_CHANNEL = "vscode:cedia-draft-updated";
/** The renderer channel one Mac window learns the other window's committed preferences on (§6.4). */
export const CEDIA_PREFERENCES_UPDATE_CHANNEL = "vscode:cedia-settings-updated";

/**
 * Send a committed revision to every *other* window.
 *
 * Electron is only resolvable inside the real main process (tests and typecheck never execute
 * this branch), and the sending window already knows the answer - re-delivering it there would
 * only make a window reconcile with itself.
 */
export function publishToOtherWindows(channel: string, event: unknown, update: unknown, windows?: readonly unknown[]): void {
  const sender = (event as { sender?: unknown } | undefined)?.sender;
  let targets: readonly unknown[];
  try {
    targets = windows ?? ((require("electron") as { BrowserWindow?: { getAllWindows(): unknown[] } }).BrowserWindow?.getAllWindows() ?? []);
  } catch {
    return;
  }
  for (const target of targets) {
    const contents = (target as { webContents?: unknown })?.webContents;
    if (!contents || contents === sender) continue;
    try {
      (contents as { send?: (channel: string, value: unknown) => void }).send?.(channel, update);
    } catch {
      // A window can close between the write and the publication; the next hydrate covers it.
    }
  }
}

export function publishDraftUpdate(event: unknown, update: unknown, windows?: readonly unknown[]): void {
  publishToOtherWindows(CEDIA_DRAFT_UPDATE_CHANNEL, event, update, windows);
}

export function registerCediaAgentWindowBridge(options: AgentWindowBridgeOptions): { dispose(): void } {
  const gateway = createAgentHostGateway(options);
  const panels = {
    terminal: createAgentTerminalService({ appRoot: options.appRoot }),
    files: createAgentFilesService(),
    git: createAgentGitService({ ensureClient: () => gateway.ensureClient() }),
    browser: createAgentBrowserService({ appRoot: options.appRoot }),
    device: createAgentDeviceService({ appRoot: options.appRoot, stateDir: options.stateDir, helperSourceDir: join(options.appRoot, "out/vs/cedia/agent/native/device-helper") }),
  };
  options.ipcMain.handle(AGENT_WINDOW_CHANNEL, createAgentWindowHandler({ ...options, ensure: gateway.ensure, request: gateway.request,
    panel: (event, surface, method, input) => panels[surface as keyof typeof panels].handle(event, method, input),
    broadcastDraft: (event, update) => publishDraftUpdate(event, update),
    broadcastPreferences: (event, update) => publishToOtherWindows(CEDIA_PREFERENCES_UPDATE_CHANNEL, event, update),
  }));
  // The extension host may never run in the agents window, so no extension is
  // around to publish the theme the window actually shows. The main process
  // watches the agents workspace file itself (plus OS appearance) and keeps the
  // shared snapshot current; the IDE extension converges on the same values.
  // Electron is only resolvable inside the real main process (tests and typecheck
  // never execute this branch); keep it out of the static imports so neither tries.
  const electronModule = require("electron") as {
    app: { getPath(name: "userData"): string };
    nativeTheme: {
      readonly shouldUseDarkColors: boolean;
      on(event: "updated", listener: () => void): void;
      removeListener(event: "updated", listener: () => void): void;
    };
  };
  const userDataDir = electronModule.app.getPath("userData");
  const readTextFile = (path: string): string | undefined => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  };
  const themePublisher = startAgentThemePublisher({
    stateDir: options.stateDir,
    workspaceFile: join(userDataDir, "User", AGENTS_WINDOW_WORKSPACE),
    extensionsDirs: [join(options.appRoot, "extensions"), join(userDataDir, "extensions")],
    readTextFile,
    listDir: (path: string): string[] => {
      try {
        return readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
      } catch {
        return [];
      }
    },
    joinPath: join,
    fileMtimeMs: (path: string): number | undefined => {
      try {
        return statSync(path).mtimeMs;
      } catch {
        return undefined;
      }
    },
    readSystemDark: () => electronModule.nativeTheme.shouldUseDarkColors,
    onSystemThemeUpdated: (listener: () => void) => {
      electronModule.nativeTheme.on("updated", listener);
      return () => electronModule.nativeTheme.removeListener("updated", listener);
    },
    setIntervalFn: (callback: () => void, ms: number): unknown => {
      const timer = setInterval(callback, ms);
      (timer as unknown as { unref?: () => void }).unref?.();
      return timer;
    },
    clearIntervalFn: (handle: unknown) => clearInterval(handle as NodeJS.Timeout),
  });
  void themePublisher.tick();
  return { dispose: () => {
    themePublisher.dispose();
    options.ipcMain.removeHandler(AGENT_WINDOW_CHANNEL);
    for (const service of Object.values(panels)) service.dispose();
  } };
}

/**
 * Patch `0057` reads this from the same module and uses it to let Cedia's browser
 * guests navigate: without the export the packaged app's main process holds
 * `undefined` and every in-page navigation is refused (measured 2026-09-23, which
 * is how the missing re-export was caught). `main.cjs` is the module the desktop
 * main process loads, so both names must leave this file.
 */
export { isCediaAgentBrowserWebContents } from "./agent-window-browser.ts";
