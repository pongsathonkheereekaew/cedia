/**
 * Paid live native-editor confirmation proof.
 *
 * This fixture owns a scratch workspace, starts the OMP host with the
 * editor bridge enabled, and drives the packaged Cedia Agents window and IDE.
 * A single Muse turn must read and apply an edit to an unsaved native buffer.
 * The host's guarded editor apply produces a real `confirm` request; the
 * approval is answered by clicking the production Agent Window's `Approve
 * once` button.  The editor buffer may change, but the file on disk must not.
 *
 * The fixture is intentionally bounded to one paid prompt.  A model that does
 * not call `cedia_editor`, a missing native editor connection, or an approval
 * surface that cannot be clicked is a failure with the scratch path retained
 * in `dist/native-confirm-packaged-proof/failure.json`.
 *
 * Run: bun scripts/omp-native-confirm-packaged-proof.ts
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	access,
	mkdtemp,
	mkdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";

import { startHostServer } from "../apps/host/src/server.ts";
import { attestOmpRuntime } from "./lib/omp-runtime-integrity.ts";
import {
	findNativeConfirmEditorPage,
	type NativeConfirmEditorPhase,
} from "./lib/omp-native-confirm-editor.ts";
import { resolveOmpUpstreamProviderTab } from "./lib/omp-native-confirm-picker.ts";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import type { Json } from "../packages/protocol/src/index.ts";

const FAIL_PREFIX = "OMP native confirm packaged proof failed";
const MODEL_PROVIDER = "opencode-go";
const MODEL_ID = "muse-spark-1.3-contributor";
const MODEL = `${MODEL_PROVIDER}/${MODEL_ID}`;
const MODEL_LABEL = "Muse Spark 1.3 Contributor";
const BASELINE = "disk original\n";
const DIRTY_TEXT = "unsaved original";
const EDITED_TEXT = "unsaved edited";
const PROMPT_MARKER = "Muse native confirm packaged proof";

type AnyRecord = Record<string, any>;
type Clickable = { click(options?: unknown): Promise<void> };
type Locator = Clickable & {
	count(): Promise<number>;
	evaluateAll<T>(fn: (nodes: Element[]) => T): Promise<T>;
	getByRole(role: string, options?: Record<string, unknown>): Locator;
	getAttribute(name: string): Promise<string | null>;
	focus(): Promise<void>;
	isEnabled(): Promise<boolean>;
	isVisible(): Promise<boolean>;
	waitFor(options?: unknown): Promise<void>;
	locator(selector: string): Locator;
	fill(value: string): Promise<void>;
	innerText(): Promise<string>;
	first(): Locator;
	nth(index: number): Locator;
	press(key: string): Promise<void>;
};
type Page = {
	getByRole(role: string, options?: Record<string, unknown>): Locator;
	getByText(text: string | RegExp, options?: Record<string, unknown>): Locator;
	locator(selector: string): Locator;
	waitForURL(url: RegExp, options?: Record<string, unknown>): Promise<void>;
	waitForFunction(fn: unknown, arg?: unknown, options?: Record<string, unknown>): Promise<void>;
	keyboard: { press(key: string): Promise<void>; insertText(text: string): Promise<void> };
	bringToFront(): Promise<void>;
	screenshot(options: Record<string, unknown>): Promise<void>;
	evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T>;
	url(): string;
	on(event: string, listener: (...args: any[]) => void): void;
};
type ElectronApp = {
	firstWindow(): Promise<Page>;
	waitForEvent(name: string, options?: Record<string, unknown>): Promise<Page>;
	windows(): Page[];
	close(): Promise<void>;
	process?: () => { killed?: boolean; kill(signal?: string): void };
};

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${FAIL_PREFIX}: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message: string): AnyRecord {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${FAIL_PREFIX}: ${message}`);
	return value as AnyRecord;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function waitFor<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs: number, label: string): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let value = await read();
	while (!predicate(value) && Date.now() < deadline) {
		await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
		value = await read();
	}
	if (!predicate(value)) throw new Error(`${FAIL_PREFIX}: timed out waiting for ${label}`);
	return value;
}

const sleep = (milliseconds: number) => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
const normalizeEditorText = (text: string): string => text.replace(/\u00a0/g, " ").replace(/\r?\n/g, "\n");

function isExpectedEditorIconFallback(status: number, rawUrl: string): boolean {
	if (status !== 403) return false;
	try {
		const url = new URL(rawUrl);
		return url.protocol === "vscode-webview:" &&
			url.pathname === "/api/editor-icon" &&
			url.searchParams.get("id") === "vscode";
	} catch {
		return false;
	}
}

async function closeAppBounded(app: ElectronApp | undefined): Promise<void> {
	if (!app) return;
	let closed = false;
	const closing = app.close().then(() => { closed = true; }, () => undefined);
	await Promise.race([closing, new Promise(resolveDelay => setTimeout(resolveDelay, 7_000))]);
	if (closed) return;
	try {
		const child = app.process?.();
		if (child && !child.killed) child.kill("SIGTERM");
	} catch {
		// The app owns additional child windows; host cleanup below remains authoritative.
	}
	await Promise.race([closing, new Promise(resolveDelay => setTimeout(resolveDelay, 3_000))]);
}

const root = resolve(import.meta.dir, "..");
const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/")
	? resolve(requested)
	: ((process.env.PATH ?? "").split(delimiter).map(dir => join(dir, requested)).find(candidate => candidate) ?? requested);
check(await exists(executable), `the OMP runtime exists at ${executable}`);
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `the runtime is OMP ${OMP_BASELINE_VERSION} or later (${version})`);
const attestation = attestOmpRuntime(root, executable);

const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright") as {
	_electron: { launch(options: Record<string, unknown>): Promise<ElectronApp> };
};
// Electron's Code-OSS instance socket is derived from --user-data-dir and macOS
// rejects paths longer than 103 bytes.  Keep this fixture prefix deliberately
// short; the receipt records the expanded canonical path.
const scratch = await realpath(await mkdtemp(join(tmpdir(), "c-")));
const projectPath = join(scratch, "project");
const profile = join(scratch, "p");
const stateDir = join(scratch, "h");
const fixturePath = join(projectPath, "fixture.txt");
const output = join(root, "dist/native-confirm-packaged-proof");
const packagedApp = process.env.CEDIA_PACKAGED_APP_PATH ?? join(root, `VSCode-darwin-${process.arch}`, "Cedia.app");
const appPath = join(packagedApp, "Contents", "MacOS", "Cedia");
const keepScratch = process.env.CEDIA_KEEP_NATIVE_CONFIRM_FIXTURE === "1";
await mkdir(join(projectPath, ".vscode"), { recursive: true });
await mkdir(join(profile, "User"), { recursive: true });
await writeFile(fixturePath, BASELINE);
const ideSettings = {
	"cedia.hostStateDir": stateDir,
	"security.workspace.trust.enabled": false,
	"window.startupEditor": "none",
	"workbench.startupEditor": "none",
	"files.autoSave": "off",
	"update.mode": "none",
	"telemetry.telemetryLevel": "off",
	"extensions.autoCheckUpdates": false,
};
await writeFile(join(projectPath, ".vscode", "settings.json"), `${JSON.stringify(ideSettings, null, 2)}\n`);
await writeFile(join(profile, "User", "settings.json"), `${JSON.stringify(ideSettings, null, 2)}\n`);
execFileSync("git", ["init", "-q"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["config", "user.name", "Cedia native confirm fixture"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["config", "user.email", "cedia-native-confirm@example.invalid"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["add", "."], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["commit", "-qm", "fixture baseline"], { cwd: projectPath, stdio: "ignore" });

// Keep the user's provider profile (credentials and model catalogue) in HOME,
// while isolating OMP's tool policy to this proof.  The native editor bridge is
// Cedia's own confirmation boundary, so OMP's tool policy is yolo here.
const ompOverlay = join(scratch, "omp-config.yml");
await writeFile(ompOverlay, "tools:\n  approvalMode: yolo\n", { mode: 0o600 });

let host: Awaited<ReturnType<typeof startHostServer>> | undefined;
let app: ElectronApp | undefined;
let failure: unknown;
let result: AnyRecord | undefined;
try {
	host = await startHostServer({
		stateDir,
		ompExecutable: executable,
		editorBridge: true,
		ompEnv: {
			...process.env,
			HOME: homedir(),
			PI_CONFIG_FILES: ompOverlay,
			PI_NO_PTY: "1",
			PI_NOTIFICATIONS: "off",
			CEDIA_NODE: process.execPath,
		},
		ompArgs: ["--no-skills", "--no-rules", "--no-extensions"],
	});
	const project = host.host.store.createProject({ path: projectPath, name: "Native confirm fixture" });
	const session = host.host.createSession(project.id, "Muse native confirm task");
	check(session.id.length > 0, "fixture task has a durable session id");

	await mkdir(output, { recursive: true });
	app = await _electron.launch({
		executablePath: appPath,
		args: [
			"--user-data-dir", profile,
			"--password-store=basic", "--use-inmemory-secretstorage",
			"--skip-welcome", "--skip-release-notes",
		],
		env: {
			...process.env,
			CEDIA_STATE_DIR: stateDir,
			CEDIA_HOST_NODE: process.env.CEDIA_HOST_NODE ?? "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node",
			ELECTRON_ENABLE_LOGGING: "1",
		},
		dumpio: true,
		timeout: 45_000,
	});
	const agents = await app.firstWindow();
	const errors: string[] = [];
	const runtimeWarnings: string[] = [];
	const expectedResourceFallbacks: string[] = [];
	const httpFailures: Array<{ status: number; url: string; method: string }> = [];
	const watch = (page: Page, label: string) => {
		page.on("pageerror", (error: Error) => errors.push(`[${label}] ${error.message}`));
		page.on("response", (response: { status(): number; url(): string; request(): { method(): string } }) => {
			if (response.status() >= 400) {
				httpFailures.push({ status: response.status(), url: response.url(), method: response.request().method() });
			}
		});
		page.on("console", (message: { type(): string; text(): string; location(): { url: string } }) => {
			const text = message.text();
			const resourceUrl = message.location().url;
			if (
				text.includes("[Extension Host]") &&
				text.includes("[DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized")
			) {
				runtimeWarnings.push(`[${label}] ${text}`);
				return;
			}
			if (
				message.type() === "error" &&
				text.includes("Failed to load resource: the server responded with a status of 403 (Forbidden)") &&
				isExpectedEditorIconFallback(403, resourceUrl)
			) {
				// Synara's optional native editor icon route is not hosted by the IDE webview;
				// editorMetadata handles its 403 with the packaged Visual Studio Code glyph.
				expectedResourceFallbacks.push(`[${label}] ${resourceUrl}`);
				return;
			}
			if (message.type() === "error") errors.push(`[${label}] ${text} @ ${resourceUrl}`);
		});
	};
	watch(agents, "agents");
	await agents.getByRole("button", { name: "Skip setup", exact: true }).first().click({ timeout: 15_000 }).catch(() => {});
	await agents.getByText("Native confirm fixture", { exact: true }).first().waitFor({ timeout: 60_000 });
	await agents.getByText("Muse native confirm task", { exact: true }).first().click();
	await agents.locator('[contenteditable="true"]').first().waitFor({ timeout: 30_000 });
	console.log("OK   packaged Agent Window selected the fixture task");

	// Open the same workspace in the real Code-OSS window.  The editor bridge
	// registration comes from the Cedia extension, not a synthetic transport.
	const idePromise = app.waitForEvent("window", { predicate: (candidate: Page) => candidate !== agents, timeout: 30_000 });
	const openIde = agents.getByRole("button", { name: "Open in IDE", exact: true });
	await openIde.first().waitFor({ state: "visible", timeout: 20_000 });
	let launched = false;
	for (let index = 0; index < await openIde.count(); index += 1) {
		if (await openIde.nth(index).count() > 0) {
			await openIde.nth(index).click();
			launched = true;
			break;
		}
	}
	check(launched, "Agents window launched the IDE handoff");
	let ide = await idePromise;
	watch(ide, "ide");
	await ide.waitForURL(/workbench/, { timeout: 30_000 });
	await ide.locator(".monaco-workbench").first().waitFor({ timeout: 30_000 });
	// The Cedia extension registers its editor poller when the Agent dock is
	// resolved.  A fresh Code-OSS window may leave the auxiliary bar lazy, so
	// focus the shipped command exactly as a user would before waiting on the
	// host-side connection registry.
	await ide.keyboard.press("Meta+Shift+P");
	const commandInput = ide.locator(".quick-input-widget input").first();
	await commandInput.waitFor({ timeout: 15_000 });
	await commandInput.fill(">Focus Composer");
	const focusComposer = ide.getByText("Cedia: Focus Composer", { exact: true }).first();
	try {
		await focusComposer.waitFor({ state: "visible", timeout: 20_000 });
	} catch (error) {
		const diagnostics = {
			capturedAt: new Date().toISOString(),
			url: ide.url(),
			widget: await ide.locator(".quick-input-widget").first().innerText().catch(() => ""),
			rows: await ide.locator(".quick-input-list .monaco-list-row").evaluateAll(nodes => nodes.map(node => node.textContent?.trim() ?? "")).catch(() => []),
			body: (await ide.evaluate(() => document.body?.innerText ?? "").catch(() => "")).slice(0, 6_000),
			error: error instanceof Error ? error.message : String(error),
		};
		await ide.screenshot({ path: join(output, "focus-composer-command-failure.png") }).catch(() => {});
		await writeFile(join(output, "focus-composer-command-failure.json"), `${JSON.stringify(diagnostics, null, 2)}\\n`).catch(() => {});
		throw new Error(`${FAIL_PREFIX}: Focus Composer command result is missing; ${JSON.stringify({ widget: diagnostics.widget, rows: diagnostics.rows })}`);
	}
	check(true, "the packaged IDE shows the Cedia Focus Composer command result");
	await focusComposer.click();
	await ide.locator(".quick-input-widget").first().waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
	await waitFor(async () => host!.editors.hasConnection(projectPath), value => value === true, 90_000, "the real IDE editor connection");
	console.log("OK   packaged Code-OSS registered the real editor bridge");

	// Open and dirty the fixture through Code-OSS's own editor. Resolve the actual
	// Monaco page across all packaged windows: the handoff page can stay attached
	// to the original workbench while the file-opening IPC is handled by a second
	// renderer. The direct preload call mirrors the shipped Agents `Open in IDE`
	// path and validates the absolute file target in the production main process.
	await ide.bringToFront();
	const editorText = async (candidate: Page): Promise<string> => normalizeEditorText(await candidate.evaluate(() => {
		// Monaco virtualizes individual view-line nodes.  During the initial
		// layout those nodes can be absent even though the workbench has already
		// opened the model; the view-lines/editor container still carries the
		// rendered text and is the same surface the user sees.
		const lines = document.querySelector(".monaco-editor .view-lines") ?? document.querySelector(".monaco-editor");
		return lines?.textContent ?? "";
	}).catch(() => ""));
	const findEditorPage = async (phase: NativeConfirmEditorPhase, timeoutMs: number, label: string): Promise<Page | null> => {
		try {
			return await waitFor(
				async () => {
					const pages = [];
					for (const candidate of app!.windows()) {
						const text = await editorText(candidate);
						const body = normalizeEditorText(await candidate.evaluate(() => document.body?.innerText ?? "").catch(() => ""));
						pages.push({
							page: candidate,
							editorText: text,
							bodyText: body,
							hasMonaco: await candidate.locator(".monaco-editor").count() > 0,
						});
					}
					return findNativeConfirmEditorPage(pages, phase, BASELINE.trim(), EDITED_TEXT);
				},
				value => value !== null,
				timeoutMs,
				label,
			);
			} catch { return null; }
		};
	await agents.evaluate(async ({ cwd, path, sessionId }: { cwd: string; path: string; sessionId: string }) => {
		const bridge = (window as unknown as { vscode?: { ipcRenderer?: { invoke(channel: string, input: unknown): Promise<unknown> } } }).vscode?.ipcRenderer;
		if (!bridge?.invoke) throw new Error("Packaged Agents preload IPC is unavailable");
		await bridge.invoke("vscode:cediaAgent", { kind: "openIde", cwd, path, line: 1, sessionId });
	}, { cwd: projectPath, path: fixturePath, sessionId: session.id });
	console.log("OK   packaged Agents preload invoked the validated absolute-file IDE handoff");
	let editorPage = await findEditorPage("opened", 45_000, "the Monaco editor after the production openIde bridge");
	if (editorPage === null) {
		// Keep a bounded scratch-only diagnosis. It captures enough renderer state
		// to distinguish a wrong page, a blank workbench, and a lazy Quick Input
		// surface; it never turns a missing Monaco buffer into a pass.
		const diagnostics: Array<Record<string, unknown>> = [];
		for (const [index, candidate] of app.windows().entries()) {
			const body = await candidate.evaluate(() => (document.body?.innerText ?? "").slice(0, 2_000)).catch(() => "");
			const quickState = await candidate.evaluate(() => Array.from(document.querySelectorAll(".quick-input-widget input")).map(node => ({
				visible: Boolean((node as HTMLElement).offsetWidth || (node as HTMLElement).offsetHeight || (node as HTMLElement).getClientRects().length),
				value: (node as HTMLInputElement).value,
			}))).catch(() => []);
			await candidate.screenshot({ path: join(output, `editor-open-failure-${index}.png`) }).catch(() => {});
			diagnostics.push({ index, url: candidate.url(), body, quickState });
		}
		await writeFile(join(output, "editor-open-failure.json"), `${JSON.stringify(diagnostics, null, 2)}\n`).catch(() => {});
	}
	check(editorPage !== null, `the packaged IDE opened ${fixturePath} in Monaco`);
	ide = editorPage;
	await ide.locator(".monaco-editor").first().waitFor({ timeout: 30_000 });
	const readEditorText = async (): Promise<string> => await editorText(ide);
	await waitFor(readEditorText, value => value.includes(BASELINE.trim()), 20_000, "the fixture text in the Monaco buffer");
	const lines = ide.locator(".monaco-editor .view-lines").first();
	await lines.waitFor({ timeout: 15_000 });
	const inputArea = ide.locator(".monaco-editor textarea.inputarea").first();
	if (await inputArea.count() > 0) await inputArea.click();
	else await lines.click();
	await ide.keyboard.press("Meta+A");
	await ide.keyboard.insertText(DIRTY_TEXT);
	await waitFor(readEditorText, value => value.includes(DIRTY_TEXT), 20_000, "the unsaved native editor text");
	check(await readFile(fixturePath, "utf8") === BASELINE, "typing the dirty buffer did not change disk");
	console.log("OK   Code-OSS holds the expected unsaved native buffer");

	// Start OMP only after the real editor is registered.  Selecting and reading
	// the model through the host is explicit and precedes the only paid prompt.
	const started = await host.host.startSession(session.id);
	let commandNumber = 0;
	const issue = (command: string, payload: Record<string, Json>) => host!.host.command(session.id, "native-confirm-proof", {
		commandId: `native-confirm-${++commandNumber}`,
		incarnation: started.incarnation,
		command,
		payload,
	});
	// `startSession` returns before the OMP worker has finished its startup
	// handshake. Retry only that documented transient error, with a fresh
	// command id each time; all other host failures remain hard proof failures.
	let modelCommand: Awaited<ReturnType<typeof issue>> | undefined;
	const modelDeadline = Date.now() + 45_000;
	while (modelCommand === undefined && Date.now() < modelDeadline) {
		try {
			modelCommand = await issue("set_model", { provider: MODEL_PROVIDER, modelId: MODEL_ID });
		} catch (error) {
			const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
			if (code !== "session_starting") throw error;
			await sleep(250);
		}
	}
	check(modelCommand !== undefined, `the host became ready for explicit ${MODEL} selection`);
	check(["completed", "acknowledged"].includes(modelCommand.status), `the host accepted explicit ${MODEL} selection (${modelCommand.status})`);
	const stateResponse = await host.router({ method: "GET", path: `/v1/sessions/${session.id}/model-state`, token: host.auth.ownerToken });
	check(stateResponse.status === 200, `the host model-state readback answered (${stateResponse.status})`);
	const state = record(stateResponse.body, "model-state response");
	check(state.available === true, "the selected task exposes a live model-state projection");
	const effective = record(state.model, "effective model");
	check(effective.provider === MODEL_PROVIDER && effective.id === MODEL_ID, `model-state readback is ${MODEL}`);

	await agents.bringToFront();
	await agents.getByRole("button", { name: "Change model and reasoning" }).click();
	const picker = agents.locator("[data-model-picker-popup]");
	await picker.waitFor({ state: "visible", timeout: 20_000 });
	const readProviderTabs = async () => await picker.locator('[role="tab"]').evaluateAll(nodes => nodes.map(node => ({
		label: node.getAttribute("aria-label") ?? "",
		stableTabId: node.getAttribute("data-provider-tab"),
		selected: node.getAttribute("aria-selected") === "true",
	})));
	const expectedTabId = `upstream:${MODEL_PROVIDER}`;
	let providerTabs: Awaited<ReturnType<typeof readProviderTabs>>;
	try {
		providerTabs = await waitFor(
			readProviderTabs,
			tabs => resolveOmpUpstreamProviderTab(tabs, MODEL_PROVIDER) !== undefined,
			30_000,
			`the ${expectedTabId} picker tab to hydrate from the live model catalog`,
		);
	} catch (error) {
		providerTabs = await readProviderTabs();
		await writeFile(join(output, "model-picker-failure.json"), `${JSON.stringify({
			capturedAt: new Date().toISOString(),
			model: MODEL,
			providerTabs,
			visibleMenuItems: await picker.getByRole("menuitem").evaluateAll(nodes => nodes.map(node => node.textContent?.trim() ?? "")),
			body: (await agents.locator("body").innerText().catch(() => "")).slice(0, 8_000),
			error: error instanceof Error ? error.message : String(error),
		}, null, 2)}\n`);
		await agents.screenshot({ path: join(output, "model-picker-failure.png") }).catch(() => {});
		throw new Error(`${FAIL_PREFIX}: upstream provider tab ${expectedTabId} did not hydrate; tabs: ${JSON.stringify(providerTabs)}`);
	}
	const providerTab = resolveOmpUpstreamProviderTab(providerTabs, MODEL_PROVIDER);
	if (!providerTab) {
		throw new Error(`${FAIL_PREFIX}: upstream provider tab ${expectedTabId} is missing after hydration; tabs: ${JSON.stringify(providerTabs)}`);
	}
	if (!providerTab.selected) {
		await picker.getByRole("tab", { name: providerTab.label, exact: true }).click();
		await waitFor(
			() => picker.getByRole("tab", { name: providerTab.label, exact: true }).getAttribute("aria-selected"),
			value => value === "true",
			5_000,
			`the ${providerTab.label} model-provider tab to become selected`,
		);
	}
	try {
		const modelSearch = agents.getByRole("searchbox", { name: "Search models" });
		await modelSearch.fill(MODEL_ID);
		const modelRow = picker.getByRole("menuitem").first();
		await modelRow.waitFor({ state: "visible", timeout: 30_000 });
		const modelRowLabel = await modelRow.innerText();
		check(
			modelRowLabel.includes(MODEL_LABEL),
			`the exact-provider tab and model-id search expose ${MODEL_LABEL} (${modelRowLabel.trim()})`,
		);
		await modelRow.click();
	} catch (error) {
		const diagnostics = {
			capturedAt: new Date().toISOString(),
			model: MODEL,
			providerTabs,
			selectedTab: providerTab.label,
			search: MODEL_ID,
			visibleMenuItems: await picker.getByRole("menuitem").evaluateAll(nodes => nodes.map(node => node.textContent?.trim() ?? "")).catch(() => []),
			body: (await agents.locator("body").innerText().catch(() => "")).slice(0, 8_000),
			error: error instanceof Error ? error.message : String(error),
		};
		await writeFile(join(output, "model-picker-failure.json"), `${JSON.stringify(diagnostics, null, 2)}\n`).catch(() => {});
		await agents.screenshot({ path: join(output, "model-picker-failure.png") }).catch(() => {});
		throw error;
	}
	await waitFor(
		async () => host!.router({ method: "GET", path: `/v1/sessions/${session.id}/model-state`, token: host!.auth.ownerToken }),
		response => response.status === 200 && record(record(response.body, "composer model readback").model, "composer selected model").provider === MODEL_PROVIDER && record(record(response.body, "composer model readback").model, "composer selected model").id === MODEL_ID,
		30_000,
		"the real composer model selection to match the paid model",
	);
	const modelLabel = await agents.getByRole("button", { name: "Change model and reasoning" }).innerText();
	check(modelLabel.includes(MODEL_LABEL), `the composer displays the Muse model label after exact host readback (${modelLabel.trim()})`);
	const composer = agents.locator('[contenteditable="true"]').first();
	const promptText = `${PROMPT_MARKER}: use the Cedia native editor tool only. First call cedia_editor with kind read for fixture.txt. Then call cedia_editor with kind apply and path "fixture.txt", using that exact returned handle, documentVersion as expectedVersion, and sha256 as expectedHash. For edits use exactly [{range:{start:{line:0,character:0},end:{line:0,character:16}},text:"${EDITED_TEXT}"}] to replace the full current buffer ${DIRTY_TEXT}. Do not send content, newText, or use filesystem tools. After the guarded apply succeeds, call cedia_editor read once and reply done.`;
	await composer.fill(promptText);
	await agents.waitForFunction(() => {
		const button = document.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
		return !!button && !button.disabled;
	}, undefined, { timeout: 15_000 });
	const draftResponse = await waitFor(
		async () => host!.router({ method: "GET", path: `/v1/drafts/${session.id}`, token: host!.auth.ownerToken }),
		response => response.status === 200 && record(response.body, "composer draft response").text === promptText,
		30_000,
		"the composer draft to become durable with the exact native-editor prompt",
	);
	check(draftResponse.status === 200, `the composer draft is durable before dispatch (${draftResponse.status})`);
	const draft = record(draftResponse.body, "durable composer draft");
	check(draft.text === promptText, "the durable composer draft matches the native-editor prompt");
	check(agents.url().endsWith(`#/${session.id}`), `the Agent Window route is the selected fixture task (${agents.url()})`);
	const taskBodyBeforeSend = await agents.locator("body").innerText();
	check(taskBodyBeforeSend.includes("Native confirm fixture") && taskBodyBeforeSend.includes("Muse native confirm task"), "the Agent Window body names the selected fixture task");
	await agents.screenshot({ path: join(output, "composer-ready-before-host-prompt.png") });
	let sendUiFailure: string | null = null;
	const promptTextVisible = () => agents.locator("body").innerText();
	const composerForm = agents.locator('form[data-chat-composer-form="true"]').first();
	const formBinding = await composerForm.evaluateAll(nodes => {
		const form = nodes[0] as (HTMLFormElement & AnyRecord) | undefined;
		if (!form) return { found: false, onSubmitType: "missing" };
		const reactPropsKey = Object.keys(form).find(key => key.startsWith("__reactProps$"));
		const props = reactPropsKey ? form[reactPropsKey] as Record<string, unknown> | undefined : undefined;
		const onSubmit = props?.onSubmit;
		const sendButtons = Array.from(form.querySelectorAll<HTMLButtonElement>('button[aria-label="Send message"]'));
		return {
			found: true,
			hasReactProps: reactPropsKey !== undefined,
			onSubmitType: typeof onSubmit,
			formCount: document.querySelectorAll("form").length,
			sendButtonCount: sendButtons.length,
			sendButton: sendButtons[0] ? {
				type: sendButtons[0].type,
					belongsToComposerForm: sendButtons[0].form === form,
					closestFormIsComposerForm: sendButtons[0].closest("form") === form,
					formId: sendButtons[0].form?.id ?? null,
					outerHTML: sendButtons[0].outerHTML.slice(0, 1_000),
			} : null,
		};
	});
	check(formBinding.onSubmitType === "function", `the packaged composer form is bound to a React submit handler (${JSON.stringify(formBinding)})`);
	const sendButton = composerForm.getByRole("button", { name: "Send message", exact: true }).first();
	await sendButton.waitFor({ state: "visible", timeout: 15_000 });
	check(await sendButton.isEnabled(), "the production composer send button is enabled for the exact prompt");
	await sendButton.click();
	let promptCommand: ReturnType<typeof host.host.store.listCommands>[number] | undefined;
	try {
		promptCommand = await waitFor(
			async () => {
				const commands = host!.host.store.listCommands(session.id);
				const uiText = await promptTextVisible().catch(() => "");
				const failureText = /Could not save editor changes|Provider status is still loading|not authenticated|unavailable right now|Unable to refresh provider status/i.exec(uiText)?.[0];
				if (failureText) sendUiFailure = failureText;
				return commands.find(command => command.kind === "prompt" && JSON.stringify(command.payload).includes(PROMPT_MARKER));
			},
			value => value !== undefined,
			60_000,
			"the durable Muse prompt command after the Agent Window send",
		);
	} catch (error) {
		const draftAfter = await host.router({ method: "GET", path: `/v1/drafts/${session.id}`, token: host.auth.ownerToken }).catch(() => ({ status: 0, body: undefined }));
		const sendDiagnostics = {
			capturedAt: new Date().toISOString(),
			route: agents.url(),
			body: await agents.locator("body").innerText().catch(() => ""),
			formBinding,
			sendUiFailure,
			sendButtons: await composerForm.locator('button[aria-label]').evaluateAll(nodes => nodes.map(node => {
				const button = node as HTMLButtonElement;
				const bounds = button.getBoundingClientRect();
				return {
					label: button.getAttribute("aria-label"),
					disabled: button.disabled,
					visible: Boolean(bounds.width && bounds.height),
					text: button.innerText,
				};
			})).catch(() => []),
			rendererErrors: errors,
			draftAfter,
			commands: host.host.store.listCommands(session.id).filter(command => ["prompt", "steer", "follow_up"].includes(command.kind)).map(command => ({ commandId: command.commandId, kind: command.kind, status: command.status, error: command.error })),
			turns: host.host.store.listTurnIntents(session.id).map(turn => ({ turnIntentId: turn.turnIntentId, state: turn.state, reason: turn.reason, model: turn.model, updatedAt: turn.updatedAt })),
		};
		await agents.screenshot({ path: join(output, "send-failure.png") }).catch(() => {});
		await writeFile(join(output, "send-failure.json"), `${JSON.stringify(sendDiagnostics, null, 2)}\n`).catch(() => {});
		throw error;
	}
	check(promptCommand !== undefined, "the Agents window created exactly one durable prompt command");
	check(sendUiFailure === null, "the production composer reported no send preflight error");

	// The host pending request is the independent protocol assertion; the button
	// click below proves the production Agent Window actually answers that request.
	const pending = await waitFor(
		async () => host!.host.pendingUi(session.id) as Array<{ token: string; request?: { method?: string; title?: string; message?: string }}>,
		rows => rows.some(row => row.request?.method === "confirm"),
		300_000,
		"the native editor confirm request from the Muse turn",
	);
	const confirm = pending.find(row => row.request?.method === "confirm");
	check(confirm?.token, "the native editor confirm has a broker token");
	check(confirm?.request?.title === "Allow this editor change?", `the broker request is native editor confirmation (${confirm?.request?.title ?? "missing title"})`);
	const brokerMessage = confirm?.request?.message;
	check(typeof brokerMessage === "string", "the native editor confirm includes a broker tool-call payload");
	const brokerCall = record(JSON.parse(brokerMessage), "native editor confirm payload");
	check(brokerCall.type === "host_tool_call" && brokerCall.toolName === "cedia_editor", "the approval is for the Cedia editor host tool");
	const brokerArgs = record(brokerCall.arguments, "native editor apply arguments");
	check(brokerArgs.kind === "apply" && brokerArgs.path === "fixture.txt", "the approval targets the fixture's apply operation");
	check(brokerArgs.content === undefined && Array.isArray(brokerArgs.edits) && brokerArgs.edits.length === 1, "the approval uses the native editor's edits schema");
	const priorToolEvents = host!.host.store.readEvents(session.id, 0, 1_000).events
		.map(event => record(event.frame, "native editor transcript frame"))
		.filter(frame => frame.type === "tool_execution_end" && frame.toolName === "cedia_editor");
	check(priorToolEvents.length >= 1, "the host journal contains the real native-editor read result");
	const priorToolResult = record(priorToolEvents[0]!.result, "native editor read result");
	const priorContent = priorToolResult.content;
	check(Array.isArray(priorContent) && priorContent.length > 0, "the native-editor read result has text content");
	const readResult = record(JSON.parse(record(priorContent[0], "native editor read content").text), "native editor read response");
	const readDocument = record(readResult.document, "native editor read document");
	const readHandle = record(readDocument.handle, "native editor document handle");
	check(readResult.kind === "read" && readDocument.path === fixturePath, "the model read the exact fixture file through the native editor");
	const brokerHandle = record(brokerArgs.handle, "native editor approval handle");
	check(
		brokerHandle.id === readHandle.id &&
		brokerHandle.uri === pathToFileURL(fixturePath).href &&
		brokerArgs.expectedVersion === readDocument.documentVersion &&
		brokerArgs.expectedHash === readDocument.sha256,
		"the approved edit echoes the exact handle, version, and hash returned by the read",
	);
	const brokerEdit = record(brokerArgs.edits[0], "native editor text edit");
	const brokerRange = record(brokerEdit.range, "native editor text range");
	const brokerStart = record(brokerRange.start, "native editor range start");
	const brokerEnd = record(brokerRange.end, "native editor range end");
	check(brokerEdit.text === EDITED_TEXT && brokerStart.line === 0 && brokerStart.character === 0 && brokerEnd.line === 0 && brokerEnd.character === DIRTY_TEXT.length, "the approval contains the exact guarded buffer replacement");
	// The production card renders the choice as an option row in the packaged
	// Agent Window. A stale button with the same accessible name can remain in
	// the DOM while the task is still loading, so require a visible option and a
	// visible ancestor containing the native-confirm title before interacting.
	type ApprovalSnapshot = {
		optionCount: number;
		titleCount: number;
		cardVisible: boolean;
		optionVisible: boolean;
		buttonEnabled: boolean;
		buttonHitTest: boolean;
		cardText: string;
	};
	const readApprovalSnapshot = async (): Promise<ApprovalSnapshot> => await agents.evaluate(() => {
		const visible = (node: Element | null): boolean => {
			if (!node) return false;
			const element = node as HTMLElement;
			const style = window.getComputedStyle(element);
			return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && Boolean(element.getClientRects().length);
		};
		const exactOptions = Array.from(document.querySelectorAll("*")).filter(node => node.textContent?.trim() === "Approve once");
		const titles = Array.from(document.querySelectorAll("*")).filter(node => node.textContent?.trim() === "Allow this editor change?");
		for (const exact of exactOptions) {
			let ancestor: Element | null = exact;
			for (let depth = 0; ancestor && depth < 10; depth += 1, ancestor = ancestor.parentElement) {
				const text = ancestor.textContent ?? "";
				if (text.includes("Allow this editor change?") && text.includes("Approve once")) {
					const button = exact.closest("button") as HTMLButtonElement | null;
					const bounds = button?.getBoundingClientRect();
					const hit = bounds && bounds.width > 0 && bounds.height > 0
						? document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
						: null;
					return {
						optionCount: exactOptions.length,
						titleCount: titles.length,
						cardVisible: visible(ancestor),
						optionVisible: visible(exact),
						buttonEnabled: button !== null && !button.disabled,
						buttonHitTest: button !== null && hit !== null && (hit === button || button.contains(hit)),
						cardText: text.slice(0, 1_000),
					};
				}
			}
		}
		return { optionCount: exactOptions.length, titleCount: titles.length, cardVisible: false, optionVisible: false, buttonEnabled: false, buttonHitTest: false, cardText: "" };
	});
	const writeApprovalDiagnostics = async (stage: string, snapshot: ApprovalSnapshot): Promise<void> => {
		const diagnostics = {
			capturedAt: new Date().toISOString(),
			stage,
			route: agents.url(),
			body: await agents.locator("body").innerText().catch(() => ""),
			snapshot,
			pending: host!.host.pendingUi(session.id),
			commands: host!.host.store.listCommands(session.id).filter(command => ["prompt", "steer", "follow_up"].includes(command.kind)).map(command => ({ commandId: command.commandId, kind: command.kind, status: command.status, error: command.error })),
			turns: host!.host.store.listTurnIntents(session.id).map(turn => ({ turnIntentId: turn.turnIntentId, state: turn.state, reason: turn.reason, model: turn.model, updatedAt: turn.updatedAt })),
		};
		await agents.screenshot({ path: join(output, "approval-failure.png") }).catch(() => {});
		await writeFile(join(output, "approval-failure.json"), `${JSON.stringify(diagnostics, null, 2)}\n`).catch(() => {});
	};
	let approvalSnapshot: ApprovalSnapshot;
	try {
		approvalSnapshot = await waitFor(readApprovalSnapshot, value => value.cardVisible && value.optionVisible, 45_000, "the visible native editor approval card");
	} catch (error) {
		await writeApprovalDiagnostics("card-not-visible", await readApprovalSnapshot());
		throw error;
	}
	check(approvalSnapshot.cardVisible && approvalSnapshot.optionVisible, "Approve once is visible inside the native editor confirm card");
	await agents.screenshot({ path: join(output, "approval-prompt.png") });
	// The broker confirmation is time-bounded. Use the fresh DOM snapshot to
	// verify enabled state and hit testing; avoid a second accessibility query
	// consuming the response deadline before sending input.
	const buttonState = {
		visible: approvalSnapshot.optionVisible,
		enabled: approvalSnapshot.buttonEnabled,
		hitTest: approvalSnapshot.buttonHitTest,
		card: approvalSnapshot,
	};
	await writeFile(join(output, "approval-button-ready.json"), `${JSON.stringify({ capturedAt: new Date().toISOString(), pending: host!.host.pendingUi(session.id), buttonState }, null, 2)}\n`).catch(() => {});
	await agents.screenshot({ path: join(output, "approval-button-ready.png") });
	check(buttonState.visible && buttonState.enabled && buttonState.hitTest, "the Approve once button is visible, enabled, and receives center-point hit testing");
	const approveOption = agents.getByText("Approve once", { exact: true }).first();
	try {
		await approveOption.click({ force: true, timeout: 5_000 });
	} catch (error) {
		await writeApprovalDiagnostics("semantic-approve-click-failed", await readApprovalSnapshot());
		throw error;
	}
	try {
		await waitFor(
			async () => host!.host.pendingUi(session.id) as Array<{ token: string; request?: { method?: string; title?: string; message?: string }}>,
			rows => !rows.some(row => row.request?.method === "confirm"),
			15_000,
			"the native editor confirm to settle after the Approve once click",
		);
	} catch (error) {
		await writeApprovalDiagnostics("semantic-approve-click-did-not-settle", await readApprovalSnapshot());
		throw error;
	}
	console.log("OK   production Agent Window approved visible Approve once via semantic click");

	const completed = await waitFor(
		async () => host!.host.store.getCommand(session.id, promptCommand!.commandId),
		value => value?.status === "completed" || value?.status === "failed" || value?.status === "outcome_unknown",
		180_000,
		"the Muse prompt command completion",
	);
	check(completed?.status === "completed", `the approved Muse turn completed (${completed?.status ?? "missing"})`);
	// The production file-open bridge can hand focus to a second Code-OSS renderer.
	// Re-resolve the page that currently owns the Monaco model after the apply;
	// retaining the earlier Page object may read a closed handoff window forever.
	const editedPage = await findEditorPage("approved", 60_000, "the Monaco page after the guarded apply");
	check(editedPage !== null, "the packaged IDE still has a live Monaco editor after approval");
	ide = editedPage;
	const editedLines = ide.locator(".monaco-editor .view-lines").first();
	await editedLines.waitFor({ timeout: 15_000 });
	await waitFor(async () => editorText(ide), value => value.includes(EDITED_TEXT), 60_000, "the native editor buffer after approval");
	const bufferText = await editorText(ide);
	check(bufferText.includes(EDITED_TEXT), "the native editor buffer contains the approved edit");
	check(!bufferText.includes(DIRTY_TEXT), "the native editor buffer no longer contains the old text");
	check(await readFile(fixturePath, "utf8") === BASELINE, "the guarded native apply left disk at the original bytes");
	check((host.host.pendingUi(session.id) as unknown[]).length === 0, "the native confirm broker is settled after the click");
	const unexpectedHttpFailures = httpFailures.filter(
		failure => !isExpectedEditorIconFallback(failure.status, failure.url),
	);
	check(unexpectedHttpFailures.length === 0, `packaged surfaces loaded all resources except the documented editor-icon fallback (${JSON.stringify(unexpectedHttpFailures).slice(0, 300)})`);
	check(errors.length === 0, `packaged surfaces emitted no renderer errors (${JSON.stringify(errors).slice(0, 300)})`);
	await agents.screenshot({ path: join(output, "approved-editor-buffer.png") });
	result = {
		capturedAt: new Date().toISOString(),
		ok: true,
		model: MODEL,
		paidPromptTurns: 1,
		runtimeWarnings,
		expectedResourceFallbacks,
		httpFailures,
		approvalMethod: "production-agent-window-approve-once-card-shortcut",
		nativeEditor: true,
		bufferText,
		diskText: await readFile(fixturePath, "utf8"),
		workspace: projectPath,
		sessionId: session.id,
		version,
		...attestation,
		checks: [
			"explicit-model-selection-and-model-state-readback",
			"real-codeoss-editor-registration",
			"unsaved-native-buffer-read",
			"native-editor-confirm-pending",
			"production-agent-window-approve-once-click",
			"guarded-native-buffer-apply",
			"disk-unchanged-after-native-apply",
			"correlated-prompt-completion",
		],
	};
	await writeFile(join(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
	console.log(JSON.stringify(result));
} catch (error) {
	failure = error;
	const diagnostic: AnyRecord = {
		capturedAt: new Date().toISOString(),
		ok: false,
		model: MODEL,
		workspace: projectPath,
		stateDir,
		fixturePath,
		version,
		...attestation,
		error: error instanceof Error ? error.stack ?? error.message : String(error),
	};
	try { await writeFile(join(output, "failure.json"), `${JSON.stringify(diagnostic, null, 2)}\n`); } catch { /* preserve original failure */ }
	console.error(`${FAIL_PREFIX}: ${diagnostic.error}`);
	throw error;
} finally {
	await closeAppBounded(app);
	await host?.close().catch(() => {});
	if (failure === undefined && result !== undefined && !keepScratch) await rm(scratch, { recursive: true, force: true });
	else console.error(`FIXTURE RETAINED: ${scratch}`);
}
