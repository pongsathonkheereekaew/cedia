import { afterEach, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { OmpClientStateError, OmpProtocolError, OmpRequestTimeoutError, OmpRpcClient } from "../src/client.ts";
import { NdjsonFrameDecoder, RpcFrameDecoder } from "../src/framing.ts";
import { RPC_COMMAND_TYPES, MAX_RPC_FRAME_BYTES, MAX_RPC_REASSEMBLED_BYTES } from "../src/types.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake-omp-launcher", import.meta.url));
const fixtureNode = process.env.CEDIA_FIXTURE_NODE ?? process.execPath;
const children: OmpRpcClient[] = [];

async function start(mode = "normal", options: Record<string, unknown> = {}): Promise<OmpRpcClient> {
	const client = await OmpRpcClient.start({
		executable: fixture,
		args: [],
		env: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_OMP_MODE: mode },
		readyTimeoutMs: 2_000,
		requestTimeoutMs: 1_000,
		shutdownGraceMs: 50,
		...options,
	});
	children.push(client);
	return client;
}

function processStillAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
		throw error;
	}
}

afterEach(async () => {
	for (const child of children.splice(0)) await child.close();
});

describe("OMP protocol framing", () => {
	it("reassembles split UTF-8 JSONL without changing fields", () => {
		const decoder = new NdjsonFrameDecoder();
		const encoded = Buffer.from(`${JSON.stringify({ type: "notice", text: "สวัสดี" })}\n`, "utf8");
		const result = [...decoder.push(encoded.subarray(0, 3)), ...decoder.push(encoded.subarray(3))];
		expect(result).toEqual([{ type: "notice", text: "สวัสดี" }]);
	});

	it("rejects an oversized physical frame before JSON parsing", () => {
		const decoder = new NdjsonFrameDecoder();
		expect(() => decoder.push(Buffer.alloc(MAX_RPC_FRAME_BYTES + 1, 0x78))).toThrow(/1 MiB/);
	});

	it("decodes coalesced records, tolerates blank lines, and finishes without a trailing newline", () => {
		// #1306 acceptance, CEDIA side: split header/body at every byte boundary,
		// coalesced records in one callback, malformed frames fail loudly.
		const decoder = new NdjsonFrameDecoder();
		const first = decoder.push(Buffer.from('{"type":"a"}\n\n{"type":"b"}\n', "utf8"));
		expect(first).toEqual([{ type: "a" }, {}, { type: "b" }]);
		expect(() => decoder.push(Buffer.from('{"type":\n', "utf8"))).toThrow(/valid JSON/);
		const tail = new NdjsonFrameDecoder();
		expect(tail.push(Buffer.from('{"type":"c"}', "utf8"))).toEqual([]);
		expect(tail.finish()).toEqual([{ type: "c" }]);
	});
	it("validates protocol-v2 chunk sequence and reassembled size", () => {
		const decoder = new RpcFrameDecoder();
		const json = JSON.stringify({ type: "future_event", preserved: "yes", payload: "x".repeat(MAX_RPC_FRAME_BYTES) });
		const bytes = Buffer.from(json, "utf8");
		const padded = bytes;
		const chunkSize = 256 * 1024;
		const count = Math.ceil(padded.byteLength / chunkSize);
		let result: object | undefined;
		for (let index = 0; index < count; index++) {
			result = decoder.push({
				type: "rpc_chunk",
				chunkId: "test",
				index,
				count,
				byteLength: padded.byteLength,
				data: padded.subarray(index * chunkSize, (index + 1) * chunkSize).toString("base64"),
			});
		}
		expect(result).toEqual({ type: "future_event", preserved: "yes", payload: "x".repeat(MAX_RPC_FRAME_BYTES) });
		expect(() => decoder.push({ type: "rpc_chunk", chunkId: "bad", index: 1, count: 2, byteLength: MAX_RPC_FRAME_BYTES, data: "eA==" })).toThrow(
			/start at index 0/,
		);
		expect(MAX_RPC_REASSEMBLED_BYTES).toBe(64 * 1024 * 1024);
	});
});

describe("OmpRpcClient", () => {
	it("exports the exact pinned 47-command contract", async () => {
		const inventory = JSON.parse(
			await readFile(new URL("../../../docs/maintenance/evidence/omp-complete-scope-2026-09-29/rpc.json", import.meta.url), "utf8"),
		) as { commands: { name: string }[] };
		const stock = inventory.commands.map(row => row.name).filter(name => !name.startsWith("cedia_"));
		expect(new Set([...RPC_COMMAND_TYPES] as string[])).toEqual(new Set(stock));
		expect(RPC_COMMAND_TYPES).toHaveLength(47);
	});

	it("requires rpc-ui ready, negotiates v2, and preserves unknown frames", async () => {
		const frames: Record<string, unknown>[] = [];
		const client = await OmpRpcClient.start({
			executable: fixture,
			args: [],
			env: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_OMP_MODE: "normal" },
			readyTimeoutMs: 2_000,
			requestTimeoutMs: 1_000,
			onFrame: frame => frames.push(frame),
		});
		children.push(client);
		expect(client.protocolVersion).toBe(2);
		expect(client.readyFrame?.supportedProtocolVersions).toEqual([1, 2]);
		expect(frames.some(frame => frame.type === "ready")).toBe(true);
		const ack = await client.request("get_state");
		expect(ack.success).toBe(true);
		expect(ack.command).toBe("get_state");
		expect((ack.data as { fixture: string }).fixture).toBe("get_state");
	});

	it("gates cedia_plan on its ready marker and forwards its state frames", async () => {
		const frames: Record<string, unknown>[] = [];
		const client = await OmpRpcClient.start({
			executable: fixture,
			args: [],
			env: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_OMP_MODE: "plan" },
			readyTimeoutMs: 2_000,
			requestTimeoutMs: 1_000,
			onFrame: frame => frames.push(frame),
		});
		children.push(client);
		expect(client.readyFrame?.cediaPlanVersion).toBe(1);
		const ack = await client.requestCedia("cedia_plan", { command: { op: "read" } });
		expect(ack.data).toMatchObject({ changed: false, plan: { workflow: "iterative" } });
		await new Promise(resolve => setTimeout(resolve, 20));
		expect(frames.some(frame => frame.type === "cedia_plan_state")).toBe(true);
		expect(frames.some(frame => frame.type === "cedia_plan_review")).toBe(true);
		expect(frames.some(frame => frame.type === "cedia_plan_review_closed")).toBe(true);
	});

	it("refuses cedia_plan before dispatch when the ready marker is absent", async () => {
		const client = await start("normal");
		await expect(client.requestCedia("cedia_plan", { command: { op: "read" } })).rejects.toThrow(/plan bridge/);
	});

	it("rejects startup when negotiation ACK is coalesced with an invalid chunk", async () => {
		const frames: Record<string, unknown>[] = [];
		const startPromise = OmpRpcClient.start({
			executable: fixture,
			args: [],
			env: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_OMP_MODE: "same-write-invalid-chunk" },
			readyTimeoutMs: 2_000,
			requestTimeoutMs: 1_000,
			onFrame: frame => frames.push(frame),
		});
		await expect(startPromise).rejects.toBeInstanceOf(OmpProtocolError);
		expect(frames.some(frame => frame.type === "ready")).toBe(true);
	});

	it("does not merge ambient environment when the caller supplies env", async () => {
		const previous = process.env.CEDIA_AMBIENT_SENTINEL;
		process.env.CEDIA_AMBIENT_SENTINEL = "present";
		try {
			const client = await start("normal");
			const ack = await client.request("get_state");
			expect((ack.data as { hasAmbientSentinel: boolean }).hasAmbientSentinel).toBe(false);
		} finally {
			if (previous === undefined) delete process.env.CEDIA_AMBIENT_SENTINEL;
			else process.env.CEDIA_AMBIENT_SENTINEL = previous;
		}
	});

	it("accepts a v2 chunk that follows the negotiation ACK in the same write", async () => {
		const frames: Record<string, unknown>[] = [];
		const client = await OmpRpcClient.start({
			executable: fixture,
			args: [],
			env: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_OMP_MODE: "same-write-chunk" },
			readyTimeoutMs: 2_000,
			requestTimeoutMs: 1_000,
			onFrame: frame => frames.push(frame),
		});
		children.push(client);
		await new Promise(resolve => setTimeout(resolve, 50));
		const future = frames.find(frame => frame.type === "future_event");
		expect(future).toBeDefined();
		expect((future as { source: string }).source).toBe("same-write");
	});

	it("correlates out-of-order ACKs and keeps prompt completion as events", async () => {
		const frames: Record<string, unknown>[] = [];
		const client = await OmpRpcClient.start({
			executable: fixture,
			args: [],
			env: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_OMP_MODE: "out-of-order" },
			readyTimeoutMs: 2_000,
			requestTimeoutMs: 1_000,
			onFrame: frame => frames.push(frame),
		});
		children.push(client);
		const slow = client.request("get_state");
		const fast = client.request("get_available_commands");
		const [slowAck, fastAck] = await Promise.all([slow, fast]);
		expect(slowAck.command).toBe("get_state");
		expect(fastAck.command).toBe("get_available_commands");
	});

	it("emits a late same-id error after the first ACK without changing the result", async () => {
		const frames: Record<string, unknown>[] = [];
		const client = await OmpRpcClient.start({
			executable: fixture,
			args: [],
			env: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_OMP_MODE: "late-error" },
			readyTimeoutMs: 2_000,
			requestTimeoutMs: 1_000,
			onFrame: frame => frames.push(frame),
		});
		children.push(client);
		const ack = await client.request("get_state");
		expect(ack.success).toBe(true);
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(frames.filter(frame => frame.type === "response" && frame.command === "get_state")).toHaveLength(2);
	});

	it("rejects command errors and marks dispatched timeout outcomes unknown without retry", async () => {
		const client = await start("timeout");
		const promise = client.request("bash", { command: "never" }, { timeoutMs: 30 });
		await expect(promise).rejects.toMatchObject({
			name: "OmpRequestTimeoutError",
			outcome: "unknown",
			command: "bash",
		});
		await promise.catch(() => {});
		expect(client.phase).toBe("ready");

		const commandErrorClient = await start("failure");
		await expect(commandErrorClient.request("bash", { command: "rejected" })).rejects.toMatchObject({
			name: "OmpCommandError",
			command: "bash",
			code: "fixture_error",
			message: "fixture rejected bash",
		});
	});

	it("does not dispatch an expired command after a queued backpressure write resumes", async () => {
		const client = await start("backpressure", { requestTimeoutMs: 2_000 });
		const oversized = { phases: [{ text: "x".repeat(900_000) }] };
		const first = client.request("set_todos", oversized, { timeoutMs: 2_000 });
		const queued = client.request("bash", { command: "queued-after-backpressure" }, { timeoutMs: 40 });

		const timeout = await queued.catch(error => error);
		expect(timeout).toBeInstanceOf(OmpRequestTimeoutError);
		expect((timeout as OmpRequestTimeoutError).outcome).toBe("not-dispatched");
		expect((timeout as OmpRequestTimeoutError).command).toBe("bash");
		await expect(first).resolves.toMatchObject({ command: "set_todos", success: true });

		const state = await client.request("get_state");
		const receivedTypes = (state.data as { receivedTypes: string[] }).receivedTypes;
		expect(receivedTypes).toContain("set_todos");
		expect(receivedTypes).not.toContain("bash");
	});

	it("requires explicit side-channel responses and does not auto-approve", async () => {
		const frames: Record<string, unknown>[] = [];
		const client = await OmpRpcClient.start({
			executable: fixture,
			args: [],
			env: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_OMP_MODE: "side-channel" },
			readyTimeoutMs: 2_000,
			requestTimeoutMs: 1_000,
			onFrame: frame => frames.push(frame),
		});
		children.push(client);
		const ackPromise = client.request("get_available_commands");
		await new Promise(resolve => setTimeout(resolve, 20));
		const ui = frames.find(frame => frame.type === "extension_ui_request");
		expect(ui).toBeDefined();
		await client.send({ type: "extension_ui_response", id: ui!.id as string, confirmed: true });
		const ack = await ackPromise;
		expect((ack.data as { confirmed: boolean }).confirmed).toBe(true);
	});

	it("bounds stderr and closes cleanly or by escalation", async () => {
		const client = await start("stderr", { stderrLimitBytes: 128 });
		expect(client.getStderr().length).toBeLessThanOrEqual(128);
		await client.close();
		expect(client.phase).toBe("closed");
		await expect(client.request("get_state")).rejects.toBeInstanceOf(OmpClientStateError);

		const stubborn = await start("ignore-eof", { shutdownGraceMs: 10 });
		const started = Date.now();
		await stubborn.close();
		expect(Date.now() - started).toBeLessThan(2_000);
	});

	it("reaps a child that ignores EOF and SIGTERM after SIGKILL", async () => {
		const frames: Record<string, unknown>[] = [];
		const stubborn = await OmpRpcClient.start({
			executable: fixture,
			args: [],
			env: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_OMP_MODE: "stubborn" },
			readyTimeoutMs: 2_000,
			requestTimeoutMs: 1_000,
			shutdownGraceMs: 0,
			onFrame: frame => frames.push(frame),
		});
		children.push(stubborn);
		const pid = frames.find(frame => frame.type === "fixture_pid")?.pid;
		expect(typeof pid).toBe("number");
		expect(processStillAlive(pid as number)).toBe(true);

		await stubborn.close();
		expect(stubborn.phase).toBe("closed");
		expect(processStillAlive(pid as number)).toBe(false);
	});

	it("rejects pending requests when OMP exits abruptly", async () => {
		const client = await start("abrupt-exit");
		await expect(client.request("get_state")).rejects.toBeInstanceOf(OmpProtocolError);
		await client.close();
		expect(client.phase).toBe("closed");
	});

	it("delivers a final ACK and event flushed immediately before child exit", async () => {
		const frames: Record<string, unknown>[] = [];
		let resolveFinal!: (frame: Record<string, unknown>) => void;
		const finalEvent = new Promise<Record<string, unknown>>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("final event was not delivered before timeout")), 1_000);
			resolveFinal = frame => { clearTimeout(timer); resolve(frame); };
		});
		const client = await OmpRpcClient.start({
			executable: fixture,
			args: [],
			env: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_OMP_MODE: "final-flush" },
			readyTimeoutMs: 2_000,
			requestTimeoutMs: 1_000,
			onFrame: frame => {
				frames.push(frame);
				if (frame.type === "final_event") resolveFinal(frame);
			},
		});
		children.push(client);

		const ack = await client.request("get_state");
		expect((ack.data as { fixture: string }).fixture).toBe("final-flush");
		await expect(finalEvent).resolves.toMatchObject({ type: "final_event", marker: "after-ack" });
		expect(frames.some(frame => frame.type === "final_event")).toBe(true);
		await client.close();
		expect(client.phase).toBe("closed");
	});

	it("delivers an event flushed while intentionally closing stdin", async () => {
		const frames: Record<string, unknown>[] = [];
		const client = await start("final-on-eof", { onFrame: (frame: Record<string, unknown>) => frames.push(frame) });
		await client.close();
		expect(frames.some(frame => frame.type === "final_eof_event" && frame.marker === "after-stdin-eof")).toBe(true);
	});
});
