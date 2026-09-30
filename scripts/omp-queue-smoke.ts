/**
 * Live proof of Cedia's O01 queue view against the pinned runtime.
 *
 * OMP owns both user queues. This smoke reads that state through `cedia_control`, then proves the
 * host routes project the same queue, settle the exact queued turn intent when it is dropped,
 * return an explicit empty `dropped` on a no-op drop, validate an unknown mode before claiming a
 * durable command, and remain owner-only. Drop scenarios hold the loopback model
 * request open; --execute explicitly releases deterministic local SSE replies.
 *
 * Run: bun scripts/omp-queue-smoke.ts [--browser | --composer | --execute]
 * --browser uses the existing Mac package assets in headless Chrome to click Drop last;
 * queue setup remains host-driven, not composer-submit acceptance.
 * --composer submits both prompts from the real composer before clicking Drop last.
 * --execute submits A/B/C from the composer, then releases loopback replies one
 * at a time and checks queue order, durable intent completion and transcript.
 * CEDIA_QUEUE_UI_ASSETS selects a freshly built frontend instead of package assets.
 * CEDIA_QUEUE_NATIVE_APP selects an independent Cedia.app copy under the OS temp
 * directory for native Electron --composer proof (no asset override). Its Login
 * Item calls are shimmed and it is re-signed; never point it at an installed app.
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";
import { decodeQueueImagePair, dropQueueThroughBrowser, queueImageDataUrl, queueImageParts, queuePixelsMatch, summarizeQueueRequest, type QueueImageFixture } from "./lib/queue-browser-proof.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP queue smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP queue smoke failed: ${message}`);
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

const executeMode = process.argv.includes("--execute");
const attachmentsMode = process.argv.includes("--attachments");
check(!attachmentsMode || executeMode, "--attachments requires --execute");
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
const runtime = { executable, version, executableSha256: createHash("sha256").update(await readFile(executable)).digest("hex") };

const cwd = await mkdtemp(join(tmpdir(), "cedia-queue-"));
const executionTexts = ["Queue A: first local task", "Queue B: second local task", "Queue C: third local task"];
const replies = ["Local task A completed.", "Local task B completed.", "Local task C completed."];
const attachmentFixtures: { first: QueueImageFixture; second: QueueImageFixture } = {
	first: { name: "queue-a-red.png", mimeType: "image/png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" },
	second: { name: "queue-b-white.png", mimeType: "image/png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==" },
};
const requests: { body: Record<string, unknown>; response: ServerResponse; released: boolean }[] = [];
const queueAttachmentFailures: string[] = [];
let fixtureError: unknown;
let modelHits = 0;
async function writeRequestEvidence(output: string): Promise<void> {
	await writeFile(join(output, "request-summaries.json"), JSON.stringify({ modelHits, fixtureError: fixtureError ? String(fixtureError) : undefined, queueAttachmentFailures, requests: requests.map(row => summarizeQueueRequest(row.body)) }, null, 2));
}
const held: Server = createServer(async (request, response) => {
	modelHits += 1;
	if (!executeMode) return; // Drop proof deliberately never answers.
	try {
		check(request.method === "POST" && request.url === "/v1/chat/completions", "execution fixture receives only chat completions");
		let body = "";
		for await (const chunk of request) {
			body += chunk.toString();
			check(Buffer.byteLength(body) < 2_000_000, "fixture request is bounded");
		}
		const parsed = record(JSON.parse(body));
		check(parsed.model === "cedia-queue-fixture-model" && parsed.stream === true, "execution fixture receives the selected streaming model");
		check(requests.length < 3 && requests.every(row => row.released), "requests are sequential with no retry or duplicate");
		requests.push({ body: parsed, response, released: false });
	} catch (error) { fixtureError = error; response.writeHead(500).end("Fixture rejected request"); }
});
async function until(predicate: () => boolean, description: string) {
	const deadline = Date.now() + 20_000;
	while (!predicate() && !fixtureError && Date.now() < deadline) await new Promise(resolveWait => setTimeout(resolveWait, 25));
	check(!fixtureError && predicate(), `${description}${fixtureError ? `: ${fixtureError}` : ""}`);
}
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
held.unref();
const address = held.address();
const port = address !== null && typeof address === "object" ? (address as { port: number }).port : 0;
check(port > 0, "fixture listener bound");

const modelsYaml = `providers:
  cedia-queue-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-queue-fixture-model
        name: Cedia queue smoke fixture
        api: openai-completions
        reasoning: false
        input: ${attachmentsMode ? "[text, image]" : "[text]"}
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;
await writeFile(join(cwd, "models.yml"), modelsYaml);

let client: OmpRpcClient | undefined;
try {
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
		onFrame() {
			/* frames are not needed for this proof */
		},
	});
	await client.requestCedia("cedia_terminal_negotiate", { version: 1, cols: 40, rows: 8 });
	const ack = await client.requestCedia("cedia_control", { operation: "queue.get" });
	const control = record(record(ack.data, "cedia_control data").result, "queue.get result");
	check(Array.isArray(control.steering) && Array.isArray(control.followUp), "the runtime answers its own steering and follow-up queues");
	check(control.steering.length === 0 && control.followUp.length === 0, "a fresh runtime reports empty queues honestly");
	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
}

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-queue-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-queue-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-queue-host-work-"));
const boundaries: { sequence: number; frame: Record<string, unknown> }[] = [];
await writeFile(join(hostProfileDir, "models.yml"), modelsYaml, { mode: 0o600 });
const started = await startHostServer({
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	onEvent(event) {
		const frame = record(event.frame);
		if (frame.type === "cedia_turn_boundary") boundaries.push({ sequence: event.sequence, frame });
	},
	ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
try {
	const owner = started.auth.ownerToken;
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Queue smoke" });
	const session = started.host.createSession(project.id, "Queue smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/queue`, token: owner });
	const beforeBody = record(before.body, "queue body before start");
	check(before.status === 200 && beforeBody.state === "unavailable" && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);
	const live = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/queue`, token: owner });
	const liveBody = record(live.body, "live queue body");
	check(live.status === 200 && liveBody.state === "available", "the queue route answers for a live session");
	check(Array.isArray(liveBody.steering) && Array.isArray(liveBody.followUp), "the route carries both runtime queue sides");
	check((liveBody.steering as unknown[]).length === 0 && (liveBody.followUp as unknown[]).length === 0, "the route answers the runtime's empty queues");

	const incarnation = started.host.store.getSession(session.id)!.incarnation;
	const dropped = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/queue/drop`,
		token: owner,
		body: { commandId: "queue-smoke-drop", incarnation, mode: "all" },
	});
	const droppedBody = record(dropped.body, "drop body");
	check(dropped.status === 200 && droppedBody.state === "available", "the drop route answers the runtime projection");
	check(Array.isArray(droppedBody.dropped) && (droppedBody.dropped as unknown[]).length === 0, "an empty drop reports an explicit empty dropped list");
	const replay = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/queue/drop`,
		token: owner,
		body: { commandId: "queue-smoke-drop", incarnation, mode: "all" },
	});
	check(JSON.stringify(replay.body) === JSON.stringify(dropped.body), "a repeated command id replays the same drop receipt");

	const beforeInvalid = started.host.store.listCommands(session.id).length;
	const invalidMode = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/queue/drop`,
		token: owner,
		body: { commandId: "queue-smoke-invalid", incarnation, mode: "unknown" },
	});
	check(invalidMode.status === 400 && record(invalidMode.body).error && (record(record(invalidMode.body).error).code === "invalid_body"), "an unknown mode is refused before the runtime call");
	check(started.host.store.listCommands(session.id).length === beforeInvalid, "an invalid mode claims no durable command");

	const model = await started.host.command(session.id, "owner", {
		commandId: "queue-smoke-model",
		incarnation,
		command: "set_model",
		payload: { provider: "cedia-queue-fixture", modelId: "cedia-queue-fixture-model" },
	});
	check(["completed", "acknowledged"].includes(model.status), "the held-turn fixture model is accepted by OMP");
	const composerMode = process.argv.includes("--composer") || executeMode;
	const executionCommandIds: string[] = [];
	if (executeMode) {
		const mode = await started.host.command(session.id, "owner", { commandId: "queue-execution-mode", incarnation, command: "set_follow_up_mode", payload: { mode: "one-at-a-time" } });
		check(["completed", "acknowledged"].includes(mode.status), "OMP accepts explicit one-at-a-time follow-up mode");
	}
	let runningCommandId = "queue-smoke-running-turn";
	let queuedCommandId = "queue-smoke-follow-up";
	if (!composerMode) {
	await started.host.command(session.id, "owner", {
		commandId: "queue-smoke-running-turn",
		incarnation,
		command: "prompt",
		payload: { message: "hold this local request while the queue drop is tested" },
	});
	const runningDeadline = Date.now() + 20_000;
	while ((modelHits < 1 || started.host.store.getTurnIntentByCommand(session.id, "queue-smoke-running-turn")?.state !== "running") && Date.now() < runningDeadline) {
		await new Promise(resolveWait => setTimeout(resolveWait, 25));
	}
	check(modelHits === 1, "the active turn reached only the local held HTTP fixture");
	check(started.host.store.getTurnIntentByCommand(session.id, "queue-smoke-running-turn")?.state === "running", "OMP names the active turn as running");

	await started.host.command(session.id, "owner", {
		commandId: "queue-smoke-follow-up",
		incarnation,
		command: "follow_up",
		payload: { message: "drop this queued local submission" },
	});
	const queuedDeadline = Date.now() + 10_000;
	while (started.host.store.getTurnIntentByCommand(session.id, "queue-smoke-follow-up")?.state !== "queued" && Date.now() < queuedDeadline) {
		await new Promise(resolveWait => setTimeout(resolveWait, 25));
	}
	check(started.host.store.getTurnIntentByCommand(session.id, "queue-smoke-follow-up")?.state === "queued", "OMP accepts the follow-up as a queued turn intent");
	const queued = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/queue`, token: owner });
	const queuedBody = record(queued.body, "queued queue body");
	const followUpRows = Array.isArray(queuedBody.followUp) ? queuedBody.followUp : [];
	check(queued.status === 200 && followUpRows.some(row => record(row).text === "drop this queued local submission"), "the host projects the queued text from OMP");
	}

	const browserProof = (process.argv.includes("--browser") || composerMode) ? await dropQueueThroughBrowser({
		root: resolve(import.meta.dir, ".."), stateDir: hostStateDir,
		sessionTitle: session.title, queuedText: executeMode ? executionTexts[1]! : "drop this queued local submission",
		...(executeMode ? { execution: { thirdText: executionTexts[2]!, replies, ...(attachmentsMode ? { attachments: attachmentFixtures } : {}), capture: writeRequestEvidence, afterReload: attachmentsMode ? async () => check(modelHits === 3, "page reload does not create another model request") : undefined, validate: attachmentsMode ? async () => check(queueAttachmentFailures.length === 0, queueAttachmentFailures.join("; ")) : undefined, finish: async (page: unknown) => {
			for (let index = 0; index < 3; index++) {
				await until(() => requests.length === index + 1, `request ${index + 1} arrived exactly once`);
				const current = requests[index]!;
				const messages = current.body.messages as Record<string, unknown>[];
				const lastUser = messages.filter(message => message.role === "user").at(-1);
				const content = typeof lastUser?.content === "string" ? lastUser.content : JSON.stringify(lastUser?.content);
				check(content.includes(executionTexts[index]!), `request ${index + 1} executes the expected prompt`);
				for (const later of executionTexts.slice(index + 1)) check(!content.includes(later), "later prompts are not batched into this request");
				if (attachmentsMode) {
					const expectedFixture = index === 0 ? attachmentFixtures.first : index === 1 ? attachmentFixtures.second : undefined;
					const parts = queueImageParts(lastUser);
					check(parts.length === (expectedFixture ? 1 : 0), `request ${index + 1} carries the expected image count (${parts.length})`);
					if (expectedFixture) {
						const url = queueImageDataUrl(parts[0]?.image_url);
						check(typeof url === "string", `request ${index + 1} carries a data image URL`);
						const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(url!);
						check(!!match, `request ${index + 1} carries a decodable data image URL`);
						const decoded = await decodeQueueImagePair(page, url!, expectedFixture);
						const normalized = match![1] !== expectedFixture.mimeType
							|| decoded.actual.width !== decoded.expected.width
							|| decoded.actual.height !== decoded.expected.height;
						console.log(`IMAGE request ${index + 1} ${JSON.stringify({ expected: { name: expectedFixture.name, mimeType: expectedFixture.mimeType, width: decoded.expected.width, height: decoded.expected.height, pixel: decoded.expected.pixel }, actual: { mimeType: match![1], encodedChars: match![2]!.length, width: decoded.actual.width, height: decoded.actual.height, pixel: decoded.actual.pixel }, normalized })}`);
						if (!normalized) check(match![2] === expectedFixture.base64, `request ${index + 1} image bytes match ${expectedFixture.name}`);
						else check(queuePixelsMatch(decoded.actual.pixel, decoded.expected.pixel), `request ${index + 1} normalized image pixels match ${expectedFixture.name}`);
					}
				}
				await until(() => started.host.store.getTurnIntentByCommand(session.id, executionCommandIds[index]!)?.state === "running", `intent ${index + 1} is running`);
				check(executionCommandIds.every((id, position) => started.host.store.getTurnIntentByCommand(session.id, id)?.state === (position < index ? "completed" : position === index ? "running" : "queued")), "durable intents distinguish completed, current and waiting work");
				const queue = record((await started.router({ method: "GET", path: `/v1/sessions/${session.id}/queue`, token: owner })).body);
				const queueRows = queue.followUp as Record<string, unknown>[];
				check(JSON.stringify(queueRows.map(row => row.text)) === JSON.stringify(executionTexts.slice(index + 1)), "OMP queue retains only the later prompts in order");
				if (attachmentsMode) {
					const expectedQueueImages = index === 0 ? [1, 0] : index === 1 ? [0] : [];
					const actualQueueImages = queueRows.map(row => row.images);
					if (JSON.stringify(actualQueueImages) !== JSON.stringify(expectedQueueImages)) {
						const failure = `request ${index + 1} queue image counts expected ${JSON.stringify(expectedQueueImages)} but received ${JSON.stringify(queueRows.map(row => ({ text: row.text, images: row.images })))}`;
						queueAttachmentFailures.push(failure);
						console.log(`DEFERRED ${failure}`);
					}
				}
				current.released = true;
				const chunk = (delta: unknown, finish_reason: string | null = null) => ({ id: `queue-${index}`, object: "chat.completion.chunk", created: 0, model: "cedia-queue-fixture-model", choices: [{ index: 0, delta, finish_reason }] });
				current.response.writeHead(200, { "content-type": "text/event-stream" });
				current.response.end([chunk({ role: "assistant", content: replies[index] }), chunk({}, "stop"), "[DONE]"].map(event => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join(""));
				await until(() => started.host.store.getTurnIntentByCommand(session.id, executionCommandIds[index]!)?.state === "completed", `intent ${index + 1} completed`);
			}
			await new Promise(resolveWait => setTimeout(resolveWait, 500));
			check(modelHits === 3 && !fixtureError, "exactly three loopback model requests after completion");
			return { mode: "one-at-a-time", modelHits, boundaries, intents: executionCommandIds.map(id => started.host.store.getTurnIntentByCommand(session.id, id)), queueAttachmentFailures, requestSummaries: requests.map(row => summarizeQueueRequest(row.body)) };
		} } } : {}),
		...(composerMode ? { composer: {
			firstText: executeMode ? executionTexts[0]! : "hold this local request while the queue drop is tested",
			onSubmitted: async (commandId: string, phase: "running" | "queued") => {
				if (executeMode) executionCommandIds.push(commandId);
				if (phase === "running") runningCommandId = commandId; else queuedCommandId = commandId;
				const deadline = Date.now() + 20_000;
				while ((started.host.store.getTurnIntentByCommand(session.id, commandId)?.state !== phase || modelHits !== 1) && Date.now() < deadline) await new Promise(resolveWait => setTimeout(resolveWait, 25));
				check(started.host.store.getTurnIntentByCommand(session.id, commandId)?.state === phase, `composer submission is ${phase} in host`);
				check(modelHits === 1, "composer uses only one held local model request");
			},
		} } : {}),
	}) : null;
	if (executeMode && browserProof) {
		await writeFile(join(browserProof.output, "result.json"), JSON.stringify({ ...browserProof, runtime, ok: true, modelHits, executeMode }, null, 2));
		console.log(`Execution proof: ${browserProof.output}`);
	} else {
	const liveDrop = browserProof ? { status: 200, body: browserProof.body } : await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/queue/drop`,
		token: owner,
		body: { commandId: "queue-smoke-drop-live", incarnation, mode: "last" },
	});
	const liveDropBody = record(liveDrop.body, "live drop body");
	const droppedRows = Array.isArray(liveDropBody.dropped) ? liveDropBody.dropped : [];
	check(liveDrop.status === 200 && droppedRows.some(row => record(row).text === "drop this queued local submission"), "the live drop returns the exact submission removed by OMP");
	check(started.host.store.getTurnIntentByCommand(session.id, queuedCommandId)?.state === "cancelled", "the host settles the dropped intent as cancelled");
	check(!JSON.stringify(liveDrop.body).includes("droppedIntentIds"), "internal turn identities are not exposed in the queue response");
	const liveDropReceipt = started.host.store.getCommand(session.id, browserProof?.commandId ?? "queue-smoke-drop-live");
	check(!!liveDropReceipt, "the drop has a durable host command receipt");
	const afterDrop = record((await started.router({ method: "GET", path: `/v1/sessions/${session.id}/queue`, token: owner })).body);
	check(afterDrop.state === "available" && Array.isArray(afterDrop.steering) && afterDrop.steering.length === 0 && Array.isArray(afterDrop.followUp) && afterDrop.followUp.length === 0, "fresh host readback confirms both queues are empty");
	check(started.host.store.getTurnIntentByCommand(session.id, runningCommandId)?.state === "running", "dropping the queued submission does not falsely complete the active turn");
	check(!JSON.stringify(liveDropReceipt?.ack).includes(queuedCommandId), "the durable drop receipt omits internal turn identities");
	await new Promise(resolveWait => setTimeout(resolveWait, 100));
	check(modelHits === 1, "dropping the queued turn does not submit another provider request");
	if (browserProof) {
		await writeFile(join(browserProof.output, "result.json"), JSON.stringify({ ...browserProof, runtime, ok: true, modelHits, composerMode, intentState: started.host.store.getTurnIntentByCommand(session.id, queuedCommandId)?.state }, null, 2));
		console.log(`Browser proof: ${browserProof.output}`);
	}
	}

	const notOwner = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/queue` });
	check(notOwner.status === 401 || notOwner.status === 403, `the queue routes are owner-only (${notOwner.status})`);
} finally {
	held.closeAllConnections();
	await started.close();
}

await Promise.all([
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
	rm(cwd, { recursive: true, force: true }),
	new Promise<void>(close => held.close(() => close())),
]);
console.log(JSON.stringify({ ok: true, version }, null, 2));
