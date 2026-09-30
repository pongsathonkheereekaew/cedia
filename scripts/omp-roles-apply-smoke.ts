/**
 * Live proof of Cedia's O03 model-role application against the pinned runtime.
 *
 * Configuring a role only writes the mapping; activating one switches the session.
 * This smoke configures two fixture roles through `config.yml`, reads the mapping
 * through the registered `model.roles.get`, applies one through the registered
 * `model.roles.apply`, and verifies the session really runs that model afterwards
 * through `model.state.get`. An unconfigured role is refused, never defaulted.
 * Then it proves the host routes carry the same mapping (controller-visible) and
 * the durable owner-only apply with replay. No provider request is made anywhere.
 *
 * Run: bun scripts/omp-roles-apply-smoke.ts
 */
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP roles smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP roles smoke failed: ${message}`);
	return value as Record<string, unknown>;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
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

const modelsYaml = `providers:
  fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-roles-base
        name: Cedia roles smoke base
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
      - id: cedia-roles-fast
        name: Cedia roles smoke fast
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;
const rolesYaml = `modelRoles:
  default: fixture/cedia-roles-base
  smol: fixture/cedia-roles-fast
`;

const cwd = await mkdtemp(join(tmpdir(), "cedia-roles-"));
await writeFile(join(cwd, "models.yml"), modelsYaml);
await writeFile(join(cwd, "config.yml"), rolesYaml);

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
	const mapping = record(record((await client.requestCedia("cedia_control", { operation: "model.roles.get" })).data, "cedia_control data").result, "model.roles.get result");
	check(Array.isArray(mapping.roles) && (mapping.roles as unknown[]).length === 2, "the runtime reports both configured roles");
	const applied = record(record((await client.requestCedia("cedia_control", { operation: "model.roles.apply", payload: { role: "smol" } })).data, "cedia_control data").result, "model.roles.apply result");
	check(applied.role === "smol" && applied.provider === "fixture" && applied.model === "cedia-roles-fast", "applying smol answers the fast model");
	const state = record(record((await client.requestCedia("cedia_control", { operation: "model.state.get" })).data, "cedia_control data").result, "model.state.get result");
	const liveModel = record(state.model, "live session model");
	check(liveModel.provider === "fixture" && liveModel.id === "cedia-roles-fast", "the session really runs the applied role model afterwards");
	let refused = false;
	try {
		await client.requestCedia("cedia_control", { operation: "model.roles.apply", payload: { role: "vision" } });
	} catch (error) {
		refused = /No model is configured for role/.test(error instanceof Error ? error.message : String(error));
	}
	check(refused, "an unconfigured role is refused instead of defaulting");
	const assigned = record(record((await client.requestCedia("cedia_control", { operation: "model.roles.set", payload: { role: "smol", modelId: "fixture/cedia-roles-base" } })).data, "cedia_control data").result, "model.roles.set result");
	const assignedSmol = (assigned.roles as unknown[]).find(row => record(row, "role row").role === "smol");
	check(record(assignedSmol, "assigned smol row").modelId === "fixture/cedia-roles-base", "setting smol answers the table with the new mapping");
	const rereadMapping = record(record((await client.requestCedia("cedia_control", { operation: "model.roles.get" })).data, "cedia_control data").result, "model.roles.get reread");
	const rereadSmol = (rereadMapping.roles as unknown[]).find(row => record(row, "role row").role === "smol");
	check(record(rereadSmol, "reread smol row").modelId === "fixture/cedia-roles-base", "a later get reads the assigned mapping back");
	const appliedBase = record(record((await client.requestCedia("cedia_control", { operation: "model.roles.apply", payload: { role: "smol" } })).data, "cedia_control data").result, "model.roles.apply after set");
	check(appliedBase.model === "cedia-roles-base", "applying after set activates the newly assigned model");
	const restored = record(record((await client.requestCedia("cedia_control", { operation: "model.roles.set", payload: { role: "smol", modelId: "fixture/cedia-roles-fast" } })).data, "cedia_control data").result, "model.roles.set restore");
	check((restored.roles as unknown[]).some(row => record(row, "role row").role === "smol" && record(row, "role row").modelId === "fixture/cedia-roles-fast"), "restoring smol answers the fast mapping again");
	const temped = record(record((await client.requestCedia("cedia_control", { operation: "model.roles.set", payload: { role: "temp", modelId: "fixture/cedia-roles-base" } })).data, "cedia_control data").result, "model.roles.set temp");
	console.log(`live temp-role table: ${JSON.stringify((temped.roles as unknown[]).map(row => record(row, "role row").role))}`);
	const cleared = record(record((await client.requestCedia("cedia_control", { operation: "model.roles.set", payload: { role: "temp", modelId: null } })).data, "cedia_control data").result, "model.roles.set clear");
	const clearedRoles = (cleared.roles as unknown[]).map(row => record(row, "role row").role);
	console.log(`live cleared table roles: ${JSON.stringify(clearedRoles)}`);
	const clearedSmol = (cleared.roles as unknown[]).find(row => record(row, "role row").role === "smol");
	check(record(clearedSmol, "cleared smol row").modelId === "fixture/cedia-roles-fast", "clearing temp leaves the sibling mapping intact");
	for (const [label, payload] of [
		["empty payload", {}],
		["unknown field", { role: "smol", modelId: "fixture/cedia-roles-base", extra: true }],
		["blank role", { role: "  ", modelId: "fixture/cedia-roles-base" }],
	] as const) {
		let rejected = false;
		try {
			await client.requestCedia("cedia_control", { operation: "model.roles.set", payload });
		} catch (error) {
			rejected = /needs a role|takes only/.test(error instanceof Error ? error.message : String(error));
		}
		check(rejected, `${label} is refused by the operation payload rule (${label})`);
	}
	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
}

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-roles-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-roles-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-roles-host-work-"));
await writeFile(join(hostProfileDir, "models.yml"), modelsYaml, { mode: 0o600 });
await writeFile(join(hostProfileDir, "config.yml"), rolesYaml, { mode: 0o600 });
const started = await startHostServer({
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
try {
	const owner = started.auth.ownerToken;
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Roles smoke" });
	const session = started.host.createSession(project.id, "Roles smoke");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/roles`, token: owner });
	const beforeBody = record(before.body, "roles body before start");
	check(before.status === 200 && beforeBody.available === false && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);
	const incarnation = started.host.store.getSession(session.id)!.incarnation;
	const controller = started.auth.issue("roles-controller");

	const mapping = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/roles`, token: controller.token });
	const mappingBody = record(mapping.body, "live roles body");
	check(mapping.status === 200 && mappingBody.available === true && Array.isArray(mappingBody.roles) && (mappingBody.roles as unknown[]).length === 2, "the mapping reads controller-visible with both roles");

	const denied = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/roles/apply`, token: controller.token, body: { commandId: "roles-smoke-no", incarnation, role: "smol" } });
	check(denied.status === 403, "a controller may read roles but never apply one");

	const applied = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/roles/apply`, token: owner, body: { commandId: "roles-smoke-apply", incarnation, role: "smol" } });
	const appliedBody = record(applied.body, "roles apply body");
	check(applied.status === 200 && appliedBody.role === "smol" && appliedBody.model === "cedia-roles-fast", "the owner apply answers the fast model");

	const replayed = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/roles/apply`, token: owner, body: { commandId: "roles-smoke-apply", incarnation, role: "smol" } });
	check(JSON.stringify(replayed.body) === JSON.stringify(applied.body), "a repeated apply command id replays the same receipt");

	const reread = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/model-state`, token: owner });
	const rereadModel = record(record(reread.body, "model-state body").model, "live session model");
	check(rereadModel.id === "cedia-roles-fast", "the host session really runs the applied role model afterwards");

	for (const [label, body] of [
		["extra field", { commandId: "roles-smoke-bad-1", incarnation, role: "smol", extra: true }],
		["blank role", { commandId: "roles-smoke-bad-2", incarnation, role: "  " }],
		["missing role", { commandId: "roles-smoke-bad-3", incarnation }],
	] as const) {
		const refused = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/roles/apply`, token: owner, body });
		check(refused.status === 400, `${label} is refused before any runtime call (${refused.status})`);
	}
	const stale = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/roles/apply`, token: owner, body: { commandId: "roles-smoke-stale", incarnation: "old", role: "smol" } });
	check(stale.status === 409, "a stale incarnation is refused (409)");
	const setDenied = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/roles/set`, token: controller.token, body: { commandId: "roles-smoke-set-no", incarnation, role: "smol", modelId: "fixture/cedia-roles-base" } });
	check(setDenied.status === 403, "a controller may read roles but never assign one");
	const setAnswer = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/roles/set`, token: owner, body: { commandId: "roles-smoke-set", incarnation, role: "smol", modelId: "fixture/cedia-roles-base" } });
	const setBody = record(setAnswer.body, "roles set body");
	check(setAnswer.status === 200 && Array.isArray(setBody.roles) && (setBody.roles as unknown[]).some(row => record(row, "role row").role === "smol" && record(row, "role row").modelId === "fixture/cedia-roles-base"), "the owner set answers the table with the new mapping");
	const setReplayed = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/roles/set`, token: owner, body: { commandId: "roles-smoke-set", incarnation, role: "smol", modelId: "fixture/cedia-roles-base" } });
	check(JSON.stringify(setReplayed.body) === JSON.stringify(setAnswer.body), "a repeated set command id replays the same receipt");
	const setReread = record((await started.router({ method: "GET", path: `/v1/sessions/${session.id}/roles`, token: owner })).body, "roles reread body");
	check(Array.isArray(setReread.roles) && (setReread.roles as unknown[]).some(row => record(row, "role row").role === "smol" && record(row, "role row").modelId === "fixture/cedia-roles-base"), "a later get reads the assigned mapping back");
	const cleared = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/roles/set`, token: owner, body: { commandId: "roles-smoke-clear", incarnation, role: "smol", modelId: null } });
	const clearedBody = record(cleared.body, "roles clear body");
	check(cleared.status === 200 && Array.isArray(clearedBody.roles) && !(clearedBody.roles as unknown[]).some(row => record(row, "role row").role === "smol"), "clearing answers the table without the row");
	for (const [label, body] of [
		["extra field", { commandId: "roles-smoke-set-bad-1", incarnation, role: "smol", modelId: "fixture/cedia-roles-base", extra: true }],
		["blank role", { commandId: "roles-smoke-set-bad-2", incarnation, role: "  ", modelId: "fixture/cedia-roles-base" }],
		["non-string model", { commandId: "roles-smoke-set-bad-3", incarnation, role: "smol", modelId: 7 }],
		["missing model", { commandId: "roles-smoke-set-bad-4", incarnation, role: "smol" }],
	] as const) {
		const refused = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/roles/set`, token: owner, body });
		check(refused.status === 400, `${label} is refused before any runtime call (${refused.status})`);
	}
	const setStale = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/roles/set`, token: owner, body: { commandId: "roles-smoke-set-stale", incarnation: "old", role: "smol", modelId: "fixture/cedia-roles-base" } });
	check(setStale.status === 409, "a stale incarnation is refused for set (409)");
} finally {
	await started.close();
}

await Promise.all([
	rm(cwd, { recursive: true, force: true }),
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
]);
console.log("OMP roles smoke passed: the mapping reads, the apply switches, the session proves it.");
