/**
 * Live proof of Cedia's Python execution control against the pinned runtime.
 *
 * Code runs one-shot through the session's shared kernel — the same kernel the eval tool
 * collaborates on — with no chunk streaming on this path. This smoke proves Cedia's host
 * routes carry the control and the read: the owner-only durable POST drives the run through
 * the registered `python.exec` operation and answers the bounded result, and `python.abort`
 * cancels a running sleep. Rich display outputs are counted, never embedded. No provider is
 * configured and no model turn runs.
 *
 * Run: bun scripts/omp-python-smoke.ts
 */
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP Python smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP Python smoke failed: ${message}`);
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

const sleep = (ms: number) => new Promise<void>(ready => setTimeout(ready, ms));

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
  cedia-python-fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-python-fixture-model
        name: Cedia Python smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-python-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-python-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-python-host-work-"));
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
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Python smoke" });
	const session = started.host.createSession(project.id, "Python smoke");
	await started.host.startSession(session.id);
	const incarnation = started.host.store.getSession(session.id)!.incarnation;
	const post = (suffix: string, body: Record<string, unknown>) =>
		started.router({ method: "POST", path: `/v1/sessions/${session.id}/python/${suffix}`, token: owner, body });

	const ran = await post("exec", { commandId: "python-smoke-run", incarnation, code: 'print("hi-python")' });
	check(ran.status === 200, `an owner exec is accepted (${ran.status})`);
	const ranBody = record(ran.body, "Python exec body");
	check(ranBody.state === "available" && ranBody.exitCode === 0 && ranBody.cancelled === false, "a passing snippet answers its exit");
	check(typeof ranBody.output === "string" && (ranBody.output as string).includes("hi-python"), "the answer carries the snippet's output");

	const failed = await post("exec", { commandId: "python-smoke-fail", incarnation, code: "1 / 0" });
	const failedBody = record(failed.body, "Python fail body");
	check(failed.status === 200 && failedBody.state === "available" && failedBody.exitCode === 1, "a failing snippet is answered, not errored");

	const replayed = await post("exec", { commandId: "python-smoke-run", incarnation, code: 'print("hi-python")' });
	check(JSON.stringify(replayed.body) === JSON.stringify(ran.body), "a repeated exec command id replays the same receipt");

	const sleepy = post("exec", { commandId: "python-smoke-sleep", incarnation, code: "import time\ntime.sleep(20)" });
	await sleep(2000);
	const aborted = await post("abort", { commandId: "python-smoke-abort", incarnation });
	const abortedBody = record(aborted.body, "Python abort body");
	check(aborted.status === 200 && abortedBody.aborted === true, "an abort is accepted while code runs");
	const cancelled = record(await sleepy.then(response => response.body), "Python sleep body");
	check(cancelled.state === "available" && cancelled.cancelled === true, "the running snippet answers cancelled");

	const idle = await post("abort", { commandId: "python-smoke-idle", incarnation });
	check(record(idle.body, "Python idle body").aborted === true, "an abort with nothing running is still accepted");

	for (const [label, body] of [
		["missing code", { commandId: "python-smoke-bad-1", incarnation }],
		["blank code", { commandId: "python-smoke-bad-2", incarnation, code: "  " }],
		["extra field", { commandId: "python-smoke-bad-3", incarnation, code: "print(1)", extra: true }],
	] as const) {
		const refused = await post("exec", body);
		check(refused.status === 400, `${label} is refused before any runtime call (${refused.status})`);
	}
	const stale = await post("exec", { commandId: "python-smoke-stale", incarnation: "old", code: "print(1)" });
	check(stale.status === 409, `a stale incarnation is refused (${stale.status})`);
} finally {
	await started.close();
}

await Promise.all([
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
]);
