/**
 * Live proof of Cedia's O07 Progress surface against the pinned runtime.
 *
 * OMP owns the todo phases a task is working through: `get_state` carries them and the `todo` tool's
 * result carries the same list, so Cedia reads the runtime's own progress instead of reconstructing
 * it. This smoke drives the real runtime with the Cedia virtual UI negotiated: it reads the empty
 * list, sets phases through the runtime's own `set_todos` command (no model turn, no provider call),
 * and proves the host's `GET /v1/sessions/:id/progress` answers the same phases in the same order for
 * a live session and an honest absence for a session with no runtime.
 *
 * Run: bun scripts/omp-progress-smoke.ts
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP progress smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP progress smoke failed: ${message}`);
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

const cwd = await mkdtemp(join(tmpdir(), "cedia-progress-"));
const held: Server = createServer(() => {
	/* never responds: no provider call in this run may complete */
});
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
const address = held.address();
const port = address !== null && typeof address === "object" ? (address as { port: number }).port : 0;
check(port > 0, "fixture listener bound");

const phases = [
	{ name: "Recon", tasks: [{ content: "read the host projection", status: "completed" }] },
	{
		name: "Build",
		tasks: [
			{ content: "add the route", status: "in_progress" },
			{ content: "render the panel", status: "pending" },
			{ content: "wait for the owner's call", status: "blocked", blocker: "owner has not answered yet" },
		],
	},
];

let client: OmpRpcClient | undefined;
try {
	await writeFile(
		join(cwd, "models.yml"),
		`providers:
  cedia-progress-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-progress-fixture-model
        name: Cedia progress smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`,
	);
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

	const todoPhases = async (): Promise<unknown[]> => {
		const state = record((await client!.request("get_state")).data, "get_state data");
		check(Array.isArray(state.todoPhases), "get_state carries the runtime's todo phases");
		return state.todoPhases as unknown[];
	};
	const empty = await todoPhases();
	check(empty.length === 0, "a fresh session reports no phases rather than a guessed list");

	// The runtime's own command, exactly as Cedia sends it when the owner's tool sets the list.
	const applied = record((await client.request("set_todos", { phases })).data, "set_todos data");
	check(
		JSON.stringify(applied.todoPhases) === JSON.stringify(phases),
		"the runtime answers the phases it accepted, in its own order",
	);
	const read = await todoPhases();
	check(JSON.stringify(read) === JSON.stringify(phases), "get_state answers the same phases back");
	check(JSON.stringify(read).includes("owner has not answered yet"), "a blocked task keeps the runtime's own blocker text");

	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
	await new Promise<void>(close => held.close(() => close()));
}

// ---- Cedia's own route over a live session ----
const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-progress-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-progress-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-progress-host-work-"));
await writeFile(
	join(hostProfileDir, "models.yml"),
	`providers:
  cedia-progress-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-progress-fixture-model
        name: Cedia progress smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`,
	{ mode: 0o600 },
);
const started = await startHostServer({
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
try {
	const owner = started.auth.ownerToken;
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Progress smoke" });
	const session = started.host.createSession(project.id, "Progress smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/progress`, token: owner });
	check(before.status === 200, `the progress route answers before any runtime (${before.status})`);
	check(
		record(before.body as unknown).state === "unavailable" && typeof record(before.body as unknown).reason === "string",
		"a session with no runtime reports absence with a reason instead of an empty list",
	);

	await started.host.startSession(session.id);
	const startedRuntime = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/progress`, token: owner });
	check(startedRuntime.status === 200, "the progress route answers for a live session");
	const live = record(startedRuntime.body as unknown, "progress body");
	check(live.state === "available", `a live session reports its progress state (${JSON.stringify(live).slice(0, 120)})`);
	check(Array.isArray(live.phases) && (live.phases as unknown[]).length === 0, "a live session with no phases answers an empty list, honestly");

	// The runtime's own list, set through the same command envelope the windows use.
	const incarnation = started.host.store.getSession(session.id)!.incarnation;
	const setResponse = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/commands`,
		token: owner,
		body: { commandId: "progress-smoke-set-todos", incarnation, command: "set_todos", payload: { phases } },
	});
	check(setResponse.status === 200, `the runtime takes the phases through Cedia's command envelope (${setResponse.status} ${JSON.stringify(setResponse.body).slice(0, 120)})`);

	const afterSet = record(
		(await started.router({ method: "GET", path: `/v1/sessions/${session.id}/progress`, token: owner })).body as unknown,
		"progress body after set_todos",
	);
	check(
		JSON.stringify(afterSet.phases) === JSON.stringify(phases),
		`the route answers the runtime's own phases in its own order (${JSON.stringify(afterSet.phases).slice(0, 160)})`,
	);
	check(JSON.stringify(afterSet.phases).includes("owner has not answered yet"), "the projected blocked task keeps the runtime's blocker text");

	// A read never starts anything: stopping the runtime leaves the route honest again.
	await started.host.stopSession(session.id);
	const stopped = record(
		(await started.router({ method: "GET", path: `/v1/sessions/${session.id}/progress`, token: owner })).body as unknown,
		"progress body after stop",
	);
	check(
		stopped.state === "unavailable" && typeof stopped.reason === "string",
		"a read with no live runtime reports absence with a reason and starts nothing",
	);

	const notOwner = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/progress` });
	check(notOwner.status === 401 || notOwner.status === 403, `the progress route is owner-only (${notOwner.status})`);
} finally {
	await started.close();
}

await rm(hostStateDir, { recursive: true, force: true });
await rm(hostProfileDir, { recursive: true, force: true });
await rm(hostWorkDir, { recursive: true, force: true });
await rm(cwd, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, version, phases: phases.length }, null, 2));
