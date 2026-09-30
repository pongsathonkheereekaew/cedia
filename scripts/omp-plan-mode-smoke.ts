/**
 * Live proof of Cedia's O07 session-mode bridge against the pinned runtime.
 *
 * The runtime is started with the Cedia virtual UI negotiated, which is what gives a Cedia session
 * its plan/vibe mode owner, and then driven through `cedia_plan`: read, enter, exit, the vibe pair,
 * the runtime's own refusal text, and the streamed state frame. The model endpoint is a local
 * listener that never answers, so no provider request leaves the machine and no turn is run -
 * entering plan mode is OMP's own state transition, not a model call.
 *
 * The plan-review half of the bridge needs an agent turn that writes `xd://propose`, so a working
 * model is required to exercise it end to end; the receipt records that this script does not run it.
 *
 * Run: bun scripts/omp-plan-mode-smoke.ts
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP plan-mode smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP plan-mode smoke failed: ${message}`);
	return value as Record<string, unknown>;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
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

const cwd = await mkdtemp(join(tmpdir(), "cedia-plan-mode-"));
const held: Server = createServer(() => {
	/* deliberately never respond: no provider call in this run may complete */
});
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
const address = held.address();
check(address !== null && typeof address === "object", "fixture listener bound");
const port = (address as { port: number }).port;

let client: OmpRpcClient | undefined;
const frames: Record<string, unknown>[] = [];

try {
	await writeFile(
		join(cwd, "models.yml"),
		`providers:
  cedia-plan-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-plan-fixture-model
        name: Cedia plan smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`,
	);
	client = await OmpRpcClient.start({
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
		requestTimeoutMs: 30_000,
		onFrame(frame) {
			frames.push(record(frame, "frame"));
		},
	});

	check(client.readyFrame?.cediaPlanVersion === 1, "the runtime advertises the session-mode bridge");

	const plan = async (command: Record<string, unknown>): Promise<Record<string, unknown>> =>
		record((await client!.requestCedia("cedia_plan", { command })).data, "cedia_plan data");
	const stateFrames = (): Record<string, unknown>[] => frames.filter(frame => frame.type === "cedia_plan_state");

	// The terminal owner is what owns plan/vibe mode; negotiating the virtual UI attaches it.
	await client.requestCedia("cedia_terminal_negotiate", { version: 1, cols: 40, rows: 8 });

	const initial = await plan({ op: "read" });
	check(initial.plan === null && record(initial.vibe).enabled === false, "a fresh session reports neither mode as on");
	check(initial.review === null && initial.changed === false, "a read claims no change and holds no review");

	const entered = await plan({ op: "enter" });
	const enteredPlan = record(entered.plan ?? {}, "plan state");
	check(entered.changed === true && enteredPlan.enabled === true, "entering plan mode changes the runtime's own plan state");
	check(typeof enteredPlan.planFilePath === "string" && enteredPlan.planFilePath.length > 0, "plan mode names its plan file");
	check(stateFrames().length > 0, "the runtime streams a plan-state frame when the mode changes");

	const again = await plan({ op: "enter" });
	check(
		again.changed === false && record(again.plan ?? {}).enabled === true,
		"entering an already-active plan mode claims no second change",
	);

	// Vibe mode is refused while plan mode is on, with the runtime's own words.
	const refusedVibe = await plan({ op: "vibe.enter" });
	check(refusedVibe.changed === false, "vibe mode does not start while plan mode is active");
	check(
		typeof refusedVibe.reason === "string" && refusedVibe.reason.includes("plan"),
		`the refusal is the runtime's own text (${String(refusedVibe.reason)})`,
	);
	check(record(refusedVibe.vibe).enabled === false, "the refused mode is still off");

	const exited = await plan({ op: "exit", confirm: true });
	check(exited.changed === true && exited.plan === null, "leaving plan mode clears the runtime's plan state");

	const vibeOn = await plan({ op: "vibe.enter" });
	check(
		vibeOn.changed === true && record(vibeOn.vibe).enabled === true,
		`vibe mode starts once plan mode is off (${JSON.stringify(vibeOn)})`,
	);
	const vibeOff = await plan({ op: "vibe.exit" });
	check(vibeOff.changed === true && record(vibeOff.vibe).enabled === false, "vibe mode stops again");

	// A review the runtime is not holding cannot be answered by naming one.
	const noReview = await plan({ op: "review.decide", reviewId: 1, decision: "approve" });
	check(
		noReview.changed === false && typeof noReview.reason === "string",
		"a decision without a held review is refused with a reason",
	);

	// An unknown operation is refused rather than answered with an empty success.
	const unknown = await plan({ op: "no-such-operation" });
	check(unknown.changed === false && String(unknown.reason).includes("does not know"), "an unknown operation is refused by name");

	await client.close();
	client = undefined;

	// ---- Cedia's own route: the host projects the runtime's state and drives it ----
	const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-plan-host-state-"));
	const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-plan-host-profile-"));
	const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-plan-host-work-"));
	await writeFile(
		join(hostProfileDir, "models.yml"),
		`providers:
  cedia-plan-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-plan-fixture-model
        name: Cedia plan smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`,
		{ mode: 0o600 },
	);
	const started = await startHostServer({
		stateDir: hostStateDir,
		port: 0,
		ompExecutable: executable,
		virtualUi: true,
		ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
	});
	try {
		const owner = started.auth.ownerToken;
		const project = started.host.store.createProject({ path: hostWorkDir, name: "Plan smoke" });
		const session = started.host.createSession(project.id, "Plan smoke");
		await started.host.startSession(session.id);
		// The host's command envelope names the incarnation the caller saw, as the goal route does.
		const planIncarnation = started.host.store.getSession(session.id)!.incarnation;

		const read = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/plan`, token: owner });
		check(read.status === 200, `the owner-only plan route answers (${read.status})`);
		const readBody = record(read.body as unknown, "plan route body");
		check(readBody.state === "available", `a live session reports its plan state (${JSON.stringify(readBody).slice(0, 160)})`);
		check(readBody.plan === null && record(readBody.vibe ?? {}).enabled === false, "the route projects the runtime's own fresh state");

		const command = async (op: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
			const answer = await started.router({
				method: "POST",
				path: `/v1/sessions/${session.id}/plan`,
				token: owner,
				body: { commandId: `plan-smoke-${op}`, incarnation: planIncarnation, op, ...extra },
			});
			check(answer.status === 200, `POST /plan ${op} answers (${answer.status} ${JSON.stringify(answer.body).slice(0, 120)})`);
			return record(answer.body as unknown, `plan ${op} body`);
		};

		const enteredHost = await command("enter");
		check(enteredHost.changed === true && record(enteredHost.plan ?? {}).enabled === true, "the route drives plan mode on the live runtime");
		check(enteredHost.revision === 3 || typeof enteredHost.revision === "number", "the answer carries the revision the caller saw");

		// The same command id is the same command: a replay returns the recorded outcome instead of
		// running the transition again. A second `enter` would answer changed:false, so this pins
		// that the recorded result - not a fresh run - is what the caller gets.
		const replay = await started.router({
			method: "POST",
			path: `/v1/sessions/${session.id}/plan`,
			token: owner,
			body: { commandId: "plan-smoke-enter", incarnation: planIncarnation, op: "enter" },
		});
		check(replay.status === 200, `a replayed command id is answered (${replay.status})`);
		check(record(replay.body as unknown).changed === true, "the replay returns the recorded outcome, not a second transition's");
		const stillOn = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/plan`, token: owner });
		check(record(stillOn.body as unknown).plan !== null, "the replay left the mode where the original command put it");

		// The same id with a different body is a different command, and is refused rather than run.
		const conflicting = await started.router({
			method: "POST",
			path: `/v1/sessions/${session.id}/plan`,
			token: owner,
			body: { commandId: "plan-smoke-enter", incarnation: planIncarnation, op: "exit", confirm: true },
		});
		check(conflicting.status >= 400, `reusing a command id for a different command is refused (${conflicting.status})`);

		const exitedHost = await command("exit", { confirm: true });
		check(exitedHost.changed === true && exitedHost.plan === null, "the route leaves plan mode again");

		const vibedHost = await command("vibe.enter");
		check(vibedHost.changed === true && record(vibedHost.vibe ?? {}).enabled === true, "the route drives vibe mode through the same projection");
		await command("vibe.exit");

		const unknownField = await started.router({
			method: "POST",
			path: `/v1/sessions/${session.id}/plan`,
			token: owner,
			body: { commandId: "plan-smoke-bad", incarnation: planIncarnation, op: "enter", nope: 1 },
		});
		check(unknownField.status === 400, `an unknown body field is refused before any runtime call (${unknownField.status})`);

		const notOwner = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/plan` });
		check(notOwner.status === 401 || notOwner.status === 403, `the route is owner-only (${notOwner.status})`);
	} finally {
		await started.close();
	}


	const binarySha256 = createHash("sha256").update(await readFile(executable)).digest("hex");
	console.log(
		JSON.stringify(
			{
				ok: true,
				runtime: { executable, version, binarySha256 },
				planBridgeVersion: 1,
				stateFrames: stateFrames().length,
				framesSeen: [...new Set(frames.map(frame => String(frame.type)))],
				notRun: ["a plan the agent proposes through xd://propose (needs a working model to reach the proposal)"],
				hostRoute: "GET/POST /v1/sessions/:id/plan projected and drove the same runtime",
			},
			null,
			2,
		),
	);
} finally {
	await client?.close().catch(() => {});
	await new Promise<void>(close => held.close(() => close()));
	await rm(cwd, { recursive: true, force: true });
}
