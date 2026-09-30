/**
 * Prove OMP removes an actual image from one host-owned session and keeps the rest of its context.
 *
 * A local OpenAI-compatible fixture answers the image turn and the post-shake follow-up. The
 * owner then invokes OMP's `context.shake` images strategy. The receipt requires a nonzero image
 * count in the persisted branch before and after the operation, plus unchanged neighboring text
 * and profile config. No external provider, app bundle, Keychain, or Login Item is used.
 *
 * Run: bun scripts/omp-context-images-live-smoke.ts
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";
import { attestOmpRuntime } from "./lib/omp-runtime-integrity.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP context image smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP context image smoke failed: ${message}`);
	return value as Record<string, unknown>;
}

async function exists(path: string): Promise<boolean> {
	try { await stat(path); return true; }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean, label: string, timeoutMs = 30_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	let value = await read();
	while (!accept(value)) {
		if (Date.now() >= deadline) throw new Error(`OMP context image smoke failed: timed out waiting for ${label}`);
		await new Promise(resolveWait => setTimeout(resolveWait, 50));
		value = await read();
	}
	return value;
}

type TranscriptEntry = { type?: unknown; message?: { role?: unknown; content?: unknown } };
function transcript(path: string): Promise<TranscriptEntry[]> {
	return readFile(path, "utf8").then(source => source.split("\n").filter(Boolean).map(line => JSON.parse(line) as TranscriptEntry));
}
function messageText(entries: TranscriptEntry[]): string[] {
	return entries.flatMap(entry => {
		if (entry.type !== "message" || !Array.isArray(entry.message?.content)) return [];
		return (entry.message.content as Record<string, unknown>[])
			.filter(block => block.type === "text" && typeof block.text === "string")
			.map(block => block.text as string);
	});
}
function textBlockBytes(entries: TranscriptEntry[]): string[] {
	return entries.flatMap(entry => entry.type === "message" && Array.isArray(entry.message?.content)
		? (entry.message.content as Record<string, unknown>[]).filter(block => block.type === "text").map(block => JSON.stringify(block))
		: []);
}
function imageBlocks(entries: TranscriptEntry[]): Record<string, unknown>[] {
	return entries.flatMap(entry => entry.type === "message" && Array.isArray(entry.message?.content)
		? (entry.message.content as Record<string, unknown>[]).filter(block => block.type === "image")
		: []);
}

const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/") ? resolve(requested) : (process.env.PATH ?? "").split(delimiter).map(dir => join(dir, requested)).find(Boolean) ?? requested;
check(await exists(executable), `OMP runtime is present at ${executable}`);
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `runtime is pinned (${version})`);
const attestation = attestOmpRuntime(resolve(import.meta.dir, ".."), executable);
check(attestation.sourceVerified, `prepared runtime source is attested (${attestation.sourceTree})`);

const imageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const fixtureAssistant = "IMAGE_TURN_ASSISTANT_SENTINEL";
const followupAssistant = "POST_SHAKE_FOLLOWUP_SENTINEL";
let chatCalls = 0;
const requestSummaries: Array<{ model?: string; messageContent: Array<Array<{ type: string; imageOmission?: boolean }>> }> = [];
const requestImageParts: Array<Array<{ type: string; mediaType?: string; representation?: string; encodedChars?: number; payloadBytes?: number; signature?: string }>> = [];
const completion = (response: ServerResponse, call: number, text: string): void => {
	const frame = (delta: unknown, finish: string | null, usage = false) => `data: ${JSON.stringify({
		id: `context-image-${call}`,
		object: "chat.completion.chunk",
		created: 1,
		model: "cedia-context-image-fixture-model",
		choices: [{ index: 0, delta, finish_reason: finish }],
		...(usage ? { usage: { prompt_tokens: 32, completion_tokens: 8, total_tokens: 40 } } : {}),
	})}\n\n`;
	response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
	response.write(frame({ role: "assistant", content: "" }, null));
	response.write(frame({ content: text }, null));
	response.write(frame({}, "stop", true));
	response.end("data: [DONE]\n\n");
};
const fixture: Server = createServer((request, response) => {
	const chunks: Buffer[] = [];
	request.on("data", chunk => chunks.push(Buffer.from(chunk)));
	request.on("end", () => {
		if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
			response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "fixture only serves chat completions" }));
			return;
		}
		const raw = Buffer.concat(chunks).toString("utf8");
		const body = record(JSON.parse(raw), "fixture request body");
		const messages = Array.isArray(body.messages) ? body.messages.map(item => record(item, "fixture message")) : [];
		requestSummaries.push({
			...(typeof body.model === "string" ? { model: body.model } : {}),
			messageContent: messages.map(message => Array.isArray(message.content)
				? message.content.map(part => {
					const item = record(part, "fixture content part");
					return { type: String(item.type ?? "unknown"), ...(item.type === "text" && typeof item.text === "string" && item.text.includes("[image omitted:") ? { imageOmission: true } : {}) };
				})
				: typeof message.content === "string" ? [{ type: "text" }] : [{ type: "unknown" }]),
		});
		const images = messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
			.map(part => record(part, "fixture content part"))
			.filter(part => part.type === "image_url")
			.map(part => {
				const imageUrl = part.image_url;
				const url = typeof imageUrl === "string" ? imageUrl : imageUrl !== null && typeof imageUrl === "object" ? (imageUrl as Record<string, unknown>).url : undefined;
				if (typeof url !== "string") return { type: "image_url" };
				const dataUri = /^data:([^;,]+);base64,([\s\S]*)$/.exec(url);
				if (!dataUri) return { type: "image_url", representation: "remote-url" };
				const bytes = Buffer.from(dataUri[2]!, "base64");
				const signature = bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
					? "RIFF/WEBP" : bytes.subarray(0, 8).toString("hex");
				return { type: "image_url", mediaType: dataUri[1], representation: "data-uri", encodedChars: dataUri[2]!.length, payloadBytes: bytes.length, signature };
			});
		requestImageParts.push(images);
		chatCalls += 1;
		completion(response, chatCalls, chatCalls === 1 ? fixtureAssistant : followupAssistant);
	});
});
await new Promise<void>(ready => fixture.listen(0, "127.0.0.1", ready));
fixture.unref();
const address = fixture.address();
const port = address !== null && typeof address === "object" ? address.port : 0;
check(port > 0, "loopback model fixture bound");

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-context-images-state-"));
const profileDir = await mkdtemp(join(tmpdir(), "cedia-context-images-profile-"));
const projectDir = await mkdtemp(join(tmpdir(), "cedia-context-images-project-"));
const provider = "cedia-context-image-fixture";
const model = "cedia-context-image-fixture-model";
const modelsPath = join(profileDir, "models.yml");
const configPath = join(profileDir, "config.yml");
const modelsBytes = `providers:\n  ${provider}:\n    baseUrl: http://127.0.0.1:${port}/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: ${model}\n        name: Cedia context image fixture\n        api: openai-completions\n        reasoning: false\n        input: [text, image]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 128000\n        maxTokens: 4096\n`;
const configBytes = "compaction:\n  methodOrder: [soft]\n  keepRecentTokens: 1\ncustomFixtureField:\n  preserve: image-shake-proof\n";
await writeFile(modelsPath, modelsBytes, { mode: 0o600 });
await writeFile(configPath, configBytes, { mode: 0o600 });

let started: Awaited<ReturnType<typeof startHostServer>> | undefined;
let sessionFile: string | undefined;
try {
	started = await startHostServer({
		stateDir: hostStateDir,
		port: 0,
		ompExecutable: executable,
		virtualUi: true,
		ompEnv: { HOME: profileDir, PI_CODING_AGENT_DIR: profileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
	});
	const owner = started.auth.ownerToken;
	const project = started.host.store.createProject({ path: projectDir, name: "Context image fixture" });
	const session = started.host.createSession(project.id, "Context image fixture");
	await started.host.startSession(session.id);
	const liveSession = started.host.store.getSession(session.id)!;
	const incarnation = liveSession.incarnation;
	sessionFile = liveSession.sessionFile;
	check(typeof sessionFile === "string", "the live session has a persisted transcript file");
	const promptPath = `/v1/sessions/${session.id}/commands`;
	const modelStateResponse = await started.router({
		method: "POST", path: promptPath, token: owner,
		body: { commandId: "context-images-model-state", incarnation, command: "get_state", payload: {} },
	});
	check(modelStateResponse.status === 200, "owner can inspect the selected fixture model state");
	const stateAck = record(started.host.store.getCommand(session.id, "context-images-model-state")?.ack, "model state command ack");
	const stateData = record(stateAck.data, "model state data");
	const selectedModel = record(stateData.model, "selected model");
	check(selectedModel.provider === provider && selectedModel.id === model && selectedModel.api === "openai-completions"
		&& Array.isArray(selectedModel.input) && selectedModel.input.includes("image")
		&& record(selectedModel.compat ?? {}, "model compat").stripImageInput !== true,
	"the live fixture model advertises image input and does not strip it");
	const prompt = await started.router({
		method: "POST",
		path: promptPath,
		token: owner,
		body: {
			commandId: "context-images-seed",
			incarnation,
			command: "prompt",
			payload: {
				message: "Keep CONTEXT_IMAGE_TEXT_SENTINEL in history beside the attached image.",
				images: [{ type: "image", data: imageBase64, mimeType: "image/png" }],
			},
		},
	});
	check(prompt.status === 200, "an image turn is accepted by the host-backed OMP session");
	await until(() => started!.host.store.getTurnIntentByCommand(session.id, "context-images-seed")?.state, state => state === "completed", "the image turn to complete");
	check(chatCalls === 1, `the image turn was answered by one local fixture request (${chatCalls})`);
	check(requestImageParts[0]?.length === 1 && requestImageParts[0][0]?.representation === "data-uri"
		&& requestImageParts[0][0]?.mediaType === "image/webp" && requestImageParts[0][0]?.signature === "RIFF/WEBP"
		&& requestImageParts[0][0]?.payloadBytes !== undefined && requestImageParts[0][0].payloadBytes > 0,
	"exactly one non-empty, normalized WebP image reaches the first loopback provider request as a data URI");

	const beforeEntries = await transcript(sessionFile);
	const beforeImages = imageBlocks(beforeEntries);
	const persistedImageBytes = typeof beforeImages[0]?.data === "string" ? Buffer.from(beforeImages[0].data, "base64") : Buffer.alloc(0);
	check(beforeImages.length === 1 && beforeImages[0]?.mimeType === "image/webp"
		&& persistedImageBytes.toString("ascii", 0, 4) === "RIFF" && persistedImageBytes.toString("ascii", 8, 12) === "WEBP",
	`persisted transcript contains one normalized WebP fixture image (count ${beforeImages.length})`);
	const beforeTexts = messageText(beforeEntries);
	const beforeTextBlocks = textBlockBytes(beforeEntries);
	check(beforeTexts.some(text => text.includes("CONTEXT_IMAGE_TEXT_SENTINEL")) && beforeTexts.includes(fixtureAssistant), "the branch has unrelated user text and a completed assistant answer before reduction");
	const configBefore = await readFile(configPath);
	const modelsBefore = await readFile(modelsPath);

	const shakePath = `/v1/sessions/${session.id}/context/shake`;
	const shakeBody = { commandId: "context-images-shake", incarnation, mode: "images" };
	const shaken = await started.router({ method: "POST", path: shakePath, token: owner, body: shakeBody });
	const shakenBody = record(shaken.body, "context shake response");
	const result = record(shakenBody.shake, "context shake result");
	check(shaken.status === 200 && shakenBody.state === "available", "the owner context-shake route returns an available post-action snapshot");
	check(result.mode === "images" && result.imagesDropped === 1, `OMP reports one real image removed (imagesDropped=${String(result.imagesDropped)})`);
	const afterShakeEntries = await transcript(sessionFile);
	const afterShakeImages = imageBlocks(afterShakeEntries);
	check(afterShakeImages.length === 0, `persisted branch image count falls from ${beforeImages.length} to ${afterShakeImages.length}`);
	const afterShakeTexts = messageText(afterShakeEntries);
	check(afterShakeTexts.some(text => text.includes("CONTEXT_IMAGE_TEXT_SENTINEL")) && afterShakeTexts.includes(fixtureAssistant), "shake retains the seed user text and unrelated assistant answer byte-for-byte");
	check(JSON.stringify(textBlockBytes(afterShakeEntries)) === JSON.stringify(beforeTextBlocks), "every pre-existing transcript text block is byte-identical across the image removal");
	check((await readFile(configPath)).equals(configBefore) && (await readFile(modelsPath)).equals(modelsBefore), "shake leaves profile configuration bytes unchanged");
	const replay = await started.router({ method: "POST", path: shakePath, token: owner, body: shakeBody });
	check(JSON.stringify(replay.body) === JSON.stringify(shaken.body), "replaying the same context command id returns the identical receipt without changing the branch again");
	const stale = await started.router({
		method: "POST",
		path: shakePath,
		token: owner,
		body: { commandId: "context-images-stale", incarnation: "stale-image-incarnation", mode: "images" },
	});
	const staleError = record(record(stale.body, "stale context body").error, "stale context error");
	check(stale.status === 409 && staleError.code === "stale_incarnation", "a stale incarnation is refused before a durable shake command is claimed");
	check(started.host.store.getCommand(session.id, "context-images-stale") === undefined, "stale context refusal creates no durable command row");
	check(imageBlocks(await transcript(sessionFile)).length === 0, "replay and stale refusal keep the image absent");

	const followup = await started.router({
		method: "POST",
		path: promptPath,
		token: owner,
		body: { commandId: "context-images-followup", incarnation, command: "prompt", payload: { message: "Confirm the context session is usable." } },
	});
	check(followup.status === 200, "a post-shake follow-up turn is accepted");
	await until(() => started!.host.store.getTurnIntentByCommand(session.id, "context-images-followup")?.state, state => state === "completed", "the follow-up turn to complete");
	check(Number(chatCalls) === 2, "the follow-up completed with the second local fixture response");
	check(requestImageParts[1]?.length === 0, "the post-shake follow-up reaches the provider with no image parts");
	const finalEntries = await transcript(sessionFile);
	check(imageBlocks(finalEntries).length === 0, "the follow-up transcript remains free of the dropped image");
	const finalTexts = messageText(finalEntries);
	check(finalTexts.some(text => text.includes("CONTEXT_IMAGE_TEXT_SENTINEL")) && finalTexts.includes(fixtureAssistant) && finalTexts.some(text => text.includes("Confirm the context session is usable.")) && finalTexts.includes(followupAssistant), "seed transcript and follow-up text/answer survive reduction");
	check((await readFile(configPath)).equals(configBefore) && (await readFile(modelsPath)).equals(modelsBefore), "follow-up leaves the pre-existing model/config files byte-identical");
	console.log(JSON.stringify({
		ok: true,
		version,
		attestation,
		imageCounts: { before: beforeImages.length, shakeReportedDropped: result.imagesDropped, after: imageBlocks(finalEntries).length },
		loopbackChatCalls: chatCalls,
		providerRequestSummaries: requestSummaries,
		providerRequestImageParts: requestImageParts,
		staleCommandStatus: stale.status,
	}, null, 2));
} finally {
	await started?.close();
	await new Promise<void>(close => fixture.close(() => close()));
	await Promise.all([
		rm(hostStateDir, { recursive: true, force: true }),
		rm(profileDir, { recursive: true, force: true }),
		rm(projectDir, { recursive: true, force: true }),
	]);
}
