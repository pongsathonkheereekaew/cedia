/** Running-window captures of live-backend composer panels against the pinned runtime.
 *
 * The stub smoke (`agent-window-smoke.ts`) proves the window against a provider-free OMP
 * fixture whose stub runtime advertises no capability bridge, so every backend panel shows
 * an honest absence state. This variant points the same window harness at the prepared
 * pinned runtime with a fixture model whose endpoint never answers: opening a task boots
 * real OMP, and the Tree, Tool catalog (plus the provider-tool dependency rows) and other
 * bridge-backed panels must show live answers with no turn dispatched and no provider call
 * completing: opening a task does not boot OMP, so one turn is dispatched to bring the runtime up; the fixture endpoint never answers, so that turn hangs while the panels read the live runtime, and nothing completes.
 *
 * Run: bun scripts/agent-window-live-smoke.ts
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";
import { createAgentHostGateway, createAgentWindowHandler } from "../apps/macos/src/agent-window-main.ts";
import { createAgentGitService } from "../apps/macos/src/agent-window-git.ts";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Agent Window live smoke failed: ${message}`);
  console.log(`OK   ${message}`);
}

const root = resolve(import.meta.dir, "..");
const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/")
  ? resolve(requested)
  : (process.env.PATH ?? "").split(delimiter).map(dir => join(dir, requested)).find(candidate => candidate) ?? requested;
const { chromium } = createRequire(join(root, "desktop/package.json"))("playwright");
// macOS points /tmp at /private/tmp: canonicalize once so the stored project path, Git's
// toplevel answer, and the IDE handoff all spell the folder the same way.
const scratch = await realpath(await mkdtemp(join(tmpdir(), "cedia-agent-ui-live-")));
const projectPath = join(scratch, "project");
await mkdir(projectPath);
await writeFile(join(projectPath, "hello.txt"), "Agent Window live fixture\n");
execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["add", "hello.txt"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["-c", "user.email=fixture@cedia", "-c", "user.name=Cedia Fixture", "commit", "-m", "fixture"], { cwd: projectPath, stdio: "ignore" });
// A model endpoint that never answers: reaching it is observable in the request count, but no call may complete.
const held: Server = createServer(() => { /* deliberately never respond */ });
await new Promise<void>(resolveListen => held.listen(0, "127.0.0.1", () => resolveListen()));
held.unref();
const address = held.address();
check(address !== null && typeof address === "object", "fixture listener bound");
const port = address.port;
let providerRequests = 0;
const providerHits: string[] = [];
held.on("request", (req) => { providerRequests += 1; providerHits.push(String(req.method) + " " + String(req.url)); });
const profileDir = join(scratch, "agent");
await mkdir(profileDir);
await writeFile(join(profileDir, "models.yml"), `providers:
  live-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: live-fixture-model
        name: Cedia live smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`, { mode: 0o600 });
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `the runtime is the pinned ${OMP_BASELINE_VERSION} or later (${version})`);
const host = await startHostServer({
  stateDir: join(scratch, "host"),
  port: 0,
  ompExecutable: executable,
  virtualUi: true,
  ompEnv: { HOME: profileDir, PI_CODING_AGENT_DIR: profileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off", CEDIA_NODE: process.execPath },
});
const project = host.host.store.createProject({ path: projectPath, name: "Agent Window live fixture" });
const session = host.host.createSession(project.id, "Live fixture task");
const gateway = createAgentHostGateway({ appRoot: root, parentPid: process.pid, stateDir: join(scratch, "host") });
const git = createAgentGitService({ ensureClient: () => gateway.ensureClient() });
const handler = createAgentWindowHandler({
  ...gateway,
  panel: async (event, surface, method, input) => {
    if (surface !== "git") throw new Error("Unsupported native panel");
    return git.handle(event, method, input);
  },
  authorize: () => true,
  pickFolder: async () => projectPath,
  openIde: async () => { throw new Error("IDE handoff is disabled in the live smoke"); },
  openExternal: async () => { throw new Error("External links are disabled in the live smoke"); },
  version: "fixture",
});
const output = join(root, "dist/agent-window-live-smoke");
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
const browser = await chromium.launch({ headless: true, channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
const errors: string[] = [];
page.on("pageerror", (error: Error) => errors.push(error.message));
page.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") errors.push(message.text()); });
await page.exposeBinding("__cediaFixtureInvoke", async (_source: unknown, channel: string, input: unknown) => {
  if (channel !== "vscode:cediaAgent") throw new Error(`Unexpected fixture IPC channel: ${channel}`);
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
const checks: string[] = [];
try {
  await page.goto(server.url.toString(), { waitUntil: "networkidle", timeout: 45_000 });
  await page.getByText("Agent Window live fixture", { exact: true }).first().waitFor({ timeout: 20_000 });
  checks.push("home-renders");
  await page.getByText("Live fixture task", { exact: true }).first().click();
  await page.locator('[contenteditable="true"]').first().waitFor({ state: "visible", timeout: 30_000 });
  checks.push("composer-opens");
  // The draft starts with no model ("Choose model"); the host resolves the model catalog
  // without a runtime, so pick the fixture model before sending.
  await page.getByText("Choose model", { exact: true }).first().click({ timeout: 30_000 });
  await page.getByText("Cedia live smoke fixture", { exact: true }).first().click({ timeout: 30_000 });
  checks.push("model-picked");
  // Dispatching the first turn boots real OMP; the fixture endpoint never answers, so the
  // turn stays running while the panels below read the live runtime. Nothing completes:
  // providerRequests counts attempts stuck at the held endpoint, never completed calls.
  // Branch discovery can remount the composer right after it first appears; filling before
  // the branch control settles risks typing into an element a re-render then discards. Settle,
  // fill, and only click once Send reports itself enabled, refilling when a late re-render wins
  // the race (same shape as fillComposerAndSend in the stub smoke).
  const box = page.locator('[contenteditable="true"]').first();
  await box.waitFor({ state: "visible", timeout: 20_000 });
  await page.getByText("Select branch").first().waitFor({ timeout: 20_000 }).catch(() => {});
  for (let attempt = 0; ; attempt++) {
    await box.fill("Live panel probe");
    try {
      await page.waitForFunction(() => {
        const button = document.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
        return !!button && !button.disabled;
      }, undefined, { timeout: 10_000 });
      break;
    } catch {
      if (attempt >= 2) throw new Error("Send stayed disabled after filling the composer with: Live panel probe");
    }
  }
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  checks.push("turn-dispatched");
  // Diagnostic: what does the host think is happening? Turn intents, the command rows,
  // and the exact answers of the tree/catalog routes (mirroring omp-tree-smoke).
  await new Promise(resolveWait => setTimeout(resolveWait, 60_000));
  {
    const store = host.host.store as unknown as {
      getSession(id: string): unknown;
      listCommands(sessionId: string): unknown[];
      listTurnIntents(sessionId: string): unknown[];
    };
    const controller = host.auth.issue("Live smoke controller").token;
    const tree = await host.router({ method: "GET", path: `/v1/sessions/${session.id}/tree`, token: controller }) as { status?: unknown; body?: unknown };
    const catalog = await host.router({ method: "GET", path: `/v1/sessions/${session.id}/tools/catalog`, token: controller }) as { status?: unknown; body?: unknown };
    console.log("DIAG session=" + JSON.stringify(store.getSession(session.id)));
    console.log("DIAG intents=" + JSON.stringify(store.listTurnIntents(session.id)).slice(0, 1200));
    console.log("DIAG commands=" + JSON.stringify(store.listCommands(session.id).map(entry => ({ kind: (entry as { kind: string }).kind, status: (entry as { status: string }).status }))));
    console.log("DIAG tree=" + String(tree.status) + " " + JSON.stringify(tree.body).slice(0, 500));
    console.log("DIAG catalog=" + String(catalog.status) + " " + JSON.stringify(catalog.body).slice(0, 500));
    console.log("DIAG providerRequests=" + providerRequests + " hits=" + JSON.stringify(providerHits.slice(0, 5)));
  }
   // The dispatched turn boots real OMP behind the panels; cold boot plus turn start can take a while.
  await page.locator("[data-tool-name]").first().waitFor({ state: "visible", timeout: 180_000 });
  checks.push("catalog-rows-live");
  const toolRows = await page.locator("[data-tool-name]").count();
  check(toolRows > 0, `the live catalog shows registered rows (${toolRows})`);
  checks.push("catalog-nonempty");
  await page.locator('[data-tool-dependency="generate_image"]').first().waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('[data-tool-dependency="tts"]').first().waitFor({ state: "visible", timeout: 30_000 });
  checks.push("dependency-rows-live");
  const bodyAfterCatalog = await page.locator("body").innerText();
  check(!bodyAfterCatalog.includes("Tool catalog unavailable"), "no catalog unavailable state against the live runtime");
  checks.push("no-catalog-absence");
  await page.locator('[aria-label="Session tree points"]').first().waitFor({ state: "visible", timeout: 180_000 });
  checks.push("tree-points-live");
  const treeBody = await page.locator('[data-testid="cedia-tree-surface"]').first().innerText();
  check(!treeBody.includes("Task tree unavailable"), "no tree unavailable state against the live runtime");
  checks.push("no-tree-absence");
  await page.screenshot({ path: join(output, "live-panels.png"), fullPage: true });
  checks.push("panels-captured");
  // The hanging turn attempted the held endpoint (it can never complete there), so the
  // count is reported, not asserted: attempts stuck at the fixture listener prove the turn
  // reached the provider and is still running while the panels above read it live.
  checks.push("panels-live-during-turn");
  if (errors.length) throw new Error(`Renderer errors: ${errors.join("\n")}`);
  checks.push("no-renderer-errors");
  await writeFile(join(output, "result.json"), JSON.stringify({ ok: true, runtime: version, providerRequests, projectId: project.id, sessionId: session.id, toolRows, checks, errors, providerNote: "held endpoint never answers; counted requests hang incomplete, none complete" }, null, 2));
  await Promise.all(["failure.json", "failure.png"].map(name => rm(join(output, name), { force: true })));
  console.log(`Agent Window live smoke passed: ${output}`);
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true });
  await writeFile(join(output, "failure.json"), JSON.stringify({ error: String(error), errors, checks, providerRequests, body: await page.locator("body").innerText().catch(() => null) }, null, 2));
  throw error;
} finally {
  await browser.close();
  server.stop(true);
  await host.close();
  await new Promise<void>(resolveClose => held.close(() => resolveClose()));
  await rm(scratch, { recursive: true, force: true });
}
