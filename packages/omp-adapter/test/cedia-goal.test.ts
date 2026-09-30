import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OmpRpcClient } from "../src/client.ts";
import type { RpcCediaGoalData } from "../src/types.ts";

/**
 * The goal bridge only exists in Cedia's pinned OMP patch, so this runs against the prepared
 * runtime with a dead local model endpoint: no provider request leaves the machine. Skipped when
 * the runtime has not been built.
 */
const prepared = process.env.CEDIA_OMP_BINARY ?? join(import.meta.dir, "../../../dist/omp/omp");
const available = existsSync(prepared);

/** A throwaway agent directory: the runtime must never read the user's real config here. */
function isolatedEnv(): { env: NodeJS.ProcessEnv; dispose: () => void } {
	const dir = mkdtempSync(join(tmpdir(), "cedia-goal-test-"));
	writeFileSync(
		join(dir, "models.yml"),
		`providers:
  cedia-goal-fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-goal-fixture-model
        name: Cedia goal fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`,
		{ mode: 0o600 },
	);
	return {
		env: { ...process.env, HOME: dir, PI_CODING_AGENT_DIR: dir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
		dispose: () => rmSync(dir, { recursive: true, force: true }),
	};
}

const start = (env: NodeJS.ProcessEnv) =>
	OmpRpcClient.start({
		executable: prepared,
		cwd: join(import.meta.dir, "../../.."),
		args: ["--no-title"],
		env,
		readyTimeoutMs: 60_000,
		requestTimeoutMs: 60_000,
	});

/** One goal operation, answered with the runtime's own snapshot. */
async function goal(client: OmpRpcClient, payload: Record<string, unknown>): Promise<RpcCediaGoalData> {
	const ack = await client.requestCedia("cedia_goal", payload);
	return ack.data as RpcCediaGoalData;
}

/** The runtime's refusal text, or undefined when the operation was accepted. */
async function refusal(client: OmpRpcClient, payload: Record<string, unknown>): Promise<string | undefined> {
	try {
		await client.requestCedia("cedia_goal", payload);
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

describe.if(available)("Cedia goal bridge on the prepared runtime", () => {
	it("advertises the bridge, refuses nothing by accident, and answers an empty state honestly", async () => {
		const isolated = isolatedEnv();
		const client = await start(isolated.env);
		try {
			expect(client.readyFrame?.cediaGoalVersion).toBe(1);
			// Nothing set yet: the answer says the runtime holds no goal rather than inventing one.
			const empty = await goal(client, { op: "get" });
			expect(empty.enabled).toBe(false);
			expect(empty.goal).toBeNull();
			// An operation with nothing to act on is refused with the runtime's own words instead of
			// answering a success that changed nothing.
			expect(await refusal(client, { op: "pause" })).toContain("No active goal to pause");
			expect(await refusal(client, { op: "drop" })).toContain("No goal to drop");
			const completedWithoutGoal = await refusal(client, { op: "complete" });
			expect(completedWithoutGoal).toContain("no goal");
		} finally {
			await client.close();
			isolated.dispose();
		}
	}, 60_000);

	it("sets, pauses, resumes, budgets, completes and drops one goal through the runtime", async () => {
		const isolated = isolatedEnv();
		const client = await start(isolated.env);
		try {
			const set = await goal(client, { op: "set", objective: "Ship the goal bridge", tokenBudget: 100_000 });
			expect(set.enabled).toBe(true);
			expect(set.goal?.objective).toBe("Ship the goal bridge");
			expect(set.goal?.status).toBe("active");
			expect(set.goal?.tokenBudget).toBe(100_000);
			expect(set.startedTurn).toBe(true);
			expect(set.goal?.id).toBeTruthy();

			// A second goal is refused by OMP's own rule, and the refusal is the runtime's text.
			// A `set` where the terminal would have refused is refused here too, with OMP's own
			// wording: the owner's objective is not overwritten by a control that looks like a set.
			const second = await refusal(client, { op: "set", objective: "A different objective" });
			expect(second).toContain("already active");
			// `replace` is the operation that may change an objective, and it says so.
			const replaced = await goal(client, { op: "replace", objective: "Ship it a different way" });
			expect(replaced.goal?.objective).toBe("Ship it a different way");
			expect(replaced.enabled).toBe(true);

			const budgeted = await goal(client, { op: "budget", tokenBudget: 250_000 });
			expect(budgeted.goal?.tokenBudget).toBe(250_000);
			expect(budgeted.goal?.status).toBe("active");

			const paused = await goal(client, { op: "pause" });
			expect(paused.enabled).toBe(false);
			expect(paused.goal?.status).toBe("paused");

			const resumed = await goal(client, { op: "resume" });
			expect(resumed.enabled).toBe(true);
			expect(resumed.goal?.status).toBe("active");

			const completed = await goal(client, { op: "complete" });
			expect(completed.enabled).toBe(false);
			expect(completed.goal?.status).toBe("complete");
			expect(completed.mode).toBe("exiting");
			expect(completed.reason).toBe("completed");
			// A completed goal is a record, not a lock: dropping it clears the session's goal state.
			const dropped = await goal(client, { op: "drop" });
			expect(dropped.goal).toBeNull();
		} finally {
			await client.close();
			isolated.dispose();
		}
	}, 90_000);

	it("refuses a payload that cannot name an operation, and an operation the table does not register", async () => {
		const isolated = isolatedEnv();
		const client = await start(isolated.env);
		try {
			expect(await refusal(client, { op: "explode" })).toContain("does not know the operation");
			expect(await refusal(client, { op: "set" })).toContain("needs an objective");
			expect(await refusal(client, { op: "set", objective: "x", tokenBudget: 0 })).toContain("positive integer");

			// The registered path answers the same snapshot as the direct command, so the two
			// surfaces cannot describe different state.
			const direct = await goal(client, { op: "get" });
			const control = await client.requestCedia("cedia_control", { operation: "goal.get" });
			expect((control.data as { result: RpcCediaGoalData }).result).toEqual(direct);

			// `goal.set` validates before the handler, and its refusal names the field it needed.
			const missingObjective = await refusal(client, { op: "set" });
			expect(missingObjective).toContain("needs an objective");
		} finally {
			await client.close();
			isolated.dispose();
		}
	}, 60_000);
});
