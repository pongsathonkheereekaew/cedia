/**
 * Provider-free packaged shared-draft/settings proof.
 *
 * This is the bounded native harness for the remaining combined D shared-state
 * scenario.  It starts the real host against the no-network fixture OMP, seeds a
 * host draft plus a conflicting legacy Agent UI cache, and launches only an
 * explicitly staged Cedia.app.  The operator observes the two native windows
 * through Computer Use during the single ten-minute gate; this script never
 * clicks, types, injects renderer state, or treats a route assertion as native
 * acceptance.
 *
 * Run (from a scratch app copy under /var):
 *   CEDIA_SHARED_STATE_APP_PATH=/var/.../Cedia.app \
 *     bun scripts/omp-packaged-shared-state-proof.ts
 *
 * The script prints CUA_READY and the exact release path.  After the operator
 * completes the actions in native-observation-ready.json, create that release
 * file (for example, `touch <path>`).  The gate is bounded to ten minutes.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
	access,
	mkdtemp,
	mkdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer, type StartedHostServer } from "../apps/host/src/server.ts";
import {
	agentUiStateDir,
	readAgentUiState,
	writeAgentUiState,
} from "../apps/macos/src/agent-ui-state.ts";
import { installElectronWindowMonitor, type ElectronWindowMonitor } from "./lib/packaged-shared-state-window-monitor.ts";

const root = resolve(import.meta.dir, "..");
const failPrefix = "OMP packaged shared-state proof failed";
const nativeGateTimeoutMs = 10 * 60 * 1_000;
const hostRequestTimeoutMs = 30_000;

// Fixed text makes the native steps auditable: the operator can type exactly the
// strings named in the ready file, and the host's final readback proves which
// renderer won without trusting a synthetic browser event.
const hostDraftText = "Host winner draft after client CAS";
const agentsDraftText = "Agents window draft after migration";
const ideDraftText = "IDE window draft wins";

type JsonObject = Record<string, unknown>;
type RouteResponse = { readonly status: number; readonly body: unknown };

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${failPrefix}: ${message}`);
	console.log(`OK   ${message}`);
}

function object(value: unknown, message: string): JsonObject {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${failPrefix}: ${message}`);
	return value as JsonObject;
}

function numberField(value: unknown, key: string, message: string): number {
	const result = object(value, message)[key];
	if (!Number.isSafeInteger(result) || (result as number) < 0) throw new Error(`${failPrefix}: ${message} has no valid ${key}`);
	return result as number;
}

function textField(value: unknown, key: string, message: string): string {
	const result = object(value, message)[key];
	if (typeof result !== "string") throw new Error(`${failPrefix}: ${message} has no string ${key}`);
	return result;
}

const sleep = (ms: number) => new Promise<void>(resolveSleep => setTimeout(resolveSleep, ms));

async function waitForPath(path: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			await access(path);
			return;
		} catch {
			if (Date.now() >= deadline) throw new Error(`${failPrefix}: timed out waiting for ${path}`);
			await sleep(250);
		}
	}
}

async function waitFor<T>(label: string, read: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await read();
		if (value !== undefined) return value;
		if (Date.now() >= deadline) throw new Error(`${failPrefix}: timed out waiting for ${label}`);
		await sleep(150);
	}
}

async function request(host: StartedHostServer, method: string, path: string, body?: unknown): Promise<RouteResponse> {
	const response = await fetch(`${host.descriptor.url}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${host.descriptor.token}`,
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
		signal: AbortSignal.timeout(hostRequestTimeoutMs),
	});
	const raw = await response.text();
	let parsed: unknown = null;
	try { parsed = raw.length > 0 ? JSON.parse(raw) : null; } catch { parsed = raw; }
	return { status: response.status, body: parsed };
}

async function expectOk(host: StartedHostServer, method: string, path: string, body?: unknown): Promise<JsonObject> {
	const response = await request(host, method, path, body);
	check(response.status >= 200 && response.status < 300,
		`${method} ${path} succeeds (HTTP ${response.status})`);
	return object(response.body, `${method} ${path} response`);
}

function errorCode(response: RouteResponse): string | undefined {
	const body = response.body;
	if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
	const error = (body as JsonObject).error;
	if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
	const code = (error as JsonObject).code;
	return typeof code === "string" ? code : undefined;
}

function legacyConflictId(threadId: string, payload: unknown): string {
	const serialized = JSON.stringify(payload);
	return `legacy-agent-ui-${createHash("sha256")
		.update(threadId, "utf8")
		.update("\0", "utf8")
		.update(serialized, "utf8")
		.digest("hex")}`;
}

function scratchProcessPids(appExecutable: string, profile: string): number[] {
	try {
		return execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" })
			.split("\n")
			.flatMap(line => {
				const match = line.trim().match(/^(\d+)\s+(.*)$/);
				if (!match) return [];
				const pid = Number(match[1]);
				const command = match[2] ?? "";
				return command.includes(appExecutable) && command.includes(profile) ? [pid] : [];
			});
	} catch {
		return [];
	}
}

async function observePage(page: any): Promise<JsonObject> {
	const body = await page.locator("body").innerText().catch(() => "");
	// The standalone Agents page has its composer in the top document, while the
	// IDE's Agent dock is a nested vscode-webview frame. Read every frame; no
	// frame is clicked or evaluated with an action callback.
	const frames = typeof page.frames === "function" ? page.frames() : [page];
	const frameObservations = await Promise.all(frames.map(async (frame: any) => {
		const editors = await frame.locator('[contenteditable="true"]').evaluateAll((nodes: Element[]) => nodes.map(node => ({
			text: (node as HTMLElement).innerText,
			ariaLabel: node.getAttribute("aria-label"),
			testId: node.getAttribute("data-testid"),
		}))).catch(() => []);
		// evaluateAll returns [] immediately when the settings radio is not in a
		// frame, avoiding a locator wait timeout on the IDE webview.
		const density = await frame
			.locator('[role="radiogroup"][aria-label="UI density"] [role="radio"][aria-checked="true"]')
			.evaluateAll((nodes: Element[]) => nodes.map(node => (node as HTMLElement).innerText).filter(Boolean))
			.catch(() => []);
		let url = "";
		try {
			const value = frame.url();
			url = typeof value === "string" ? value : String(value);
		} catch { /* a frame can disappear during app relaunch */ }
		return { url, editors, activeDensity: Array.isArray(density) ? density[0] ?? "" : "" };
	}));
	const editors = frameObservations.flatMap(value => value.editors);
	const activeDensity = frameObservations.map(value => value.activeDensity).find(value => value.length > 0) ?? "";
	const pageUrl = (() => {
		// Playwright's Page.url() is synchronous (unlike title() and locator reads).
		try {
			const value = page.url();
			return typeof value === "string" ? value : String(value);
		} catch {
			return "";
		}
	})();
	return {
		url: pageUrl,
		title: await page.title().catch(() => ""),
		bodyText: typeof body === "string" ? body.slice(0, 16_000) : "",
		editors,
		activeDensity,
		frames: frameObservations.map(value => ({ url: value.url, editorCount: value.editors.length, activeDensity: value.activeDensity })),
	};
}

const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright") as {
	_electron: {
		launch(options: Record<string, unknown>): Promise<{
			firstWindow(): Promise<any>;
			windows(): any[];
			close(): Promise<void>;
		}>;
	};
};

const appInput = process.env.CEDIA_SHARED_STATE_APP_PATH;
check(typeof appInput === "string" && appInput.endsWith("/Cedia.app"),
	"CEDIA_SHARED_STATE_APP_PATH names an explicitly staged Cedia.app");
const requestedAppPath = resolve(appInput);
check(requestedAppPath.startsWith("/var/") || requestedAppPath.startsWith("/private/var/"),
	"the staged app path is a literal /var scratch path");
const stagedAppPath = await realpath(requestedAppPath);
const tempRoot = await realpath(tmpdir());
check(stagedAppPath.startsWith(`${tempRoot}/`),
	`the staged app resides under the actual temporary directory (${tempRoot})`);
const installedAppPath = resolve(join(root, `VSCode-darwin-${process.arch}/Cedia.app`));
check(stagedAppPath !== installedAppPath && !stagedAppPath.startsWith(`${installedAppPath}/`),
	"the repository's installed Cedia.app is never launched or modified");
const appExecutable = join(stagedAppPath, "Contents/MacOS/Cedia");
const lifecycleModulePath = join(stagedAppPath, "Contents/Resources/app/out/vs/cedia/agent/main.cjs");
await access(appExecutable);
await access(lifecycleModulePath);

// The shim is applied to the scratch app only. Hashing the complete main module
// before patching prevents a stale or hand-edited bundle from being accepted as
// the current source proof.
const sourceLifecycleModule = await readFile(join(root, "dist/agent-window/main.cjs"), "utf8");
const originalLifecycleModule = await readFile(lifecycleModulePath, "utf8");
check(createHash("sha256").update(originalLifecycleModule).digest("hex") === createHash("sha256").update(sourceLifecycleModule).digest("hex"),
	"the staged app carries the current source Agent Window main process");
const setterNeedle = "setLoginItemSettings: (settings) => electronApp.setLoginItemSettings(settings),";
const getterNeedle = "wasOpenedAtLogin = electronApp.getLoginItemSettings().wasOpenedAtLogin === true;";
check(originalLifecycleModule.split(setterNeedle).length === 2 && originalLifecycleModule.split(getterNeedle).length === 2,
	"staged Login Item interception points match the reviewed module");

// Darwin limits AF_UNIX socket paths to 103 characters; Code-OSS appends
// its instance socket to user-data-dir. Keep the isolated path short.
const scratch = await realpath(await mkdtemp(join(tmpdir(), "c-shared-")));
const profile = join(scratch, "u");
const home = join(scratch, "home");
const stateDir = join(scratch, "host");
const output = join(root, "dist/packaged-shared-state-proof", new Date().toISOString().replace(/[:.]/g, "-"));
const shimLogPath = join(output, "login-item-shim.jsonl");
const rendererConsolePath = join(output, "renderer-console.jsonl");
const nativeReadyPath = join(output, "native-observation-ready.json");
const nativeReleasePath = join(output, "native-observation-release");
await Promise.all([
	mkdir(join(profile, "User"), { recursive: true }),
	mkdir(home, { recursive: true }),
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

// Keep a genuine project path in the fixture rather than relying on the user's
// current workspace. The host does not need Git for this shared-state case.
const projectPath = join(scratch, "project");
await mkdir(projectPath, { recursive: true });
await writeFile(join(projectPath, "fixture.txt"), "shared-state fixture\n", { mode: 0o600 });

let stagedLifecyclePatched = false;
let host: StartedHostServer | undefined;
let browser: Awaited<ReturnType<typeof _electron.launch>> | undefined;
let firstPage: any;
let secondHost: StartedHostServer | undefined;
let success = false;
let sessionId = "";
let projectId = "";
let outputResult: JsonObject = {};
const rendererErrors: string[] = [];
const windowMonitors: ElectronWindowMonitor[] = [];

try {
	let stagedLifecycleModule = originalLifecycleModule
		.replace(setterNeedle, `setLoginItemSettings: (settings) => { require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "intercept-set-login-item", settings }) + "\\n"); },`)
		.replace(getterNeedle, `wasOpenedAtLogin = false; require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "simulated-login-state", isPackaged: electronApp.isPackaged, openedAtLogin: false }) + "\\n");`);
	check(stagedLifecycleModule !== originalLifecycleModule, "the scratch Login Item shim changes only the reviewed calls");
	await writeFile(lifecycleModulePath, stagedLifecycleModule);
	stagedLifecyclePatched = true;
	execFileSync("codesign", ["--force", "--deep", "--sign", "-", stagedAppPath], { stdio: "ignore" });
	check(true, "the Login Item interception is staged only in the /var app copy");

	host = await startHostServer({
		stateDir,
		ompExecutable: join(root, "apps/macos/test/fixtures/agent-window-omp"),
		ompEnv: { CEDIA_NODE: process.execPath },
		ompRequestTimeoutMs: 180_000,
	});
	const project = host.host.store.createProject({ path: projectPath, name: "Shared state fixture" });
	projectId = project.id;
	const session = host.host.createSession(project.id, "Shared-state task");
	sessionId = session.id;
	check(sessionId.length > 0, "fixture task registered on the live host");

	const draftPath = `/v1/drafts/${encodeURIComponent(sessionId)}`;
	const hostPayload = { draft: { prompt: "Host draft before native edit" }, draftThread: null, projectMappings: {} };
	const createdDraft = await expectOk(host, "PATCH", draftPath, {
		expectedRevision: 0,
		text: "Initial host draft",
		content: hostPayload,
		sessionId,
		source: "shared-state-fixture",
	});
	check(numberField(createdDraft, "revision", "initial host draft") === 1, "host draft route creates revision 1");

	// Two independent clients read the same revision. Client B wins; client A's
	// stale write must be rejected with the host's typed CAS conflict.
	const clientADraft = await expectOk(host, "GET", draftPath);
	const clientBDraft = await expectOk(host, "GET", draftPath);
	check(numberField(clientADraft, "revision", "client A draft read") === 1
		&& numberField(clientBDraft, "revision", "client B draft read") === 1,
		"two draft clients observe the same revision");
	const draftWinner = await expectOk(host, "PATCH", draftPath, {
		expectedRevision: 1,
		text: hostDraftText,
		content: { draft: { prompt: hostDraftText }, draftThread: null, projectMappings: {} },
		sessionId,
		source: "draft-client-b",
	});
	check(numberField(draftWinner, "revision", "client B draft write") === 2, "client B commits draft revision 2");
	const staleDraft = await request(host, "PATCH", draftPath, {
		expectedRevision: numberField(clientADraft, "revision", "client A draft read"),
		text: "stale client A draft",
		content: { draft: { prompt: "stale client A draft" }, draftThread: null, projectMappings: {} },
	});
	check(staleDraft.status === 409 && errorCode(staleDraft) === "draft_conflict",
		`client A stale draft write is refused as draft_conflict (HTTP ${staleDraft.status})`);

	// Seed the old app-side copy *after* the host winner exists. The real
	// createSharedDraftAccess.read path will notice the byte-different cache and
	// import it as a recoverable legacy-agent-ui-* draft.
	const legacyPayload = { draft: { prompt: "Legacy conflicting draft copy" }, draftThread: null, projectMappings: {} };
	await writeAgentUiState(agentUiStateDir(stateDir), `draft:${sessionId}`, legacyPayload);
	const expectedLegacyId = legacyConflictId(sessionId, legacyPayload);

	// The same two-client CAS exercise for CEDIA-owned app preferences. The app
	// starts with these values; the native step then changes uiDensity to spacious
	// and the second window must repaint from the host broadcast.
	const settingsA = await expectOk(host, "GET", "/v1/settings");
	const settingsB = await expectOk(host, "GET", "/v1/settings");
	const settingsRevision = numberField(settingsA, "revision", "client A settings read");
	check(numberField(settingsB, "revision", "client B settings read") === settingsRevision,
		"two settings clients observe one revision");
	const settingsFirst = await expectOk(host, "PATCH", "/v1/settings", {
		expectedRevision: settingsRevision,
		category: "appearance",
		patch: { uiDensity: "compact" },
	});
	const settingsFirstRevision = numberField(settingsFirst, "revision", "client A settings write");
	check(settingsFirstRevision === settingsRevision + 1, "client A commits the compact density preference");
	const staleSettings = await request(host, "PATCH", "/v1/settings", {
		expectedRevision: settingsRevision,
		category: "appearance",
		patch: { chatWidth: "wide" },
	});
	check(staleSettings.status === 409 && errorCode(staleSettings) === "settings_conflict",
		`client B stale settings write is refused as settings_conflict (HTTP ${staleSettings.status})`);
	const settingsSecond = await expectOk(host, "PATCH", "/v1/settings", {
		expectedRevision: settingsFirstRevision,
		category: "appearance",
		patch: { chatWidth: "wide" },
	});
	const settingsSecondRevision = numberField(settingsSecond, "revision", "client B settings retry");
	check(settingsSecondRevision === settingsFirstRevision + 1, "client B retries on the winning settings revision");

	const shimEvents = async (): Promise<Array<JsonObject>> => {
		try {
			return (await readFile(shimLogPath, "utf8")).trim().split("\n").filter(Boolean).map(line => object(JSON.parse(line), "Login Item shim event"));
		} catch {
			return [];
		}
	};
	const appEnv = {
		...process.env,
		HOME: home,
		USERPROFILE: home,
		TMPDIR: join(scratch, "tmp"),
		CEDIA_STATE_DIR: stateDir,
		CEDIA_HOST_NODE: process.env.CEDIA_HOST_NODE ?? "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node",
		CEDIA_HOST_REQUEST_TIMEOUT_MS: "180000",
		CEDIA_LIFECYCLE_SHIM_LOG: shimLogPath,
		CEDIA_SIMULATE_LOGIN: "0",
		PI_CODING_AGENT_DIR: join(home, ".omp"),
		PI_NO_PTY: "1",
		PI_NOTIFICATIONS: "off",
	};
	await mkdir(appEnv.TMPDIR, { recursive: true });

	browser = await _electron.launch({
		executablePath: appExecutable,
		args: ["--user-data-dir", profile, "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
		env: appEnv,
		timeout: 45_000,
	});
	windowMonitors.push(installElectronWindowMonitor(browser, {
		errors: rendererErrors,
		consolePath: rendererConsolePath,
		label: "initial launch",
	}));
	firstPage = await browser.firstWindow();
	let firstPageUrl = "unknown";
	try {
		const value = firstPage.url();
		firstPageUrl = typeof value === "string" ? value : String(value);
	} catch { /* the first page can still be loading */ }
	console.log(`PACKAGED-SHARED-STATE: staged Electron launch returned (${firstPageUrl})`);
	await waitForPath(shimLogPath, 30_000);
	const firstShimEvents = await shimEvents();
	check(firstShimEvents.some(event => event.event === "intercept-set-login-item"),
		"packaged Login Item setters were intercepted by the hash-verified shim");
	check(firstShimEvents.some(event => event.event === "simulated-login-state" && event.isPackaged === true && event.openedAtLogin === false),
		"scratch run uses the shim's simulated packaged, non-login launch state");

	const expectedSettings = { uiDensity: "compact", chatWidth: "wide" };
	await writeFile(nativeReadyPath, `${JSON.stringify({
		stagedAppPath,
		output,
		stateDir,
		projectId,
		sessionId,
		initialHostDraftText: hostDraftText,
		expectedLegacyConflictDraftId: expectedLegacyId,
		settingsAfterRouteCas: expectedSettings,
		nativeTargetSettings: { uiDensity: "spacious" },
		nativeTargetDrafts: { agents: agentsDraftText, ide: ideDraftText },
		routes: {
			sharedDraft: `/v1/drafts/${sessionId}`,
			sharedSettings: "/v1/settings",
		},
		controls: {
			openTask: "Shared-state task",
			openIde: "Open in IDE",
			settingsPath: "Settings > Appearance",
			settingsControl: "UI density",
			composerSelector: '[contenteditable="true"]',
		},
		instructions: [
			"Use Computer Use on the visible Agents window; if setup is shown, choose Skip setup.",
			"Open Shared-state task and confirm its composer shows the host winner draft, not the legacy text.",
			"Open Settings > Appearance and change UI density from compact to spacious; wait for the host readback.",
			"Type exactly the Agents target text into the Agents composer and wait for its save.",
			"Click Open in IDE, then type exactly the IDE target text into the IDE Agent composer and wait for its save.",
			"Observe both native windows: the IDE text must broadcast back to Agents and the density must be shared.",
			"Do not use DevTools, page.evaluate, synthetic DOM events, or a fake success marker.",
			"After the visible observations are complete, create the release file printed as CUA_RELEASE.",
		],
		warnings: [
			"The CEDIA app-preference bridge auto-adopts/retries stale writes; it has no choose-local/choose-remote control.",
			"The explicit Refresh and retry conflict control belongs to the OMP Settings panel, not this CEDIA app-preference row.",
		],
		gate: { releasePath: nativeReleasePath, timeoutMs: nativeGateTimeoutMs },
	}, null, 2)}\n`, { mode: 0o600 });
	console.log(`CUA_READY: ${nativeReadyPath}`);
	console.log(`CUA_RELEASE: touch ${nativeReleasePath}`);
	await waitForPath(nativeReleasePath, nativeGateTimeoutMs);
	console.log("PACKAGED-SHARED-STATE: native observation gate released");

	// Native CUA is the authority for the visible actions. DOM reads below are
	// diagnostics only; the proof does not inject or click through Playwright.
	const windowsAfterNative = browser.windows();
	check(windowsAfterNative.length >= 2, `native observation opened both Agents and IDE windows (got ${windowsAfterNative.length})`);
	const observations = await Promise.all(windowsAfterNative.map(page => observePage(page)));
	await writeFile(join(output, "native-observations.json"), `${JSON.stringify(observations, null, 2)}\n`);

	const draftAfterNative = await waitFor("the native IDE draft to reach the host", async () => {
		const response = await request(host!, "GET", draftPath);
		if (response.status !== 200) return undefined;
		const body = object(response.body, "native draft readback");
		return body.text === ideDraftText ? body : undefined;
	}, 30_000);
	check(textField(draftAfterNative, "text", "native draft readback") === ideDraftText,
		"the host owns the IDE renderer's final draft text");
	check(numberField(draftAfterNative, "revision", "native draft readback") >= 4,
		"independent native renderer edits advanced the shared draft revision");
	const settingsAfterNative = await waitFor("the native settings write to reach the host", async () => {
		const response = await request(host!, "GET", "/v1/settings");
		if (response.status !== 200) return undefined;
		const body = object(response.body, "native settings readback");
		const values = object(body.values, "native settings values");
		return values.uiDensity === "spacious" ? body : undefined;
	}, 30_000);
	check(object(settingsAfterNative.values, "native settings readback values").uiDensity === "spacious",
		"the host reads back the native UI density change");
	check(object(settingsAfterNative.values, "native settings readback values").chatWidth === "wide",
		"the earlier two-client settings value remains intact");

	const expectedConflict = await waitFor("the preserved legacy draft", async () => {
		const response = await request(host!, "GET", `/v1/drafts/${encodeURIComponent(expectedLegacyId)}`);
		if (response.status !== 200) return undefined;
		return object(response.body, "preserved legacy draft");
	}, 30_000);
	check(textField(expectedConflict, "text", "preserved legacy draft") === "Legacy conflicting draft copy",
		"the genuine conflicting legacy draft remains recoverable");
	check(textField(expectedConflict, "source", "preserved legacy draft") === "agent-ui-import-conflict",
		"legacy preservation is labelled as an agent-ui import conflict");
	check(JSON.stringify(expectedConflict.content) === JSON.stringify(legacyPayload),
		"legacy preservation keeps the original opaque renderer payload");
	const marker = await readAgentUiState(agentUiStateDir(stateDir), `draft-import:${sessionId}`) as JsonObject | null;
	check(marker?.draftId === expectedLegacyId, "the renderer wrote its verified one-time conflict-import marker");

	check(rendererErrors.length === 0, `native packaged windows reported no renderer exceptions (${rendererErrors.length})`);
	check(host.host.store.listCommands(sessionId).filter(command => command.kind === "prompt").length === 0,
		"the provider-free scenario dispatched no prompt");

	// Restart the real host against the same state directory and read the durable
	// draft/settings records before relaunching the packaged UI. This is a restart
	// and readback check, not a second authority or a synthetic in-memory snapshot.
	await browser.close().catch(() => {});
	browser = undefined;
	await host.close();
	const restartedHost = await startHostServer({
		stateDir,
		ompExecutable: join(root, "apps/macos/test/fixtures/agent-window-omp"),
		ompEnv: { CEDIA_NODE: process.execPath },
		ompRequestTimeoutMs: 180_000,
	});
	secondHost = restartedHost;
	const restartedDraft = await expectOk(restartedHost, "GET", draftPath);
	check(textField(restartedDraft, "text", "restarted draft") === ideDraftText,
		"host restart/readback retains the final native draft");
	const restartedSettings = await expectOk(restartedHost, "GET", "/v1/settings");
	const restartedValues = object(restartedSettings.values, "restarted settings values");
	check(restartedValues.uiDensity === "spacious" && restartedValues.chatWidth === "wide",
		"host restart/readback retains both settings values");
	check(numberField(restartedSettings, "revision", "restarted settings") === numberField(settingsAfterNative, "revision", "native settings readback"),
		"host restart/readback retains the settings revision");
	await writeFile(join(output, "restart-readback.json"), `${JSON.stringify({ draft: restartedDraft, settings: restartedSettings }, null, 2)}\n`);

	// Relaunch once on the same isolated profile/state. The initial read only waits
	// for a real document; the second native gate below is what qualifies composer
	// hydration and retained settings. No Playwright action manufactures a UI success.
	browser = await _electron.launch({
		executablePath: appExecutable,
		args: ["--user-data-dir", profile, "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
		env: appEnv,
		timeout: 45_000,
	});
	windowMonitors.push(installElectronWindowMonitor(browser, {
		errors: rendererErrors,
		consolePath: rendererConsolePath,
		label: "relaunch",
	}));
	const relaunchedPage = await browser.firstWindow();
	const relaunchedObservation = await waitFor("the relaunched packaged window", async () => {
		const value = await observePage(relaunchedPage);
		return typeof value.bodyText === "string" && value.bodyText.length > 0 ? value : undefined;
	}, 45_000);
	const nativeRestartReadyPath = join(output, "native-restart-observation-ready.json");
	const nativeRestartReleasePath = join(output, "native-restart-observation-release");
	await writeFile(join(output, "relaunch-observation.json"), `${JSON.stringify(relaunchedObservation, null, 2)}\n`);
	await writeFile(nativeRestartReadyPath, `${JSON.stringify({
		stagedAppPath,
		output,
		projectId,
		sessionId,
		restartedHostUrl: restartedHost.descriptor.url,
		expectedComposerText: ideDraftText,
		expectedUiDensity: "Spacious",
		instructions: [
			"Use Computer Use on the relaunched Agents window; open Shared-state task if it is not already selected.",
			"Open the IDE Agent dock and leave its composer showing exactly the retained text: IDE window draft wins.",
			"With the IDE composer still visible, use the Agents window to open Settings > Appearance and observe UI density is still Spacious after host restart/readback.",
			"Do not use DevTools, page.evaluate, synthetic DOM events, or a fake success marker.",
			"After both retained values are visibly confirmed, create the release file printed as CUA_RESTART_RELEASE.",
		],
		gate: { releasePath: nativeRestartReleasePath, timeoutMs: nativeGateTimeoutMs },
	}, null, 2)}\n`, { mode: 0o600 });
	console.log(`CUA_RESTART_READY: ${nativeRestartReadyPath}`);
	console.log(`CUA_RESTART_RELEASE: touch ${nativeRestartReleasePath}`);
	await waitForPath(nativeRestartReleasePath, nativeGateTimeoutMs);
	const restartWindows = browser.windows();
	check(restartWindows.length >= 1, `restart observation has a visible Agents window (got ${restartWindows.length})`);
	const restartObservations = await Promise.all(restartWindows.map(page => observePage(page)));
	await writeFile(join(output, "native-restart-observations.json"), `${JSON.stringify(restartObservations, null, 2)}\n`);
	const restartComposerObserved = restartObservations.some(value => {
		const editors = value.editors;
		return Array.isArray(editors) && editors.some(editor => object(editor, "restart composer observation").text === ideDraftText);
	});
	check(restartComposerObserved, "native restart observation sees the retained host-owned composer draft");
	const restartDensityObserved = restartObservations.some(value => value.activeDensity === "Spacious");
	check(restartDensityObserved, "native restart observation sees the retained shared UI density");
	check(rendererErrors.length === 0, `relaunch reported no renderer exceptions (${rendererErrors.length})`);

	const finalShimEvents = await shimEvents();
	check(finalShimEvents.some(event => event.event === "intercept-set-login-item"),
		"Login Item writes remain limited to the scratch shim across relaunch");
	outputResult = {
		ok: true,
		proof: "packaged-shared-draft-settings-cas-migration-restart",
		stagedAppPath,
		projectId,
		sessionId,
		providerRequests: 0,
		draft: {
			finalText: ideDraftText,
			finalRevision: numberField(restartedDraft, "revision", "restarted draft"),
			legacyConflictDraftId: expectedLegacyId,
			legacyConflictSource: "agent-ui-import-conflict",
			cas: { clientReadRevision: 1, winnerRevision: 2, staleStatus: staleDraft.status, staleCode: errorCode(staleDraft) },
		},
		settings: {
			finalValues: restartedValues,
			finalRevision: numberField(restartedSettings, "revision", "restarted settings"),
			cas: { initialRevision: settingsRevision, firstRevision: settingsFirstRevision, staleStatus: staleSettings.status, staleCode: errorCode(staleSettings), retryRevision: settingsSecondRevision },
		},
		nativeWindows: windowsAfterNative.length,
		nativeObservationReady: nativeReadyPath,
		nativeObservations: join(output, "native-observations.json"),
		restartReadback: join(output, "restart-readback.json"),
		relaunchObservation: join(output, "relaunch-observation.json"),
		nativeRestartObservationReady: nativeRestartReadyPath,
		nativeRestartObservations: join(output, "native-restart-observations.json"),
		loginItemShim: { path: shimLogPath, simulatedLogin: false, writesIntercepted: finalShimEvents.filter(event => event.event === "intercept-set-login-item").length },
		rendererErrors,
	};
	await writeFile(join(output, "result.json"), `${JSON.stringify(outputResult, null, 2)}\n`, { mode: 0o600 });
	console.log(`Packaged shared-state proof passed: ${JSON.stringify(outputResult)}`);
	success = true;
} catch (error) {
	const failure = { error: error instanceof Error ? error.stack ?? error.message : String(error), outputResult, rendererErrors };
	await writeFile(join(output, "failure.json"), `${JSON.stringify(failure, null, 2)}\n`).catch(() => {});
	throw error;
} finally {
	for (const monitor of windowMonitors) monitor.dispose();
	await browser?.close().catch(() => {});
	if (host) await host.close().catch(() => {});
	if (secondHost) await secondHost.close().catch(() => {});
	for (const pid of scratchProcessPids(appExecutable, profile)) {
		try { process.kill(pid, "SIGTERM"); } catch { /* already exited */ }
	}
	await sleep(500);
	for (const pid of scratchProcessPids(appExecutable, profile)) {
		try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
	}
	if (stagedLifecyclePatched) {
		await writeFile(lifecycleModulePath, originalLifecycleModule).catch(() => {});
		try { execFileSync("codesign", ["--force", "--deep", "--sign", "-", stagedAppPath], { stdio: "ignore" }); } catch { /* retain diagnostics if codesign itself failed */ }
	}
	if (success) {
		await rm(scratch, { recursive: true, force: true });
	} else {
		console.error(`Retained failed packaged shared-state scratch: ${scratch}`);
	}
}
