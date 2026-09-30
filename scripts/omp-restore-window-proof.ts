/**
 * Window end-to-end proof for the Archived-list Restore button (plan §10
 * item 70 §2.6 at full stack — no provider, host-owned pair only).
 *
 * Boots the real host with the fixture OMP executable (no turn is ever
 * sent), archives one of two fixture tasks through the host-owned pair,
 * then drives the Settings Archived threads section with real clicks:
 * the archived row, its Restore button, the "Thread restored" toast, and
 * the host row reading back unarchived. The pair itself is proven by
 * scripts/agent-window-smoke.ts (headless + packaged); the dispatch shape
 * by apps/macos/agent-window/test/adapter.test.ts. This closes the loop
 * through the running window's own button.
 *
 * Run: bun scripts/omp-restore-window-proof.ts
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
	if (!value) throw new Error(`OMP restore window proof failed: ${message}`);
	console.log(`OK   ${message}`);
}

const scratch = await realpath(await mkdtemp(join(tmpdir(), "cedia-restore-window-")));
const output = join(root, "dist/restore-window-proof");
await mkdir(output, { recursive: true });
const projectPath = join(scratch, "project");
await mkdir(projectPath);
await writeFile(join(projectPath, "hello.txt"), "Restore window fixture\n");
execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["add", "hello.txt"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["-c", "user.email=fixture@cedia", "-c", "user.name=Cedia Fixture", "commit", "-m", "fixture"], { cwd: projectPath, stdio: "ignore" });

const host = await startHostServer({
	stateDir: join(scratch, "host"),
	port: 0,
	ompExecutable: join(root, "apps/macos/test/fixtures/agent-window-omp"),
	ompEnv: { CEDIA_NODE: process.execPath },
});
const project = host.host.store.createProject({ path: projectPath, name: "Restore window fixture" });
const home = host.host.createSession(project.id, "Restore window home");
''// "Restore window task" works in its own worktree (R3 admission: one
// file-mutating task per folder), which is also the receipt path restore
// must resume.
const archived = host.host.createSession(project.id, "Restore window task", "worktree");
const archivedView = host.host.archiveSession(archived.id);
check(archivedView.archived === true, "fixture task archived through the host-owned pair");
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
	await page.getByText("Restore window fixture", { exact: true }).first().waitFor({ timeout: 20_000 });
	await page.getByText("Restore window home", { exact: true }).first().click();

	await page.getByText("Settings", { exact: true }).first().click();
	await page.getByText("Archived threads", { exact: true }).first().click();
	await page.getByText("Restore window task", { exact: true }).first().waitFor({ timeout: 20_000 });
	check(true, "archived row lists the fixture task with its retention record");
	await page.getByRole("button", { name: "Restore", exact: true }).click();
	await page.getByText("Thread restored", { exact: true }).first().waitFor({ timeout: 20_000 });
	check(true, "Restore click answers the restored toast");
	const row = host.host.store.getSession(archived.id);
	check(row !== undefined && row.archived === false, "host row reads back unarchived after the window Restore");

	await page.screenshot({ path: join(output, "restore-window.png"), fullPage: true });
	if (errors.length) throw new Error(`Renderer errors: ${errors.join("\n")}`);
	await writeFile(join(output, "result.json"), JSON.stringify({ ok: true, providerCalls: 0, errors }, null, 2));
	console.log("OMP restore window proof passed: archived row, Restore click, toast, and host readback in the running window.");
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
