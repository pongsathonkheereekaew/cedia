/**
 * Packaged Continue-button proof (D archive/restore UI path, one tiny paid
 * turn on the user-approved Muse row, scratch git project).
 *
 * Staged scratch Cedia.app + in-process source host + pinned OMP with the
 * user's own auth (scratch copy) and an always-ask overlay. The script runs
 * a tiny Muse turn and archives the task through the host route; the
 * operator clicks the Archived-list Continue button through computer-use
 * (the unproven UI path); the script verifies the task is unarchived with
 * its transcript intact, screenshots, and cleans up.
 *
 * Gates (dist/packaged-continue-proof/<runId>/): continue-ready.json →
 * write continue-release after clicking Continue.
 *
 * Run: CEDIA_PACKAGED_CONTINUE_APP_PATH=/tmp/<staged>/Cedia.app bun scripts/omp-packaged-continue-proof.ts
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";

const FAIL = "OMP packaged continue proof failed";
const check = (v: unknown, m: string) => { if (!v) throw new Error(`${FAIL}: ${m}`); console.log(`OK   ${m}`); };
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
const waitForPath = async (path: string, timeoutMs: number) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try { await access(path); return; } catch {}
		await sleep(200);
	}
	throw new Error(`${FAIL}: timed out waiting for ${path}`);
};

const root = resolve(import.meta.dir, "..");
const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright") as {
	_electron: { launch(opts: Record<string, unknown>): Promise<unknown> };
};
const appPath = process.env.CEDIA_PACKAGED_CONTINUE_APP_PATH;
check(typeof appPath === "string" && appPath.endsWith("/Cedia.app"), "CEDIA_PACKAGED_CONTINUE_APP_PATH names a staged scratch Cedia.app");
const resolvedAppPath = resolve(appPath);
check(resolvedAppPath !== resolve(join(root, `VSCode-darwin-${process.arch}/Cedia.app`)), "the installed Cedia.app is never launched");
await access(join(resolvedAppPath, "Contents/MacOS/Cedia"));
const shimPath = join(resolvedAppPath, "Contents/Resources/app/out/vs/cedia/agent/main.cjs");
const sourceMain = await readFile(join(root, "dist/agent-window/main.cjs"), "utf8");
const setterNeedle = "setLoginItemSettings: (settings) => electronApp.setLoginItemSettings(settings),";
const getterNeedle = "wasOpenedAtLogin = electronApp.getLoginItemSettings().wasOpenedAtLogin === true;";
let stagedMain = await readFile(shimPath, "utf8");
check(createHash("sha256").update(stagedMain).digest("hex") === createHash("sha256").update(sourceMain).digest("hex"), "staged app carries current source main");
check(stagedMain.split(setterNeedle).length === 2 && stagedMain.split(getterNeedle).length === 2, "Login Item interception points match");
stagedMain = stagedMain
	.replace(setterNeedle, `setLoginItemSettings: (settings) => { require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "intercept-set-login-item", settings }) + "\\n"); },`)
	.replace(getterNeedle, `wasOpenedAtLogin = false; require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "simulated-login-state", isPackaged: electronApp.isPackaged, openedAtLogin: false }) + "\\n");`);
await writeFile(shimPath, stagedMain);
execFileSync("codesign", ["--force", "--deep", "--sign", "-", resolvedAppPath], { stdio: "ignore" });

const scratch = await mkdtemp(join(tmpdir(), "cedia-continue-pkg-"));
const projectPath = join(scratch, "project");
const profile = join(scratch, "profile");
const stateDir = join(scratch, "host");
const ompProfile = join(scratch, "omp-profile");
await mkdir(projectPath, { recursive: true });
await mkdir(join(profile, "User"), { recursive: true });
await mkdir(ompProfile, { recursive: true });
execFileSync("git", ["init", "-q", projectPath]);
execFileSync("git", ["-C", projectPath, "config", "user.email", "probe@local"]);
execFileSync("git", ["-C", projectPath, "config", "user.name", "probe"]);
await writeFile(join(projectPath, "note.txt"), "Continue probe workspace\n");
execFileSync("git", ["-C", projectPath, "add", "."]);
execFileSync("git", ["-C", projectPath, "commit", "-qm", "probe baseline"]);
const realAgent = join(homedir(), ".omp", "agent");
for (const f of ["models.yml", "models.db", "models.db-shm", "models.db-wal", "config.yml"]) {
	try { await cp(join(realAgent, f), join(ompProfile, f)); } catch {}
}
await access("/tmp/cedia-always-ask.yml");
await writeFile(join(profile, "User", "settings.json"), `${JSON.stringify({
	"cedia.hostStateDir": stateDir, "security.workspace.trust.enabled": false,
	"window.startupEditor": "none", "workbench.startupEditor": "none",
	"update.mode": "none", "telemetry.telemetryLevel": "off", "extensions.autoCheckUpdates": false,
}, null, 2)}\n`);

const host = await startHostServer({ stateDir, ompExecutable: resolve(root, "dist/omp/omp"), virtualUi: true,
	ompEnv: { HOME: ompProfile, PI_CODING_AGENT_DIR: ompProfile, PI_CONFIG_FILES: "/tmp/cedia-always-ask.yml", PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
	ompRequestTimeoutMs: 300_000 });
const project = host.host.store.createProject({ path: projectPath, name: "Continue fixture" });
const session = host.host.createSession(project.id, "Continue task");
check(session.id.length > 0, "fixture session registered");
await host.host.startSession(session.id);
const incarnation = host.host.store.getSession(session.id)!.incarnation;
const owner = host.auth.ownerToken;
const send = (command: string, payload: Record<string, unknown>) =>
	host.host.command(session.id, "owner", { commandId: `continue-${randomUUID()}`, incarnation, command, payload });
const setModel = await send("set_model", { provider: "opencode-go", modelId: "muse-spark-1.3-contributor" });
check(["completed", "acknowledged"].includes(setModel.status), "live Muse model accepted");
await send("prompt", { message: "Reply with exactly: archived-ok. Call no tools." });
const turn = await (async () => {
	const deadline = Date.now() + 240_000;
	for (;;) {
		const view = await host.router({ method: "GET", path: `/v1/sessions/${session.id}`, token: owner } as any) as any;
		const turns = ((view.body as any)?.turns ?? []) as any[];
		if (turns.length === 1 && (turns[0]?.state === "completed" || turns[0]?.state === "failed"))
			return { status: turns[0].state };
		if (Date.now() > deadline) throw new Error(`${FAIL}: tiny turn never settled`);
		await sleep(2000);
	}
})();
check(turn.status === "completed", "tiny turn completed before archiving");

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = join(root, "dist/packaged-continue-proof", runId);
await mkdir(output, { recursive: true });
const shimLog = join(output, "login-item-shim.jsonl");
const contReady = join(output, "continue-ready.json");
const contRelease = join(output, "continue-release");

let browser: any;
try {
	check(psLines().every(line => !line.includes("Cedia.app/Contents/MacOS/Cedia")), "no pre-existing Cedia process");
	browser = await _electron.launch({ executablePath: join(resolvedAppPath, "Contents/MacOS/Cedia"),
		args: ["--user-data-dir", profile, "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
		env: { ...process.env, CEDIA_STATE_DIR: stateDir,
			CEDIA_HOST_NODE: process.env.CEDIA_HOST_NODE ?? "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node",
			CEDIA_HOST_REQUEST_TIMEOUT_MS: "300000", CEDIA_LIFECYCLE_SHIM_LOG: shimLog, CEDIA_SIMULATE_LOGIN: "0" },
		timeout: 45_000 });
	const agents = (await browser.firstWindow()) as unknown as { url(): string };
	console.log(`CONTINUE: Agents page ${await (agents as any).url()}`);
	await waitForPath(shimLog, 15_000);
	check(true, "staged app booted");
	const arch = await host.router({ method: "PATCH", path: `/v1/sessions/${session.id}`, token: owner, body: { archived: true } } as any);
	check((arch as any).status === 200, "task archived through the host route");
	await writeFile(contReady, JSON.stringify({ stagedAppPath: resolvedAppPath, output, runId, sessionId: session.id }) + "\n");
	console.log(`CUA_CONTINUE_READY: ${contReady}`);
	await waitForPath(contRelease, 900_000);
	const view = object(await host.router({ method: "GET", path: `/v1/sessions/${session.id}`, token: owner } as any).then((r: any) => r.body), "task view") as any;
	check(view.archived !== true, "the Continue click unarchived the task");
	let foundOk = false;
	let after = 0;
	for (let g = 0; g < 30; g++) {
		const page = await host.router({ method: "GET", path: `/v1/sessions/${session.id}/events?after=${after}&limit=200`, token: owner });
		const b = (page as any).body as any;
		if (JSON.stringify(b?.events ?? []).includes("archived-ok")) { foundOk = true; break; }
		if (!b?.hasMore) break;
		after = typeof b?.cursor === "number" ? b.cursor : after + 200;
	}
	check(foundOk, "the restored transcript still carries the pre-archive turn");
	const wins = browser.windows() as unknown as { screenshot(o: unknown): Promise<void> }[];
	for (const w of wins) { try { await w.screenshot({ path: join(output, "continue-resumed.png") }); break; } catch {} }
	const result = { ok: true, runId, sessionId: session.id, providerCalls: "one-tiny-turn" };
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
	console.log(`Continue result: ${JSON.stringify(result)}`);
} finally {
	try { await host.host.command(session.id, "owner", { commandId: `continue-stop-${randomUUID()}`, incarnation, command: "stop", payload: {} }); } catch {}
	await browser?.close?.().catch(() => {});
	const sweepDeadline = Date.now() + 15_000;
	while (Date.now() < sweepDeadline && stagedPids(resolvedAppPath).length > 0) await sleep(500);
	for (const pid of stagedPids(resolvedAppPath)) { try { process.kill(pid, "SIGKILL"); } catch {} }
	await sleep(2000);
	check(stagedPids(resolvedAppPath).length === 0, "no staged app processes survive");
	await host.close().catch(() => {});
}
function object(v: unknown, _m: string): any {
	if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${FAIL}: bad shape`);
	return v;
}
