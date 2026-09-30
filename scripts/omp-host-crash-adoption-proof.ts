/**
 * Provider-free proof that a new Cedia host can adopt its surviving task owner
 * after the previous host process is killed (plan §8.1 / §11.1 lifecycle row).
 *
 * This uses a real OMP 18.1.18+ process, a fresh host/profile/workspace, and
 * authenticated loopback host routes. It SIGKILLs only the host process this
 * script spawned, then verifies the same task/incarnation/OMP PID after a new
 * host claims the owner lease. Cleanup signals only those exact scratch-owned
 * processes after rechecking their private task owner record.
 *
 * It does not prove packaged Cedia app crash adoption, Login Item behavior, or
 * any D/W/N/F checkpoint.
 *
 * Run: bun scripts/omp-host-crash-adoption-proof.ts
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { probeCediaOwner, readCediaOwnerRecord } from "../apps/host/src/owner-endpoint.ts";
import type { HostDescriptor } from "../packages/protocol/src/index.ts";

const root = resolve(import.meta.dir, "..");
const failPrefix = "OMP host-crash adoption proof failed";
function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${failPrefix}: ${message}`);
	console.log(`OK   ${message}`);
}
function object(value: unknown, message: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${failPrefix}: ${message}`);
	return value as Record<string, unknown>;
}
const delay = (ms: number) => new Promise<void>(resolveDelay => setTimeout(resolveDelay, ms));
async function waitFor<T>(label: string, read: () => Promise<T | undefined>, timeoutMs = 60_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await read();
		if (value !== undefined) return value;
		if (Date.now() >= deadline) throw new Error(`${failPrefix}: timed out waiting for ${label}`);
		await delay(150);
	}
}
function alive(pid: number): boolean {
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
function exited(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
	return new Promise(resolveExit => child.once("exit", () => resolveExit()));
}

const requestedRuntime = process.env.CEDIA_OMP_PATH ?? "dist/omp/omp";
const runtime = resolve(root, requestedRuntime);
check(existsSync(runtime), `prepared OMP runtime exists at ${runtime}`);
const runtimeVersion = execFileSync(runtime, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(/^omp\/(18\.1\.(1[89]|[2-9]\d)|18\.[2-9]\.|[2-9]\d\.)/.test(runtimeVersion), `OMP baseline is supported (${runtimeVersion})`);

const stateDir = await mkdtemp(join(tmpdir(), "cedia-host-crash-state-"));
const profileDir = await mkdtemp(join(tmpdir(), "cedia-host-crash-profile-"));
const workDir = await mkdtemp(join(tmpdir(), "cedia-host-crash-work-"));
const resultRoot = join(root, "dist", "host-crash-adoption-proof", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(resultRoot, { recursive: true });
const hostCli = join(root, "apps/host/src/cli.ts");
const env = {
	...process.env,
	CEDIA_STATE_DIR: stateDir,
	CEDIA_OMP_PATH: runtime,
	CEDIA_RPC_OWNER_BRIDGE: "1",
	CEDIA_PARENT_PID: String(process.pid),
	CEDIA_HOST_IDLE_MS: "600000",
	HOME: profileDir,
	PI_CODING_AGENT_DIR: profileDir,
	PI_NO_PTY: "1",
	PI_NOTIFICATIONS: "off",
	PATH: process.env.PATH ?? ["/usr/bin", "/bin"].join(delimiter),
};
let host: ChildProcess | undefined;
let sessionId: string | undefined;
let incarnation: string | undefined;
let ownerPid: number | undefined;
let hostOutput = "";
let modelServer: Server | undefined;
let providerRequests = 0;

function spawnHost(generation: string): ChildProcess {
	const child = spawn(process.execPath, [hostCli, "serve"], {
		cwd: root,
		env: { ...env, CEDIA_APP_GENERATION: generation },
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout?.on("data", chunk => { hostOutput = `${hostOutput}${String(chunk)}`.slice(-8_000); });
	child.stderr?.on("data", chunk => { hostOutput = `${hostOutput}${String(chunk)}`.slice(-8_000); });
	return child;
}

async function descriptorFor(child: ChildProcess): Promise<HostDescriptor> {
	const pid = child.pid;
	check(pid !== undefined, "host child has a process identity");
	return await waitFor("the exact spawned host's authenticated descriptor", async () => {
		try {
			const value = object(JSON.parse(await readFile(join(stateDir, "host.json"), "utf8")), "host descriptor");
			if (value.pid !== pid || typeof value.url !== "string" || typeof value.token !== "string") return undefined;
			const descriptor = value as unknown as HostDescriptor;
			const response = await fetch(`${descriptor.url}/v1/health`, {
				headers: { Authorization: `Bearer ${descriptor.token}` },
				signal: AbortSignal.timeout(1_000),
			});
			if (!response.ok) return undefined;
			const health = object(await response.json(), "host health");
			const identity = object(health.identity, "host process identity");
			if (health.protocolVersion !== descriptor.protocolVersion || identity.stateDir !== stateDir || identity.processStartedAt !== descriptor.processStartedAt) return undefined;
			return descriptor;
		} catch {
			if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${failPrefix}: host exited during startup. ${hostOutput}`);
			return undefined;
		}
	});
}

async function request(descriptor: HostDescriptor, method: string, path: string, body?: unknown): Promise<unknown> {
	const response = await fetch(`${descriptor.url}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${descriptor.token}`,
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
		signal: AbortSignal.timeout(30_000),
	});
	const answer = await response.json() as unknown;
	if (!response.ok) {
		const failure = object(answer, "host error response");
		const detail = object(failure.error, "host error detail");
		throw new Error(`${failPrefix}: ${method} ${path} returned ${response.status} ${String(detail.code)}: ${String(detail.message)}`);
	}
	return answer;
}

async function stopHost(child: ChildProcess | undefined): Promise<void> {
	if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
	try { process.kill(child.pid, "SIGTERM"); } catch { return; }
	const stopped = await Promise.race([exited(child).then(() => true), delay(8_000).then(() => false)]);
	if (!stopped && child.exitCode === null && child.signalCode === null) {
		try { process.kill(child.pid, "SIGKILL"); } catch { /* exact child may have exited */ }
		await exited(child);
	}
}

try {
	modelServer = createServer((_request, response) => {
		providerRequests++;
		response.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "This provider fixture must not be called." }));
	});
	await new Promise<void>(ready => modelServer!.listen(0, "127.0.0.1", ready));
	modelServer.unref();
	const modelAddress = modelServer.address();
	const modelPort = modelAddress !== null && typeof modelAddress === "object" ? modelAddress.port : 0;
	check(modelPort > 0, "loopback model fixture bound");
	await writeFile(join(profileDir, "models.yml"), `providers:\n  cedia-host-crash-fixture:\n    baseUrl: http://127.0.0.1:${modelPort}/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: cedia-host-crash-fixture-model\n        name: Host crash fixture\n        api: openai-completions\n        reasoning: false\n        input: [text]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 128000\n        maxTokens: 4096\n`, { mode: 0o600 });

	host = spawnHost(`host-crash-first-${randomUUID()}`);
	const first = await descriptorFor(host);
	check(first.pid === host.pid, `first host process is identified exactly (${first.pid})`);
	const health1 = object(await request(first, "GET", "/v1/health"), "first host health");
	const firstIdentity = object(health1.identity, "first host identity");

	const project = object(await request(first, "POST", "/v1/projects", { path: workDir, name: "Host crash adoption fixture" }), "fixture project");
	check(typeof project.id === "string", "isolated fixture project is registered");
	const session = object(await request(first, "POST", "/v1/sessions", { projectId: project.id, title: "Surviving owner fixture", workspaceMode: "local" }), "fixture task");
	check(typeof session.id === "string" && typeof session.incarnation === "string", "isolated task has a durable identity");
	const sid = String(session.id);
	sessionId = sid;

	const started = object(await request(first, "POST", `/v1/sessions/${sid}/start`), "started task");
	check(started.status === "idle" || started.status === "running", `the task starts on the pinned owner (${String(started.status)})`);
	const ownerBefore = object(await request(first, "GET", `/v1/sessions/${sid}/owner`), "initial owner attachment");
	check(ownerBefore.state === "attached", "the host owns one authenticated OMP process before its crash");
	const identityBefore = object(ownerBefore.identity, "initial owner identity");
	const ompPid = Number(identityBefore.pid);
	check(Number.isSafeInteger(ompPid) && ompPid > 0 && ompPid !== first.pid, `the task OMP owner has its own PID (${ompPid})`);
	ownerPid = ompPid;
	const taskIncarnation = String(identityBefore.incarnation);
	incarnation = taskIncarnation;
	check(identityBefore.sessionId === sid && taskIncarnation.length > 0, "owner identity matches the task and incarnation");
	const ownerDirectory = join(stateDir, "sessions", sid);
	const ownerRecord = readCediaOwnerRecord(ownerDirectory);
	check(ownerRecord?.pid === ompPid && ownerRecord.incarnation === taskIncarnation, "the private on-disk owner record agrees with the authenticated owner probe");

	// Host process crash: the task runtime is not signalled and must retain its owner endpoint.
	process.kill(first.pid, "SIGKILL");
	const firstHost = host;
	await waitFor("the first host process to exit", async () => {
		if (firstHost.exitCode !== null || firstHost.signalCode !== null) return true;
		return undefined;
		}, 15_000);
	check(alive(ompPid), "OMP remains alive after SIGKILL of its exact host parent");
	const orphanProbe = await probeCediaOwner(ownerDirectory, { expected: { sessionId: sid, incarnation: taskIncarnation } });
	check(orphanProbe.state === "attached" && orphanProbe.identity.pid === ompPid, "the surviving OMP endpoint still authenticates the same task incarnation");

	// New host process: startup sees the existing task and claims the surviving owner lease.
	host = spawnHost(`host-crash-second-${randomUUID()}`);
	const second = await descriptorFor(host);
	check(second.pid === host.pid && second.pid !== first.pid, `a distinct host process restarted (${second.pid})`);
	const health2 = object(await request(second, "GET", "/v1/health"), "restarted host health");
	const secondIdentity = object(health2.identity, "restarted host identity");
	check(secondIdentity.generation !== firstIdentity.generation, "the restarted host has a new host generation");
	const taskAfterCrash = object(await request(second, "GET", `/v1/sessions/${sid}`), "task after host crash");
	check(taskAfterCrash.id === sid && taskAfterCrash.incarnation === taskIncarnation, "the durable task keeps its original id and incarnation");
	const adopted = object(await request(second, "POST", `/v1/sessions/${sid}/start`), "adopted task");
	check(adopted.incarnation === taskIncarnation, "the new host adopts without rotating the task incarnation");
	const ownerAfter = object(await request(second, "GET", `/v1/sessions/${sid}/owner`), "owner after host adoption");
	const identityAfter = object(ownerAfter.identity, "adopted owner identity");
	check(ownerAfter.state === "attached" && identityAfter.pid === ompPid && identityAfter.incarnation === taskIncarnation,
		`the new host controls the same OMP PID and incarnation (${ompPid})`);
	const summary = object(await request(second, "GET", `/v1/sessions/${sid}/owner/summary`), "adopted owner summary");
	check(summary.state === "available", `the new host reads the surviving OMP owner's live state (${String(summary.state)})`);
	check(alive(ompPid), "no replacement OMP process was needed");
	check(providerRequests === 0, "the lifecycle proof made zero loopback model/provider requests");

	const result = {
		ok: true,
		runtimeVersion,
		providerRequests,
		hostProcessIds: [first.pid, second.pid],
		hostGenerationsChanged: secondIdentity.generation !== firstIdentity.generation,
		sessionId: sid,
		incarnation: taskIncarnation,
		ompOwnerPid: ompPid,
		ownerPidPreserved: identityAfter.pid === ompPid,
		ownerState: summary.state,
	};
	await writeFile(join(resultRoot, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
	console.log(JSON.stringify(result, null, 2));
	await stopHost(host);
	host = undefined;
	// stopHost detaches the adopted owner by design; this proof owns the exact child and reaps it.
	check(alive(ompPid), "graceful host close leaves the adopted owner alone until its explicit cleanup");
	const finalProbe = await probeCediaOwner(ownerDirectory, { expected: { sessionId: sid, incarnation: taskIncarnation } });
	if (finalProbe.state === "attached" && finalProbe.identity.pid === ompPid) process.kill(ompPid, "SIGTERM");
	await waitFor("the exact scratch OMP process to exit", async () => alive(ompPid) ? undefined : true, 10_000);
	ownerPid = undefined;
	console.log(`Evidence result: ${join(resultRoot, "result.json")}`);
} catch (error) {
	await writeFile(join(resultRoot, "failure.json"), `${JSON.stringify({ error: error instanceof Error ? error.stack ?? error.message : String(error), hostOutput }, null, 2)}\n`);
	throw error;
} finally {
	await stopHost(host);
	if (ownerPid !== undefined && sessionId !== undefined && incarnation !== undefined) {
		const record = readCediaOwnerRecord(join(stateDir, "sessions", sessionId));
		if (record?.pid === ownerPid && record.incarnation === incarnation) {
			const probe = await probeCediaOwner(join(stateDir, "sessions", sessionId), { expected: { sessionId, incarnation } }).catch(() => ({ state: "conflict" as const, reason: "probe failed" }));
			if (probe.state === "attached" && probe.identity.pid === ownerPid && alive(ownerPid)) {
				try { process.kill(ownerPid, "SIGTERM"); } catch { /* exact scratch owner may already have exited */ }
			}
		}
	}
	if (modelServer?.listening) await new Promise<void>(resolveClose => modelServer!.close(() => resolveClose()));
	await delay(100);
	await Promise.all([
		rm(stateDir, { recursive: true, force: true }),
		rm(profileDir, { recursive: true, force: true }),
		rm(workDir, { recursive: true, force: true }),
	]);
}
