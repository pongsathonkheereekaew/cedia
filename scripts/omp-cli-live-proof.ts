/**
 * Live proof that the headless CLI drives a real host + real OMP turn end to
 * end (plan §10 item 5b — no provider, fixture runtime only).
 *
 * Boots the real host server (loopback HTTP, fixture OMP executable), then
 * drives it exclusively through `runCli` exactly as the `cedia-host` binary
 * does (host.json descriptor discovery, bearer auth, JSON stdout): project
 * and session creation, session start, a `send --wait` turn to settlement, an
 * events readback carrying the fixture response, a generic `rpc get_state`,
 * and a usage-error negative. Incarnation addressing, `--wait` settlement,
 * and response dereference run on the wire, not in fixtures.
 *
 * What this proves: the CLI wire path against a live host/runtime. What it
 * does NOT prove: IDE palette wiring for the daily verbs (still open, needs
 * workbench work), abort against a running turn (needs an answering model to
 * hold a turn open), TUI-only slash commands (out of scope until OMP exposes
 * them as RPC).
 *
 * Run: bun scripts/omp-cli-live-proof.ts
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";
import { readLoopbackDescriptor, runCli } from "../apps/host/src/cli-client.ts";

const root = resolve(import.meta.dir, "..");
function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP CLI live proof failed: ${message}`);
	console.log(`OK   ${message}`);
}

const scratch = await realpath(await mkdtemp(join(tmpdir(), "cedia-cli-live-")));
const stateDir = join(scratch, "host");
const output = join(root, "dist/cli-live-proof");
await mkdir(output, { recursive: true });
const projectPath = join(scratch, "project");
await mkdir(projectPath);
await writeFile(join(projectPath, "hello.txt"), "CLI live fixture\n");
execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["add", "hello.txt"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["-c", "user.email=fixture@cedia", "-c", "user.name=Cedia Fixture", "commit", "-m", "fixture"], { cwd: projectPath, stdio: "ignore" });

const started = await startHostServer({
	stateDir,
	port: 0,
	ompExecutable: join(root, "apps/macos/test/fixtures/agent-window-omp"),
	ompEnv: { CEDIA_NODE: process.execPath },
});
const outputs: Array<{ argv: string[]; code: number; stdout: string }> = [];
async function cli(argv: string[]): Promise<{ code: number; json: unknown }> {
	let text = "";
	const code = await runCli(argv, {
		readDescriptor: () => readLoopbackDescriptor(stateDir),
		stdout: (chunk: string) => { text += chunk; },
		stderr: () => {},
	});
	outputs.push({ argv, code, stdout: text });
	return { code, json: text.trim().length > 0 ? JSON.parse(text) : null };
}
const record = (value: unknown, message: string): Record<string, unknown> => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP CLI live proof failed: ${message}`);
	return value as Record<string, unknown>;
};

try {
	const created = await cli(["project-create", "--path", projectPath, "--name", "CLI live fixture"]);
	check(created.code === 0, "project-create exits 0");
	const projectId = String(record(created.json, "project-create body").id ?? "");
	check(projectId.length > 0, `project-create answers an id (${projectId.slice(0, 8)}…)`);

	const sessioned = await cli(["session-create", "--project", projectId, "--title", "CLI live task"]);
	check(sessioned.code === 0, "session-create exits 0");
	const sessionId = String(record(sessioned.json, "session-create body").id ?? "");
	check(sessionId.length > 0, `session-create answers an id (${sessionId.slice(0, 8)}…)`);

	const startedSession = await cli(["session-start", sessionId]);
	check(startedSession.code === 0, "session-start exits 0");

	const sent = await cli(["send", sessionId, "--message", "CLI live turn", "--wait", "--timeout-ms", "60000"]);
	check(sent.code === 0, "send --wait exits 0");
	const settled = record(record(sent.json, "send body").settled, "settled command");
	check(settled.status === "completed", `the turn settles completed on the wire (${String(settled.status)})`);

	const events = await cli(["events", sessionId, "--after", "0", "--limit", "100"]);
	check(events.code === 0, "events exits 0");
	check(JSON.stringify(events.json).includes("Fixture response: CLI live turn"), "events carry the fixture response");

	const listed = await cli(["sessions", "--project", projectId]);
	check(listed.code === 0 && JSON.stringify(listed.json).includes(sessionId), "sessions lists the CLI-created task");

	const rpc = await cli(["rpc", sessionId, "get_state", "--payload", "{}"]);
	check(rpc.code === 0 && JSON.stringify(rpc.json).includes("fixture-model"), "generic rpc get_state answers through the same path");

	const usage = await cli(["send", sessionId]);
	check(usage.code === 2, "a turn verb without a message is a usage error (exit 2)");

	const commands = started.host.store.listCommands(sessionId).map(command => command.kind);
	check(commands.includes("prompt"), "the host journal recorded the CLI turn");
	check(!commands.some(kind => !["prompt", "get_state"].includes(String(kind))), `no provider-backed commands ran (${commands.join(",")})`);

	await writeFile(join(output, "result.json"), JSON.stringify({ ok: true, projectId, sessionId, providerCommands: 0 }, null, 2));
	console.log("OMP CLI live proof passed: project, session, start, send --wait, events, rpc, usage error.");
} finally {
	await started.close().catch(() => {});
	await rm(scratch, { recursive: true, force: true });
}
