/**
 * Live proof that a failed provider-native context compaction falls through to
 * the next configured OMP method, commits once, and leaves the owner usable.
 *
 * An isolated CEDIA host and pinned OMP 18.1.18 use a loopback OpenAI-compatible
 * fixture. The fixture returns one real HTTP failure from `/responses/compact`,
 * then answers OMP's soft-summary request and a follow-up turn. No external
 * provider, desktop app, credential, or paid inference is used.
 *
 * Run: bun scripts/omp-context-fallback-smoke.ts
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP context fallback smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`OMP context fallback smoke failed: ${message}`);
	}
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
		if (Date.now() >= deadline) throw new Error(`OMP context fallback smoke failed: timed out waiting for ${label}`);
		await new Promise(resolveWait => setTimeout(resolveWait, 50));
		value = await read();
	}
	return value;
}

const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/")
	? resolve(requested)
	: ((process.env.PATH ?? "").split(delimiter).map(dir => join(dir, requested)).find(candidate => candidate) ?? requested);
check(await exists(executable), `OMP runtime is present at ${executable}`);
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `the runtime is the pinned ${OMP_BASELINE_VERSION} (${version})`);

const fixtureRequests: Array<{ path: string; body: Record<string, unknown> }> = [];
let chatCalls = 0;
const observedChatCalls = () => chatCalls;
const completion = (response: ServerResponse, call: number, text: string) => {
	const frame = (delta: unknown, finish: string | null, usage = false) =>
		`data: ${JSON.stringify({
			id: `context-fallback-${call}`,
			object: "chat.completion.chunk",
			created: 1,
			model: "cedia-context-fallback-fixture-model",
			choices: [{ index: 0, delta, finish_reason: finish }],
			...(usage ? { usage: { prompt_tokens: 24, completion_tokens: 8, total_tokens: 32 } } : {}),
		})}\n\n`;
	response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
	response.write(frame({ role: "assistant", content: "" }, null));
	response.write(frame({ content: text }, null));
	response.write(frame({}, "stop", true));
	response.end("data: [DONE]\n\n");
};
const fixture: Server = createServer((request, response) => {
	let raw = "";
	request.setEncoding("utf8");
	request.on("data", chunk => { raw += chunk; });
	request.on("end", () => {
		let body: Record<string, unknown> = {};
		try {
			body = raw ? record(JSON.parse(raw), "fixture request body") : {};
		} catch (error) {
			response.writeHead(400, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: String(error) }));
			return;
		}
		const path = request.url ?? "";
		fixtureRequests.push({ path, body });
		if (request.method !== "POST") {
			response.writeHead(405).end();
			return;
		}
		if (path.endsWith("/responses/compact")) {
			response.writeHead(503, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: { message: "fixture native-compaction failure", type: "server_error" } }));
			return;
		}
		if (path.endsWith("/chat/completions")) {
			chatCalls += 1;
			completion(
				response,
				chatCalls,
				chatCalls === 1
					? "Seed turn complete."
					: chatCalls === 2
						? "Recovered context summary."
						: chatCalls === 3
							? "Recovered short summary."
							: "Follow-up turn complete.",
			);
			return;
		}
		response.writeHead(404, { "content-type": "application/json" });
		response.end(JSON.stringify({ error: `fixture does not serve ${path}` }));
	});
});
await new Promise<void>(ready => fixture.listen(0, "127.0.0.1", ready));
fixture.unref();
const address = fixture.address();
const port = address !== null && typeof address === "object" ? address.port : 0;
check(port > 0, "loopback model fixture bound");

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-context-fallback-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-context-fallback-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-context-fallback-work-"));
const provider = "cedia-context-fallback-fixture";
const model = "cedia-context-fallback-fixture-model";
await writeFile(
	join(hostProfileDir, "models.yml"),
	`providers:\n  ${provider}:\n    baseUrl: http://127.0.0.1:${port}/v1\n    auth: none\n    api: openai-completions\n    remoteCompaction:\n      enabled: true\n      api: openai-responses\n      endpoint: http://127.0.0.1:${port}/v1/responses/compact\n    models:\n      - id: ${model}\n        name: Cedia context fallback fixture\n        api: openai-completions\n        reasoning: false\n        input: [text]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 128000\n        maxTokens: 4096\n`,
	{ mode: 0o600 },
);
await writeFile(
	join(hostProfileDir, "config.yml"),
	"compaction:\n  methodOrder: [remote, soft]\n  keepRecentTokens: 1\n",
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
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Context fallback smoke" });
	const session = started.host.createSession(project.id, "Context fallback smoke");
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
	const seeded = await command("context-fallback-seed", "Create a short context fixture.");
	check(seeded.status === 200, "the seed turn is accepted through the host command route");
	await until(() => intentState("context-fallback-seed"), state => state === "completed", "the fixture seed turn to complete");
	check(observedChatCalls() === 1 && fixtureRequests.length === 1, "the seed turn used exactly one local response");

	compactDispatch = started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/commands`,
		token: owner,
		body: { commandId: "context-fallback-compact", incarnation, command: "prompt", payload: { message: "/compact" } },
	});
	await until(() => fixtureRequests.some(item => item.path.endsWith("/responses/compact")), Boolean, "OMP to attempt provider-native compaction");
	const nativeFailure = fixtureRequests.find(item => item.path.endsWith("/responses/compact"));
	check(nativeFailure !== undefined, "OMP attempted provider-native compaction against the loopback endpoint");
	try {
		await until(observedChatCalls, count => count >= 2, "OMP soft-compaction fallback request", 12_000);
	} catch (error) {
		const latest = started.host.store.readEvents(session.id, 0, 200).events.map(event => event.frame);
		console.error(JSON.stringify({
			fixtureRequests: fixtureRequests.map(item => ({ path: item.path, model: item.body.model })),
			compactCommand: started.host.store.getCommand(session.id, "context-fallback-compact"),
			latestFrames: latest.slice(-20),
		}, null, 2));
		throw error;
	}
	const compactAck = await compactDispatch as Record<string, unknown>;
	check(compactAck.status === 200, "the /compact command route acknowledged the fallback operation");
	await until(() => started!.host.store.getCommand(session.id, "context-fallback-compact")?.status, state => state === "completed", "the /compact owner command to complete");

	const context = record(
		(await started.router({ method: "GET", path: `/v1/sessions/${session.id}/context`, token: owner })).body,
		"context body after fallback",
	);
	check(context.state === "available" && context.compacting === false, "the owner context snapshot is available and idle after fallback");
	const journal = [] as ReturnType<typeof started.host.store.readEvents>["events"];
	let cursor = 0;
	for (;;) {
		const page = started.host.store.readEvents(session.id, cursor, 200);
		journal.push(...page.events);
		cursor = page.cursor;
		if (!page.hasMore) break;
	}
	const notices = journal.map(event => record(event.frame, "journal frame")).filter(frame => frame.type === "notice");
	check(
		notices.some(frame => frame.source === "compaction" && typeof frame.message === "string" && frame.message.includes("remote compaction failed; trying the next preferred method")),
		"the event journal exposes OMP's bounded remote-to-soft fallback warning",
	);

	const sessionFile = started.host.store.getSession(session.id)?.sessionFile;
	check(typeof sessionFile === "string", "the task retains its runtime session file for the durable commit check");
	const entries = (await readFile(sessionFile, "utf8"))
		.split("\n")
		.filter(Boolean)
		.map(line => JSON.parse(line) as { type?: unknown; method?: unknown; summary?: unknown });
	const compactions = entries.filter(entry => entry.type === "compaction");
	check(compactions.length === 1, "exactly one durable compaction entry exists after fallback");
	check(
		compactions[0]?.method === "soft" && typeof compactions[0]?.summary === "string" && compactions[0].summary.includes("Recovered context summary."),
		"the durable entry belongs to the successful soft fallback",
	);

	const followup = await command("context-fallback-followup", "Confirm the session is usable after fallback.");
	check(followup.status === 200, "a follow-up turn is accepted after the fallback compaction");
	await until(() => intentState("context-fallback-followup"), state => state === "completed", "the post-fallback turn to complete");
	check(observedChatCalls() === 4, "the post-fallback turn used one local response after the seed and two soft-summary calls");
	console.log(JSON.stringify({ ok: true, version, requests: fixtureRequests.map(item => item.path), compactions: compactions.length }, null, 2));
} finally {
	await Promise.allSettled(compactDispatch ? [compactDispatch] : []);
	await started?.close();
	await new Promise<void>(close => fixture.close(() => close()));
	await Promise.all([
		rm(hostStateDir, { recursive: true, force: true }),
		rm(hostProfileDir, { recursive: true, force: true }),
		rm(hostWorkDir, { recursive: true, force: true }),
	]);
}
