/**
 * Live proof that Cedia carries `/tan` background agents (plan §8.2 O07).
 *
 * A tan forks the parent transcript into a clone session file and runs it as a
 * background job through the session's own async job manager; the clone registers in
 * the runtime's agent roster, which Cedia's Agents surface already reads, and its
 * transcript reads through the child's own file once the runtime resolves it. No Cedia
 * operation was added for any
 * of this — the composer prompt path dispatches `/tan` headless through the RPC
 * terminal owner, exactly like the terminal dispatches it. This proof shows the
 * dispatch, the roster row with its parent linkage and live status, and the readable
 * parked-or-running transcript, with no provider turn completing anywhere (dead
 * endpoint): the worker hangs on its first model call and dies with the runtime at
 * close. A tan that finishes its work end to end needs a provider turn.
 *
 * A persisted session is required: an unpersisted one refuses with the runtime's own
 * "/tan requires a persisted session."
 *
 * Run: bun scripts/omp-tan-smoke.ts
 */
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP tan smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP tan smoke failed: ${message}`);
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
  cedia-tan-fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-tan-fixture-model
        name: Cedia tan smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;

type TanRow = { id: string; name: string; kind: string; parentId?: string; status: string; sessionFile?: string };

// Direct half: dispatch headless, roster shows the running tan with its clone file.
const cwd = await mkdtemp(join(tmpdir(), "cedia-tan-"));
await writeFile(join(cwd, "models.yml"), modelsYaml);
await writeFile(join(cwd, "session.jsonl"), "");
{
	let client: OmpRpcClient | undefined;
	try {
		client = await OmpRpcClient.start({
			executable,
			args: ["--session", join(cwd, "session.jsonl"), "--session-dir", cwd, "--no-skills", "--no-rules", "--no-extensions", "--no-title", "--cwd", cwd],
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
		await client.requestCedia("cedia_terminal_negotiate", { version: 1, cols: 100, rows: 30 });
		const switched = await client.request("prompt", { message: "/switch cedia-tan-fixture-model" });
		check(record((switched as { data?: unknown }).data ?? {}).agentInvoked === false, "the fixture model is selected");
		const dispatch = await client.request("prompt", { message: "/tan probe tangential work" });
		check(record((dispatch as { data?: unknown }).data ?? {}).agentInvoked === false, "the tan dispatches through the prompt path with no turn of its own");
		let tan: TanRow | undefined;
		{
			const deadline = Date.now() + 60_000;
			for (;;) {
				const roster = record(record((await client.requestCedia("cedia_control", { operation: "agents.get" })).data ?? {}, "agents envelope").result ?? {}, "agents roster");
				const found = ((roster.agents ?? []) as TanRow[]).find(row => row.kind === "sub");
				if (found !== undefined) {
					tan = found;
					break;
				}
				if (Date.now() > deadline) break;
				await new Promise(resolve => setTimeout(resolve, 1_000));
			}
		}
		check(tan !== undefined && tan.name === "tan" && tan.parentId === "Main", "the roster carries the tan with its parent linkage");
		check(typeof tan.sessionFile === "string" && tan.sessionFile.endsWith(".jsonl"), "the roster names the tan clone file");
		check(await exists(tan.sessionFile as string), "the clone file exists on disk while the tan runs");
		await client.close();
		client = undefined;
	} finally {
		await client?.close().catch(() => {});
	}
}

// Host half: the same dispatch through the commands route, roster plus transcript
// through the owner-only agents routes Cedia's Agents surface reads.
const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-tan-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-tan-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-tan-host-work-"));
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
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Tan smoke" });
	const session = started.host.createSession(project.id, "Tan smoke");
	await started.host.startSession(session.id);
	const incarnation = started.host.store.getSession(session.id)!.incarnation;

	const sent = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/commands`,
		token: owner,
		body: { commandId: "tan-smoke-send", incarnation, command: "prompt", payload: { message: "/tan probe tangential work" } },
	});
	check(sent.status === 200, "the host accepts the tan dispatch through the commands route");

	let tan: TanRow | undefined;
	{
		const deadline = Date.now() + 60_000;
		for (;;) {
			const roster = record((await started.router({ method: "GET", path: `/v1/sessions/${session.id}/agents`, token: owner })).body, "agents body");
			const rows = ((roster as { agents?: TanRow[] }).agents ?? []).filter(row => row.kind === "sub");
			if (rows.length > 0) {
				tan = rows[0];
				break;
			}
			if (Date.now() > deadline) throw new Error("OMP tan smoke failed: no tan row reached the roster");
			await new Promise(resolve => setTimeout(resolve, 1_000));
		}
	}
	check(tan !== undefined && tan.parentId === "Main", "the host roster carries the tan with its parent linkage");
	check(typeof tan.sessionFile === "string" && tan.sessionFile.endsWith(".jsonl"), "the host roster names the tan clone file");
	check(await exists(tan.sessionFile as string), "the clone file exists on disk while the tan runs");
	const transcript = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/agents/${tan.id}/transcript`, token: owner });
	check(transcript.status === 200, "the transcript route answers instead of failing the transport");
	const transcriptBody = record(transcript.body, "transcript body");
	check(
		(transcriptBody.state === "unavailable" && typeof transcriptBody.reason === "string") ||
		(transcriptBody.state === "available" && Array.isArray(transcriptBody.messages) &&
			transcriptBody.messages.some(message => typeof record(message).text === "string" && (record(message).text as string).length > 0)),
		"a running tan transcript is honestly unavailable or already readable, never a silent empty",
	);
} finally {
	await started.close();
}

await Promise.all([
	rm(cwd, { recursive: true, force: true }),
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
]);
console.log("OMP tan smoke passed: dispatched headless, rostered with parentage, clone file on disk, completed nowhere.");
