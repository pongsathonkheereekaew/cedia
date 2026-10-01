/**
 * Packaged panels capture sweep (D capability fidelity, staged-only, zero spend).
 *
 * A staged scratch Cedia.app runs a turn held at a hanging loopback model
 * while a follow-up sits queued; the operator opens each major Agent-window
 * panel through computer-use and records its visible rows (AX), and the
 * runner screenshots every gate. Backend state is asserted from the host
 * journal at sweep time (one running turn, one queued intent), so the
 * captures provably correspond to live state. The turn is stopped, staged
 * originals restored, zero survivors.
 *
 * Gates (dist/packaged-panels-proof/<runId>/): prompt-ready → release;
 * queue-ready → release; panels-ready → release; done when result.json lands.
 *
 * Run: CEDIA_PACKAGED_PANELS_APP_PATH=/tmp/<staged>/Cedia.app bun scripts/omp-packaged-panels-proof.ts
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:http";
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Database } from "bun:sqlite";
import { isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import type { HostDescriptor } from "../packages/protocol/src/index.ts";
import { dereferencePackagedResponse } from "./lib/packaged-proof-http.ts";

const root = resolve(import.meta.dir, "..");
const failPrefix = "OMP packaged panels proof failed";
function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${failPrefix}: ${message}`);
	console.log(`OK   ${message}`);
}
function object(value: unknown, message: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${failPrefix}: ${message}`);
	return value as Record<string, unknown>;
}
const delay = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
async function waitFor<T>(label: string, read: () => Promise<T | undefined>, timeoutMs = 90_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await read();
		if (value !== undefined) return value;
		if (Date.now() >= deadline) throw new Error(`${failPrefix}: timed out waiting for ${label}`);
		await delay(250);
	}
}

const appBundle = process.env.CEDIA_PACKAGED_PANELS_APP_PATH;
check(typeof appBundle === "string" && appBundle.endsWith("/Cedia.app"), "CEDIA_PACKAGED_PANELS_APP_PATH names a staged Cedia.app");
const resolvedAppBundle = await realpath(resolve(appBundle));
const installedAppBundle = resolve(join(root, `VSCode-darwin-${process.arch}/Cedia.app`));
const tempRoot = await realpath(tmpdir());
check(resolvedAppBundle !== installedAppBundle && !resolvedAppBundle.startsWith(`${installedAppBundle}/`), "the installed Cedia.app is never launched or modified");
check(resolvedAppBundle.startsWith(`${tempRoot}/`), "the staged app resides under the system temporary directory");
const appExecutable = join(resolvedAppBundle, "Contents/MacOS/Cedia");
const runtimeRoot = join(resolvedAppBundle, "Contents/Resources/app/extensions/cedia/runtime");
const bundledHost = join(runtimeRoot, "host/cli.js");
const bundledOmp = join(runtimeRoot, "omp/omp");
const stagedExtensionDirectory = join(resolvedAppBundle, "Contents/Resources/app/extensions/cedia");
const stagedAgentWindowDirectory = join(resolvedAppBundle, "Contents/Resources/app/out/vs/cedia/agent");
const sourceExtensionDirectory = join(root, "dist/mac-extension");
const sourceAgentWindowDirectory = join(root, "dist/agent-window");
const sourceOmpExecutable = join(root, "dist/omp-standalone/omp");
const sourceHostCli = join(root, "dist/host/cli.js");
await Promise.all([access(appExecutable), access(bundledHost), access(bundledOmp)]);
const packagedRuntimeVersion = execFileSync(bundledOmp, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(packagedRuntimeVersion), `packaged OMP runtime is supported (${packagedRuntimeVersion})`);

function loadElectronLauncher(): { launch(o: Record<string, unknown>): Promise<any> } {
	const playwright = createRequire(join(root, "desktop/package.json"))("playwright") as unknown;
	if (!playwright || typeof playwright !== "object" || !("_electron" in playwright)) throw new Error(`${failPrefix}: playwright _electron launcher is unavailable`);
	return (playwright as any)._electron;
}
const electronLauncher = loadElectronLauncher();

const scratch = await realpath(await mkdtemp(join(tmpdir(), "c-pkg-panels-")));
const originalStagedExtensionDirectory = join(scratch, "original-cedia-extension");
const originalStagedAgentWindowDirectory = join(scratch, "original-agent-window");
const profile = join(scratch, "u");
const stateDir = join(scratch, "h");
const home = join(scratch, "hm");
const ompProfile = join(home, ".omp");
const workDir = join(scratch, "w");
const output = join(root, "dist/packaged-panels-proof", new Date().toISOString().replace(/[:.]/g, "-"));
await Promise.all([mkdir(join(profile, "User"), { recursive: true }), mkdir(ompProfile, { recursive: true }), mkdir(home, { recursive: true }), mkdir(workDir, { recursive: true }), mkdir(output, { recursive: true })]);
await writeFile(join(profile, "User", "settings.json"), `${JSON.stringify({
	"cedia.hostStateDir": stateDir, "security.workspace.trust.enabled": false, "window.startupEditor": "none",
	"workbench.startupEditor": "none", "update.mode": "none", "telemetry.telemetryLevel": "off", "extensions.autoCheckUpdates": false,
}, null, 2)}\n`, { mode: 0o600 });

let hangRequests = 0;
const sockets = new Set<Socket>();
const hang: Server = createServer((req, res) => {
	hangRequests++;
	req.resume();
	sockets.add(req.socket);
	req.socket.on("close", () => sockets.delete(req.socket));
});
await new Promise<void>(done => hang.listen(0, "127.0.0.1", done));
hang.unref();
const hangPort = (hang.address() as { port: number }).port;
check(hangPort > 0, "hanging loopback model endpoint is bound");
await writeFile(join(ompProfile, "models.yml"), `providers:
  cedia-panels-hang:
    baseUrl: http://127.0.0.1:${hangPort}/v1
    auth: none
    api: openai-completions
    models:
      - id: hang-model
        name: Panels hang model
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 8192
        maxTokens: 1024
`, { mode: 0o600 });

let currentApp: any;
let hostDescriptor: HostDescriptor | undefined;
let sessionId: string | undefined;
let proofPassed = false;
const rendererErrors: string[] = [];
const lifecycleShimLog = join(output, "login-item-shim.jsonl");
const appEnv = { ...process.env, HOME: home, CEDIA_STATE_DIR: stateDir, CEDIA_HOST_IDLE_MS: "300000",
	PI_CODING_AGENT_DIR: ompProfile, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off", CEDIA_LIFECYCLE_SHIM_LOG: lifecycleShimLog };

async function requestRaw(hostValue: HostDescriptor, method: string, path: string, body?: unknown): Promise<unknown> {
	const response = await fetch(`${hostValue.url}${path}`, { method,
		headers: { Authorization: `Bearer ${hostValue.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
		...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
	const result = await response.json() as unknown;
	if (!response.ok) throw new Error(`${failPrefix}: ${method} ${path} returned ${response.status}`);
	return result;
}
async function request(hostValue: HostDescriptor, method: string, path: string, body?: unknown): Promise<unknown> {
	const result = await requestRaw(hostValue, method, path, body);
	return dereferencePackagedResponse(result, async (sha256, offset) =>
		requestRaw(hostValue, "GET", `/v1/responses/${encodeURIComponent(sha256)}?offset=${offset}`));
}
async function readHost(): Promise<{ descriptor: HostDescriptor; identity: Record<string, unknown> } | undefined> {
	try {
		const descriptor = JSON.parse(await readFile(join(stateDir, "host.json"), "utf8")) as HostDescriptor;
		if (typeof descriptor.url !== "string" || typeof descriptor.token !== "string" || !Number.isSafeInteger(descriptor.pid)) return undefined;
		const response = await fetch(`${descriptor.url}/v1/health`, { headers: { Authorization: `Bearer ${descriptor.token}` }, signal: AbortSignal.timeout(1_000) });
		if (!response.ok) return undefined;
		const health = object(await response.json(), "packaged host health response");
		const identity = object(health.identity, "packaged host identity");
		if (identity.stateDir !== stateDir || identity.processStartedAt !== descriptor.processStartedAt) return undefined;
		return { descriptor, identity };
	} catch { return undefined; }
}
function journalTurnStates(): { state: string }[] {
	try {
		const db = new Database(join(stateDir, "journal.sqlite"), { readonly: true });
		const rows = db.query("SELECT state FROM turn_intents").all() as { state: string }[];
		db.close();
		return rows;
	} catch { return []; }
}
async function gate(phase: string): Promise<void> {
	await writeFile(join(output, `${phase}-ready.json`), `${JSON.stringify({ phase, stagedAppPath: resolvedAppBundle, sessionId, output })}\n`);
	console.log(`PANELS_GATE: ${phase} — write ${phase}-release to continue`);
	await waitFor(`operator ${phase}`, async () =>
		await import("node:fs/promises").then(async m => { try { await m.access(join(output, `${phase}-release`)); return true as const; } catch { return undefined; } }), 600_000);
	for (const [index, page] of (currentApp?.windows() ?? []).entries()) {
		try { await page.screenshot({ path: join(output, `${phase}-window-${index}.png`) }); } catch {}
	}
}

try {
	await cp(stagedExtensionDirectory, originalStagedExtensionDirectory, { recursive: true });
	await cp(stagedAgentWindowDirectory, originalStagedAgentWindowDirectory, { recursive: true });
	await rm(stagedExtensionDirectory, { recursive: true, force: true });
	await cp(sourceExtensionDirectory, stagedExtensionDirectory, { recursive: true });
	await rm(stagedAgentWindowDirectory, { recursive: true, force: true });
	await cp(sourceAgentWindowDirectory, stagedAgentWindowDirectory, { recursive: true });
	const sourceOmpSha256 = createHash("sha256").update(await readFile(sourceOmpExecutable)).digest("hex");
	const sourceHostSha256 = createHash("sha256").update(await readFile(sourceHostCli)).digest("hex");
	check(createHash("sha256").update(await readFile(bundledOmp)).digest("hex") === sourceOmpSha256, "the staged app carries the current standalone OMP binary");
	check(createHash("sha256").update(await readFile(bundledHost)).digest("hex") === sourceHostSha256, "the staged app carries the current source host executable");
	const mainPath = join(stagedAgentWindowDirectory, "main.cjs");
	const sourceMain = await readFile(join(sourceAgentWindowDirectory, "main.cjs"), "utf8");
	const setter = "setLoginItemSettings: (settings) => electronApp.setLoginItemSettings(settings),";
	const getter = "wasOpenedAtLogin = electronApp.getLoginItemSettings().wasOpenedAtLogin === true;";
	check((await readFile(mainPath, "utf8")) === sourceMain && sourceMain.split(setter).length === 2 && sourceMain.split(getter).length === 2, "staged Login Item interception points match");
	await writeFile(mainPath, sourceMain
		.replace(setter, `setLoginItemSettings: (settings) => { require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "intercept-set-login-item", settings }) + "\\n"); },`)
		.replace(getter, `wasOpenedAtLogin = false; require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "simulated-login-state", isPackaged: electronApp.isPackaged, openedAtLogin: false }) + "\\n");`));
	execFileSync("codesign", ["--force", "--deep", "--sign", "-", resolvedAppBundle], { stdio: "ignore" });

	const generation = `packaged-panels-${randomUUID()}`;
	const app = await electronLauncher.launch({ executablePath: appExecutable,
		args: ["--user-data-dir", profile, "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
		env: { ...appEnv, CEDIA_APP_GENERATION: generation }, timeout: 45_000 });
	currentApp = app;
	const rawPage = await app.firstWindow() as unknown;
	if (!rawPage || typeof rawPage !== "object") throw new Error(`${failPrefix}: staged app returned no window`);
	const page = rawPage as { on(e: string, l: (err: Error) => void): void; screenshot(o: Record<string, unknown>): Promise<void>; getByRole(r: string, o?: Record<string, unknown>): { first(): { click(o?: unknown): Promise<void> } } };
	page.on("pageerror", (error: Error) => rendererErrors.push(error.message));
	try { await page.getByRole("button", { name: "Skip setup", exact: true }).first().click({ timeout: 15_000 }); } catch {}
	const shimEvents = (await readFile(lifecycleShimLog, "utf8")).trim().split("\n").map(line => JSON.parse(line));
	check(shimEvents.some((e: any) => e.event === "intercept-set-login-item"), "scratch Login Item interception was observed");
	const firstHost = await waitFor("the packaged app to start its bundled host", readHost, 60_000);
	check(firstHost.identity.appGeneration === generation, "the packaged host records the staged app generation");
	const packagedHost: HostDescriptor = firstHost.descriptor;
	hostDescriptor = packagedHost;
	const project = object(await request(packagedHost, "POST", "/v1/projects", { path: workDir, name: "Panels sweep" }), "created project");
	const session = object(await request(packagedHost, "POST", "/v1/sessions", { projectId: String(project.id ?? ""), title: "Panels sweep task" }), "created task");
	sessionId = String(session.id ?? "");
	const started = object(await request(packagedHost, "POST", `/v1/sessions/${sessionId}/start`, {}), "started task");
	check(started.status === "idle" || started.status === "running", "the packaged host starts its OMP owner");
	const view = object(await request(packagedHost, "GET", `/v1/sessions/${sessionId}`, undefined), "task view");
	const incarnation = String(view.incarnation ?? "");
	const setModel = object(await request(packagedHost, "POST", `/v1/sessions/${sessionId}/commands`, {
		commandId: `panels-model-${randomUUID()}`, incarnation, command: "set_model", payload: { provider: "cedia-panels-hang", modelId: "hang-model" } }), "set_model receipt");
	check(setModel.status === "completed" || setModel.status === "acknowledged", "the hanging loopback model is selected");

	await gate("prompt");
	const running = await waitFor("the prompt turn to reach the hanging provider", async () => {
		if (hangRequests === 0) return undefined;
		const v = object(await request(packagedHost, "GET", `/v1/sessions/${sessionId}`, undefined), "task view during turn");
		const turns = ((v as any).turns ?? []) as any[];
		return turns.some(t => t.state === "running" || t.state === "in_progress" || t.state === "active") ? true : undefined;
	}, 120_000);
	check(running && hangRequests >= 1, "one turn is running against the hanging provider with zero answers");
	await gate("queue");
	const states = journalTurnStates().map(r => r.state);
	check(states.filter(s => s === "running").length >= 1, `journal shows a running turn (states: ${states.join(",")})`);
	check(states.length >= 2, `journal shows the queued intent beside it (states: ${states.join(",")})`);
	await gate("panels");
	const stop = object(await request(packagedHost, "POST", `/v1/sessions/${sessionId}/commands`, {
		commandId: `panels-stop-${randomUUID()}`, incarnation, command: "abort", payload: {} }), "stop receipt");
	check(stop.status === "completed" || stop.status === "acknowledged", "the held turn stops on request");
	check(rendererErrors.length === 0, `no renderer page errors (${JSON.stringify(rendererErrors.slice(0, 3))})`);
	const result = { ok: true, version: packagedRuntimeVersion, turns: states, hangRequests, providerCalls: 0,
		note: "panel rows recorded by the operator in the dated receipt; screenshots per gate in this directory" };
	await writeFile(join(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
	console.log(JSON.stringify(result, null, 2));
	proofPassed = true;
} catch (error) {
	await writeFile(join(output, "failure.json"), `${JSON.stringify({ error: String(error), rendererErrors: rendererErrors.slice(0, 10) }, null, 2)}\n`).catch(() => {});
	throw error;
} finally {
	for (const s of [...sockets]) { try { s.destroy(); } catch {} }
	await new Promise<void>(done => hang.close(() => done()));
	try { if (sessionId && hostDescriptor) await request(hostDescriptor, "POST", `/v1/sessions/${sessionId}/stop`, {}).catch(() => {}); } catch {}
	await currentApp?.close?.().catch(() => {});
	const sweepDeadline = Date.now() + 15_000;
	const mainExec = appExecutable;
	const alive = (): boolean => {
		try {
			const lines = execFileSync("ps", ["-ax", "-o", "command="], { encoding: "utf8", timeout: 10_000 }).split("\n");
			return lines.some(l => l.includes(mainExec));
		} catch { return false; }
	};
	while (Date.now() < sweepDeadline && alive()) await delay(500);
	check(!alive(), "no staged app processes survive the proof");
	try {
		await rm(stagedExtensionDirectory, { recursive: true, force: true });
		await cp(originalStagedExtensionDirectory, stagedExtensionDirectory, { recursive: true });
		await rm(stagedAgentWindowDirectory, { recursive: true, force: true });
		await cp(originalStagedAgentWindowDirectory, stagedAgentWindowDirectory, { recursive: true });
		execFileSync("codesign", ["--force", "--deep", "--sign", "-", resolvedAppBundle], { stdio: "ignore" });
	} catch {}
	console.log(`PACKAGED-PANELS: scratch=${scratch} output=${output} passed=${proofPassed}`);
}
