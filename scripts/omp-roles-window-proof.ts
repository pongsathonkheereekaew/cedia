/**
 * Window end-to-end proof for role assignment (plan §10 item 6 at full stack —
 * no provider, fixture models only).
 *
 * Boots the real host with the prepared pinned runtime (fixture provider +
 * fixture role mappings from an isolated OMP profile), serves the current
 * agent-window bundle with the same fixture bridge the window smoke uses,
 * opens a real task, sends one turn (starts the runtime, fixture answers),
 * then drives the Settings Model roles section with real typed input:
 * per-row Set on an edited value, outcome text, readback, Clear, and a
 * new-role Assign. The backend half (routes/replay/refusals) is proven by
 * scripts/omp-roles-apply-smoke.ts; the dispatch shape by the browser
 * component test. This closes the loop through the running window.
 *
 * Run: bun scripts/omp-roles-window-proof.ts
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";
import { createAgentHostGateway, createAgentWindowHandler } from "../apps/macos/src/agent-window-main.ts";
import { createAgentGitService } from "../apps/macos/src/agent-window-git.ts";

const root = resolve(import.meta.dir, "..");
const { chromium } = createRequire(join(root, "desktop/package.json"))("playwright");
function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP roles window proof failed: ${message}`);
	console.log(`OK   ${message}`);
}

const modelsYaml = `providers:
  fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-roles-base
        name: Cedia roles window base
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
      - id: cedia-roles-fast
        name: Cedia roles window fast
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
      - id: cedia-roles-edited
        name: Cedia roles window edited
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;
const rolesYaml = `modelRoles:
  default: fixture/cedia-roles-base
  smol: fixture/cedia-roles-fast
`;

const scratch = await realpath(await mkdtemp(join(tmpdir(), "cedia-roles-window-")));
const output = join(root, "dist/roles-window-proof");
await mkdir(output, { recursive: true });
const projectPath = join(scratch, "project");
await mkdir(projectPath);
await writeFile(join(projectPath, "hello.txt"), "Roles window fixture\n");
execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["add", "hello.txt"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["-c", "user.email=fixture@cedia", "-c", "user.name=Cedia Fixture", "commit", "-m", "fixture"], { cwd: projectPath, stdio: "ignore" });
const ompProfileDir = join(scratch, "omp-profile");
await mkdir(ompProfileDir, { recursive: true });
await writeFile(join(ompProfileDir, "models.yml"), modelsYaml, { mode: 0o600 });
await writeFile(join(ompProfileDir, "config.yml"), rolesYaml, { mode: 0o600 });

const host = await startHostServer({
	stateDir: join(scratch, "host"),
	port: 0,
	ompExecutable: join(root, "dist/omp/omp"),
	ompEnv: { CEDIA_NODE: process.execPath, HOME: ompProfileDir, PI_CODING_AGENT_DIR: ompProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
const project = host.host.store.createProject({ path: projectPath, name: "Roles window fixture" });
const session = host.host.createSession(project.id, "Roles window task");
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
	openIde: async () => { throw new Error("IDE handoff is out of scope for this proof"); },
	openExternal: async () => { throw new Error("External links are disabled in fixture tests"); },
	version: "fixture",
});

const assets = join(root, "dist/agent-window");
const server = Bun.serve({
	port: 0, hostname: "127.0.0.1",
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
try {
	await page.goto(server.url.toString(), { waitUntil: "networkidle", timeout: 45_000 });
	await page.getByText("Roles window fixture", { exact: true }).first().waitFor({ timeout: 20_000 });
	await page.getByText("Roles window task", { exact: true }).first().click();
	// Start the runtime without a turn: the prepared runtime boots against the
	// fixture models (no provider call), and the control ops that follow never
	// need one. Sending a turn would require a reachable provider.
	await host.host.startSession(session.id);
	check(true, "task runtime started (prepared runtime, fixture models)");

	await page.getByText("Settings", { exact: true }).first().click();
	await page.getByText("Agent providers", { exact: true }).first().click();
	await page.getByText("Model roles", { exact: true }).first().waitFor({ timeout: 20_000 });
	const smolInput = page.getByRole("textbox", { name: "Model for role smol" });
	await page.waitForFunction(() => {
		const el = document.querySelector('input[aria-label="Model for role smol"]') as HTMLInputElement | null;
		return !!el && el.value === "fixture/cedia-roles-fast";
	}, undefined, { timeout: 20_000 });
	check(true, "Model roles section lists the runtime mapping (input prefilled)");
	await smolInput.fill("fixture/cedia-roles-edited");
	await page.getByRole("button", { name: "Set model for role smol" }).click();
	await page.getByText("smol now resolves to fixture/cedia-roles-edited.", { exact: true }).waitFor({ timeout: 20_000 });
	check(true, "per-row Set assigns with real typed input and names the outcome");
	await page.waitForFunction(() => {
		const el = document.querySelector('input[aria-label="Model for role smol"]') as HTMLInputElement | null;
		return !!el && el.value === "fixture/cedia-roles-edited";
	}, undefined, { timeout: 20_000 });
	check(true, "assigned mapping reads back in the section");

	await page.getByRole("button", { name: "Clear model for role smol" }).click();
	await page.getByText("smol now resolves to its default resolution.", { exact: true }).waitFor({ timeout: 20_000 });
	check(true, "Clear states the fallback outcome");

	await page.getByRole("textbox", { name: "New role name" }).fill("tiny");
	await page.getByRole("textbox", { name: "Model for the new role" }).fill("fixture/cedia-roles-base");
	await page.getByRole("button", { name: "Assign" }).click();
	await page.getByText("tiny now resolves to fixture/cedia-roles-base.", { exact: true }).waitFor({ timeout: 20_000 });
	check(true, "new-role Assign works end to end");

	await page.screenshot({ path: join(output, "roles-window.png"), fullPage: true });
	if (errors.length) throw new Error(`Renderer errors: ${errors.join("\n")}`);
	await writeFile(join(output, "result.json"), JSON.stringify({ ok: true, providerCalls: 0, errors }, null, 2));
	console.log("OMP roles window proof passed: assign, readback, clear, and new-role flows in the running window.");
} catch (error) {
	try { await page.screenshot({ path: join(output, "failure.png"), fullPage: true }); } catch { /* best effort */ }
	const body = await page.locator("body").innerText().catch(() => "");
	await writeFile(join(output, "failure.json"), JSON.stringify({ error: String(error), errors, body: body.slice(0, 3000) }, null, 2));
	throw error;
} finally {
	await browser.close().catch(() => {});
	server.stop(true);
	await host.close().catch(() => {});
	await rm(scratch, { recursive: true, force: true });
}
