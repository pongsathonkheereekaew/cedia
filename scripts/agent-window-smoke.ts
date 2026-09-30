/** Exercise the shipped frontend against a real isolated Cedia host and a provider-free OMP fixture. */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";
import { createAgentHostGateway, createAgentWindowHandler } from "../apps/macos/src/agent-window-main.ts";
import { createAgentGitService } from "../apps/macos/src/agent-window-git.ts";

const root = resolve(import.meta.dir, "..");
const native = process.argv.includes("--native");
const { chromium, _electron } = createRequire(join(root, "desktop/package.json"))("playwright");
// macOS points /tmp at /private/tmp: canonicalize once so the stored project path, Git’s
// toplevel answer, and the IDE handoff all spell the folder the same way.
const scratch = await realpath(await mkdtemp(join(tmpdir(), "cedia-agent-ui-")));
const projectPath = join(scratch, "project");
await mkdir(projectPath);
await writeFile(join(projectPath, "hello.txt"), "Agent Window fixture\n");
// Plan section 3.C admits one file-mutating task per folder: a second task in the same project
// needs its own worktree, which needs a Git repository, so the fixture project is one.
execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["add", "hello.txt"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["-c", "user.email=fixture@cedia", "-c", "user.name=Cedia Fixture", "commit", "-m", "fixture"], { cwd: projectPath, stdio: "ignore" });
const host = await startHostServer({
  stateDir: join(scratch, "host"),
  ompExecutable: join(root, "apps/macos/test/fixtures/agent-window-omp"),
  ompEnv: { CEDIA_NODE: process.execPath },
});
const project = host.host.store.createProject({ path: projectPath, name: "Agent Window fixture" });
const session = host.host.createSession(project.id, "Fixture task");
// Deliberately idle: the first send must start OMP before claiming its command.
const gateway = createAgentHostGateway({ appRoot: root, parentPid: process.pid, stateDir: join(scratch, "host") });
const ideTargets: unknown[] = [];
let archiveRestore: unknown = null;
// The browser harness serves the same production Git panel the desktop bridge wires, so branch
// discovery (and the busy-project worktree default built on it) runs for real. Every other
// native surface stays unsupported, exactly as before.
const git = createAgentGitService({ ensureClient: () => gateway.ensureClient() });
const handler = createAgentWindowHandler({
  ...gateway,
  panel: async (event, surface, method, input) => {
    if (surface !== "git") throw new Error("Unsupported native panel");
    return git.handle(event, method, input);
  },
  authorize: () => true,
  pickFolder: async () => projectPath,
  openIde: async input => { ideTargets.push(input); },
  openExternal: async () => { throw new Error("External links are disabled in fixture tests"); },
  version: "fixture",
});
const output = join(root, native ? "dist/agent-window-native-smoke" : "dist/agent-window-smoke");
await mkdir(output, { recursive: true });
const assets = join(root, "dist/agent-window");
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url);
    const path = resolve(assets, `.${decodeURIComponent(url.pathname)}`);
    if (path !== assets && !path.startsWith(`${assets}/`)) return new Response("Not found", { status: 404 });
    const file = Bun.file(path === assets ? join(assets, "index.html") : path);
    if (await file.exists()) return new Response(file);
    return new Response(Bun.file(join(assets, "index.html")));
  },
});
// Match the personal launcher before testing an ad-hoc re-signed application.
if (native) {
  try { execFileSync("security", ["delete-generic-password", "-s", "Cedia Safe Storage"], { stdio: "ignore" }); } catch {}
}
const browser = native ? await _electron.launch({
  executablePath: join(root, `VSCode-darwin-${process.arch}/Cedia.app/Contents/MacOS/Cedia`),
  args: ["--user-data-dir", join(scratch, "profile"), "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
  env: { ...process.env, CEDIA_STATE_DIR: join(scratch, "host"), CEDIA_HOST_NODE: "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node" },
  timeout: 45_000,
}) : await chromium.launch({ headless: true, channel: "chromium" });
const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });

// Branch discovery can remount the composer right after it first appears; filling before the
// branch control settles risks typing into an element a re-render then discards. Settle, fill,
// and only click once Send reports itself enabled, refilling when a late re-render wins the race.
async function fillComposerAndSend(text: string): Promise<void> {
  const box = page.locator('[contenteditable="true"]').first();
  await box.waitFor({ state: "visible", timeout: 20_000 });
  await page.getByText("Select branch").first().waitFor({ timeout: 20_000 }).catch(() => {});
  for (let attempt = 0; ; attempt++) {
    await box.fill(text);
    try {
      await page.waitForFunction(() => {
        const button = document.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
        return !!button && !button.disabled;
      }, undefined, { timeout: 10_000 });
      break;
    } catch {
      if (attempt >= 2) throw new Error(`Send stayed disabled after filling the composer with: ${text}`);
    }
  }
  await page.getByRole("button", { name: "Send message", exact: true }).click();
}
const errors: string[] = [];
function watch(target: { on(event: string, listener: (...args: any[]) => void): void }) {
  target.on("pageerror", (error: Error) => errors.push(error.message));
  target.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") errors.push(message.text()); });
  // Name the failing URL: a bare "Failed to load resource" cannot tell a real
  // regression (missing bundle asset) from environmental noise (favicon).
  target.on("response", (response: { status(): number; url(): string }) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  // file:// misses never produce a response event, only a failed request. Aborted
  // requests are navigation races (a later navigation cancels in-flight icon and
  // favicon fetches), not missing assets, so only non-aborted failures are recorded.
  target.on("requestfailed", (request: { url(): string; failure(): { errorText: string } | null }) => {
    const text = request.failure()?.errorText ?? "unknown";
    if (text === "net::ERR_ABORTED") return;
    errors.push(`REQFAIL ${text} ${request.url()}`);
  });
}
watch(page);
if (!native) {
await page.exposeBinding("__cediaFixtureInvoke", async (_source: unknown, channel: string, input: unknown) => {
  if (channel !== "vscode:cediaAgent") throw new Error(`Unexpected fixture IPC channel: ${channel}`);
  // The Git panel posts progress to the window's sender; the harness has no window, so it sinks them.
  return handler({ sender: { send: () => {} } }, input);
});
await page.addInitScript(() => {
  const target = window as unknown as { __cediaFixtureInvoke(channel: string, input: unknown): Promise<unknown>; vscode: unknown };
  target.vscode = {
    context: { resolveConfiguration: async () => ({ windowId: 1, isSessionsWindow: true }) },
    process: { platform: "darwin", env: {} },
    ipcRenderer: {
      invoke: (channel: string, input: unknown) => target.__cediaFixtureInvoke(channel, input),
      send: () => {}, on: () => {}, once: () => {}, removeListener: () => {},
    },
  };
});
}
try {
  if (!native) await page.goto(server.url.toString(), { waitUntil: "networkidle", timeout: 45_000 });
  await page.getByText("Agent Window fixture", { exact: true }).first().waitFor({ timeout: 20_000 });
  await page.screenshot({ path: join(output, "home.png"), fullPage: true });
  await page.getByText("Fixture task", { exact: true }).first().click();
  await page.locator('[contenteditable="true"]').first().waitFor({ state: "visible", timeout: 20_000 });
  async function recordNativeApi(): Promise<void> {
    await page.evaluate(() => {
      const target = window as any;
      target.__agentSmokeCommands = [];
    const originalApi = target.nativeApi;
    target.nativeApi = new Proxy(originalApi, { get(api, domain) {
      const value = api[domain];
      if (!value || typeof value !== "object") return value;
      return new Proxy(value, { get(group, method) {
        const fn = group[method];
        if (typeof fn !== "function" || String(method).startsWith("on")) return fn;
        return async (...args: unknown[]) => {
          const entry: any = { method: `${String(domain)}.${String(method)}`, args };
          target.__agentSmokeCommands.push(entry);
          try { return await fn.apply(group, args); } catch (error) { entry.error = String(error); throw error; }
        };
        } });
      } });
    });
  }
  await recordNativeApi();
  await fillComposerAndSend("Agent-first smoke test");
  await page.getByText("Fixture response: Agent-first smoke test", { exact: true }).first().waitFor({ timeout: 20_000 });
  await page.screenshot({ path: join(output, "conversation.png"), fullPage: true });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Fixture response: Agent-first smoke test", { exact: true }).first().waitFor({ timeout: 20_000 });
  await page.screenshot({ path: join(output, "restored.png"), fullPage: true });
  // A reload drops the recording proxy, so reinstall it before the new-thread send.
  await recordNativeApi();
  await page.getByText("Agent Window fixture", { exact: true }).first().hover();
  await page.getByRole("button", { name: "Create new thread in Agent Window fixture", exact: true }).click();
  await fillComposerAndSend("New task smoke test");
  await page.getByText("Fixture response: New task smoke test", { exact: true }).first().waitFor({ timeout: 20_000 });
  if (host.host.store.listSessions(project.id).length !== 2) throw new Error("Creating a task did not preserve one durable identity");
  // Archive/restore the worktree-backed second task through the host-owned pair, then observe
  // the restored transcript in the window: the retention record stays on the restoring row.
  const second = host.host.store.listSessions(project.id).find(candidate => candidate.id !== session.id);
  if (!second) throw new Error("Second task has no durable session to archive");
  const archivedView = host.host.archiveSession(second.id);
  if (!archivedView.archived) throw new Error("Archive did not mark the task archived");
  const receipt = JSON.parse(await readFile(join(scratch, "host", "sessions", second.id, "archive-receipt.json"), "utf8"));
  if (receipt.state !== "retained") throw new Error(`Archive receipt is not retained: ${JSON.stringify(receipt).slice(0, 160)}`);
  // Restore through the window's own Archived-list button (not the host API): Settings ->
  // Archived threads -> Restore on this task's row -> restored toast -> host row unarchived.
  await page.getByText("Settings", { exact: true }).first().click();
  await page.getByText("Archived threads", { exact: true }).first().click();
  await page.getByText(second.title, { exact: true }).first().waitFor({ timeout: 20_000 });
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByText("Thread restored", { exact: true }).first().waitFor({ timeout: 20_000 });
  if (host.host.store.getSession(second.id)?.archived !== false) throw new Error("Window Restore left the task archived");
  archiveRestore = { sessionId: second.id, worktree: receipt.worktree ?? null, ref: receipt.ref ?? null, commit: receipt.commit ?? null, via: "window-button" };
  // Return through the main sidebar (never a full navigation: in the packaged app goto
  // would leave the Electron window context). The snapshot poll reads the restored task
  // back into the nav; opening it renders the restored transcript.
  // Settings has its own nav (see failure capture: no thread rows there), so go back to
  // the app first; the snapshot poll reads the restored task into the thread sidebar.
  await page.getByText("Back to app", { exact: true }).first().click();
  await page.getByText(second.title, { exact: true }).first().waitFor({ timeout: 30_000 });
  await page.getByText(second.title, { exact: true }).first().click();
  await page.getByText("Fixture response: New task smoke test", { exact: true }).first().waitFor({ timeout: 20_000 });
  await page.screenshot({ path: join(output, "archived-restored.png"), fullPage: true });
  // A reload drops the recording proxy, so reinstall it before continuing.
  await recordNativeApi();
  await page.getByText("Fixture task", { exact: true }).first().click();
  await page.getByText("Fixture response: Agent-first smoke test", { exact: true }).first().waitFor({ timeout: 20_000 });
  const ideOpened = native ? browser.waitForEvent("window", { predicate: (candidate: any) => candidate !== page, timeout: 30_000 }) : undefined;
  // The header button launches the preferred editor directly; the environment panel row only picks it.
  const openIdeButtons = page.getByRole("button", { name: "Open in IDE", exact: true });
  await openIdeButtons.first().waitFor({ state: "visible", timeout: 20_000 });
  let launched = false;
  for (let index = 0; index < await openIdeButtons.count(); index++) {
    if (await openIdeButtons.nth(index).isEnabled()) {
      await openIdeButtons.nth(index).click();
      launched = true;
      break;
    }
  }
  if (!launched) throw new Error("No enabled Open in IDE button");
  if (native) {
    const ide = await ideOpened;
    watch(ide);
    await ide.waitForURL(/workbench/, { timeout: 30_000 });
    await ide.locator(".monaco-workbench").waitFor({ timeout: 30_000 });
    const config = await ide.evaluate(async () => (window as any).vscode.context.resolveConfiguration());
    if (config.workspace?.uri?.path !== project.path) throw new Error("Native IDE opened the wrong project");
    await ide.bringToFront();
    await ide.keyboard.press("Meta+Shift+A");
    await page.waitForFunction(() => document.hasFocus(), { timeout: 20_000 });
    if (browser.windows().length !== 2) throw new Error("Returning to Agents created a duplicate window");
    await page.getByText("Fixture response: Agent-first smoke test", { exact: true }).first().waitFor();
    ideTargets.push({ cwd: config.workspace.uri.path, windowsAfterReturn: browser.windows().length });
    await page.screenshot({ path: join(output, "returned-from-ide.png"), fullPage: true });
  }
  // openIde lands through an async IPC round-trip after the click resolves; wait for it instead
  // of asserting in the same tick the click returns.
  const handoffDeadline = Date.now() + 20_000;
  while (ideTargets.length === 0 && Date.now() < handoffDeadline) await new Promise(resolve => setTimeout(resolve, 100));
  if (ideTargets.length !== 1 || (ideTargets[0] as { cwd: string }).cwd !== project.path) {
    throw new Error("IDE handoff did not preserve the task workspace");
  }
  if (errors.length) throw new Error(`Renderer errors: ${errors.join("\n")}`);
  await writeFile(join(output, "result.json"), JSON.stringify({ ok: true, providerCalls: 0, projectId: project.id, sessionId: session.id, ideTargets, archiveRestore, errors }, null, 2));
  await Promise.all(["failure.json", "failure.png"].map(name => rm(join(output, name), { force: true })));
  console.log(`Agent Window UI smoke passed: ${output}`);
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true });
  await writeFile(join(output, "failure.json"), JSON.stringify({ error: String(error), errors, ideTargets, projectPath, frontendCommands: await page.evaluate(() => (window as any).__agentSmokeCommands), commands: host.host.store.listCommands(session.id), events: host.host.store.readEvents(session.id), body: await page.locator("body").innerText() }, null, 2));
  throw error;
} finally {
  await browser.close();
  server.stop(true);
  await host.close();
  await rm(scratch, { recursive: true, force: true });
}
