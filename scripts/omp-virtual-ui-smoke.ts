/**
 * Real subprocess acceptance probe for Cedia's opt-in OMP virtual UI patch.
 *
 * This deliberately uses a loopback scripted model and a trusted fixture
 * extension. It never reads provider credentials, contacts a paid model, or
 * modifies a user Cedia/OMP session. The receipt contains only bounded frame
 * summaries and hashes.
 */
import { createHash } from "node:crypto";
import { spawn as spawnProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { OmpRpcClient } from "../packages/omp-adapter/src/client.ts";
import { CediaHost } from "../apps/host/src/service.ts";
import { DurableStore } from "../apps/host/src/store.ts";
import { EditorConnections } from "../apps/host/src/editors.ts";
import type { OmpFrame } from "../packages/omp-adapter/src/types.ts";
import { attestOmpRuntime } from "./lib/omp-runtime-integrity.ts";

const root = resolve(import.meta.dir, "..");
const requestedBinary = process.env.CEDIA_OMP_BINARY ?? join(root, "dist/omp/omp");
const executable = resolve(requestedBinary);
const fixture = join(root, "packages/omp-adapter/test/fixtures/cedia-virtual-ui-extension.ts");
const sourceReference = "fc671eba383f2a7208500836673b485c0dc7073d";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	check(!!value && typeof value === "object" && !Array.isArray(value), message);
	return value as Record<string, unknown>;
}

function textValue(value: unknown): string {
	return typeof value === "string" ? value : "";
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

async function delay(ms: number): Promise<void> {
	await new Promise<void>(resolveDelay => setTimeout(resolveDelay, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function strictEnv(cwd: string, virtual = true, autoReleaseMs?: number): NodeJS.ProcessEnv {
	return {
		PATH: `${dirname(executable)}${delimiter}/usr/bin${delimiter}/bin`,
		HOME: cwd,
		PI_CODING_AGENT_DIR: cwd,
		PI_NO_PTY: "1",
		PI_NOTIFICATIONS: "off",
		TERM: "xterm-256color",
		...(virtual ? { CEDIA_RPC_VIRTUAL_UI: "1" } : {}),
		...(autoReleaseMs === undefined ? {} : { CEDIA_VIRTUAL_UI_AUTO_RELEASE_MS: String(autoReleaseMs) }),
	};
}

function frameSummary(frame: OmpFrame): Record<string, unknown> {
	const type = textValue(frame.type);
	if (type === "cedia_terminal_output") {
		const data = textValue(frame.data);
		return {
			type,
			terminalId: textValue(frame.terminalId),
			sequence: typeof frame.sequence === "number" ? frame.sequence : -1,
			bytes: Buffer.byteLength(data, "utf8"),
			markers: [
				"cedia-virtual-startup",
				"cedia-virtual-command",
				"cedia-virtual-pty-output",
			].filter(marker => data.includes(marker)),
		};
	}
	if (type === "extension_ui_request") {
		return { type, method: textValue(frame.method), message: textValue(frame.message).slice(0, 96) };
	}
	if (type === "tool_execution_end") {
		const result = frame.result && typeof frame.result === "object" ? record(frame.result) : undefined;
		const details = result?.details && typeof result.details === "object" ? record(result.details) : undefined;
		return {
			type,
			toolName: textValue(frame.toolName),
			isError: frame.isError === true || result?.isError === true,
			terminalId: details && typeof details.terminalId === "string" ? details.terminalId : undefined,
			cancelled: details?.cancelled === true,
			timedOut: details?.timedOut === true,
		};
	}
	if (type === "agent_end") return { type, isTerminal: frame.isTerminal !== false };
	if (type === "response") return { type, command: textValue(frame.command), success: frame.success === true };
	if (type === "prompt_result") return { type, id: textValue(frame.id), agentInvoked: frame.agentInvoked === true };
	if (type === "cedia_terminal_open" || type === "cedia_terminal_close") {
		return { type, terminalId: textValue(frame.terminalId), reason: textValue(frame.reason) };
	}
	return { type };
}

async function writeModelsConfig(cwd: string, port: number): Promise<void> {
	await writeFile(
		join(cwd, "models.yml"),
		`providers:\n  cedia-fixture:\n    baseUrl: http://127.0.0.1:${port}/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: cedia-scripted-model\n        name: Cedia virtual UI loopback fixture\n        api: openai-completions\n        reasoning: false\n        input: [text]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 128000\n        maxTokens: 4096\n`,
	);
}

type FixtureTurn = "pty" | "abort";

class FixtureModelServer {
	readonly server = createServer((request, response) => void this.#handle(request, response));
	port = 0;
	turn: FixtureTurn | undefined;
	turnRequests = 0;
	totalRequests = 0;
	toolCalls = 0;
	private readonly errors: string[] = [];

	async listen(): Promise<void> {
		await new Promise<void>((resolveListen, reject) => {
			this.server.once("error", reject);
			this.server.listen(0, "127.0.0.1", () => {
				this.server.off("error", reject);
				const address = this.server.address();
				check(address && typeof address !== "string", "Fixture model server has no address");
				this.port = address.port;
				resolveListen();
			});
		});
	}

	setTurn(turn: FixtureTurn): void {
		this.turn = turn;
		this.turnRequests = 0;
	}

	get failure(): Error | undefined {
		return this.errors.length > 0 ? new Error(this.errors.join("; ")) : undefined;
	}

	close(): Promise<void> {
		return new Promise(resolveClose => this.server.close(() => resolveClose()));
	}

	async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			check(request.method === "POST" && request.url === "/v1/chat/completions", "Unexpected fixture model route");
			let body = "";
			for await (const chunk of request) {
				body += String(chunk);
				check(Buffer.byteLength(body, "utf8") <= 2_000_000, "Fixture model request exceeded bound");
			}
			const payload = record(JSON.parse(body), "Fixture model body is not an object");
			check(payload.model === "cedia-scripted-model", "Unexpected fixture model");
			check(payload.stream === true, "Fixture model must stream");
			check(Array.isArray(payload.tools), "OMP did not send an effective tool list");
			this.totalRequests++;
			this.turnRequests++;
			check(this.totalRequests <= 12, "Unexpected fixture model retry/loop");

			const useTool = this.turn !== undefined && this.turnRequests === 1;
			if (useTool) {
				const tools = payload.tools as unknown[];
				const bash = tools.some(tool => {
					const fn = record(tool).function;
					return fn && typeof fn === "object" && !Array.isArray(fn) && record(fn).name === "bash";
				});
				check(bash, "Fixture bash wrapper was not advertised to the model");
				this.toolCalls++;
			}

			const call = this.turn === "pty"
				? { command: "printf 'cedia-virtual-pty-output\\n'", pty: true }
				: { command: "sleep 30", pty: true };
			const chunk = (delta: unknown, finishReason: string | null) => ({
				id: `cedia-virtual-ui-fixture-${this.totalRequests}`,
				object: "chat.completion.chunk",
				created: 0,
				model: "cedia-scripted-model",
				choices: [{ index: 0, delta, finish_reason: finishReason }],
			});
			const events = useTool
				? [
						chunk({ role: "assistant", tool_calls: [{ index: 0, id: `cedia-virtual-call-${this.totalRequests}`, type: "function", function: { name: "bash", arguments: JSON.stringify(call) } }] }, null),
						chunk({}, "tool_calls"),
					]
				: [chunk({ role: "assistant", content: "Cedia virtual UI loopback completed." }, "stop")];
			response.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
			response.end([...events, "[DONE]"].map(event => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join(""));
		} catch (error) {
			this.errors.push(error instanceof Error ? error.message : String(error));
			if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
			response.end("fixture model rejected request");
		}
	}
}

async function waitForFrame(
	frames: OmpFrame[],
	predicate: (frame: OmpFrame) => boolean,
	label: string,
	timeoutMs = 10_000,
): Promise<OmpFrame> {
	const existing = frames.find(predicate);
	if (existing) return existing;
	return withTimeout(
		new Promise<OmpFrame>((resolveFrame, rejectFrame) => {
			const deadline = Date.now() + timeoutMs;
			const timer = setInterval(() => {
				const next = frames.find(predicate);
				if (next) {
					clearInterval(timer);
					resolveFrame(next);
				} else if (Date.now() >= deadline) {
					clearInterval(timer);
					rejectFrame(new Error(`Timed out: ${label}`));
				}
			}, 10);
		}),
		timeoutMs + 100,
		label,
	);
}

async function waitForOutput(frames: OmpFrame[], marker: string, label: string): Promise<OmpFrame> {
	return waitForFrame(
		frames,
		frame => frame.type === "cedia_terminal_output" && textValue(frame.data).includes(marker),
		label,
	);
}

function frameTerminalId(frame: OmpFrame | undefined): string {
	const id = frame && typeof frame.terminalId === "string" ? frame.terminalId : "";
	check(id.length > 0, "Missing virtual terminal id");
	return id;
}

async function startClient(cwd: string, extension: string): Promise<{ client: OmpRpcClient; frames: OmpFrame[] }> {
	const frames: OmpFrame[] = [];
	const client = await OmpRpcClient.start({
		executable,
		cwd,
		args: ["--no-session", "--no-skills", "--no-rules", "--no-extensions", "--no-title", "--cwd", cwd, "--trusted-extension", extension],
		env: strictEnv(cwd),
		readyTimeoutMs: 20_000,
		requestTimeoutMs: 20_000,
		onFrame: frame => frames.push(frame),
	});
	return { client, frames };
}

type RawRpcFrame = Record<string, unknown>;

/**
 * Start one OMP process without the adapter's eager protocol negotiation. This
 * is intentionally limited to the startup ordering probe: Cedia must tolerate
 * a prompt arriving after `ready` but before the client has negotiated its
 * virtual terminal. The normal adapter cannot express that ordering because it
 * negotiates protocol before returning from `start()`.
 */
function startRawClient(cwd: string, extension: string): {
	child: ChildProcessWithoutNullStreams;
	frames: RawRpcFrame[];
	lines: ReturnType<typeof createInterface>;
} {
	const child = spawnProcess(
		executable,
		[
			"--mode",
			"rpc-ui",
			"--no-session",
			"--no-skills",
			"--no-rules",
			"--no-extensions",
			"--no-title",
			"--cwd",
			cwd,
			"--trusted-extension",
			extension,
		],
		{ cwd, env: strictEnv(cwd), stdio: ["pipe", "pipe", "pipe"] },
	);
	const frames: RawRpcFrame[] = [];
	const lines = createInterface({ input: child.stdout });
	lines.on("line", line => {
		try {
			const parsed: unknown = JSON.parse(line);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) frames.push(parsed as RawRpcFrame);
		} catch {
			// The probe reports a missing response through waitForRawFrame; retain
			// stderr for the caller's failure diagnostics rather than throwing from
			// the readline callback.
		}
	});
	return { child, frames, lines };
}

function sendRawCommand(child: ChildProcessWithoutNullStreams, frame: Record<string, unknown>): void {
	check(!child.stdin.destroyed && !child.stdin.writableEnded, "Raw OMP stdin is unavailable");
	child.stdin.write(`${JSON.stringify(frame)}\n`, "utf8");
}

async function waitForRawFrame(
	frames: RawRpcFrame[],
	predicate: (frame: RawRpcFrame) => boolean,
	label: string,
	timeoutMs = 10_000,
): Promise<RawRpcFrame> {
	const existing = frames.find(predicate);
	if (existing) return existing;
	return withTimeout(
		new Promise<RawRpcFrame>((resolveFrame, rejectFrame) => {
			const deadline = Date.now() + timeoutMs;
			const timer = setInterval(() => {
				const next = frames.find(predicate);
				if (next) {
					clearInterval(timer);
					resolveFrame(next);
				} else if (Date.now() >= deadline) {
					clearInterval(timer);
					rejectFrame(new Error(`Timed out: ${label}`));
				}
			}, 10);
		}),
		timeoutMs + 100,
		label,
	);
}

async function closeRawClient(child: ChildProcessWithoutNullStreams, lines: ReturnType<typeof createInterface>): Promise<void> {
	try {
		if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
	} catch {
		// Continue waiting for the child if stdin has already closed.
	}
	try {
		await withTimeout(
			new Promise<void>(resolveExit => {
				if (child.exitCode !== null || child.signalCode !== null) {
					resolveExit();
					return;
				}
				child.once("close", () => resolveExit());
			}),
			4_000,
			"raw OMP process exit",
		);
	} catch (error) {
		try {
			child.kill("SIGKILL");
		} catch {
			// The process may have exited between the timeout and kill.
		}
		throw error;
	} finally {
		lines.close();
		if (!child.killed && child.exitCode === null && child.signalCode === null) {
			try {
				child.kill("SIGKILL");
			} catch {
				// Best effort cleanup for a failed probe.
			}
		}
	}
}

async function probePromptBeforeNegotiation(cwd: string, extension: string, checks: string[]): Promise<void> {
	const { child, frames, lines } = startRawClient(cwd, extension);
	try {
		await waitForRawFrame(frames, frame => frame.type === "ready", "raw OMP ready frame");
		// Give initializeExtensions a turn to enter the fixture's startup custom
		// interaction. The gate remains unresolved until we negotiate and answer it.
		await delay(20);
		sendRawCommand(child, {
			id: "cedia-pre-negotiate-prompt",
			type: "prompt",
			message: "this prompt must not enter the model before virtual UI startup",
		});
		sendRawCommand(child, {
			id: "cedia-pre-negotiate-protocol",
			type: "negotiate_protocol",
			protocolVersion: 2,
		});
		const prompt = await waitForRawFrame(frames, frame => frame.id === "cedia-pre-negotiate-prompt", "pre-negotiation prompt response");
		check(prompt.success === false && prompt.code === "cedia_initializing", `Pre-negotiation prompt outcome was ${JSON.stringify(prompt)}`);
		const protocol = await waitForRawFrame(frames, frame => frame.id === "cedia-pre-negotiate-protocol", "raw protocol negotiation response");
		check(protocol.success === true, `Raw protocol negotiation failed: ${JSON.stringify(protocol)}`);
		checks.push("prompt-before-protocol-negotiation-is-rejected-while-startup-custom-is-pending");

		sendRawCommand(child, {
			id: "cedia-pre-negotiate-terminal",
			type: "cedia_terminal_negotiate",
			payload: { version: 1, cols: 40, rows: 8 },
		});
		const open = await waitForRawFrame(frames, frame => frame.type === "cedia_terminal_open", "raw virtual terminal open");
		const terminalId = textValue(open.terminalId);
		check(terminalId.length > 0, "Raw virtual terminal open omitted terminalId");
		await waitForRawFrame(frames, frame => frame.type === "cedia_terminal_output" && textValue(frame.data).includes("cedia-virtual-startup"), "raw startup custom output");
		sendRawCommand(child, {
			id: "cedia-pre-negotiate-input",
			type: "cedia_terminal_input",
			payload: { terminalId, data: "cedia-virtual-startup-ok" },
		});
		const input = await waitForRawFrame(frames, frame => frame.id === "cedia-pre-negotiate-input", "raw startup input response");
		check(input.success === true, `Raw startup input failed: ${JSON.stringify(input)}`);
		await waitForRawFrame(
			frames,
			frame => frame.type === "extension_ui_request" && frame.method === "notify" && frame.message === "cedia-virtual-startup-complete",
			"raw startup custom completion",
		);
		checks.push("startup-custom-input-still-works-after-pre-negotiation-prompt");
	} finally {
		await closeRawClient(child, lines);
	}
}

async function probeVirtualHandshake(cwd: string, extension: string, checks: string[]): Promise<void> {
	const { client, frames } = await startClient(cwd, extension);
	try {
		check(client.readyFrame?.cediaVirtualUiVersion === 1, "Patched OMP did not advertise Cedia virtual UI v1");
		checks.push("subprocess-ready-advertises-virtual-ui-v1");
		const negotiated = await client.requestCedia("cedia_terminal_negotiate", { version: 1, cols: 40, rows: 8 });
		const terminalId = frameTerminalId(await waitForFrame(frames, frame => frame.type === "cedia_terminal_open", "virtual terminal open"));
		check(record(negotiated.data).version === 1, "Virtual terminal negotiate ACK has wrong version");
		checks.push("negotiate-opens-virtual-terminal");
		await waitForOutput(frames, "cedia-virtual-startup", "session_start custom output");
		await client.requestCedia("cedia_terminal_input", { terminalId, data: "cedia-virtual-startup-ok" });
		await waitForFrame(frames, frame => frame.type === "extension_ui_request" && frame.method === "notify" && frame.message === "cedia-virtual-startup-complete", "session_start custom resolves");
		checks.push("session-start-custom-waits-for-negotiated-input");
		await waitForOutput(frames, "cedia-virtual-editor", "mounted virtual CustomEditor draft");
		await client.requestCedia("cedia_terminal_input", { terminalId, data: "!" });
		await waitForFrame(
			frames,
			frame =>
				frame.type === "extension_ui_request" &&
				frame.method === "notify" &&
				frame.message === "cedia-virtual-editor-text:cedia-virtual-editor!",
			"virtual CustomEditor input/getText",
		);
		checks.push("virtual-custom-editor-renders-and-accepts-input");

		const commands = record((await client.request("get_available_commands")).data).commands;
		check(Array.isArray(commands) && commands.some(command => record(command).name === "cedia-virtual-ui-command"), "Trusted virtual fixture command was not loaded");
		const ack = await client.request("prompt", { message: "/cedia-virtual-ui-command" });
		check(typeof ack.id === "string", "Prompt ACK did not include a correlation id");
		await waitForOutput(frames, "cedia-virtual-command", "slash command custom output");
		await client.requestCedia("cedia_terminal_input", { terminalId, data: "cedia-virtual-command-ok" });
		const result = await waitForFrame(frames, frame => frame.type === "prompt_result" && frame.id === ack.id, "slash command prompt result");		check(result.agentInvoked === false, "Local virtual UI slash command unexpectedly invoked a model");
		await waitForFrame(frames, frame => frame.type === "extension_ui_request" && frame.method === "notify" && frame.message === "cedia-virtual-command-complete", "slash command custom completion");
		checks.push("slash-custom-command-completes-without-model");
	} finally {
		await client.close();
	}
}

async function probeFirstRunWithoutModel(extension: string, checks: string[]): Promise<void> {
	const cwd = await mkdtemp(join(tmpdir(), "cedia-first-run-"));
	let client: OmpRpcClient | undefined;
	try {
		const started = await startClient(cwd, extension); client = started.client;
		const frames = started.frames;
		await client.requestCedia("cedia_terminal_negotiate", { version: 1, cols: 80, rows: 24 });
		const terminalId = frameTerminalId(await waitForFrame(frames, frame => frame.type === "cedia_terminal_open", "first-run terminal"));
		await waitForOutput(frames, "cedia-virtual-startup", "first-run startup UI");
		await client.requestCedia("cedia_terminal_input", { terminalId, data: "cedia-virtual-startup-ok" });
		await waitForFrame(frames, frame => frame.type === "extension_ui_request" && frame.message === "cedia-virtual-startup-complete", "first-run initialized");
		const before = record((await client.request("get_state")).data);
		check(before.model == null, "First-run fixture unexpectedly has a configured model");
		const ack = await client.request("prompt", { message: "/login" });
		check(record(ack.data).agentInvoked === false, "Login selector must not invoke a model");
		await waitForOutput(frames, "Select provider to login", "first-run provider selector");
		await client.requestCedia("cedia_terminal_input", { terminalId, data: "\u001b" });
		await client.request("get_state");
		check(!frames.some(frame => frame.type === "agent_start"), "First-run setup unexpectedly started inference");
		checks.push("first-run-without-model-opens-native-provider-selector-and-cancels");
	} finally { await client?.close(); await rm(cwd, { recursive: true, force: true }); }
}

async function probePtyAndAbort(cwd: string, extension: string, model: FixtureModelServer, checks: string[]): Promise<void> {
	await writeModelsConfig(cwd, model.port);
	const { client, frames } = await startClient(cwd, extension);
	try {
		const negotiated = await client.requestCedia("cedia_terminal_negotiate", { version: 1, cols: 40, rows: 8 });
		const terminalId = frameTerminalId(await waitForFrame(frames, frame => frame.type === "cedia_terminal_open", "PTY probe virtual terminal open"));
		check(record(negotiated.data).version === 1, "PTY probe virtual terminal negotiate failed");
		await waitForOutput(frames, "cedia-virtual-startup", "PTY probe session_start custom output");
		await client.requestCedia("cedia_terminal_input", { terminalId, data: "cedia-virtual-startup-ok" });
		await waitForFrame(frames, frame => frame.type === "extension_ui_request" && frame.method === "notify" && frame.message === "cedia-virtual-startup-complete", "PTY probe session_start custom completion");
		await client.request("set_auto_retry", { enabled: false });
		await client.request("set_auto_compaction", { enabled: false });
		await client.request("set_model", { provider: "cedia-fixture", modelId: "cedia-scripted-model" });
		const state = record((await client.request("get_state")).data);
		const tools = Array.isArray(state.dumpTools) ? state.dumpTools : [];
		check(tools.some(tool => record(tool).name === "bash"), "Effective OMP tool registry lacks the bash wrapper");
		checks.push("fixture-bash-wrapper-advertised");

		model.setTurn("pty");
		const ptyPrompt = await client.request("prompt", { message: "Run the deterministic PTY fixture" });
		const ptyStart = await waitForFrame(frames, frame => frame.type === "tool_execution_start" && frame.toolName === "bash", "PTY bash tool start");
		check(record(ptyStart.args).pty === true, "Fixture model did not request bash pty:true");
		const terminalOutputBeforePty = frames.filter(frame => frame.type === "cedia_terminal_output").length;
		const ptyEnd = await waitForFrame(frames, frame => frame.type === "tool_execution_end" && frame.toolName === "bash", "PTY bash tool end");
		const ptyResult = frameSummary(ptyEnd);
		const ptyContent = ptyEnd.result && typeof ptyEnd.result === "object" ? record(ptyEnd.result).content : undefined;
		check(JSON.stringify(ptyContent ?? "").includes("cedia-virtual-pty-output"), "PTY fixture output was not returned");
		check(frames.filter(frame => frame.type === "cedia_terminal_output").length > terminalOutputBeforePty, "PTY bash did not render through the negotiated virtual terminal");
		check(ptyResult.isError === false, "Native PTY fixture returned an error");
		await waitForFrame(frames, frame => frame.type === "agent_end" && frame.isTerminal !== false, "PTY agent end");
		check(typeof ptyPrompt.id === "string", "PTY prompt ACK missing id");
		check(!model.failure, model.failure?.message ?? "Fixture model failed during PTY turn");
		checks.push("builtin-bash-pty-uses-omp-native-pty");

		model.setTurn("abort");
		const abortFrameStart = frames.length;
		const abortPrompt = await client.request("prompt", { message: "Run the deterministic abort fixture" });
		const abortStart = await waitForFrame(frames, frame => frames.indexOf(frame) >= abortFrameStart && frame.type === "tool_execution_start" && frame.toolName === "bash", "abort bash tool start");
		check(typeof abortStart.toolCallId === "string", "Abort tool call lacks correlation ID");
		await delay(200);
		try {
			await client.request("abort", {}, { timeoutMs: 5_000 });
		} catch (error) {
			console.error("ABORT_ACK_ERROR", error instanceof Error ? error.message : String(error), "STDERR", client.stderr.slice(-2000));
			console.error("ABORT_FRAMES", JSON.stringify(frames.slice(-30).map(frameSummary)).slice(0, 12000));
			throw error;
		}
		const abortEnd = await waitForFrame(
			frames,
			frame => frames.indexOf(frame) >= abortFrameStart && frame.type === "tool_execution_end" && frame.toolName === "bash" && frame.toolCallId === abortStart.toolCallId,
			"aborted bash tool end",
		);
		const abortResult = frameSummary(abortEnd);
		if (abortResult.cancelled !== true && abortResult.isError !== true) console.error("ABORT_END", JSON.stringify(abortEnd).slice(0, 4000));
		check(abortResult.cancelled === true || abortResult.isError === true, "OMP abort did not mark the PTY tool as cancelled/error");
		await waitForFrame(frames, frame => frames.indexOf(frame) >= abortFrameStart && frame.type === "agent_end" && frame.isTerminal !== false, "aborted agent end");
		check(typeof abortPrompt.id === "string", "Abort prompt ACK missing id");
		checks.push("abort-cancels-native-pty-before-completion");
	} finally {
		await client.close();
	}
}

async function probeEofClose(cwd: string, extension: string, checks: string[]): Promise<void> {
	// Use the raw process here so the prompt and stdin EOF can be delivered in
	// one read. OmpRpcClient.close() intentionally rejects client-side pending
	// requests before ending stdin, which would hide whether the server had
	// already accepted the queued prompt behind the startup custom interaction.
	const { child, frames, lines } = startRawClient(cwd, extension);
	try {
		await waitForRawFrame(frames, frame => frame.type === "ready", "EOF probe raw OMP ready frame");
		await delay(20);
		sendRawCommand(child, {
			id: "cedia-eof-protocol",
			type: "negotiate_protocol",
			protocolVersion: 2,
		});
		const protocol = await waitForRawFrame(frames, frame => frame.id === "cedia-eof-protocol", "EOF probe protocol negotiation response");
		check(protocol.success === true, `EOF probe protocol negotiation failed: ${JSON.stringify(protocol)}`);
		sendRawCommand(child, {
			id: "cedia-eof-terminal",
			type: "cedia_terminal_negotiate",
			payload: { version: 1, cols: 40, rows: 8 },
		});
		const open = await waitForRawFrame(frames, frame => frame.type === "cedia_terminal_open", "EOF probe virtual terminal open");
		const terminalId = textValue(open.terminalId);
		check(terminalId.length > 0, "EOF probe virtual terminal open omitted terminalId");
		await waitForRawFrame(frames, frame => frame.type === "cedia_terminal_output" && textValue(frame.data).includes("cedia-virtual-startup"), "EOF probe startup custom output");

		// This ordinary prompt is accepted while session_start custom is waiting.
		// Send EOF immediately afterwards, before waiting for its response, so the
		// dispatcher must drain it while the active virtual terminal is being closed.
		sendRawCommand(child, {
			id: "cedia-eof-queued-prompt",
			type: "prompt",
			message: "queued while startup custom waits",
		});
		const startedAt = Date.now();
		child.stdin.end();
		await withTimeout(
			new Promise<void>(resolveExit => {
				if (child.exitCode !== null || child.signalCode !== null) {
					resolveExit();
					return;
				}
				child.once("close", () => resolveExit());
			}),
			4_000,
			"bounded OMP EOF close",
		);
		check(Date.now() - startedAt < 4_000, "OMP close exceeded bounded EOF deadline");
		check(child.signalCode === null, `OMP EOF probe required a signal: ${String(child.signalCode)}`);
		check(child.exitCode === 0, `OMP EOF probe exited with code ${String(child.exitCode)}`);
		check(
			frames.some(frame => frame.type === "cedia_terminal_close" && frame.reason === "rpc_client_disconnected"),
			"Virtual terminal did not close on client EOF",
		);
		checks.push("client-eof-closes-pending-custom-ui-and-queued-prompt-without-kill");
	} finally {
		await closeRawClient(child, lines);
	}
}

async function probeHostBootstrap(cwd: string, extension: string, checks: string[]): Promise<void> {
	const stateDir = await mkdtemp(join(tmpdir(), "cedia-virtual-host-"));
	let store: DurableStore | undefined;
	let host: CediaHost | undefined;
	try {
		store = DurableStore.open({ stateDir });
		const project = store.createProject({ path: cwd, name: "Cedia virtual UI fixture" });
		const editors = new EditorConnections();
		editors.register("virtual-probe-editor", [cwd]);
		const events: OmpFrame[] = [];
		host = new CediaHost({
			store,
			stateDir,
			ompExecutable: executable,
			ompEnv: strictEnv(cwd),
			ompArgs: ["--no-skills", "--no-rules", "--no-extensions", "--trusted-extension", extension],
			virtualUi: true,
			editors,
			onEvent: event => {
				const frame = event.frame && typeof event.frame === "object" ? record(event.frame) : {};
				events.push(frame);
			},
		});
		const created = host.createSession(project.id, "Virtual UI host bootstrap");
		let resolved = false;
		const start = host.startSession(created.id).then(value => {
			resolved = true;
			return value;
		});
		const open = await waitForFrame(events, frame => frame.type === "cedia_terminal_open", "host virtual terminal open");
		const terminalId = frameTerminalId(open);
		await delay(250);
		const startResolvedWhileCustomWaited = resolved;
		const current = store.getSession(created.id);
		check(current, "Host fixture session disappeared");
		const input = await host.command(created.id, "virtual-probe-device", {
			commandId: "virtual-probe-terminal-input-1",
			incarnation: current.incarnation,
			command: "cedia_terminal_input",
			payload: { terminalId, data: "cedia-virtual-startup-ok" },
		});
		check(input.status === "completed", `Host terminal input command was ${input.status}`);
		const started = await withTimeout(start, 5_000, "CediaHost startSession bootstrap");
		check(started.id === created.id, "CediaHost started a different session");
		check(resolved, "CediaHost startSession did not resolve");
		check(events.some(frame => frame.type === "cedia_terminal_output"), "Host bootstrap did not retain terminal output events");
		checks.push(startResolvedWhileCustomWaited ? "host-bootstrap-concurrent-get-state-and-host-tools" : "host-bootstrap-waited-for-custom-ui");
		checks.push("host-command-delivers-virtual-terminal-input");

		// The host keeps a headless screen (libghostty-vt) beside the frame stream, so a
		// client that attaches later can render it instead of replaying chunk history.
		const openCols = typeof open.cols === "number" ? open.cols : -1;
		const openRows = typeof open.rows === "number" ? open.rows : -1;
		const checkpoint = host.terminalSnapshots(created.id).find(item => item.terminalId === terminalId);
		check(checkpoint, "Host kept no terminal checkpoint for the negotiated virtual terminal");
		check(checkpoint.cols === openCols && checkpoint.rows === openRows, `Host checkpoint is ${checkpoint.cols}x${checkpoint.rows}, open frame was ${openCols}x${openRows}`);
		check(checkpoint.lines.some(line => line.includes("cedia-virtual-startup")), `Host checkpoint does not show the startup output: ${JSON.stringify(checkpoint.lines)}`);
		check(checkpoint.lastSequence >= 0, "Host checkpoint recorded no output sequence");
		checks.push("host-terminal-checkpoint-matches-omp-frames");
		await host.stopSession(created.id);
	} finally {
		await host?.close().catch(() => {});
		store?.close();
		await rm(stateDir, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	check(await exists(executable), `OMP executable not found: ${executable}`);
	const attestation = attestOmpRuntime(root, executable);
	check(await exists(fixture), `Virtual UI trusted fixture not found: ${fixture}`);
	const cwd = await mkdtemp(join(tmpdir(), "cedia-virtual-ui-"));
	const model = new FixtureModelServer();
	const checks: string[] = [];
	const frameCounts: Record<string, number> = {};
	try {
		await model.listen();
		await writeModelsConfig(cwd, model.port);
		await probePromptBeforeNegotiation(cwd, fixture, checks);
		await probeVirtualHandshake(cwd, fixture, checks);
		await probeFirstRunWithoutModel(fixture, checks);
		await probePtyAndAbort(cwd, fixture, model, checks);
		await probeEofClose(cwd, fixture, checks);
		await probeHostBootstrap(cwd, fixture, checks);
		check(JSON.stringify(attestOmpRuntime(root, executable)) === JSON.stringify(attestation), "Runtime changed during probe");
		const receipt = {
			date: new Date().toISOString(),
			executable,
			sourceReference,
			...attestation,
			fixtureSha256: createHash("sha256").update(await readFile(fixture)).digest("hex"),
			hostRuntime: { name: process.versions.bun ? "bun" : "node", version: process.versions.bun ?? process.versions.node },
			model: { kind: "loopback-scripted", requests: model.totalRequests, toolCalls: model.toolCalls },
			checks,
			limitations: "No external provider inference, visual Mac/iPhone rendering, cellular transport, signing, or production editor bridge. The host bootstrap check records whether startSession can complete while a session_start custom UI is pending; input is sent through CediaHost's durable command path.",
		};
		const output = process.env.CEDIA_SMOKE_RECEIPT;
		if (output) {
			await writeFile(resolve(output), JSON.stringify(receipt, null, 2) + "\n");
		}
		console.log(JSON.stringify(receipt, null, 2));
	} finally {
		await model.close().catch(() => {});
		await rm(cwd, { recursive: true, force: true });
	}
}

await main();
