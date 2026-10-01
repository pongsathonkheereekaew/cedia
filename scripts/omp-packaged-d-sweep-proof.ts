/**
 * Packaged D remainder sweep (staged-only; one tiny paid Muse turn on the
 * user-approved row, scratch project).
 *
 * One staged scratch Cedia.app covers the remaining CUA-only D items in a
 * single run: (1) welcome tour capture, (2) armed/disabled-state panel rows
 * (loop/cleanse/btw/omfg/prewalk surfaces as rendered), (3) one tiny
 * mixed-script (Thai+English) live turn with rendered-transcript capture.
 * The operator drives every screen through computer-use and records visible
 * rows; the runner screenshots every gate and asserts the mixed turn.
 *
 * Gates (dist/packaged-d-sweep-proof/<runId>/): tour, panels, mixed
 * (each <phase>-ready.json → write <phase>-release to continue).
 *
 * Run: CEDIA_PACKAGED_SWEEP_APP_PATH=/tmp/<staged>/Cedia.app bun scripts/omp-packaged-d-sweep-proof.ts
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";

const FAIL = "OMP packaged D sweep proof failed";
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
const appPath = process.env.CEDIA_PACKAGED_SWEEP_APP_PATH;
check(typeof appPath === "string" && appPath.endsWith("/Cedia.app"), "CEDIA_PACKAGED_SWEEP_APP_PATH names a staged scratch Cedia.app");
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

const scratch = await mkdtemp(join(tmpdir(), "cedia-sweep-pkg-"));
const projectPath = join(scratch, "project");
const profile = join(scratch, "profile");
const stateDir = join(scratch, "host");
const ompProfile = join(scratch, "omp-profile");
await mkdir(projectPath, { recursive: true });
await mkdir(join(profile, "User"), { recursive: true });
await mkdir(ompProfile, { recursive: true });
await writeFile(join(projectPath, "note.txt"), "D sweep probe workspace\n");
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
const project = host.host.store.createProject({ path: projectPath, name: "Sweep fixture" });
const session = host.host.createSession(project.id, "Sweep task");
check(session.id.length > 0, "fixture session registered");
await host.host.startSession(session.id);
const incarnation = host.host.store.getSession(session.id)!.incarnation;
const owner = host.auth.ownerToken;
const send = (command: string, payload: Record<string, unknown>) =>
	host.host.command(session.id, "owner", { commandId: `sweep-${randomUUID()}`, incarnation, command, payload });
const setModel = await send("set_model", { provider: "opencode-go", modelId: "muse-spark-1.3-contributor" });
check(["completed", "acknowledged"].includes(setModel.status), "live Muse model accepted");

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = join(root, "dist/packaged-d-sweep-proof", runId);
await mkdir(output, { recursive: true });
const shimLog = join(output, "login-item-shim.jsonl");
async function gate(phase: string): Promise<void> {
	await writeFile(join(output, `${phase}-ready.json`), JSON.stringify({ stagedAppPath: resolvedAppPath, output, runId, sessionId: session.id }) + "\n");
	console.log(`CUA_SWEEP_READY: ${phase}`);
	await waitForPath(join(output, `${phase}-release`), 900_000);
	for (const w of browser.windows() as unknown as { screenshot(o: unknown): Promise<void> }[]) {
		try { await w.screenshot({ path: join(output, `${phase}-window.png`) }); break; } catch {}
	}
}

let browser: any;
try {
	check(psLines().every(line => !line.includes("Cedia.app/Contents/MacOS/Cedia")), "no pre-existing Cedia process");
	browser = await _electron.launch({ executablePath: join(resolvedAppPath, "Contents/MacOS/Cedia"),
		args: ["--user-data-dir", profile, "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
		env: { ...process.env, CEDIA_STATE_DIR: stateDir,
			CEDIA_HOST_NODE: process.env.CEDIA_HOST_NODE ?? "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node",
			CEDIA_HOST_REQUEST_TIMEOUT_MS: "300000", CEDIA_LIFECYCLE_SHIM_LOG: shimLog, CEDIA_SIMULATE_LOGIN: "0" },
		timeout: 45_000 });
	console.log("SWEEP: staged app launched");
	await waitForPath(shimLog, 15_000);
	check(true, "staged app booted");
	await gate("tour");
	await gate("panels");
	const mixed = await send("prompt", { message: "Reply with exactly: แดง red แดง. Call no tools." });
	check(["completed", "acknowledged"].includes(mixed.status), "mixed-script prompt accepted");
	const answerDeadline = Date.now() + 240_000;
	let assistantText = "";
	for (;;) {
		let after = 0;
		for (let g = 0; g < 30; g++) {
			const page = await host.router({ method: "GET", path: `/v1/sessions/${session.id}/events?after=${after}&limit=200`, token: owner });
			const b = page.body as any;
			for (const e of (b?.events ?? []) as any[]) {
				const f = (e.frame ?? e) as any;
				if ((f.type === "message_end" || f.type === "turn_end") && f.message && Array.isArray(f.message?.content)) {
					const text = f.message.content.map((x: any) => typeof x.text === "string" ? x.text : "").join("").trim();
					if (text && f.message.role === "assistant") assistantText = text;
				}
			}
			if (!b?.hasMore) break;
			after = typeof b?.cursor === "number" ? b.cursor : after + 200;
		}
		const view = await host.router({ method: "GET", path: `/v1/sessions/${session.id}`, token: owner });
		const turns = ((view.body as any)?.turns ?? []) as any[];
		if (turns.length >= 1 && turns.every((t: any) => t.state === "completed")) break;
		if (Date.now() > answerDeadline) throw new Error(`${FAIL}: mixed turn did not complete`);
		await sleep(2000);
	}
	check(/[\u0E00-\u0E7F]/.test(assistantText) && /red/i.test(assistantText), `mixed Thai+English answer (got ${JSON.stringify(assistantText).slice(0, 160)})`);
	check(!/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(assistantText), "no CJK substitution");
	await writeFile(join(output, "mixed-answer.txt"), assistantText + "\n");
	await gate("mixed");
	const result = { ok: true, runId, sessionId: session.id, providerCalls: "one-tiny-mixed-turn" };
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
	console.log(`Sweep result: ${JSON.stringify(result)}`);
} finally {
	try { await host.host.command(session.id, "owner", { commandId: `sweep-stop-${randomUUID()}`, incarnation, command: "stop", payload: {} }); } catch {}
	await browser?.close?.().catch(() => {});
	const sweepDeadline = Date.now() + 15_000;
	while (Date.now() < sweepDeadline && stagedPids(resolvedAppPath).length > 0) await sleep(500);
	for (const pid of stagedPids(resolvedAppPath)) { try { process.kill(pid, "SIGKILL"); } catch {} }
	await sleep(2000);
	check(stagedPids(resolvedAppPath).length === 0, "no staged app processes survive");
	await host.close().catch(() => {});
}
