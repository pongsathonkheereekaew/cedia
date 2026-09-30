/**
 * EXPLICIT live proof with the user's own OMP-native auth (plan §8.2 O07).
 *
 * Unlike the isolated smokes (throwaway HOME, fixture/dead model endpoints), this runs
 * against the personal OMP profile (real HOME) and the zero-cost model configured there
 * (`opencode-zen/union-alpha`, cost 0 — no purchase, no top-up, no new signup). ONE
 * worker turn only: `/tan` dispatched through the host commands route (the parent makes
 * no model call), the worker answers a tool-free prompt and parks through the real
 * controller path, then Cedia's durable revive route restores it. The run aborts (and
 * kills the worker through the same vertical) if the worker exceeds its time box or
 * the model call fails — a failure is recorded, never retried into spend.
 *
 * Run: bun scripts/omp-agents-native-proof.ts
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

const FREE_MODEL = "union-alpha";
const WORKER_BUDGET_MS = 240_000;

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP agents native proof failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP agents native proof failed: ${message}`);
	return value as Record<string, unknown>;
}

type AgentRow = { id: string; name: string; kind: string; parentId?: string; status: string; sessionFile?: string };

const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/") ? resolve(requested) : requested;
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `the runtime is the pinned ${OMP_BASELINE_VERSION} or later (${version})`);
if (!process.env.HOME) throw new Error("refusing to run: real HOME is required for native auth");

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-native-proof-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-native-proof-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-native-proof-work-"));
await writeFile(join(hostWorkDir, "AGENTS.md"), "# Proof workspace\n\nA worker that answers must not need this file.\n");
const started = await startHostServer({
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	// NOTE: no HOME and no PI_CODING_AGENT_DIR override — the runtime resolves the
	// personal profile exactly like a personal app launch (native auth). Only the
	// non-profile runtime flags are set.
	ompEnv: { PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
try {
	const owner = started.auth.ownerToken;
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Native proof" });
	const session = started.host.createSession(project.id, "Native proof");
	await started.host.startSession(session.id);
	const incarnation = (started.host.store.getSession(session.id) as { incarnation: string }).incarnation;

	const switched = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/commands`,
		token: owner,
		body: { commandId: "native-proof-switch", incarnation, command: "prompt", payload: { message: `/switch ${FREE_MODEL}` } },
	});
	check(sentOk(switched.status), `the session switches to the zero-cost model (${switched.status})`);

	const sent = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/commands`,
		token: owner,
		body: { commandId: "native-proof-tan", incarnation, command: "prompt", payload: { message: "/tan reply with exactly the single word done; call no tools" } },
	});
	check(sentOk(sent.status), "the tan dispatches through the commands route (no parent model call)");

	let worker: AgentRow | undefined;
	const deadline = Date.now() + WORKER_BUDGET_MS;
	for (;;) {
		const roster = record((await started.router({ method: "GET", path: `/v1/sessions/${session.id}/agents`, token: owner })).body, "agents body");
		const rows = ((roster as { agents?: AgentRow[] }).agents ?? []).filter(row => row.kind === "sub");
		const parked = rows.find(row => row.status === "parked");
		if (parked !== undefined) {
			worker = parked;
			break;
		}
		if (Date.now() > deadline) {
			const running = rows.find(row => row.status === "running");
			if (running !== undefined) {
				await started.router({
					method: "POST",
					path: `/v1/sessions/${session.id}/agents/kill`,
					token: owner,
					body: { commandId: "native-proof-timeout-kill", incarnation, id: running.id },
				});
			}
			throw new Error(`worker did not park within ${WORKER_BUDGET_MS}ms (over budget: killed, recorded, not retried)`);
		}
		await new Promise(resolve => setTimeout(resolve, 2_000));
	}
	check(worker !== undefined && worker.parentId === "Main", "the native-model worker parked through the real controller path");

	const transcript = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/agents/${worker.id}/transcript`, token: owner });
	check(transcript.status === 200, "the parked worker transcript answers");

	const revived = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/agents/revive`,
		token: owner,
		body: { commandId: "native-proof-revive", incarnation, id: worker.id },
	});
	const reviveBody = record(revived.body, "revive body");
	check(
		revived.status === 200 && reviveBody.available === true && reviveBody.revived === true,
		`Cedia revive restores the natively-parked worker (${JSON.stringify(revived.body).slice(0, 100)})`,
	);
} finally {
	await started.close();
}

await Promise.all([
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
]);
console.log(JSON.stringify({ ok: true, model: FREE_MODEL, spend: "one zero-cost worker turn" }));

function sentOk(status: number): boolean {
	return status === 200;
}
