/**
 * Live approval loop on muse-spark-1.3-contributor (user-approved, bounded spend).
 *
 * One short write turn in a headless Chromium agent window (production adapter bundle)
 * against a live host + the pinned runtime with an always-ask overlay (global yolo
 * untouched). The model must attempt exactly one file write; the OMP `select` broker
 * request must render as a clickable approval; one click must complete the turn with a
 * byte-exact file. This driver does not start the native Code-OSS editor bridge, so it
 * cannot produce a native `confirm` request. Anything else — model stall, silent turn,
 * unrendered prompt — aborts honestly and is recorded, never retried into spend here.
 *
 * Bound: at most ONE write turn. Scratch workdir only.
 * Auth: OMP-native profile for the selected model, plus an isolated approval overlay.
 *
 * Run: bun scripts/omp-live-approval-proof.ts
 */
import { createRequire } from "node:module";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";
import { createAgentHostGateway, createAgentWindowHandler } from "../apps/macos/src/agent-window-main.ts";
import { createAgentGitService } from "../apps/macos/src/agent-window-git.ts";
import { homedir } from "node:os";

const FAIL_PREFIX = "OMP live approval proof failed";
function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${FAIL_PREFIX}: ${message}`);
	console.log(`OK   ${message}`);
}
function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${FAIL_PREFIX}: ${message}`);
	return value as Record<string, unknown>;
}
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${FAIL_PREFIX}: timed out waiting for ${label}`)), ms); }),
		]);
	} finally { if (timer !== undefined) clearTimeout(timer); }
}

const root = resolve(import.meta.dir, "..");
const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/")
	? resolve(requested)
	: ((process.env.PATH ?? "").split(delimiter).map(dir => join(dir, requested)).find(candidate => candidate) ?? requested);
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `the runtime is the pinned ${OMP_BASELINE_VERSION} or later (${version})`);
const { chromium } = createRequire(join(root, "desktop/package.json"))("playwright");

const scratch = await mkdtemp(join(tmpdir(), "cedia-live-approval-"));
const projectPath = join(scratch, "project");
const { mkdir } = await import("node:fs/promises");
await mkdir(projectPath);
const canonicalProjectPath = await realpath(projectPath);
await writeFile(join(projectPath, "note.txt"), "Spark approval probe workspace\n");
// OMP-native auth and model catalog come from the user's profile. The explicit session file
// and host state below remain in scratch; only the approval policy comes from the overlay.
const overlay = "/tmp/cedia-always-ask.yml";
const MODEL = "opencode-go/muse-spark-1.3-contributor";
const PROJECT_TITLE = "Spark approval probe project";
const SESSION_TITLE = "Spark approval probe task";
const FILENAME = "approval-probe-spark.txt";
const CONTENT = "approval_probe_spark_ok";

const output = join(root, "dist/live-approval-spark");
await mkdir(output, { recursive: true });
const shot = async (page: { screenshot(options: unknown): Promise<unknown> }, name: string) => {
	await page.screenshot({ path: join(output, `${name}.png`) });
};

let exitCode = 0;
const cleanup = async () => {
	await Promise.all([rm(scratch, { recursive: true, force: true })]).catch(() => {});
};
try {
	const started = await withTimeout(startHostServer({
		stateDir: join(scratch, "host"),
		port: 0,
		ompExecutable: executable,
		virtualUi: true,
		ompArgs: ["--no-skills", "--no-rules", "--no-extensions"],
		ompEnv: {
			HOME: homedir(), PI_CONFIG_FILES: overlay,
			PI_NO_PTY: "1", PI_NOTIFICATIONS: "off", CEDIA_NODE: process.execPath,
		},
	}), 60_000, "host boot");
	try {
		const project = started.host.store.createProject({ path: projectPath, name: PROJECT_TITLE });
		const session = started.host.createSession(project.id, SESSION_TITLE);
		const sid = session.id;
		const liveSession = await withTimeout(started.host.startSession(sid), 90_000, "OMP session start");
		const modelSelection = await started.host.command(sid, "approval-fixture-owner", {
			commandId: "approval-fixture-select-model",
			incarnation: liveSession.incarnation,
			command: "set_model",
			payload: { provider: "opencode-go", modelId: "muse-spark-1.3-contributor" },
		});
		check(modelSelection.status === "completed", `the runtime accepts ${MODEL} before the write turn (${JSON.stringify(modelSelection).slice(0, 500)})`);

		const owner = started.auth.ownerToken;
		const route = async (method: string, path: string, body?: unknown): Promise<unknown> => {
			const res = await started.router({ method, path, token: owner, body });
			if (res.status >= 400) {
				const failure = record(res.body, `error body for ${method} ${path}`);
				const detail = record(failure.error, `error detail for ${method} ${path}`);
				const error = new Error(typeof detail.message === "string" ? detail.message : `Host refused ${method} ${path}`);
				throw error;
			}
			return res.body;
		};
		const gateway = createAgentHostGateway({ appRoot: root, parentPid: process.pid, stateDir: join(scratch, "host") });
		const git = createAgentGitService({ ensureClient: () => gateway.ensureClient() });
		const handler = createAgentWindowHandler({
			...gateway,
			panel: async (event, surface, method, input) => {
				if (surface !== "git") throw new Error("Unsupported native panel");
				return git.handle(event, method, input);
			},
			authorize: () => true,
			pickFolder: async () => projectPath,
			openIde: async () => { throw new Error("IDE handoff is disabled in the approval proof"); },
			openExternal: async () => { throw new Error("External links are disabled in the approval proof"); },
			version: "fixture",
		});
		const assets = join(root, "dist/agent-window");
		const server = Bun.serve({
			port: 0, hostname: "127.0.0.1",
			async fetch(request) {
				const url = new URL(request.url);
				const path = resolve(assets, `.${decodeURIComponent(url.pathname)}`);
				if (path !== assets && !path.startsWith(`${assets}/`)) return new Response("Not found", { status: 404 });
				const file = Bun.file(path === assets ? join(assets, "index.html") : path);
				if (await file.exists()) return new Response(file);
				return new Response(Bun.file(join(assets, "index.html")));
			},
		});
		const browser = await chromium.launch({ headless: true, channel: "chromium" });
		const errors: string[] = [];
		try {
			const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
			page.on("pageerror", (error: Error) => errors.push(error.message));
			page.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") errors.push(message.text()); });
			await page.exposeBinding("__cediaFixtureInvoke", async (_source: unknown, channel: string, input: unknown) => {
				if (channel !== "vscode:cediaAgent") throw new Error(`Unexpected fixture IPC channel: ${channel}`);
				return handler({ sender: { send: () => {} } }, input);
			});
			await page.addInitScript(() => {
				const target = window as unknown as { __cediaFixtureInvoke(channel: string, input: unknown): Promise<unknown>; vscode: unknown };
				target.vscode = {
					context: { resolveConfiguration: async () => ({ windowId: 1, isSessionsWindow: true }) },
					process: { platform: "darwin", env: {} },
					ipcRenderer: {
						invoke: (channel: string, input: unknown) => target.__cediaFixtureInvoke(channel, input),
						send: () => {}, on: () => {}, once: () => {}, removeListener: () => {},
					},
				};
			});
			const expectedHash = `#/${encodeURIComponent(sid)}`;
			const expectedSession = record(await route("GET", `/v1/sessions/${sid}`), "the scratch session view");
			check(expectedSession.id === sid, "the host session view names the pre-created scratch task");
			check(expectedSession.title === SESSION_TITLE, "the host session view has the expected task title");
			check(expectedSession.cwd === canonicalProjectPath, `the host session view has the expected task workspace (got ${JSON.stringify({ cwd: expectedSession.cwd, expected: canonicalProjectPath })})`);
			const expectedWorkspace = record(expectedSession.workspace, "the scratch session workspace projection");
			check(expectedWorkspace.actualCwd === canonicalProjectPath, "the scratch session workspace projection names the expected cwd");
			const agentUrl = new URL(server.url.toString());
			agentUrl.hash = expectedHash.slice(1);
			await page.goto(agentUrl.toString(), { waitUntil: "networkidle", timeout: 45_000 });
			await page.waitForFunction((hash: string) => window.location.hash === hash, expectedHash, { timeout: 20_000 });
			await page.getByText(SESSION_TITLE, { exact: true }).first().waitFor({ timeout: 20_000 });
			check(await page.evaluate(() => window.location.hash) === expectedHash, "the Agent Window route selects the pre-created scratch task by id");
			await page.locator('[contenteditable="true"]').first().waitFor({ state: "visible", timeout: 20_000 });
			const fillComposerAndSend = async (text: string): Promise<void> => {
				const box = page.locator('[contenteditable="true"]').first();
				await box.fill(text);
				await page.waitForFunction(() => {
					const button = document.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null;
					return !!button && !button.disabled;
				}, undefined, { timeout: 15_000 });
				await page.getByRole("button", { name: "Send message", exact: true }).click();
			};
			const pendingUi = async (): Promise<Array<{ token: string; method: string; title: string }>> => {
				const body = await route("GET", `/v1/sessions/${sid}/ui`) as unknown;
				const rows = Array.isArray(body) ? body : record(body).requests as unknown;
				if (!Array.isArray(rows)) return [];
				return rows.map(row => {
					const item = record(row);
					const request = record(item.request ?? {});
					return { token: String(item.token ?? ""), method: String(request.method ?? ""), title: String(request.title ?? "").slice(0, 120) };
				});
			};

			// Verify the runtime's effective model before the only paid write turn.
			const modelState = record(await route("GET", `/v1/sessions/${sid}/model-state`), "the effective model state");
			check(modelState.available === true, `the selected task exposes an effective model state (${JSON.stringify(modelState).slice(0, 160)})`);
			const effectiveModel = record(modelState.model, "the effective model state model");
			check(effectiveModel.provider === "opencode-go" && effectiveModel.id === "muse-spark-1.3-contributor", `the selected task is running ${MODEL}`);
			await shot(page, "model-selected");

			// The one bounded write turn.
			await fillComposerAndSend(`Create the file ${FILENAME} in the work directory with the exact content ${CONTENT} and nothing else. Call no other tools. Then reply done.`);
			const approveDeadline = Date.now() + 300_000;
			let approveKind = "";
			for (;;) {
				const pending = await pendingUi();
				if (pending.length > 0) {
					approveKind = pending.map(entry => `${entry.method}:${entry.title}`).join(" | ");
					break;
				}
				if (Date.now() > approveDeadline) break;
				await page.waitForTimeout(3000);
			}
			check(approveKind.length > 0, `the write turn holds a broker approval prompt within 5 min (spend stops here on stall)`);
			console.log(`OK   broker holds: ${approveKind}`);
			await shot(page, "approval-prompt");
			const buttons = await page.locator("button").allTextContents();
			console.log(`OK   visible buttons include: ${JSON.stringify(buttons.map((text: string) => text.trim()).filter(Boolean).slice(0, 20))}`);
			const approve = page.locator('button:has-text("Approve")').first();
			await approve.waitFor({ timeout: 30_000 });
			await approve.click();
			const fileDeadline = Date.now() + 120_000;
			for (;;) {
				try {
					const text = await readFile(join(projectPath, FILENAME), "utf8");
					check(text === CONTENT, `the approved write lands byte-exact (got ${JSON.stringify(text).slice(0, 60)})`);
					break;
				} catch { /* not yet */ }
				if (Date.now() > fileDeadline) throw new Error(`${FAIL_PREFIX}: approved file never appeared`);
				await new Promise(resolveWait => setTimeout(resolveWait, 1000));
			}
			const turnDeadline = Date.now() + 90_000;
			for (;;) {
				const turns = started.host.store.listTurnIntents(sid);
				if (turns.some(turn => turn.state === "completed" && turn.model === MODEL)) break;
				if (Date.now() > turnDeadline) throw new Error(`${FAIL_PREFIX}: the approved ${MODEL} turn did not complete`);
				await new Promise(resolveWait => setTimeout(resolveWait, 1000));
			}
			check((await pendingUi()).length === 0, "the broker has no pending approval after completion");
			console.log(`OK   the approved ${MODEL} turn completed`);
			await shot(page, "final");
			check(errors.length === 0, `zero renderer errors (${JSON.stringify(errors).slice(0, 200)})`);
			console.log(JSON.stringify({ ok: true, version, model: MODEL, approval: approveKind }, null, 2));
		} finally {
			await browser.close().catch(() => {});
			server.stop();
		}
		await started.close().catch(() => {});
	} finally {
		await started.close().catch(() => {});
	}
} catch (error) {
	exitCode = 1;
	console.error(error instanceof Error ? error.message : error);
} finally {
	await cleanup();
}
process.exit(exitCode);
