/**
 * Provider-free packaged Cedia app crash/relaunch attachment proof.
 *
 * A current-source host and idle OMP task owner are started on isolated scratch
 * state. A staged Cedia.app connects to that host, is SIGKILLed, then relaunched
 * with the same profile and state. The second app must show the same project and
 * task while the host, task incarnation and OMP owner PID remain unchanged.
 *
 * The proof harness owns the host lifetime; the host-process crash/adoption path
 * has its own receipt. This does not prove active-turn recovery, a Login Item
 * cycle, paired clients or D/W/N/F acceptance. No Keychain item, installed app,
 * provider or paid request is used.
 *
 * Run: CEDIA_APP_OWNER_ADOPTION_APP_PATH=/tmp/.../Cedia.app bun scripts/omp-packaged-app-owner-adoption-proof.ts
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer, type StartedHostServer } from "../apps/host/src/server.ts";
import { probeCediaOwner, readCediaOwnerRecord, readCediaOwnerSummary } from "../apps/host/src/owner-endpoint.ts";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import type { HostDescriptor } from "../packages/protocol/src/index.ts";

const root = resolve(import.meta.dir, "..");
const failPrefix = "OMP packaged app-owner adoption proof failed";
const { _electron } = createRequire(join(root, "desktop/package.json"))("playwright") as {
	_electron: {
		launch(options: Record<string, unknown>): Promise<{
			firstWindow(): Promise<any>;
			close(): Promise<void>;
		}>;
	};
};

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${failPrefix}: ${message}`);
	console.log(`OK   ${message}`);
}
function object(value: unknown, message: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${failPrefix}: ${message}`);
	return value as Record<string, unknown>;
}
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
async function waitFor<T>(label: string, read: () => Promise<T | undefined>, timeoutMs = 60_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await read();
		if (value !== undefined) return value;
		if (Date.now() >= deadline) throw new Error(`${failPrefix}: timed out waiting for ${label}`);
		await sleep(150);
	}
}
function alive(pid: number): boolean {
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
function packagedMainPid(appExecutable: string, userDataDir: string): number | undefined {
	const lines = execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" }).split("\n");
	const pids = lines.flatMap(line => {
		const match = line.trim().match(/^(\d+)\s+(.*)$/);
		if (!match) return [];
		const pid = Number(match[1]);
		const command = match[2] ?? "";
		return command.includes(appExecutable) && command.includes(userDataDir) ? [pid] : [];
	});
	if (pids.length > 1) throw new Error(`${failPrefix}: multiple staged app main processes match the scratch profile: ${pids.join(",")}`);
	return pids[0];
}

const appBundle = process.env.CEDIA_APP_OWNER_ADOPTION_APP_PATH;
check(typeof appBundle === "string" && appBundle.endsWith("/Cedia.app"),
	"CEDIA_APP_OWNER_ADOPTION_APP_PATH names an explicitly staged scratch Cedia.app");
const resolvedAppBundle = await realpath(resolve(appBundle));
const installedAppBundle = resolve(join(root, `VSCode-darwin-${process.arch}/Cedia.app`));
const tempRoot = await realpath(tmpdir());
check(resolvedAppBundle !== installedAppBundle && !resolvedAppBundle.startsWith(`${installedAppBundle}/`),
	"the repository's installed Cedia.app is never launched or modified");
check(resolvedAppBundle.startsWith(`${tempRoot}/`), "the staged app resides under the system temporary directory");
const appExecutable = join(resolvedAppBundle, "Contents/MacOS/Cedia");
await access(appExecutable);

// The staged lifecycle module traps only Login Item reads/writes. This proof
// does not exercise login behavior and never registers the scratch app.
const lifecycleModulePath = join(resolvedAppBundle, "Contents/Resources/app/out/vs/cedia/agent/main.cjs");
let lifecycleModule = await readFile(lifecycleModulePath, "utf8");
const setterNeedle = "setLoginItemSettings: (settings) => electronApp.setLoginItemSettings(settings),";
const getterNeedle = "wasOpenedAtLogin = electronApp.getLoginItemSettings().wasOpenedAtLogin === true;";
check(lifecycleModule.split(setterNeedle).length === 2 && lifecycleModule.split(getterNeedle).length === 2,
	"staged lifecycle module matches the reviewed Login Item interception points");
lifecycleModule = lifecycleModule
	.replace(setterNeedle, `setLoginItemSettings: (settings) => { require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "intercept-set-login-item", settings }) + "\\n"); },`)
	.replace(getterNeedle, `wasOpenedAtLogin = false; require("node:fs").appendFileSync(process.env.CEDIA_LIFECYCLE_SHIM_LOG, JSON.stringify({ event: "simulated-login-state", isPackaged: electronApp.isPackaged, openedAtLogin: false }) + "\\n");`);
check(lifecycleModule.includes("intercept-set-login-item") && lifecycleModule.includes("simulated-login-state"),
	"scratch-only Login Item interception markers are present");
await writeFile(lifecycleModulePath, lifecycleModule);
execFileSync("codesign", ["--force", "--deep", "--sign", "-", resolvedAppBundle], { stdio: "ignore" });

// Keep the profile path below the macOS Unix-domain socket length limit.
const scratch = await realpath(await mkdtemp(join(tmpdir(), "c-app-oa-")));
const profile = join(scratch, "user-data");
const home = join(scratch, "home");
const ompProfile = join(scratch, "omp-profile");
const stateDir = join(scratch, "host-state");
const workDir = join(scratch, "workspace");
const projectName = "Packaged app owner adoption";
const taskTitle = "Surviving OMP owner";
const output = join(root, "dist/packaged-app-owner-adoption-proof", new Date().toISOString().replace(/[:.]/g, "-"));
await Promise.all([
	mkdir(join(profile, "User"), { recursive: true }),
	mkdir(home, { recursive: true }),
	mkdir(ompProfile, { recursive: true }),
	mkdir(workDir, { recursive: true }),
	mkdir(output, { recursive: true }),
]);
const shimLog = join(scratch, "login-item-shim.jsonl");
await writeFile(join(profile, "User", "settings.json"), `${JSON.stringify({
	"cedia.hostStateDir": stateDir,
	"security.workspace.trust.enabled": false,
	"window.startupEditor": "none",
	"workbench.startupEditor": "none",
	"update.mode": "none",
	"telemetry.telemetryLevel": "off",
	"extensions.autoCheckUpdates": false,
}, null, 2)}\n`, { mode: 0o600 });

const requestedRuntime = process.env.CEDIA_OMP_PATH ?? "dist/omp/omp";
const runtime = resolve(root, requestedRuntime);
check(await access(runtime).then(() => true, () => false), `prepared OMP runtime exists at ${runtime}`);
const runtimeVersion = execFileSync(runtime, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(runtimeVersion), `OMP runtime is supported (${runtimeVersion}; baseline ${OMP_BASELINE_VERSION})`);

let providerRequests = 0;
let provider: Server | undefined;
let host: StartedHostServer | undefined;
let current: { app: Awaited<ReturnType<typeof _electron.launch>>; page: any } | undefined;
let hostDescriptor: HostDescriptor | undefined;
let sessionId: string | undefined;
let taskIncarnation: string | undefined;
let ownerPid: number | undefined;
const rendererErrors: string[] = [];
const appEnv = {
	...process.env,
	HOME: home,
	CEDIA_STATE_DIR: stateDir,
	CEDIA_LIFECYCLE_SHIM_LOG: shimLog,
	CEDIA_SIMULATE_LOGIN: "0",
};

async function launch(generation: string, label: string): Promise<void> {
	const app = await _electron.launch({
		executablePath: appExecutable,
		args: ["--user-data-dir", profile, "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
		env: { ...appEnv, CEDIA_APP_GENERATION: generation },
		timeout: 45_000,
	});
	current = { app, page: undefined };
	const page = await app.firstWindow();
	current.page = page;
	page.on("pageerror", (error: Error) => rendererErrors.push(error.message));
	await page.getByRole("button", { name: "Skip setup", exact: true }).first().click({ timeout: 15_000 }).catch(() => {});
	await page.getByText(projectName, { exact: true }).first().waitFor({ timeout: 60_000 });
	await page.getByText(taskTitle, { exact: true }).first().waitFor({ timeout: 45_000 });
	await page.screenshot({ path: join(output, `${label}.png`) });
	check(packagedMainPid(appExecutable, profile) !== undefined, `${label}: staged app window shows the existing project and task`);
}

async function readHost(): Promise<{ descriptor: HostDescriptor; identity: Record<string, unknown> } | undefined> {
	try {
		const descriptor = JSON.parse(await readFile(join(stateDir, "host.json"), "utf8")) as HostDescriptor;
		if (typeof descriptor.url !== "string" || typeof descriptor.token !== "string" || !Number.isSafeInteger(descriptor.pid)) return undefined;
		const response = await fetch(`${descriptor.url}/v1/health`, { headers: { Authorization: `Bearer ${descriptor.token}` }, signal: AbortSignal.timeout(1_000) });
		if (!response.ok) return undefined;
		const health = object(await response.json(), "host health response");
		const identity = object(health.identity, "host identity");
		if (health.protocolVersion !== descriptor.protocolVersion || identity.stateDir !== stateDir
			|| identity.processStartedAt !== descriptor.processStartedAt || identity.protocolVersion !== descriptor.protocolVersion) return undefined;
		return { descriptor, identity };
	} catch { return undefined; }
}

async function request(hostValue: HostDescriptor, method: string, path: string, body?: unknown): Promise<unknown> {
	const response = await fetch(`${hostValue.url}${path}`, {
		method,
		headers: { Authorization: `Bearer ${hostValue.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
		signal: AbortSignal.timeout(30_000),
	});
	const result = await response.json() as unknown;
	if (!response.ok) throw new Error(`${failPrefix}: ${method} ${path} returned ${response.status}: ${JSON.stringify(result)}`);
	return result;
}

async function closeCurrent(): Promise<void> {
	const active = current;
	current = undefined;
	if (!active) return;
	await active.app.close().catch(() => {});
	await waitFor("the exact staged app to close", async () => packagedMainPid(appExecutable, profile) === undefined ? true : undefined, 20_000).catch(() => {});
}

try {
	provider = createServer((_request, response) => {
		providerRequests++;
		response.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "This provider-free fixture must not be called." }));
	});
	await new Promise<void>(ready => provider!.listen(0, "127.0.0.1", ready));
	provider.unref();
	const providerAddress = provider.address();
	const providerPort = providerAddress !== null && typeof providerAddress === "object" ? providerAddress.port : 0;
	check(providerPort > 0, "loopback provider tripwire is bound");
	await writeFile(join(ompProfile, "models.yml"), `providers:\n  cedia-app-owner-fixture:\n    baseUrl: http://127.0.0.1:${providerPort}/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: cedia-app-owner-fixture-model\n        name: Packaged app adoption fixture\n        api: openai-completions\n        reasoning: false\n        input: [text]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 128000\n        maxTokens: 4096\n`, { mode: 0o600 });

	const firstGeneration = `app-owner-first-${randomUUID()}`;
	const previousGeneration = process.env.CEDIA_APP_GENERATION;
	process.env.CEDIA_APP_GENERATION = firstGeneration;
	try {
		host = await startHostServer({
			stateDir,
			ompExecutable: runtime,
			virtualUi: true,
			ownerBridge: true,
			ompEnv: { HOME: home, PI_CODING_AGENT_DIR: ompProfile, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off", CEDIA_NODE: process.execPath },
		});
	} finally {
		if (previousGeneration === undefined) delete process.env.CEDIA_APP_GENERATION;
		else process.env.CEDIA_APP_GENERATION = previousGeneration;
	}
	hostDescriptor = host.descriptor;
	const initialHost = await waitFor("the isolated host health endpoint", readHost, 10_000);
	check(initialHost.descriptor.pid === process.pid, "the fixture-owned source host is healthy on isolated state");
	check(initialHost.identity.appGeneration === firstGeneration, "the host identity is tied to the first app generation");

	const project = host.host.store.createProject({ path: workDir, name: projectName });
	const session = host.host.createSession(project.id, taskTitle);
	sessionId = session.id;
	check(sessionId.length > 0, "task is registered before the packaged app starts");
	const started = await host.host.startSession(sessionId);
	check(started.status === "idle" || started.status === "running", `the fixture OMP owner starts (${started.status})`);
	const attachment = await host.host.ownerAttachment(sessionId);
	check(attachment.state === "attached", "the fixture host owns an authenticated OMP task process");
	const ownerIdentity = object(attachment.identity, "owner identity before app crash");
	ownerPid = Number(ownerIdentity.pid);
	taskIncarnation = String(ownerIdentity.incarnation);
	check(Number.isSafeInteger(ownerPid) && ownerPid > 0 && ownerIdentity.sessionId === sessionId,
		"the authenticated owner identity matches the durable CEDIA task");
	const ownerDirectory = join(stateDir, "sessions", sessionId);
	const ownerRecord = readCediaOwnerRecord(ownerDirectory);
	check(ownerRecord?.pid === ownerPid && ownerRecord.incarnation === taskIncarnation,
		"the private owner record matches the authenticated task owner");
	const summaryBefore = await readCediaOwnerSummary(ownerDirectory, { expected: { sessionId, incarnation: taskIncarnation } });
	check(summaryBefore.state === "available", "the OMP owner summary is readable before app crash");

	await launch(firstGeneration, "app-before-crash");
	const observeMs = Number(process.env.CEDIA_CUA_OBSERVE_MS ?? "0");
	if (Number.isSafeInteger(observeMs) && observeMs > 0 && observeMs <= 60_000) {
		console.log(`CUA observation window open for ${observeMs} ms`);
		await sleep(observeMs);
	}

	const firstAppPid = packagedMainPid(appExecutable, profile);
	check(firstAppPid !== undefined, "the exact staged app process is identified before crash");
	process.kill(firstAppPid, "SIGKILL");
	await current?.app.close().catch(() => {});
	current = undefined;
	await waitFor("the first staged app process to exit", async () => packagedMainPid(appExecutable, profile) === undefined ? true : undefined, 20_000);
	const survivingHost = await readHost();
	check(survivingHost?.descriptor.pid === initialHost.descriptor.pid, "the same fixture host remains responsive after app crash");
	check(alive(ownerPid), "the app crash leaves the same OMP task process alive");
	const orphanProbe = await probeCediaOwner(ownerDirectory, { expected: { sessionId, incarnation: taskIncarnation } });
	check(orphanProbe.state === "attached" && orphanProbe.identity.pid === ownerPid,
		"the surviving OMP endpoint authenticates the exact task owner after app crash");

	const secondGeneration = `app-owner-second-${randomUUID()}`;
	await launch(secondGeneration, "app-after-crash-adoption");
	const adoptedHost = await waitFor("the fixture host after app relaunch", readHost, 10_000);
	check(adoptedHost.descriptor.pid === initialHost.descriptor.pid,
		`the relaunched app is connected to the same host process (${adoptedHost.descriptor.pid})`);
	check(adoptedHost.identity.generation === initialHost.identity.generation,
		"host generation remains unchanged across packaged app crash and relaunch");
	const taskAfterCrash = object(await request(adoptedHost.descriptor, "GET", `/v1/sessions/${sessionId}`), "task after app crash");
	check(taskAfterCrash.id === sessionId && taskAfterCrash.incarnation === taskIncarnation,
		"task id and incarnation are unchanged after app relaunch");
	const ownerAfter = object(await request(adoptedHost.descriptor, "GET", `/v1/sessions/${sessionId}/owner`), "owner after app relaunch");
	const identityAfter = object(ownerAfter.identity, "owner identity after app relaunch");
	check(ownerAfter.state === "attached" && identityAfter.pid === ownerPid && identityAfter.incarnation === taskIncarnation,
		`the same OMP owner PID and incarnation remain attached (${ownerPid})`);
	const summaryAfter = await readCediaOwnerSummary(ownerDirectory, { expected: { sessionId, incarnation: taskIncarnation } });
	check(summaryAfter.state === "available", "the relaunched app can read the surviving OMP owner's summary");
	check(providerRequests === 0, "the packaged app crash proof made zero provider requests");
	check(rendererErrors.length === 0, "both packaged app launches reported no renderer exceptions");

	const result = {
		ok: true,
		runtimeVersion,
		appGenerations: [firstGeneration, secondGeneration],
		appProcessIds: [firstAppPid, packagedMainPid(appExecutable, profile)],
		hostPid: adoptedHost.descriptor.pid,
		hostGeneration: adoptedHost.identity.generation,
		taskId: sessionId,
		incarnation: taskIncarnation,
		ompOwnerPid: ownerPid,
		ownerSummary: summaryAfter.state,
		providerRequests,
		loginItemInterceptions: (await readFile(shimLog, "utf8")).split("\n").filter(line => line.includes("intercept-set-login-item")).length,
	};
	await writeFile(join(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
	console.log(JSON.stringify(result, null, 2));
} catch (error) {
	await writeFile(join(output, "failure.json"), `${JSON.stringify({ error: error instanceof Error ? error.stack ?? error.message : String(error), rendererErrors }, null, 2)}\n`);
	throw error;
} finally {
	if (current && packagedMainPid(appExecutable, profile) !== undefined) await closeCurrent();
	if (host && sessionId) await host.host.stopSession(sessionId).catch(() => {});
	if (ownerPid !== undefined && taskIncarnation !== undefined && alive(ownerPid)) {
		const ownerDirectory = join(stateDir, "sessions", sessionId ?? "");
		const record = readCediaOwnerRecord(ownerDirectory);
		if (record?.pid === ownerPid && record.incarnation === taskIncarnation) {
			const probe = await probeCediaOwner(ownerDirectory, { expected: { sessionId: sessionId!, incarnation: taskIncarnation } }).catch(() => undefined);
			if (probe?.state === "attached" && probe.identity.pid === ownerPid && alive(ownerPid)) {
				try { process.kill(ownerPid, "SIGTERM"); } catch { /* the exact scratch owner may have exited */ }
				await waitFor("the exact scratch OMP owner to exit", async () => alive(ownerPid!) ? undefined : true, 10_000).catch(() => {});
			}
		}
	}
	if (host) await host.close().catch(() => {});
	if (provider?.listening) await new Promise<void>(done => provider!.close(() => done()));
	await rm(scratch, { recursive: true, force: true });
}
