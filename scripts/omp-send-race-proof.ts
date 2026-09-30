/**
 * Live proof of the shared-draft Send-vs-edit race (CEDIA-PLAN §2.5 items 2-3, §11.1 D row).
 *
 * Two independent renderer paths — two Cedia adapter instances (`createCediaNativeApi`)
 * through the real main-process handler (`createAgentWindowHandler`), the same topology
 * production runs with one main process and two windows — send against one live host and
 * the pinned OMP runtime. The model endpoint is a loopback listener that never answers,
 * so a turn is accepted and runs without any provider call leaving the machine.
 *
 * Round 1 (same text, interleaved): window A reserves revision N and its dispatch is held
 * at this driver's bridge; window B reserves the same revision and dispatches first. Both
 * turns must settle on the ONE bound command and the runtime must see exactly ONE prompt.
 * Round 2 (different text): B's reservation must answer 409 with zero dispatches while the
 * winner's text stays intact on the host. A host restart on the same state directory then
 * proves the journal, the submissions and the delivered (absent) draft survived.
 *
 * The hold lives entirely in this driver (a parked promise in window A's test bridge):
 * no product or fixture code carries a test hook, so there is nothing to remove or gate
 * before shipping — scripts never ship (`bun run check:packaged` covers the bundle only).
 *
 * Run: bun scripts/omp-send-race-proof.ts
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";
import { createAgentWindowHandler } from "../apps/macos/src/agent-window-main.ts";
import { createCediaNativeApi } from "../apps/macos/agent-window/src/cedia-adapter.ts";
import { HostHttpError } from "../apps/macos/src/api.ts";

const FAIL_PREFIX = "OMP send-race proof failed";
function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${FAIL_PREFIX}: ${message}`);
	console.log(`OK   ${message}`);
}
function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${FAIL_PREFIX}: ${message}`);
	return value as Record<string, unknown>;
}
async function exists(path: string): Promise<boolean> {
	try { await stat(path); return true; }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${FAIL_PREFIX}: timed out waiting for ${label}`)), ms); }),
		]);
	} finally { if (timer !== undefined) clearTimeout(timer); }
}
async function waitFor(predicate: () => boolean, ms: number, label: string): Promise<void> {
	const deadline = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error(`${FAIL_PREFIX}: timed out waiting for ${label}`);
		await new Promise(resolveWait => setTimeout(resolveWait, 25));
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

const T1 = "race round one: both windows send exactly this line";
const T2 = "race round two: window A sends this line";
const T2_CONFLICT = "race round two: window B sends a different line";

// A model endpoint that never answers: turns are accepted and run, no provider is contacted.
let modelHits = 0;
const held: Server = createServer(() => { modelHits++; /* deliberately never respond */ });
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
held.unref();
const address = held.address();
const port = address !== null && typeof address === "object" ? (address as { port: number }).port : 0;
check(port > 0, "fixture listener bound");

const modelsYaml = `providers:
  cedia-race-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-race-fixture-model
        name: Cedia send-race fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;

const agentCwd = await mkdtemp(join(tmpdir(), "cedia-race-agent-"));
const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-race-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-race-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-race-host-work-"));
const windowStateDir = await mkdtemp(join(tmpdir(), "cedia-race-window-state-"));
await writeFile(join(agentCwd, "models.yml"), modelsYaml);
await writeFile(join(hostProfileDir, "models.yml"), modelsYaml, { mode: 0o600 });

const cleanupDirs = async () => {
	await Promise.all([
		rm(agentCwd, { recursive: true, force: true }),
		rm(hostStateDir, { recursive: true, force: true }),
		rm(hostProfileDir, { recursive: true, force: true }),
		rm(hostWorkDir, { recursive: true, force: true }),
		rm(windowStateDir, { recursive: true, force: true }),
	]);
};

const bootOptions = {
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
};

let exitCode = 0;
try {
	const started = await withTimeout(startHostServer(bootOptions), 60_000, "host boot");
	try {
		const owner = started.auth.ownerToken;
		const project = started.host.store.createProject({ path: hostWorkDir, name: "Send race" });
		const session = started.host.createSession(project.id, "Send race");
		const sid = session.id;
		await withTimeout(started.host.startSession(sid), 90_000, "OMP session start");
		check(started.host.store.getSession(sid)?.status === "idle", "the session is idle against the pinned runtime (agent_start owns running)");

		const route = async (method: string, path: string, body?: unknown): Promise<unknown> => {
			const res = await started.router({ method, path, token: owner, body });
			if (res.status >= 400) {
				const failure = record(res.body, `error body for ${method} ${path}`);
				const detail = record(failure.error, `error detail for ${method} ${path}`);
				throw new HostHttpError(res.status, path, typeof detail.message === "string" ? detail.message : `Host refused ${method} ${path}`,
					typeof detail.code === "string" ? detail.code : undefined);
			}
			return res.body;
		};
		// The handler's `request` receives the application-relative path (`drafts/…`,
		// `sessions/…`); the router wants the `/v1/` base, like the production gateway.
		const gatewayRequest = async (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<unknown> =>
			route(method, path.startsWith("/v1/") ? path : `/v1/${path}`, body);

		const broadcasts: Array<{ window: string; update: unknown }> = [];
		const handler = createAgentWindowHandler({
			stateDir: windowStateDir,
			authorize: () => true,
			ensure: async () => {},
			request: gatewayRequest,
			pickFolder: async () => { throw new Error("pickFolder is out of scope for the race proof"); },
			openIde: async () => { throw new Error("openIde is out of scope for the race proof"); },
			openExternal: async () => { throw new Error("openExternal is disabled in the race proof"); },
			broadcastDraft: (event, update) => { broadcasts.push({ window: (event as { window?: unknown }).window === "B" ? "B" : "A", update }); },
			version: "send-race-proof",
		});

		// The test-only hold: window A's command POST parks here while armed. It lives in
		// this driver, not in product or fixture code, so it cannot ship open.
		const hold = { armed: false, parked: false, release: () => {} };
		let releaseHold: () => void = () => {};
		hold.release = () => releaseHold();
		const posts: Record<"A" | "B", unknown[]> = { A: [], B: [] };
		const clears: Array<{ window: string; revision: unknown; cleared: unknown }> = [];
		const testBridge = (name: "A" | "B") => ({
			invoke: async (_channel: unknown, input: unknown) => {
				const row = record(input, "bridge input");
				if (row.kind === "request" && row.method === "POST" && typeof row.path === "string" && row.path.endsWith("/commands")) {
					if (name === "A" && hold.armed) {
						hold.parked = true;
						await new Promise<void>(resolveRelease => { releaseHold = resolveRelease; });
					}
					posts[name].push(record(row.body, "command body").commandId);
				}
				const out = await handler({ window: name }, input);
				if (row.kind === "uiDraft" && row.action === "clear") clears.push({ window: name, revision: row.revision, cleared: record(out, "clear answer").cleared });
				return out;
			},
		});
		const apiA = createCediaNativeApi({ bridge: testBridge("A") as never });
		const apiB = createCediaNativeApi({ bridge: testBridge("B") as never });
		const turn = (commandId: string, text: string) => ({
			type: "thread.turn.start",
			commandId,
			threadId: sid,
			message: { text },
		});

		const promptRows = async () => {
			const rows = await route("GET", `/v1/sessions/${sid}/commands`) as Array<{ commandId?: unknown; kind?: unknown }>;
			check(Array.isArray(rows), "the command journal lists rows");
			return rows.filter(row => row.kind === "prompt");
		};
		const turnIntent = async (commandId: string): Promise<{ state: string; model: unknown; reason: unknown }> => {
			const row = record(await route("GET", `/v1/sessions/${sid}`), "session row");
			const turns = row.turns;
			check(Array.isArray(turns), "the session row carries its turn projection");
			const intent = (turns as Array<{ commandId?: unknown; state?: unknown; model?: unknown; reason?: unknown }>).find(entry => entry.commandId === commandId);
			check(intent !== undefined, `turn intent turn-${commandId} is projected`);
			return { state: String(intent.state), model: intent.model, reason: intent.reason };
		};
		const turnState = async (commandId: string): Promise<string> => (await turnIntent(commandId)).state;
		const awaitRunning = async (commandId: string): Promise<unknown> => {
			const deadline = Date.now() + 30_000;
			for (;;) {
				const intent = await turnIntent(commandId);
				if (intent.state === "running") return intent.model;
				if (intent.state !== "queued" && intent.state !== "prepared") return intent.model;
				if (Date.now() > deadline) throw new Error(`${FAIL_PREFIX}: turn-${commandId} never started (still ${intent.state}, model ${JSON.stringify(intent.model)}, reason ${JSON.stringify(intent.reason)})`);
				await new Promise(resolveWait => setTimeout(resolveWait, 200));
			}
		};
		const settleTurn = async (commandId: string): Promise<string> => {
			const deadline = Date.now() + 30_000;
			for (;;) {
				const state = await turnState(commandId);
				if (state !== "prepared" && state !== "queued" && state !== "running") return state;
				if (Date.now() > deadline) throw new Error(`${FAIL_PREFIX}: turn-${commandId} never settled (still ${state})`);
				await new Promise(resolveWait => setTimeout(resolveWait, 200));
			}
		};
		const abortTurn = async (commandId: string): Promise<void> => {
			const row = record(await route("GET", `/v1/sessions/${sid}`), "session row for incarnation");
			await route("POST", `/v1/sessions/${sid}/commands`, { commandId, incarnation: row.incarnation, command: "abort" });
		};

		// Round 1: one revision, two windows, one command.
		const created1 = record(await route("PATCH", `/v1/drafts/${sid}`, { expectedRevision: 0, text: T1 }), "round-1 draft");
		const rev1 = created1.revision;
		check(typeof rev1 === "number" && rev1 >= 1, `round 1 starts at draft revision ${String(rev1)}`);
		hold.armed = true;
		const sendA1 = apiA.orchestration.dispatchCommand(turn("race-a1", T1));
		await waitFor(() => hold.parked, 15_000, "window A parking its dispatch inside the race window");
		const sendB1 = apiB.orchestration.dispatchCommand(turn("race-b1", T1));
		await withTimeout(sendB1, 90_000, "window B same-text turn acceptance");
		hold.armed = false;
		hold.release();
		await withTimeout(sendA1, 30_000, "window A same-text turn acceptance");
		check(JSON.stringify(posts.A) === JSON.stringify(["race-a1"]) && JSON.stringify(posts.B) === JSON.stringify(["race-a1"]),
			`both windows dispatched the one bound command (A: ${JSON.stringify(posts.A)}, B: ${JSON.stringify(posts.B)})`);
		const round1 = await promptRows();
		check(round1.length === 1 && round1[0]?.commandId === "race-a1", "the runtime was asked for exactly one prompt in round 1");
		check(clears.some(entry => entry.window === "B" && entry.cleared === true) && clears.some(entry => entry.window === "A" && entry.cleared === false),
			"the first release delivered the draft and the second was a revision-gated no-op");
		const model1 = await awaitRunning("race-a1");
		check(model1 === "cedia-race-fixture/cedia-race-fixture-model", `the shared turn runs on the fixture model, not a provider (${JSON.stringify(model1)})`);
		await waitFor(() => modelHits >= 1, 20_000, "round-1 model dispatch reaching the loopback endpoint");
		const missing1 = await started.router({ method: "GET", path: `/v1/drafts/${sid}`, token: owner });
		check(missing1.status === 404, "the delivered draft is gone for both windows");
		check(broadcasts.some(entry => record(entry.update, "broadcast").status === "delivered"),
			"the delivery was broadcast to the other window");
		const abortState1 = await (async () => { await abortTurn("race-abort-1"); return settleTurn("race-a1"); })();
		check(true, `round-1 turn settled after abort (${abortState1})`);

		// Round 2: same revision, different text — the loser is refused before dispatch.
		const postsBefore = posts.B.length;
		const created2 = record(await route("PATCH", `/v1/drafts/${sid}`, { expectedRevision: 0, text: T2 }), "round-2 draft");
		const rev2 = created2.revision;
		check(typeof rev2 === "number" && rev2 >= 1, `round 2 starts at draft revision ${String(rev2)}`);
		hold.armed = true;
		hold.parked = false;
		const sendA2 = apiA.orchestration.dispatchCommand(turn("race-a2", T2));
		await waitFor(() => hold.parked, 15_000, "window A parking its round-2 dispatch");
		let refused: string | undefined;
		try { await withTimeout(apiB.orchestration.dispatchCommand(turn("race-b2", T2_CONFLICT)), 30_000, "window B conflicting send"); }
		catch (error) { refused = error instanceof Error ? error.message : String(error); }
		check(refused !== undefined && /different text/i.test(refused), `the conflicting send stops with a user-facing error (${refused ?? "no error"})`);
		check(posts.B.length === postsBefore, "the refused window dispatched zero commands");
		const kept = record(await route("GET", `/v1/drafts/${sid}`), "round-2 draft after refusal");
		check(kept.revision === rev2 && kept.text === T2, "the winner's text is intact; the refused text never landed");
		hold.armed = false;
		hold.release();
		await withTimeout(sendA2, 90_000, "window A round-2 turn acceptance");
		const model2 = await awaitRunning("race-a2");
		check(model2 === "cedia-race-fixture/cedia-race-fixture-model", `the round-2 turn runs on the fixture model (${JSON.stringify(model2)})`);
		await waitFor(() => modelHits >= 2, 20_000, "round-2 model dispatch reaching the loopback endpoint");
		const round2 = await promptRows();
		check(round2.length === 2 && round2.some(row => row.commandId === "race-a2") && !round2.some(row => row.commandId === "race-b2"),
			"the journal holds exactly the two winning prompts and no loser row");
		const abortState2 = await (async () => { await abortTurn("race-abort-2"); return settleTurn("race-a2"); })();
		check(true, `round-2 turn settled after abort (${abortState2})`);
		check(modelHits >= 2, `both turns really reached the fixture model endpoint (${modelHits} loopback hits, zero external)`);

		// Restart on the same state directory: the journal and the delivered state survive.
		const before = (await route("GET", `/v1/sessions/${sid}/commands`) as Array<{ commandId?: unknown; status?: unknown }>)
			.map(row => `${String(row.commandId)}:${String(row.status)}`);
		const incarnationBefore = record(await route("GET", `/v1/sessions/${sid}`), "session row").incarnation;
		await started.close();
		const reopened = await withTimeout(startHostServer({ ...bootOptions }), 60_000, "host reopen");
		try {
			const after = (await reopened.router({ method: "GET", path: `/v1/sessions/${sid}/commands`, token: owner }).then(res => {
				check(res.status === 200, "the journal reads after reopen");
				return res.body as Array<{ commandId?: unknown; status?: unknown }>;
			})).map(row => `${String(row.commandId)}:${String(row.status)}`);
			check(JSON.stringify(after) === JSON.stringify(before), "the command journal survives the restart unchanged");
			const incarnationAfter = record((await reopened.router({ method: "GET", path: `/v1/sessions/${sid}`, token: owner })).body, "reopened session row").incarnation;
			check(incarnationAfter === incarnationBefore, "the session identity survives the restart");
			const redraft = await reopened.router({ method: "GET", path: `/v1/drafts/${sid}`, token: owner });
			check(redraft.status === 404, "the delivered draft stays delivered across the restart");
		} finally { await reopened.close(); }

		console.log(JSON.stringify({
			ok: true,
			version,
			rounds: {
				sameText: { postsA: posts.A, postsB: posts.B, prompts: round1.map(row => row.commandId), abortSettled: abortState1 },
				differentText: { refused, prompts: round2.map(row => row.commandId), abortSettled: abortState2 },
			},
			clears,
			modelHits,
			journalAfterRestart: before,
		}, null, 2));
	} finally {
		await started.close().catch(() => {});
	}
} catch (error) {
	exitCode = 1;
	console.error(error instanceof Error ? error.message : error);
} finally {
	await new Promise<void>(close => held.close(() => close()));
	await cleanupDirs();
}
process.exit(exitCode);
