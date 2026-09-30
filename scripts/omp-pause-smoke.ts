/**
 * Live proof of Cedia's run-pause control against the pinned runtime.
 *
 * Pausing engages the process-global pause gate every agent loop polls: runs freeze at their
 * next safe point without aborting, and resume wakes them. The parking semantics are OMP's own
 * (upstream `packages/agent/test/pause-gate.test.ts`); this smoke proves Cedia's host route
 * carries the control and the read: the owner-only durable POST drives the gate through the
 * registered `pause.set` operation, and the GET readback shows the state that followed. The
 * parked-run behavior needs no provider turn here, so no model endpoint is configured at all.
 *
 * Run: bun scripts/omp-pause-smoke.ts
 */
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP pause smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP pause smoke failed: ${message}`);
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

const modelsYaml = `providers:
  cedia-pause-fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-pause-fixture-model
        name: Cedia pause smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-pause-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-pause-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-pause-host-work-"));
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
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Pause smoke" });
	const session = started.host.createSession(project.id, "Pause smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/pause`, token: owner });
	const beforeBody = record(before.body, "pause body before start");
	check(before.status === 200 && beforeBody.state === "unavailable" && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);
	const incarnation = started.host.store.getSession(session.id)!.incarnation;

	const read = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/pause`, token: owner });
	const readBody = record(read.body, "live pause body");
	check(read.status === 200 && readBody.state === "available" && readBody.paused === false, "a fresh runtime reads as running");
	check(!("pausedAt" in readBody), "a running gate carries no pause start");

	const engaged = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/pause`,
		token: owner,
		body: { commandId: "pause-smoke-set", incarnation, paused: true },
	});
	check(engaged.status === 200, `an owner pause is accepted (${engaged.status})`);
	const engagedBody = record(engaged.body, "pause write body");
	check(engagedBody.state === "available" && engagedBody.paused === true, "the write answer carries the pause that follows");
	check(typeof engagedBody.pausedAt === "number" && (engagedBody.pausedAt as number) >= 0, "the write answer carries when the pause began");

	const reread = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/pause`, token: owner });
	const rereadBody = record(reread.body, "pause reread body");
	check(rereadBody.paused === true && rereadBody.pausedAt === engagedBody.pausedAt, "a second read shows the same pause");

	const replayed = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/pause`,
		token: owner,
		body: { commandId: "pause-smoke-set", incarnation, paused: true },
	});
	check(JSON.stringify(replayed.body) === JSON.stringify(engaged.body), "a repeated pause command id replays the same receipt");

	const released = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/pause`,
		token: owner,
		body: { commandId: "pause-smoke-release", incarnation, paused: false },
	});
	const releasedBody = record(released.body, "pause release body");
	check(released.status === 200 && releasedBody.paused === false, "an owner resume is accepted");
	check(!("pausedAt" in releasedBody), "a resumed gate carries no pause start");

	for (const [label, body] of [
		["missing paused", { commandId: "pause-smoke-bad-1", incarnation }],
		["non-boolean paused", { commandId: "pause-smoke-bad-2", incarnation, paused: "yes" }],
		["extra field", { commandId: "pause-smoke-bad-3", incarnation, paused: true, extra: true }],
	] as const) {
		const refused = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/pause`, token: owner, body });
		check(refused.status === 400, `${label} is refused before any runtime call (${refused.status})`);
	}
	const stale = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/pause`,
		token: owner,
		body: { commandId: "pause-smoke-stale", incarnation: "old", paused: true },
	});
	check(stale.status === 409, `a stale incarnation is refused (${stale.status})`);
} finally {
	await started.close();
}

await Promise.all([
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
]);
