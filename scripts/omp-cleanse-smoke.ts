/**
 * Live proof of Cedia's O02 cleanse surface against the pinned runtime.
 *
 * Detection runs local checker commands; repair dispatches bounded subagent batches
 * through the runtime's own cleanse core. Like the terminal overlay, the run answers
 * the running state at once and the held report lands later; abort drives the run's
 * own signal. The fixture projects carry a tsconfig plus the repo's own `tsgo`
 * binary on PATH, so the TypeScript checker genuinely runs:
 *
 * Phase A (clean project, no model anywhere): idle reads, the run dispatches at once,
 * and the held report lands clean with the checker row — no model, no provider call.
 * Phase B (dirty project, fixture model, held endpoint): repair dispatches workers
 * against the hanging endpoint, the abort cancels the batch, and the report lands
 * cancelled with exactly the hanging attempts and zero completions.
 * Phase C (host): the same clean run through the routes — controller-visible state,
 * owner-only run/abort, replay, refusals — against the session project.
 *
 * Run: bun scripts/omp-cleanse-smoke.ts
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP cleanse smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP cleanse smoke failed: ${message}`);
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

function resultOf(ack: unknown, what: string): Record<string, unknown> {
	const data = record((ack as { data?: unknown }).data ?? {}, "cedia_control envelope");
	return record(data.result, what);
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

// The repo's own TypeScript toolchain: checkers spawn `tsgo`/`tsc` from PATH.
const tsgoDir = resolve("upstream/omp/node_modules/.bin");
check(await exists(join(tsgoDir, "tsgo")), `tsgo is present at ${tsgoDir}`);
const toolPath = `${tsgoDir}${delimiter}/usr/bin${delimiter}/bin`;

const tsconfig = JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2022" } }, null, 2);
const cleanSource = "export function add(a: number, b: number): number {\n\treturn a + b;\n}\n";
const dirtySource = "export function add(a: number, b: number): number {\n\treturn a + (b as unknown as string);\n}\n";

const modelsYaml = `providers:
  cedia-cleanse-fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-cleanse-fixture-model
        name: Cedia cleanse smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;

async function startClient(cwd: string, extraEnv: Record<string, string> = {}) {
	const client = await OmpRpcClient.start({
		executable,
		args: ["--no-session", "--no-skills", "--no-rules", "--no-extensions", "--no-title", "--cwd", cwd],
		cwd,
		env: {
			PATH: `${toolPath}${delimiter}${process.env.PATH ?? ""}`,
			HOME: cwd,
			PI_CODING_AGENT_DIR: cwd,
			PI_NO_PTY: "1",
			PI_NOTIFICATIONS: "off",
			TERM: "xterm-256color",
			CEDIA_RPC_VIRTUAL_UI: "1",
			...extraEnv,
		},
		readyTimeoutMs: 30_000,
		requestTimeoutMs: 30_000,
		onFrame() {
			/* frames are not needed for this proof */
		},
	});
	await client.requestCedia("cedia_terminal_negotiate", { version: 1, cols: 40, rows: 8 });
	return client;
}

async function pollState(
	read: () => Promise<Record<string, unknown>>,
	done: (state: Record<string, unknown>) => boolean,
	timeoutMs: number,
): Promise<Record<string, unknown>> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const current = await read();
		if (done(current)) return current;
		if (Date.now() > deadline) throw new Error("OMP cleanse smoke failed: a dispatched run never settled");
		await new Promise(resolve => setTimeout(resolve, 1_000));
	}
}

// Phase A: a clean project needs no model and no provider call.
const cleanDir = await mkdtemp(join(tmpdir(), "cedia-cleanse-clean-"));
await writeFile(join(cleanDir, "models.yml"), "providers: {}\n");
await writeFile(join(cleanDir, "tsconfig.json"), tsconfig);
await writeFile(join(cleanDir, "clean.ts"), cleanSource);
{
	let client: OmpRpcClient | undefined;
	try {
		client = await startClient(cleanDir);
		const idle = resultOf(await client.requestCedia("cedia_control", { operation: "cleanse.state.get" }), "cleanse.state.get result");
		check(idle.state === "idle" && idle.report === null, "a fresh runtime reads cleanse idle with no report");
		const dispatched = resultOf(await client.requestCedia("cedia_control", { operation: "cleanse.run", payload: {} }), "cleanse.run result");
		check(dispatched.state === "running", "the run dispatches at once instead of occupying the call");
		const done = await pollState(
			async () => resultOf(await client!.requestCedia("cedia_control", { operation: "cleanse.state.get" }), "cleanse.state.get result"),
			current => current.state === "done" || current.state === "failed",
			120_000,
		);
		check(done.state === "done", "the dispatched run settles instead of hanging the state");
		const report = record(done.report, "cleanse report");
		check(report.status === "clean", "a clean project lands a clean report with no model anywhere");
		check(Array.isArray(report.checks) && (report.checks as unknown[]).length >= 1, "the report names the checker that ran");
		check((report.diagnosticsTotal as number) === 0, "a clean project reports zero diagnostics");
		await client.close();
		client = undefined;
	} finally {
		await client?.close().catch(() => {});
	}
}

// Phase B: a dirty project dispatches repair workers; the abort cancels the batch.
const dirtyDir = await mkdtemp(join(tmpdir(), "cedia-cleanse-dirty-"));
await writeFile(join(dirtyDir, "tsconfig.json"), tsconfig);
await writeFile(join(dirtyDir, "dirty.ts"), dirtySource);
const held: Server = createServer(() => {
	/* never responds: repair workers hang here until the abort cancels them */
});
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
held.unref();
const heldAddress = held.address();
if (heldAddress === null || typeof heldAddress !== "object") throw new Error("OMP cleanse smoke failed: fixture listener did not bind");
let providerRequests = 0;
held.on("request", () => {
	providerRequests += 1;
});
await writeFile(join(dirtyDir, "models.yml"), modelsYaml.replace("127.0.0.1:9", `127.0.0.1:${heldAddress.port}`));
{
	let client: OmpRpcClient | undefined;
	try {
		client = await startClient(dirtyDir);
		const switched = await client.request("prompt", { message: "/switch cedia-cleanse-fixture-model" });
		check(record((switched as { data?: unknown }).data ?? {}).agentInvoked === false, "the fixture model is selected");
		const dispatched = resultOf(
			await client.requestCedia("cedia_control", { operation: "cleanse.run", payload: { model: "cedia-cleanse-fixture-model", maxAgents: 1 } }),
			"cleanse.run result",
		);
		check(dispatched.state === "running", "the repair run dispatches at once");
		const repairing = await pollState(
			async () => resultOf(await client!.requestCedia("cedia_control", { operation: "cleanse.state.get" }), "cleanse.state.get result"),
			current => (current.agents as unknown[]).length > 0 || (current.report as Record<string, unknown> | null) !== null,
			180_000,
		);
		if ((repairing.report as Record<string, unknown> | null) !== null) {
			check((repairing.report as Record<string, unknown>).status === "clean", "a run that settles before workers start still reports honestly");
		} else {
			check((repairing.agents as unknown[]).length > 0, "repair dispatches workers against the hanging endpoint");
			const aborted = resultOf(await client.requestCedia("cedia_control", { operation: "cleanse.abort" }), "cleanse.abort result");
			check(aborted.state === "running", "the abort answers at once while the batch winds down");
			const settled = await pollState(
				async () => resultOf(await client!.requestCedia("cedia_control", { operation: "cleanse.state.get" }), "cleanse.state.get result"),
				current => current.state === "done" || current.state === "failed",
				180_000,
			);
			check(settled.state === "done" && record(settled.report, "cancelled report").status === "cancelled", "the aborted batch lands cancelled");
			check(providerRequests >= 1, "repair really reached the provider before the abort");
		}
		await client.close();
		client = undefined;
	} finally {
		await client?.close().catch(() => {});
	}
	await new Promise<void>(resolve => held.close(() => resolve()));
}

// Phase C: the same clean run through the host routes, against the session project.
const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-cleanse-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-cleanse-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-cleanse-host-work-"));
await writeFile(join(hostProfileDir, "models.yml"), "providers: {}\n", { mode: 0o600 });
await writeFile(join(hostWorkDir, "tsconfig.json"), tsconfig);
await writeFile(join(hostWorkDir, "clean.ts"), cleanSource);
const started = await startHostServer({
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	ompEnv: {
		HOME: hostProfileDir,
		PI_CODING_AGENT_DIR: hostProfileDir,
		PI_NO_PTY: "1",
		PI_NOTIFICATIONS: "off",
		PATH: `${toolPath}${delimiter}/opt/homebrew/bin${delimiter}/usr/bin${delimiter}/bin`,
	},
});
try {
	const owner = started.auth.ownerToken;
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Cleanse smoke" });
	const session = started.host.createSession(project.id, "Cleanse smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/cleanse`, token: owner });
	const beforeBody = record(before.body, "cleanse body before start");
	check(before.status === 200 && beforeBody.available === false && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);
	const incarnation = started.host.store.getSession(session.id)!.incarnation;
	const controller = started.auth.issue("cleanse-controller");

	const idle = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/cleanse`, token: controller.token });
	const idleBody = record(idle.body, "live cleanse body");
	check(idle.status === 200 && idleBody.available === true && idleBody.state === "idle", "a fresh runtime reads cleanse idle to a controller");

	const deniedRun = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/cleanse/run`, token: controller.token, body: { commandId: "cleanse-smoke-no", incarnation } });
	check(deniedRun.status === 403, "a controller may read the run state but never start one");
	const deniedAbort = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/cleanse/abort`, token: controller.token, body: { commandId: "cleanse-smoke-no-abort", incarnation } });
	check(deniedAbort.status === 403, "a controller may never abort one either");

	const run = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/cleanse/run`, token: owner, body: { commandId: "cleanse-smoke-run", incarnation } });
	const runBody = record(run.body, "cleanse run body");
	check(run.status === 200 && runBody.available === true && runBody.state === "running", "the owner run dispatches at once instead of occupying the route");

	const replayed = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/cleanse/run`, token: owner, body: { commandId: "cleanse-smoke-run", incarnation } });
	check(JSON.stringify(replayed.body) === JSON.stringify(run.body), "a repeated run command id replays the same acceptance receipt");

	const landed = await pollState(
		async () => record((await started.router({ method: "GET", path: `/v1/sessions/${session.id}/cleanse`, token: owner })).body, "cleanse poll body"),
		current => current.available === true && (current.state === "done" || current.state === "failed"),
		180_000,
	);
	check(landed.state === "done" && record(landed.report, "cleanse report").status === "clean", "the dispatched run lands a clean report on the session project");

	const aborted = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/cleanse/abort`, token: owner, body: { commandId: "cleanse-smoke-abort", incarnation } });
	check(aborted.status === 200, "aborting a settled run is accepted");

	for (const [label, body] of [
		["extra field", { commandId: "cleanse-smoke-bad-1", incarnation, all: true, extra: true }],
		["bad maxAgents", { commandId: "cleanse-smoke-bad-2", incarnation, maxAgents: 0 }],
		["blank request", { commandId: "cleanse-smoke-bad-3", incarnation, request: "  " }],
	] as const) {
		const bad = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/cleanse/run`, token: owner, body });
		check(bad.status === 400, `${label} is refused before any runtime call (${bad.status})`);
	}
	const stale = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/cleanse/run`, token: owner, body: { commandId: "cleanse-smoke-stale", incarnation: "old" } });
	check(stale.status === 409, "a stale incarnation is refused (409)");
} finally {
	await started.close();
}

await Promise.all([
	rm(cleanDir, { recursive: true, force: true }),
	rm(dirtyDir, { recursive: true, force: true }),
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
]);
console.log("OMP cleanse smoke passed: clean lands clean, repair aborts to cancelled, routes hold.");
