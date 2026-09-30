/**
 * Prove native OMP goal state survives a real host/OMP restart and can be resumed.
 *
 * Run: bun scripts/omp-goal-restart-smoke.ts
 */
import { mkdtemp, rm, stat, readFile, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";
import { createServer, type Server } from "node:http";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP goal restart smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("OMP goal restart smoke failed: expected object");
	return value as Record<string, unknown>;
}
function goalFromResponse(value: unknown): Record<string, unknown> {
	const body = record(value);
	const result = record(body.result);
	const data = record(result.data);
	return record(data.goal);
}
async function exists(path: string): Promise<boolean> {
	try { await stat(path); return true; } catch { return false; }
}
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
	const end = Date.now() + 30_000;
	let value = await read();
	while (!accept(value)) {
		if (Date.now() >= end) throw new Error(`Timed out waiting for ${label}`);
		await new Promise(resolveWait => setTimeout(resolveWait, 100));
		value = await read();
	}
	return value;
}
async function listen(server: Server): Promise<number> {
	await new Promise<void>((resolveListen, reject) => server.listen(0, "127.0.0.1", () => resolveListen()).once("error", reject));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Fixture server did not bind a TCP port");
	return address.port;
}
async function closeServer(server: Server): Promise<void> {
	await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
}
const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/") ? resolve(requested) : (process.env.PATH ?? "").split(delimiter).map(dir => join(dir, requested)).find(Boolean) ?? requested;
check(await exists(executable), `OMP runtime is present at ${executable}`);
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `runtime is pinned (${version})`);

const profile = await mkdtemp(join(tmpdir(), "cedia-goal-restart-profile-"));
const stateDir = await mkdtemp(join(tmpdir(), "cedia-goal-restart-state-"));
const workDir = await mkdtemp(join(tmpdir(), "cedia-goal-restart-work-"));
let fixtureRequests = 0;
let fixtureRelease: (() => void) | undefined;
let fixtureReached: (() => void) | undefined;
let requestArrived = new Promise<void>(resolveRequest => { fixtureReached = resolveRequest; });
const fixture = createServer(async (request, response) => {
	fixtureRequests++;
	const reached = fixtureReached;
	fixtureReached = undefined;
	reached?.();
	await new Promise<void>(resolveWait => { fixtureRelease = resolveWait; });
	response.writeHead(200, { "content-type": "application/json" });
	response.end(JSON.stringify({ id: "fixture-turn", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "I will wait for the owner." }, finish_reason: "stop" }] }));
});
const fixturePort = await listen(fixture);
await writeFile(join(profile, "models.yml"), `providers:\n  cedia-fixture:\n    baseUrl: http://127.0.0.1:${fixturePort}/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: restart-fixture\n        name: Restart fixture\n        api: openai-completions\n        reasoning: false\n        input: [text]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 128000\n        maxTokens: 4096\n` , { mode: 0o600 });
await writeFile(join(profile, "config.yml"), "goal:\n  continuationModes: [rpc]\n", { mode: 0o600 });
const options = { stateDir, port: 0, ompExecutable: executable, virtualUi: true, ompEnv: { HOME: profile, PI_CODING_AGENT_DIR: profile, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" } };
let host = await startHostServer(options);
try {
	const project = host.host.store.createProject({ path: workDir, name: "Goal restart" });
	const session = host.host.createSession(project.id, "Goal restart");
	await host.host.startSession(session.id);
	let incarnation = host.host.store.getSession(session.id)!.incarnation;
	const call = (op: string, token: string, commandId: string, extra: Record<string, unknown> = {}) => host.router({ method: "POST", path: `/v1/sessions/${session.id}/goal`, token, body: { commandId, incarnation, op, ...extra } });
	const sessionFile = host.host.store.getSession(session.id)!.sessionFile;
	const start = await call("set", host.auth.ownerToken, "restart-goal-set-paused-case", { objective: "Persist this task through restart", tokenBudget: 420_000 });
	check(start.status === 200, "owner starts a native goal and sets a token budget");
	const originalGoal = goalFromResponse(start.body);
	check(originalGoal.objective === "Persist this task through restart" && originalGoal.tokenBudget === 420_000, "runtime confirms goal identity and budget");
	const explicitlyPaused = await call("pause", host.auth.ownerToken, "restart-goal-explicit-pause");
	check(explicitlyPaused.status === 200 && record(record(record(explicitlyPaused.body).result).data).enabled === false, "owner explicitly pauses the goal before shutdown");
	check(await exists(sessionFile), "the OMP session file remains available for restart");
	const entriesBefore = (await readFile(sessionFile, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
	check(entriesBefore.some(entry => entry.type === "mode_change" && entry.mode === "goal_paused"), "OMP persisted the explicit paused mode");
	await host.close();
	host = await startHostServer(options);
	await host.host.startSession(session.id);
	incarnation = host.host.store.getSession(session.id)!.incarnation;
	const controller = host.auth.issue("Goal restart controller").token;
	const readGoal = async (label: string) => await until(async () => host.router({ method: "GET", path: `/v1/sessions/${session.id}/goal`, token: controller }), response => record(response.body).state === "available", label);
	const explicitlyPausedRestored = record(record((await readGoal("restored explicitly paused goal")).body).goal);
	check(explicitlyPausedRestored.id === originalGoal.id && explicitlyPausedRestored.status === "paused" && explicitlyPausedRestored.objective === originalGoal.objective && explicitlyPausedRestored.tokenBudget === 420_000, "explicitly paused goal keeps its full record through restart");
	let resume = await call("resume", host.auth.ownerToken, "restart-goal-explicit-resume");
	check(resume.status === 200 && record(record(record(record(resume.body).result).data).goal).status === "active", "explicitly paused goal can be resumed");
	await call("drop", host.auth.ownerToken, "restart-goal-explicit-drop");

	const activeStart = await call("set", host.auth.ownerToken, "restart-goal-set-active-case", { objective: "Wait for explicit owner action", tokenBudget: 420_000 });
	const activeOriginal = goalFromResponse(activeStart.body);
	const activeGoalId = activeOriginal.id;
	const activeSessionFile = host.host.store.getSession(session.id)!.sessionFile;
	await requestArrived;
	const activeEntries = (await readFile(activeSessionFile, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
	check(activeEntries.some(entry => entry.type === "mode_change" && entry.mode === "goal"), "active goal mode was persisted before shutdown");
	const beforeShutdownRequests = fixtureRequests;
	await host.close();
	check(fixtureRequests === beforeShutdownRequests && fixtureRequests === 1, "the original objective turn is held by the local fixture during shutdown");
	host = await startHostServer(options);
	await host.host.startSession(session.id);
	incarnation = host.host.store.getSession(session.id)!.incarnation;
	const activeRestoredResponse = await readGoal("recovered formerly active goal");
	const activeRestored = record(record(activeRestoredResponse.body).goal);
	check(activeRestored.id === activeGoalId && activeRestored.objective === activeOriginal.objective && activeRestored.tokenBudget === 420_000 && activeRestored.status === "paused", "goal active at shutdown recovers paused with its id, objective, and budget");
	await new Promise(resolveWait => setTimeout(resolveWait, 1_000));
	check(fixtureRequests === beforeShutdownRequests, "no goal continuation turn starts before an explicit owner resume");
	requestArrived = new Promise<void>(resolveRequest => { fixtureReached = resolveRequest; });
	resume = await call("resume", host.auth.ownerToken, "restart-goal-active-resume");
	check(resume.status === 200 && record(record(record(record(resume.body).result).data).goal).status === "active", "owner explicitly resumes the formerly active goal");
	await Promise.race([requestArrived, new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for resumed goal turn")), 10_000))]);
	await until(async () => fixtureRequests, count => count >= beforeShutdownRequests + 1, "resumed goal dispatch reaches the loopback fixture");
	check(Number(fixtureRequests) === 2, "exactly one new objective turn begins after explicit resume");
	fixtureRelease?.();
	await call("drop", host.auth.ownerToken, "restart-goal-active-drop");
} finally {
	await host.close();
	fixtureRelease?.();
	await closeServer(fixture);
	await Promise.all([rm(stateDir, { recursive: true, force: true }), rm(profile, { recursive: true, force: true }), rm(workDir, { recursive: true, force: true })]);
}
