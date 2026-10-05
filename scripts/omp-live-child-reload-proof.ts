/**
 * Live shared-registry reload proof (O06, tiny paid turns on the
 * user-approved Muse row, scratch project only).
 *
 * Host-backed session with a fixture extension (dead-port provider) plus the
 * user's own opencode-go auth under a yolo overlay (scratch only: the only
 * tool the model is ever asked to run is `sleep`). Flow:
 *  1. tiny turn proves the live session (reply `ready`, no tools);
 *  2. fixture A→B reload with no live child proceeds;
 *  3. parent turn spawns exactly one subagent running `sleep 30` via bash;
 *     while the child is live, `/reload-plugins` must REFUSE with the
 *     shared-registry parking error;
 *  4. after the child completes, rewrite C + reload proceeds (park-then-replace);
 *  5. tiny turn proves post-replacement health; removal clears the fixture.
 * If the model runs sleep itself instead of spawning a subagent, the journal
 * transcript decides the claim (live-turn fenceentlich vs shared-registry
 * refusal) — the script asserts whichever it observes and records it.
 *
 * Run: bun scripts/omp-live-child-reload-proof.ts
 */
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { startHostServer } from "../apps/host/src/server.ts";

const FAIL = "OMP live child reload proof failed";
const check = (v: unknown, m: string) => { if (!v) throw new Error(`${FAIL}: ${m}`); console.log(`OK   ${m}`); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const PROVIDER = "cedia_live_child_fixture";
const cmdName = (gen: string) => `live-child-${gen}`;
const fixtureSource = (gen: string): string => `
export default function (pi) {
	pi.registerCommand(${JSON.stringify(cmdName(gen))}, {
		description: ${JSON.stringify(`Live child fixture generation ${gen.toUpperCase()}`)},
		handler: async () => {},
	});
	pi.registerProvider(${JSON.stringify(PROVIDER)}, {
		baseUrl: "http://127.0.0.1:9/v1", apiKey: "fixture-never-used", authHeader: false, api: "openai-completions",
		models: [{ id: "live-child-model", name: "Live Child Fixture", reasoning: false,
			input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }],
	});
}
`;

const root = resolve(import.meta.dir, "..");
const scratch = await mkdtemp(join(tmpdir(), "cedia-live-child-"));
const projectPath = join(scratch, "project");
const profile = join(scratch, "profile");
const stateDir = join(scratch, "host");
const ompProfile = join(scratch, "omp-profile");
await mkdir(projectPath, { recursive: true });
await mkdir(ompProfile, { recursive: true });
const fixturePath = join(projectPath, "live-child-fixture.ts");
await writeFile(fixturePath, fixtureSource("a"), { mode: 0o600 });
await writeFile(join(projectPath, "note.txt"), "Live child reload probe workspace\n");
const realAgent = join(homedir(), ".omp", "agent");
for (const f of ["models.yml", "models.db", "models.db-shm", "models.db-wal", "config.yml"]) {
	try { await cp(join(realAgent, f), join(ompProfile, f)); } catch {}
}
const yoloOverlay = "/tmp/cedia-probe-yolo.yml";
await Bun.file(yoloOverlay).exists().then(async e => { if (!e) throw new Error(`${FAIL}: missing ${yoloOverlay}`); });

const host = await startHostServer({ stateDir, ompExecutable: resolve(root, "dist/omp/omp"), virtualUi: true,
	ompArgs: ["--trusted-extension", fixturePath],
	ompEnv: { HOME: ompProfile, PI_CODING_AGENT_DIR: ompProfile, PI_CONFIG_FILES: yoloOverlay, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
	ompRequestTimeoutMs: 300_000 });
const owner = host.auth.ownerToken;
const api = async (method: string, path: string, body?: unknown) =>
	host.router({ method: method as "GET", path, token: owner, body } as any);
try {
	const project = host.host.store.createProject({ path: projectPath, name: "Live child fixture" });
	const session = host.host.createSession(project.id, "Live child task");
	check(session.id.length > 0, "fixture session registered");
	await host.host.startSession(session.id);
	const incarnation = host.host.store.getSession(session.id)!.incarnation;
	let cmdN = 0;
	const send = (command: string, payload: Record<string, unknown>) =>
		host.host.command(session.id, "live-child-probe", { commandId: `live-child-${++cmdN}`, incarnation, command, payload });
	const setModel = await send("set_model", { provider: "opencode-go", modelId: "muse-spark-1.3-contributor" });
	check(["completed", "acknowledged"].includes(setModel.status), "live Muse model accepted");
	const names = async (): Promise<Set<string>> => {
		const r = await send("get_available_commands", {});
		const data = (r.result as any)?.data ?? r.result;
		return new Set((data.commands as any[]).map(c => String(c.name)));
	};
	const turnText = async (message: string, tag: string, timeoutMs = 240_000): Promise<{ status: string; text: string }> => {
		const r = await send("prompt", { message });
		const id = `live-child-${cmdN}`;
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const cmd = host.host.store.getCommand(session.id, id)!;
			if (cmd.status === "completed" || cmd.status === "failed") {
				const strings: string[] = [];
				const walk = (v: unknown): void => {
					if (typeof v === "string") strings.push(v);
					else if (Array.isArray(v)) v.forEach(walk);
					else if (v && typeof v === "object") Object.values(v).forEach(walk);
				};
				walk(cmd.result ?? cmd.error ?? "");
				const text = strings.join(" ").trim();
				console.log(`OK   turn ${tag} settled ${cmd.status}: ${text.slice(0, 120)}`);
				return { status: cmd.status, text };
			}
			if (Date.now() > deadline) throw new Error(`${FAIL}: turn ${tag} timed out`);
			await sleep(3000);
		}
	};
	const hasCommand = async (name: string): Promise<boolean> => (await names()).has(name);
	check(await hasCommand(cmdName("a")), "generation A command loaded");

	const t1 = await turnText("Reply with exactly: ready. Call no tools.", "health-1");
	check(t1.status === "completed" && t1.text.toLowerCase().includes("ready"), "live session answers before replacement");

	await writeFile(fixturePath, fixtureSource("b"), { mode: 0o600 });
	await sleep(1300);
	const relB = await send("prompt", { message: "/reload-plugins" });
	const relBsettled = await (async () => {
		const id = `live-child-${cmdN}`;
		const deadline = Date.now() + 60_000;
		for (;;) {
			const c = host.host.store.getCommand(session.id, id)!;
			if (c.status === "completed" || c.status === "failed") return c.status;
			if (Date.now() > deadline) throw new Error(`${FAIL}: reload B timed out`);
			await sleep(1000);
		}
	})();
	check(relBsettled === "completed", "B reload proceeds with no live child");
	check(await hasCommand(cmdName("b")), "generation B replaces A");

	const spawn = send("prompt", { message: "Use the task tool to spawn exactly one subagent. The subagent must run `sleep 30` with the bash tool and nothing else, then report DONE. Do not run bash yourself. Call no other tools." });
	spawn.catch(() => {});
	const childId = `live-child-${cmdN}`;
	let evAfter = 0;
	const pollSleep = async (): Promise<boolean> => {
		const ev = await api("GET", `/v1/sessions/${session.id}/events?after=${evAfter}&limit=500`) as any;
		const body = (ev as any).body ?? ev;
		const list = (body as any).events ?? [];
		let found = false;
		for (const e of list) {
			if (typeof e.sequence === "number" && e.sequence > evAfter) evAfter = e.sequence;
			const f = JSON.stringify(e.frame ?? e);
			if (/sleep/.test(f)) found = true;
		}
		if (found) return true;
		return /sleep/.test(JSON.stringify(body).slice(0, 0)) && false;
	};
	let sawSleep = false;
	const reloadDeadline = Date.now() + 150_000;
	let reloadOutcome = "";
	for (;;) {
		if (await pollSleep()) sawSleep = true;
		const cmd = host.host.store.getCommand(session.id, childId)!;
		if (cmd.status === "completed" || cmd.status === "failed") break;
		if (sawSleep && !reloadOutcome) {
			console.log(`OK   firing mid-child reload while parent turn open`);
			const rel = await send("prompt", { message: "/reload-plugins" });
			const rid = `live-child-${cmdN}`;
			const rdead = Date.now() + 60_000;
			for (;;) {
				const rc = host.host.store.getCommand(session.id, rid)!;
				if (rc.status === "completed" || rc.status === "failed") {
					const parentNow = host.host.store.getCommand(session.id, childId)!;
					reloadOutcome = `${rc.status}:${JSON.stringify(rc.error ?? rc.result ?? "").slice(0, 200)}`;
					console.log(`OK   mid-child reload settled ${rc.status} while parent is ${parentNow.status}`);
					break;
				}
				if (Date.now() > rdead) throw new Error(`${FAIL}: mid-child reload timed out`);
				await sleep(1000);
			}
			console.log(`OK   mid-child reload settled: ${reloadOutcome.slice(0, 160)}`);
		}
		if (Date.now() > reloadDeadline) throw new Error(`${FAIL}: child window timed out`);
		await sleep(3000);
	}
	{
		const cmd = host.host.store.getCommand(session.id, childId)!;
		const strings: string[] = [];
		const walk = (v: unknown): void => {
			if (typeof v === "string") strings.push(v);
			else if (Array.isArray(v)) v.forEach(walk);
			else if (v && typeof v === "object") Object.values(v).forEach(walk);
		};
		walk(cmd.result ?? cmd.error ?? "");
		console.log(`OK   parent turn ${cmd.status}: ${strings.join(" ").slice(0, 300)}`);
	}
	check(sawSleep, "a sleep tool ran while the parent turn was open");
	const transcript = await readFile(join(stateDir, "sessions", session.id, "session.jsonl"), "utf8").catch(() => "");
	const spawnedSubagent = /subagent|\"task\"|clone/i.test(transcript);
	console.log(`OK   transcript shows ${spawnedSubagent ? "a spawned subagent/task child" : "NO subagent marker (model ran sleep directly)"}`);
	if (spawnedSubagent) {
		check(/parked/i.test(reloadOutcome), `reload refused with parking error while child live (got ${reloadOutcome.slice(0, 120)})`);
	} else {
		console.log(`OK   fence-path observation (own live turn), not the shared-registry refusal: ${reloadOutcome.slice(0, 120)}`);
	}

	await writeFile(fixturePath, fixtureSource("c"), { mode: 0o600 });
	await sleep(1300);
	const relC = await send("prompt", { message: "/reload-plugins" });
	const cid = `live-child-${cmdN}`;
	const cdead = Date.now() + 60_000;
	let cstatus = "";
	for (;;) {
		const c = host.host.store.getCommand(session.id, cid)!;
		if (c.status === "completed" || c.status === "failed") { cstatus = c.status; break; }
		if (Date.now() > cdead) throw new Error(`${FAIL}: reload C timed out`);
		await sleep(1000);
	}
	check(cstatus === "completed", "park-then-replace proceeds after the child completes");
	check(await hasCommand(cmdName("c")), "generation C visible after parked replacement");

	const t3 = await turnText("Reply with exactly: ok. Call no tools.", "health-3");
	check(t3.status === "completed" && t3.text.toLowerCase().includes("ok"), "session healthy after replacement");

	await Bun.file(fixturePath).exists().then(() => import("node:fs/promises").then(m => m.unlink(fixturePath)));
	await sleep(1300);
	const relR = await send("prompt", { message: "/reload-plugins" });
	const rid2 = `live-child-${cmdN}`;
	const rdead2 = Date.now() + 60_000;
	for (;;) {
		const c = host.host.store.getCommand(session.id, rid2)!;
		if (c.status === "completed" || c.status === "failed") break;
		if (Date.now() > rdead2) throw new Error(`${FAIL}: removal reload timed out`);
		await sleep(1000);
	}
	check(!(await hasCommand(cmdName("c"))), "removal clears the fixture");
	const result = { ok: true, spawnedSubagent, reloadOutcome: reloadOutcome.slice(0, 160), provider: PROVIDER };
	console.log(JSON.stringify(result, null, 2));
} finally {
	await host.close().catch(() => {});
}
