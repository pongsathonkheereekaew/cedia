/**
 * Live proof of Cedia's O07 Advisor surface against the pinned runtime.
 *
 * The advisor is OMP's own second model. This smoke drives the real runtime with the Cedia virtual UI
 * negotiated and proves the three registered operations Cedia uses - read the session's advisor state
 * and spend, switch it on and off, and read the transcript the runtime renders for `/advisor dump` -
 * plus the two owner-only host routes over them. The fixture has no model assigned to the `advisor`
 * role, so the switch-on case is the runtime's real "setting enabled, no advisor running" answer
 * rather than a fabricated success. The model endpoint never answers and no turn is run, so no
 * provider request leaves the machine.
 *
 * Run: bun scripts/omp-advisor-smoke.ts
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP advisor smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP advisor smoke failed: ${message}`);
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

const cwd = await mkdtemp(join(tmpdir(), "cedia-advisor-"));
const held: Server = createServer(() => {
	/* never responds: no provider call in this run may complete */
});
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
const address = held.address();
const port = address !== null && typeof address === "object" ? (address as { port: number }).port : 0;
check(port > 0, "fixture listener bound");
const modelsYaml = `providers:
  cedia-advisor-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-advisor-fixture-model
        name: Cedia advisor smoke fixture
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

	const control = async (operation: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>> => {
		const ack = await client!.requestCedia("cedia_control" as never, {
			operation,
			...(payload === undefined ? {} : { payload }),
		});
		return record(record(ack.data, "cedia_control data").result, `${operation} result`);
	};
	const refused = async (operation: string, payload?: Record<string, unknown>, label = operation): Promise<string> => {
		try {
			await control(operation, payload);
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
		throw new Error(`OMP advisor smoke failed: ${label} was accepted`);
	};

	const initial = await control("advisor.get");
	check(
		initial.enabled === false && initial.active === false && initial.configured === false,
		`a fresh session reports its advisor honestly off (${JSON.stringify(initial).slice(0, 140)})`,
	);
	check(Array.isArray(initial.advisors) && (initial.advisors as unknown[]).length === 0, "no advisor is invented for a session that has none");
	check(initial.changed === false, "a read claims no change");

	const on = await control("advisor.set", { enabled: true });
	check(on.enabled === true && on.changed === true, "the switch turns the advisor setting on and reports the change");
	check(
		on.configured === true && on.active === false,
		"with no model assigned to the advisor role the setting is on while no advisor runs - the runtime's own answer, not a fabricated success",
	);

	const historyWhileIdle = await control("advisor.history", { compact: true });
	check(historyWhileIdle.text === null && historyWhileIdle.truncated === false, "the transcript of a session with no running advisor is null, not empty text");

	const off = await control("advisor.set", { enabled: false });
	check(off.enabled === false && off.changed === true, "the switch turns the advisor setting off again");
	check(off.active === false, "the disabled advisor is not running");

	const missingFlag = await refused("advisor.set", {}, "advisor.set without enabled");
	check(missingFlag.length > 0, `the switch refuses a payload that does not name it (${missingFlag.slice(0, 80)})`);
	const badRead = await refused("advisor.get", { enabled: true }, "advisor.get with a payload");
	check(badRead.length > 0, `a read refuses a payload it does not take (${badRead.slice(0, 80)})`);
	const badHistory = await refused("advisor.history", { raw: true }, "advisor.history with an unknown field");
	check(badHistory.length > 0, `the transcript read refuses an unknown field (${badHistory.slice(0, 80)})`);

	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
	await new Promise<void>(close => held.close(() => close()));
}

// ---- Cedia's own routes over a live session ----
const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-advisor-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-advisor-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-advisor-host-work-"));
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
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Advisor smoke" });
	const session = started.host.createSession(project.id, "Advisor smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/advisor`, token: owner });
	check(before.status === 200, `the advisor route answers before any runtime (${before.status})`);
	check(
		record(before.body as unknown).state === "unavailable" && typeof record(before.body as unknown).reason === "string",
		"a session with no runtime reports absence with a reason instead of an empty advisor",
	);

	await started.host.startSession(session.id);
	const live = record(
		(await started.router({ method: "GET", path: `/v1/sessions/${session.id}/advisor`, token: owner })).body as unknown,
		"advisor body",
	);
	check(live.state === "available", `a live session reports its advisor state (${JSON.stringify(live).slice(0, 140)})`);
	const liveAdvisor = record(live.advisor ?? {}, "advisor snapshot");
	check(liveAdvisor.enabled === false && liveAdvisor.active === false, "the live snapshot is the runtime's own off state");

	const incarnation = started.host.store.getSession(session.id)!.incarnation;
	const setBody = { commandId: "advisor-smoke-on", incarnation, op: "set", enabled: true };
	const switched = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/advisor`, token: owner, body: setBody });
	check(switched.status === 200, `the route switches the advisor through the runtime (${switched.status} ${JSON.stringify(switched.body).slice(0, 120)})`);
	check(record(record(switched.body as unknown).advisor ?? {}).enabled === true, "the answer carries the post-change snapshot");

	// The same command id is the same command: a replay returns the recorded outcome instead of
	// running the switch a second time (a second run would answer changed:false).
	const replay = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/advisor`, token: owner, body: setBody });
	check(replay.status === 200, "a replayed command id is answered, not refused");
	check(record(replay.body as unknown).revision === record(switched.body as unknown).revision, "the replay answers the recorded outcome");

	const history = record(
		(await started.router({ method: "GET", path: `/v1/sessions/${session.id}/advisor/history`, token: owner })).body as unknown,
		"advisor history body",
	);
	check(history.state === "available" && history.text === null, "the transcript route answers the runtime's own null when no advisor runs");

	const unknownField = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/advisor`,
		token: owner,
		body: { commandId: "advisor-smoke-bad", incarnation, op: "set", enabled: true, nope: 1 },
	});
	check(unknownField.status === 400, `an unknown body field is refused before any runtime call (${unknownField.status})`);

	const notOwner = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/advisor` });
	check(notOwner.status === 401 || notOwner.status === 403, `the advisor routes are owner-only (${notOwner.status})`);

	await started.host.stopSession(session.id);
	const stopped = record(
		(await started.router({ method: "GET", path: `/v1/sessions/${session.id}/advisor`, token: owner })).body as unknown,
		"advisor body after stop",
	);
	check(
		stopped.state === "unavailable" && typeof stopped.reason === "string",
		"a read with no live runtime reports absence with a reason and starts nothing",
	);
} finally {
	await started.close();
}

await rm(hostStateDir, { recursive: true, force: true });
await rm(hostProfileDir, { recursive: true, force: true });
await rm(hostWorkDir, { recursive: true, force: true });
await rm(cwd, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, version }, null, 2));
