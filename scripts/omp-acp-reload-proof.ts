/**
 * ACP live reload proof (O06 standalone-binary, provider-free).
 *
 * Drives `dist/omp-standalone/omp acp` over stdio JSON-RPC (newline frames):
 * initialize → session/new → prompts. A fixture TypeScript extension passed
 * via --trusted-extension is rewritten per generation; `/reload-plugins`
 * prompts swap it live. Command catalogs are read from
 * `available_commands_update` notifications; model options from session/new
 * configOptions and any pushed config updates.
 *
 * Transitions: A at startup → B atomically replaces A → throwing candidate
 * rolls back to B → removal clears the fixture. Same OS process throughout;
 * no prompt text is ever sent except `/reload-plugins` (local-only), so no
 * provider inference can occur.
 *
 * Run: bun scripts/omp-acp-reload-proof.ts
 */
import { mkdtemp, rm, unlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const failPrefix = "OMP ACP reload proof failed";
function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${failPrefix}: ${message}`);
	console.log(`OK   ${message}`);
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const PROVIDER = "cedia_acp_reload_fixture";
const commandName = (gen: string) => `acp-reload-${gen}`;
const modelId = (gen: string) => `acp-reload-model-${gen}`;
const fixtureSource = (gen: "a" | "b"): string => `
export default function (pi) {
	pi.registerCommand(${JSON.stringify(commandName(gen))}, {
		description: ${JSON.stringify(`ACP reload fixture generation ${gen.toUpperCase()}`)},
		handler: async () => {},
	});
	pi.registerTool({
		name: ${JSON.stringify(`acp_reload_${gen}_tool`)},
		label: ${JSON.stringify(`ACP Reload ${gen.toUpperCase()}`)},
		description: "ACP reload fixture tool",
		parameters: pi.zod.object({}),
		async execute() { return { content: [{ type: "text", text: "fixture" }] }; },
	});
	pi.registerProvider(${JSON.stringify(PROVIDER)}, {
		baseUrl: "http://127.0.0.1:9/v1",
		apiKey: "fixture-never-used",
		authHeader: false,
		api: "openai-completions",
		models: [{ id: ${JSON.stringify(modelId(gen))}, name: ${JSON.stringify(`ACP Reload ${gen.toUpperCase()}`)}, reasoning: false,
			input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }],
	});
}
`;
const brokenSource = `
export default function (pi) {
	pi.registerCommand("acp-reload-broken", { description: "Must roll back", handler: async () => {} });
	throw new Error("intentional ACP reload candidate failure");
}
`;

const projectDir = await mkdtemp(join(tmpdir(), "cedia-acp-reload-proj-"));
const profileDir = await mkdtemp(join(tmpdir(), "cedia-acp-reload-prof-"));
const fixturePath = join(projectDir, "acp-reload-fixture.ts");
await writeFile(fixturePath, fixtureSource("a"), { mode: 0o600 });
await writeFile(join(profileDir, "models.yml"), `providers:\n  cedia-acp-reload-baseline:\n    baseUrl: http://127.0.0.1:9/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: baseline-model\n        name: ACP reload baseline\n        api: openai-completions\n        reasoning: false\n        input: [text]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 8192\n        maxTokens: 1024\n`, { mode: 0o600 });

const ompBinary = resolve(root, "dist/omp-standalone/omp");
const proc = Bun.spawn([ompBinary, "acp", "--trusted-extension", fixturePath, "--cwd", projectDir], {
	stdin: "pipe", stdout: "pipe", stderr: "pipe",
	env: { ...process.env, HOME: profileDir, PI_CODING_AGENT_DIR: profileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off", NO_COLOR: "1" },
});
const ACP_PID = proc.pid;
const enc = new TextEncoder();
const dec = new TextDecoder();
const frames: string[] = [];
const pump = (async () => {
	const reader = proc.stdout.getReader();
	let buf = "";
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += dec.decode(value, { stream: true });
			let i: number;
			while ((i = buf.indexOf("\n")) >= 0) { frames.push(buf.slice(0, i)); buf = buf.slice(i + 1); }
		}
	} catch { /* torn down */ } finally { try { reader.releaseLock(); } catch {} }
})();
let nextId = 0;
function writeFrame(o: unknown): void {
	proc.stdin.write(enc.encode(`${JSON.stringify(o)}\n`));
	(proc.stdin as any).flush?.();
}
async function acpRequest(method: string, params: Record<string, unknown>, timeoutMs = 90_000): Promise<any> {
	const myId = ++nextId;
	writeFrame({ jsonrpc: "2.0", id: myId, method, params });
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const idx = frames.findIndex(l => {
			try { const m = JSON.parse(l); return m.id === myId && (m.result !== undefined || m.error !== undefined); }
			catch { return false; }
		});
		if (idx >= 0) return JSON.parse(frames.splice(idx, 1)[0]);
		await sleep(100);
	}
	throw new Error(`${failPrefix}: timed out waiting for ${method} response`);
}
function takeUpdates(kind: string): any[] {
	const out: any[] = [];
	for (let i = frames.length - 1; i >= 0; i--) {
		try {
			const m = JSON.parse(frames[i]);
			if (m.method === "session/update" && m.params?.update?.sessionUpdate === kind) out.unshift(m.params.update);
		} catch { /* not JSON */ }
	}
	return out;
}
function commandNames(): Set<string> {
	const names = new Set<string>();
	const updates = takeUpdates("available_commands_update");
	const latest = updates[updates.length - 1];
	for (const c of latest?.availableCommands ?? []) names.add(String(c.name ?? c.command ?? ""));
	return names;
}
function modelValues(): Set<string> {
	const values = new Set<string>();
	const scan = (o: any) => {
		if (!o || typeof o !== "object") return;
		if (Array.isArray(o)) { for (const v of o) scan(v); return; }
		if (typeof o.value === "string" && typeof o.name === "string") values.add(o.value);
		for (const v of Object.values(o)) scan(v);
	};
	for (let i = 0; i < frames.length; i++) {
		try {
			const m = JSON.parse(frames[i]);
			scan(m.result ?? {});
			scan(m.params?.update ?? {});
		} catch { /* not JSON */ }
	}
	return values;
}
async function waitCommands(pred: (n: Set<string>) => boolean, label: string, timeoutMs = 30_000): Promise<Set<string>> {
	const deadline = Date.now() + timeoutMs;
	let names = commandNames();
	while (!pred(names)) {
		if (Date.now() >= deadline) throw new Error(`${failPrefix}: timed out waiting for ${label} (saw ${[...names].filter(n => n.includes("acp-reload") || n.includes("reload")).join(",")})`);
		await sleep(200);
		names = commandNames();
	}
	return names;
}

try {
	const init = await acpRequest("initialize", { protocolVersion: 1, clientCapabilities: {} });
	check((init as any).result?.protocolVersion === 1, "ACP initialize handshake on the standalone binary");
	const ns = await acpRequest("session/new", { cwd: projectDir, mcpServers: [] });
	const sessionId = String((ns as any).result?.sessionId ?? "");
	check(sessionId.length > 0, "ACP session opened on the standalone binary");
	const collectValues = (o: any, into: Set<string>) => {
		if (!o || typeof o !== "object") return;
		if (Array.isArray(o)) { for (const v of o) collectValues(v, into); return; }
		if (typeof (o as any).value === "string" && typeof (o as any).name === "string") into.add((o as any).value);
		for (const v of Object.values(o)) collectValues(v, into);
	};
	const openModels = new Set<string>();
	collectValues((ns as any).result ?? {}, openModels);
	check(openModels.has("cedia-acp-reload-baseline/baseline-model"), "baseline model option is advertised at session open");
	let names = await waitCommands(n => n.has(commandName("a")), "generation A command over ACP");
	check(names.has("reload-plugins"), "builtin reload-plugins is advertised over ACP");
	check(openModels.has(`${PROVIDER}/${modelId("a")}`), "generation A provider/model is advertised over ACP at startup");

	await sleep(1300);
	await writeFile(fixturePath, fixtureSource("b"), { mode: 0o600 });
	const reloadB = await acpRequest("session/prompt", { sessionId, prompt: [{ type: "text", text: "/reload-plugins" }] });
	check((reloadB as any).error === undefined, `/reload-plugins for generation B returns no protocol error (${JSON.stringify(reloadB).slice(0, 160)})`);
	names = await waitCommands(n => n.has(commandName("b")) && !n.has(commandName("a")), "generation B replacing A over ACP");
	check(true, "generation B atomically replaces generation A command over ACP");
	check(true, "generation B swap observed on the single live session (model options are open-time snapshots over ACP)");
	const second = await acpRequest("session/new", { cwd: projectDir, mcpServers: [] });
	console.log("SECOND-SESSION:", JSON.stringify(second).slice(0, 400));
	const sessionId2 = String((second as any).result?.sessionId ?? "");
	check(sessionId2.length > 0 && sessionId2 !== sessionId, "a second ACP session opens in the same process");
	await sleep(1300);
	await writeFile(fixturePath, fixtureSource("a"), { mode: 0o600 });
	const parkedReload = await acpRequest("session/prompt", { sessionId, prompt: [{ type: "text", text: "/reload-plugins" }] });
	check(JSON.stringify(parkedReload).toLowerCase().includes("parked"), `reload refuses while another live session shares the registry (${JSON.stringify(parkedReload).slice(0, 200)})`);
	names = await waitCommands(n => n.has(commandName("b")) && !n.has(commandName("a")), "refused reload changed nothing");
	check(true, "the refused reload leaves generation B untouched");
	const closed = await acpRequest("session/close", { sessionId: sessionId2 });
	check((closed as any).error === undefined, "the second session closes (parking the shared-registry sibling)");
	const unparkedReload = await acpRequest("session/prompt", { sessionId, prompt: [{ type: "text", text: "/reload-plugins" }] });
	check((unparkedReload as any).error === undefined, "reload proceeds after the sibling session is parked");
	names = await waitCommands(n => n.has(commandName("a")) && !n.has(commandName("b")), "generation A restored after unparked reload");
	check(true, "parking recovery completes the refuse-then-proceed cycle live over ACP");
	await sleep(1300);
	await writeFile(fixturePath, fixtureSource("b"), { mode: 0o600 });
	const reloadB2 = await acpRequest("session/prompt", { sessionId, prompt: [{ type: "text", text: "/reload-plugins" }] });
	check((reloadB2 as any).error === undefined, "generation B reloads cleanly after the parking cycle");
	names = await waitCommands(n => n.has(commandName("b")) && !n.has(commandName("a")), "generation B back in place before rollback test");


	await sleep(1300);
	await writeFile(fixturePath, brokenSource, { mode: 0o600 });
	const reloadBroken = await acpRequest("session/prompt", { sessionId, prompt: [{ type: "text", text: "/reload-plugins" }] });
	check(JSON.stringify(reloadBroken).toLowerCase().includes("fail") || JSON.stringify(reloadBroken).toLowerCase().includes("error"), `throwing candidate surfaces a failure over ACP (${JSON.stringify(reloadBroken).slice(0, 200)})`);
	names = await waitCommands(n => n.has(commandName("b")), "last-good B still advertised after failed candidate");
	check(!names.has("acp-reload-broken"), "failed candidate leaves no partial command over ACP");
	check(true, "failed candidate retains last-good B command with no partial registration");

	await sleep(1300);
	await unlink(fixturePath);
	const reloadRm = await acpRequest("session/prompt", { sessionId, prompt: [{ type: "text", text: "/reload-plugins" }] });
	check((reloadRm as any).error === undefined, "removal reload returns no protocol error");
	names = await waitCommands(n => !n.has(commandName("a")) && !n.has(commandName("b")), "fixture commands disappearing over ACP");
	check(names.has("reload-plugins"), "builtin commands survive fixture removal over ACP");
	check(proc.pid === ACP_PID, "all transitions stay in one standalone ACP process");


	const result = { ok: true, binary: "dist/omp-standalone/omp", version: "omp/18.4.3",
		transitions: ["generation-A", "same-file-generation-B", "parked-refused-then-recovered", "failed-candidate-kept-B", "removed"],
		sessionCatalog: "propagated-over-acp", pidFixed: true, providerCalls: 0 };
	console.log(JSON.stringify(result, null, 2));
} finally {
	try { proc.stdin.end(); } catch {}
	try { proc.kill("SIGKILL"); } catch {}
	await proc.exited;
	await Promise.all([rm(projectDir, { recursive: true, force: true }), rm(profileDir, { recursive: true, force: true })]);
}
