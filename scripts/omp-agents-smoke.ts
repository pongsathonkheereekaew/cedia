/**
 * Live proof of Cedia's O07 Agents view against the pinned runtime.
 *
 * The Agents view reads the runtime's own registry (the same roster the terminal's Agent Hub renders)
 * and opens one agent's child transcript through the runtime's existing `get_subagent_messages`
 * command. This smoke drives the prepared runtime with the Cedia virtual UI negotiated and proves the
 * roster read, the transcript command's own refusals, and the owner-only host routes over both. No
 * model endpoint answers and no turn runs, so no provider request leaves the machine; a session with
 * no subagents has an empty roster, which is the honest answer for it.
 *
 * Run: bun scripts/omp-agents-smoke.ts
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP agents smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP agents smoke failed: ${message}`);
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

const cwd = await mkdtemp(join(tmpdir(), "cedia-agents-"));
const held: Server = createServer(() => {
	/* never responds: no provider call in this run may complete */
});
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
const address = held.address();
const port = address !== null && typeof address === "object" ? (address as { port: number }).port : 0;
check(port > 0, "fixture listener bound");
const modelsYaml = `providers:
  cedia-agents-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-agents-fixture-model
        name: Cedia agents smoke fixture
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

	const roster = await control("agents.get");
	check(Array.isArray(roster.agents), "the roster read answers the registry's own agent list");
	const rosterAgents = roster.agents as Record<string, unknown>[];
	check(
		rosterAgents.every(agent => typeof agent.id === "string" && typeof agent.name === "string" && typeof agent.kind === "string" && typeof agent.status === "string"),
		`every roster row carries the runtime's own identity (${rosterAgents.length} agent(s))`,
	);
	check(
		rosterAgents.every(agent => agent.sessionFile === undefined || typeof agent.sessionFile === "string"),
		"a roster row names a transcript file only when the agent has one",
	);
	const badRead = await (async () => {
		try {
			await control("agents.get", { id: "x" });
			return undefined;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	})();
	check(typeof badRead === "string" && badRead.length > 0, `the roster read refuses a payload it does not take (${String(badRead).slice(0, 80)})`);

	// Kill and revive validate strictly, then refuse unknown ids with the runtime's own
	// sentence. This session holds no subagents, so only the guard paths run live here;
	// a real kill/revive of a live/parked agent needs a provider turn.
	for (const operation of ["agents.kill", "agents.revive"]) {
		const badPayload = await (async () => {
			try {
				await control(operation, { nope: 1 });
				return undefined;
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
		})();
		check(
			typeof badPayload === "string" && badPayload.includes("takes only an id"),
			`${operation} refuses a payload it does not take (${String(badPayload).slice(0, 80)})`,
		);
		const unknown = await (async () => {
			try {
				await control(operation, { id: "no-such-agent" });
				return undefined;
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
		})();
		check(
			typeof unknown === "string" && unknown.includes("Unknown agent: no-such-agent"),
			`${operation} refuses an agent it never had by name (${String(unknown).slice(0, 80)})`,
		);
	}

	// The transcript command is the runtime's own; an agent it never had is refused by name.
	const unknownTranscript = await (async () => {
		try {
			await client!.request("get_subagent_messages", { subagentId: "no-such-agent" });
			return undefined;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	})();
	check(
		typeof unknownTranscript === "string" && unknownTranscript.length > 0,
		`the transcript command refuses an agent it never had (${String(unknownTranscript).slice(0, 90)})`,
	);

	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
	await new Promise<void>(close => held.close(() => close()));
}

// ---- Cedia's own routes over a live session ----
const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-agents-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-agents-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-agents-host-work-"));
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
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Agents smoke" });
	const session = started.host.createSession(project.id, "Agents smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/agents`, token: owner });
	check(before.status === 200, `the agents route answers before any runtime (${before.status})`);
	check(
		record(before.body as unknown).state === "unavailable" && typeof record(before.body as unknown).reason === "string",
		"a session with no runtime reports absence with a reason instead of an empty roster",
	);

	await started.host.startSession(session.id);
	const live = record(
		(await started.router({ method: "GET", path: `/v1/sessions/${session.id}/agents`, token: owner })).body as unknown,
		"agents body",
	);
	check(live.state === "available" && Array.isArray(live.agents), `a live session reports its agent roster (${JSON.stringify(live).slice(0, 140)})`);

	const unknownAgent = record(
		(
			await started.router({
				method: "GET",
				path: `/v1/sessions/${session.id}/agents/no-such-agent/transcript`,
				token: owner,
			})
		).body as unknown,
		"transcript body",
	);
	check(
		unknownAgent.state === "unavailable" && typeof unknownAgent.reason === "string",
		`a transcript read for an agent the runtime does not have is refused with a reason (${String(unknownAgent.reason).slice(0, 90)})`,
	);

	const badFrom = await started.router({
		method: "GET",
		path: `/v1/sessions/${session.id}/agents/anything/transcript?fromByte=-1`,
		token: owner,
	});
	check(badFrom.status === 400, `a negative fromByte is refused before any runtime call (${badFrom.status})`);

	const unknownQuery = await started.router({
		method: "GET",
		path: `/v1/sessions/${session.id}/agents?nope=1`,
		token: owner,
	});
	check(unknownQuery.status === 400, `an unknown query parameter is refused (${unknownQuery.status})`);

	const notOwner = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/agents` });
	check(notOwner.status === 401 || notOwner.status === 403, `the agents routes are owner-only (${notOwner.status})`);

	const incarnation = (started.host.store.getSession(session.id) as { incarnation: string }).incarnation;
	const killUnknown = record(
		(
			await started.router({
				method: "POST",
				path: `/v1/sessions/${session.id}/agents/kill`,
				token: owner,
				body: { commandId: "smoke-kill-unknown", incarnation, id: "no-such-agent" },
			})
		).body as unknown,
		"kill body",
	);
	check(
		killUnknown.available === false && typeof killUnknown.reason === "string" && killUnknown.reason.includes("Unknown agent"),
		`a kill for an agent the runtime does not have answers unavailable with its reason (${String(killUnknown.reason).slice(0, 80)})`,
	);
	const killReplay = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/agents/kill`,
		token: owner,
		body: { commandId: "smoke-kill-unknown", incarnation, id: "no-such-agent" },
	});
	check(
		killReplay.status === 200 && JSON.stringify(killReplay.body) === JSON.stringify({ available: false, reason: killUnknown.reason }),
		"a repeated kill command id replays the stored refusal",
	);
	const reviveUnknown = record(
		(
			await started.router({
				method: "POST",
				path: `/v1/sessions/${session.id}/agents/revive`,
				token: owner,
				body: { commandId: "smoke-revive-unknown", incarnation, id: "no-such-agent" },
			})
		).body as unknown,
		"revive body",
	);
	check(
		reviveUnknown.available === false && typeof reviveUnknown.reason === "string",
		"a revive for an agent the runtime does not have answers unavailable with a reason",
	);
	const badKill = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/agents/kill`,
		token: owner,
		body: { commandId: "smoke-kill-bad", incarnation, id: "" },
	});
	check(badKill.status === 400, `an empty agent id is refused before any runtime call (${badKill.status})`);
	const controllerKill = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/agents/kill`,
		token: (await started.auth.issue("kill-controller")).token,
		body: { commandId: "smoke-kill-controller", incarnation, id: "no-such-agent" },
	});
	check(controllerKill.status === 403, `the kill route is owner-only (${controllerKill.status})`);

	const configList = record(
		(await started.router({ method: "GET", path: `/v1/sessions/${session.id}/agents/config`, token: owner })).body as unknown,
		"config list body",
	);
	check(
		configList.state === "available" && Array.isArray(configList.agents) && (configList.agents as unknown[]).length > 0,
		`the config list answers the discovery table (${(configList.agents as unknown[]).length} agent(s))`,
	);
	const taskRow = (configList.agents as Record<string, unknown>[]).find(row => row.name === "task");
	check(taskRow !== undefined && taskRow.enabled === true, "the bundled task agent lists enabled with no overrides");
	const configured = record(
		(
			await started.router({
				method: "POST",
				path: `/v1/sessions/${session.id}/agents/config`,
				token: owner,
				body: { commandId: "smoke-config-set", incarnation, agent: "task", model: "smoke/model" },
			})
		).body as unknown,
		"config body",
	);
	check(
		configured.available === true && configured.agent === "task" && configured.model === "smoke/model",
		`a model override writes through the hub semantics (${JSON.stringify(configured).slice(0, 100)})`,
	);
	const reread = record(
		(await started.router({ method: "GET", path: `/v1/sessions/${session.id}/agents/config`, token: owner })).body as unknown,
		"config reread body",
	);
	const rereadTask = ((reread.agents ?? []) as Record<string, unknown>[]).find(row => row.name === "task");
	check(rereadTask !== undefined && rereadTask.model === "smoke/model", "the override reads back on the list");
	const cleared = record(
		(
			await started.router({
				method: "POST",
				path: `/v1/sessions/${session.id}/agents/config`,
				token: owner,
				body: { commandId: "smoke-config-clear", incarnation, agent: "task", model: "  " },
			})
		).body as unknown,
		"config clear body",
	);
	check(cleared.available === true && cleared.model === undefined, "an empty override clears the map entry");
	const configUnknown = record(
		(
			await started.router({
				method: "POST",
				path: `/v1/sessions/${session.id}/agents/config`,
				token: owner,
				body: { commandId: "smoke-config-unknown", incarnation, agent: "no-such-agent", enabled: false },
			})
		).body as unknown,
		"config unknown body",
	);
	check(
		configUnknown.available === false && typeof configUnknown.reason === "string" && configUnknown.reason.includes("Unknown agent"),
		`a config for an undiscovered agent answers unavailable with its reason (${String(configUnknown.reason).slice(0, 80)})`,
	);
	const configReplay = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/agents/config`,
		token: owner,
		body: { commandId: "smoke-config-unknown", incarnation, agent: "no-such-agent", enabled: false },
	});
	check(
		configReplay.status === 200 && JSON.stringify(configReplay.body) === JSON.stringify({ available: false, reason: configUnknown.reason }),
		"a repeated config command id replays the stored refusal",
	);
	const configEmpty = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/agents/config`,
		token: owner,
		body: { commandId: "smoke-config-empty", incarnation, agent: "task" },
	});
	check(configEmpty.status === 400, `a config with no fields is refused before any runtime call (${configEmpty.status})`);
	const controllerConfig = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/agents/config`,
		token: (await started.auth.issue("config-controller")).token,
		body: { commandId: "smoke-config-controller", incarnation, agent: "task", enabled: false },
	});
	check(controllerConfig.status === 403, `the config route is owner-only (${controllerConfig.status})`);

	await started.host.stopSession(session.id);
	const stopped = record(
		(await started.router({ method: "GET", path: `/v1/sessions/${session.id}/agents`, token: owner })).body as unknown,
		"agents body after stop",
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
