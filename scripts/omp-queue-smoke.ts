/**
 * Live proof of Cedia's O01 queue view against the pinned runtime.
 *
 * OMP owns both user queues. This smoke reads that state through `cedia_control`, then proves the
 * host routes project the same queue, settle the exact queued turn intent when it is dropped,
 * return an explicit empty `dropped` on a no-op drop, validate an unknown mode before claiming a
 * durable command, and remain owner-only. The model fixture never answers, so no provider request
 * can complete during this run.
 *
 * Run: bun scripts/omp-queue-smoke.ts
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP queue smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP queue smoke failed: ${message}`);
	return value as Record<string, unknown>;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
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

const cwd = await mkdtemp(join(tmpdir(), "cedia-queue-"));
let modelHits = 0;
const held: Server = createServer(() => {
	modelHits += 1;
	/* never responds: no provider call in this run may complete */
});
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
held.unref();
const address = held.address();
const port = address !== null && typeof address === "object" ? (address as { port: number }).port : 0;
check(port > 0, "fixture listener bound");

const modelsYaml = `providers:
  cedia-queue-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-queue-fixture-model
        name: Cedia queue smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;
await writeFile(join(cwd, "models.yml"), modelsYaml);

let client: OmpRpcClient | undefined;
try {
	client = await OmpRpcClient.start({
		executable,
		args: ["--no-session", "--no-skills", "--no-rules", "--no-extensions", "--no-title", "--cwd", cwd],
		cwd,
		env: {
			PATH: `${dirname(executable)}${delimiter}/usr/bin${delimiter}/bin`,
			HOME: cwd,
			PI_CODING_AGENT_DIR: cwd,
			PI_NO_PTY: "1",
			PI_NOTIFICATIONS: "off",
			TERM: "xterm-256color",
			CEDIA_RPC_VIRTUAL_UI: "1",
		},
		readyTimeoutMs: 30_000,
		requestTimeoutMs: 30_000,
		onFrame() {
			/* frames are not needed for this proof */
		},
	});
	await client.requestCedia("cedia_terminal_negotiate", { version: 1, cols: 40, rows: 8 });
	const ack = await client.requestCedia("cedia_control", { operation: "queue.get" });
	const control = record(record(ack.data, "cedia_control data").result, "queue.get result");
	check(Array.isArray(control.steering) && Array.isArray(control.followUp), "the runtime answers its own steering and follow-up queues");
	check(control.steering.length === 0 && control.followUp.length === 0, "a fresh runtime reports empty queues honestly");
	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
}

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-queue-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-queue-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-queue-host-work-"));
await writeFile(join(hostProfileDir, "models.yml"), modelsYaml, { mode: 0o600 });
const started = await startHostServer({
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
try {
	const owner = started.auth.ownerToken;
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Queue smoke" });
	const session = started.host.createSession(project.id, "Queue smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/queue`, token: owner });
	const beforeBody = record(before.body, "queue body before start");
	check(before.status === 200 && beforeBody.state === "unavailable" && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);
	const live = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/queue`, token: owner });
	const liveBody = record(live.body, "live queue body");
	check(live.status === 200 && liveBody.state === "available", "the queue route answers for a live session");
	check(Array.isArray(liveBody.steering) && Array.isArray(liveBody.followUp), "the route carries both runtime queue sides");
	check((liveBody.steering as unknown[]).length === 0 && (liveBody.followUp as unknown[]).length === 0, "the route answers the runtime's empty queues");

	const incarnation = started.host.store.getSession(session.id)!.incarnation;
	const dropped = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/queue/drop`,
		token: owner,
		body: { commandId: "queue-smoke-drop", incarnation, mode: "all" },
	});
	const droppedBody = record(dropped.body, "drop body");
	check(dropped.status === 200 && droppedBody.state === "available", "the drop route answers the runtime projection");
	check(Array.isArray(droppedBody.dropped) && (droppedBody.dropped as unknown[]).length === 0, "an empty drop reports an explicit empty dropped list");
	const replay = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/queue/drop`,
		token: owner,
		body: { commandId: "queue-smoke-drop", incarnation, mode: "all" },
	});
	check(JSON.stringify(replay.body) === JSON.stringify(dropped.body), "a repeated command id replays the same drop receipt");

	const beforeInvalid = started.host.store.listCommands(session.id).length;
	const invalidMode = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/queue/drop`,
		token: owner,
		body: { commandId: "queue-smoke-invalid", incarnation, mode: "unknown" },
	});
	check(invalidMode.status === 400 && record(invalidMode.body).error && (record(record(invalidMode.body).error).code === "invalid_body"), "an unknown mode is refused before the runtime call");
	check(started.host.store.listCommands(session.id).length === beforeInvalid, "an invalid mode claims no durable command");

	const model = await started.host.command(session.id, "owner", {
		commandId: "queue-smoke-model",
		incarnation,
		command: "set_model",
		payload: { provider: "cedia-queue-fixture", modelId: "cedia-queue-fixture-model" },
	});
	check(["completed", "acknowledged"].includes(model.status), "the held-turn fixture model is accepted by OMP");
	await started.host.command(session.id, "owner", {
		commandId: "queue-smoke-running-turn",
		incarnation,
		command: "prompt",
		payload: { message: "hold this local request while the queue drop is tested" },
	});
	const runningDeadline = Date.now() + 20_000;
	while ((modelHits < 1 || started.host.store.getTurnIntentByCommand(session.id, "queue-smoke-running-turn")?.state !== "running") && Date.now() < runningDeadline) {
		await new Promise(resolveWait => setTimeout(resolveWait, 25));
	}
	check(modelHits === 1, "the active turn reached only the local held HTTP fixture");
	check(started.host.store.getTurnIntentByCommand(session.id, "queue-smoke-running-turn")?.state === "running", "OMP names the active turn as running");

	await started.host.command(session.id, "owner", {
		commandId: "queue-smoke-follow-up",
		incarnation,
		command: "follow_up",
		payload: { message: "drop this queued local submission" },
	});
	const queuedDeadline = Date.now() + 10_000;
	while (started.host.store.getTurnIntentByCommand(session.id, "queue-smoke-follow-up")?.state !== "queued" && Date.now() < queuedDeadline) {
		await new Promise(resolveWait => setTimeout(resolveWait, 25));
	}
	check(started.host.store.getTurnIntentByCommand(session.id, "queue-smoke-follow-up")?.state === "queued", "OMP accepts the follow-up as a queued turn intent");
	const queued = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/queue`, token: owner });
	const queuedBody = record(queued.body, "queued queue body");
	const followUpRows = Array.isArray(queuedBody.followUp) ? queuedBody.followUp : [];
	check(queued.status === 200 && followUpRows.some(row => record(row).text === "drop this queued local submission"), "the host projects the queued text from OMP");

	const liveDrop = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/queue/drop`,
		token: owner,
		body: { commandId: "queue-smoke-drop-live", incarnation, mode: "last" },
	});
	const liveDropBody = record(liveDrop.body, "live drop body");
	const droppedRows = Array.isArray(liveDropBody.dropped) ? liveDropBody.dropped : [];
	check(liveDrop.status === 200 && droppedRows.some(row => record(row).text === "drop this queued local submission"), "the live drop returns the exact submission removed by OMP");
	check(started.host.store.getTurnIntentByCommand(session.id, "queue-smoke-follow-up")?.state === "cancelled", "the host settles the dropped intent as cancelled");
	check(!JSON.stringify(liveDrop.body).includes("droppedIntentIds"), "internal turn identities are not exposed in the queue response");
	const liveDropReceipt = started.host.store.getCommand(session.id, "queue-smoke-drop-live");
	check(!JSON.stringify(liveDropReceipt?.ack).includes("queue-smoke-follow-up"), "the durable drop receipt omits internal turn identities");
	await new Promise(resolveWait => setTimeout(resolveWait, 100));
	check(modelHits === 1, "dropping the queued turn does not submit another provider request");

	const notOwner = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/queue` });
	check(notOwner.status === 401 || notOwner.status === 403, `the queue routes are owner-only (${notOwner.status})`);
} finally {
	await started.close();
}

await Promise.all([
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
	rm(cwd, { recursive: true, force: true }),
	new Promise<void>(close => held.close(() => close())),
]);
console.log(JSON.stringify({ ok: true, version }, null, 2));
