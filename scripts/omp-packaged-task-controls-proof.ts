/**
 * Provider-free packaged task-controls observation proof.
 *
 * This runner closes two local, still-open observation slices without pretending that a
 * fixture or a DOM assertion is the full §11.1 semantic gate:
 *
 * 1. start one fake-host OMP turn and hold it, then hand a valid model revision to the
 *    real host route.  The staged Agent Window is left on that task for an optional native
 *    observation of `model change · awaiting OMP · fixture/fixture-model-2`;
 * 2. leave a second real Git project dirty, expose it to the staged Agent Window for an
 *    optional native observation of the base-branch/worktree picker, then create a task
 *    through the real host HTTP route with `baseRef: "main"` and `dirtyFiles: ["keep.txt"]`.
 *    The resulting worktree is checked byte-for-byte: the selected change travels and the
 *    unselected tracked change stays at the base revision.
 *
 * The native observations are deliberately operator-gated.  Set
 * `CEDIA_TASK_CONTROLS_CUA=1` and touch each `*-release` file printed by the runner after
 * looking at the actual staged window with Computer Use.  Each gate has a ten-minute
 * deadline.  The result records the screenshots and release markers, but never calls a
 * Playwright locator a semantic acceptance claim.
 *
 * The app path must be a separately staged scratch copy.  The runner hash-checks the staged
 * Agent Window main process against the current source build, installs the reviewed Login
 * Item shim in that scratch copy only, and restores the original bytes before returning.
 * It never opens the repository's installed app, reads or deletes Keychain entries, or sends
 * a provider request.  It passes `--password-store=basic` and
 * `--use-inmemory-secretstorage` explicitly, and all profile/HOME/state paths are temporary.
 *
 * Run (native gates enabled):
 * `CEDIA_TASK_CONTROLS_APP_PATH=/tmp/<staged>/Cedia.app CEDIA_TASK_CONTROLS_CUA=1 bun scripts/omp-packaged-task-controls-proof.ts`
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { startHostServer, type StartedHostServer } from "../apps/host/src/server.ts";
import { dereferencePackagedResponse } from "./lib/packaged-proof-http.ts";
import type { HostDescriptor } from "../packages/protocol/src/index.ts";

export const NATIVE_GATE_TIMEOUT_MS = 10 * 60 * 1_000;

const root = resolve(import.meta.dir, "..");
const FAIL_PREFIX = "OMP packaged task-controls proof failed";
const PENDING_PROJECT_NAME = "Pending model observation fixture";
const PENDING_TASK_TITLE = "Awaiting OMP task";
const DIRTY_PROJECT_NAME = "Dirty worktree observation fixture";
const DIRTY_TASK_TITLE = "Selected dirty route task";
const DIRTY_KEEP_BASE = "base keep\n";
const DIRTY_KEEP = "dirty keep selected\n";
const DIRTY_DROP_BASE = "base drop\n";
const DIRTY_DROP = "dirty drop not selected\n";

type PendingModelLike = {
	readonly state?: unknown;
	readonly requested?: { readonly provider?: unknown; readonly modelId?: unknown };
	readonly applied?: { readonly model?: unknown; readonly via?: unknown };
	readonly error?: unknown;
};

/** Pure copy of the status-bar wording; tests and receipts can share the renderer vocabulary. */
export function formatPendingModelObservation(pending: PendingModelLike | null | undefined): string | null {
	if (!pending || typeof pending.state !== "string") return null;
	const requested = [pending.requested?.provider, pending.requested?.modelId]
		.filter((value): value is string => typeof value === "string" && value.length > 0)
		.join("/");
	switch (pending.state) {
		case "awaiting":
			return requested ? `awaiting OMP · ${requested}` : "awaiting OMP";
		case "in-effect": {
			const applied = typeof pending.applied?.model === "string" && pending.applied.model.length > 0
				? pending.applied.model
				: requested;
			const via = pending.applied?.via === "immediate" ? " · applied at once" : "";
			return applied ? `in effect · ${applied}${via}` : `in effect${via}`;
		}
		case "refused":
			return typeof pending.error === "string" && pending.error.length > 0
				? `refused · ${pending.error}`
				: "refused by the runtime";
		default:
			return null;
	}
}

/**
 * Validate the app path before opening Electron.  This is deliberately pure so a test cannot
 * accidentally launch an installed app while checking the destructive boundary.
 */
export function validateStagedAppPath(
	appPath: string,
	installedAppPath: string,
	temporaryRoot: string,
): { accepted: boolean; reason: string } {
	const app = resolve(appPath);
	const installed = resolve(installedAppPath);
	const temp = resolve(temporaryRoot).replace(/\/$/, "");
	if (!app.endsWith("/Cedia.app")) return { accepted: false, reason: "staged app must end in Cedia.app" };
	if (app === installed || app.startsWith(`${installed}/`)) {
		return { accepted: false, reason: "the installed Cedia.app is not a scratch app" };
	}
	if (!(app === temp || app.startsWith(`${temp}/`))) {
		return { accepted: false, reason: "staged app is outside the temporary directory" };
	}
	return { accepted: true, reason: "staged scratch app" };
}

/**
 * Patch only the two reviewed Electron Login Item calls in a hash-verified scratch bundle.
 * Any source drift fails closed instead of silently broadening the shim's interception scope.
 */
export function applyLoginItemShim(source: string): string {
	const setter = "setLoginItemSettings: (settings) => electronApp.setLoginItemSettings(settings),";
	const getter = "wasOpenedAtLogin = electronApp.getLoginItemSettings().wasOpenedAtLogin === true;";
	if (source.split(setter).length !== 2 || source.split(getter).length !== 2) {
		throw new Error(`${FAIL_PREFIX}: staged Login Item source no longer matches the reviewed Login Item interception points`);
	}
	return source
		.replace(
			setter,
			`setLoginItemSettings: (settings) => { require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "intercept-set-login-item", settings }) + "\\n"); },`,
		)
		.replace(
			getter,
			`wasOpenedAtLogin = false; require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "simulated-login-state", isPackaged: electronApp.isPackaged, openedAtLogin: false }) + "\\n");`,
		);
}

type Clickable = {
	click(options?: Record<string, unknown>): Promise<void>;
};

type StagedLocator = Clickable & {
	first(): StagedLocator;
	waitFor(options?: Record<string, unknown>): Promise<void>;
};

type StagedPage = {
	on(event: string, listener: (...args: unknown[]) => void): void;
	getByText(text: string | RegExp, options?: Record<string, unknown>): StagedLocator;
	locator(selector: string): StagedLocator;
	screenshot(options: Record<string, unknown>): Promise<void>;
};

type StagedApp = {
	firstWindow(): Promise<StagedPage>;
	windows(): StagedPage[];
	close(): Promise<void>;
};

type ElectronLauncher = {
	launch(options: Record<string, unknown>): Promise<StagedApp>;
};

function loadElectronLauncher(): ElectronLauncher {
	const playwright = createRequire(join(root, "desktop/package.json"))("playwright") as unknown;
	if (!playwright || typeof playwright !== "object" || !("_electron" in playwright)) {
		throw new Error(`${FAIL_PREFIX}: Playwright Electron launcher is unavailable`);
	}
	return (playwright as { _electron: ElectronLauncher })._electron;
}

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${FAIL_PREFIX}: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${FAIL_PREFIX}: ${message}`);
	return value as Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function waitFor<T>(label: string, read: () => Promise<T | undefined>, timeoutMs = 90_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await read();
		if (value !== undefined) return value;
		if (Date.now() >= deadline) throw new Error(`${FAIL_PREFIX}: timed out waiting for ${label}`);
		await sleep(250);
	}
}

async function waitForPath(path: string, label: string, timeoutMs = 90_000): Promise<void> {
	await waitFor(label, async () => access(path).then(() => true).catch(() => undefined), timeoutMs);
}

async function requestRaw(host: HostDescriptor, method: string, path: string, body?: unknown): Promise<unknown> {
	const response = await fetch(`${host.url}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${host.token}`,
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
		signal: AbortSignal.timeout(30_000),
	});
	const value = await response.json() as unknown;
	if (!response.ok) throw new Error(`${FAIL_PREFIX}: ${method} ${path} returned ${response.status}: ${JSON.stringify(value)}`);
	return value;
}

async function request(host: HostDescriptor, method: string, path: string, body?: unknown): Promise<unknown> {
	const value = await requestRaw(host, method, path, body);
	return dereferencePackagedResponse(value, async (sha256, offset) =>
		requestRaw(host, "GET", `/v1/responses/${encodeURIComponent(sha256)}?offset=${offset}`));
}

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 }).trim();
}

async function createGitFixture(path: string, name: string, files: Record<string, string>): Promise<void> {
	await mkdir(path, { recursive: true });
	for (const [file, contents] of Object.entries(files)) await writeFile(join(path, file), contents);
	execFileSync("git", ["init", "-q"], { cwd: path, timeout: 30_000 });
	execFileSync("git", ["config", "user.email", `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@example.invalid`], { cwd: path, timeout: 30_000 });
	execFileSync("git", ["config", "user.name", name], { cwd: path, timeout: 30_000 });
	execFileSync("git", ["add", "."], { cwd: path, timeout: 30_000 });
	execFileSync("git", ["commit", "-qm", "fixture base"], { cwd: path, timeout: 30_000 });
	execFileSync("git", ["branch", "-M", "main"], { cwd: path, timeout: 30_000 });
}

async function stopTask(host: HostDescriptor, sessionId: string, incarnation: string): Promise<void> {
	try {
		await request(host, "POST", `/v1/sessions/${encodeURIComponent(sessionId)}/commands`, {
			commandId: `task-controls-abort-${randomUUID()}`,
			incarnation,
			command: "abort",
			payload: {},
		});
	} catch {
		// Cleanup is best effort; the finally block also closes the source host.
	}
	try { await request(host, "POST", `/v1/sessions/${encodeURIComponent(sessionId)}/stop`, {}); } catch { /* best effort */ }
}

type NativeGateResult = {
	readonly enabled: boolean;
	readonly readyPath?: string;
	readonly releasePath?: string;
	readonly releasedAt?: string;
	readonly screenshots?: string[];
	readonly semanticClaim: "operator-observed-only" | "not-run";
};

async function nativeGate(
	name: string,
	instructions: readonly string[],
	output: string,
	app: StagedApp,
	page: StagedPage,
	context: Record<string, unknown>,
): Promise<NativeGateResult> {
	const enabled = process.env.CEDIA_TASK_CONTROLS_CUA === "1" || process.env.CEDIA_PACKAGED_TASK_CONTROLS_CUA === "1";
	if (!enabled) return { enabled: false, semanticClaim: "not-run" };
	const readyPath = join(output, `${name}-ready.json`);
	const releasePath = join(output, `${name}-release`);
	await writeFile(readyPath, `${JSON.stringify({
		name,
		instructions,
		context,
		releasePath,
		deadlineMs: NATIVE_GATE_TIMEOUT_MS,
		semanticClaim: "operator-observed-only",
	}, null, 2)}\n`, { mode: 0o600 });
	console.log(`TASK_CONTROLS_CUA_READY: ${readyPath}`);
	console.log(`TASK_CONTROLS_CUA_INSTRUCTIONS: ${instructions.join(" ")}`);
	await waitForPath(releasePath, `native ${name} observation`, NATIVE_GATE_TIMEOUT_MS);
	const screenshots: string[] = [];
	for (const [index, candidate] of app.windows().entries()) {
		const screenshot = join(output, `${name}-window-${index}.png`);
		await candidate.screenshot({ path: screenshot }).catch(() => {});
		try { await access(screenshot); screenshots.push(screenshot); } catch { /* best effort */ }
	}
	const releasedAt = new Date().toISOString();
	await writeFile(join(output, `${name}-observation.json`), `${JSON.stringify({
		name,
		releasedAt,
		releasePath,
		screenshots,
		semanticClaim: "operator-observed-only",
	}, null, 2)}\n`, { mode: 0o600 });
	void page;
	return { enabled: true, readyPath, releasePath, releasedAt, screenshots, semanticClaim: "operator-observed-only" };
}

async function runDirtyCopyRouteProof(
	host: HostDescriptor,
	projectId: string,
	projectPath: string,
	output: string,
): Promise<Record<string, unknown>> {
	const baseCommit = git(projectPath, ["rev-parse", "main"]);
	const created = record(await request(host, "POST", "/v1/sessions", {
		projectId,
		title: DIRTY_TASK_TITLE,
		workspaceMode: "worktree",
		baseRef: "main",
		dirtyFiles: ["keep.txt"],
	}), "selected dirty route task");
	const sessionId = typeof created.id === "string" ? created.id : "";
	check(sessionId.length > 0, "selected dirty route creates a durable task");
	const cwd = typeof created.cwd === "string" ? created.cwd : "";
	check(cwd.length > 0 && cwd !== projectPath, "selected dirty route creates an isolated worktree");
	const workspace = record(created.workspace, "selected dirty route workspace projection");
	check(workspace.mode === "worktree", "selected dirty route records worktree mode");
	check(workspace.sourceCommit === baseCommit, "baseRef main resolves to the recorded starting commit");
	check(git(cwd, ["rev-parse", "HEAD"]) === baseCommit, "worktree HEAD starts at the selected main commit");
	check(await readFile(join(cwd, "keep.txt"), "utf8") === DIRTY_KEEP, "selected keep.txt modification reaches the worktree");
	check(await readFile(join(cwd, "drop.txt"), "utf8") === DIRTY_DROP_BASE, "unselected drop.txt stays at the base revision");
	check(await readFile(join(projectPath, "keep.txt"), "utf8") === DIRTY_KEEP, "source keep.txt remains dirty and untouched");
	check(await readFile(join(projectPath, "drop.txt"), "utf8") === DIRTY_DROP, "source drop.txt remains dirty and untouched");
	const dirtyCopy = record(workspace.dirtyCopy, "selected dirty route receipt");
	check(dirtyCopy.mode === "selected" && Array.isArray(dirtyCopy.entries), "worktree receipt records selected-copy mode");
	const entries = dirtyCopy.entries as Array<Record<string, unknown>>;
	check(entries.length === 1 && entries[0]?.path === "keep.txt" && entries[0]?.state === "applied", "receipt names only the selected tracked path");
	await writeFile(join(output, "dirty-copy-route.json"), `${JSON.stringify({
		projectId,
		sessionId,
		projectPath,
		worktree: cwd,
		baseRef: "main",
		baseCommit,
		workspace,
		providerRequests: 0,
	}, null, 2)}\n`);
	return { sessionId, worktree: cwd, baseCommit, dirtyCopy: workspace.dirtyCopy };
}

async function main(): Promise<void> {
	const appPathInput = process.env.CEDIA_TASK_CONTROLS_APP_PATH ?? process.env.CEDIA_PACKAGED_TASK_CONTROLS_APP_PATH;
	check(typeof appPathInput === "string" && appPathInput.length > 0,
		"CEDIA_TASK_CONTROLS_APP_PATH names a separately staged scratch Cedia.app");
	const resolvedAppBundle = await realpath(resolve(appPathInput));
	const installedAppBundle = resolve(join(root, `VSCode-darwin-${process.arch}`, "Cedia.app"));
	const temporaryRoot = await realpath(tmpdir());
	const pathCheck = validateStagedAppPath(resolvedAppBundle, installedAppBundle, temporaryRoot);
	check(pathCheck.accepted, pathCheck.reason);
	const appExecutable = join(resolvedAppBundle, "Contents/MacOS/Cedia");
	await access(appExecutable);

	const scratch = await realpath(await mkdtemp(join(tmpdir(), "c-tc-")));
	const profile = join(scratch, "u");
	const home = join(scratch, "h");
	const stateDir = join(scratch, "s");
	const pendingProjectPath = join(scratch, "pending-project");
	const dirtyProjectPath = join(scratch, "dirty-project");
	const output = join(root, "dist/task-controls-packaged-proof", new Date().toISOString().replace(/[:.]/g, "-"));
	const lifecycleShimPath = join(resolvedAppBundle, "Contents/Resources/app/out/vs/cedia/agent/main.cjs");
	const lifecycleShimLogPath = join(output, "login-item-shim.jsonl");
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
	await createGitFixture(pendingProjectPath, "Cedia pending fixture", { "README.md": "Pending model fixture\n" });
	await createGitFixture(dirtyProjectPath, "Cedia dirty fixture", { "keep.txt": DIRTY_KEEP_BASE, "drop.txt": DIRTY_DROP_BASE });
	await writeFile(join(dirtyProjectPath, "keep.txt"), DIRTY_KEEP);
	await writeFile(join(dirtyProjectPath, "drop.txt"), DIRTY_DROP);

	const sourceLifecycleModule = await readFile(join(root, "dist/agent-window/main.cjs"), "utf8");
	const stagedLifecycleModule = await readFile(lifecycleShimPath, "utf8");
	check(createHash("sha256").update(stagedLifecycleModule).digest("hex") === createHash("sha256").update(sourceLifecycleModule).digest("hex"),
		"staged Agent Window main process matches the current source build before shimming");
	const originalLifecycleModule = stagedLifecycleModule;
	let provider: Server | undefined;
	let host: StartedHostServer | undefined;
	let app: StagedApp | undefined;
	let page: StagedPage | undefined;
	let pendingSessionId = "";
	let pendingIncarnation = "";
	let failure: unknown;
	let result: Record<string, unknown> | undefined;
	let providerRequests = 0;
	let pendingGate: NativeGateResult = { enabled: false, semanticClaim: "not-run" };
	let dirtyGate: NativeGateResult = { enabled: false, semanticClaim: "not-run" };

	try {
		await writeFile(lifecycleShimPath, applyLoginItemShim(originalLifecycleModule));
		execFileSync("codesign", ["--force", "--deep", "--sign", "-", resolvedAppBundle], { stdio: "ignore", timeout: 120_000 });
		check(true, "reviewed Login Item shim is installed in the scratch app copy only");

		provider = createServer((request, response) => {
			providerRequests += 1;
			request.resume();
			response.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Provider tripwire: no provider calls are allowed" }));
		});
		await new Promise<void>((resolveListen, reject) => {
			provider!.once("error", reject);
			provider!.listen(0, "127.0.0.1", () => {
				provider!.off("error", reject);
				resolveListen();
			});
		});
		provider.unref();
		const address = provider.address();
		const providerPort = address !== null && typeof address === "object" ? address.port : 0;
		check(providerPort > 0, "loopback provider tripwire is bound");

		host = await startHostServer({
			stateDir,
			ompExecutable: join(root, "apps/host/test/fixtures/fake-host-launcher"),
			ompRequestTimeoutMs: NATIVE_GATE_TIMEOUT_MS,
			ompEnv: {
				...process.env,
				HOME: home,
				CEDIA_NODE: process.execPath,
				CEDIA_FAKE_HOST_MODE: "hold-turn",
				CEDIA_PROVIDER_TRIPWIRE_URL: `http://127.0.0.1:${providerPort}/v1`,
			},
		});
		const pendingProject = host.host.store.createProject({ path: pendingProjectPath, name: PENDING_PROJECT_NAME });
		const dirtyProject = host.host.store.createProject({ path: dirtyProjectPath, name: DIRTY_PROJECT_NAME });
		const pendingSession = host.host.createSession(pendingProject.id, PENDING_TASK_TITLE);
		pendingSessionId = pendingSession.id;
		check(pendingSessionId.length > 0, "pending-model fixture task is durable");

		const electronLauncher = loadElectronLauncher();
		app = await electronLauncher.launch({
			executablePath: appExecutable,
			args: [
				"--user-data-dir", profile,
				"--password-store=basic", "--use-inmemory-secretstorage",
				"--skip-welcome", "--skip-release-notes",
			],
			env: {
				...process.env,
				HOME: home,
				CEDIA_STATE_DIR: stateDir,
				CEDIA_HOST_NODE: process.env.CEDIA_HOST_NODE ?? "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node",
				CEDIA_LIFECYCLE_SHIM_LOG: lifecycleShimLogPath,
				CEDIA_SIMULATE_LOGIN: "0",
				// The application bridge permits at most 300s; native observation
				// deadlines are independent from individual host requests.
				CEDIA_HOST_REQUEST_TIMEOUT_MS: "180000",
			},
			timeout: 45_000,
		});
		page = await app.firstWindow();
		const rendererErrors: string[] = [];
		page.on("pageerror", (...args) => rendererErrors.push(args.map(String).join(" ")));
		// The native operator selects the task at the observation gate. Starting
		// the fixture owner below is host setup, not a synthetic renderer action.

		const hostDescriptor = host.descriptor;
		const started = record(await request(hostDescriptor, "POST", `/v1/sessions/${encodeURIComponent(pendingSessionId)}/start`, {}), "started pending-model task");
		pendingIncarnation = typeof started.incarnation === "string" ? started.incarnation : "";
		check(pendingIncarnation.length > 0, "pending-model task incarnation is readable");
		const commandId = `task-controls-hold-${randomUUID()}`;
		const receipt = record(await request(hostDescriptor, "POST", `/v1/sessions/${encodeURIComponent(pendingSessionId)}/commands`, {
			commandId,
			incarnation: pendingIncarnation,
			command: "prompt",
			payload: { message: "Hold this provider-free turn for pending model observation" },
		}), "held-turn command receipt");
		check(receipt.status === "acknowledged" || receipt.status === "completed", "fake-host accepted the held turn");
		await waitFor("fake-host turn to enter running state", async () => {
			const view = record(await request(hostDescriptor, "GET", `/v1/sessions/${encodeURIComponent(pendingSessionId)}`), "pending-model task view");
			const turns = Array.isArray(view.turns) ? view.turns as Array<Record<string, unknown>> : [];
			return turns.some(turn => turn.state === "running") ? true : undefined;
		}, 30_000);
		const pending = record(await request(hostDescriptor, "POST", `/v1/sessions/${encodeURIComponent(pendingSessionId)}/pending-model`, {
			revision: 1,
			provider: "fixture",
			modelId: "fixture-model-2",
		}), "pending-model route response");
		check(pending.state === "awaiting", `host records ${formatPendingModelObservation(pending as PendingModelLike)}`);
		const pendingView = record(await request(hostDescriptor, "GET", `/v1/sessions/${encodeURIComponent(pendingSessionId)}`), "pending-model task view after selection");
		check(record(pendingView.pendingModel, "pending-model projection").state === "awaiting", "session projection carries the awaiting pending-model record");
		pendingGate = await nativeGate(
			"pending-model",
			[
				`Select ${PENDING_TASK_TITLE} in the staged Cedia Agents window.`,
				"Read the native status bar; expected text is model change · awaiting OMP · fixture/fixture-model-2.",
				"Do not send, approve, or alter the held turn. Record your screenshot/AX notes separately, then touch the releasePath.",
			],
			output,
			app,
			page,
			{ project: PENDING_PROJECT_NAME, task: PENDING_TASK_TITLE, expected: formatPendingModelObservation(pending as PendingModelLike) },
		);

		dirtyGate = await nativeGate(
			"dirty-worktree",
			[
				`Open the ${DIRTY_PROJECT_NAME} row and create a new thread.`,
				"Choose the New worktree environment, keep base branch main, and inspect Carry changes into worktree.",
				"Confirm the real picker lists keep.txt and drop.txt as selected by default; do not send the draft. Record your screenshot/AX notes separately, then touch the releasePath.",
			],
			output,
			app,
			page,
			{ project: DIRTY_PROJECT_NAME, expectedBaseBranch: "main", expectedFiles: ["keep.txt", "drop.txt"], selectedRouteFile: "keep.txt" },
		);

		const dirtyRoute = await runDirtyCopyRouteProof(hostDescriptor, dirtyProject.id, dirtyProjectPath, output);
		check(providerRequests === 0, "provider tripwire received zero requests");
		check(rendererErrors.length === 0, `staged renderer emitted no page errors (${JSON.stringify(rendererErrors.slice(0, 3))})`);
		result = {
			ok: true,
			proof: "packaged-task-controls-observation",
			stagedAppPath: resolvedAppBundle,
			stateDir,
			projects: { pending: pendingProject.id, dirty: dirtyProject.id },
			pendingModel: {
				revision: 1,
				state: "awaiting",
				label: formatPendingModelObservation(pending as PendingModelLike),
				nativeGate: pendingGate,
			},
			dirtyCopy: dirtyRoute,
			nativeGates: { pendingModel: pendingGate, dirtyWorktree: dirtyGate },
			providerRequests,
			semanticAcceptance: "not-claimed-by-fixture-or-DOM-automation",
			limitations: [
				"The host route and selected copy are real provider-free assertions.",
				"Native gates are operator-observed screenshots only; they do not claim full §11.1 semantic acceptance.",
				"The held fake-host turn is not a provider-backed model turn.",
			],
		};
		await writeFile(join(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
		console.log(`Task-controls result: ${JSON.stringify(result)}`);
	} catch (error) {
		failure = error;
		await writeFile(join(output, "failure.json"), `${JSON.stringify({
			ok: false,
			stateDir,
			providerRequests,
			error: error instanceof Error ? error.stack ?? error.message : String(error),
		}, null, 2)}\n`, { mode: 0o600 }).catch(() => {});
		throw error;
	} finally {
		if (pendingSessionId && pendingIncarnation && host) await stopTask(host.descriptor, pendingSessionId, pendingIncarnation);
		await app?.close().catch(() => {});
		await host?.close().catch(() => {});
		if (provider) await new Promise<void>(resolveClose => provider!.close(() => resolveClose()));
		await writeFile(lifecycleShimPath, originalLifecycleModule).catch(() => {});
		try { execFileSync("codesign", ["--force", "--deep", "--sign", "-", resolvedAppBundle], { stdio: "ignore", timeout: 120_000 }); } catch { /* scratch app restore is best effort */ }
		if (failure !== undefined) console.error(`TASK_CONTROLS_FIXTURE_RETAINED: ${scratch}`);
		else if (process.env.CEDIA_KEEP_TASK_CONTROLS !== "1") await rm(scratch, { recursive: true, force: true }).catch(() => {});
		else console.log(`TASK_CONTROLS_FIXTURE_RETAINED: ${scratch}`);
	}
}

if (import.meta.main) await main();
