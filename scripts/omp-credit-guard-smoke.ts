/**
 * Live proof of Cedia's credit policy guard against the pinned runtime (plan §2.8).
 *
 * The rule is that a Cedia-controlled runtime never spends a saved Codex reset on its own and never
 * writes an answer into the owner's shared configuration. These checks prove the mechanism at three
 * levels, with no model endpoint answering and no credit ever touched:
 *
 * 1. a runtime started without the flag is *not* guarded and reports the stored value unchanged
 *    (stock OMP behaviour is preserved for a process Cedia did not start);
 * 2. a runtime started with the flag overrides a stored `yes` to `no` and says why, while the stored
 *    value reads back unchanged;
 * 3. the host Cedia actually runs with sets that flag by itself - the policy the owner route answers
 *    is read from a runtime the host spawned, so the guard cannot be remembered rather than applied.
 *
 * Run: bun scripts/omp-credit-guard-smoke.ts
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP credit guard smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP credit guard smoke failed: ${message}`);
	return value as Record<string, unknown>;
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

const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/")
	? resolve(requested)
	: ((process.env.PATH ?? "")
			.split(delimiter)
			.map(dir => join(dir, requested))
			.find(candidate => candidate) ?? requested);
check(await exists(executable), `OMP runtime is present at ${executable}`);
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `the runtime is the pinned ${OMP_BASELINE_VERSION} or later (${version})`);

const held: Server = createServer(() => {
	/* never responds: no provider call in this run may complete */
});
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
const address = held.address();
const port = address !== null && typeof address === "object" ? (address as { port: number }).port : 0;
check(port > 0, "fixture listener bound");
const modelsYaml = `providers:
  cedia-credit-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-credit-fixture-model
        name: Cedia credit smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;

/** Start one runtime in its own agent directory, optionally carrying Cedia's policy flag. */
async function runtime(
	directory: string,
	guarded: boolean,
): Promise<{
	client: OmpRpcClient;
	control: (operation: string, payload?: Record<string, unknown>) => Promise<Record<string, unknown>>;
}> {
	await writeFile(join(directory, "models.yml"), modelsYaml);
	const client = await OmpRpcClient.start({
		executable,
		args: ["--no-session", "--no-skills", "--no-rules", "--no-extensions", "--no-title", "--cwd", directory],
		cwd: directory,
		env: {
			PATH: `${dirname(executable)}${delimiter}/usr/bin${delimiter}/bin`,
			HOME: directory,
			PI_CODING_AGENT_DIR: directory,
			PI_NO_PTY: "1",
			PI_NOTIFICATIONS: "off",
			TERM: "xterm-256color",
			CEDIA_RPC_VIRTUAL_UI: "1",
			...(guarded ? { CEDIA_POLICY_CREDIT_GUARD: "1" } : {}),
		},
		readyTimeoutMs: 30_000,
		requestTimeoutMs: 30_000,
		onFrame() {
			/* frames are not needed for this proof */
		},
	});
	await client.requestCedia("cedia_terminal_negotiate", { version: 1, cols: 40, rows: 8 });
	const control = async (operation: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>> => {
		const ack = await client.requestCedia("cedia_control" as never, {
			operation,
			...(payload === undefined ? {} : { payload }),
		});
		return record(record(ack.data, "cedia_control data").result, `${operation} result`);
	};
	return { client, control };
}

const unguardedDir = await mkdtemp(join(tmpdir(), "cedia-credit-stock-"));
const guardedDir = await mkdtemp(join(tmpdir(), "cedia-credit-guarded-"));
const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-credit-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-credit-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-credit-host-work-"));

let unguarded: OmpRpcClient | undefined;
let guarded: OmpRpcClient | undefined;
try {
	// ---- 1. A runtime Cedia did not start keeps OMP's own behaviour ----
	const stock = await runtime(unguardedDir, false);
	unguarded = stock.client;
	const stockPolicy = await stock.control("policy.get");
	check(stockPolicy.guardActive === false, "a runtime started without Cedia's flag reports no guard");
	check(
		stockPolicy.stored === "unset" && stockPolicy.effective === "unset",
		"with no guard the stored value is the effective value",
	);
	check(stockPolicy.overridden === false && typeof stockPolicy.reason === "string", "an unguarded run says the stored value stands");
	await stock.client.close();
	unguarded = undefined;

	// ---- 2. A guarded runtime overrides a stored yes without rewriting it ----
	const policyRuntime = await runtime(guardedDir, true);
	guarded = policyRuntime.client;
	const before = await policyRuntime.control("policy.get");
	check(before.guardActive === true, "a runtime Cedia started reports the guard active");
	check(before.stored === "unset" && before.effective === "no", "the guard overrides an unset stored value to no");

	// The owner's configuration is written here deliberately by this test; the policy layer itself
	// never writes it, which is what the read-back below checks.
	await policyRuntime.control("settings.set", { path: "codexResets.autoRedeem", value: "yes" });
	const after = await policyRuntime.control("policy.get");
	check(after.stored === "yes", "the stored setting is read back as it was set (yes)");
	check(after.effective === "no", "the effective value is still no while the guard is active");
	check(after.overridden === true && typeof after.reason === "string", "the policy says it overrode the stored value, and why");
	const readBack = await policyRuntime.control("settings.get", { path: "codexResets.autoRedeem" });
	check(readBack.value === "yes", "the policy layer did not rewrite the stored setting");
	await policyRuntime.client.close();
	guarded = undefined;

	// ---- 3. Host usage read + runtime/host reconnect preserve the inherited `yes` ----
	await writeFile(join(hostProfileDir, "models.yml"), modelsYaml, { mode: 0o600 });
	const startHost = () => startHostServer({
		stateDir: hostStateDir,
		port: 0,
		ompExecutable: executable,
		virtualUi: true,
		ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
	});
	let started = await startHost();
	try {
		const project = started.host.store.createProject({ path: hostWorkDir, name: "Credit smoke" });
		const session = started.host.createSession(project.id, "Credit smoke");
		const setStoredYes = async (host: typeof started, incarnation: string, commandId: string) => {
			const command = await host.host.command(session.id, "credit-smoke-owner", {
				commandId, incarnation, command: "cedia_control",
				payload: { operation: "settings.set", payload: { path: "codexResets.autoRedeem", value: "yes" } },
			});
			check(command.status === "completed", `the fixture's shared autoRedeem setting writes through OMP (${command.status})`);
		};
		const checkGuardAndUsage = async (host: typeof started, token: string, phase: string) => {
			const live = await host.router({ method: "GET", path: "/v1/omp/policy", token });
			const liveBody = record(live.body, `${phase} policy body`);
			check(live.status === 200 && liveBody.state === "available", `${phase}: the owner policy route is available`);
			const answer = record(liveBody.answer, `${phase} policy answer`);
			check(answer.guardActive === true && answer.stored === "yes", `${phase}: the Cedia guard is active while stored autoRedeem remains yes`);
			check(answer.effective === "no" && answer.overridden === true, `${phase}: the effective autoRedeem mode remains no`);
			const usage = await host.router({ method: "GET", path: `/v1/sessions/${session.id}/usage`, token });
			check(usage.status === 200, `${phase}: the explicit usage query answers without redemption (${usage.status})`);
		};

		await started.host.startSession(session.id);
		let current = started.host.store.getSession(session.id)!;
		await setStoredYes(started, current.incarnation, "credit-smoke-set-yes-first");
		await checkGuardAndUsage(started, started.auth.ownerToken, "initial host runtime");
		const notOwner = await started.router({ method: "GET", path: "/v1/omp/policy" });
		check(notOwner.status === 401 || notOwner.status === 403, `the policy route is owner-only (${notOwner.status})`);

		await started.close();
		started = await startHost();
		const recovered = started.host.store.listSessions().find(row => row.id === session.id);
		check(recovered !== undefined, "the Cedia host reconnects to the persisted fixture task");
		await started.host.startSession(session.id);
		current = started.host.store.getSession(session.id)!;
		await checkGuardAndUsage(started, started.auth.ownerToken, "host/runtime after reconnect");
		const storedAfterReconnect = await started.host.command(session.id, "credit-smoke-owner", {
			commandId: "credit-smoke-read-yes-after-reconnect", incarnation: current.incarnation,
			command: "cedia_control", payload: { operation: "settings.get", payload: { path: "codexResets.autoRedeem" } },
		});
		const result = record(record(storedAfterReconnect.result, "settings read command result").data, "settings read data");
		check(record(result.result, "settings.get result").value === "yes", "the reconnect did not rewrite the owner's stored yes");
	} finally {
		await started?.close();
	}
} finally {
	await unguarded?.close().catch(() => {});
	await guarded?.close().catch(() => {});
	await Promise.all([
		rm(unguardedDir, { recursive: true, force: true }),
		rm(guardedDir, { recursive: true, force: true }),
		rm(hostStateDir, { recursive: true, force: true }),
		rm(hostProfileDir, { recursive: true, force: true }),
		rm(hostWorkDir, { recursive: true, force: true }),
		new Promise<void>(close => held.close(() => close())),
	]);
}

console.log(JSON.stringify({ ok: true, version }, null, 2));
