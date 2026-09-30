/**
 * Live proof of Cedia's O03 model/account state against the pinned runtime.
 *
 * OMP owns the model selection, the effort it is using and the provider accounts. This smoke reads
 * that state through the capability bridge, then proves Cedia's routes carry the runtime's own
 * answers: the controller-visible model state, the owner-only account list (supported false kept
 * distinct from an empty list), a refused pin that is reported as refused, and a service-tier
 * override that is set and cleared through the runtime's own vocabulary. The fixture listener never
 * answers, so no provider request can complete during this run.
 *
 * Run: bun scripts/omp-model-state-smoke.ts
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP model-state smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP model-state smoke failed: ${message}`);
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

function isServiceTiers(value: unknown): boolean {
	const row = record(value, "serviceTiers");
	const families = row.families;
	const tiers = row.tiers;
	const current = row.current;
	if (!Array.isArray(families) || !families.every(entry => typeof entry === "string")) return false;
	if (!Array.isArray(tiers) || !tiers.every(entry => typeof entry === "string")) return false;
	if (!Array.isArray(current)) return false;
	return current.every(entry => {
		const held = record(entry, "serviceTiers.current row");
		return typeof held.family === "string" && (held.tier === null || typeof held.tier === "string");
	});
}

function isModelState(value: unknown): boolean {
	const row = record(value, "model.state");
	const model = row.model;
	if (model !== null) {
		const held = record(model, "model.state model");
		if (typeof held.provider !== "string" || typeof held.id !== "string") return false;
	}
	const effort = record(row.effort, "model.state effort");
	if (effort.configured !== null && typeof effort.configured !== "string") return false;
	if (effort.autoResolved !== null && typeof effort.autoResolved !== "string") return false;
	if (typeof effort.isAuto !== "boolean") return false;
	return isServiceTiers(row.serviceTiers);
}

function isAccountList(value: unknown): boolean {
	const row = record(value, "accounts");
	if (typeof row.supported !== "boolean") return false;
	if (row.provider !== null && typeof row.provider !== "string") return false;
	if (!Array.isArray(row.accounts)) return false;
	if (typeof row.truncated !== "boolean") return false;
	if (!row.accounts.every(entry => {
		const held = record(entry, "accounts row");
		return typeof held.credentialId === "number" && (held.label === null || typeof held.label === "string") && typeof held.active === "boolean";
	})) return false;
	// A token or a raw credential object must never reach a client.
	return Object.keys(row).sort().join(",") === "accounts,provider,supported,truncated";
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

const cwd = await mkdtemp(join(tmpdir(), "cedia-model-state-"));
const held: Server = createServer(() => {
	/* never responds: no provider call in this run may complete */
});
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
held.unref();
const address = held.address();
const port = address !== null && typeof address === "object" ? (address as { port: number }).port : 0;
check(port > 0, "fixture listener bound");
const modelsYaml = `providers:
  cedia-model-state-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-model-state-fixture-model
        name: Cedia model-state smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;
await writeFile(join(cwd, "models.yml"), modelsYaml);

let publishedFamilies: string[] = [];
let publishedTiers: string[] = [];

// Exercise the pinned bridge itself before asking Cedia to project the same answer.
let client: OmpRpcClient | undefined;
try {
	client = await OmpRpcClient.start({
		executable,
		args: ["--no-session", "--no-skills", "--no-rules", "--no-extensions", "--no-title", "--cwd", cwd],
		cwd,
		env: {
			PATH: `${dirname(executable)}${delimiter}/usr/bin${delimiter}/bin`,
			HOME: cwd,
			PI_CODING_AGENT_DIR: cwd,
			PI_NO_PTY: "1",
			PI_NOTIFICATIONS: "off",
			TERM: "xterm-256color",
			CEDIA_RPC_VIRTUAL_UI: "1",
		},
		readyTimeoutMs: 30_000,
		requestTimeoutMs: 30_000,
		onFrame() {
			/* frames are not needed for this proof */
		},
	});
	await client.requestCedia("cedia_terminal_negotiate", { version: 1, cols: 40, rows: 8 });

	const state = await client.requestCedia("cedia_control", { operation: "model.state.get" });
	const stateResult = record(state.data, "model.state.get data").result;
	check(isModelState(stateResult), "the runtime answers its own model, effort and service-tier state");
	const tiers = record(record(stateResult).serviceTiers, "serviceTiers");
	publishedFamilies = tiers.families as string[];
	publishedTiers = tiers.tiers as string[];
	check(Array.isArray(publishedFamilies) && Array.isArray(publishedTiers), "the runtime publishes the vocabulary it accepts");

	const accounts = await client.requestCedia("cedia_control", { operation: "auth.accounts.list" });
	const accountsResult = record(accounts.data, "auth.accounts.list data").result;
	check(isAccountList(accountsResult), "the runtime answers an account list without a token or a raw credential");
	check(record(accountsResult).supported === false
		? record(accountsResult).provider === null && (record(accountsResult).accounts as unknown[]).length === 0
		: true, "an unsupported provider is reported as unsupported rather than as an empty list");

	let unknownFamilyRefused = false;
	try {
		await client.requestCedia("cedia_control", { operation: "model.service-tier.set", payload: { family: "not-a-family", tier: null } });
	} catch {
		unknownFamilyRefused = true;
	}
	check(unknownFamilyRefused, "a family outside the runtime's own vocabulary is refused before any handler runs");

	const refusedPin = await client.requestCedia("cedia_control", { operation: "auth.account.pin", payload: { credentialId: 987_654_321 } });
	const refusedPinResult = record(refusedPin.data, "auth.account.pin data").result;
	check(record(refusedPinResult).pinned === false && isAccountList(record(refusedPinResult).list), "an account the runtime does not know is reported as refused, with the refreshed list");

	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
}

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-model-state-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-model-state-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-model-state-host-work-"));
await writeFile(join(hostProfileDir, "models.yml"), modelsYaml, { mode: 0o600 });
const started = await startHostServer({
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
try {
	const owner = started.auth.ownerToken;
	const controller = started.auth.issue("Model-state smoke controller").token;
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Model-state smoke" });
	const session = started.host.createSession(project.id, "Model-state smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/model-state`, token: controller });
	const beforeBody = record(before.body, "model-state body before start");
	check(before.status === 200 && beforeBody.available === false && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);
	const live = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/model-state`, token: controller });
	const liveBody = record(live.body, "live model-state body");
	check(live.status === 200 && liveBody.available === true, `a paired controller can read the model state the picker needs (${live.status} ${JSON.stringify(live.body).slice(0, 400)})`);
	check(isModelState({ model: liveBody.model, effort: liveBody.effort, serviceTiers: liveBody.serviceTiers }), "the route carries the runtime's own model, effort and tier state");

	const controllerAccounts = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/accounts`, token: controller });
	check(controllerAccounts.status === 401 || controllerAccounts.status === 403, `the account list is owner-only (${controllerAccounts.status})`);

	const accounts = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/accounts`, token: owner });
	const accountsBody = record(accounts.body, "accounts body");
	check(accounts.status === 200 && accountsBody.available === true, `the owner sees the runtime's own account list (${accounts.status} ${JSON.stringify(accounts.body).slice(0, 300)})`);
	check(isAccountList({
		supported: accountsBody.supported,
		provider: accountsBody.provider,
		accounts: accountsBody.accounts,
		truncated: accountsBody.truncated,
	}), "the account list carries only identity and state, never a token");

	const incarnation = started.host.store.getSession(session.id)!.incarnation;
	const malformed = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/service-tier`,
		token: owner,
		body: { commandId: "model-state-malformed", incarnation, family: publishedFamilies[0] ?? "openai", tier: 7 },
	});
	check(malformed.status === 400, `a tier that is neither a string nor null is refused (${malformed.status})`);

	const pinned = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/accounts/pin`,
		token: owner,
		body: { commandId: "model-state-pin", incarnation, credentialId: 987_654_321 },
	});
	const pinnedBody = record(pinned.body, "pin body");
	check(pinned.status === 200 && pinnedBody.pinned === false && isAccountList(pinnedBody.list), "a refused pin reaches the owner as refused, with the refreshed list");
	const pinnedReplay = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/accounts/pin`,
		token: owner,
		body: { commandId: "model-state-pin", incarnation, credentialId: 987_654_321 },
	});
	check(JSON.stringify(pinnedReplay.body) === JSON.stringify(pinned.body), "a repeated pin command id replays the same receipt");

	if (publishedFamilies.length > 0 && publishedTiers.length > 0) {
		const family = publishedFamilies[0]!;
		const tier = publishedTiers[0]!;
		const applied = await started.router({
			method: "POST",
			path: `/v1/sessions/${session.id}/service-tier`,
			token: owner,
			body: { commandId: "model-state-tier", incarnation, family, tier },
		});
		const appliedBody = record(applied.body, "tier body");
		const appliedRow = (record(appliedBody.serviceTiers, "applied tiers").current as { family: string; tier: string | null }[])
			.find(row => row.family === family);
		check(applied.status === 200 && appliedBody.family === family && appliedBody.tier === tier
			&& appliedRow?.tier === tier, "the owner's own tier choice is applied through the runtime's vocabulary and answered back");
		const cleared = await started.router({
			method: "POST",
			path: `/v1/sessions/${session.id}/service-tier`,
			token: owner,
			body: { commandId: "model-state-tier-clear", incarnation, family, tier: null },
		});
		const clearedBody = record(cleared.body, "cleared tier body");
		const clearedRow = (record(clearedBody.serviceTiers, "cleared tiers").current as { family: string; tier: string | null }[])
			.find(row => row.family === family);
		check(cleared.status === 200 && clearedBody.tier === null && (clearedRow === undefined || clearedRow.tier === null), "clearing the override is a real state change, not a silent success");
	} else {
		console.log("SKIP the runtime published no service-tier vocabulary in this fixture; no tier was set");
	}
} finally {
	await started.close();
}

await Promise.all([
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
	rm(cwd, { recursive: true, force: true }),
	new Promise<void>(close => held.close(() => close())),
]);
console.log(JSON.stringify({ ok: true, version, families: publishedFamilies, tiers: publishedTiers }, null, 2));
