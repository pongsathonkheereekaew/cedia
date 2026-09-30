/**
 * Live proof that Cedia's composer prompt path carries `/guided-goal` (plan §8.2 O07).
 *
 * A guided goal is an interview, not a toggle: the runtime kicks it off as an ordinary
 * turn (hidden developer kickoff, the agent's questions as assistant turns, the user's
 * answers as prompts) and the finished interview creates the goal through the `goal`
 * tool, which the composer's goal header already shows. There is no other presentation
 * to build — the transcript is the surface — so this proof shows the dispatch itself,
 * both branches, with no provider turn completing anywhere:
 *
 * Phase A (goal disabled in config.yml): the command is consumed, no turn starts, and
 * the runtime's own "Goal mode is disabled..." refusal reaches the terminal.
 *
 * Phase B (goal enabled, fixture model, dead endpoint): the interview turn starts
 * (`agent_start` observed) and nothing can complete (connection refused). The dispatch
 * occupies the prompt call until the kickoff turn settles — the terminal handler awaits
 * `session.prompt`, so with an unanswering endpoint this rides OMP's own retry budget;
 * the smoke therefore sends without awaiting, observes the start, and closes (which
 * stops the runtime and its retrying turn). With a live model the same call returns
 * with the first interview question in seconds.
 *
 * Run: bun scripts/omp-guided-goal-smoke.ts
 */
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP guided-goal smoke failed: ${message}`);
	console.log(`OK   ${message}`);
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
  cedia-guided-goal-fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-guided-goal-fixture-model
        name: Cedia guided-goal smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;

async function startClient(cwd: string, frames: string[]) {
	const client = await OmpRpcClient.start({
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
		requestTimeoutMs: 20_000,
		onFrame: frame => {
			frames.push(JSON.stringify(frame).slice(0, 300));
		},
	});
	await client.requestCedia("cedia_terminal_negotiate", { version: 1, cols: 100, rows: 30 });
	return client;
}

// Phase A: goal disabled — consumed, no turn, the runtime's own refusal.
const dirA = await mkdtemp(join(tmpdir(), "cedia-guided-goal-disabled-"));
await writeFile(join(dirA, "models.yml"), "providers: {}\n");
await writeFile(join(dirA, "config.yml"), "goal:\n  enabled: false\n");
{
	const frames: string[] = [];
	const client = await startClient(dirA, frames);
	try {
		const ack = await client.request("prompt", { message: "/guided-goal probe objective" });
		check((ack as { data?: unknown }).data !== undefined, "the disabled /guided-goal is consumed with an answer");
		await new Promise(resolve => setTimeout(resolve, 3000));
		const out = frames.join("\n");
		check(!/agent_start/.test(out), "the disabled /guided-goal starts no turn");
		check(/Goal mode is disabled/.test(out), "the disabled /guided-goal answers the runtime's own refusal");
	} finally {
		await client.close().catch(() => {});
	}
}

// Phase B: goal enabled with a fixture model — the interview turn starts, nothing completes.
const dirB = await mkdtemp(join(tmpdir(), "cedia-guided-goal-enabled-"));
await writeFile(join(dirB, "models.yml"), modelsYaml);
{
	const frames: string[] = [];
	const client = await startClient(dirB, frames);
	try {
		const switched = await client.request("prompt", { message: "/switch cedia-guided-goal-fixture-model" });
		check((switched as { data?: unknown }).data !== undefined, "the fixture model is selected");
		// The dispatch awaits the kickoff turn (the terminal handler's own await), which can
		// never settle against a dead endpoint, so send without awaiting: the observed
		// agent_start below is the proof the interview began.
		const pending = client.request("prompt", { message: "/guided-goal probe objective" });
		pending.then(
			() => {},
			() => {},
		);
		const deadline = Date.now() + 25_000;
		let started = false;
		while (Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 500));
			if (/agent_start/.test(frames.join("\n"))) {
				started = true;
				break;
			}
		}
		check(started, "the enabled /guided-goal starts the interview turn");
	} finally {
		await client.close().catch(() => {});
	}
}

await Promise.all([
	rm(dirA, { recursive: true, force: true }),
	rm(dirB, { recursive: true, force: true }),
]);
console.log("OMP guided-goal smoke passed: refused while disabled, interviewed while enabled, completed nowhere.");
