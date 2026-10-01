/**
 * Packaged on-screen approval loop, agent-driven through computer-use.
 *
 * Staged scratch Cedia.app (Login Item shimmed, re-signed) against an in-process
 * source host + pinned OMP with the user's own auth (scratch copy) and an
 * always-ask overlay. One bounded write turn from the on-screen Agents composer,
 * typed by computer-use; the broker `select` approval is clicked by computer-use;
 * the turn must complete with a byte-exact file.
 *
 * Bound: at most ONE write turn on opencode-go/muse-spark-1.3-contributor
 * (user-approved unlimited row). Scratch project only.
 *
 * CUA driving rules (learned 2026-09-30): computer-use `getApp` on the staged
 * path can launch a SECOND bare instance without harness args/env, which falls
 * back to the real profile and real host. Therefore this proof carries three
 * guards: (1) abort when any Cedia process pre-exists the launch
 * (single-instance forwarding would join it); (2) abort unless every staged
 * process reports the scratch `--user-data-dir`; (3) SIGKILL exact-path staged
 * leftovers in `finally` and assert zero survivors. A CUA driver must additionally
 * verify the bound window URL carries this run's fixture session hash before
 * every action, and must never type/click into any other window.
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { access, appendFile, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";

const FAIL_PREFIX = "OMP live streaming toolcard proof failed";
function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${FAIL_PREFIX}: ${message}`);
	console.log(`OK   ${message}`);
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const psLines = (): string[] => {
	try { return execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" }).split("\n"); }
	catch { return []; }
};
const stagedPids = (appPath: string): number[] => psLines().flatMap(line => {
	const m = line.trim().match(/^(\d+)\s+(.*)$/);
	if (!m) return [];
	return m[2]!.includes(appPath) ? [Number(m[1])] : [];
});
const userDataDirs = (appPath: string): string[] => psLines().flatMap(line => {
	if (!line.includes(appPath)) return [];
	const m = line.match(/--user-data-dir=(\S+)/);
	return m ? [m[1]!] : [];
});
const waitForPath = async (path: string, timeoutMs = 120_000) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try { await access(path); return; } catch {}
		await sleep(200);
	}
	throw new Error(`${FAIL_PREFIX}: timed out waiting for ${path}`);
};

const root = resolve(import.meta.dir, "..");
const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright") as {
	_electron: { launch(opts: Record<string, unknown>): Promise<unknown> };
};

const appPath = process.env.CEDIA_LIVE_APPROVAL_APP_PATH;
check(typeof appPath === "string" && appPath.endsWith("/Cedia.app"),
	"CEDIA_LIVE_APPROVAL_APP_PATH names an explicitly staged scratch Cedia.app");
const resolvedAppPath = resolve(appPath);
const installedAppPath = resolve(join(root, `VSCode-darwin-${process.arch}/Cedia.app`));
check(resolvedAppPath !== installedAppPath && !resolvedAppPath.startsWith(`${installedAppPath}/`),
	"the repository's installed Cedia.app is never launched by this proof");
await access(join(resolvedAppPath, "Contents/MacOS/Cedia"));
const shimPath = join(resolvedAppPath, "Contents/Resources/app/out/vs/cedia/agent/main.cjs");
const sourceMain = await readFile(join(root, "dist/agent-window/main.cjs"), "utf8");
const setterNeedle = "setLoginItemSettings: (settings) => electronApp.setLoginItemSettings(settings),";
const getterNeedle = "wasOpenedAtLogin = electronApp.getLoginItemSettings().wasOpenedAtLogin === true;";
let stagedMain = await readFile(shimPath, "utf8");
check(createHash("sha256").update(stagedMain).digest("hex") === createHash("sha256").update(sourceMain).digest("hex"),
	"the staged app carries the current source Agent Window main process");
check(stagedMain.split(setterNeedle).length === 2 && stagedMain.split(getterNeedle).length === 2,
	"staged Login Item interception points match the reviewed module");
stagedMain = stagedMain
	.replace(setterNeedle, `setLoginItemSettings: (settings) => { require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "intercept-set-login-item", settings }) + "\\n"); },`)
	.replace(getterNeedle, `wasOpenedAtLogin = false; require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "simulated-login-state", isPackaged: electronApp.isPackaged, openedAtLogin: false }) + "\\n");`);
await writeFile(shimPath, stagedMain);
execFileSync("codesign", ["--force", "--deep", "--sign", "-", resolvedAppPath], { stdio: "ignore" });
check(true, "the Login Item interception is staged only in the temp app copy");

const scratch = await mkdtemp(join(tmpdir(), "cedia-live-approval-pkg-"));
const projectPath = join(scratch, "project");
const profile = join(scratch, "profile");
const stateDir = join(scratch, "host");
const ompProfile = join(scratch, "omp-profile");
await mkdir(projectPath, { recursive: true });
await mkdir(join(profile, "User"), { recursive: true });
await mkdir(ompProfile, { recursive: true });
await writeFile(join(projectPath, "note.txt"), "Live approval probe workspace\n");
const realAgent = join(homedir(), ".omp", "agent");
for (const f of ["models.yml", "models.db", "models.db-shm", "models.db-wal", "config.yml"]) {
	try { await cp(join(realAgent, f), join(ompProfile, f)); } catch { /* absent */ }
}
const overlay = "/tmp/cedia-always-ask.yml";
await access(overlay);
const ideSettings = {
	"cedia.hostStateDir": stateDir,
	"security.workspace.trust.enabled": false,
	"window.startupEditor": "none",
	"workbench.startupEditor": "none",
	"update.mode": "none",
	"telemetry.telemetryLevel": "off",
	"extensions.autoCheckUpdates": false,
};
await writeFile(join(profile, "User", "settings.json"), `${JSON.stringify(ideSettings, null, 2)}\n`);

const PROMPT = `Read the file note.txt in the work directory with a read-only tool, then describe its content in three sentences and end your reply with the word done. Call no other tools.`;

const host = await startHostServer({
	stateDir,
	ompExecutable: resolve(root, "dist/omp/omp"),
	virtualUi: true,
	ompEnv: {
		HOME: ompProfile, PI_CODING_AGENT_DIR: ompProfile, PI_CONFIG_FILES: overlay,
		PI_NO_PTY: "1", PI_NOTIFICATIONS: "off",
	},
	ompRequestTimeoutMs: 300_000,
});
const project = host.host.store.createProject({ path: projectPath, name: "Live approval fixture" });
const session = host.host.createSession(project.id, "Live approval task");
check(session.id.length > 0, "fixture session registered on the live host");
await host.host.startSession(session.id);
const incarnation = host.host.store.getSession(session.id)!.incarnation;
const owner = host.auth.ownerToken;
const setModel = await host.host.command(session.id, "owner", {
	commandId: `live-approval-model-${randomUUID()}`, incarnation,
	command: "set_model", payload: { provider: "opencode-go", modelId: "muse-spark-1.3-contributor" },
});
check(["completed", "acknowledged"].includes(setModel.status), "the live Muse model is accepted by OMP");

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = join(root, "dist/live-streaming-toolcard-proof", runId);
await mkdir(output, { recursive: true });
const shimLog = join(output, "login-item-shim.jsonl");
const typeReady = join(output, "computer-use-type-ready.json");
const typeRelease = join(output, "computer-use-type-release");
const expandReady = join(output, "computer-use-expand-ready.json");
const expandRelease = join(output, "computer-use-expand-release");

type Page = {
	getByRole(r: string, o?: Record<string, unknown>): { first(): { click(o?: unknown): Promise<void>; waitFor(o?: unknown): Promise<void> } };
	getByText(t: string | RegExp, o?: Record<string, unknown>): { first(): { click(): Promise<void>; waitFor(o?: unknown): Promise<void> } };
	locator(s: string): { first(): { waitFor(o?: unknown): Promise<void> } };
	screenshot(o: Record<string, unknown>): Promise<void>;
	url(): Promise<string>;
};
let browser: any;
try {
	check(psLines().every(line => !line.includes("Cedia.app/Contents/MacOS/Cedia")),
		"no pre-existing Cedia process before the staged launch (single-instance forwarding guard)");
	browser = await _electron.launch({
		executablePath: join(resolvedAppPath, "Contents/MacOS/Cedia"),
		args: ["--user-data-dir", profile, "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
		env: {
			...process.env,
			CEDIA_STATE_DIR: stateDir,
			CEDIA_HOST_NODE: process.env.CEDIA_HOST_NODE ?? "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node",
			CEDIA_HOST_REQUEST_TIMEOUT_MS: "300000",
			CEDIA_LIFECYCLE_SHIM_LOG: shimLog,
			CEDIA_SIMULATE_LOGIN: "0",
		},
		timeout: 45_000,
	});
	(browser as any).process()?.on("exit", (code: number | null, signal: NodeJS.Signals | null) =>
		console.log(`PACKAGED-APPROVAL: staged Electron exited (code=${code}, signal=${signal})`));
	const agents = (await browser.firstWindow()) as unknown as Page;
	console.log(`PACKAGED-APPROVAL: Agents page ${await (agents as any).url()}`);
	{
		const dirs = userDataDirs(resolvedAppPath);
		check(dirs.length > 0, "staged processes report a user-data-dir");
		check(dirs.every(d => d === profile || d.startsWith(`${profile}/`)),
			`every staged process uses the scratch profile (got ${JSON.stringify(dirs).slice(0, 200)})`);
	}
	await waitForPath(shimLog, 15_000);
	check(true, "staged app booted with the shimmed Login Item module");
	await agents.getByRole("button", { name: "Skip setup", exact: true }).first().click({ timeout: 15_000 }).catch(() => {});
	await agents.getByText("Live approval fixture", { exact: true }).first().waitFor({ timeout: 60_000 });
	await agents.getByText("Live approval task", { exact: true }).first().click();
	await agents.locator('[contenteditable="true"]').first().waitFor({ timeout: 30_000 });
	await agents.screenshot({ path: join(output, "agents-composer.png") });
	check(true, "the fixture task composer is visible in the packaged Agents window");

	if (true) {
		const ideOpened = (browser as any).waitForEvent("window", { timeout: 30_000 });
		const openIdeButtons = (agents as any).getByRole("button", { name: "Open in IDE", exact: true });
		await openIdeButtons.first().waitFor({ timeout: 20_000 });
		let launched = false;
		for (let i = 0; i < (await openIdeButtons.count()); i++) {
			if (await openIdeButtons.nth(i).isEnabled()) { await openIdeButtons.nth(i).click(); launched = true; break; }
		}
		check(launched, "Open in IDE launched from the Agents window");
		const ide = await ideOpened;
		await ide.waitForURL(/workbench/, { timeout: 30_000 });
		await (ide as any).bringToFront();
		await new Promise(r => setTimeout(r, 5000));
		const commandInput = ide.locator(".quick-input-widget input").first();
		let paletteVisible = false;
		for (let attempt = 0; attempt < 3 && !paletteVisible; attempt++) {
			await ide.keyboard.press("Meta+Shift+P");
			try { await commandInput.waitFor({ state: "visible", timeout: 8_000 }); paletteVisible = true; }
			catch { await new Promise(r => setTimeout(r, 2000)); }
		}
		check(paletteVisible, "the IDE command palette opens for Focus Composer");
		await ide.waitForTimeout(1000);
		const paletteText = await ide.locator(".quick-input-widget").innerText().catch(() => "");
		check(!/No matching results/i.test(paletteText), "Cedia Focus Composer command is available");
		await ide.screenshot({ path: join(output, "ide-palette.png") });
		await commandInput.fill(">Focus Composer");
		await ide.waitForTimeout(500);
		await commandInput.press("Enter");
		await ide.locator(".quick-input-widget").waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
		// The dock composer lives inside a vscode-webview frame that the top-level
		// page DOM cannot pierce; scan webview frames like the Send-race proof does.
		const ideDeadline = Date.now() + 90_000;
		let ideEditorFound = false;
		while (Date.now() < ideDeadline && !ideEditorFound) {
			const frames = (ide as any).frames().filter((frame: any) =>
				typeof frame.url === "function" && frame.url().startsWith("vscode-webview://"));
			for (const frame of frames) {
				try {
					if (await frame.locator('[data-testid="composer-editor"][contenteditable="true"]').count() > 0
						&& await frame.locator('button[aria-label="Send message"]').count() > 0) {
						ideEditorFound = true;
						break;
					}
				} catch { /* frame navigated mid-probe */ }
			}
			if (!ideEditorFound) await new Promise(r => setTimeout(r, 1000));
		}
		await ide.screenshot({ path: join(output, "ide-dock-state.png") });
		check(ideEditorFound, "the IDE dock webview mounts the Cedia composer with Send");
		await ide.screenshot({ path: join(output, "ide-composer.png") });
		check(true, "the IDE dock composer is mounted and visible (computer-use types here)");
	}

	await writeFile(typeReady, JSON.stringify({ stagedAppPath: resolvedAppPath, output, runId, sessionId: session.id, prompt: PROMPT }) + "\n");
	console.log(`CUA_TYPE_READY: ${typeReady}`);
	await waitForPath(typeRelease, 180_000);

	const ideWindows = () => (browser.windows() as unknown as { url(): string; screenshot(o: unknown): Promise<void> }[])
		.filter(w => { try { return w.url().includes("workbench"); } catch { return false; } });
	const streamDeadline = Date.now() + 180_000;
	let streamShots = 0;
	let sawUpdate = false;
	let sawToolStart = false;
	let sawToolEnd = false;
	for (;;) {
		const ev = await host.router({ method: "GET", path: `/v1/sessions/${session.id}/events?after=0&limit=200`, token: owner });
		let after = 0;
		for (let guard = 0; guard < 30; guard++) {
			const page = await host.router({ method: "GET", path: `/v1/sessions/${session.id}/events?after=${after}&limit=200`, token: owner });
			const b = page.body as any;
			for (const e of (b?.events ?? []) as any[]) {
				const f = e.frame ?? {};
				if (f.type === "message_update") sawUpdate = true;
				if (f.type === "tool_execution_start") sawToolStart = true;
				if (f.type === "tool_execution_end") sawToolEnd = true;
			}
			if (!b?.hasMore) break;
			after = typeof b?.cursor === "number" ? b.cursor : after + 200;
		}
		if (sawUpdate && streamShots === 0) {
			for (const w of ideWindows()) await w.screenshot({ path: join(output, "streaming-mid-turn.png") }).catch(() => {});
			streamShots = 1;
			console.log("OK   mid-stream screenshot captured while message_update frames arrive");
		}
		const view = await host.router({ method: "GET", path: `/v1/sessions/${session.id}`, token: owner });
		const turns = ((view.body as any)?.turns ?? []) as any[];
		if (turns.length === 1 && turns[0]?.state === "completed") break;
		if (Date.now() > streamDeadline) throw new Error(`${FAIL_PREFIX}: live turn did not complete in 3 min`);
		await sleep(2000);
	}
	check(sawUpdate, "message_update frames arrived before turn end (in-place streaming)");
	check(sawToolStart && sawToolEnd, "a tool execution started and ended inside the live turn");
	check(streamShots === 1, "a mid-stream screenshot was captured");
	await agents.screenshot({ path: join(output, "turn-completed.png") });
	await writeFile(expandReady, JSON.stringify({ stagedAppPath: resolvedAppPath, output, runId, sessionId: session.id }) + "\n");
	console.log(`CUA_EXPAND_READY: ${expandReady}`);
	await waitForPath(expandRelease, 180_000);
	for (const w of ideWindows()) await w.screenshot({ path: join(output, "toolcard-expanded.png") }).catch(() => {});
	const view2 = await host.router({ method: "GET", path: `/v1/sessions/${session.id}`, token: owner });
	const turns2 = ((view2.body as any)?.turns ?? []) as any[];
	check(turns2.length === 1 && turns2[0]?.state === "completed", "exactly one turn ran and completed");
	const result = { ok: true, proof: "packaged-live-streaming-toolcard", runId, sessionId: session.id, sawUpdate, sawToolStart, sawToolEnd, turns: turns2.length, providerCalls: "live-trivial-read" };
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
	console.log(`Packaged streaming result: ${JSON.stringify(result)}`);
} finally {
	try { await host.host.command(session.id, "owner", { commandId: `live-approval-stop-${randomUUID()}`, incarnation, command: "stop", payload: {} }); } catch {}
	await browser?.close?.().catch(() => {});
	const sweepDeadline = Date.now() + 15_000;
	while (Date.now() < sweepDeadline && stagedPids(resolvedAppPath).length > 0) await sleep(500);
	for (const pid of stagedPids(resolvedAppPath)) {
		try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
	}
	await sleep(2000);
	check(stagedPids(resolvedAppPath).length === 0, "no staged app processes survive the proof");
	await host.close().catch(() => {});
}
