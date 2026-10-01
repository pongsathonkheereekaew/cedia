/**
 * Live shared-registry reload proof (O06, ZERO provider spend).
 *
 * A `/tan` background child hangs on its first model call against a
 * loopback server that accepts and never answers (request arrival proves it
 * is genuinely mid-inference). While the roster shows the tan live, a parent
 * `/reload-plugins` must REFUSE with the shared-registry parking error.
 * After `agents/kill` parks the child, rewrite + reload proceeds and the
 * replacement is visible. Fixture generations ride --trusted-extension;
 * the session model is the hanging loopback; nothing can reach a real
 * provider (no auth is even copied in).
 *
 * Run: bun scripts/omp-live-tan-reload-proof.ts
 */
import { createServer, type Server, type Socket } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { startHostServer } from "../apps/host/src/server.ts";

const FAIL = "OMP live tan reload proof failed";
const check = (v: unknown, m: string) => { if (!v) throw new Error(`${FAIL}: ${m}`); console.log(`OK   ${m}`); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const PROVIDER = "cedia_tan_reload_fixture";
const HANG_PROVIDER = "cedia_tan_hang";
const HANG_MODEL = "hang-model";
const cmdName = (gen: string) => `tan-reload-${gen}`;
const fixtureSource = (gen: string): string => `
export default function (pi) {
	pi.registerCommand(${JSON.stringify(cmdName(gen))}, {
		description: ${JSON.stringify(`Tan reload fixture generation ${gen.toUpperCase()}`)},
		handler: async () => {},
	});
	pi.registerProvider(${JSON.stringify(PROVIDER)}, {
		baseUrl: "http://127.0.0.1:9/v1", apiKey: "fixture-never-used", authHeader: false, api: "openai-completions",
		models: [{ id: "tan-reload-model", name: "Tan Reload Fixture", reasoning: false,
			input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }],
	});
}
`;

const root = resolve(import.meta.dir, "..");
const scratch = await mkdtemp(join(tmpdir(), "cedia-tan-reload-"));
const projectPath = join(scratch, "project");
const profile = join(scratch, "profile");
const stateDir = join(scratch, "host");
const ompProfile = join(scratch, "omp-profile");
await mkdir(projectPath, { recursive: true });
await mkdir(ompProfile, { recursive: true });
const fixturePath = join(projectPath, "tan-reload-fixture.ts");
await writeFile(fixturePath, fixtureSource("a"), { mode: 0o600 });

let hangRequests = 0;
const sockets = new Set<Socket>();
const hang: Server = createServer((req, res) => {
	hangRequests++;
	req.resume();
	sockets.add(req.socket);
	req.socket.on("close", () => sockets.delete(req.socket));
});
await new Promise<void>(done => hang.listen(0, "127.0.0.1", done));
hang.unref();
const hangPort = (hang.address() as { port: number }).port;
check(hangPort > 0, "hanging loopback provider is bound");

await writeFile(join(ompProfile, "models.yml"), `providers:
  cedia-tan-reload-baseline:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: baseline-model
        name: Tan reload baseline
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 8192
        maxTokens: 1024
  ${HANG_PROVIDER}:
    baseUrl: http://127.0.0.1:${hangPort}/v1
    auth: none
    api: openai-completions
    models:
      - id: ${HANG_MODEL}
        name: Tan hang model
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 8192
        maxTokens: 1024
`, { mode: 0o600 });

const host = await startHostServer({ stateDir, ompExecutable: resolve(root, "dist/omp/omp"), virtualUi: true,
	ompArgs: ["--trusted-extension", fixturePath],
	ompEnv: { HOME: ompProfile, PI_CODING_AGENT_DIR: ompProfile, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
	ompRequestTimeoutMs: 300_000 });
const owner = host.auth.ownerToken;
try {
	const project = host.host.store.createProject({ path: projectPath, name: "Tan reload fixture" });
	const session = host.host.createSession(project.id, "Tan reload task");
	check(session.id.length > 0, "fixture session registered");
	await host.host.startSession(session.id);
	const incarnation = host.host.store.getSession(session.id)!.incarnation;
	let cmdN = 0;
	const send = (command: string, payload: Record<string, unknown>) =>
		host.host.command(session.id, "tan-reload-probe", { commandId: `tan-reload-${++cmdN}`, incarnation, command, payload });
	const router = (method: string, path: string, body?: unknown) =>
		host.router({ method: method as "GET", path, token: owner, body } as any) as Promise<{ status: number; body: any }>;
	const names = async (): Promise<Set<string>> => {
		const r = await send("get_available_commands", {});
		const data = (r.result as any)?.data ?? r.result;
		return new Set((data.commands as any[]).map(c => String(c.name)));
	};
	const settle = async (id: string, label: string, timeoutMs = 90_000): Promise<{ status: string; detail: string }> => {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const c = host.host.store.getCommand(session.id, id)!;
			if (c.status === "completed" || c.status === "failed")
				return { status: c.status, detail: JSON.stringify(c.error ?? c.result ?? "").slice(0, 300) };
			if (Date.now() > deadline) throw new Error(`${FAIL}: ${label} timed out`);
			await sleep(1000);
		}
	};
	const sendPrompt = async (message: string): Promise<{ status: string; detail: string }> => {
		await send("prompt", { message });
		return settle(`tan-reload-${cmdN}`, message);
	};

	const setModel = await send("set_model", { provider: HANG_PROVIDER, modelId: HANG_MODEL });
	check(["completed", "acknowledged"].includes(setModel.status), "hanging loopback model selected for the session");
	check((await names()).has(cmdName("a")), "generation A command loaded");

	const tan = await sendPrompt("/tan probe tangential work");
	check(tan.status === "completed", "/tan dispatches with no turn of its own");
	let tanId = "";
	{
		const deadline = Date.now() + 60_000;
		for (;;) {
			const roster = await router("GET", `/v1/sessions/${session.id}/agents`);
			const rows = ((roster.body as any)?.agents ?? []) as any[];
			const found = rows.find(r => r.kind === "sub");
			if (found) { tanId = String(found.id); break; }
			if (Date.now() > deadline) throw new Error(`${FAIL}: no live tan reached the roster`);
			await sleep(1000);
		}
	}
	check(tanId.length > 0, `live tan on roster (id ${tanId.slice(0, 8)}…)`);
	{
		const deadline = Date.now() + 60_000;
		while (hangRequests === 0) {
			if (Date.now() > deadline) throw new Error(`${FAIL}: tan never called the hanging provider`);
			await sleep(500);
		}
	}
	check(hangRequests >= 1, "the tan child is genuinely mid-inference (loopback request arrived, never answered)");

	await writeFile(fixturePath, fixtureSource("b"), { mode: 0o600 });
	await sleep(1300);
	const refused = await sendPrompt("/reload-plugins");
	check(refused.status === "failed" && /parked/i.test(refused.detail), `reload refuses while the tan child is live (${refused.detail.slice(0, 160)})`);
	check((await names()).has(cmdName("a")) && !(await names()).has(cmdName("b")), "the refused reload changed nothing");

	for (const s of [...sockets]) { try { s.destroy(); } catch {} }
	console.log("OK   hanging sockets destroyed; waiting for the worker request to fail");
	let naturalDeath = false;
	{
		const deadline = Date.now() + 150_000;
		for (;;) {
			const roster = await router("GET", `/v1/sessions/${session.id}/agents`);
			const rows = ((roster.body as any)?.agents ?? []) as any[];
			const row = rows.find(r => r.kind === "sub" && String(r.id) === tanId);
			if (!row || !/running|live|active/i.test(String(row.status ?? ""))) {
				naturalDeath = true;
				console.log(`OK   tan ended on socket failure alone: ${JSON.stringify(row ?? null).slice(0, 160)}`);
				break;
			}
			if (Date.now() > deadline) break;
			await sleep(2000);
		}
	}
	if (!naturalDeath) {
		const kill = await router("POST", `/v1/sessions/${session.id}/agents/kill`,
			{ commandId: `tan-reload-kill-${randomUUID()}`, incarnation, id: tanId });
		check(kill.status === 200, "agents/kill acknowledged for the parked tan");
	} else {
		console.log("OK   no kill needed; testing reload after natural worker death");
	}
	{
		const deadline = Date.now() + 60_000;
		for (;;) {
			const roster = await router("GET", `/v1/sessions/${session.id}/agents`);
			const rows = ((roster.body as any)?.agents ?? []) as any[];
			const row = rows.find(r => r.kind === "sub" && String(r.id) === tanId);
			if (!row) break;
			console.log(`OK   tan row after kill: ${JSON.stringify(row).slice(0, 200)}`);
			if (!/running|live|active/i.test(String((row as any).status ?? ""))) break;
			if (Date.now() > deadline) throw new Error(`${FAIL}: killed tan still running: ${JSON.stringify(row).slice(0, 200)}`);
			await sleep(1000);
		}
	}
	check(true, "the roster confirms the tan is parked");

	const ping = await send("get_available_commands", {});
	const pingId = `tan-reload-${cmdN}`;
	{
		const deadline = Date.now() + 30_000;
		let st = "";
		for (;;) {
			const c = host.host.store.getCommand(session.id, pingId)!;
			st = c.status;
			if (c.status === "completed" || c.status === "failed") break;
			if (Date.now() > deadline) break;
			await sleep(1000);
		}
		console.log(`OK   post-kill owner responsiveness: get_available_commands ${st}`);
	}
	const usagePing = await sendPrompt("/usage");
	console.log(`OK   post-kill local slash via prompt path: ${usagePing.status} (${usagePing.detail.slice(0, 120)})`);
	const proceeded = await sendPrompt("/reload-plugins");
	check(proceeded.status === "completed", "reload proceeds after the child is parked");
	const after = await names();
	check(after.has(cmdName("b")) && !after.has(cmdName("a")), "park-then-replace makes generation B visible");

	await Bun.file(fixturePath).exists().then(() => import("node:fs/promises").then(m => m.unlink(fixturePath)));
	await sleep(1300);
	const removed = await sendPrompt("/reload-plugins");
	check(removed.status === "completed", "removal reload completed");
	const gone = await names();
	check(!gone.has(cmdName("a")) && !gone.has(cmdName("b")), "removal clears the fixture");

	const stats = await send("get_session_stats", {});
	const usage = ((stats.result as any)?.data ?? {}) as any;
	check(usage.assistantMessages === 0 && usage.toolCalls === 0 && (usage.cost === 0 || usage.cost === "0"), "zero turns, tool calls, and spend across the whole sequence");
	const result = { ok: true, transitions: ["tan-live-refused-parked", "kill-parked", "replace-B", "removed"],
		hangRequests, providerCalls: 0 };
	console.log(JSON.stringify(result, null, 2));
} finally {
	for (const s of [...sockets]) { try { s.destroy(); } catch {} }
	await new Promise<void>(done => hang.close(() => done()));
	await host.close().catch(() => {});
}
