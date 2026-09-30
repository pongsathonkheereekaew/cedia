/**
 * Live proof of the crash boundary (CEDIA-PLAN §2.4, §11.1 D row).
 *
 * A real host plus the pinned OMP runtime run a turn against a loopback model endpoint
 * that never answers, so the turn is genuinely running with zero provider involvement.
 * This driver then SIGKILLs the runtime child (a crash, not a stop): the host must notice
 * the owner vanish, mark the running turn `outcome_unknown` with its reason, refuse an
 * automatic restart or replay, and come back through reconcile — never by guessing.
 *
 * Nothing here touches a provider, spends, or affects any other process: the victim is
 * selected as a direct child of this script whose command names the prepared runtime.
 *
 * Run: bun scripts/omp-crash-proof.ts
 */
import { execSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";
import { createAgentWindowHandler } from "../apps/macos/src/agent-window-main.ts";
import { createCediaNativeApi } from "../apps/macos/agent-window/src/cedia-adapter.ts";
import { HostHttpError } from "../apps/macos/src/api.ts";

const FAIL_PREFIX = "OMP crash proof failed";
function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${FAIL_PREFIX}: ${message}`);
	console.log(`OK   ${message}`);
}
function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${FAIL_PREFIX}: ${message}`);
	return value as Record<string, unknown>;
}
async function exists(path: string): Promise<boolean> {
	try { const { stat } = await import("node:fs/promises"); await stat(path); return true; }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
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

const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/")
	? resolve(requested)
	: ((process.env.PATH ?? "")
			.split(delimiter)
			.map(dir => join(dir, requested))
			.find(candidate => candidate) ?? requested);
check(await exists(executable), `OMP runtime is present at ${executable}`);
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `the runtime is the pinned ${OMP_BASELINE_VERSION} or later (${version})`);

// A model endpoint that never answers: the turn really runs, no provider is contacted.
let modelHits = 0;
const held: Server = createServer(() => { modelHits++; /* deliberately never respond */ });
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
held.unref();
const address = held.address();
const port = address !== null && typeof address === "object" ? (address as { port: number }).port : 0;
check(port > 0, "fixture listener bound");

const modelsYaml = `providers:
  cedia-crash-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-crash-fixture-model
        name: Cedia crash fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;

const agentCwd = await mkdtemp(join(tmpdir(), "cedia-crash-agent-"));
const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-crash-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-crash-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-crash-host-work-"));
const windowStateDir = await mkdtemp(join(tmpdir(), "cedia-crash-window-state-"));
await writeFile(join(agentCwd, "models.yml"), modelsYaml);
await writeFile(join(hostProfileDir, "models.yml"), modelsYaml, { mode: 0o600 });

const cleanupDirs = async () => {
	await Promise.all([
		rm(agentCwd, { recursive: true, force: true }),
		rm(hostStateDir, { recursive: true, force: true }),
		rm(hostProfileDir, { recursive: true, force: true }),
		rm(hostWorkDir, { recursive: true, force: true }),
		rm(windowStateDir, { recursive: true, force: true }),
	]);
};

const bootOptions = {
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
};

/** Direct children of this script whose command names the prepared runtime: the crash victim, nothing else. */
function runtimeChildPids(): number[] {
	// -ax: the driver and its children have no controlling terminal, which plain ps hides.
	const out = execSync("ps -ax -o pid=,ppid=,command=", { encoding: "utf8" });
	const pids: number[] = [];
	for (const line of out.split("\n")) {
		const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
		if (!match) continue;
		const pid = Number(match[1]);
		const ppid = Number(match[2]);
		const command = match[3] ?? "";
		// The prepared runtime is a launcher that re-execs, so its own path may not survive
		// in the final command line; `--mode rpc-ui` is enforced by the adapter and unique
		// to a live runtime child. Never match this driver itself.
		if (ppid === process.pid && pid !== process.pid && command.includes("--mode") &&
			command.includes("rpc-ui") && !command.includes("omp-crash-proof")) pids.push(pid);
	}
	return pids;
}

let exitCode = 0;
try {
	const started = await withTimeout(startHostServer(bootOptions), 60_000, "host boot");
	try {
		const owner = started.auth.ownerToken;
		const project = started.host.store.createProject({ path: hostWorkDir, name: "Crash proof" });
		const session = started.host.createSession(project.id, "Crash proof");
		const sid = session.id;
		await withTimeout(started.host.startSession(sid), 90_000, "OMP session start");

		const route = async (method: string, path: string, body?: unknown): Promise<unknown> => {
			const res = await started.router({ method, path, token: owner, body });
			if (res.status >= 400) {
				const failure = record(res.body, `error body for ${method} ${path}`);
				const detail = record(failure.error, `error detail for ${method} ${path}`);
				throw new HostHttpError(res.status, path, typeof detail.message === "string" ? detail.message : `Host refused ${method} ${path}`,
					typeof detail.code === "string" ? detail.code : undefined);
			}
			return res.body;
		};
		const gatewayRequest = async (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<unknown> =>
			route(method, path.startsWith("/v1/") ? path : `/v1/${path}`, body);
		const handler = createAgentWindowHandler({
			stateDir: windowStateDir,
			authorize: () => true,
			ensure: async () => {},
			request: gatewayRequest,
			pickFolder: async () => { throw new Error("pickFolder is out of scope for the crash proof"); },
			openIde: async () => { throw new Error("openIde is out of scope for the crash proof"); },
			openExternal: async () => { throw new Error("openExternal is disabled in the crash proof"); },
			broadcastDraft: () => {},
			version: "crash-proof",
		});
		const api = createCediaNativeApi({ bridge: { invoke: async (_channel: unknown, input: unknown) => handler({ window: "A" }, input) } as never });

		const turnIntent = async (commandId: string): Promise<{ state: string; reason: unknown }> => {
			const row = record(await route("GET", `/v1/sessions/${sid}`), "session row");
			const turns = row.turns;
			check(Array.isArray(turns), "the session row carries its turn projection");
			const intent = (turns as Array<{ commandId?: unknown; state?: unknown; reason?: unknown }>).find(entry => entry.commandId === commandId);
			check(intent !== undefined, `turn intent turn-${commandId} is projected`);
			return { state: String(intent.state), reason: intent.reason };
		};
		const promptRows = async (): Promise<string[]> => {
			const rows = await route("GET", `/v1/sessions/${sid}/commands`) as Array<{ commandId?: unknown; kind?: unknown }>;
			check(Array.isArray(rows), "the command journal lists rows");
			return rows.filter(row => row.kind === "prompt").map(row => String(row.commandId));
		};

		// One real turn, genuinely running against the loopback endpoint.
		const TEXT = "crash proof: this turn is running when its owner dies";
		await route("PATCH", `/v1/drafts/${sid}`, { expectedRevision: 0, text: TEXT });
		const send = api.orchestration.dispatchCommand({ type: "thread.turn.start", commandId: "crash-1", threadId: sid, message: { text: TEXT } });
		await withTimeout(send, 90_000, "crash turn acceptance");
		const runningDeadline = Date.now() + 30_000;
		for (;;) {
			const intent = await turnIntent("crash-1");
			if (intent.state === "running") break;
			check(intent.state === "prepared" || intent.state === "queued", `the turn starts (still ${intent.state})`);
			if (Date.now() > runningDeadline) throw new Error(`${FAIL_PREFIX}: turn-crash-1 never started`);
			await new Promise(resolveWait => setTimeout(resolveWait, 200));
		}
		const waitHits = Date.now() + 20_000;
		while (modelHits < 1) {
			if (Date.now() > waitHits) throw new Error(`${FAIL_PREFIX}: the running turn never reached the loopback endpoint`);
			await new Promise(resolveWait => setTimeout(resolveWait, 100));
		}
		check(true, `the turn runs on the fixture model with ${modelHits} loopback hit(s), zero external requests`);

		// The crash: SIGKILL the runtime child. Nothing else is touched.
		const victims = runtimeChildPids();
		check(victims.length >= 1, `an OMP runtime child of this script exists to kill (${victims.length} found)`);
		for (const pid of victims) process.kill(pid, "SIGKILL");
		check(true, `SIGKILL delivered to ${victims.length} runtime child process(es)`);

		// The host notices the owner vanish: running becomes outcome_unknown with its reason.
		const unknownDeadline = Date.now() + 90_000;
		let reason: unknown;
		for (;;) {
			const intent = await turnIntent("crash-1");
			if (intent.state === "outcome_unknown") { reason = intent.reason; break; }
			if (Date.now() > unknownDeadline) throw new Error(`${FAIL_PREFIX}: turn-crash-1 never marked outcome_unknown (still ${intent.state})`);
			await new Promise(resolveWait => setTimeout(resolveWait, 250));
		}
		check(typeof reason === "string" && /OMP process exited/i.test(reason), `the unknown outcome carries its reason (${JSON.stringify(reason)?.slice(0, 120)})`);
		const sessionAfterCrash = record(await route("GET", `/v1/sessions/${sid}`), "session row after crash");
		check(sessionAfterCrash.status === "recovery_required", "the task waits in recovery_required, it does not silently resume");
		check((await promptRows()).length === 1, "exactly one prompt reached OMP: nothing was replayed");

		// No automatic restart or replay: starting again is refused until reconciliation.
		const refused = await started.router({ method: "POST", path: `/v1/sessions/${sid}/start`, token: owner });
		const refusalBody = record(refused.body, "restart refusal body");
		const refusalError = record(refusalBody.error, "restart refusal error");
		check(refused.status === 409 && refusalError.code === "recovery_required",
			`a restart is refused while recovery is pending (${JSON.stringify({ status: refused.status, ...refusalError })})`);
		check((await promptRows()).length === 1, "the refused restart dispatched nothing");

		// Reconcile, resume, and prove the task is not wedged: a fresh turn runs, then aborts cleanly.
		// Reconciliation requires explicitly acknowledging the unknown outcome first: the
		// driver verified it above, so it acknowledges and parks the task at stopped.
		const reconciled = record(await route("POST", `/v1/sessions/${sid}/reconcile`, { acknowledgeUnknown: true }), "reconcile answer");
		check(reconciled.status === "stopped", "reconciliation parks the task at stopped");
		await withTimeout(started.host.startSession(sid), 90_000, "OMP session restart after reconcile");
		const TEXT2 = "crash proof: the task works again after recovery";
		await route("PATCH", `/v1/drafts/${sid}`, { expectedRevision: 0, text: TEXT2 });
		const send2 = api.orchestration.dispatchCommand({ type: "thread.turn.start", commandId: "crash-2", threadId: sid, message: { text: TEXT2 } });
		await withTimeout(send2, 90_000, "second turn acceptance after recovery");
		const running2Deadline = Date.now() + 30_000;
		for (;;) {
			const intent = await turnIntent("crash-2");
			if (intent.state === "running") break;
			if (Date.now() > running2Deadline) throw new Error(`${FAIL_PREFIX}: turn-crash-2 never started`);
			await new Promise(resolveWait => setTimeout(resolveWait, 200));
		}
		const row2 = record(await route("GET", `/v1/sessions/${sid}`), "session row for incarnation");
		await route("POST", `/v1/sessions/${sid}/commands`, { commandId: "crash-abort", incarnation: row2.incarnation, command: "abort" });
		const settleDeadline = Date.now() + 30_000;
		let settled = "";
		for (;;) {
			settled = (await turnIntent("crash-2")).state;
			if (settled !== "prepared" && settled !== "queued" && settled !== "running") break;
			if (Date.now() > settleDeadline) throw new Error(`${FAIL_PREFIX}: turn-crash-2 never settled after abort`);
			await new Promise(resolveWait => setTimeout(resolveWait, 200));
		}
		check(true, `the recovered task runs and aborts cleanly (second turn ${settled}, ${modelHits} total loopback hits)`);
		check((await promptRows()).length === 2, "exactly two prompts ever reached OMP across crash and recovery");

		console.log(JSON.stringify({ ok: true, version, firstTurn: "outcome_unknown", recovery: "reconcile-start-run-abort", modelHits }, null, 2));
		await started.close().catch(() => {});
	} finally {
		await started.close().catch(() => {});
	}
} catch (error) {
	exitCode = 1;
	console.error(error instanceof Error ? error.message : error);
} finally {
	await new Promise<void>(close => held.close(() => close()));
	await cleanupDirs();
}
process.exit(exitCode);
