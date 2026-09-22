import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { CediaHostClient } from "./api.ts";
import { createAgentTerminalService } from "./agent-window-terminal.ts";
import { createAgentFilesService } from "./agent-window-files.ts";
import { createAgentBrowserService } from "./agent-window-browser.ts";
import { createAgentGitService } from "./agent-window-git.ts";
import { createAgentDeviceService } from "./agent-window-device.ts";
import { agentUiStateDir, readAgentUiState, resolveAgentUiThread, saveIdeHandoff, validAgentThreadId, writeAgentUiState } from "./agent-ui-state.ts";
import { readAgentThemeSnapshot } from "./agent-theme.ts";
import { startAgentThemePublisher } from "./agent-window-theme-publisher.ts";
import { AGENTS_WINDOW_WORKSPACE } from "./workbench-mode.ts";
import { defaultKeybindingsFile, readKeybindingsFile, writeKeybindingRule } from "./agent-window-keybindings.ts";

import { AGENT_WINDOW_CHANNEL } from "./bridge-contract.ts";
export { AGENT_WINDOW_CHANNEL };
/** The HTTP methods a renderer may ask the host for; exported so a caller (and its
 * tests) can name the contract instead of restating it. */
export type HostMethod = "GET" | "POST" | "PATCH" | "DELETE";
export interface IdeTarget { cwd: string; path?: string; line?: number }
interface HandlerOptions {
  stateDir?: string;
  authorize(event: unknown): boolean;
  ensure(): Promise<void>;
  request(method: HostMethod, path: string, body?: unknown): Promise<unknown>;
  pickFolder(event: unknown): Promise<string | null>;
  openIde(input: IdeTarget, event: unknown): Promise<void>;
	openExternal(url: string): Promise<void>;
	getZoomFactor?(event: unknown): number;
	zoom?(event: unknown, action: "in" | "out" | "reset"): number;
	panel?(event: unknown, surface: string, method: string, input: unknown): Promise<unknown>;
  version?: string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Agent Window request");
  return value as Record<string, unknown>;
}
interface KeybindingsRequest {
	readonly action?: unknown;
	readonly file?: unknown;
	readonly rule?: unknown;
	readonly replacing?: unknown;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 16_384 || /[\u0000-\u001f]/.test(value)) throw new Error("Invalid Agent Window argument");
  return value;
}

/** Only application routes are exposed; device credentials and editor registration stay native. */
function applicationPath(value: unknown): string {
  const path = text(value);
  if (!path.startsWith("/v1/") || path.includes("\\") || path.includes("#")) throw new Error("Invalid application path");
  const pathname = path.split("?")[0]!;
  const segments = pathname.split("/").map(part => decodeURIComponent(part));
  if (segments.some(part => part === "." || part === ".." || /[/\\\u0000-\u001f]/.test(part))) throw new Error("Invalid application path");
  if (!["health", "projects", "sessions", "responses", "models", "voice", "workspace-suggestion"].includes(segments[2]!)) throw new Error("Unsupported application route");
  return path.slice(4);
}

export function createAgentWindowHandler(options: HandlerOptions) {
  return async (event: unknown, input: unknown): Promise<unknown> => {
    if (!options.authorize(event)) throw new Error("Untrusted Agent Window sender");
    const value = record(input);
    switch (value.kind) {
      case "panel": {
        const surface = text(value.surface);
        if (!["terminal", "browser", "files", "device", "git"].includes(surface) || !options.panel) throw new Error("Unsupported native panel");
        const method = text(value.method);
        if (value.input !== undefined && JSON.stringify(value.input).length > 16 * 1024 * 1024) throw new Error("Panel request is too large");
        return options.panel(event, surface, method, value.input);
      }
      case "bootstrap": {
        await options.ensure();
        const theme = await readAgentThemeSnapshot(options.stateDir);
        return {
          platform: process.platform,
          homeDir: homedir(),
          worktreesDir: join(options.stateDir ?? process.env.CEDIA_STATE_DIR ?? join(homedir(), "Library", "Application Support", "Cedia", "host"), "worktrees"),
          version: options.version ?? "0.1.0",
          ...(theme ? { theme } : {}),
        };
      }
      case "theme":
        return (await readAgentThemeSnapshot(options.stateDir)) ?? null;
      case "request": {
        if (!["GET", "POST", "PATCH", "DELETE"].includes(String(value.method))) throw new Error("Unsupported application method");
        const path = applicationPath(value.path);
        if (value.body !== undefined && JSON.stringify(value.body).length > 16 * 1024 * 1024) throw new Error("Application request is too large");
        return options.request(value.method as HostMethod, path, value.body);
      }
      case "pickFolder": return options.pickFolder(event);
      case "openIde": {
        const cwd = text(value.cwd);
        if (!isAbsolute(cwd)) throw new Error("IDE workspace must be an absolute path");
        const target: IdeTarget = { cwd: resolve(cwd) };
        if (value.path !== undefined) {
          target.path = resolve(cwd, text(value.path));
          const child = relative(target.cwd, target.path);
          if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error("IDE file must belong to the workspace");
        }
        if (value.line !== undefined) {
          if (!Number.isSafeInteger(value.line) || (value.line as number) < 1) throw new Error("Invalid IDE line");
          target.line = value.line as number;
        }
        if (value.sessionId !== undefined) {
          if (!validAgentThreadId(value.sessionId)) throw new Error("Invalid IDE session");
          const session = await resolveAgentUiThread(options.stateDir, value.sessionId, path => options.request("GET", path));
          if (resolve(session.cwd) !== target.cwd) throw new Error("IDE session does not belong to this workspace");
          await saveIdeHandoff(options.stateDir, target.cwd, value.sessionId);
        }
        await options.openIde(target, event);
        return;
      }
      case "uiDraft": {
        if (!validAgentThreadId(value.threadId)) throw new Error("Invalid draft thread");
        const key = `draft:${value.threadId}`;
        const directory = agentUiStateDir(options.stateDir);
        if (value.action === "read") return readAgentUiState(directory, key);
        if (value.action !== "write" || !value.draft || typeof value.draft !== "object" || Array.isArray(value.draft) || JSON.stringify(value.draft).length > 2 * 1024 * 1024) throw new Error("Invalid draft state");
        await writeAgentUiState(directory, key, value.draft);
        return null;
      }
      case "openExternal": {
        const url = new URL(text(value.url));
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Only web links can be opened externally");
        await options.openExternal(url.toString());
        return;
      }
      case "getZoomFactor": {
			if (!options.getZoomFactor) throw new Error("Desktop zoom is unavailable");
			return options.getZoomFactor(event);
		}
		case "zoom": {
			if (!options.zoom || !["in", "out", "reset"].includes(String(value.action))) throw new Error("Invalid desktop zoom action");
			return options.zoom(event, value.action as "in" | "out" | "reset");
		}
      case "keybindings": {
        const body = value as KeybindingsRequest;
        // Tests point the owned file at a temp dir through CEDIA_KEYBINDINGS_FILE;
        // anything else is refused even for a trusted sender.
        const allowed = process.env.CEDIA_KEYBINDINGS_FILE ?? defaultKeybindingsFile();
        const requested = typeof body.file === "string" && body.file.length > 0 ? body.file : allowed;
        if (resolve(requested) !== resolve(allowed)) throw new Error("Keybindings are owned by the workbench user file.");
        if (body.action === "read") return readKeybindingsFile(allowed);
        if (body.action === "write") return writeKeybindingRule(allowed, body.rule, body.replacing);
        throw new Error("Unsupported keybindings action");
      }
      default: throw new Error("Unsupported Agent Window operation");
    }
  };
}

interface GatewayOptions { appRoot: string; parentPid: number; stateDir?: string }

/** One client/launcher per application, independent of the lifetime of any IDE extension host. */
export function createAgentHostGateway(options: GatewayOptions) {
  const stateDir = options.stateDir ?? process.env.CEDIA_STATE_DIR ?? join(homedir(), "Library", "Application Support", "Cedia", "host");
  let client: CediaHostClient | undefined;
  let pending: Promise<CediaHostClient> | undefined;
  async function healthy(): Promise<CediaHostClient | undefined> {
    try {
      const candidate = await CediaHostClient.fromStateDir(stateDir, { requirePrivateMode: true, timeoutMs: 1500 });
      await candidate.health();
      return new CediaHostClient({ descriptor: candidate.descriptor, timeoutMs: 30_000 });
    } catch { return undefined; }
  }
  async function start(): Promise<CediaHostClient> {
    const existing = await healthy();
    if (existing) return existing;
    const runtime = join(options.appRoot, "extensions/cedia/runtime");
    const bundledNode = join(runtime, "node/bin/node");
    const bundledHost = join(runtime, "host/cli.js");
    const developmentHost = resolve(options.appRoot, "../dist/host/cli.js");
    const executable = process.env.CEDIA_HOST_NODE ?? (existsSync(bundledNode) ? bundledNode : process.execPath);
    const script = existsSync(bundledHost) ? bundledHost : developmentHost;
    if (!existsSync(script)) throw new Error("Cedia host is not built. Run the Cedia build before opening Agents.");
    await new Promise<void>((done, reject) => {
      const child = spawn(executable, [script, "ensure"], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", CEDIA_STATE_DIR: stateDir, CEDIA_PARENT_PID: String(options.parentPid) },
        stdio: "ignore",
        timeout: 25_000,
      });
      child.once("error", reject);
      child.once("exit", code => code === 0 ? done() : reject(new Error("Cedia host could not start; inspect its private host log.")));
    });
    const ready = await healthy();
    if (!ready) throw new Error("Cedia host did not become ready");
    return ready;
  }
  async function ensureClient(): Promise<CediaHostClient> {
    if (client) return client;
    pending ??= start();
    const attempt = pending;
    try { client = await attempt; return client; }
    finally { if (pending === attempt) pending = undefined; }
  }
  return {
    ensure: async () => { await ensureClient(); },
    ensureClient,
    request: async (method: HostMethod, path: string, body?: unknown): Promise<unknown> => {
      const active = await ensureClient();
      try { return await active.requestApplication(method, path, body); }
      catch (error) {
        // Invalidate the connection, but never replay a mutation whose outcome may be unknown.
        if (client === active) client = undefined;
        throw error;
      }
    },
  };
}

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

export { isCediaAgentBrowserWebContents } from "./agent-window-browser.ts";
