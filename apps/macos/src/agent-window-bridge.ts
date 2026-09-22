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
import { AGENTS_WINDOW_WORKSPACE } from "./workbench-mode.ts";

interface IpcMain {
  handle(channel: string, listener: (event: unknown, input: unknown) => Promise<unknown>): void;
  removeHandler(channel: string): void;
}
export interface AgentWindowBridgeOptions extends GatewayOptions, Omit<HandlerOptions, "request" | "ensure"> { ipcMain: IpcMain }

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

