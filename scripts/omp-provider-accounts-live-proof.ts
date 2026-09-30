/**
 * O03 provider-paths live proof: OAuth account list/pin shape + service-tier
 * set/readback against the real authenticated `opencode-go` provider.
 * Truth found 2026-09-29: opencode-go auth is API-key, so the account list is
 * honestly EMPTY (zero rows, no token material); pin-refusal and tier paths
 * are live. No OAuth account exists to pin — that row stays open by fact,
 * not by gap.
 *
 * Bounded: one host-backed session, read-mostly, no credit spend, no model
 * turn, no saved-reset redemption. HOME is the user's real profile.
 *
 * Run: bun scripts/omp-provider-accounts-live-proof.ts
 */
import { execFileSync } from "node:child_process";
import { delimiter, join, resolve } from "node:path";
import { homedir } from "node:os";
import { startHostServer } from "../apps/host/src/server.ts";
import { attestOmpRuntime } from "./lib/omp-runtime-integrity.ts";
import { isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";

const root = resolve(import.meta.dir, "..");
const failPrefix = "OMP provider-accounts live proof failed";
function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${failPrefix}: ${message}`);
	console.log(`OK   ${message}`);
}
function record(value: unknown, message: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${failPrefix}: ${message}`);
	return value as Record<string, unknown>;
}

const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/") ? resolve(requested)
	: (process.env.PATH ?? "").split(delimiter).map(dir => join(dir, requested)).find(Boolean) ?? requested;
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `runtime is pinned (${version})`);
const attestation = attestOmpRuntime(root, executable);

let host: Awaited<ReturnType<typeof startHostServer>> | undefined;
const diagnostic: Record<string, unknown> = { version, ...attestation };
try {
	host = await startHostServer({
		stateDir: join(homedir(), ".cedia-accounts-proof-state"),
		ompExecutable: executable,
		virtualUi: true,
		ompEnv: { ...process.env, HOME: homedir(), PI_NO_PTY: "1", PI_NOTIFICATIONS: "off", CEDIA_NODE: process.execPath },
	});
	const existing = host.host.store.listProjects().find(project => project.path === join(homedir(), ".cedia-accounts-proof-state"));
	const project = existing ?? host.host.store.createProject({ path: join(homedir(), ".cedia-accounts-proof-state"), name: "Accounts proof" });
	const session = host.host.createSession(project.id, "Accounts proof task");
	const started = await host.host.startSession(session.id);
	const route = (method: string, path: string, body?: unknown) =>
		host!.router({ method, path, token: host!.auth.ownerToken, ...(body === undefined ? {} : { body }) });

	// opencode-go must be authenticated or nothing below means anything.
	const providersResponse = await route("GET", "/v1/providers");
	check(providersResponse.status === 200, `provider auth metadata readable (${providersResponse.status})`);
	const providers = record(providersResponse.body, "providers body").providers;
	check(Array.isArray(providers), "provider list is an array");
	const go = (providers as unknown[]).map(row => record(row, "provider row")).find(row => row.id === "opencode-go");
	check(go?.authenticated === true && go?.available === true, "opencode-go is authenticated and available");
	diagnostic.providerAuthenticated = true;

	// Pick the real opencode-go model before reading accounts (accounts are per current provider).
	const selected = await host.host.command(session.id, "accounts-proof", {
		commandId: "accounts-proof-model", incarnation: started.incarnation,
		command: "set_model", payload: { provider: "opencode-go", modelId: "muse-spark-1.3-contributor" },
	});
	check(selected.status === "completed" || selected.status === "acknowledged", `opencode-go model selected (${selected.status})`);

	// Live OAuth account list. NOTE (2026-09-29): the runtime answers
	// `supported: true, provider: opencode-go` with zero accounts here — the
	// user's opencode-go auth is an API key, not OAuth, and an earlier probe
	// with a different launcher path answered `supported: false`. Either way
	// the list is empty of accounts AND of token material, and pin-refusal
	// stays honest. Assert exactly that (no fake rows, no leakage), not a
	// fixed supported flag.
	const accountsResponse = await route("GET", `/v1/sessions/${session.id}/accounts`);
	check(accountsResponse.status === 200, `accounts list answers (${accountsResponse.status})`);
	const accountsBody = record(accountsResponse.body, "accounts body");
	check(accountsBody.available === true, "accounts list is available");
	check(Array.isArray(accountsBody.accounts) && accountsBody.accounts.length === 0, "zero accounts listed, no fake rows");
	const rendered = JSON.stringify(accountsBody);
	check(!/token|secret|api[_-]?key|bearer/i.test(rendered), "accounts list carries no token material");
	diagnostic.accountsShape = { supported: accountsBody.supported, provider: accountsBody.provider, count: 0 };
	// Refused pin answers honestly with the refreshed (still empty) list.
	const refused = await route("POST", `/v1/sessions/${session.id}/accounts/pin`, {
		commandId: "accounts-proof-pin-refused", incarnation: started.incarnation, credentialId: 987_654_321,
	});
	const refusedBody = record(refused.body, "refused pin body");
	check(refusedBody.pinned === false && Array.isArray((refusedBody.list as Record<string, unknown>)?.accounts), "unknown pin refused with refreshed list");
	diagnostic.pinRefusalHonest = true;

	// Service tier set + readback against the runtime's own vocabulary.
	const tierSet = await route("POST", `/v1/sessions/${session.id}/service-tier`, {
		commandId: "accounts-proof-tier", incarnation: started.incarnation, family: "openai", tier: "default",
	});
	check(tierSet.status === 200, `service-tier set answers (${tierSet.status})`);
	const afterTier = record((await route("GET", `/v1/sessions/${session.id}/model-state`)).body, "model state after tier");
	check(JSON.stringify(afterTier).includes("default"), "service-tier choice reads back in model state");
	diagnostic.serviceTierSet = true;

	console.log(JSON.stringify({ ok: true, ...diagnostic, limits: "Live account+pin+tier; no credit spend, no model turn, no saved-reset redemption." }, null, 2));
	await host.host.stopSession(session.id).catch(() => {});
} finally {
	await host?.close().catch(() => {});
}
