import * as vscode from "vscode";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CediaHostClient } from "./api.ts";
import { createAgentWindowHandler } from "./agent-window-main.ts";
import { readIdeHandoff, resolveAgentUiThread, validAgentThreadId } from "./agent-ui-state.ts";
import { createAgentFilesService } from "./agent-window-files.ts";
import { createAgentGitService, type AgentGitService } from "./agent-window-git.ts";
import { writeAgentThemeSnapshot } from "./agent-theme.ts";

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

/** The IDE is another view of the existing host, never another agent runtime. */
export class CediaIdeAgentProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private revision: string | undefined;
  private sessionId: string | undefined;
  private syncedSessionId: string | undefined;
  private disposed = false;
  private ready = false;
  private pendingActions: unknown[] = [];
  private readonly files = createAgentFilesService();
  private readonly git: AgentGitService;
  private themeWrite: Promise<void> | undefined;
  constructor(private readonly context: vscode.ExtensionContext, private readonly stateDir: string,
    private readonly ensureClient: () => Promise<CediaHostClient>,
    private readonly onSession: (id: string) => Promise<void>) {
    this.git = createAgentGitService({ ensureClient: () => this.ensureClient() });
  }

  private cwd(): string | null { return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null; }

  async focus(action: "focus" | "newTask" = "focus"): Promise<void> {
    await vscode.commands.executeCommand("cediaComposerDock.focus");
    this.view?.show(false);
    await this.sendAction({ type: "cedia-agent-action", action });
  }
  async appendContext(text: string): Promise<void> {
    await this.focus();
    await this.sendAction({ type: "cedia-agent-action", action: "appendContext", text });
  }
  async openAgents(): Promise<void> {
    if (this.ready && this.view) {
      await this.sendAction({ type: "cedia-agent-action", action: "openAgents" });
      return;
    }
    await vscode.commands.executeCommand("workbench.action.openAgentsWindow", {
      ...(this.cwd() ? { folderUri: vscode.Uri.file(this.cwd()!) } : {}),
      ...(this.sessionId ? { sessionResource: vscode.Uri.parse(`cedia://session/${this.sessionId}`) } : {}),
    });
  }
  private async sendAction(message: unknown): Promise<void> {
    if (!this.ready || !this.view) { this.pendingActions.push(message); return; }
    await this.view.webview.postMessage(message);
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    this.ready = false;
    const assetRoot = vscode.Uri.joinPath(this.context.extensionUri, "agent-ui");
    view.webview.options = { enableScripts: true, localResourceRoots: [assetRoot] };
    const panelEvent = { sender: {
      send: (channel: string, payload: unknown) => { void view.webview.postMessage({ type: "cedia-agent-event", channel, payload }); },
      isDestroyed: () => this.disposed || this.view !== view,
    } };
    const handler = createAgentWindowHandler({
      stateDir: this.stateDir,
      authorize: event => event === view && this.view === view && !this.disposed,
      ensure: async () => { await this.ensureClient(); },
      request: async (method, path, body) => (await this.ensureClient()).requestApplication(method, path, body),
      pickFolder: async () => (await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false }))?.[0]?.fsPath ?? null,
      openIde: async target => {
        if (target.path) {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target.path));
          const editor = await vscode.window.showTextDocument(document, { preview: true });
          if (target.line) { const position = new vscode.Position(target.line - 1, 0); editor.selection = new vscode.Selection(position, position); editor.revealRange(new vscode.Range(position, position)); }
        } else if (this.cwd() !== target.cwd) await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(target.cwd), { forceNewWindow: true });
      },
      openExternal: async url => { await vscode.env.openExternal(vscode.Uri.parse(url)); },
      getZoomFactor: () => 1,
      panel: async (_event, surface, method, input) => {
        if (surface === "files") return this.files.handle(panelEvent, method, input);
        if (surface === "git") return this.git.handle(panelEvent, method, input);
        throw new Error(`Open ${surface} in the IDE workbench or Agents Window`);
      },
    });
    const messages = view.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const row = message as Record<string, unknown>;
      if (row.type === "cedia-agent-theme") {
        // Theme values originate in the trusted Code-OSS webview, but still
        // pass through the shared validator before crossing into the standalone
        // Agent window. Serialize writes so a rapid theme repaint cannot leave
        // a partial snapshot behind.
        const pending = this.themeWrite?.catch(() => undefined) ?? Promise.resolve();
        this.themeWrite = pending.then(() => writeAgentThemeSnapshot(this.stateDir, row.snapshot));
        await this.themeWrite;
        return;
      }
      if (row.type === "cedia-agent-ready") {
        this.ready = true;
        for (const action of this.pendingActions.splice(0)) await view.webview.postMessage(action);
        return;
      }
      if (row.type !== "cedia-agent-request" || typeof row.id !== "string" || row.id.length > 128) return;
      try {
        if (row.channel !== "vscode:cediaAgent") throw new Error("Unsupported IDE bridge channel");
        const input = row.input as Record<string, unknown> | undefined;
        let result: unknown;
        if (input?.kind === "activeSession") {
          if (!validAgentThreadId(input.sessionId)) throw new Error("Invalid active session");
          const session = await (await this.ensureClient()).getSession(input.sessionId);
          if (this.cwd() && resolve(session.cwd) !== resolve(this.cwd()!)) throw new Error("Session belongs to another workspace");
          if (this.syncedSessionId !== session.id) {
            await this.onSession(session.id);
            this.syncedSessionId = session.id;
            this.sessionId = session.id;
          }
          result = null;
        } else if (input?.kind === "openAgents") {
          const cwd = this.cwd();
          const id = validAgentThreadId(input.sessionId) ? input.sessionId : this.sessionId;
          if (id) await resolveAgentUiThread(this.stateDir, id, async path => (await this.ensureClient()).requestApplication("GET", path));
          await vscode.commands.executeCommand("workbench.action.openAgentsWindow", {
            ...(cwd ? { folderUri: vscode.Uri.file(cwd) } : {}),
            ...(id ? { sessionResource: vscode.Uri.parse(`cedia://session/${id}`) } : {}),
          });
        } else {
          result = await handler(view, row.input);
          if (input?.kind === "bootstrap") {
            await this.readContext(false);
            result = { ...(result as object), cwd: this.cwd(), sessionId: this.sessionId };
          }
        }
        await view.webview.postMessage({ type: "cedia-agent-response", id: row.id, result });
      } catch (error) {
        await view.webview.postMessage({ type: "cedia-agent-response", id: row.id, error: error instanceof Error ? error.message : String(error) });
      }
    });
    view.onDidDispose(() => { messages.dispose(); if (this.view === view) this.view = undefined; });
    try {
      let html = await readFile(join(this.context.extensionPath, "agent-ui", "ide.html"), "utf8");
      html = html.replace(/(?:src|href)="(\.\/[^\"]+)"/g, (match, relative: string) => match.replace(relative, escapeAttribute(view.webview.asWebviewUri(vscode.Uri.joinPath(assetRoot, relative.slice(2))).toString())));
      const csp = `default-src 'none'; script-src ${view.webview.cspSource}; style-src ${view.webview.cspSource} 'unsafe-inline'; img-src ${view.webview.cspSource} data: blob: https:; font-src ${view.webview.cspSource} data:; connect-src ${view.webview.cspSource}; worker-src blob:;`;
      html = html.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">`);
      view.webview.html = html;
      this.timer ??= setInterval(() => { void this.readContext(true).catch(error => console.error("Cedia IDE handoff failed", error)); }, 750);
    } catch (error) {
      view.webview.html = `<html><body><p>Could not load Cedia Agent UI. Rebuild Cedia to install its assets.</p></body></html>`;
      console.error(error);
    }
  }

  private async readContext(notify: boolean): Promise<void> {
    const cwd = this.cwd();
    if (!cwd) return;
    const handoff = await readIdeHandoff(this.stateDir, cwd);
    if (!handoff || handoff.revision === this.revision) return;
    const session = await resolveAgentUiThread(this.stateDir, handoff.sessionId, async path => (await this.ensureClient()).requestApplication("GET", path));
    if (resolve(session.cwd) !== resolve(cwd)) throw new Error("IDE handoff workspace mismatch");
    if (session.durable) {
      await this.onSession(session.id);
      this.syncedSessionId = session.id;
    }
    this.revision = handoff.revision;
    this.sessionId = session.id;
    if (notify && this.view) {
      this.view.show(true);
      await this.view.webview.postMessage({ type: "cedia-agent-context", cwd, sessionId: session.id });
    }
  }
  dispose(): void { this.disposed = true; if (this.timer) clearInterval(this.timer); this.files.dispose(); this.git.dispose(); this.view = undefined; }
}
