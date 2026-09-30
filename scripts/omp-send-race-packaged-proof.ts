/**
 * Packaged Send-vs-edit race proof (D same-revision gate).
 *
 * Same topology as scripts/agent-window-smoke.ts --native (in-process host on
 * fixture OMP + packaged app on a scratch profile/state dir). Opens the fixture
 * task in the Agents window and the IDE on the same project. Fixture OMP pauses
 * its prompt ACK while the mounted production IDE composer commits revision 2;
 * the proof then verifies that the Agents renderer's revision-1 clear preserves
 * that newer draft and that exactly one prompt was dispatched.
 *
 * Run: bun scripts/omp-send-race-packaged-proof.ts
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { access, appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";

const FAIL_PREFIX = "OMP send-race packaged proof failed";
function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${FAIL_PREFIX}: ${message}`);
	console.log(`OK   ${message}`);
}
type El = {
	click(o?: unknown): Promise<void>;
	fill(s: string): Promise<void>;
	waitFor(o?: unknown): Promise<void>;
	innerText(): Promise<string>;
	count(): Promise<number>;
	isEnabled(): Promise<boolean>;
};
type Role = { first(): El; nth(i: number): El; count(): Promise<number> };
type Page = {
	getByRole(r: string, o?: Record<string, unknown>): Role;
	getByText(t: string | RegExp, o?: Record<string, unknown>): Role;
	locator(s: string): Role & { evaluateAll(f: (ns: Element[]) => unknown): Promise<unknown> };
	evaluate(f: string | ((...a: never[]) => unknown), ...args: unknown[]): Promise<unknown>;
	waitForFunction(f: unknown, o?: unknown, t?: unknown): Promise<void>;
	waitForURL(u: RegExp, o?: unknown): Promise<void>;
	bringToFront(): Promise<void>;
	keyboard: { press(k: string): Promise<void> };
	screenshot(o: Record<string, unknown>): Promise<void>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitForPath = async (path: string, timeoutMs = 15_000) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try { await access(path); return; } catch {}
		await sleep(20);
	}
	throw new Error(`${FAIL_PREFIX}: timed out waiting for ${path}`);
};

async function startDraftRaceProxy(input: {
	originUrl: string;
	threadId: string;
	promptText: string;
	gateDir: string;
}): Promise<{
	server: Server;
	url: string;
	releaseEmptyWritePath: string;
	emptyWriteHeldPath: string;
	emptyWriteSettledPath: string;
	releaseCommandResponsePath: string;
	commandResponseHeldPath: string;
	releaseResultPath: string;
}> {
	const origin = new URL(input.originUrl);
	const draftPath = `/v1/drafts/${encodeURIComponent(input.threadId)}`;
	const commandsPath = `/v1/sessions/${encodeURIComponent(input.threadId)}/commands`;
	const releaseEmptyWritePath = join(input.gateDir, "release-empty-draft-write");
	const emptyWriteHeldPath = join(input.gateDir, "empty-draft-write-held.json");
	const emptyWriteSettledPath = join(input.gateDir, "empty-draft-write-settled.json");
	const releaseCommandResponsePath = join(input.gateDir, "release-command-response");
	const commandResponseHeldPath = join(input.gateDir, "command-response-held.json");
	const releaseResultPath = join(input.gateDir, "send-release-result.json");
	const requestTracePath = join(input.gateDir, "draft-command-requests.jsonl");
	let heldEmptyWrite = false;

	const server = createServer((incoming, outgoing) => {
		void (async () => {
			const chunks: Buffer[] = [];
			for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
			const bodyBytes = Buffer.concat(chunks);
			let body: Record<string, any> = {};
			try {
				const parsed = bodyBytes.length ? JSON.parse(bodyBytes.toString("utf8")) : {};
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed;
			} catch {}
			const method = incoming.method ?? "GET";
			const requestPath = incoming.url ?? "/";
			const pathname = new URL(requestPath, "http://cedia-proxy.local").pathname;
			if (pathname.includes("/drafts/") || pathname.includes("/commands")) {
				await appendFile(requestTracePath, `${JSON.stringify({ at: new Date().toISOString(), phase: "request", method, pathname, body })}\n`);
			}
			const emptyDraftWrite = method === "PATCH" && pathname === draftPath
				&& body.expectedRevision === 1 && body.text === "";
			const targetPrompt = method === "POST" && pathname === commandsPath
				&& body.command === "prompt" && body.payload?.message === input.promptText;
			const releaseDraft = method === "POST" && pathname === `${draftPath}/clear`;
			const reserveDraft = method === "POST" && pathname === `${draftPath}/submissions`;

			if (emptyDraftWrite && !heldEmptyWrite) {
				heldEmptyWrite = true;
				await writeFile(emptyWriteHeldPath, `${JSON.stringify({ method, pathname, expectedRevision: body.expectedRevision, text: body.text })}\n`);
				await waitForPath(releaseEmptyWritePath, 120_000);
			}

			const upstream = httpRequest({
				hostname: origin.hostname,
				port: Number(origin.port),
				path: requestPath,
				method,
				headers: { ...incoming.headers, host: origin.host, connection: "close" },
			});
			upstream.on("error", (error) => {
				if (outgoing.destroyed) return;
				outgoing.writeHead(502, { "content-type": "application/json" });
				outgoing.end(JSON.stringify({ error: String(error) }));
			});
			upstream.on("response", (response) => {
				if (!targetPrompt && !emptyDraftWrite && !releaseDraft && !reserveDraft) {
					outgoing.writeHead(response.statusCode ?? 502, response.headers);
					response.pipe(outgoing);
					return;
				}
				const responseChunks: Buffer[] = [];
				response.on("data", (chunk) => responseChunks.push(Buffer.from(chunk)));
				response.on("end", () => {
					void (async () => {
						const responseBytes = Buffer.concat(responseChunks);
						if (targetPrompt || emptyDraftWrite || releaseDraft || reserveDraft) {
							await appendFile(requestTracePath, `${JSON.stringify({ at: new Date().toISOString(), phase: "response", method, pathname, status: response.statusCode, body: responseBytes.toString("utf8") })}\n`);
						}
						if (emptyDraftWrite) {
						await writeFile(emptyWriteSettledPath, `${JSON.stringify({ status: response.statusCode, body: responseBytes.toString("utf8") })}\n`);
						}
						if (releaseDraft) {
							await writeFile(releaseResultPath, `${JSON.stringify({ status: response.statusCode, body: responseBytes.toString("utf8") })}\n`);
						}
						if (targetPrompt) {
							await writeFile(commandResponseHeldPath, `${JSON.stringify({ status: response.statusCode, body: responseBytes.toString("utf8") })}\n`);
							await waitForPath(releaseCommandResponsePath, 120_000);
						}
						if (outgoing.destroyed) return;
						outgoing.writeHead(response.statusCode ?? 502, response.headers);
						outgoing.end(responseBytes);
					})().catch((error) => outgoing.destroy(error as Error));
				});
			});
			if (bodyBytes.length > 0) upstream.write(bodyBytes);
			upstream.end();
		})().catch((error) => {
			if (outgoing.destroyed) return;
			outgoing.writeHead(502, { "content-type": "application/json" });
			outgoing.end(JSON.stringify({ error: String(error) }));
		});
	});
	await new Promise<void>((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolveListen();
		});
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error(`${FAIL_PREFIX}: draft proxy has no loopback address`);
	return {
		server,
		url: `http://127.0.0.1:${address.port}`,
		releaseEmptyWritePath,
		emptyWriteHeldPath,
		emptyWriteSettledPath,
		releaseCommandResponsePath,
		commandResponseHeldPath,
		releaseResultPath,
	};
}

const root = resolve(import.meta.dir, "..");
const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright") as {
	_electron: {
		launch(opts: Record<string, unknown>): Promise<{
			firstWindow(): Promise<unknown>;
			windows(): unknown[];
			waitForEvent(n: string, o?: Record<string, unknown>): Promise<unknown>;
			close(): Promise<void>;
		}>;
	};
};

// Never launch the repository's installed bundle or touch Keychain as part of a
// scratch proof. The caller must stage a separate app copy and name it explicitly.
const appPath = process.env.CEDIA_SEND_RACE_APP_PATH;
check(typeof appPath === "string" && appPath.endsWith("/Cedia.app"),
	"CEDIA_SEND_RACE_APP_PATH names an explicitly staged scratch Cedia.app");
const resolvedAppPath = resolve(appPath);
const installedAppPath = resolve(join(root, `VSCode-darwin-${process.arch}/Cedia.app`));
check(resolvedAppPath !== installedAppPath && !resolvedAppPath.startsWith(`${installedAppPath}/`),
	"the repository's installed Cedia.app is never launched by this proof");
await access(join(resolvedAppPath, "Contents/MacOS/Cedia"));
// Stage-time Login Item interception (same pattern as omp-packaged-owned-host-adoption-proof):
// the build never bakes the shim; verify the staged bundle matches the current source build,
// then patch the two reviewed interception points in the scratch copy only and re-sign.
const lifecycleShimPath = join(resolvedAppPath, "Contents/Resources/app/out/vs/cedia/agent/main.cjs");
const sourceLifecycleModule = await readFile(join(root, "dist/agent-window/main.cjs"), "utf8");
const setterNeedle = "setLoginItemSettings: (settings) => electronApp.setLoginItemSettings(settings),";
const getterNeedle = "wasOpenedAtLogin = electronApp.getLoginItemSettings().wasOpenedAtLogin === true;";
let stagedLifecycleModule = await readFile(lifecycleShimPath, "utf8");
check(createHash("sha256").update(stagedLifecycleModule).digest("hex") === createHash("sha256").update(sourceLifecycleModule).digest("hex"),
	"the staged app carries the current source Agent Window main process");
check(stagedLifecycleModule.split(setterNeedle).length === 2 && stagedLifecycleModule.split(getterNeedle).length === 2,
	"staged Login Item interception points match the reviewed module");
stagedLifecycleModule = stagedLifecycleModule
	.replace(setterNeedle, `setLoginItemSettings: (settings) => { require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "intercept-set-login-item", settings }) + "\\n"); },`)
	.replace(getterNeedle, `wasOpenedAtLogin = false; require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "simulated-login-state", isPackaged: electronApp.isPackaged, openedAtLogin: false }) + "\\n");`);
await writeFile(lifecycleShimPath, stagedLifecycleModule);
execFileSync("codesign", ["--force", "--deep", "--sign", "-", resolvedAppPath], { stdio: "ignore" });
check(true, "the Login Item interception is staged only in the temp app copy");

const scratch = await mkdtemp(join(tmpdir(), "cedia-send-race-pkg-"));
const projectPath = join(scratch, "project");
const profile = join(scratch, "profile");
const stateDir = join(scratch, "host");
const gateDir = join(scratch, "omp-ack-gate");
await mkdir(projectPath, { recursive: true });
await mkdir(gateDir, { recursive: true });
await writeFile(join(projectPath, "hello.txt"), "Send race fixture\n");
// The IDE opened by the Agent Window is a fresh Code-OSS workbench.  Without a
// profile/workspace trust record the workbench stays in Restricted Mode and the
// Cedia extension deliberately renders only its explanatory page, leaving the
// real composer webview absent.  Keep trust in the fixture itself so this proof
// never depends on a user's global profile or an interactive prompt.
const ideSettings = {
	"cedia.hostStateDir": stateDir,
	"security.workspace.trust.enabled": false,
	"window.startupEditor": "none",
	"workbench.startupEditor": "none",
	"update.mode": "none",
	"telemetry.telemetryLevel": "off",
	"extensions.autoCheckUpdates": false,
};
await mkdir(join(projectPath, ".vscode"), { recursive: true });
await mkdir(join(profile, "User"), { recursive: true });
await writeFile(join(projectPath, ".vscode", "settings.json"), `${JSON.stringify(ideSettings, null, 2)}\n`);
await writeFile(join(profile, "User", "settings.json"), `${JSON.stringify(ideSettings, null, 2)}\n`);
const git = (args: string[]) =>
	execFileSync("git", args, { cwd: projectPath, encoding: "utf8", timeout: 30_000 });
git(["init", "-q"]);
git(["config", "user.email", "fixture@cedia"]);
git(["config", "user.name", "Cedia Fixture"]);
git(["add", "."]);
git(["commit", "-qm", "fixture base"]);
git(["branch", "-M", "main"]);

const host = await startHostServer({
	stateDir,
	ompExecutable: join(root, "apps/macos/test/fixtures/agent-window-omp"),
	ompEnv: { CEDIA_NODE: process.execPath, CEDIA_SEND_RACE_GATE_DIR: gateDir },
	// CUA may take longer than the product's normal RPC deadline to complete a
	// native keyboard edit. Keep the held-ACK proof alive until its explicit gate.
	ompRequestTimeoutMs: 180_000,
});
const project = host.host.store.createProject({ path: projectPath, name: "Send race fixture" });
const session = host.host.createSession(project.id, "Send race task");
check(session.id.length > 0, "fixture session registered on the live host");

const proxy = await startDraftRaceProxy({
	originUrl: host.descriptor.url,
	threadId: session.id,
	promptText: "Agents renderer sends revision one",
	gateDir,
});
await writeFile(
	join(stateDir, "host.json"),
	JSON.stringify({ ...host.descriptor, url: proxy.url }),
	{ mode: 0o600 },
);

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = join(root, "dist/send-race-packaged-proof", runId);
await mkdir(output, { recursive: true });
const lifecycleShimLogPath = join(output, "login-item-shim.jsonl");
const agentRendererConsolePath = join(output, "agent-renderer-console.jsonl");

const shot = async (p: Page, name: string) => {
	await p.screenshot({ path: join(output, `${name}.png`) });
};
let browser: Awaited<ReturnType<typeof _electron.launch>> | undefined;
try {
	browser = await _electron.launch({
		executablePath: join(resolvedAppPath, "Contents/MacOS/Cedia"),
		args: [
			"--user-data-dir", profile,
			"--password-store=basic", "--use-inmemory-secretstorage",
			"--skip-welcome", "--skip-release-notes",
		],
			env: {
				...process.env,
				CEDIA_STATE_DIR: stateDir,
				CEDIA_HOST_NODE: process.env.CEDIA_HOST_NODE ?? "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node",
				CEDIA_HOST_REQUEST_TIMEOUT_MS: "180000",
				CEDIA_LIFECYCLE_SHIM_LOG: lifecycleShimLogPath,
				CEDIA_SIMULATE_LOGIN: "0",
			},
		timeout: 45_000,
	});
	const stageProcess = (browser as any).process();
	stageProcess?.on("exit", (code: number | null, signal: NodeJS.Signals | null) =>
		console.log(`PACKAGED-RACE: staged Electron exited (code=${code}, signal=${signal})`));
	console.log("PACKAGED-RACE: staged Electron launch returned");
	const agents = (await browser.firstWindow()) as unknown as Page;
	(agents as any).on("console", (message: { type?: () => string; text?: () => string }) => {
		void appendFile(agentRendererConsolePath, `${JSON.stringify({ type: message.type?.(), text: message.text?.() ?? "" })}\n`);
	});
	console.log(`PACKAGED-RACE: Agents page ${await (agents as any).url()}`);
	await waitForPath(lifecycleShimLogPath, 15_000);
	const lifecycleShimEvents = (await readFile(lifecycleShimLogPath, "utf8"))
		.trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { event?: string; isPackaged?: boolean; openedAtLogin?: boolean });
	const interceptedLoginWrites = lifecycleShimEvents.filter(event => event.event === "intercept-set-login-item");
	check(interceptedLoginWrites.length > 0,
		"packaged Login Item setters were intercepted by the hash-verified staged shim");
	check(lifecycleShimEvents.some(event => event.event === "simulated-login-state" && event.isPackaged === true && event.openedAtLogin === false),
		"scratch run uses the shim's simulated packaged, non-login launch state");
	await agents.getByRole("button", { name: "Skip setup", exact: true }).first().click({ timeout: 15_000 }).catch(() => {});
	await agents.getByText("Send race fixture", { exact: true }).first().waitFor({ timeout: 60_000 });
	console.log("PACKAGED-RACE: fixture project is visible in Agents");
	await shot(agents, "race-home");

	// Open the pre-registered fixture task in the Agents window. Creating a new
	// thread here would leave an unbound draft and make Open in IDE fall back to
	// the user's last IDE folder instead of this fixture workspace.
	await agents.getByText("Send race task", { exact: true }).first().click();
	await agents.locator('[contenteditable="true"]').first().waitFor({ timeout: 30_000 });
	await shot(agents, "race-agents-composer");
	// Open the IDE on the same project; the dock webview shares the host draft.
	const ideOpened = browser.waitForEvent("window", { timeout: 30_000 });
	const openIdeButtons = agents.getByRole("button", { name: "Open in IDE", exact: true });
	await openIdeButtons.first().waitFor({ timeout: 20_000 });
	let launched = false;
	for (let i = 0; i < (await openIdeButtons.count()); i++) {
		if (await openIdeButtons.nth(i).isEnabled()) {
			await openIdeButtons.nth(i).click();
			launched = true;
			break;
		}
	}
	check(launched, "Open in IDE launched from the Agents window");
	const ide = (await ideOpened) as unknown as Page;
	await ide.waitForURL(/workbench/, { timeout: 30_000 });
	await sleep(5_000);
	await shot(ide, "race-ide");
	// Opening a folder from the Agents window restores the auxiliary bar but may
	// leave its Cedia view lazy and unresolved. Focus the public Cedia command the
	// same way a user does, which forces Code-OSS to resolve the real webview.
	await ide.keyboard.press("Meta+Shift+P");
	const commandInput = (ide as any).locator(".quick-input-widget input").first();
	await commandInput.waitFor({ state: "visible", timeout: 15_000 });
	await commandInput.fill(">Focus Composer");
	await (ide as any).waitForTimeout(250);
	const commandText = await (ide as any).locator(".quick-input-widget").innerText().catch(() => "");
	check(!/No matching results/i.test(commandText), `Cedia Focus Composer command is available (${commandText.slice(0, 160)})`);
	await commandInput.press("Enter");
	await (ide as any).locator(".quick-input-widget").waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
	await sleep(5_000);
	await shot(ide, "race-ide-focused");
	const ideContents = await (browser as any).evaluate(({ webContents }: any) => webContents.getAllWebContents().map((contents: any) => ({
		id: contents.id,
		url: contents.getURL(),
		title: contents.getTitle?.(),
		windowType: contents.getType?.(),
		visibility: contents.isDestroyed?.() ? "destroyed" : "live",
	})));
	const frameUrls = (ide as any).frames().map((frame: any) => frame.url());
	console.log(`IDE-DOM-PROBE: ${JSON.stringify({
		frames: frameUrls,
		webviewElements: await (ide as any).locator("webview").count().catch(() => -1),
		iframeElements: await (ide as any).locator("iframe").count().catch(() => -1),
		contents: ideContents,
	})}`);
	const offlineStatus = (ide as any).getByText("Cedia offline", { exact: true }).first();
	if (await offlineStatus.count()) console.log("IDE-DOM-PROBE: visible status is Cedia offline");
	const wins = (browser.windows() as unknown[]).length;
	check(wins === 2, `two on-screen windows share the host (got ${wins})`);

	// Stage and hydrate the real IDE composer before Send. Switching native window
	// focus exercises the production focus-triggered host hydration path; Playwright
	// locator actions alone do not activate the other macOS window.
	const TEXT = "Agents renderer sends revision one";
	const TEXT2 = "IDE webview keeps revision two";
	const composerFrames = await Promise.all((ide as any).frames().map(async (frame: any) => {
		const url = frame.url();
		if (!url.startsWith("vscode-webview://")) return { frame, url, editorCount: 0, sendCount: 0 };
		const editorCount = await frame.locator('[data-testid="composer-editor"][contenteditable="true"]').count().catch(() => 0);
		const sendCount = await frame.locator('button[aria-label="Send message"]').count().catch(() => 0);
		return { frame, url, editorCount, sendCount };
	}));
	const matches = composerFrames.filter((candidate: any) => candidate.editorCount === 1 && candidate.sendCount === 1);
	check(matches.length === 1,
		`one mounted Cedia composer exists in the IDE webview frames (${JSON.stringify(composerFrames.map(({ url, editorCount, sendCount }: any) => ({ url, editorCount, sendCount })))})`);
	const target = matches[0];
	const editor = target.frame.locator('[data-testid="composer-editor"][contenteditable="true"]');
	await agents.locator('[contenteditable="true"]').first().fill(TEXT);
	await sleep(1_000);
	await shot(agents, "race-agents-typed");
	const readDraftFor = async (threadId: string): Promise<unknown> => {
		const response = await host.router({
			method: "GET",
			path: `/v1/drafts/${encodeURIComponent(threadId)}`,
			token: host.auth.ownerToken,
		});
		return { status: response.status, body: response.body };
	};
	const readDraft = (): Promise<unknown> => readDraftFor(session.id);
	const draftText = (snapshot: unknown): { revision?: number; text?: string } => {
		const body = (snapshot as { body?: { revision?: number; text?: string } }).body;
		return { revision: body?.revision, text: body?.text };
	};
	const initialDraft = draftText(await readDraft());
	check(initialDraft.revision === 1 && initialDraft.text === TEXT,
		"Agents composer commits shared draft revision 1 before Send");
	await agents.bringToFront();
	const computerUsePreflightReadyPath = join(output, "computer-use-preflight-ready.json");
	const computerUsePreflightReleasePath = join(output, "computer-use-preflight-release");
	await writeFile(computerUsePreflightReadyPath, `${JSON.stringify({
		stagedAppPath: resolvedAppPath,
		output,
		runId,
		sessionId: session.id,
		ideWindowTitle: await (ide as any).title().catch(() => null),
		ideUrl: await (ide as any).url(),
		composerFrameUrl: target.url,
		ideDraftText: await editor.innerText(),
	})}\n`);
	console.log(`CUA_PREFLIGHT_READY: ${computerUsePreflightReadyPath}`);
	await waitForPath(computerUsePreflightReleasePath, 120_000);
	const ideHydrationDeadline = Date.now() + 8_000;
	let ideTextBeforeEdit = await editor.innerText();
	while (ideTextBeforeEdit.trim() !== TEXT && Date.now() < ideHydrationDeadline) {
		await sleep(50);
		ideTextBeforeEdit = await editor.innerText();
	}
	check(ideTextBeforeEdit.trim() === TEXT,
		`native CUA IDE focus hydrates revision 1 (${JSON.stringify(ideTextBeforeEdit)})`);
	await agents.bringToFront();
	await agents.bringToFront();
	const sendA = agents.getByRole("button", { name: "Send message", exact: true }).first().click();
	await waitForPath(join(gateDir, "prompt-received.json"));
	await sendA;
	const promptGate = JSON.parse(await readFile(join(gateDir, "prompt-received.json"), "utf8")) as { id?: string; text?: string };
	check(promptGate.text === TEXT && typeof promptGate.id === "string",
		"fixture OMP received Agents revision 1 and is holding its prompt ACK");
	check((await draftText(await readDraft())).revision === 1,
		"revision 1 remains reserved and uncleared while the OMP ACK is gated");
	check(!(await access(join(gateDir, "prompt-ack-released")).then(() => true).catch(() => false)),
		"fixture OMP has not acknowledged the prompt before the IDE edit");
	await waitForPath(proxy.emptyWriteHeldPath, 30_000);
	const heldEmptyWrite = JSON.parse(await readFile(proxy.emptyWriteHeldPath, "utf8")) as {
		expectedRevision?: number;
		text?: string;
	};
	check(heldEmptyWrite.expectedRevision === 1 && heldEmptyWrite.text === "",
		"Agents renderer's post-Send empty write is paused at revision 1");

	// Hand the staged IDE window to native keyboard input. A real window focus
	// transition also runs the production host hydration before the edit.
	await ide.bringToFront();
	ideTextBeforeEdit = await editor.innerText();
	check(ideTextBeforeEdit.trim() === TEXT,
		`IDE still shows the sent revision after focus returns (${JSON.stringify(ideTextBeforeEdit)})`);
	const computerUseReadyPath = join(output, "computer-use-ready.json");
	const computerUseReleasePath = join(output, "computer-use-release");
	await writeFile(computerUseReadyPath, `${JSON.stringify({
		stagedAppPath: resolvedAppPath,
		output,
		runId,
		sessionId: session.id,
		ideWindowTitle: await (ide as any).title().catch(() => null),
		ideUrl: await (ide as any).url(),
		composerFrameUrl: target.url,
		ideTextBeforeEdit: await editor.innerText(),
	})}\n`);
	console.log(`CUA_READY: ${computerUseReadyPath}`);
	await waitForPath(computerUseReleasePath, 120_000);
	const ideEdit = {
		url: target.url,
		...(await editor.evaluate((element: HTMLElement) => ({
			text: element.innerText,
			focused: document.activeElement === element,
		}))),
	};
	check(ideEdit.url.startsWith("vscode-webview://") && ideEdit.text.trim() === TEXT2 && ideEdit.focused,
		`real keyboard input replaced the IDE composer text (${JSON.stringify({ before: ideTextBeforeEdit, after: ideEdit.text, focused: ideEdit.focused })})`);
	await sleep(450);
	const ideStateProbe = await target.frame.evaluate(() => {
		const threadId = window.location.hash.replace(/^#/, "").replace(/^\/+/, "").split(/[/?#]/, 1)[0] ?? "";
		const context = (window as Window & { __CEDIA_IDE_CONTEXT__?: { sessionId?: string } }).__CEDIA_IDE_CONTEXT__;
		const serialized = window.localStorage.getItem("synara:composer-drafts:v1");
		let stored: any = null;
		try { stored = serialized ? JSON.parse(serialized) : null; } catch {}
		const state = stored?.state ?? stored;
		return {
			threadId,
			contextSessionId: context?.sessionId ?? null,
			localPrompt: state?.draftsByThreadId?.[threadId]?.prompt ?? null,
			localDraftThreadIds: Object.keys(state?.draftsByThreadId ?? {}),
		};
	});
	const routeDraft = ideStateProbe.threadId ? await readDraftFor(ideStateProbe.threadId) : null;
	check(ideStateProbe.threadId === session.id && ideStateProbe.contextSessionId === session.id,
		"the IDE editor route and adapter context identify the same fixture session");
	check(ideStateProbe.localPrompt === TEXT2,
		`Lexical keyboard input updated the IDE's persisted composer store (${JSON.stringify(ideStateProbe.localPrompt)})`);
	await shot(ide, "race-ide-revision-two");
	const revisionTwoDeadline = Date.now() + 15_000;
	let draftTwo = draftText(await readDraft());
	while ((draftTwo.revision !== 2 || draftTwo.text !== TEXT2) && Date.now() < revisionTwoDeadline) {
		await sleep(40);
		draftTwo = draftText(await readDraft());
	}
	check(draftTwo.revision === 2 && draftTwo.text === TEXT2,
		"production IDE input handler commits shared draft revision 2 before the OMP ACK");
	check(draftText(routeDraft).revision === 2 && draftText(routeDraft).text === TEXT2,
		"the IDE webview route reads the same revision-2 host draft");
	await writeFile(proxy.releaseEmptyWritePath, `${Date.now()}\n`);
	await waitForPath(proxy.emptyWriteSettledPath, 15_000);
	const staleEmptyResult = JSON.parse(await readFile(proxy.emptyWriteSettledPath, "utf8")) as { status?: number };
	check(staleEmptyResult.status === 409,
		`the delayed Agents empty write is rejected as stale (${staleEmptyResult.status})`);
	await writeFile(join(gateDir, "release-prompt-ack"), `${Date.now()}\n`);
	await waitForPath(join(gateDir, "prompt-ack-released"));
	await waitForPath(proxy.commandResponseHeldPath, 15_000);
	const heldCommandResponse = JSON.parse(await readFile(proxy.commandResponseHeldPath, "utf8")) as { status?: number; body?: string };
	const heldCommand = (() => {
		try { return JSON.parse(heldCommandResponse.body ?? "{}") as { status?: string; error?: string }; }
		catch { return {} as { status?: string; error?: string }; }
	})();
	check(heldCommandResponse.status === 200 && (heldCommand.status === "acknowledged" || heldCommand.status === "completed"),
		`the fixture OMP prompt ACK was accepted before returning to Agents (HTTP ${heldCommandResponse.status}, command ${heldCommand.status ?? heldCommand.error ?? "unreadable"})`);
	await writeFile(proxy.releaseCommandResponsePath, `${Date.now()}\n`);
	const releaseDeadline = Date.now() + 15_000;
	while (Date.now() < releaseDeadline && !(await access(proxy.releaseResultPath).then(() => true).catch(() => false))) await sleep(20);
	if (!(await access(proxy.releaseResultPath).then(() => true).catch(() => false))) {
		const routeTrace = await readFile(join(gateDir, "draft-command-requests.jsonl"), "utf8").catch(() => "(no proxied draft/command requests)\n");
		const hostCommands = host.host.store.listCommands(session.id).map(command => ({
			commandId: command.commandId,
			status: command.status,
			kind: command.kind,
			payload: command.payload,
		}));
		const rendererConsole = await readFile(agentRendererConsolePath, "utf8").catch(() => "(no renderer console events)\n");
		const diagnostic = { routeTrace, rendererConsole, hostCommands, finalDraft: draftText(await readDraft()) };
		await writeFile(join(output, "clear-release-timeout-diagnostic.json"), `${JSON.stringify(diagnostic, null, 2)}\n`);
		throw new Error(`${FAIL_PREFIX}: timed out waiting for revision clear; ${JSON.stringify(diagnostic)}`);
	}
	const sendRelease = JSON.parse(await readFile(proxy.releaseResultPath, "utf8")) as {
		status?: number;
		body?: string;
	};
	let sendReleaseBody: { cleared?: boolean; draft?: { revision?: number; text?: string } } = {};
	try { sendReleaseBody = JSON.parse(sendRelease.body ?? "{}"); } catch {}
	check(sendRelease.status === 200 && sendReleaseBody.cleared === false,
		`the production revision-1 clear is refused after the revision-2 edit (${JSON.stringify(sendRelease)})`);
	const acceptedDeadline = Date.now() + 15_000;
	let accepted = false;
	while (Date.now() < acceptedDeadline) {
		const commands = host.host.store.listCommands(session.id);
		accepted = commands.some((command) => command.kind === "prompt"
			&& (command.payload as { message?: unknown })?.message === TEXT
			&& (command.status === "acknowledged" || command.status === "completed"));
		if (accepted) break;
		await sleep(40);
	}
	check(accepted, "Agents Send completes after the gated OMP prompt ACK");
	const draftAfterAck = draftText(await readDraft());
	check(draftAfterAck.revision === 2 && draftAfterAck.text === TEXT2,
		"revision-1 Send clear cannot delete the IDE's newer revision-2 draft");
	await shot(agents, "race-agents-acknowledged");

	// Journal: exactly one prompt for this text across ALL sessions.
	const sessions = host.host.store.listSessions(project.id);
	const prompts = sessions.flatMap((s) => host.host.store.listCommands(s.id)).filter((c) => c.kind === "prompt");
	console.log(`PROMPT-JOURNAL: ${JSON.stringify(prompts.map((c) => ({
		commandId: c.commandId,
		deviceId: c.deviceId,
		status: c.status,
		createdAt: c.createdAt,
		updatedAt: c.updatedAt,
		payload: c.payload,
		payloadHash: c.payloadHash,
	})), null, 2)}`);
	const racePrompts = prompts.filter((c) => c.kind === "prompt"
		&& (c.payload as { message?: unknown })?.message === TEXT);
	check(racePrompts.length === 1,
		`exactly one revision-1 prompt is journaled (got ${racePrompts.length})`);
	check(JSON.stringify(racePrompts[0]?.payload).includes(TEXT2) === false,
		"revision-2 edit remains draft text and is not submitted as another prompt");
	const result = {
		ok: true,
		proof: "packaged-agents-ide-send-edit-race",
		runId,
		stagedAppPath: resolvedAppPath,
		sessionId: session.id,
		promptCommandId: promptGate.id,
		promptCountForFixtureText: racePrompts.length,
		draftAtEnd: draftText(await readDraft()),
		staleAgentsEmptyWriteStatus: staleEmptyResult.status,
		revisionOneClear: { status: sendRelease.status, cleared: sendReleaseBody.cleared },
		ideLocalDraft: ideStateProbe.localPrompt,
		screenshots: ["race-agents-acknowledged.png", "race-ide-revision-two.png"],
		providerRequests: 0,
		rootCediaPidTouched: false,
		loginItemSetterCallsIntercepted: interceptedLoginWrites.length,
		loginItemStateSimulated: lifecycleShimEvents.some(event => event.event === "simulated-login-state" && event.openedAtLogin === false),
		lifecycleShimLogPath,
	};
	await writeFile(join(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
	console.log(`Packaged race result: ${JSON.stringify(result)}`);
} finally {
	// Never strand the fixture OMP, the scratch proxy, or the staged app on failure.
	await writeFile(join(gateDir, "release-prompt-ack"), `${Date.now()}\n`).catch(() => {});
	await writeFile(proxy.releaseEmptyWritePath, `${Date.now()}\n`).catch(() => {});
	await writeFile(proxy.releaseCommandResponsePath, `${Date.now()}\n`).catch(() => {});
	await browser?.close().catch(() => {});
	proxy.server.closeAllConnections();
	await new Promise<void>(resolveClose => proxy.server.close(() => resolveClose()));
	await host.close().catch(() => {});
}
