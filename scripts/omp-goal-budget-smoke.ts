/**
 * Live proof of Cedia's goal budget control and budget/usage read against the pinned runtime.
 *
 * The runtime already answers `goal.set` with `op: budget` (its own `onBudgetMutated`) and
 * `goal.get` with the budget beside usage (`tokenBudget`, `tokensUsed`, `timeUsedSeconds`).
 * This smoke proves Cedia's host route carries both: the owner-only durable POST drives the
 * mutation and the GET readback shows what the runtime applied. The fixture model endpoint is
 * dead (connection refused): setting a goal dispatches its objective as a turn, which fails in
 * the background after the operation has already answered, so no provider request can complete.
 *
 * Run: bun scripts/omp-goal-budget-smoke.ts
 */
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP goal smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP goal smoke failed: ${message}`);
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
  cedia-goal-fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-goal-fixture-model
        name: Cedia goal smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-goal-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-goal-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-goal-host-work-"));
await writeFile(join(hostProfileDir, "models.yml"), modelsYaml, { mode: 0o600 });
const started = await startHostServer({
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
try {
	const controller = started.auth.issue("Goal smoke controller").token;
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Goal smoke" });
	const session = started.host.createSession(project.id, "Goal smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/goal`, token: controller });
	const beforeBody = record(before.body, "goal body before start");
	check(before.status === 200 && beforeBody.state === "unavailable" && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);
	const incarnation = started.host.store.getSession(session.id)!.incarnation;

	const set = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/goal`,
		token: started.auth.ownerToken,
		body: { commandId: "goal-smoke-set", incarnation, op: "set", objective: "Smoke the goal budget", tokenBudget: 100_000 },
	});
	check(set.status === 200, `an owner set with a budget is accepted (${set.status})`);
	const setBody = record(set.body, "goal set body");
	const setSnapshot = record(record(setBody.result, "goal set result").data, "goal set snapshot");
	const setGoal = record(setSnapshot.goal, "goal set record");
	check(setGoal.objective === "Smoke the goal budget", "the snapshot carries the runtime's own objective");
	check(setGoal.tokenBudget === 100_000, "the snapshot carries the budget the runtime applied");

	const read = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/goal`, token: controller });
	const readBody = record(read.body, "live goal body");
	check(read.status === 200 && readBody.state === "available", `a paired controller can read the task's own goal (${read.status})`);
	const readGoal = record(readBody.goal, "live goal record");
	check(readGoal.tokenBudget === 100_000, "the read shows the budget `/goal show` would report");
	check(typeof readGoal.tokensUsed === "number" && (readGoal.tokensUsed as number) >= 0, "the read shows tokens used, never as an invented number");
	check(typeof readGoal.timeUsedSeconds === "number" && (readGoal.timeUsedSeconds as number) >= 0, "the read shows elapsed seconds");
	check(readGoal.status === "active", "the read shows the live status");

	const budgeted = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/goal`,
		token: started.auth.ownerToken,
		body: { commandId: "goal-smoke-budget", incarnation, op: "budget", tokenBudget: 250_000 },
	});
	check(budgeted.status === 200, `an owner budget change is accepted (${budgeted.status})`);
	const budgetedSnapshot = record(record(record(budgeted.body, "goal budget body").result, "goal budget result").data, "goal budget snapshot");
	check(record(budgetedSnapshot.goal, "goal budget record").tokenBudget === 250_000, "the write answer carries the budget that follows");

	const reread = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/goal`, token: controller });
	check(record(record(reread.body, "goal reread body").goal, "goal reread record").tokenBudget === 250_000, "a second read shows the adjusted budget");

	const replayed = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/goal`,
		token: started.auth.ownerToken,
		body: { commandId: "goal-smoke-budget", incarnation, op: "budget", tokenBudget: 250_000 },
	});
	check(JSON.stringify(replayed.body) === JSON.stringify(budgeted.body), "a repeated budget command id replays the same receipt");

	const zero = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/goal`,
		token: started.auth.ownerToken,
		body: { commandId: "goal-smoke-zero", incarnation, op: "budget", tokenBudget: 0 },
	});
	check(zero.status === 400, `a non-positive budget is refused before any runtime call (${zero.status})`);

	const dropped = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/goal`,
		token: started.auth.ownerToken,
		body: { commandId: "goal-smoke-drop", incarnation, op: "drop" },
	});
	check(dropped.status === 200, `the smoke goal is dropped (${dropped.status})`);
} finally {
	await started.close();
}

await Promise.all([
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
]);
