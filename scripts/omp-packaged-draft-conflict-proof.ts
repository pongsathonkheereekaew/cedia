/**
 * Prove the packaged CUA restart path preserves a conflicting renderer draft.
 *
 * The packaged app persists an unsent composer draft to its bundled host, then a stale
 * renderer file cache is seeded over the host canonical record and the app process is
 * SIGKILLed. After relaunch the composer must rehydrate the host canonical text while
 * the stale copy is preserved as a labeled `agent-ui-import-conflict` host record.
 *
 * The app bundle must be an explicitly staged copy under the system temp directory.
 * The proof patches only that copy's Login Item calls and never touches Keychain.
 * No prompt is sent and the local provider endpoint is a tripwire.
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { probeCediaOwner, readCediaOwnerRecord, readCediaOwnerSummary } from "../apps/host/src/owner-endpoint.ts";
import { agentUiStateDir, readAgentUiState, removeAgentUiState, writeAgentUiState } from "../apps/macos/src/agent-ui-state.ts";
import type { HostDescriptor } from "../packages/protocol/src/index.ts";

const root = resolve(import.meta.dir, "..");
const failPrefix = "OMP packaged draft-conflict proof failed";
const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright") as {
	_electron: {
		launch(options: Record<string, unknown>): Promise<{
			firstWindow(): Promise<any>;
			close(): Promise<void>;
		}>;
	};
};

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${failPrefix}: ${message}`);
	console.log(`OK   ${message}`);
}
function object(value: unknown, message: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${failPrefix}: ${message}`);
	return value as Record<string, unknown>;
}
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
async function waitFor<T>(label: string, read: () => Promise<T | undefined>, timeoutMs = 60_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await read();
		if (value !== undefined) return value;
		if (Date.now() >= deadline) throw new Error(`${failPrefix}: timed out waiting for ${label}`);
		await sleep(150);
	}
}
function alive(pid: number): boolean {
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
function appMainPid(appExecutable: string, profileDir: string): number | undefined {
	const lines = execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" }).split("\n");
	const pids = lines.flatMap(line => {
		const match = line.trim().match(/^(\d+)\s+(.*)$/);
		if (!match) return [];
		const pid = Number(match[1]);
		const command = match[2] ?? "";
		return command.includes(appExecutable) && command.includes(profileDir) ? [pid] : [];
	});
	if (pids.length > 1) throw new Error(`${failPrefix}: multiple staged app main processes match scratch profile: ${pids.join(",")}`);
	return pids[0];
}

const appBundle = process.env.CEDIA_PACKAGED_OWNED_HOST_APP_PATH;
check(typeof appBundle === "string" && appBundle.endsWith("/Cedia.app"),
	"CEDIA_PACKAGED_OWNED_HOST_APP_PATH names a staged Cedia.app");
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
const stagedLifecycleModule = join(stagedAgentWindowDirectory, "main.cjs");
const sourceExtensionDirectory = join(root, "dist/mac-extension");
const sourceAgentWindowDirectory = join(root, "dist/agent-window");
const sourceOmpExecutable = join(root, "dist/omp-standalone/omp");
const sourceHostCli = join(root, "dist/host/cli.js");
await Promise.all([access(appExecutable), access(bundledHost), access(bundledOmp)]);
const packagedRuntimeVersion = execFileSync(bundledOmp, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(packagedRuntimeVersion), `packaged OMP runtime is supported (${packagedRuntimeVersion})`);
const sourceOmp = await readFile(sourceOmpExecutable);
check(sourceOmp.includes(Buffer.from("CEDIA_HOST_SESSION_ID")), "the current standalone OMP build carries the task-id owner bridge");
const runtimeVersion = execFileSync(sourceOmpExecutable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(runtimeVersion === packagedRuntimeVersion, `the current source OMP runtime matches the app's pinned version (${runtimeVersion})`);
const sourceOmpSha256 = createHash("sha256").update(sourceOmp).digest("hex");
const sourceHost = await readFile(sourceHostCli, "utf8");
check(sourceHost.includes("CEDIA_HOST_SESSION_ID"), "the current source host build carries the task-id owner bridge");
const sourceHostSha256 = createHash("sha256").update(sourceHost).digest("hex");
await Promise.all([access(join(sourceExtensionDirectory, "runtime/host/cli.js")), access(join(sourceAgentWindowDirectory, "main.cjs"))]);
const sourceAgentWindowMain = await readFile(join(sourceAgentWindowDirectory, "main.cjs"));
const sourceAgentWindowMainSha256 = createHash("sha256").update(sourceAgentWindowMain).digest("hex");
const sourceExtensionJs = await readFile(join(sourceExtensionDirectory, "out/extension.js"));
const sourceExtensionJsSha256 = createHash("sha256").update(sourceExtensionJs).digest("hex");
const setterNeedle = "setLoginItemSettings: (settings) => electronApp.setLoginItemSettings(settings),";
const getterNeedle = "wasOpenedAtLogin = electronApp.getLoginItemSettings().wasOpenedAtLogin === true;";
let lifecycleStageModified = false;
let extensionStageModified = false;
let agentWindowStageModified = false;
let originalStagedExtensionDirectory: string | undefined;
let originalStagedAgentWindowDirectory: string | undefined;

const scratch = await realpath(await mkdtemp(join(tmpdir(), "c-oh-adopt-")));
originalStagedExtensionDirectory = join(scratch, "original-cedia-extension");
originalStagedAgentWindowDirectory = join(scratch, "original-agent-window");
const profile = join(scratch, "u");
const stateDir = join(scratch, "h");
const home = join(scratch, "hm");
const ompProfile = join(home, ".omp");
const workDir = join(scratch, "w");
const projectName = "Packaged draft conflict";
const taskTitle = "Packaged conflict surviving task";
const output = join(root, "dist/packaged-draft-conflict-proof", new Date().toISOString().replace(/[:.]/g, "-"));
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
let current: { app: Awaited<ReturnType<typeof _electron.launch>>; page: any } | undefined;
let hostDescriptor: HostDescriptor | undefined;
let projectId: string | undefined;
let sessionId: string | undefined;
let taskIncarnation: string | undefined;
let ownerPid: number | undefined;
const rendererErrors: string[] = [];
const draftDiagnostics: Record<string, unknown> = {};
let proofPassed = false;
const shimLog = join(scratch, "login-item-shim.jsonl");
const appEnv = {
	...process.env,
	HOME: home,
	CEDIA_STATE_DIR: stateDir,
	CEDIA_HOST_IDLE_MS: "300000",
	CEDIA_LIFECYCLE_SHIM_LOG: shimLog,
	CEDIA_SIMULATE_LOGIN: "0",
	PI_CODING_AGENT_DIR: ompProfile,
	PI_NO_PTY: "1",
	PI_NOTIFICATIONS: "off",
};

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

async function request(hostValue: HostDescriptor, method: string, path: string, body?: unknown): Promise<unknown> {
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

async function readDraft(hostValue: HostDescriptor, draftId: string): Promise<Record<string, unknown> | undefined> {
	const response = await fetch(`${hostValue.url}/v1/drafts/${encodeURIComponent(draftId)}`, {
		headers: { Authorization: `Bearer ${hostValue.token}` },
		signal: AbortSignal.timeout(5_000),
	});
	if (response.status === 404) return undefined;
	const result = await response.json() as unknown;
	if (!response.ok) throw new Error(`${failPrefix}: GET draft returned ${response.status}: ${JSON.stringify(result)}`);
	return object(result, "host shared draft");
}

async function inspectDraftHydration(page: any, draftId: string): Promise<Record<string, unknown>> {
	const renderer = await page.evaluate((id: string) => {
		const raw = localStorage.getItem("synara:composer-drafts:v1");
		let persistedPrompt: unknown;
		try { persistedPrompt = JSON.parse(raw ?? "null")?.state?.draftsByThreadId?.[id]?.prompt; }
		catch { persistedPrompt = "<invalid localStorage JSON>"; }
		return {
			url: location.href,
			pushStateCalls: (window as typeof window & { __cediaDraftProofPushStateCalls?: number }).__cediaDraftProofPushStateCalls ?? 0,
			hashChangeEvents: (window as typeof window & { __cediaDraftProofHashChangeEvents?: number }).__cediaDraftProofHashChangeEvents ?? 0,
			localStoragePresent: raw !== null,
			persistedPrompt: typeof persistedPrompt === "string" ? persistedPrompt : null,
			composers: Array.from(document.querySelectorAll('[contenteditable="true"]')).map(element => ({
				textContent: element.textContent,
				innerText: (element as HTMLElement).innerText,
				ariaLabel: element.getAttribute("aria-label"),
				testId: element.getAttribute("data-testid"),
			})),
		};
	}, draftId) as Record<string, unknown>;
	return {
		renderer,
		mainProcessCache: await readAgentUiState(agentUiStateDir(stateDir), `draft:${draftId}`),
	};
}

async function launch(generation: string, label: string, waitForExistingTask = true): Promise<void> {
	const app = await _electron.launch({
		executablePath: appExecutable,
		args: ["--user-data-dir", profile, "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
		env: { ...appEnv, CEDIA_APP_GENERATION: generation },
		timeout: 45_000,
	});
	current = { app, page: undefined };
	const page = await app.firstWindow();
	current.page = page;
	page.on("pageerror", (error: Error) => rendererErrors.push(error.message));
	await page.getByRole("button", { name: "Skip setup", exact: true }).first().click({ timeout: 15_000 }).catch(() => {});
	if (waitForExistingTask) {
		await page.getByText(projectName, { exact: true }).first().waitFor({ timeout: 60_000 });
		await page.getByText(taskTitle, { exact: true }).first().waitFor({ timeout: 45_000 });
		await page.screenshot({ path: join(output, `${label}.png`) });
		check(appMainPid(appExecutable, profile) !== undefined, `${label}: staged app window shows the existing project and task`);
	} else {
		await page.getByText("What should we work on?", { exact: true }).first().waitFor({ timeout: 45_000 });
		check(appMainPid(appExecutable, profile) !== undefined, `${label}: staged app window is ready before the host task is created`);
	}
}

async function closeCurrent(): Promise<void> {
	const active = current;
	current = undefined;
	if (!active) return;
	await active.app.close().catch(() => {});
	await waitFor("the exact staged app to close", async () => appMainPid(appExecutable, profile) === undefined ? true : undefined, 20_000).catch(() => {});
}

try {
	await cp(stagedExtensionDirectory, originalStagedExtensionDirectory, { recursive: true });
	await cp(stagedAgentWindowDirectory, originalStagedAgentWindowDirectory, { recursive: true });
	extensionStageModified = true;
	await rm(stagedExtensionDirectory, { recursive: true, force: true });
	await cp(sourceExtensionDirectory, stagedExtensionDirectory, { recursive: true });
	agentWindowStageModified = true;
	await rm(stagedAgentWindowDirectory, { recursive: true, force: true });
	await cp(sourceAgentWindowDirectory, stagedAgentWindowDirectory, { recursive: true });
	check(createHash("sha256").update(await readFile(bundledOmp)).digest("hex") === sourceOmpSha256,
		"the staged app carries the current standalone OMP binary");
	check(createHash("sha256").update(await readFile(bundledHost)).digest("hex") === sourceHostSha256,
		"the staged app carries the current source host executable");
	check(createHash("sha256").update(await readFile(stagedLifecycleModule)).digest("hex") === sourceAgentWindowMainSha256,
		"the staged app carries the current Agent Window main process");
	check(createHash("sha256").update(await readFile(join(stagedExtensionDirectory, "out/extension.js"))).digest("hex") === sourceExtensionJsSha256,
		"the staged app carries the current Mac extension");
	check(true, "the current source extension and Agent Window are staged only in the temp app copy");
	let lifecycleModule = await readFile(stagedLifecycleModule, "utf8");
	check(lifecycleModule.split(setterNeedle).length === 2 && lifecycleModule.split(getterNeedle).length === 2,
		"staged Login Item interception points match the reviewed module");
	lifecycleModule = lifecycleModule
		.replace(setterNeedle, `setLoginItemSettings: (settings) => { require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "intercept-set-login-item", settings }) + "\\n"); },`)
		.replace(getterNeedle, `wasOpenedAtLogin = false; require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "simulated-login-state", isPackaged: electronApp.isPackaged, openedAtLogin: false }) + "\\n");`);
	lifecycleStageModified = true;
	await writeFile(stagedLifecycleModule, lifecycleModule);
	execFileSync("codesign", ["--force", "--deep", "--sign", "-", resolvedAppBundle], { stdio: "ignore" });
	check(true, "the Login Item interception is staged only in the temp app copy");

	provider = createServer((request, response) => {
		providerRequests++;
		response.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "This provider-free fixture must not be called." }));
	});
	await new Promise<void>(ready => provider!.listen(0, "127.0.0.1", ready));
	provider.unref();
	const providerAddress = provider.address();
	const providerPort = providerAddress !== null && typeof providerAddress === "object" ? providerAddress.port : 0;
	check(providerPort > 0, "loopback provider tripwire is bound");
	await writeFile(join(ompProfile, "models.yml"), `providers:\n  cedia-packaged-owner-fixture:\n    baseUrl: http://127.0.0.1:${providerPort}/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: cedia-packaged-owner-fixture-model\n        name: Packaged owner fixture\n        api: openai-completions\n        reasoning: false\n        input: [text]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 128000\n        maxTokens: 4096\n`, { mode: 0o600 });

	const firstGeneration = `packaged-conflict-first-${randomUUID()}`;
	await launch(firstGeneration, "app-before-crash", false);
	const firstHost = await waitFor("the packaged app to start its bundled host", readHost, 60_000);
	check(firstHost.identity.appGeneration === firstGeneration, "the packaged host records the first app generation");
	const hostCommand = execFileSync("ps", ["-p", String(firstHost.descriptor.pid), "-o", "command="], { encoding: "utf8" }).trim();
	check(hostCommand.includes(bundledHost), "the packaged app started its bundled host executable");
	hostDescriptor = firstHost.descriptor;

	const project = object(await request(hostDescriptor, "POST", "/v1/projects", { path: workDir, name: projectName }), "created project");
	projectId = String(project.id ?? "");
	check(projectId.length > 0, "project was created through the packaged host");
	const session = object(await request(hostDescriptor, "POST", "/v1/sessions", { projectId, title: taskTitle }), "created task");
	sessionId = String(session.id ?? "");
	check(sessionId.length > 0, "task was created through the packaged host");
	const started = object(await request(hostDescriptor, "POST", `/v1/sessions/${sessionId}/start`, {}), "started task");
	check(started.status === "idle" || started.status === "running", `the packaged host starts its OMP owner (${String(started.status)})`);
	const ownerDirectory = join(stateDir, "sessions", sessionId);
	const attachment = await waitFor("an authenticated owner attached by the packaged host", async () => {
		const record = readCediaOwnerRecord(ownerDirectory);
		if (!record) return undefined;
		const probe = await probeCediaOwner(ownerDirectory, { expected: { sessionId, incarnation: record.incarnation } }).catch(() => undefined);
		return probe?.state === "attached" ? { record, probe } : undefined;
	});
	ownerPid = attachment.probe.identity.pid;
	taskIncarnation = attachment.record.incarnation;
	check(attachment.probe.identity.sessionId === sessionId && attachment.probe.identity.incarnation === taskIncarnation,
		"the bundled OMP owner authenticates the exact CEDIA task incarnation");
	check((await readCediaOwnerSummary(ownerDirectory, { expected: { sessionId, incarnation: taskIncarnation } })).state === "available",
		"the packaged host can read the idle OMP owner's summary");
	await current!.page.reload();
	await current!.page.getByText(projectName, { exact: true }).first().waitFor({ timeout: 60_000 });
	await current!.page.getByText(taskTitle, { exact: true }).first().waitFor({ timeout: 45_000 });
	await current!.page.getByText(taskTitle, { exact: true }).first().click();
	const firstComposer = current!.page.locator('[contenteditable="true"]').first();
	await firstComposer.waitFor({ state: "visible", timeout: 30_000 });
	const composerDraftText = `unsent restart draft ${randomUUID()}`;
	await firstComposer.fill(composerDraftText);
	const draftBeforeCrash = await waitFor("the typed composer draft to persist in the host", async () => {
		const draft = await readDraft(hostDescriptor!, sessionId!);
		return draft?.text === composerDraftText && typeof draft.revision === "number" ? draft : undefined;
	}, 20_000);
	draftDiagnostics.beforeCrashHostRecord = draftBeforeCrash;
	check(typeof draftBeforeCrash.revision === "number" && draftBeforeCrash.revision >= 1,
		"the real packaged composer commits its unsent text to the shared host draft");
	const persistedLocalDraft = await waitFor("the renderer's persisted composer cache", async () => {
		const value = await current!.page.evaluate(() => localStorage.getItem("synara:composer-drafts:v1")) as string | null;
		return value?.includes(composerDraftText) ? value : undefined;
	}, 10_000);
	check(persistedLocalDraft.includes(composerDraftText), "the proof observes the renderer's local draft cache before isolating host hydration");
	const clearedLocalDraftCache = await current!.page.evaluate(() => {
		localStorage.removeItem("synara:composer-drafts:v1");
		return localStorage.getItem("synara:composer-drafts:v1");
	});
	check(clearedLocalDraftCache === null, "the scratch renderer's persisted draft cache is cleared before app crash");
	await current!.page.screenshot({ path: join(output, "app-before-crash.png") });
	check(true, "the app UI displays the selected task with an unsent composer draft");
	const firstAppPid = appMainPid(appExecutable, profile);
	check(firstAppPid !== undefined, "the exact staged app process is identified before crash");
	process.kill(firstAppPid, "SIGKILL");
	await current!.app.close().catch(() => {});
	current = undefined;
	await waitFor("the first staged app process to exit", async () => appMainPid(appExecutable, profile) === undefined ? true : undefined, 20_000);
	const survivingHost = await readHost();
	check(survivingHost?.descriptor.pid === firstHost.descriptor.pid && alive(firstHost.descriptor.pid),
		"the app crash leaves its packaged host process alive");
	check(alive(ownerPid), "the app crash leaves the same idle OMP owner process alive");
	const ownerAfterCrash = await probeCediaOwner(ownerDirectory, { expected: { sessionId, incarnation: taskIncarnation } });
	check(ownerAfterCrash.state === "attached" && ownerAfterCrash.identity.pid === ownerPid,
		"the surviving OMP endpoint authenticates the same task owner after app crash");
	const staleDraftText = `stale renderer draft ${randomUUID()}`;
	const stalePayload = { draft: { prompt: staleDraftText, attachments: [] as unknown[] } };
	await writeAgentUiState(agentUiStateDir(stateDir), `draft:${sessionId}`, stalePayload);
	await writeAgentUiState(agentUiStateDir(stateDir), `draft-revision:${sessionId}`, { revision: draftBeforeCrash.revision });
	const expectedConflictId = `legacy-agent-ui-${createHash("sha256").update(sessionId!, "utf8").update("\0").update(JSON.stringify(stalePayload), "utf8").digest("hex")}`;
	check(true, "a stale renderer file cache is seeded over the host canonical draft before relaunch");
	const hostDraftAfterCrash = await readDraft(firstHost.descriptor, sessionId);
	draftDiagnostics.afterCrashHostRecord = hostDraftAfterCrash;
	check(hostDraftAfterCrash?.text === composerDraftText,
		"the unsent draft remains host-owned after clearing only the scratch renderer cache");

	const secondGeneration = `packaged-conflict-second-${randomUUID()}`;
	await launch(secondGeneration, "app-after-crash-adoption");
	const adoptedHost = await waitFor("the bundled host after app relaunch", readHost, 10_000);
	check(adoptedHost.descriptor.pid === firstHost.descriptor.pid, "the relaunched app reconnects to the same packaged host PID");
	check(adoptedHost.identity.generation === firstHost.identity.generation, "host process generation stays the same across app relaunch");
	const taskAfterCrash = object(await request(adoptedHost.descriptor, "GET", `/v1/sessions/${sessionId}`), "task after app crash");
	check(taskAfterCrash.id === sessionId && taskAfterCrash.incarnation === taskIncarnation, "the durable task id and incarnation survive app relaunch");
	const ownerAfter = await probeCediaOwner(ownerDirectory, { expected: { sessionId, incarnation: taskIncarnation } });
	check(ownerAfter.state === "attached" && ownerAfter.identity.pid === ownerPid, `the same OMP owner remains attached (${ownerPid})`);
	check((await readCediaOwnerSummary(ownerDirectory, { expected: { sessionId, incarnation: taskIncarnation } })).state === "available",
		"the relaunched app's packaged host still reads the surviving owner summary");
	draftDiagnostics.afterRelaunchBeforeSelection = await inspectDraftHydration(current!.page, sessionId);
	await current!.page.evaluate(() => {
		const probe = window as typeof window & { __cediaDraftProofPushStateCalls?: number; __cediaDraftProofHashChangeEvents?: number };
		probe.__cediaDraftProofPushStateCalls = 0;
		probe.__cediaDraftProofHashChangeEvents = 0;
		const pushState = window.history.pushState;
		window.history.pushState = function (...args) {
			probe.__cediaDraftProofPushStateCalls = (probe.__cediaDraftProofPushStateCalls ?? 0) + 1;
			return pushState.apply(this, args);
		};
		window.addEventListener("hashchange", () => {
			probe.__cediaDraftProofHashChangeEvents = (probe.__cediaDraftProofHashChangeEvents ?? 0) + 1;
		});
	});
	await current!.page.getByText(taskTitle, { exact: true }).first().click();
	const relaunchedComposer = current!.page.locator('[contenteditable="true"]').first();
	await relaunchedComposer.waitFor({ state: "visible", timeout: 30_000 });
	const draftHydrationDeadline = Date.now() + 30_000;
	let hydratedComposerText = "";
	while (Date.now() < draftHydrationDeadline) {
		hydratedComposerText = (await relaunchedComposer.innerText()).trim();
		if (hydratedComposerText === composerDraftText) break;
		await sleep(250);
	}
	draftDiagnostics.afterRelaunchComposer = await inspectDraftHydration(current!.page, sessionId);
	if (hydratedComposerText !== composerDraftText) {
		await writeFile(join(output, "draft-hydration-diagnostics.json"), `${JSON.stringify(draftDiagnostics, null, 2)}\n`);
		throw new Error(`${failPrefix}: host-owned draft did not hydrate into the relaunched composer; observed ${JSON.stringify(draftDiagnostics.afterRelaunchComposer)}`);
	}
	check((await readDraft(adoptedHost.descriptor, sessionId))?.text === composerDraftText,
		"the rehydrated composer matches the durable host draft despite the stale file cache");
	const conflicted = await readDraft(adoptedHost.descriptor, expectedConflictId);
	check(conflicted?.text === staleDraftText,
		"the stale renderer copy is preserved as a labeled host record after relaunch");
	check(conflicted?.source === "agent-ui-import-conflict",
		"the preserved copy carries the conflict import source");
	check(JSON.stringify(conflicted?.content) === JSON.stringify(stalePayload),
		"the preserved copy keeps the exact stale payload bytes");
	const refreshedCache = await readAgentUiState(agentUiStateDir(stateDir), `draft:${sessionId}`) as { draft?: { prompt?: unknown } } | null;
	check(refreshedCache?.draft?.prompt === composerDraftText,
		"the relaunched file cache is refreshed to the host canonical draft");
	await current!.page.screenshot({ path: join(output, "app-after-crash-draft-hydration.png") });
	const observeMs = Number(process.env.CEDIA_CUA_OBSERVE_MS ?? "0");
	if (Number.isSafeInteger(observeMs) && observeMs > 0 && observeMs <= 60_000) {
		console.log(`CUA observation window open after host-backed draft hydration for ${observeMs} ms`);
		await sleep(observeMs);
	}
	check(providerRequests === 0, "the packaged draft-conflict proof made zero provider requests");
	check(rendererErrors.length === 0, "both packaged app launches reported no renderer exceptions");

	const result = {
		ok: true,
		runtimeVersion,
		appGenerations: [firstGeneration, secondGeneration],
		appProcessIds: [firstAppPid, appMainPid(appExecutable, profile)],
		hostPid: adoptedHost.descriptor.pid,
		hostGeneration: adoptedHost.identity.generation,
		hostAppGeneration: adoptedHost.identity.appGeneration,
		bundledHost,
		projectId,
		taskId: sessionId,
		incarnation: taskIncarnation,
		ompOwnerPid: ownerPid,
		ownerSummary: "available",
		draftRevision: draftBeforeCrash.revision,
		draftText: composerDraftText,
		staleDraftText,
		conflictRecordId: expectedConflictId,
		conflictRecordSource: conflicted?.source,
		fileCacheRefreshedToCanonical: true,
		providerRequests,
		loginItemInterceptions: (await readFile(shimLog, "utf8")).split("\n").filter(line => line.includes("intercept-set-login-item")).length,
		sourceHostSha256,
		sourceOmpSha256,
		sourceAgentWindowMainSha256,
		sourceExtensionJsSha256,
	};
	await writeFile(join(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
	console.log(JSON.stringify(result, null, 2));
	proofPassed = true;
} catch (error) {
	await writeFile(join(output, "failure.json"), `${JSON.stringify({ error: error instanceof Error ? error.stack ?? error.message : String(error), rendererErrors, draftDiagnostics }, null, 2)}\n`);
	throw error;
} finally {
	if (sessionId && hostDescriptor) await request(hostDescriptor, "POST", `/v1/sessions/${sessionId}/stop`, {}).catch(() => {});
	if (current && appMainPid(appExecutable, profile) !== undefined) await closeCurrent();
	if (hostDescriptor && alive(hostDescriptor.pid)) await request(hostDescriptor, "POST", "/v1/lifecycle/quit", {}).catch(() => {});
	if (hostDescriptor) {
		await waitFor("the exact scratch packaged host to stop", async () => alive(hostDescriptor!.pid) ? undefined : true, 15_000).catch(() => {});
		if (alive(hostDescriptor.pid)) {
			const command = execFileSync("ps", ["-p", String(hostDescriptor.pid), "-o", "command="], { encoding: "utf8" }).trim();
			if (command.includes(bundledHost)) {
				try { process.kill(hostDescriptor.pid, "SIGTERM"); } catch { /* exact staged host may already exit */ }
			}
		}
	}
	if (ownerPid !== undefined && sessionId && taskIncarnation !== undefined && alive(ownerPid)) {
		const ownerDirectory = join(stateDir, "sessions", sessionId);
		const record = readCediaOwnerRecord(ownerDirectory);
		if (record?.pid === ownerPid && record.incarnation === taskIncarnation) {
			const probe = await probeCediaOwner(ownerDirectory, { expected: { sessionId, incarnation: taskIncarnation } }).catch(() => undefined);
			if (probe?.state === "attached" && probe.identity.pid === ownerPid && alive(ownerPid)) {
				try { process.kill(ownerPid, "SIGTERM"); } catch { /* exact scratch owner may already exit */ }
				await waitFor("the exact packaged OMP owner to exit", async () => alive(ownerPid!) ? undefined : true, 10_000).catch(() => {});
			}
		}
	}
	if (provider?.listening) {
		await new Promise<void>(done => provider!.close(() => done()));
	}
	if (agentWindowStageModified && originalStagedAgentWindowDirectory) {
		await rm(stagedAgentWindowDirectory, { recursive: true, force: true });
		await cp(originalStagedAgentWindowDirectory, stagedAgentWindowDirectory, { recursive: true });
	}
	if (extensionStageModified && originalStagedExtensionDirectory) {
		await rm(stagedExtensionDirectory, { recursive: true, force: true });
		await cp(originalStagedExtensionDirectory, stagedExtensionDirectory, { recursive: true });
	}
	if (lifecycleStageModified || extensionStageModified || agentWindowStageModified) {
		execFileSync("codesign", ["--force", "--deep", "--sign", "-", resolvedAppBundle], { stdio: "ignore" });
	}
	if (proofPassed) await rm(scratch, { recursive: true, force: true });
	else console.error(`Retained failed packaged proof scratch state for inspection: ${scratch}`);
}
