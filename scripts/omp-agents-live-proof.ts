/**
 * Live proof of Cedia's O07 kill path against a running agent (plan §8.2 O07).
 *
 * A `/tan` dispatched through the host commands route forks a worker that hangs on
 * its first model call (the fixture endpoint never responds), so the roster carries a
 * genuinely running subagent. Cedia's own owner-only durable kill route then aborts
 * the live turn and releases the row with a tombstone. No provider turn completes
 * anywhere: zero cost, zero credentials, loopback only.
 *
 * Revive of a parked agent is NOT proven here: parking needs a worker whose turn
 * completes or yields at least once, which needs a model that answers, and no local
 * stub answers today (see findings). The script records the revive refusal of the
 * tombstoned row instead.
 *
 * Run: bun scripts/omp-agents-live-proof.ts
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP agents live proof failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP agents live proof failed: ${message}`);
	return value as Record<string, unknown>;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
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

// The fixture endpoint accepts connections and never responds: model calls hang,
// so the tan worker stays running until killed. Nothing leaves the machine.
const held: Server = createServer(() => {
	/* never responds */
});
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
const address = held.address();
const port = address !== null && typeof address === "object" ? (address as { port: number }).port : 0;
check(port > 0, "fixture listener bound (hangs every model call)");

const modelsYaml = `providers:
  cedia-live-proof-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-live-proof-model
        name: Cedia live proof fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;

type AgentRow = { id: string; name: string; kind: string; parentId?: string; status: string; sessionFile?: string };

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-live-proof-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-live-proof-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-live-proof-work-"));
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
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Live proof" });
	const session = started.host.createSession(project.id, "Live proof");
	await started.host.startSession(session.id);
	const incarnation = (started.host.store.getSession(session.id) as { incarnation: string }).incarnation;

	const sent = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/commands`,
		token: owner,
		body: { commandId: "live-proof-tan", incarnation, command: "prompt", payload: { message: "/tan probe live kill target" } },
	});
	check(sent.status === 200, `the host accepts the tan dispatch through the commands route (${sent.status})`);

	let worker: AgentRow | undefined;
	{
		const deadline = Date.now() + 90_000;
		for (;;) {
			const roster = record((await started.router({ method: "GET", path: `/v1/sessions/${session.id}/agents`, token: owner })).body, "agents body");
			const rows = ((roster as { agents?: AgentRow[] }).agents ?? []).filter(row => row.kind === "sub");
			const running = rows.find(row => row.status === "running");
			if (running !== undefined) {
				worker = running;
				break;
			}
			if (rows.length > 0 && Date.now() > deadline) {
				worker = rows[0];
				break;
			}
			if (Date.now() > deadline) throw new Error("OMP agents live proof failed: no worker row reached the roster");
			await new Promise(resolve => setTimeout(resolve, 1_000));
		}
	}
	check(worker !== undefined && worker.parentId === "Main", "the roster carries the worker with its parent linkage");
	check(worker.status === "running", `the worker is genuinely running on its hung model call (status: ${worker.status})`);

	// Focus while running: the transcript route answers, honestly unavailable or readable.
	const focus = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/agents/${worker.id}/transcript`, token: owner });
	check(focus.status === 200, "the transcript route answers for the running worker");
	const focusBody = record(focus.body, "transcript body");
	check(
		(focusBody.state === "unavailable" && typeof focusBody.reason === "string") ||
		(focusBody.state === "available" && Array.isArray(focusBody.messages) &&
			focusBody.messages.some(message => typeof record(message).text === "string" && (record(message).text as string).length > 0)),
		"focusing the running worker is honestly unavailable or already readable, never a silent empty",
	);

	// Kill through Cedia's own durable route: abort the live turn, release with tombstone.
	const killed = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/agents/kill`,
		token: owner,
		body: { commandId: "live-proof-kill", incarnation, id: worker.id },
	});
	check(killed.status === 200, `the kill route answers (${killed.status})`);
	const killBody = record(killed.body, "kill body");
	check(
		killBody.available === true && killBody.id === worker.id && killBody.aborted === true && killBody.released === true,
		`the kill aborts the running turn and releases the row (${JSON.stringify(killed.body).slice(0, 120)})`,
	);

	const after = record((await started.router({ method: "GET", path: `/v1/sessions/${session.id}/agents`, token: owner })).body, "agents body");
	const rows = ((after as { agents?: AgentRow[] }).agents ?? []).filter(row => row.id === worker!.id);
	check(rows.length <= 1, "the roster answers after the kill");
	console.log(`OBS  post-kill row: ${JSON.stringify(rows[0] ?? null).slice(0, 300)}`);
	check(
		rows.length === 0 || rows[0]!.status !== "running",
		`the killed worker no longer runs (status: ${rows[0] !== undefined ? rows[0]!.status : "released off the roster"})`,
	);

	// Revive of the tombstoned row: refused with the runtime's own reason, not revived.
	const revived = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/agents/revive`,
		token: owner,
		body: { commandId: "live-proof-revive", incarnation, id: worker.id },
	});
	check(revived.status === 200, `the revive route answers (${revived.status})`);
	const reviveBody = record(revived.body, "revive body");
	check(
		reviveBody.available === false && typeof reviveBody.reason === "string" && reviveBody.reason.length > 0,
		`reviving the tombstoned row is refused with a reason, never silently revived (${String(reviveBody.reason).slice(0, 100)})`,
	);
	console.log(`NOTE revive-parked stays unproven: a parked agent needs a worker whose turn completes or yields at least once, which needs a model that answers; no local stub answers. Refusal above is the honest boundary.`);
} finally {
	await started.close();
	await new Promise<void>(close => held.close(() => close()));
}

await Promise.all([
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
]);
console.log(JSON.stringify({ ok: true, liveKillOfRunning: true, reviveOfParked: false, reason: "no answering model stub locally" }));
