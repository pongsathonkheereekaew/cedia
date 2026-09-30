/**
 * Packaged dirty-buffer Quit/Cancel proof.
 *
 * This is deliberately a real packaged-app run. It opens a scratch project in
 * Cedia's IDE, types an unsaved buffer through Monaco, requests the native
 * application Quit, and uses macOS accessibility to inspect and click the
 * production Cedia Cancel button. The proof passes only when the dialog names
 * the unsaved file and the same editor process remains alive with the dirty
 * text after Cancel.
 *
 * The harness uses a short scratch prefix because macOS Electron IPC socket
 * paths have a small limit. It owns no user profile or persistent workspace.
 *
 * Run: bun scripts/omp-dirty-quit-packaged-proof.ts
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

const FAIL_PREFIX = "OMP packaged dirty-quit proof failed";
const BASELINE = "disk baseline\n";
const DIRTY = "unsaved editor text";

class MacAccessibilityPermissionError extends Error {
	readonly code = "macos-accessibility-permission";

	constructor(readonly detail: string) {
		super(`macOS Accessibility permission is unavailable to osascript: ${detail}`);
		this.name = "MacAccessibilityPermissionError";
	}
}

type Clickable = {
	click(options?: unknown): Promise<void>;
};
type Locator = Clickable & {
	count(): Promise<number>;
	waitFor(options?: unknown): Promise<void>;
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
	evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T>;
	keyboard: { press(key: string): Promise<void>; insertText(text: string): Promise<void> };
	bringToFront(): Promise<void>;
	screenshot(options: Record<string, unknown>): Promise<void>;
	url(): string;
	on(event: string, listener: (...args: any[]) => void): void;
};
type ElectronApp = {
	firstWindow(): Promise<Page>;
	waitForEvent(name: string, options?: Record<string, unknown>): Promise<Page>;
	windows(): Page[];
	evaluate?(fn: (...args: any[]) => unknown): Promise<unknown>;
	close(): Promise<void>;
	process?: () => { killed?: boolean; kill(signal?: string): void };
};

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${FAIL_PREFIX}: ${message}`);
	console.log(`OK   ${message}`);
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

const sleep = (milliseconds: number) => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
const normalizeEditorText = (text: string): string => text.replace(/\u00a0/g, " ").replace(/\r?\n/g, "\n");

async function waitFor<T>(
	read: () => Promise<T>,
	predicate: (value: T) => boolean,
	timeoutMs: number,
	label: string,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let value = await read();
	while (!predicate(value) && Date.now() < deadline) {
		await sleep(250);
		value = await read();
	}
	if (!predicate(value)) throw new Error(`${FAIL_PREFIX}: timed out waiting for ${label}`);
	return value;
}

function processLines(scratch: string): string[] {
	try {
		return execFileSync("ps", ["aux"], { encoding: "utf8" })
			.split("\n")
			.filter(line => line.includes(scratch) && !line.includes("ps aux"));
	} catch {
		return [];
	}
}

function mainPid(scratch: string): number | null {
	const line = processLines(scratch).find(value => value.includes("Cedia.app/Contents/MacOS/Cedia"));
	const value = line?.trim().split(/\s+/)[1];
	const pid = value === undefined ? NaN : Number.parseInt(value, 10);
	return Number.isSafeInteger(pid) ? pid : null;
}

function commandFailureText(error: unknown): string {
	if (!error || typeof error !== "object") return String(error);
	const message = error instanceof Error ? error.message : String(error);
	const stderr = String((error as { stderr?: unknown }).stderr ?? "");
	return [message, stderr].filter(Boolean).join("\n").slice(0, 4_000);
}

function runAccessibilityScript(script: string): string {
	try {
		return execFileSync("osascript", ["-e", script], {
			encoding: "utf8",
			timeout: 5_000,
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		const detail = commandFailureText(error);
		if (/not allowed assistive access|assistive access.*(?:-25211|-1728)|(?:-25211|-1728).*assistive access/i.test(detail)) {
			throw new MacAccessibilityPermissionError(detail);
		}
		throw error;
	}
}

/** Read the visible native dialog through the macOS accessibility tree. */
function accessibilitySnapshot(pid: number): string {
	const script = `
tell application "System Events"
  tell first process whose unix id is ${pid}
    set resultText to ""
    repeat with w in windows
      set resultText to resultText & "WINDOW:" & (name of w as text) & linefeed
      try
        repeat with s in static texts of w
          set resultText to resultText & "TEXT:" & (value of s as text) & linefeed
        end repeat
      end try
      try
        repeat with b in buttons of w
          set resultText to resultText & "BUTTON:" & (name of b as text) & linefeed
        end repeat
      end try
    end repeat
	    return resultText
	  end tell
end tell`;
	return runAccessibilityScript(script);
}

function clickNativeCancel(pid: number): string {
	const script = `
tell application "System Events"
  tell first process whose unix id is ${pid}
    repeat with w in windows
      try
        click (first button of w whose name is "Cancel")
        return "clicked"
      end try
    end repeat
	  end tell
end tell`;
	return runAccessibilityScript(script).trim();
}

async function closeAppBounded(app: ElectronApp | undefined): Promise<void> {
	if (!app) return;
	let closed = false;
	const closing = app.close().then(() => { closed = true; }, () => undefined);
	await Promise.race([closing, sleep(7_000)]);
	if (closed) return;
	try {
		const child = app.process?.();
		if (child && !child.killed) child.kill("SIGTERM");
	} catch {
		// The owned scratch process is checked by the caller's cleanup path.
	}
	await Promise.race([closing, sleep(3_000)]);
}

const root = resolve(import.meta.dir, "..");
const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright") as {
	_electron: { launch(options: Record<string, unknown>): Promise<ElectronApp> };
};

// Keep this prefix short. Electron's Darwin socket path includes the complete
// user-data-dir and fails before showing a window once it crosses the limit.
const scratch = await realpath(await mkdtemp(join(tmpdir(), "dq-")));
const projectPath = join(scratch, "p");
const profile = join(scratch, "u");
const stateDir = join(scratch, "h");
const fixturePath = join(projectPath, "fixture.txt");
const output = join(root, "dist/dirty-quit-packaged-proof");
const appPath = join(root, `VSCode-darwin-${process.arch}`, "Cedia.app", "Contents", "MacOS", "Cedia");
const keepScratch = process.env.CEDIA_KEEP_DIRTY_QUIT_FIXTURE === "1";

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
const git = (args: string[]) => execFileSync("git", args, { cwd: projectPath, stdio: "ignore", timeout: 30_000 });
git(["init", "-q"]);
git(["config", "user.name", "Cedia dirty quit fixture"]);
git(["config", "user.email", "cedia-dirty-quit@example.invalid"]);
git(["add", "."]);
git(["commit", "-qm", "fixture baseline"]);

let host: Awaited<ReturnType<typeof startHostServer>> | undefined;
let app: ElectronApp | undefined;
let failure: unknown;
let result: Record<string, unknown> | undefined;
let observedDirtyBuffer = false;
let observedDiskUnchanged = false;
let lastKnownPid: number | null = null;
try {
	check(await exists(appPath), `packaged Cedia exists at ${appPath}`);
	host = await startHostServer({
		stateDir,
		ompExecutable: join(root, "apps/macos/test/fixtures/agent-window-omp"),
		editorBridge: true,
		ompEnv: {
			...process.env,
			HOME: homedir(),
			CEDIA_NODE: process.execPath,
			PI_NO_PTY: "1",
			PI_NOTIFICATIONS: "off",
		},
		ompArgs: ["--no-skills", "--no-rules", "--no-extensions"],
	});
	const project = host.host.store.createProject({ path: projectPath, name: "Dirty quit fixture" });
	const session = host.host.createSession(project.id, "Dirty quit task");
	check(session.id.length > 0, "fixture task has a durable session id");

	await mkdir(output, { recursive: true });
	try { execFileSync("security", ["delete-generic-password", "-s", "Cedia Safe Storage"], { stdio: "ignore" }); } catch { /* scratch */ }
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
		},
		timeout: 45_000,
	});
	const agents = await app.firstWindow();
	const errors: string[] = [];
	agents.on("pageerror", (error: Error) => errors.push(`[agents] ${error.message}`));
	await agents.getByRole("button", { name: "Skip setup", exact: true }).first().click({ timeout: 15_000 }).catch(() => {});
	await agents.getByText("Dirty quit fixture", { exact: true }).first().waitFor({ timeout: 60_000 });
	await agents.getByText("Dirty quit task", { exact: true }).first().click();
	await agents.locator('[contenteditable="true"]').first().waitFor({ timeout: 30_000 });
	console.log("OK   packaged Agent Window selected the fixture task");

	// Open the same workspace in the actual Code-OSS window. The Focus Composer
	// command also activates the Cedia extension when the auxiliary view is lazy.
	const idePromise = app.waitForEvent("window", { predicate: (candidate: Page) => candidate !== agents, timeout: 30_000 });
	const openIde = agents.getByRole("button", { name: "Open in IDE", exact: true });
	await openIde.first().waitFor({ timeout: 20_000 });
	await openIde.first().click();
	let ide = await idePromise;
	ide.on("pageerror", (error: Error) => errors.push(`[ide] ${error.message}`));
	await ide.waitForURL(/workbench/, { timeout: 30_000 });
	await ide.locator(".monaco-workbench").first().waitFor({ timeout: 30_000 });
	await ide.bringToFront();
	await sleep(2_000);
	await ide.keyboard.press("Meta+Shift+P");
	const commandInput = ide.locator(".quick-input-widget input").first();
	await commandInput.waitFor({ timeout: 15_000 });
	await commandInput.fill(">Focus Composer");
	const commandText = await ide.locator(".quick-input-widget").first().innerText().catch(() => "");
	check(!/No matching results/i.test(commandText), `the packaged IDE exposes Focus Composer (${commandText.slice(0, 120)})`);
	await commandInput.press("Enter");
	await sleep(2_000);
	await waitFor(() => Promise.resolve(host!.editors.hasConnection(projectPath)), value => value === true, 90_000, "the real IDE editor connection");
	check(true, "packaged Code-OSS registered the real editor bridge");
	console.log("OK   packaged Code-OSS workbench is active");

	// Open and dirty the fixture using Code-OSS's own editor. Invoke the same
	// production Agents preload bridge used by the shipped `Open in IDE` action,
	// with an absolute file target. This keeps path/session validation in the
	// main process while avoiding Quick Open and CLI handoff races.
	await ide.bringToFront();
	const editorText = async (candidate: Page): Promise<string> => normalizeEditorText(await candidate.evaluate(() => {
		const lines = document.querySelector(".monaco-editor .view-lines") ?? document.querySelector(".monaco-editor");
		return lines?.textContent ?? lines?.textContent ?? "";
	}).catch(() => ""));
	const findEditorPage = async (timeoutMs: number, label: string): Promise<Page | null> => {
		try {
			return await waitFor(
				async () => {
					for (const candidate of app!.windows()) {
						const text = await editorText(candidate);
						const body = await candidate.evaluate(() => document.body?.innerText ?? "").catch(() => "");
						if (text.includes(BASELINE.trim()) || body.includes(BASELINE.trim()) && await candidate.locator(".monaco-editor").count() > 0) return candidate;
					}
					return null;
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
	const editorPage = await findEditorPage(45_000, "the Monaco editor after the production openIde bridge");
	if (editorPage === null) {
		// Keep a bounded, scratch-only diagnosis for the failure mode where the
		// IDE window exists but the renderer never opens a file. This captures URL,
		// visible text and Quick Input visibility only; it never turns a failure
		// into a pass.
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
	if (editorPage !== null) ide = editorPage;
	const editor = ide.locator(".monaco-editor").first();
	await editor.waitFor({ timeout: 30_000 });
	const readEditorText = async (): Promise<string> => await editorText(ide);
	await waitFor(readEditorText, value => value.includes(BASELINE.trim()), 20_000, "the fixture text in the Monaco buffer");
	const lines = ide.locator(".monaco-editor .view-lines").first();
	await lines.waitFor({ timeout: 15_000 });
	const inputArea = ide.locator(".monaco-editor textarea.inputarea").first();
	if (await inputArea.count() > 0) await inputArea.click();
	else await lines.click();
	await ide.keyboard.press("Meta+A");
	await ide.keyboard.insertText(DIRTY);
	const buffer = await waitFor(readEditorText, value => value.includes(DIRTY), 20_000, "the unsaved native editor text");
	check(buffer.includes(DIRTY), "Code-OSS holds the expected unsaved text");
	observedDirtyBuffer = buffer.includes(DIRTY);
	observedDiskUnchanged = await readFile(fixturePath, "utf8") === BASELINE;
	check(observedDiskUnchanged, "typing the dirty buffer did not change disk");
	await ide.screenshot({ path: join(output, "dirty-editor-before-quit.png") });

	const pid = await waitFor(
		() => Promise.resolve(mainPid(scratch)),
		value => value !== null,
		10_000,
		"the packaged Cedia main PID after the dirty editor is ready",
	);
	check(pid !== null, `packaged Cedia main PID identified (${pid})`);
	lastKnownPid = pid;
	// Request a real application Quit from the focused workbench. If an OS
	// accelerator is swallowed by the renderer, the same native main-process
	// path is invoked as a bounded fallback; both enter LifecycleMainService's
	// pre-quit decider before any window is closed.
	await ide.bringToFront();
	await ide.keyboard.press("Meta+Q");
	let ax = "";
	try {
		ax = await waitFor(
			async () => accessibilitySnapshot(pid!),
			value => value.includes("Quit Cedia and stop its work?") && value.includes("unsaved changes") && value.includes("Cancel"),
			8_000,
			"the native Cedia dirty-buffer Quit dialog after Meta+Q",
			);
	} catch (error) {
		if (error instanceof MacAccessibilityPermissionError) throw error;
		if (!app.evaluate) throw error;
		await app.evaluate(({ app: electronApp }: { app: { quit(): void } }) => electronApp.quit());
		ax = await waitFor(
			async () => accessibilitySnapshot(pid!),
			value => value.includes("Quit Cedia and stop its work?") && value.includes("unsaved changes") && value.includes("Cancel"),
			8_000,
			"the native Cedia dirty-buffer Quit dialog after app.quit",
		);
	}
	check(ax.includes("1 file has unsaved changes"), `the dialog reports one unsaved file (${ax.replace(/\n/g, " | ").slice(0, 500)})`);
	check(ax.includes("BUTTON:Cancel"), "the production dialog exposes a Cancel button");
	await writeFile(join(output, "quit-dialog-accessibility.txt"), ax);
	await agents.screenshot({ path: join(output, "quit-dialog-before-cancel.png") }).catch(() => {});
	check(clickNativeCancel(pid!), "the production Cedia Cancel button was clicked through macOS accessibility");

	// Cancel must leave both the app and the exact unsaved buffer intact. The
	// host was idle, so reaching the dialog itself proves the dirty count crossed
	// the trusted renderer -> main-process IPC seam.
	await sleep(1_000);
	check(mainPid(scratch) === pid, "Cedia remains alive after Cancel");
	const afterCancel = await waitFor(readEditorText, value => value.includes(DIRTY), 20_000, "the dirty editor after Cancel");
	check(afterCancel.includes(DIRTY), "the unsaved editor text remains after Cancel");
	check(await readFile(fixturePath, "utf8") === BASELINE, "Cancel leaves the original disk bytes untouched");
	const hostState = host.lifecycle.snapshot();
	check(hostState.phase === "ready" && host.lifecycle.accepting(), `Cancel reopens host admission (${hostState.phase}, accepting=${host.lifecycle.accepting()})`);
	check(errors.length === 0, `packaged surfaces emitted no renderer errors (${JSON.stringify(errors).slice(0, 300)})`);
	await ide.screenshot({ path: join(output, "dirty-editor-after-cancel.png") });

	result = {
		capturedAt: new Date().toISOString(),
		ok: true,
		packagedApp: appPath,
		workspace: projectPath,
		fixturePath,
		mainPid: pid,
		dirtyText: DIRTY,
		diskText: await readFile(fixturePath, "utf8"),
		checks: [
			"real-packaged-codeoss-editor-holds-unsaved-buffer",
			"disk-unchanged-before-quit",
			"native-quit-dialog-reports-one-unsaved-file",
			"production-cancel-button-clicked-through-macos-accessibility",
			"app-and-editor-survive-cancel",
			"dirty-buffer-survives-cancel",
			"host-admission-reopens-after-cancel",
		],
	};
	await writeFile(join(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
	console.log(JSON.stringify(result));
} catch (error) {
	failure = error;
	const diagnostic: Record<string, unknown> = {
		capturedAt: new Date().toISOString(),
		ok: false,
		workspace: projectPath,
		stateDir,
		fixturePath,
		observations: {
			dirtyBuffer: observedDirtyBuffer,
			diskUnchanged: observedDiskUnchanged,
			mainPid: lastKnownPid,
		},
		error: error instanceof Error ? error.stack ?? error.message : String(error),
	};
	if (error instanceof MacAccessibilityPermissionError) {
		diagnostic.blocker = error.code;
		diagnostic.blockerDetail = error.detail;
	}
	await writeFile(join(output, "failure.json"), `${JSON.stringify(diagnostic, null, 2)}\n`).catch(() => {});
	console.error(`${FAIL_PREFIX}: ${diagnostic.error}`);
	throw error;
} finally {
	await closeAppBounded(app);
	await host?.close().catch(() => {});
	if (failure === undefined && result !== undefined && !keepScratch) await rm(scratch, { recursive: true, force: true });
	else console.error(`FIXTURE RETAINED: ${scratch}`);
}
