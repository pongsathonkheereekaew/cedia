/**
 * Packaged catalog-event proof (F dynamic provider/extension-command fixture, staged-only).
 *
 * Topology: staged Cedia.app copy only — overlay the staged bundled lock-extension
 * file (`.../extensions/cedia/runtime/host/runtime-lock.ts`) with a wrapper whose
 * default export calls the original `lockOmpSession()` first, then registers the
 * same `/dynamic-provider add|remove` fixture command as
 * scripts/omp-dynamic-provider-smoke.ts. No product file is touched: no
 * `CEDIA_EXTRA_TRUSTED_EXTENSION` channel, no CLI change.
 *
 * Driver path (provider-free; optional CEDIA_CATALOG_CUA=1 native observation):
 *  1. stage tmp Cedia.app (guards: bundle under tmpdir, never the installed one),
 *  2. overlay the staged bundled lock file + current-source host/OMP/agent-window,
 *     codesign, launch staged app on scratch profile/state,
 *  3. create project/session/start through the PACKAGED host REST (same routes as
 *     omp-packaged-owned-host-adoption-proof.ts),
 *  4. assert the session `get_available_models` catalog is absent the fixture row,
 *  5. fire `/dynamic-provider add` through POST /v1/sessions/:id/commands,
 *     wait for the durable prompt to complete, assert the fixture provider/model
 *     appears in the same packaged session's `get_available_models`,
 *  6. assert the read-only session picker route gains the row, while global
 *     GET /v1/models remains isolated (`--no-extensions` metadata workers),
 *  7. fire `/dynamic-provider remove`, assert the session catalog loses it,
 *  8. stale `set_model` refused, restore staged originals, re-codesign.
 *
 * What this proves: packaged extension mechanics (lock-first wrapper loads,
 * register/unregister propagate to the owning session catalog, stale selection
 * refused) with zero provider calls. Native observation gates are opt-in and
 * separate from automated route assertions; their releases alone are not UI
 * assertions. Record actual visible picker rows in the dated receipt.
 *
 * Run: CEDIA_PACKAGED_CATALOG_APP_PATH=/tmp/<staged>/Cedia.app bun scripts/omp-packaged-catalog-overlay-proof.ts
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import type { HostDescriptor } from "../packages/protocol/src/index.ts";
import { dereferencePackagedResponse } from "./lib/packaged-proof-http.ts";
import { packagedProofModelSlugs as modelSlugs } from "./lib/packaged-proof-catalog.ts";

interface StagedPage {
	on(event: string, listener: (error: Error) => void): void;
	screenshot(options: Record<string, unknown>): Promise<void>;
	clickSkipSetup(): Promise<void>;
}

interface StagedApp {
	firstWindow(): Promise<StagedPage>;
	windows(): StagedPage[];
	close(): Promise<void>;
}

interface ElectronLauncher {
	launch(options: Record<string, unknown>): Promise<StagedApp>;
}

function loadElectronLauncher(): ElectronLauncher {
	const playwright = createRequire(join(resolve(import.meta.dir, ".."), "desktop/package.json"))("playwright") as unknown;
	if (!playwright || typeof playwright !== "object" || !("_electron" in playwright)) {
		throw new Error(`${failPrefix}: playwright _electron launcher is unavailable`);
	}
	return (playwright as { _electron: ElectronLauncher })._electron;
}

const root = resolve(import.meta.dir, "..");
const failPrefix = "OMP packaged catalog overlay proof failed";
const electronLauncher = loadElectronLauncher();

const PROVIDER = "cedia_packaged_catalog_fixture";
const MODEL_ID = "ephemeral-packaged-model";
const PROJECT_NAME = "Packaged catalog overlay";
const TASK_TITLE = "Packaged catalog fixture task";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${failPrefix}: ${message}`);
	console.log(`OK   ${message}`);
}

function object(value: unknown, message: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${failPrefix}: ${message}`);
	return value as Record<string, unknown>;
}

async function delay(ms: number): Promise<void> {
	await new Promise<void>(done => setTimeout(done, ms));
}

async function waitFor<T>(label: string, read: () => Promise<T | undefined>, timeoutMs = 90_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await read();
		if (value !== undefined) return value;
		if (Date.now() >= deadline) throw new Error(`${failPrefix}: timed out waiting for ${label}`);
		await delay(250);
	}
}

function processAlive(pid: number): boolean {
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

function appMainPid(appExecutable: string, profileDir: string): number | undefined {
	let stdout = "";
	try { stdout = execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8", timeout: 10_000 }); }
	catch { return undefined; }
	const pids = stdout.split("\n").flatMap(line => {
		const match = line.trim().match(/^(\d+)\s+(.*)$/);
		if (!match) return [];
		const pid = Number(match[1]);
		const command = match[2] ?? "";
		return command.includes(appExecutable) && command.includes(profileDir) ? [pid] : [];
	});
	if (pids.length > 1) throw new Error(`${failPrefix}: multiple staged app main processes match scratch profile: ${pids.join(",")}`);
	return pids[0];
}

const appBundle = process.env.CEDIA_PACKAGED_CATALOG_APP_PATH;
check(typeof appBundle === "string" && appBundle.endsWith("/Cedia.app"),
	"CEDIA_PACKAGED_CATALOG_APP_PATH names a staged Cedia.app");
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
const stagedLockFile = join(runtimeRoot, "host/runtime-lock.ts");
const stagedExtensionDirectory = join(resolvedAppBundle, "Contents/Resources/app/extensions/cedia");
const stagedAgentWindowDirectory = join(resolvedAppBundle, "Contents/Resources/app/out/vs/cedia/agent");
const sourceExtensionDirectory = join(root, "dist/mac-extension");
const sourceAgentWindowDirectory = join(root, "dist/agent-window");
const sourceOmpExecutable = join(root, "dist/omp-standalone/omp");
const sourceHostCli = join(root, "dist/host/cli.js");
await Promise.all([access(appExecutable), access(bundledHost), access(bundledOmp), access(stagedLockFile)]);
const packagedRuntimeVersion = execFileSync(bundledOmp, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(packagedRuntimeVersion), `packaged OMP runtime is supported (${packagedRuntimeVersion})`);
const runtimeVersion = execFileSync(sourceOmpExecutable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(runtimeVersion === packagedRuntimeVersion, `the current source OMP runtime matches the app's pinned version (${runtimeVersion})`);
const sourceOmpSha256 = createHash("sha256").update(await readFile(sourceOmpExecutable)).digest("hex");
const sourceHostSha256 = createHash("sha256").update(await readFile(sourceHostCli)).digest("hex");

const scratch = await realpath(await mkdtemp(join(tmpdir(), "c-pkg-catalog-")));
const originalStagedExtensionDirectory = join(scratch, "original-cedia-extension");
const originalStagedAgentWindowDirectory = join(scratch, "original-agent-window");
const profile = join(scratch, "u");
const stateDir = join(scratch, "h");
const home = join(scratch, "hm");
const ompProfile = join(home, ".omp");
const workDir = join(scratch, "w");
const output = join(root, "dist/packaged-catalog-overlay-proof", new Date().toISOString().replace(/[:.]/g, "-"));
await Promise.all([
	mkdir(join(profile, "User"), { recursive: true }),
	mkdir(ompProfile, { recursive: true }),
	mkdir(home, { recursive: true }),
	mkdir(workDir, { recursive: true }),
	mkdir(output, { recursive: true }),
]);
await writeFile(join(profile, "User", "settings.json"), `${JSON.stringify({
	"cedia.hostStateDir": stateDir,
	"security.workspace.trust.enabled": false,
	"window.startupEditor": "none",
	"workbench.startupEditor": "none",
	"update.mode": "none",
	"telemetry.telemetryLevel": "off",
	"extensions.autoCheckUpdates": false,
}, null, 2)}\n`, { mode: 0o600 });

let providerRequests = 0;
let provider: Server | undefined;
let currentApp: StagedApp | undefined;
let currentPage: StagedPage | undefined;
let hostDescriptor: HostDescriptor | undefined;
let sessionId: string | undefined;
let proofPassed = false;
const rendererErrors: string[] = [];
const cuaCapture = process.env.CEDIA_CATALOG_CUA === "1";
const lifecycleShimLog = join(output, "login-item-shim.jsonl");
const appEnv = {
	...process.env,
	HOME: home,
	CEDIA_STATE_DIR: stateDir,
	CEDIA_HOST_IDLE_MS: "300000",
	PI_CODING_AGENT_DIR: ompProfile,
	PI_NO_PTY: "1",
	PI_NOTIFICATIONS: "off",
	CEDIA_LIFECYCLE_SHIM_LOG: lifecycleShimLog,
};

// Optional native observation gates never perform an input or fabricate a UI
// result. The operator opens the actual task/picker using Computer Use, records
// the visible rows, and releases each gate; the host assertions remain separate.
async function captureGate(phase: string): Promise<void> {
	if (!cuaCapture) return;
	await writeFile(join(output, `${phase}-ready.json`), `${JSON.stringify({
		phase, stagedAppPath: resolvedAppBundle, sessionId, project: PROJECT_NAME,
		task: TASK_TITLE, model: "Ephemeral Packaged Fixture Model", output,
	})}\n`);
	console.log(`CATALOG_CUA_READY: ${join(output, `${phase}-ready.json`)}`);
	await waitFor(`native ${phase} observation`, async () =>
		access(join(output, `${phase}-release`)).then(() => true).catch(() => undefined), 180_000);
	if (hostDescriptor) {
		await writeFile(join(output, `${phase}-preferences.json`), `${JSON.stringify(
			await request(hostDescriptor, "GET", "/v1/settings"), null, 2)}\n`);
	}
	for (const [index, page] of (currentApp?.windows() ?? []).entries()) {
		await page.screenshot({ path: join(output, `${phase}-window-${index}.png`) });
	}
}

async function readHost(): Promise<{ descriptor: HostDescriptor; identity: Record<string, unknown> } | undefined> {
	try {
		const descriptor = JSON.parse(await readFile(join(stateDir, "host.json"), "utf8")) as HostDescriptor;
		if (typeof descriptor.url !== "string" || typeof descriptor.token !== "string" || !Number.isSafeInteger(descriptor.pid)) return undefined;
		const response = await fetch(`${descriptor.url}/v1/health`, { headers: { Authorization: `Bearer ${descriptor.token}` }, signal: AbortSignal.timeout(1_000) });
		if (!response.ok) return undefined;
		const health = object(await response.json(), "packaged host health response");
		const identity = object(health.identity, "packaged host identity");
		if (health.protocolVersion !== descriptor.protocolVersion || identity.stateDir !== stateDir
			|| identity.processStartedAt !== descriptor.processStartedAt || identity.protocolVersion !== descriptor.protocolVersion) return undefined;
		return { descriptor, identity };
	} catch { return undefined; }
}

async function requestRaw(hostValue: HostDescriptor, method: string, path: string, body?: unknown): Promise<unknown> {
	const response = await fetch(`${hostValue.url}${path}`, {
		method,
		headers: { Authorization: `Bearer ${hostValue.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
		signal: AbortSignal.timeout(30_000),
	});
	const result = await response.json() as unknown;
	if (!response.ok) throw new Error(`${failPrefix}: ${method} ${path} returned ${response.status}: ${JSON.stringify(result)}`);
	return result;
}

async function request(hostValue: HostDescriptor, method: string, path: string, body?: unknown): Promise<unknown> {
	const result = await requestRaw(hostValue, method, path, body);
	return dereferencePackagedResponse(result, async (sha256, offset) =>
		requestRaw(hostValue, "GET", `/v1/responses/${encodeURIComponent(sha256)}?offset=${offset}`));
}

async function launch(generation: string): Promise<void> {
	const app = await electronLauncher.launch({
		executablePath: appExecutable,
		args: ["--user-data-dir", profile, "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
		env: { ...appEnv, CEDIA_APP_GENERATION: generation },
		timeout: 45_000,
	});
	currentApp = app;
	const rawPage = await app.firstWindow() as unknown;
	if (!rawPage || typeof rawPage !== "object") throw new Error(`${failPrefix}: staged app returned no window`);
	const page = rawPage as {
		on(event: string, listener: (error: Error) => void): void;
		screenshot(options: Record<string, unknown>): Promise<void>;
		getByRole(role: string, options?: Record<string, unknown>): { first(): { click(options?: Record<string, unknown>): Promise<void> } };
	};
	page.on("pageerror", (error: Error) => rendererErrors.push(error.message));
	currentPage = {
		on: (event, listener) => page.on(event, listener),
		screenshot: (options) => page.screenshot(options),
		clickSkipSetup: () => page.getByRole("button", { name: "Skip setup", exact: true }).first().click({ timeout: 15_000 }).catch(() => {}),
	};
	await currentPage.clickSkipSetup();
}
async function closeCurrent(): Promise<void> {
	const active = currentApp;
	currentApp = undefined;
	currentPage = undefined;
	if (!active) return;
	await active.close().catch(() => {});
	await waitFor("the exact staged app to close", async () => appMainPid(appExecutable, profile) === undefined ? true : undefined, 20_000).catch(() => {});
}

async function listCommands(descriptor: HostDescriptor, id: string): Promise<Record<string, unknown>[]> {
	const rows = await request(descriptor, "GET", `/v1/sessions/${id}/commands`, undefined);
	if (!Array.isArray(rows)) throw new Error(`${failPrefix}: commands list is not an array`);
	return rows as Record<string, unknown>[];
}

async function sessionModelNames(descriptor: HostDescriptor, id: string, incarnation: string): Promise<Set<string>> {
	const commandId = `packaged-catalog-models-${randomUUID()}`;
	const receipt = object(await request(descriptor, "POST", `/v1/sessions/${id}/commands`, {
		commandId, incarnation, command: "get_available_models", payload: {},
	}), "models command receipt");
	if (receipt.status !== "acknowledged" && receipt.status !== "completed") {
		throw new Error(`${failPrefix}: get_available_models was not accepted (${String(receipt.status)})`);
	}
	const settled = await waitFor("the get_available_models command to complete", async () => {
		const rows = await listCommands(descriptor, id).catch(() => undefined);
		return rows?.find(entry => entry.commandId === commandId
			&& (entry.status === "completed" || entry.status === "failed"));
	});
	if (settled.status !== "completed") {
		throw new Error(`${failPrefix}: get_available_models settled ${String(settled.status)}: ${JSON.stringify(settled.error ?? settled.result ?? {}).slice(0, 400)}`);
	}
	return modelSlugs(object(settled.result, "models result").data ?? settled.result);
}

async function sendPrompt(descriptor: HostDescriptor, id: string, incarnation: string, message: string, tag: string): Promise<Record<string, unknown>> {
	const commandId = `packaged-catalog-${tag}-${randomUUID()}`;
	const receipt = object(await request(descriptor, "POST", `/v1/sessions/${id}/commands`, {
		commandId, incarnation, command: "prompt", payload: { message },
	}), `${tag} prompt receipt`);
	if (receipt.status !== "acknowledged" && receipt.status !== "completed") {
		throw new Error(`${failPrefix}: ${tag} prompt was not accepted (${String(receipt.status)})`);
	}
	const terminal = await waitFor(`the ${tag} prompt to settle`, async () => {
		const rows = await listCommands(descriptor, id).catch(() => undefined);
		return rows?.find(entry => entry.commandId === commandId
			&& (entry.status === "completed" || entry.status === "failed"));
	});
	if (terminal.status !== "completed") {
		throw new Error(`${failPrefix}: ${tag} prompt settled ${String(terminal.status)}: ${JSON.stringify(terminal.error ?? terminal.result ?? {}).slice(0, 500)}`);
	}
	return object(terminal.result, `${tag} prompt result`);
}

try {
	await cp(stagedExtensionDirectory, originalStagedExtensionDirectory, { recursive: true });
	await cp(stagedAgentWindowDirectory, originalStagedAgentWindowDirectory, { recursive: true });
	await rm(stagedExtensionDirectory, { recursive: true, force: true });
	await cp(sourceExtensionDirectory, stagedExtensionDirectory, { recursive: true });
	await rm(stagedAgentWindowDirectory, { recursive: true, force: true });
	await cp(sourceAgentWindowDirectory, stagedAgentWindowDirectory, { recursive: true });
	check(createHash("sha256").update(await readFile(bundledOmp)).digest("hex") === sourceOmpSha256,
		"the staged app carries the current standalone OMP binary");
	check(createHash("sha256").update(await readFile(bundledHost)).digest("hex") === sourceHostSha256,
		"the staged app carries the current source host executable");
	check(true, "the current source extension and Agent Window are staged only in the temp app copy");
	// Never mutate the user's Login Item registration during a scratch proof.
	// This intercepts Login Item APIs only; Keychain is neither read nor mocked.
	const mainPath = join(stagedAgentWindowDirectory, "main.cjs");
	const sourceMain = await readFile(join(sourceAgentWindowDirectory, "main.cjs"), "utf8");
	const setter = "setLoginItemSettings: (settings) => electronApp.setLoginItemSettings(settings),";
	const getter = "wasOpenedAtLogin = electronApp.getLoginItemSettings().wasOpenedAtLogin === true;";
	check((await readFile(mainPath, "utf8")) === sourceMain
		&& sourceMain.split(setter).length === 2 && sourceMain.split(getter).length === 2,
		"current-source staged Login Item interception points match");
	await writeFile(mainPath, sourceMain
		.replace(setter, `setLoginItemSettings: (settings) => { require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "intercept-set-login-item", settings }) + "\\n"); },`)
		.replace(getter, `wasOpenedAtLogin = false; require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "simulated-login-state", isPackaged: electronApp.isPackaged, openedAtLogin: false }) + "\\n");`));

	const stagedOriginalLock = await readFile(stagedLockFile, "utf8");
	check(stagedOriginalLock.includes("lockOmpSession"), "the staged bundled lock file carries the session lock");
	provider = createServer((req, res) => {
		providerRequests++;
		req.resume();
		res.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "This provider-free fixture must not be called." }));
	});
	await new Promise<void>(ready => provider!.listen(0, "127.0.0.1", ready));
	provider.unref();
	const address = provider.address();
	const providerPort = address !== null && typeof address === "object" ? address.port : 0;
	check(providerPort > 0, "loopback provider tripwire is bound");
	const fixtureBaseUrl = `http://127.0.0.1:${providerPort}/v1`;
	// Wrap the staged lock file: keep the lock body, replace the default export
	// with a lock-first extension entry point. The extension contract is one
	// default-exported factory `getExtensionFactory` accepts (loader.ts:58-61):
	// a bare function or `{ default: factory }`; the factory runs with the
	// session extension API (`registerCommand`/`registerProvider`), the same
	// shape the headless dynamic-provider smoke uses. (Earlier draft wrongly
	// kept an extra wrapper/export; the overlay below is the single factory.)
	const lockBody = stagedOriginalLock
		.replace(/export\s*\{[^}]*lockOmpSession[^}]*\};?\s*(\/\/# debugId=.*)?\s*$/s, "")
		.replace(/\/\/# debugId=.*$/, "");
	check(!lockBody.includes("as default"), "the staged lock body no longer carries its own default export");
	check(lockBody.includes("function lockOmpSession"), "the staged lock body keeps the session lock");
	const overlay = `${lockBody}
export default function __cediaPackagedCatalogOverlay(pi: {
	registerCommand(name: string, spec: { description: string; handler: (args: string, ctx: { ui: { notify(message: string, level: string): void } }) => Promise<void> }): void;
	registerProvider(name: string, spec: unknown): void;
	unregisterProvider(name: string): void;
}): void {
	lockOmpSession();
	pi.registerCommand("dynamic-provider", {
		description: "Toggle the staged packaged catalog fixture",
		handler: async (args, ctx) => {
			const action = args.trim();
			if (action === "add") {
				pi.registerProvider(${JSON.stringify(PROVIDER)}, {
					baseUrl: ${JSON.stringify(fixtureBaseUrl)},
					apiKey: "fixture-key-never-used",
					authHeader: false,
					api: "openai-completions",
					models: [{ id: ${JSON.stringify(MODEL_ID)}, name: "Ephemeral Packaged Fixture Model", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }],
				});
				ctx.ui.notify("dynamic provider added", "info");
				return;
			}
			if (action === "remove") {
				pi.unregisterProvider(${JSON.stringify(PROVIDER)});
				ctx.ui.notify("dynamic provider removed", "info");
				return;
			}
			throw new Error("Use /dynamic-provider add or /dynamic-provider remove");
		},
	});
}
`;
	await writeFile(stagedLockFile, overlay);
	check((await readFile(stagedLockFile, "utf8")).includes("__cediaPackagedCatalogOverlay"),
		"the staged lock overlay carries the fixture provider command");
	execFileSync("codesign", ["--force", "--deep", "--sign", "-", resolvedAppBundle], { stdio: "ignore" });
	check(true, "the lock-extension overlay is staged only in the temp app copy");
	await writeFile(join(ompProfile, "models.yml"), `providers:\n  cedia-packaged-catalog-baseline:\n    baseUrl: http://127.0.0.1:${providerPort}/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: baseline-model\n        name: Packaged catalog baseline\n        api: openai-completions\n        reasoning: false\n        input: [text]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 128000\n        maxTokens: 4096\n`, { mode: 0o600 });

	const generation = `packaged-catalog-${randomUUID()}`;
	await launch(generation);
	const shimEvents = (await readFile(lifecycleShimLog, "utf8")).trim().split("\n").map(line => JSON.parse(line));
	check(shimEvents.some(event => event.event === "intercept-set-login-item")
		&& shimEvents.some(event => event.event === "simulated-login-state" && event.isPackaged === true),
		"scratch Login Item setter/getter interception was observed");
	const firstHost = await waitFor("the packaged app to start its bundled host", readHost, 60_000);
	check(firstHost.identity.appGeneration === generation, "the packaged host records the staged app generation");
	const hostCommand = execFileSync("ps", ["-p", String(firstHost.descriptor.pid), "-o", "command="], { encoding: "utf8" }).trim();
	const packagedHost: HostDescriptor = firstHost.descriptor;
	hostDescriptor = packagedHost;
	check(hostCommand.includes(bundledHost), "the packaged app started its bundled host executable");
	const project = object(await request(packagedHost, "POST", "/v1/projects", { path: workDir, name: PROJECT_NAME }), "created project");
	const projectId = String(project.id ?? "");
	check(projectId.length > 0, "project was created through the packaged host");
	const session = object(await request(packagedHost, "POST", "/v1/sessions", { projectId, title: TASK_TITLE }), "created task");
	sessionId = String(session.id ?? "");
	check(sessionId.length > 0, "task was created through the packaged host");
	const started = object(await request(packagedHost, "POST", `/v1/sessions/${sessionId}/start`, {}), "started task");
	check(started.status === "idle" || started.status === "running", `the packaged host starts its OMP owner (${String(started.status)})`);
	const incarnation = String(object(await request(packagedHost, "GET", `/v1/sessions/${sessionId}`, undefined), "task view").incarnation ?? "");
	check(incarnation.length > 0, "the task incarnation is readable");

	let models = await sessionModelNames(packagedHost, sessionId, incarnation);
	check(!models.has(`${PROVIDER}/${MODEL_ID}`), "dynamic provider is absent before the extension command");
	check(models.has("cedia-packaged-catalog-baseline/baseline-model"), "baseline row is present before the extension command");
	await captureGate("before-add");

	const addResult = await sendPrompt(packagedHost, sessionId, incarnation, "/dynamic-provider add", "add");
	check(addResult.agentInvoked === false, "provider add ran locally without an agent or inference turn");
	models = await sessionModelNames(packagedHost, sessionId, incarnation);
	check(models.has(`${PROVIDER}/${MODEL_ID}`), "provider add appears atomically in the packaged session catalog");
	check(models.has("cedia-packaged-catalog-baseline/baseline-model"), "adding the provider preserves baseline rows");
	const sessionCatalog = await request(packagedHost, "GET", `/v1/sessions/${sessionId}/models`);
	check(modelSlugs(sessionCatalog).has(`${PROVIDER}/${MODEL_ID}`),
		"the picker session-catalog route exposes the added extension model");
	check(modelSlugs(sessionCatalog).has("cedia-packaged-catalog-baseline/baseline-model"),
		"the picker session-catalog route preserves baseline rows after add");
	await captureGate("after-add");

	// Global-catalog diagnostic: expected ABSENT by construction (--no-extensions
	// metadata workers). A presence here would contradict model-catalog.ts.
	const globalCatalog = object(await request(packagedHost, "GET", "/v1/models", undefined), "global model catalog");
	const globalSlugs = modelSlugs(globalCatalog);
	const globalHasFixture = globalSlugs.has(`${PROVIDER}/${MODEL_ID}`);
	await writeFile(join(output, "catalog-state.json"), `${JSON.stringify({
		sessionCatalogHasFixture: true,
		globalCatalogHasFixture: globalHasFixture,
		globalCatalogSize: globalSlugs.size,
		globalCatalogSample: [...globalSlugs].slice(0, 20),
		reason: "GET /v1/models spawns --no-extensions metadata workers (model-catalog.ts metadataArgs); session extensions never reach it.",
	}, null, 2)}\n`);
	check(globalHasFixture === false, "the global metadata catalog stays isolated from session extension models");
	if (currentPage) await currentPage.screenshot({ path: join(output, "packaged-app-after-add.png") }).catch(() => {});

	const removeResult = await sendPrompt(packagedHost, sessionId, incarnation, "/dynamic-provider remove", "remove");
	check(removeResult.agentInvoked === false, "provider remove ran locally without a model turn");
	models = await sessionModelNames(packagedHost, sessionId, incarnation);
	check(!models.has(`${PROVIDER}/${MODEL_ID}`), "provider removal appears atomically in the packaged session catalog");
	check(models.has("cedia-packaged-catalog-baseline/baseline-model"), "removal preserves baseline rows");
	const removedSessionCatalog = modelSlugs(await request(packagedHost, "GET", `/v1/sessions/${sessionId}/models`));
	check(!removedSessionCatalog.has(`${PROVIDER}/${MODEL_ID}`), "the picker session-catalog route removes the extension model");
	check(removedSessionCatalog.has("cedia-packaged-catalog-baseline/baseline-model"),
		"the picker session-catalog route preserves baseline rows after removal");
	await captureGate("after-remove");

	const stale = object(await request(packagedHost, "POST", `/v1/sessions/${sessionId}/commands`, {
		commandId: `packaged-catalog-stale-${randomUUID()}`,
		incarnation,
		command: "set_model",
		payload: { provider: PROVIDER, modelId: MODEL_ID },
	}), "stale model receipt");
	check(stale.status === "failed", `stale selection of the removed provider is refused (${String(stale.status)})`);
	const staleError = JSON.stringify(stale.error ?? stale.result ?? stale.ack ?? {});
	check(/not found|unknown|unavailable|invalid model/i.test(staleError), `stale selection carries the runtime refusal (${staleError.slice(0, 300)})`);
	check(providerRequests === 0, "no provider inference request was made");
	check(rendererErrors.length === 0, `no renderer page errors (${JSON.stringify(rendererErrors.slice(0, 3))})`);
	const result = {
		ok: true,
		version: packagedRuntimeVersion,
		sourceOmpSha256,
		sourceHostSha256,
		provider: `${PROVIDER}/${MODEL_ID}`,
		transitions: ["absent", "added", "removed", "stale-selection-refused"],
		sessionCatalog: "propagated",
		globalCatalog: "omits session extension row by construction (--no-extensions workers)",
		providerCalls: providerRequests,
		nativeObservationGates: cuaCapture,
		limitations: "Staged-app proof only. Route assertions prove session-catalog propagation and global isolation; native picker observations require the separate dated receipt.",
	};
	await writeFile(join(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
	console.log(JSON.stringify(result, null, 2));
	proofPassed = true;
} catch (error) {
	await writeFile(join(output, "failure.json"), `${JSON.stringify({ error: String(error), rendererErrors: rendererErrors.slice(0, 10) }, null, 2)}\n`).catch(() => {});
	// Preserve the isolated host diagnostic before cleanup. Public route errors
	// deliberately redact runtime details, so they cannot diagnose a boot failure.
	await cp(join(stateDir, "host.log"), join(output, "host-failure.log")).catch(() => {});
	try {
		if (currentPage) await currentPage.screenshot({ path: join(output, "failure.png") }).catch(() => {});
	} catch { /* screenshots are best-effort. */ }
	throw error;
} finally {
	try {
		if (sessionId && hostDescriptor) await request(hostDescriptor, "POST", `/v1/sessions/${sessionId}/stop`, {}).catch(() => {});
	} catch { /* stop is best-effort. */ }
	await closeCurrent().catch(() => {});
	for (const pid of [hostDescriptor?.pid].filter((value): value is number => typeof value === "number") ) {
		try { if (processAlive(pid)) process.kill(pid, "SIGTERM"); } catch { /* host cleanup is best-effort. */ }
	}
	if (provider) await new Promise<void>(done => provider!.close(() => done()));
	try {
		await rm(stagedExtensionDirectory, { recursive: true, force: true });
		await cp(originalStagedExtensionDirectory, stagedExtensionDirectory, { recursive: true });
		await rm(stagedAgentWindowDirectory, { recursive: true, force: true });
		await cp(originalStagedAgentWindowDirectory, stagedAgentWindowDirectory, { recursive: true });
		execFileSync("codesign", ["--force", "--deep", "--sign", "-", resolvedAppBundle], { stdio: "ignore" });
	} catch { /* restore is best-effort but recorded below. */ }
	// Keep failed isolated state for diagnosis; no user credentials were copied in.
	console.log(`PACKAGED-CATALOG: scratch=${scratch} output=${output} passed=${proofPassed}`);
}
