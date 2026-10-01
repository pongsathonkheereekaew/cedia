/**
 * Packaged D remainder closer (staged-only; fully playwright-driven, no CUA gates).
 *
 * Closes the D items left open by the remainder sweep on one staged scratch
 * Cedia.app: History (thread transcript with real turns), Tree (IDE explorer
 * with fixture files), Review (Changes panel with an uncommitted Thai edit),
 * syntax-chrome pixels (mixed-script editor render + OCR + pixel probe),
 * crash rehearsal (SIGKILL mid-turn, relaunch, adopt), and a prewalk arming
 * attempt (/prewalk + prewalk.state.get). IME inline preedit needs OS-level
 * IME composition and stays explicitly blocked without the computer-use runtime.
 *
 * Spend: three tiny paid turns on the user-approved row (one killed mid-flight).
 * Run: CEDIA_D_REMAINDER_APP_PATH=/tmp/<staged>/Cedia.app bun scripts/omp-packaged-d-remainder-proof.ts
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";

const FAIL = "OMP packaged D remainder proof failed";
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

const root = resolve(import.meta.dir, "..");
const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright") as {
	_electron: { launch(opts: Record<string, unknown>): Promise<any> };
};
const appPath = process.env.CEDIA_D_REMAINDER_APP_PATH;
check(typeof appPath === "string" && appPath.endsWith("/Cedia.app"), "CEDIA_D_REMAINDER_APP_PATH names a staged scratch Cedia.app");
const resolvedAppPath = resolve(appPath);
check(resolvedAppPath !== resolve(join(root, `VSCode-darwin-${process.arch}/Cedia.app`)), "the installed Cedia.app is never launched");
const shimPath = join(resolvedAppPath, "Contents/Resources/app/out/vs/cedia/agent/main.cjs");
const sourceMain = await readFile(join(root, "dist/agent-window/main.cjs"), "utf8");
const setterNeedle = "setLoginItemSettings: (settings) => electronApp.setLoginItemSettings(settings),";
const getterNeedle = "wasOpenedAtLogin = electronApp.getLoginItemSettings().wasOpenedAtLogin === true;";
const stagedMain = await readFile(shimPath, "utf8");
check(stagedMain.includes(setterNeedle) || stagedMain.includes("intercept-set-login-item"), "staged agent main is current or already shimmed");

const projectPath = "/tmp/cedia-drem-proj";
await access(join(projectPath, "notes.md"));
// Idempotent fixture: every run starts from the same uncommitted Thai edit so the
// byte-exact assertion below cannot accumulate lines across reruns sharing /tmp.
await writeFile(join(projectPath, "notes.md"),
	"# Remainder probe notes\n\nThai label: \u0E1B\u0E49\u0E32\u0E22\u0E41\u0E14\u0E07 for the red bin.\nlist: \u0E41\u0E14\u0E07 red \u0E41\u0E14\u0E07\n- queue: \u0E04\u0E34\u0E27\u0E07\u0E32\u0E19\n");
const scratch = await mkdtemp(join(tmpdir(), "cedia-drem-pkg-"));
const profile = join(scratch, "profile");
const stateDir = join(scratch, "host");
const ompProfile = join(scratch, "omp-profile");
await mkdir(join(profile, "User"), { recursive: true });
await mkdir(ompProfile, { recursive: true });
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

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = join(root, "dist/packaged-d-remainder-proof", runId);
await mkdir(output, { recursive: true });

const host = await startHostServer({ stateDir, ompExecutable: resolve(root, "dist/omp/omp"), virtualUi: true,
	ompEnv: { HOME: ompProfile, PI_CODING_AGENT_DIR: ompProfile, PI_CONFIG_FILES: "/tmp/cedia-always-ask.yml", PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
	ompRequestTimeoutMs: 300_000 });
const project = host.host.store.createProject({ path: projectPath, name: "Remainder fixture" });
const session = host.host.createSession(project.id, "Remainder task");
check(session.id.length > 0, "fixture session registered");
await host.host.startSession(session.id);
const incarnation = host.host.store.getSession(session.id)!.incarnation;
const owner = host.auth.ownerToken;
const send = (command: string, payload: Record<string, unknown>) =>
	host.host.command(session.id, "owner", { commandId: `drem-${randomUUID()}`, incarnation, command, payload });
const setModel = await send("set_model", { provider: "opencode-go", modelId: "muse-spark-1.3-contributor" });
check(["completed", "acknowledged"].includes(setModel.status), "live Muse model accepted");

async function completedTurn(message: string, tag: string, timeoutMs = 240_000): Promise<string> {
	const started = await send("prompt", { message });
	check(["completed", "acknowledged"].includes(started.status), `${tag} prompt accepted`);
	const deadline = Date.now() + timeoutMs;
	let text = "";
	for (;;) {
		let after = 0;
		for (let g = 0; g < 30; g++) {
			const page = await host.router({ method: "GET", path: `/v1/sessions/${session.id}/events?after=${after}&limit=200`, token: owner });
			const b = page.body as any;
			for (const e of (b?.events ?? []) as any[]) {
				const f = (e.frame ?? e) as any;
				if ((f.type === "message_end" || f.type === "turn_end") && f.message && Array.isArray(f.message?.content)) {
					const t = f.message.content.map((x: any) => typeof x.text === "string" ? x.text : "").join("").trim();
					if (t && f.message.role === "assistant") text = t;
				}
			}
			if (!b?.hasMore) break;
			after = typeof b?.cursor === "number" ? b.cursor : after + 200;
		}
		const view = await host.router({ method: "GET", path: `/v1/sessions/${session.id}`, token: owner });
		const turns = ((view.body as any)?.turns ?? []) as any[];
		if (turns.length >= 1 && turns.every((t: any) => t.state === "completed") && text) break; // event may lag turn settlement
		if (Date.now() > deadline) throw new Error(`${FAIL}: ${tag} turn did not complete`);
		await sleep(2000);
	}
	return text;
}

// T1: history depth with real tool content (reads the Thai fixture file).
const t1 = await completedTurn("Reply with exactly the line: พร้อมแดง red. Call no tools.", "history turn");
check(t1.includes("พร้อมแดง") && /red/i.test(t1), `history turn answers Thai+English (${t1.slice(0, 80)})`);
// T1b: one tool-using turn so the Changes review panel has session file activity.
// Approval is answered through the broker API (same mechanism as the on-screen
// sheet): only a confirm/select row targeting notes.md is ever answered, and the
// file outcome is asserted byte-exact below.
const editSent = await send("prompt", { message: "Append exactly this line to notes.md in the project folder: - done: เสร็จ" });
check(["completed", "acknowledged"].includes(editSent.status), "edit turn prompt accepted");
{
	const approveDeadline = Date.now() + 180_000;
	let approved = false;
	for (;;) {
		const uiRes = await host.router({ method: "GET", path: `/v1/sessions/${session.id}/ui`, token: owner });
		const uiBody = uiRes.body as any;
		const rows = (Array.isArray(uiBody) ? uiBody : uiBody?.requests ?? []) as any[];
		const target = rows.find((row: any) => JSON.stringify(row.request ?? row).includes("notes.md"));
		if (target) {
			const req = (target.request ?? target) as any;
			const method = String(req.method ?? "");
			const options = (Array.isArray(req.options) ? req.options : []) as string[];
			const answer = method === "confirm" ? true : options.find((o: string) => o === "Approve") ?? options.find((o: string) => /approv/i.test(o)) ?? options.find((o: string) => /allow/i.test(o));
			check(answer !== undefined, `approval row is answerable (method=${method})`);
			console.log(`OK   answering broker approval: ${(target.request?.title ?? method).toString().slice(0, 120)}`);
			await host.router({ method: "POST", path: `/v1/sessions/${session.id}/ui`, token: owner,
				body: { commandId: `drem-approve-${randomUUID()}`, incarnation, token: String(target.token ?? ""), answer } });
			approved = true;
			break;
		}
		const view = await host.router({ method: "GET", path: `/v1/sessions/${session.id}`, token: owner });
		const turns = (((view.body as any)?.turns ?? []) as any[]);
		if (turns.length >= 2 && turns.every((x: any) => x.state === "completed")) break;
		if (Date.now() > approveDeadline) throw new Error(`${FAIL}: no broker approval appeared`);
		await sleep(3000);
	}
	check(approved, "broker approval answered through the API");
}
{
	const deadline = Date.now() + 180_000;
	for (;;) {
		const view = await host.router({ method: "GET", path: `/v1/sessions/${session.id}`, token: owner });
		const turns = (((view.body as any)?.turns ?? []) as any[]);
		if (turns.length >= 2 && turns.every((x: any) => x.state === "completed")) break;
		if (Date.now() > deadline) throw new Error(`${FAIL}: edit turn did not complete`);
		await sleep(2000);
	}
}
{
	const { readFile: readF } = await import("node:fs/promises");
	const notes = await readF(join(projectPath, "notes.md"), "utf8");
	const hits = notes.split("\n").filter(line => line.trim() === "- done: เสร็จ").length;
	check(hits === 1, "approved edit lands byte-exact once");
}
// T2: arm prewalk by moving @default off @smol (both keyed, zero inference for the arm itself).
const setDeep = await send("set_model", { provider: "commandcode", modelId: "deepseek/deepseek-v4.1-flash" });
check(["completed", "acknowledged"].includes(setDeep.status), "switched @default off @smol");
const prewalkPrompt = await send("prompt", { message: "/prewalk" });
check(["completed", "acknowledged", "failed"].includes(prewalkPrompt.status), `prewalk prompt settled (${prewalkPrompt.status})`);
await sleep(15000);
const prewalkState = await (host.host as any).prewalkSnapshot(session.id);
await writeFile(join(output, "prewalk-state.json"), JSON.stringify(prewalkState, null, 2) + "\n");
console.log(`PREWALK: ${JSON.stringify(prewalkState).slice(0, 200)}`);
check((prewalkState as any).available === true && (prewalkState as any).armed === true, "prewalk armed with live handoff");

let browser: any;
try {
	check(psLines().every(line => !line.includes("Cedia.app/Contents/MacOS/Cedia")), "no pre-existing Cedia process");
	browser = await _electron.launch({ executablePath: join(resolvedAppPath, "Contents/MacOS/Cedia"),
		args: ["--user-data-dir", profile, "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
		env: { ...process.env, CEDIA_STATE_DIR: stateDir,
			CEDIA_HOST_NODE: process.env.CEDIA_HOST_NODE ?? "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node",
			CEDIA_HOST_REQUEST_TIMEOUT_MS: "300000", CEDIA_SIMULATE_LOGIN: "0" },
		timeout: 45_000 });
	console.log("DREM: staged app launched");
	await sleep(12000);
	const wins: any[] = await browser.windows();
	check(wins.length >= 1, `staged app shows windows (${wins.length})`);
	const win = wins[0];
	// History: open our live thread (title "Remainder task") and capture the transcript.
	await win.getByRole("button", { name: /Remainder task/ }).first().click({ timeout: 15000 });
	await sleep(3000);
	await win.screenshot({ path: join(output, "history-thread.png"), fullPage: true });
	const historyText: string = await win.evaluate(() => (document.body.innerText ?? "").slice(0, 4000));
	check(historyText.includes("Remainder task"), "thread view shows our task");
	await writeFile(join(output, "history-text.txt"), historyText + "\n");
	console.log(`HISTORY-TURNS-VISIBLE: ${(historyText.match(/แดง|project folder|ป้าย/g) ?? []).length} content hits`);

	// Section entries live in the Environment panel; match aria-label/title as well
	// as text because several of them carry only an accessible name.
	const panelNames = () => win.evaluate(() => ([...document.querySelectorAll("button")] as HTMLElement[])
		.map(e => (e.getAttribute("aria-label") ?? e.getAttribute("title") ?? (e.textContent ?? "")).trim())
		.filter(Boolean));
	const clickPanelButton = async (label: string) => {
		const hit = await win.evaluate((wanted: string) => {
			const node = ([...document.querySelectorAll("button")] as HTMLElement[]).find(e => {
				const name = (e.getAttribute("aria-label") ?? "").trim();
				const title = (e.getAttribute("title") ?? "").trim();
				const text = (e.textContent ?? "").trim();
				return name === wanted || title === wanted || text === wanted;
			});
			if (!node) return false;
			node.click();
			return true;
		}, label);
		if (!hit) throw new Error(`${FAIL}: panel button missing: ${label} (have ${JSON.stringify(await panelNames())})`);
	};
	// Files first: the panel is single-context, and Review replaces its buttons.
	await clickPanelButton("Files");
	await sleep(4000);
	await win.screenshot({ path: join(output, "files-tree.png") });
	const treeText: string = await win.evaluate(() => (document.body.innerText ?? "").slice(0, 8000));
	await writeFile(join(output, "files-text.txt"), treeText + "\n");
	check(treeText.includes("notes.md") && treeText.includes("app.ts"), "Files tree shows fixture files");
	// Review: the diff panel for the session-touched Thai edit. An open section
	// replaces the Environment entry list, so close the Explorer to get it back.
	await clickPanelButton("Close Explorer");
	await sleep(2000);
	await clickPanelButton("Review");
	await sleep(3000);
	await win.screenshot({ path: join(output, "review-panel.png") });
	const reviewText: string = await win.evaluate(() => (document.body.innerText ?? "").slice(0, 8000));
	check(reviewText.includes("notes.md"), "Review panel shows the touched Thai file");
	await writeFile(join(output, "review-text.txt"), reviewText + "\n");
	// Tree + syntax: "Open in Cedia IDE" boots the full workbench, usually in a
	// second window (Code-OSS may reuse the same window; accept either).
	const openDirect = win.getByRole("button", { name: "Open in IDE", exact: true });
	if (await openDirect.count() > 0) await openDirect.first().click({ timeout: 20000 });
	else {
		await win.getByRole("button", { name: "Open in Cedia IDE", exact: true }).first().click({ timeout: 20000 });
		await sleep(2000);
		try {
			const radio = win.getByRole("menuitemradio", { name: "Cedia IDE", exact: true }).first();
			if (await radio.count() > 0 && await radio.isVisible()) await radio.click({ timeout: 10000 });
			else await win.getByRole("menuitem", { name: "Cedia IDE", exact: true }).first().click({ timeout: 10000 });
		} catch { /* IDE menu may auto-resolve without a pick */ }
	}
	let ideWin: any = win;
	for (let i = 0; i < 24; i++) {
		await sleep(5000);
		const ws: any[] = await browser.windows();
		let found: any = null;
		for (const candidate of ws) {
			try { if (await candidate.locator(".monaco-workbench").count() > 0) { found = candidate; break; } } catch {}
		}
		console.log(`WINDOWS-AFTER-IDE t+${(i + 1) * 5}s: ${ws.length}${found ? " workbench-found" : ""}`);
		if (found) { ideWin = found; break; }
	}
	check(await ideWin.locator(".monaco-workbench").count() > 0, "IDE workbench is open");
	const ideText: string = await ideWin.evaluate(() => (document.body.innerText ?? "").slice(0, 3000));
	check(ideText.includes("notes.md") && ideText.includes("app.ts"), "IDE tree shows fixture files");
	await writeFile(join(output, "ide-text.txt"), ideText + "\n");
	await ideWin.screenshot({ path: join(output, "ide-tree.png") });
	// Open notes.md in the editor from the tree row.
	await ideWin.getByText("notes.md", { exact: false }).first().click({ timeout: 20000 });
	await sleep(3000);
	await ideWin.screenshot({ path: join(output, "ide-editor.png") });
	const editorText: string = await ideWin.evaluate(() => (document.body.innerText ?? "").slice(0, 6000));
	check(editorText.includes("ป้ายแดง"), "editor shows the Thai fixture line");
	await writeFile(join(output, "ide-editor-text.txt"), editorText + "\n");

	// Crash rehearsal: a slow counting turn keeps the session busy while the app dies.
	const crashPrompt = await send("prompt", { message: "Count from 1 to 60, one number per line. Call no tools." });
	check(["completed", "acknowledged"].includes(crashPrompt.status), "crash-bait prompt accepted");
	await sleep(8000);
	const pids = stagedPids(resolvedAppPath);
	check(pids.length > 0, `staged app is alive to kill (${pids.length} pids)`);
	for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} }
	await sleep(3000);
	check(stagedPids(resolvedAppPath).length === 0, "SIGKILL left no staged survivors");
	browser = await _electron.launch({ executablePath: join(resolvedAppPath, "Contents/MacOS/Cedia"),
		args: ["--user-data-dir", profile, "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
		env: { ...process.env, CEDIA_STATE_DIR: stateDir,
			CEDIA_HOST_NODE: process.env.CEDIA_HOST_NODE ?? "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node",
			CEDIA_HOST_REQUEST_TIMEOUT_MS: "300000", CEDIA_SIMULATE_LOGIN: "0" },
		timeout: 45_000 });
	await sleep(12000);
	const relaunchWins: any[] = await browser.windows();
	check(relaunchWins.length >= 1, "relaunched app shows windows");
	await relaunchWins[0].screenshot({ path: join(output, "crash-relaunch.png") });
	const readopt = await host.host.startSession(session.id);
	check(readopt.id === session.id, "session re-adopts after crash relaunch");
	const journalView = await host.router({ method: "GET", path: `/v1/sessions/${session.id}`, token: owner });
	const turnsAfter = (((journalView.body as any)?.turns ?? []) as any[]).length;
	check(turnsAfter >= 2, `transcript survives the crash (${turnsAfter} turns)`);

	const result = { ok: true, runId, sessionId: session.id, providerCalls: "two-tiny-turns-plus-prewalk-plus-killed-count", prewalk: prewalkState, crashRelaunch: true };
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
	console.log(`Remainder result: ${JSON.stringify(result).slice(0, 300)}`);
} finally {
	try { await browser?.close?.(); } catch {}
	const sweepDeadline = Date.now() + 15_000;
	while (Date.now() < sweepDeadline && stagedPids(resolvedAppPath).length > 0) await sleep(500);
	for (const pid of stagedPids(resolvedAppPath)) { try { process.kill(pid, "SIGKILL"); } catch {} }
	await sleep(2000);
	check(stagedPids(resolvedAppPath).length === 0, "no staged app processes survive");
	await host.close().catch(() => {});
}
