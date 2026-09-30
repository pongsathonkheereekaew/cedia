import readline from "node:readline";

const mode = process.env.CEDIA_FAKE_OMP_MODE ?? "normal";
const frame = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const writeNegotiationAndChunk = (command) => {
	const logical = JSON.stringify({ type: "future_event", source: "same-write", payload: "x".repeat(1024 * 1024) });
	const bytes = Buffer.from(logical, "utf8");
	const chunkSize = 256 * 1024;
	const count = Math.ceil(bytes.byteLength / chunkSize);
	let output = `${JSON.stringify({ type: "response", command: command.type, id: command.id, success: true, data: { protocolVersion: command.protocolVersion } })}\n`;
	for (let index = 0; index < count; index++) {
		output += `${JSON.stringify({
			type: "rpc_chunk",
			chunkId: "same-write",
			index,
			count,
			byteLength: bytes.byteLength,
			data: bytes.subarray(index * chunkSize, (index + 1) * chunkSize).toString("base64"),
		})}\n`;
	}
	process.stdout.write(output);
};
const writeNegotiationAndInvalidChunk = (command) => {
	const output = `${JSON.stringify({
		type: "response",
		command: command.type,
		id: command.id,
		success: true,
		data: { protocolVersion: command.protocolVersion },
	})}\n${JSON.stringify({
		type: "rpc_chunk",
		chunkId: "invalid-after-negotiation",
		index: 1,
		count: 2,
		byteLength: 1024 * 1024,
		data: "eA==",
	})}\n`;
	process.stdout.write(output);
};

frame({
	type: "ready",
	protocolVersion: 1,
	supportedProtocolVersions: [1, 2],
	maxFrameBytes: 1024 * 1024,
	maxReassembledFrameBytes: 64 * 1024 * 1024,
	...(mode === "plan" ? { cediaPlanVersion: 1 } : {}),
	fixture: "cedia-g0",
});
if (mode === "stubborn") frame({ type: "fixture_pid", pid: process.pid });

const response = (command, id, data) => frame({ type: "response", command, id, success: true, ...(data === undefined ? {} : { data }) });
const failure = (command, id, error = "fixture failure") => frame({ type: "response", command, id, success: false, error, code: "fixture_error" });

let pendingUiId;
let sawEof = false;
const receivedTypes = [];

const handle = command => {
	if (!command || typeof command !== "object") return;
	if (typeof command.type === "string") receivedTypes.push(command.type);
	if (command.type === "negotiate_protocol") {
		if (mode === "same-write-chunk") {
			writeNegotiationAndChunk(command);
			return;
		}
		if (mode === "same-write-invalid-chunk") {
			writeNegotiationAndInvalidChunk(command);
			return;
		}
		response(command.type, command.id, { protocolVersion: command.protocolVersion });
		if (mode === "backpressure")
			setImmediate(() => {
				process.stdin.pause();
				setTimeout(() => process.stdin.resume(), 250);
			});
		return;
	}
	if (mode === "plan" && command.type === "cedia_plan") {
		const data = {
			plan: { enabled: true, paused: false, planFilePath: "/tmp/plan.md", workflow: "iterative", reentry: false },
			vibe: { enabled: false },
			review: null,
			changed: false,
		};
		response(command.type, command.id, data);
		frame({ type: "cedia_plan_state", payload: { plan: data.plan, vibe: data.vibe } });
		frame({ type: "cedia_plan_review", payload: { reviewId: 1, title: "Fixture plan", planFilePath: data.plan.planFilePath, planContent: "# Plan", truncated: false, createdAt: 1 } });
		frame({ type: "cedia_plan_review_closed", payload: { reviewId: 1, decision: "cancel" } });
		return;
	}
	if (mode === "timeout" && command.type === "bash") return;
	if (mode === "failure" && command.type === "bash") {
		failure(command.type, command.id, "fixture rejected bash");
		return;
	}
	if (mode === "abrupt-exit" && command.type === "get_state") {
		setTimeout(() => process.exit(17), 5);
		return;
	}
	if (mode === "final-flush" && command.type === "get_state") {
		const output = `${JSON.stringify({
			type: "response",
			command: command.type,
			id: command.id,
			success: true,
			data: { fixture: "final-flush" },
		})}\n${JSON.stringify({ type: "final_event", marker: "after-ack" })}\n`;
		process.stdout.end(output, "utf8", () => process.exit(0));
		return;
	}
	if (mode === "late-error" && command.type === "get_state") {
		response(command.type, command.id, { fixture: "first" });
		setTimeout(() => failure(command.type, command.id, "late fixture error"), 20);
		return;
	}
	if (mode === "out-of-order") {
		const delay = command.type === "get_state" ? 40 : 0;
		setTimeout(() => response(command.type, command.id, { fixture: command.type }), delay);
		return;
	}
	if (mode === "side-channel" && command.type === "get_available_commands") {
		pendingUiId = `ui_${command.id}`;
		frame({ type: "extension_ui_request", id: pendingUiId, method: "confirm", title: "Fixture approval", message: "Allow fixture?" });
		return;
	}
	if (mode === "backpressure" && command.type === "get_state") {
		response(command.type, command.id, { fixture: command.type, receivedTypes: [...receivedTypes] });
		return;
	}
	if (command.type === "bash") {
		response(command.type, command.id, { stdout: "FAKE_BASH_OK", stderr: "", exitCode: 0 });
		return;
	}
	response(command.type, command.id, {
		fixture: command.type,
		hasAmbientSentinel: process.env.CEDIA_AMBIENT_SENTINEL === "present",
	});
};

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", line => {
	if (!line.trim()) return;
	let command;
	try {
		command = JSON.parse(line);
	} catch {
		return;
	}
	if (command?.type === "extension_ui_response" && pendingUiId === command.id) {
		pendingUiId = undefined;
		response("get_available_commands", command.id.replace(/^ui_/, ""), { fixture: "approved", confirmed: command.confirmed === true });
		return;
	}
	handle(command);
});
input.on("close", () => {
	sawEof = true;
	if (mode === "final-on-eof") {
		process.stdout.end(`${JSON.stringify({ type: "final_eof_event", marker: "after-stdin-eof" })}\n`, "utf8", () => process.exit(0));
		return;
	}
	if (mode !== "ignore-eof" && mode !== "stubborn") process.exit(0);
});

if (mode === "stderr") process.stderr.write("x".repeat(1024 * 1024));

if (mode === "stubborn") {
	process.on("SIGTERM", () => {});
	setInterval(() => {}, 1_000);
}

// Keep the process alive for shutdown escalation tests.  SIGTERM/SIGKILL are
// intentionally left to Node's default handling.
void sawEof;
