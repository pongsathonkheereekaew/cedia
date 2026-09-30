/**
 * Live proof that Cedia's context abort can interrupt an OMP compaction already in flight.
 *
 * A loopback OpenAI-compatible fixture answers the seed turn, then deliberately holds the
 * soft-compaction request open. The proof dispatches `/compact` through the host command route
 * and posts `context/abort-compaction` through its owner route while OMP is waiting on that
 * request. It requires the abort receipt and provider disconnect before releasing the fixture,
 * then checks OMP cleared the compacting state, committed no compaction entry, and accepted a
 * follow-up turn. No external provider, desktop app, credential, or paid inference is used.
 *
 * Run: bun scripts/omp-context-cancel-smoke.ts
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP context cancel smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP context cancel smoke failed: ${message}`);
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

async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, label: string, timeoutMs = 30_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let value = await read();
	while (!accept(value)) {
		if (Date.now() >= deadline) throw new Error(`OMP context cancel smoke failed: timed out waiting for ${label}`);
		await new Promise(resolveWait => setTimeout(resolveWait, 50));
		value = await read();
	}
	return value;
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

const summaryStarted = Promise.withResolvers<void>();
const summaryClosed = Promise.withResolvers<void>();
let requests = 0;
let summaryResponse: ServerResponse | undefined;
let summaryWasAborted = false;
const completion = (response: ServerResponse, call: number, text: string) => {
	const frame = (delta: unknown, finish: string | null, usage = false) =>
		`data: ${JSON.stringify({
			id: `context-cancel-${call}`,
			object: "chat.completion.chunk",
			created: 1,
			model: "cedia-context-cancel-fixture-model",
			choices: [{ index: 0, delta, finish_reason: finish }],
			...(usage ? { usage: { prompt_tokens: 24, completion_tokens: 8, total_tokens: 32 } } : {}),
		})}\n\n`;
	response.write(frame({ role: "assistant", content: "" }, null));
	response.write(frame({ content: text }, null));
	response.write(frame({}, "stop", true));
	response.end("data: [DONE]\n\n");
};
const fixture: Server = createServer((request, response) => {
	if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
		response.writeHead(404, { "content-type": "application/json" });
		response.end(JSON.stringify({ error: "fixture serves only chat completions" }));
		return;
	}
	request.resume();
	request.on("end", () => {
		requests += 1;
		response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
		if (requests === 2) {
			summaryResponse = response;
			response.on("close", () => {
				if (!response.writableEnded) {
					summaryWasAborted = true;
					summaryClosed.resolve();
				}
			});
			response.write(`data: ${JSON.stringify({ id: "held-summary", object: "chat.completion.chunk", created: 1, model: "cedia-context-cancel-fixture-model", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })}\n\n`);
			summaryStarted.resolve();
			return;
		}
		completion(response, requests, "The fixture turn is complete.");
	});
});
await new Promise<void>(ready => fixture.listen(0, "127.0.0.1", ready));
fixture.unref();
const address = fixture.address();
const port = address !== null && typeof address === "object" ? address.port : 0;
check(port > 0, "loopback model fixture bound");

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-context-cancel-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-context-cancel-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-context-cancel-work-"));
await writeFile(
	join(hostProfileDir, "models.yml"),
	`providers:
  cedia-context-cancel-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-context-cancel-fixture-model
        name: Cedia context cancel fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`,
	{ mode: 0o600 },
);
await writeFile(
	join(hostProfileDir, "config.yml"),
	"compaction:\n  methodOrder: [soft]\n  keepRecentTokens: 1\n",
	{ mode: 0o600 },
);

let started: Awaited<ReturnType<typeof startHostServer>> | undefined;
let compactDispatch: Promise<unknown> | undefined;
try {
	started = await startHostServer({
		stateDir: hostStateDir,
		port: 0,
		ompExecutable: executable,
		virtualUi: true,
		ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
	});
	const owner = started.auth.ownerToken;
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Context cancellation smoke" });
	const session = started.host.createSession(project.id, "Context cancellation smoke");
	await started.host.startSession(session.id);
	const liveSession = started.host.store.getSession(session.id);
	check(liveSession !== undefined && typeof liveSession.incarnation === "string", "the fixture session has an OMP incarnation");
	const incarnation = liveSession.incarnation;
	const command = (commandId: string, message: string) =>
		started!.router({
			method: "POST",
			path: `/v1/sessions/${session.id}/commands`,
			token: owner,
			body: { commandId, incarnation, command: "prompt", payload: { message } },
		});
	const intentState = (commandId: string) => started!.host.store.getTurnIntentByCommand(session.id, commandId)?.state;
	const seeded = await command("context-cancel-seed", "Create a short context fixture.");
	check(seeded.status === 200, "the seed turn is accepted through the host command route");
	await until(() => intentState("context-cancel-seed"), state => state === "completed", "the fixture seed turn to complete");
	check(requests === 1, "the seed turn used exactly one local canned completion");

	compactDispatch = command("context-cancel-compact", "/compact");
	await summaryStarted.promise;
	check(Number(requests) === 2 && summaryResponse !== undefined, "OMP entered a real soft-compaction model request and the fixture is holding it open");
	check(started.host.store.getCommand(session.id, "context-cancel-compact")?.status === "claimed", "the /compact host command remains active while OMP awaits its summary");

	const abortDispatch = started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/context/abort-compaction`,
		token: owner,
		body: { commandId: "context-cancel-abort", incarnation },
	});
	const abortRace = await Promise.race([
		abortDispatch.then(response => ({ completed: true as const, response })),
		new Promise<{ completed: false }>(resolveWait => setTimeout(() => resolveWait({ completed: false }), 1_000)),
	]);
	if (!abortRace.completed) {
		completion(summaryResponse!, requests, "The delayed compaction completed only after the abort was blocked.");
		await Promise.allSettled([compactDispatch, abortDispatch]);
		throw new Error("OMP context cancel smoke failed: context abort stayed queued until the held compaction completed");
	}
	check(abortRace.response.status === 200, `the owner abort route answers while compaction is active (${abortRace.response.status})`);
	const abortBody = record(abortRace.response.body, "compaction abort body");
	check(abortBody.state === "available", "the abort answer preserves the runtime's available context state");
	await Promise.race([
		summaryClosed.promise,
		new Promise<never>((_, reject) => setTimeout(() => reject(new Error("OMP did not cancel the in-flight summary request")), 5_000)),
	]);
	check(summaryWasAborted, "OMP cancelled the in-flight summary request after the owner abort");
	await compactDispatch;
	check(started.host.store.getCommand(session.id, "context-cancel-abort")?.status === "completed", "the durable abort command completed");

	const context = await until(
		async () => record((await started!.router({ method: "GET", path: `/v1/sessions/${session.id}/context`, token: owner })).body, "context body after cancellation"),
		body => body.state === "available" && body.compacting === false,
		"OMP maintenance to return to idle",
	);
	check(context.compacting === false, "the runtime reports compaction idle after the cancellation cleanup");
	const sessionFile = started.host.store.getSession(session.id)?.sessionFile;
	check(typeof sessionFile === "string", "the task retains its runtime session file for the commit check");
	const entries = (await readFile(sessionFile, "utf8"))
		.split("\n")
		.filter(Boolean)
		.map(line => JSON.parse(line) as { type?: unknown });
	check(!entries.some(entry => entry.type === "compaction"), "cancelling the held summary committed no compaction entry");

	const followup = await command("context-cancel-followup", "Confirm the session is usable after cancellation.");
	check(followup.status === 200, "a follow-up turn is accepted after compaction cancellation");
	await until(() => intentState("context-cancel-followup"), state => state === "completed", "the post-cancel turn to complete");
	check(Number(requests) === 3, "the post-cancel turn completed on the local fixture without an external provider");
} finally {
	if (summaryResponse && !summaryResponse.writableEnded && !summaryWasAborted) {
		completion(summaryResponse, requests, "Fixture cleanup completion.");
	}
	await started?.close();
	await new Promise<void>(close => fixture.close(() => close()));
	await Promise.all([
		rm(hostStateDir, { recursive: true, force: true }),
		rm(hostProfileDir, { recursive: true, force: true }),
		rm(hostWorkDir, { recursive: true, force: true }),
	]);
}

console.log(JSON.stringify({ ok: true, version, requests, summaryWasAborted }, null, 2));
