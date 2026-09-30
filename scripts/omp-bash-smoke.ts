/**
 * Live proof of Cedia's session-bash control against the pinned runtime.
 *
 * OMP owns a foreground shell per session; Cedia drives the audited `bash`/`abort_bash`
 * commands one-shot through owner-only durable host routes — no PTY streaming on this path.
 * This smoke proves the route carries real executions: exact output with the exit code, a
 * failing command answered (not errored), an abort that cancels a running sleep, idempotent
 * replay without re-running, and refusals before any runtime call. No provider is configured.
 *
 * Run: bun scripts/omp-bash-smoke.ts
 */
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP bash smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP bash smoke failed: ${message}`);
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
  cedia-bash-fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-bash-fixture-model
        name: Cedia bash smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-bash-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-bash-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-bash-host-work-"));
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
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Bash smoke" });
	const session = started.host.createSession(project.id, "Bash smoke");
	await started.host.startSession(session.id);
	const incarnation = started.host.store.getSession(session.id)!.incarnation;
	const post = (suffix: string, body: Record<string, unknown>) =>
		started.router({ method: "POST", path: `/v1/sessions/${session.id}/bash/${suffix}`, token: owner, body });

	const ran = await post("exec", { commandId: "bash-smoke-run", incarnation, command: "printf hello-bash" });
	check(ran.status === 200, `an owner exec is accepted (${ran.status})`);
	const ranBody = record(ran.body, "bash exec body");
	check(ranBody.state === "available" && ranBody.exitCode === 0 && ranBody.cancelled === false, "a passing command answers its exit");
	check(ranBody.output === "hello-bash", "the answer carries the command's exact output");

	const failed = await post("exec", { commandId: "bash-smoke-fail", incarnation, command: "exit 3" });
	const failedBody = record(failed.body, "bash fail body");
	check(failed.status === 200 && failedBody.state === "available" && failedBody.exitCode === 3, "a failing command is answered, not errored");

	const replayed = await post("exec", { commandId: "bash-smoke-run", incarnation, command: "printf hello-bash" });
	check(JSON.stringify(replayed.body) === JSON.stringify(ran.body), "a repeated exec command id replays the same receipt");

	const sleepy = post("exec", { commandId: "bash-smoke-sleep", incarnation, command: "sleep 20" });
	await sleep(1500);
	const aborted = await post("abort", { commandId: "bash-smoke-abort", incarnation });
	const abortedBody = record(aborted.body, "bash abort body");
	check(aborted.status === 200 && abortedBody.aborted === true, "an abort is accepted while a command runs");
	const cancelled = record(await sleepy.then(response => response.body), "bash sleep body");
	check(cancelled.state === "available" && cancelled.cancelled === true, "the running command answers cancelled");

	const idle = await post("abort", { commandId: "bash-smoke-idle", incarnation });
	check(record(idle.body, "bash idle body").aborted === true, "an abort with nothing running is still accepted");

	for (const [label, body] of [
		["missing command", { commandId: "bash-smoke-bad-1", incarnation }],
		["blank command", { commandId: "bash-smoke-bad-2", incarnation, command: "  " }],
		["extra field", { commandId: "bash-smoke-bad-3", incarnation, command: "printf x", extra: true }],
	] as const) {
		const refused = await post("exec", body);
		check(refused.status === 400, `${label} is refused before any runtime call (${refused.status})`);
	}
	const stale = await post("exec", { commandId: "bash-smoke-stale", incarnation: "old", command: "printf x" });
	check(stale.status === 409, `a stale incarnation is refused (${stale.status})`);
} finally {
	await started.close();
}

await Promise.all([
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
]);
