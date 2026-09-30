/**
 * Provider-free native proof of the packaged OMP settings editor's revision-safe write.
 *
 * The route half starts the real bundled OMP owner in an explicitly staged Cedia.app copy,
 * reads the live inventory/value, and creates a second-client CAS write.  The optional native
 * half is deliberately operator-driven: Computer Use opens the actual `AI / OMP settings` page,
 * edits `defaultThinkingLevel`, observes the stale conflict row, then refreshes and retries.
 * This script never clicks, types, evaluates DOM callbacks, or fabricates a UI result.
 *
 * Run (with native observation):
 *   CEDIA_PACKAGED_SETTINGS_APP_PATH=/var/.../Cedia.app CEDIA_SETTINGS_CUA=1 \
 *     bun scripts/omp-packaged-settings-conflict-proof.ts
 *
 * The three bounded gates each wait at most ten minutes.  The script prints CUA_PREP_READY,
 * CUA_STALE_READY, and CUA_RETRY_READY together with the release paths recorded in each ready
 * JSON file.  Route-only runs can omit CEDIA_SETTINGS_CUA=1; their receipt explicitly says that
 * native UI acceptance was not observed.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import {
	access,
	cp,
	mkdtemp,
	mkdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import type { HostDescriptor } from "../packages/protocol/src/index.ts";
import { dereferencePackagedResponse } from "./lib/packaged-proof-http.ts";
import { installElectronWindowMonitor, type ElectronWindowMonitor } from "./lib/packaged-shared-state-window-monitor.ts";
import {
	chooseSafeOmpConflictPlan,
	isOmpSettingsStaleResponse,
	observesOmpStaleConflict,
	SAFE_OMP_SETTING_PATH,
	type OmpProofSettingKey,
	type OmpProofSettingValue,
	type OmpSettingsConflictPlan,
} from "./lib/packaged-settings-conflict.ts";

const root = resolve(import.meta.dir, "..");
const failPrefix = "OMP packaged settings conflict proof failed";
const nativeGateTimeoutMs = 10 * 60 * 1_000;
const hostRequestTimeoutMs = 30_000;
const captureNative = process.env.CEDIA_SETTINGS_CUA === "1" || process.env.CEDIA_PACKAGED_SETTINGS_CUA === "1";

type JsonObject = Record<string, unknown>;
type RouteResponse = { readonly status: number; readonly body: unknown };

interface StagedPage {
	readonly locator: (selector: string) => any;
	readonly frames?: () => any[];
	readonly title?: () => Promise<string>;
	readonly url?: () => string;
	readonly screenshot?: (options: Record<string, unknown>) => Promise<void>;
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
	const playwright = createRequire(join(root, "desktop/package.json"))("playwright") as unknown;
	if (!playwright || typeof playwright !== "object" || !("_electron" in playwright)) {
		throw new Error(`${failPrefix}: playwright _electron launcher is unavailable`);
	}
	return (playwright as { _electron: ElectronLauncher })._electron;
}

const electronLauncher = loadElectronLauncher();

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${failPrefix}: ${message}`);
	console.log(`OK   ${message}`);
}

function object(value: unknown, message: string): JsonObject {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${failPrefix}: ${message}`);
	return value as JsonObject;
}

function textField(value: unknown, key: string, message: string): string {
	const result = object(value, message)[key];
	if (typeof result !== "string") throw new Error(`${failPrefix}: ${message} has no string ${key}`);
	return result;
}

function checkStatus(response: RouteResponse, method: string, path: string): void {
	check(response.status >= 200 && response.status < 300, `${method} ${path} succeeds (HTTP ${response.status})`);
}

const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));

async function waitFor<T>(label: string, read: () => Promise<T | undefined>, timeoutMs = 60_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await read();
		if (value !== undefined) return value;
		if (Date.now() >= deadline) throw new Error(`${failPrefix}: timed out waiting for ${label}`);
		await sleep(200);
	}
}

async function waitForPath(path: string, timeoutMs: number): Promise<void> {
	await waitFor(path, async () => access(path).then(() => true).catch(() => undefined), timeoutMs);
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function scratchProcessPids(appExecutable: string, profile: string): number[] {
	try {
		return execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" })
			.split("\n")
			.flatMap(line => {
				const match = line.trim().match(/^(\d+)\s+(.*)$/);
				if (!match) return [];
				const pid = Number(match[1]);
				return match[2]?.includes(appExecutable) && match[2].includes(profile) ? [pid] : [];
			});
	} catch {
		return [];
	}
}

function appMainPid(appExecutable: string, profile: string): number | undefined {
	const pids = scratchProcessPids(appExecutable, profile);
	if (pids.length > 1) throw new Error(`${failPrefix}: multiple staged app processes match scratch profile: ${pids.join(",")}`);
	return pids[0];
}

async function observePage(page: StagedPage): Promise<JsonObject> {
	const bodyText = await page.locator("body").innerText().catch(() => "");
	const frames = typeof page.frames === "function" ? page.frames() : [page];
	const frameObservations = await Promise.all(frames.map(async (frame: any) => {
		const text = await frame.locator("body").innerText().catch(() => "");
		const editors = await frame.locator('[aria-label^="Edit "]').evaluateAll((nodes: Element[]) => nodes.map(node => ({
			ariaLabel: node.getAttribute("aria-label"),
			value: (node as HTMLInputElement).value,
			text: (node as HTMLElement).innerText,
		}))).catch(() => []);
		let frameUrl = "";
		try {
			const value = frame.url();
			frameUrl = typeof value === "string" ? value : String(value);
		} catch { /* a frame may close while the app switches windows */ }
		return { url: frameUrl, text: typeof text === "string" ? text.slice(0, 16_000) : "", editors };
	}));
	let pageUrl = "";
	try {
		const value = page.url?.();
		pageUrl = typeof value === "string" ? value : String(value ?? "");
	} catch { /* page can disappear during cleanup */ }
	const title = typeof page.title === "function" ? await page.title().catch(() => "") : "";
	return {
		url: pageUrl,
		title,
		bodyText: typeof bodyText === "string" ? bodyText.slice(0, 16_000) : "",
		frames: frameObservations,
	};
}

async function observeAllPages(application: StagedApp): Promise<JsonObject[]> {
	return Promise.all(application.windows().map(page => observePage(page)));
}

function isAvailableBody(body: unknown): body is JsonObject {
	return Boolean(body && typeof body === "object" && !Array.isArray(body) && (body as JsonObject).state === "available");
}

const appInput = process.env.CEDIA_PACKAGED_SETTINGS_APP_PATH;
check(typeof appInput === "string" && appInput.endsWith("/Cedia.app"),
	"CEDIA_PACKAGED_SETTINGS_APP_PATH names an explicitly staged Cedia.app");
const requestedAppPath = resolve(appInput);
check(requestedAppPath.startsWith("/var/") || requestedAppPath.startsWith("/private/var/"),
	"the staged app path is a literal /var scratch path");
const stagedAppPath = await realpath(requestedAppPath);
const tempRoot = await realpath(tmpdir());
check(stagedAppPath.startsWith(`${tempRoot}/`), `the staged app resides under the actual temporary directory (${tempRoot})`);
const installedAppPath = resolve(join(root, `VSCode-darwin-${process.arch}/Cedia.app`));
check(stagedAppPath !== installedAppPath && !stagedAppPath.startsWith(`${installedAppPath}/`),
	"the repository's installed Cedia.app is never launched or modified");

const appExecutable = join(stagedAppPath, "Contents/MacOS/Cedia");
const runtimeRoot = join(stagedAppPath, "Contents/Resources/app/extensions/cedia/runtime");
const bundledHost = join(runtimeRoot, "host/cli.js");
const bundledOmp = join(runtimeRoot, "omp/omp");
const stagedExtensionDirectory = join(stagedAppPath, "Contents/Resources/app/extensions/cedia");
const stagedAgentWindowDirectory = join(stagedAppPath, "Contents/Resources/app/out/vs/cedia/agent");
const stagedLifecycleModule = join(stagedAgentWindowDirectory, "main.cjs");
const sourceExtensionDirectory = join(root, "dist/mac-extension");
const sourceAgentWindowDirectory = join(root, "dist/agent-window");
const sourceOmpExecutable = join(root, "dist/omp-standalone/omp");
const sourceHostCli = join(root, "dist/host/cli.js");
await Promise.all([access(appExecutable), access(bundledHost), access(bundledOmp), access(stagedLifecycleModule)]);

const packagedRuntimeVersion = execFileSync(bundledOmp, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(packagedRuntimeVersion), `packaged OMP runtime is supported (${packagedRuntimeVersion})`);
const sourceRuntimeVersion = execFileSync(sourceOmpExecutable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(sourceRuntimeVersion === packagedRuntimeVersion, `the current source OMP runtime matches the app's pinned version (${sourceRuntimeVersion})`);
const sourceOmpSha256 = createHash("sha256").update(await readFile(sourceOmpExecutable)).digest("hex");
const sourceHostSha256 = createHash("sha256").update(await readFile(sourceHostCli)).digest("hex");
const sourceAgentWindowSha256 = createHash("sha256").update(await readFile(join(sourceAgentWindowDirectory, "main.cjs"))).digest("hex");

// Darwin's AF_UNIX limit includes the user-data-dir path.  Keep this fixture path
// intentionally short (`c-os-…/u`) so the real Electron IPC bootstrap can start.
const scratch = await realpath(await mkdtemp(join(tmpdir(), "c-os-")));
const profile = join(scratch, "u");
const home = join(scratch, "h");
const stateDir = join(scratch, "s");
const ompProfile = join(home, ".omp");
const workDir = join(scratch, "w");
const output = join(root, "dist/packaged-settings-conflict-proof", new Date().toISOString().replace(/[:.]/g, "-"));
const shimLogPath = join(output, "login-item-shim.jsonl");
const rendererConsolePath = join(output, "renderer-console.jsonl");
await Promise.all([
	mkdir(join(profile, "User"), { recursive: true }),
	mkdir(home, { recursive: true }),
	mkdir(ompProfile, { recursive: true }),
	mkdir(workDir, { recursive: true }),
	mkdir(join(scratch, "t"), { recursive: true }),
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
let browser: StagedApp | undefined;
let hostDescriptor: HostDescriptor | undefined;
let projectId: string | undefined;
let sessionId: string | undefined;
let stagedExtensionBackup: string | undefined;
let stagedAgentBackup: string | undefined;
let lifecyclePatched = false;
let proofPassed = false;
let outputResult: JsonObject = {};
const rendererErrors: string[] = [];
const windowMonitors: ElectronWindowMonitor[] = [];

const appEnv = {
	...process.env,
	HOME: home,
	USERPROFILE: home,
	TMPDIR: join(scratch, "t"),
	CEDIA_STATE_DIR: stateDir,
	CEDIA_HOST_NODE: process.env.CEDIA_HOST_NODE ?? "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node",
	CEDIA_HOST_REQUEST_TIMEOUT_MS: "180000",
	CEDIA_HOST_IDLE_MS: "300000",
	CEDIA_LIFECYCLE_SHIM_LOG: shimLogPath,
	CEDIA_SIMULATE_LOGIN: "0",
	PI_CODING_AGENT_DIR: ompProfile,
	PI_NO_PTY: "1",
	PI_NOTIFICATIONS: "off",
};

async function readPackagedHost(): Promise<{ readonly descriptor: HostDescriptor; readonly identity: JsonObject } | undefined> {
	try {
		const descriptor = JSON.parse(await readFile(join(stateDir, "host.json"), "utf8")) as HostDescriptor;
		if (typeof descriptor.url !== "string" || typeof descriptor.token !== "string" || !Number.isSafeInteger(descriptor.pid)) return undefined;
		const response = await fetch(`${descriptor.url}/v1/health`, {
			headers: { Authorization: `Bearer ${descriptor.token}` },
			signal: AbortSignal.timeout(1_000),
		});
		if (!response.ok) return undefined;
		const health = object(await response.json(), "packaged host health response");
		const identity = object(health.identity, "packaged host identity");
		if (health.protocolVersion !== descriptor.protocolVersion || identity.stateDir !== stateDir
			|| identity.processStartedAt !== descriptor.processStartedAt || identity.protocolVersion !== descriptor.protocolVersion) return undefined;
		return { descriptor, identity };
	} catch {
		return undefined;
	}
}

async function requestRaw(host: HostDescriptor, method: string, path: string, body?: unknown): Promise<RouteResponse> {
	const response = await fetch(`${host.url}${path}`, {
		method,
		headers: { Authorization: `Bearer ${host.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
		signal: AbortSignal.timeout(hostRequestTimeoutMs),
	});
	const raw = await response.text();
	let parsed: unknown = null;
	try { parsed = raw.length > 0 ? JSON.parse(raw) : null; } catch { parsed = raw; }
	return { status: response.status, body: parsed };
}

async function request(host: HostDescriptor, method: string, path: string, body?: unknown): Promise<RouteResponse> {
	const response = await requestRaw(host, method, path, body);
	const dereferenced = await dereferencePackagedResponse(response.body, async (sha256, offset) => {
		const chunk = await requestRaw(host, "GET", `/v1/responses/${encodeURIComponent(sha256)}?offset=${offset}`);
		check(chunk.status === 200, `chunk ${sha256.slice(0, 12)}@${offset} is readable (HTTP ${chunk.status})`);
		return chunk.body;
	});
	return { status: response.status, body: dereferenced };
}

async function expectOk(host: HostDescriptor, method: string, path: string, body?: unknown): Promise<JsonObject> {
	const response = await request(host, method, path, body);
	checkStatus(response, method, path);
	return object(response.body, `${method} ${path} response`);
}

async function settingsInventory(host: HostDescriptor): Promise<JsonObject | undefined> {
	const response = await request(host, "GET", "/v1/omp/settings/keys");
	if (response.status !== 200 || !isAvailableBody(response.body)) return undefined;
	return object(response.body, "OMP settings inventory");
}

async function settingsValue(host: HostDescriptor, path: string): Promise<OmpProofSettingValue | undefined> {
	const response = await request(host, "GET", `/v1/omp/settings/value?path=${encodeURIComponent(path)}`);
	if (response.status !== 200 || !isAvailableBody(response.body)) return undefined;
	return response.body as unknown as OmpProofSettingValue;
}

async function nativeGate(
	phase: string,
	payload: JsonObject,
): Promise<void> {
	if (!captureNative) return;
	const readyPath = join(output, `${phase}-ready.json`);
	const releasePath = join(output, `${phase}-release`);
	await writeFile(readyPath, `${JSON.stringify({
		phase,
		stagedAppPath,
		output,
		timeoutMs: nativeGateTimeoutMs,
		releasePath,
		...payload,
	}, null, 2)}\n`, { mode: 0o600 });
	console.log(`CUA_${phase.toUpperCase()}_READY: ${readyPath}`);
	console.log(`CUA_${phase.toUpperCase()}_RELEASE: touch ${releasePath}`);
	await waitForPath(releasePath, nativeGateTimeoutMs);
}

async function launch(): Promise<StagedPage> {
	const app = await electronLauncher.launch({
		executablePath: appExecutable,
		args: ["--user-data-dir", profile, "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
		env: appEnv,
		timeout: 45_000,
	});
	browser = app;
	// Install before firstWindow(): the monitor sees the first renderer and any IDE/auxiliary
	// window event through one deduplicated path.
	windowMonitors.push(installElectronWindowMonitor(app, {
		errors: rendererErrors,
		consolePath: rendererConsolePath,
		label: "packaged-settings",
	}));
	const page = await app.firstWindow();
	check(appMainPid(appExecutable, profile) !== undefined, "the staged app main process owns the scratch profile");
	await waitFor("the packaged Agents document", async () => {
		const observation = await observePage(page);
		return typeof observation.bodyText === "string" && observation.bodyText.length > 0 ? observation : undefined;
	}, 45_000);
	return page;
}

try {
	stagedExtensionBackup = join(scratch, "original-cedia-extension");
	stagedAgentBackup = join(scratch, "original-agent-window");
	await cp(stagedExtensionDirectory, stagedExtensionBackup, { recursive: true });
	await cp(stagedAgentWindowDirectory, stagedAgentBackup, { recursive: true });

	// Use the current built UI/adapter only inside the explicitly staged app copy.  The
	// standalone OMP binary remains the app's real bundled runtime and is hash-checked below.
	await rm(stagedExtensionDirectory, { recursive: true, force: true });
	await cp(sourceExtensionDirectory, stagedExtensionDirectory, { recursive: true });
	await rm(stagedAgentWindowDirectory, { recursive: true, force: true });
	await cp(sourceAgentWindowDirectory, stagedAgentWindowDirectory, { recursive: true });
	check(createHash("sha256").update(await readFile(join(stagedAgentWindowDirectory, "main.cjs"))).digest("hex") === sourceAgentWindowSha256,
		"the staged Agent Window main process matches the current source build");
	check(createHash("sha256").update(await readFile(join(runtimeRoot, "host/cli.js"))).digest("hex") === sourceHostSha256,
		"the staged app carries the current source host executable");
	check(createHash("sha256").update(await readFile(join(runtimeRoot, "omp/omp"))).digest("hex") === sourceOmpSha256,
		"the staged app carries the current standalone OMP binary");
	check(execFileSync(join(runtimeRoot, "omp/omp"), ["--version"], { encoding: "utf8", timeout: 20_000 }).trim() === packagedRuntimeVersion,
		"the staged app's bundled OMP reports the pinned version after staging");

	// Hash-verified Login Item shim: only the temp app copy is patched, and no
	// Keychain API is read, mocked, or cleared by this proof.
	const sourceLifecycleModule = await readFile(join(sourceAgentWindowDirectory, "main.cjs"), "utf8");
	const stagedLifecycleSource = await readFile(stagedLifecycleModule, "utf8");
	check(createHash("sha256").update(stagedLifecycleSource).digest("hex") === sourceAgentWindowSha256,
		"the staged Login Item module is hash-verified before interception");
	const setterNeedle = "setLoginItemSettings: (settings) => electronApp.setLoginItemSettings(settings),";
	const getterNeedle = "wasOpenedAtLogin = electronApp.getLoginItemSettings().wasOpenedAtLogin === true;";
	check(sourceLifecycleModule.split(setterNeedle).length === 2 && sourceLifecycleModule.split(getterNeedle).length === 2,
		"the reviewed Login Item interception points are present exactly once");
	const patchedLifecycle = sourceLifecycleModule
		.replace(setterNeedle, `setLoginItemSettings: (settings) => { require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "intercept-set-login-item", settings }) + "\\n"); },`)
		.replace(getterNeedle, `wasOpenedAtLogin = false; require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "simulated-login-state", isPackaged: electronApp.isPackaged, openedAtLogin: false }) + "\\n");`);
	check(patchedLifecycle !== sourceLifecycleModule, "the scratch Login Item shim changes only the reviewed calls");
	await writeFile(stagedLifecycleModule, patchedLifecycle);
	lifecyclePatched = true;
	execFileSync("codesign", ["--force", "--deep", "--sign", "-", stagedAppPath], { stdio: "ignore" });
	check(true, "the Login Item interception is staged only in the /var app copy");

	provider = createServer((request, response) => {
		providerRequests++;
		request.resume();
		response.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "This provider-free fixture must not be called." }));
	});
	await new Promise<void>(ready => provider!.listen(0, "127.0.0.1", ready));
	provider.unref();
	const providerAddress = provider.address();
	const providerPort = providerAddress !== null && typeof providerAddress === "object" ? providerAddress.port : 0;
	check(providerPort > 0, "the loopback provider tripwire is bound");
	await writeFile(join(ompProfile, "models.yml"), `providers:\n  cedia-settings-baseline:\n    baseUrl: http://127.0.0.1:${providerPort}/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: cedia-settings-baseline-model\n        name: Packaged settings baseline\n        api: openai-completions\n        reasoning: false\n        input: [text]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 128000\n        maxTokens: 4096\n`, { mode: 0o600 });

	const page = await launch();
	check(browser !== undefined && browser.windows().length >= 1, "the staged app exposes a native Agents window");
	await waitForPath(shimLogPath, 30_000);
	const shimEvents = (await readFile(shimLogPath, "utf8")).trim().split("\n").filter(Boolean).map(line => object(JSON.parse(line), "Login Item shim event"));
	check(shimEvents.some(event => event.event === "intercept-set-login-item"), "packaged Login Item writes were intercepted by the scratch shim");
	check(shimEvents.some(event => event.event === "simulated-login-state" && event.isPackaged === true && event.openedAtLogin === false),
		"the scratch run uses a simulated packaged, non-login state");

	const host = await waitFor("the packaged app to start its bundled host", readPackagedHost, 60_000);
	hostDescriptor = host.descriptor;
	const generationCommand = execFileSync("ps", ["-p", String(host.descriptor.pid), "-o", "command="], { encoding: "utf8" }).trim();
	check(generationCommand.includes(bundledHost), "the packaged app started its bundled host executable");
	const project = await expectOk(host.descriptor, "POST", "/v1/projects", { path: workDir, name: "Packaged OMP settings proof" });
	projectId = textField(project, "id", "created project");
	const session = await expectOk(host.descriptor, "POST", "/v1/sessions", { projectId, title: "OMP settings conflict task" });
	sessionId = textField(session, "id", "created task");
	check(sessionId.length > 0, "a packaged task is registered through the live host");
	const started = await expectOk(host.descriptor, "POST", `/v1/sessions/${sessionId}/start`, {});
	check(started.status === "idle" || started.status === "running", `the packaged host starts its real OMP owner (${String(started.status)})`);

	const inventory = await waitFor("the live OMP settings inventory", async () => settingsInventory(host.descriptor), 120_000);
	const keys = Array.isArray(inventory.keys) ? inventory.keys : [];
	check(keys.length > 0, `the settings inventory comes from the live bundled OMP (${keys.length} keys)`);
	const targetKey = object(keys.find((candidate: unknown) => object(candidate, "OMP setting key").path === SAFE_OMP_SETTING_PATH), "target OMP setting key");
	check(targetKey.disposition === "editable", `${SAFE_OMP_SETTING_PATH} is exposed as an editable UI row`);
	const initialValue = await waitFor(`the live ${SAFE_OMP_SETTING_PATH} value`, async () => settingsValue(host.descriptor, SAFE_OMP_SETTING_PATH), 60_000);
	const plan: OmpSettingsConflictPlan = chooseSafeOmpConflictPlan(keys as OmpProofSettingKey[], initialValue);
	const initialRevision = initialValue.settingsRevision;
	check(initialRevision === String(inventory.settingsRevision), "the UI inventory and value read share one settings revision");
	await writeFile(join(output, "initial-settings.json"), `${JSON.stringify({ inventory, value: initialValue, plan }, null, 2)}\n`, { mode: 0o600 });
	console.log(`OMP settings proof target: ${plan.path}; original=${plan.originalValue}; native=${plan.nativeTarget}; route-winner=${plan.routeWinner}; revision=${initialRevision}`);

	await nativeGate("prep", {
		projectId,
		sessionId,
		settingPath: plan.path,
		initialValue: plan.originalValue,
		initialRevision,
		nativeTarget: plan.nativeTarget,
		routeWinner: plan.routeWinner,
		instructions: [
			"Use Computer Use on the visible Agents window and open Settings > AI / OMP settings.",
			`Filter the live OMP rows by ${plan.path}; use Load value if the row has not loaded.`,
			`Click Edit and select ${plan.nativeTarget} for ${plan.path}, but do not click Save yet.`,
			"Leave that native editor open with the target selected, then create the PREP release file.",
			"Do not use DevTools, page.evaluate, synthetic DOM events, or a fake success marker.",
		],
	});

	const routeWriter = await request(host.descriptor, "PATCH", "/v1/omp/settings", {
		path: plan.path,
		value: plan.routeWinner,
		expectedRevision: initialRevision,
	});
	checkStatus(routeWriter, "PATCH", "/v1/omp/settings (second client)");
	const routeWriterBody = object(routeWriter.body, "second-client settings write");
	const routeRevision = textField(routeWriterBody, "settingsRevision", "second-client settings write");
	check(routeRevision !== initialRevision, "the second route writer advances the OMP settings revision");
	check(String(routeWriterBody.value) === plan.routeWinner, "the second route writer commits its distinct value");
	// Prove the host's typed CAS refusal with a real second-client request. This is
	// independent of the native UI's later stale Save: route-only runs must never
	// claim a conflict from a fabricated error object.
	const routeStale = await request(host.descriptor, "PATCH", "/v1/omp/settings", {
		path: plan.path,
		value: plan.nativeTarget,
		expectedRevision: initialRevision,
	});
	check(routeStale.status === 409, `the stale second-client settings write is refused (HTTP ${routeStale.status})`);
	check(isOmpSettingsStaleResponse(routeStale.body), "the real stale settings write carries omp_settings_stale_revision");
	const staleError = object(routeStale.body, "stale settings response").error;
	const staleCode = textField(staleError, "code", "stale settings response error");
	await writeFile(join(output, "route-writer.json"), `${JSON.stringify({
		request: { path: plan.path, value: plan.routeWinner, expectedRevision: initialRevision },
		response: routeWriter,
		staleRequest: { path: plan.path, value: plan.nativeTarget, expectedRevision: initialRevision },
		staleResponse: routeStale,
	}, null, 2)}\n`, { mode: 0o600 });

	await nativeGate("stale", {
		projectId,
		sessionId,
		settingPath: plan.path,
		initialRevision,
		routeRevision,
		routeWinner: plan.routeWinner,
		nativeTarget: plan.nativeTarget,
		instructions: [
			`With ${plan.path} still edited to ${plan.nativeTarget}, click Save in the actual OMP settings row.`,
			"Wait until the row visibly says exactly: This value is stale and was not written.",
			"Confirm the visible Refresh and retry control is present, then create the STALE release file.",
		],
	});

	if (captureNative) {
		const staleObservations = await observeAllPages(browser!);
		await writeFile(join(output, "stale-ui-observations.json"), `${JSON.stringify(staleObservations, null, 2)}\n`, { mode: 0o600 });
		const staleBody = staleObservations.flatMap(observation => [
			String(observation.bodyText ?? ""),
			...(Array.isArray(observation.frames) ? observation.frames.map(frame => String(object(frame, "stale frame observation").text ?? "")) : []),
		]).join("\n");
		check(observesOmpStaleConflict(staleBody), "native OMP UI shows both stale-value and Refresh and retry labels");
		for (const [index, nativePage] of browser!.windows().entries()) await nativePage.screenshot?.({ path: join(output, `stale-window-${index}.png`) }).catch(() => {});
	}
	const staleRead = await waitFor("the route writer's value after the stale UI attempt", async () => settingsValue(host!.descriptor, plan.path), 30_000);
	check(staleRead.value === plan.routeWinner && staleRead.settingsRevision === routeRevision,
		"the stale native save does not overwrite the second client's value or revision");

	await nativeGate("retry", {
		projectId,
		sessionId,
		settingPath: plan.path,
		routeWinner: plan.routeWinner,
		nativeTarget: plan.nativeTarget,
		routeRevision,
		instructions: [
			"Click the visible Refresh and retry button; the row should load the route writer's value.",
			`Select ${plan.nativeTarget} again, click Save, and wait for the row's Saved and read back at revision message.`,
			"Create the RETRY release file only after that saved/readback text is visible.",
		],
	});

	let finalValue: OmpProofSettingValue | undefined;
	if (captureNative) {
		finalValue = await waitFor("the native retry value to reach the host", async () => {
			const value = await settingsValue(host!.descriptor, plan.path);
			return value?.value === plan.nativeTarget && value.settingsRevision !== routeRevision ? value : undefined;
		}, 30_000);
		const retryObservations = await observeAllPages(browser!);
		await writeFile(join(output, "retry-ui-observations.json"), `${JSON.stringify(retryObservations, null, 2)}\n`, { mode: 0o600 });
		const retryBody = retryObservations.flatMap(observation => [
			String(observation.bodyText ?? ""),
			...(Array.isArray(observation.frames) ? observation.frames.map(frame => String(object(frame, "retry frame observation").text ?? "")) : []),
		]).join("\n");
		check(retryBody.includes(`Saved and read back at revision`), "native OMP UI shows its saved/readback revision message");
		check(retryBody.includes(plan.path), "native OMP UI still shows the edited setting path after retry");
		for (const [index, nativePage] of browser!.windows().entries()) await nativePage.screenshot?.({ path: join(output, `retry-window-${index}.png`) }).catch(() => {});
	} else {
		// Route-only mode still exercises the same CAS retry, but is explicitly not a native
		// acceptance claim. Native mode above proves that OmpSettingsPanel performs this write.
		const routeRetry = await request(host.descriptor, "PATCH", "/v1/omp/settings", {
			path: plan.path,
			value: plan.nativeTarget,
			expectedRevision: routeRevision,
		});
		checkStatus(routeRetry, "PATCH", "/v1/omp/settings (route-only retry)");
		finalValue = await settingsValue(host.descriptor, plan.path);
	}
	check(finalValue?.value === plan.nativeTarget, "the live host reads back the native target value");
	check(finalValue?.settingsRevision !== initialRevision && finalValue?.settingsRevision !== routeRevision,
		"the successful retry has a fresh settings revision");
	await writeFile(join(output, "final-settings.json"), `${JSON.stringify({ value: finalValue, target: plan.nativeTarget }, null, 2)}\n`, { mode: 0o600 });
	check(providerRequests === 0, "no provider inference request reached the loopback tripwire");
	check(rendererErrors.length === 0, `all packaged windows reported no renderer exceptions (${rendererErrors.length})`);
	outputResult = {
		ok: true,
		proof: "packaged-omp-settings-cas-native-conflict-retry",
		stagedAppPath,
		projectId,
		sessionId,
		setting: {
			path: plan.path,
			originalValue: plan.originalValue,
			nativeTarget: plan.nativeTarget,
			routeWinner: plan.routeWinner,
			initialRevision,
			routeRevision,
			finalRevision: finalValue?.settingsRevision,
			staleCode,
			staleRouteStatus: routeStale.status,
		},
		providerRequests,
		nativeObservationGates: captureNative,
		nativeWindows: browser?.windows().length ?? 0,
		rendererErrors,
		limitations: captureNative
			? "Native labels and saved/readback text were observed read-only after Computer Use releases; route CAS is the host authority."
			: "Route CAS only; rerun with CEDIA_SETTINGS_CUA=1 for native OMP conflict/readback acceptance.",
	};
	await writeFile(join(output, "result.json"), `${JSON.stringify(outputResult, null, 2)}\n`, { mode: 0o600 });
	console.log(`Packaged OMP settings conflict proof passed: ${JSON.stringify(outputResult)}`);
	proofPassed = true;
} catch (error) {
	const failure = {
		error: error instanceof Error ? error.stack ?? error.message : String(error),
		outputResult,
		rendererErrors,
	};
	await writeFile(join(output, "failure.json"), `${JSON.stringify(failure, null, 2)}\n`).catch(() => {});
	throw error;
} finally {
	for (const monitor of windowMonitors) monitor.dispose();
	await browser?.close().catch(() => {});
	if (hostDescriptor && processAlive(hostDescriptor.pid)) {
		try { process.kill(hostDescriptor.pid, "SIGTERM"); } catch { /* already exited */ }
	}
	await sleep(500);
	if (hostDescriptor && processAlive(hostDescriptor.pid)) {
		try { process.kill(hostDescriptor.pid, "SIGKILL"); } catch { /* already exited */ }
	}
	if (provider) await new Promise<void>(done => provider!.close(() => done()));
	try {
		if (lifecyclePatched && stagedAgentBackup) {
			await writeFile(stagedLifecycleModule, await readFile(join(stagedAgentBackup, "main.cjs")));
		}
		if (stagedExtensionBackup) {
			await rm(stagedExtensionDirectory, { recursive: true, force: true });
			await cp(stagedExtensionBackup, stagedExtensionDirectory, { recursive: true });
		}
		if (stagedAgentBackup) {
			await rm(stagedAgentWindowDirectory, { recursive: true, force: true });
			await cp(stagedAgentBackup, stagedAgentWindowDirectory, { recursive: true });
		}
		if (lifecyclePatched || stagedExtensionBackup || stagedAgentBackup)
			execFileSync("codesign", ["--force", "--deep", "--sign", "-", stagedAppPath], { stdio: "ignore" });
	} catch {
		// Keep the staged app/output available for diagnosis if restoration itself failed.
	}
	if (proofPassed) {
		await rm(scratch, { recursive: true, force: true });
	} else {
		console.error(`Retained failed packaged settings scratch: ${scratch} output=${output}`);
	}
}
