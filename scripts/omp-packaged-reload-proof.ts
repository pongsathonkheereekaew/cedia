/**
 * Packaged extension-reload proof (O06 staged-only, provider-free).
 *
 * Topology: staged Cedia.app copy only. A hot-reload fixture TypeScript
 * extension is registered through the scratch OMP profile's `settings.json`
 * `extensions` array (same discovery the packaged OMP owner uses — no bundle
 * lock modification, no extra CLI channel, no product file touched).
 * `/reload-plugins` through the packaged host REST re-evaluates the rewritten
 * fixture file (same mechanism as the dev-host hot-reload smoke).
 *
 * STATUS 2026-10-01: demonstrates a product boundary — generation A loads at
 * startup through the packaged owner, but a rewritten staged lock file is NOT
 * re-evaluated on `/reload-plugins` (reload completes, catalog unchanged), so
 * the proof fails honestly at the B-swap check. Direct `--trusted-extension`
 * files DO swap on the same binary, and settings.json/discovery placements do
 * not load for hosted sessions. See
 * docs/maintenance/evidence/o06-packaged-reload-boundary-2026-10-01/findings.md
 * for the specified requirement. Re-run after a reloadable packaged extension
 * path lands.
 *
 * Transitions (intended): A loaded at startup → B atomically replaces A →
 * throwing candidate rolls back to B → removal clears the fixture → stale
 * selected slash refused with 409 before dispatch. Same OMP PID and host
 * session incarnation throughout; zero provider inference.
 *
 * Run: CEDIA_PACKAGED_RELOAD_APP_PATH=/tmp/<staged>/Cedia.app bun scripts/omp-packaged-reload-proof.ts
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import type { HostDescriptor } from "../packages/protocol/src/index.ts";
import { dereferencePackagedResponse } from "./lib/packaged-proof-http.ts";
import { packagedProofModelSlugs as modelSlugs } from "./lib/packaged-proof-catalog.ts";

const root = resolve(import.meta.dir, "..");
const failPrefix = "OMP packaged reload proof failed";
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
function psLines(): string[] {
	try { return execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8", timeout: 10_000 }).split("\n"); }
	catch { return []; }
}
function pidsWith(fragment: string): number[] {
	return psLines().flatMap(line => {
		const m = line.trim().match(/^(\d+)\s+(.*)$/);
		if (!m) return [];
		return m[2]!.includes(fragment) ? [Number(m[1])] : [];
	});
}

const PROVIDER = "cedia_packaged_reload_fixture";
const PROJECT_NAME = "Packaged reload fixture";
const TASK_TITLE = "Packaged reload task";
const commandName = (gen: string) => `hot-reload-packaged-${gen}`;
const modelId = (gen: string) => `hot-reload-packaged-model-${gen}`;
const fixtureSource = (gen: "a" | "b"): string => `
export default function (pi) {
	pi.registerCommand(${JSON.stringify(commandName(gen))}, {
		description: ${JSON.stringify(`Packaged reload fixture generation ${gen.toUpperCase()}`)},
		handler: async () => {},
	});
	pi.registerTool({
		name: ${JSON.stringify(`hot_reload_packaged_${gen}_tool`)},
		label: ${JSON.stringify(`Packaged Reload ${gen.toUpperCase()}`)},
		description: "Packaged reload fixture tool",
		parameters: pi.zod.object({}),
		async execute() { return { content: [{ type: "text", text: "fixture" }] }; },
	});
	pi.registerProvider(${JSON.stringify(PROVIDER)}, {
		baseUrl: "http://127.0.0.1:9/v1",
		apiKey: "fixture-never-used",
		authHeader: false,
		api: "openai-completions",
		models: [{ id: ${JSON.stringify(modelId(gen))}, name: ${JSON.stringify(`Packaged Reload ${gen.toUpperCase()}`)}, reasoning: false,
			input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }],
	});
}
`;
const brokenSource = `
export default function (pi) {
	pi.registerCommand("hot-reload-packaged-broken", { description: "Must roll back", handler: async () => {} });
	throw new Error("intentional packaged reload candidate failure");
}
`;

const appBundle = process.env.CEDIA_PACKAGED_RELOAD_APP_PATH;
check(typeof appBundle === "string" && appBundle.endsWith("/Cedia.app"),
	"CEDIA_PACKAGED_RELOAD_APP_PATH names a staged Cedia.app");
const resolvedAppBundle = await realpath(resolve(appBundle));
const installedAppBundle = resolve(join(root, `VSCode-darwin-${process.arch}/Cedia.app`));
const tempRoot = await realpath(tmpdir());
check(resolvedAppBundle !== installedAppBundle && !resolvedAppBundle.startsWith(`${installedAppBundle}/`),
	"the repository's installed Cedia.app is never launched or modified");
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
const runtimeVersion = execFileSync(sourceOmpExecutable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(runtimeVersion === packagedRuntimeVersion, `the current source OMP runtime matches the app's pinned version (${runtimeVersion})`);

function loadElectronLauncher(): { launch(o: Record<string, unknown>): Promise<any> } {
	const playwright = createRequire(join(root, "desktop/package.json"))("playwright") as unknown;
	if (!playwright || typeof playwright !== "object" || !("_electron" in playwright)) throw new Error(`${failPrefix}: playwright _electron launcher is unavailable`);
	return (playwright as any)._electron;
}
const electronLauncher = loadElectronLauncher();

const scratch = await realpath(await mkdtemp(join(tmpdir(), "c-pkg-reload-")));
const originalStagedExtensionDirectory = join(scratch, "original-cedia-extension");
const originalStagedAgentWindowDirectory = join(scratch, "original-agent-window");
const profile = join(scratch, "u");
const stateDir = join(scratch, "h");
const home = join(scratch, "hm");
const ompProfile = join(home, ".omp");
const workDir = join(scratch, "w");
const output = join(root, "dist/packaged-reload-proof", new Date().toISOString().replace(/[:.]/g, "-"));
await Promise.all([mkdir(join(profile, "User"), { recursive: true }), mkdir(ompProfile, { recursive: true }), mkdir(home, { recursive: true }), mkdir(workDir, { recursive: true }), mkdir(output, { recursive: true })]);
await writeFile(join(profile, "User", "settings.json"), `${JSON.stringify({
	"cedia.hostStateDir": stateDir, "security.workspace.trust.enabled": false, "window.startupEditor": "none",
	"workbench.startupEditor": "none", "update.mode": "none", "telemetry.telemetryLevel": "off", "extensions.autoCheckUpdates": false,
}, null, 2)}\n`, { mode: 0o600 });

const fixturePath = join(scratch, "hot-reload-fixture.ts");
await writeFile(fixturePath, fixtureSource("a"), { mode: 0o600 });
await writeFile(join(ompProfile, "settings.json"), `${JSON.stringify({ extensions: [fixturePath] }, null, 2)}\n`, { mode: 0o600 });
await writeFile(join(ompProfile, "models.yml"), `providers:\n  cedia-packaged-reload-baseline:\n    baseUrl: http://127.0.0.1:9/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: baseline-model\n        name: Packaged reload baseline\n        api: openai-completions\n        reasoning: false\n        input: [text]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 8192\n        maxTokens: 1024\n`, { mode: 0o600 });

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
	if (!response.ok) { const err = new Error(`${failPrefix}: ${method} ${path} returned ${response.status}`) as any; err.status = response.status; err.body = result; throw err; }
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
async function listCommands(descriptor: HostDescriptor, id: string): Promise<Record<string, unknown>[]> {
	const rows = await request(descriptor, "GET", `/v1/sessions/${id}/commands`, undefined);
	if (!Array.isArray(rows)) throw new Error(`${failPrefix}: commands list is not an array`);
	return rows as Record<string, unknown>[];
}
async function commandNames(descriptor: HostDescriptor, id: string, incarnation: string): Promise<Set<string>> {
	const commandId = `packaged-reload-commands-${randomUUID()}`;
	const receipt = object(await request(descriptor, "POST", `/v1/sessions/${id}/commands`, { commandId, incarnation, command: "get_available_commands", payload: {} }), "commands receipt");
	if (receipt.status !== "acknowledged" && receipt.status !== "completed") throw new Error(`${failPrefix}: get_available_commands not accepted (${String(receipt.status)})`);
	const settled = await waitFor("get_available_commands to complete", async () => {
		const rows = await listCommands(descriptor, id).catch(() => undefined);
		return rows?.find(e => e.commandId === commandId && (e.status === "completed" || e.status === "failed"));
	});
	if (settled.status !== "completed") throw new Error(`${failPrefix}: get_available_commands ${String(settled.status)}`);
	const data = object(object(settled.result, "commands result").data ?? settled.result, "commands data");
	if (!Array.isArray((data as any).commands)) throw new Error(`${failPrefix}: command catalog is not an array`);
	return new Set(((data as any).commands as Record<string, unknown>[]).map(c => String(c.name)));
}
async function sessionModelNames(descriptor: HostDescriptor, id: string, incarnation: string): Promise<Set<string>> {
	const commandId = `packaged-reload-models-${randomUUID()}`;
	const receipt = object(await request(descriptor, "POST", `/v1/sessions/${id}/commands`, { commandId, incarnation, command: "get_available_models", payload: {} }), "models receipt");
	if (receipt.status !== "acknowledged" && receipt.status !== "completed") throw new Error(`${failPrefix}: get_available_models not accepted (${String(receipt.status)})`);
	const settled = await waitFor("get_available_models to complete", async () => {
		const rows = await listCommands(descriptor, id).catch(() => undefined);
		return rows?.find(e => e.commandId === commandId && (e.status === "completed" || e.status === "failed"));
	});
	if (settled.status !== "completed") throw new Error(`${failPrefix}: get_available_models ${String(settled.status)}`);
	return modelSlugs(object(settled.result, "models result").data ?? settled.result);
}
async function sendPrompt(descriptor: HostDescriptor, id: string, incarnation: string, message: string, tag: string): Promise<Record<string, unknown>> {
	const commandId = `packaged-reload-${tag}-${randomUUID()}`;
	const receipt = object(await request(descriptor, "POST", `/v1/sessions/${id}/commands`, { commandId, incarnation, command: "prompt", payload: { message } }), `${tag} receipt`);
	if (receipt.status !== "acknowledged" && receipt.status !== "completed") throw new Error(`${failPrefix}: ${tag} not accepted (${String(receipt.status)})`);
	const terminal = await waitFor(`${tag} to settle`, async () => {
		const rows = await listCommands(descriptor, id).catch(() => undefined);
		return rows?.find(e => e.commandId === commandId && (e.status === "completed" || e.status === "failed"));
	});
	return { status: String(terminal.status), result: object(terminal.result, `${tag} result`), error: terminal.error };
}
async function sessionStats(descriptor: HostDescriptor, id: string, incarnation: string): Promise<Record<string, unknown>> {
	const commandId = `packaged-reload-stats-${randomUUID()}`;
	const receipt = object(await request(descriptor, "POST", `/v1/sessions/${id}/commands`, { commandId, incarnation, command: "get_session_stats", payload: {} }), "stats receipt");
	if (receipt.status !== "acknowledged" && receipt.status !== "completed") throw new Error(`${failPrefix}: get_session_stats not accepted`);
	const settled = await waitFor("get_session_stats to complete", async () => {
		const rows = await listCommands(descriptor, id).catch(() => undefined);
		return rows?.find(e => e.commandId === commandId && (e.status === "completed" || e.status === "failed"));
	});
	if (settled.status !== "completed") throw new Error(`${failPrefix}: get_session_stats ${String(settled.status)}`);
	return object(object(settled.result, "stats result").data, "stats data") as Record<string, unknown>;
}
function ownerPidForSession(id: string): number | undefined {
	const hits = psLines().flatMap(line => {
		const m = line.trim().match(/^(\d+)\s+(.*)$/);
		if (!m || !m[2]!.includes(id)) return [];
		return /rpc-ui|coding-agent|\/omp\/omp|\/omp\b/.test(m[2]!) ? [Number(m[1])] : [];
	});
	if (hits.length > 1) throw new Error(`${failPrefix}: multiple OMP owners match session ${hits.join(",")}`);
	return hits[0];
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

	const generation = `packaged-reload-${randomUUID()}`;
	const app = await electronLauncher.launch({ executablePath: appExecutable,
		args: ["--user-data-dir", profile, "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
		env: { ...appEnv, CEDIA_APP_GENERATION: generation }, timeout: 45_000 });
	currentApp = app;
	const rawPage = await app.firstWindow() as unknown;
	if (!rawPage || typeof rawPage !== "object") throw new Error(`${failPrefix}: staged app returned no window`);
	const page = rawPage as { on(e: string, l: (err: Error) => void): void; getByRole(r: string, o?: Record<string, unknown>): { first(): { click(o?: unknown): Promise<void> } } };
	page.on("pageerror", (error: Error) => rendererErrors.push(error.message));
	try { await page.getByRole("button", { name: "Skip setup", exact: true }).first().click({ timeout: 15_000 }); } catch {}
	const shimEvents = (await readFile(lifecycleShimLog, "utf8")).trim().split("\n").map(line => JSON.parse(line));
	check(shimEvents.some((e: any) => e.event === "intercept-set-login-item") && shimEvents.some((e: any) => e.event === "simulated-login-state" && e.isPackaged === true), "scratch Login Item interception was observed");
	const firstHost = await waitFor("the packaged app to start its bundled host", readHost, 60_000);
	check(firstHost.identity.appGeneration === generation, "the packaged host records the staged app generation");
	const packagedHost: HostDescriptor = firstHost.descriptor;
	hostDescriptor = packagedHost;
	const project = object(await request(packagedHost, "POST", "/v1/projects", { path: workDir, name: PROJECT_NAME }), "created project");
	const session = object(await request(packagedHost, "POST", "/v1/sessions", { projectId: String(project.id ?? ""), title: TASK_TITLE }), "created task");
	sessionId = String(session.id ?? "");
	check(sessionId.length > 0, "task was created through the packaged host");
	const started = object(await request(packagedHost, "POST", `/v1/sessions/${sessionId}/start`, {}), "started task");
	check(started.status === "idle" || started.status === "running", `the packaged host starts its OMP owner (${String(started.status)})`);
	const incarnation = String(object(await request(packagedHost, "GET", `/v1/sessions/${sessionId}`, undefined), "task view").incarnation ?? "");
	check(incarnation.length > 0, "the task incarnation is readable");
	const pid = ownerPidForSession(sessionId);
	check(typeof pid === "number", "the packaged OMP owner PID is observable");

	const writeGeneration = async (source: string | null, label: string) => {
		if (source === null) await writeFile(fixturePath, "// fixture removed\n", { mode: 0o600 });
		else await writeFile(fixturePath, source, { mode: 0o600 });
		await delay(1300);
	};

	let commands = await commandNames(packagedHost, sessionId, incarnation);
	check(commands.has(commandName("a")), "generation A command loaded at startup through the packaged owner");
	let models = await sessionModelNames(packagedHost, sessionId, incarnation);
	check(models.has(`${PROVIDER}/${modelId("a")}`), "generation A provider/model loaded at startup through the packaged owner");
	check(models.has("cedia-packaged-reload-baseline/baseline-model"), "baseline row is present before reload");

	await writeGeneration(fixtureSource("b"), "B");
	const reloadB = await sendPrompt(packagedHost, sessionId, incarnation, "/reload-plugins", "reload-b");
	check(reloadB.status === "completed", "/reload-plugins for generation B completed");
	commands = await commandNames(packagedHost, sessionId, incarnation);
	check(commands.has(commandName("b")) && !commands.has(commandName("a")), "generation B atomically replaces generation A command");
	models = await sessionModelNames(packagedHost, sessionId, incarnation);
	check(models.has(`${PROVIDER}/${modelId("b")}`) && !models.has(`${PROVIDER}/${modelId("a")}`), "generation B replaces generation A in the packaged provider/model catalog");
	check(models.has("cedia-packaged-reload-baseline/baseline-model"), "reload preserves baseline models");
	check(ownerPidForSession(sessionId) === pid, "generation B reload keeps the same packaged OMP process PID");
	let stats = await sessionStats(packagedHost, sessionId, incarnation);
	check(stats.assistantMessages === 0 && stats.toolCalls === 0 && (stats.cost === 0 || stats.cost === "0"), "generation B reload caused no turn, tool call, or spend");

	await writeGeneration(brokenSource, "broken");
	const reloadBroken = await sendPrompt(packagedHost, sessionId, incarnation, "/reload-plugins", "reload-broken");
	check(reloadBroken.status === "failed", "throwing candidate reload fails instead of half-applying");
	commands = await commandNames(packagedHost, sessionId, incarnation);
	check(commands.has(commandName("b")) && !commands.has("hot-reload-packaged-broken"), "failed candidate retains last-good B command");
	models = await sessionModelNames(packagedHost, sessionId, incarnation);
	check(models.has(`${PROVIDER}/${modelId("b")}`), "failed candidate retains last-good B provider/model");
	check(ownerPidForSession(sessionId) === pid, "failed candidate rollback keeps the same packaged OMP process PID");

	await writeGeneration(null, "removal");
	const reloadRm = await sendPrompt(packagedHost, sessionId, incarnation, "/reload-plugins", "reload-remove");
	check(reloadRm.status === "completed", "removal reload completed");
	commands = await commandNames(packagedHost, sessionId, incarnation);
	check(!commands.has(commandName("a")) && !commands.has(commandName("b")), "removal leaves no fixture command");
	models = await sessionModelNames(packagedHost, sessionId, incarnation);
	check(!models.has(`${PROVIDER}/${modelId("a")}`) && !models.has(`${PROVIDER}/${modelId("b")}`), "removal clears fixture provider/models");
	check(models.has("cedia-packaged-reload-baseline/baseline-model"), "removal preserves baseline models");
	check(ownerPidForSession(sessionId) === pid, "removal keeps the same packaged OMP process PID");
	const view = object(await request(packagedHost, "GET", `/v1/sessions/${sessionId}`, undefined), "task view after removal");
	check(String(view.incarnation ?? "") === incarnation, "all transitions stay in one host session incarnation");

	let staleStatus = "";
	try {
		await request(packagedHost, "POST", `/v1/sessions/${sessionId}/commands`, { commandId: `packaged-reload-stale-${randomUUID()}`, incarnation, command: "prompt", payload: { message: `/${commandName("b")}`, cediaSelectedSlashCommand: commandName("b") } });
	} catch (error: any) { staleStatus = `${error.status ?? ""} ${JSON.stringify(error.body ?? "").slice(0, 200)}`; }
	check(/409/.test(staleStatus) && /no longer available|stale/i.test(staleStatus), `stale selected slash is refused with 409 before dispatch (${staleStatus.slice(0, 160)})`);
	stats = await sessionStats(packagedHost, sessionId, incarnation);
	check(stats.assistantMessages === 0 && stats.toolCalls === 0, "the whole packaged reload sequence caused no turn or tool call");
	check(rendererErrors.length === 0, `no renderer page errors (${JSON.stringify(rendererErrors.slice(0, 3))})`);
	const result = { ok: true, version: packagedRuntimeVersion, provider: `${PROVIDER}/*`,
		transitions: ["generation-A", "same-file-generation-B", "failed-candidate-kept-B", "removed", "stale-selected-slash-refused"],
		sessionCatalog: "propagated", pidFixed: true, incarnationFixed: true, providerCalls: 0 };
	await writeFile(join(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
	console.log(JSON.stringify(result, null, 2));
	proofPassed = true;
} catch (error) {
	await writeFile(join(output, "failure.json"), `${JSON.stringify({ error: String(error), rendererErrors: rendererErrors.slice(0, 10) }, null, 2)}\n`).catch(() => {});
	throw error;
} finally {
	try { if (sessionId && hostDescriptor) await request(hostDescriptor, "POST", `/v1/sessions/${sessionId}/stop`, {}).catch(() => {}); } catch {}
	await currentApp?.close?.().catch(() => {});
	const sweepDeadline = Date.now() + 15_000;
	while (Date.now() < sweepDeadline && pidsWith(appExecutable).length > 0) await delay(500);
	for (const stalePid of pidsWith(appExecutable)) { try { process.kill(stalePid, "SIGKILL"); } catch {} }
	await delay(2000);
	check(pidsWith(appExecutable).length === 0, "no staged app processes survive the proof");
	try {
		await rm(stagedExtensionDirectory, { recursive: true, force: true });
		await cp(originalStagedExtensionDirectory, stagedExtensionDirectory, { recursive: true });
		await rm(stagedAgentWindowDirectory, { recursive: true, force: true });
		await cp(originalStagedAgentWindowDirectory, stagedAgentWindowDirectory, { recursive: true });
		execFileSync("codesign", ["--force", "--deep", "--sign", "-", resolvedAppBundle], { stdio: "ignore" });
	} catch {}
	console.log(`PACKAGED-RELOAD: scratch=${scratch} output=${output} passed=${proofPassed}`);
}
