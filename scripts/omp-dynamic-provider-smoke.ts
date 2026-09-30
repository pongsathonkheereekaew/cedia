/**
 * Prove a fixture extension can add/remove a provider in one live host/OMP session.
 * The owner reads OMP's per-session model registry and stale model selection is refused.
 * Run: bun scripts/omp-dynamic-provider-smoke.ts
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, stat, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import type { Json } from "../packages/protocol/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";
import { attestOmpRuntime } from "./lib/omp-runtime-integrity.ts";

const PROVIDER = "cedia_dynamic_fixture";
const MODEL_ID = "ephemeral-model";
function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP dynamic provider smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}
function record(value: unknown, message = "Expected object"): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP dynamic provider smoke failed: ${message}`);
	return value as Record<string, unknown>;
}
async function exists(path: string): Promise<boolean> {
	try { await stat(path); return true; } catch { return false; }
}
async function sha256(path: string): Promise<string> {
	return createHash("sha256").update(await readFile(path)).digest("hex");
}
async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
	const deadline = Date.now() + 30_000;
	let value = await read();
	while (!accept(value)) {
		if (Date.now() >= deadline) throw new Error(`OMP dynamic provider smoke failed: timed out waiting for ${label}`);
		await new Promise(resolveWait => setTimeout(resolveWait, 100));
		value = await read();
	}
	return value;
}
const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/") ? resolve(requested) : (process.env.PATH ?? "").split(delimiter).map(dir => join(dir, requested)).find(Boolean) ?? requested;
check(await exists(executable), `OMP runtime exists at ${executable}`);
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `runtime is pinned (${version})`);
let sourceTreeAttestation: unknown;
try { sourceTreeAttestation = attestOmpRuntime(resolve(import.meta.dir, ".."), executable); }
catch (error) { sourceTreeAttestation = { refused: String(error) }; }
const ompSource = resolve(import.meta.dir, "../upstream/omp");
const runtimeFingerprint = {
	executableSha256: await sha256(executable),
	rpcModeSha256: await sha256(join(ompSource, "packages/coding-agent/src/modes/rpc/rpc-mode.ts")),
	extensionLoaderSha256: await sha256(join(ompSource, "packages/coding-agent/src/extensibility/extensions/loader.ts")),
	extensionRunnerSha256: await sha256(join(ompSource, "packages/coding-agent/src/extensibility/extensions/runner.ts")),
	sourceTreeAttestation,
};

const projectDir = await mkdtemp(join(tmpdir(), "cedia-dynamic-provider-project-"));
const profileDir = await mkdtemp(join(tmpdir(), "cedia-dynamic-provider-profile-"));
const stateDir = await mkdtemp(join(tmpdir(), "cedia-dynamic-provider-state-"));
let providerCalls = 0;
const held: Server = createServer(() => { providerCalls++; /* deliberately never answer: inference is out of scope */ });
await new Promise<void>(ready => held.listen(0, "127.0.0.1", ready));
held.unref();
const address = held.address();
check(address !== null && typeof address === "object", "loopback fixture bound");
const extensionPath = join(projectDir, "dynamic-provider.ts");
const hostLockExtension = resolve(import.meta.dir, "../apps/host/src/runtime-lock.ts");
await writeFile(extensionPath, `import lockOmpSession from ${JSON.stringify(hostLockExtension)};
export default function (pi) {
	lockOmpSession();
	pi.registerCommand("dynamic-provider", {
		description: "Toggle the isolated dynamic provider fixture",
		handler: async (args, ctx) => {
			const action = args.trim();
			if (action === "add") {
				pi.registerProvider(${JSON.stringify(PROVIDER)}, {
					baseUrl: ${JSON.stringify(`http://127.0.0.1:${address.port}/v1`)},
					apiKey: "fixture-key-never-used",
					authHeader: false,
					api: "openai-completions",
					models: [{ id: ${JSON.stringify(MODEL_ID)}, name: "Ephemeral Fixture Model", reasoning: false, input: ["text"], cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}, contextWindow: 8192, maxTokens: 1024 }],
				});
				ctx.ui.notify("dynamic provider added", "info");
				return;
			}
			if (action === "remove") {
				pi.unregisterProvider(${JSON.stringify(PROVIDER)});
				ctx.ui.notify("dynamic provider removed", "info");
				return;
			}
			throw new Error("Use /dynamic-provider add or /dynamic-provider remove");
		},
	});
}
`, { mode: 0o600 });
await writeFile(join(profileDir, "models.yml"), `providers:\n  cedia-dynamic-baseline:\n    baseUrl: http://127.0.0.1:${address.port}/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: baseline-model\n        name: Baseline fixture model\n        api: openai-completions\n        reasoning: false\n        input: [text]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 8192\n        maxTokens: 1024\n`, { mode: 0o600 });

let host = await startHostServer({
	stateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	lockExtension: extensionPath,
	ompEnv: { HOME: profileDir, PI_CODING_AGENT_DIR: profileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
try {
	const project = host.host.store.createProject({ path: projectDir, name: "Dynamic provider fixture" });
	const session = host.host.createSession(project.id, "Dynamic provider fixture");
	await host.host.startSession(session.id);
	let commandIndex = 0;
	const incarnation = host.host.store.getSession(session.id)!.incarnation;
	const send = (command: string, payload: { [key: string]: Json }) => host.host.command(session.id, "dynamic-provider-smoke", {
		commandId: `dynamic-provider-${++commandIndex}`,
		incarnation,
		command,
		payload,
	});
	const commandIds: string[] = [];
	const sendTracked = (command: string, payload: { [key: string]: Json }) => {
		const commandId = `dynamic-provider-${++commandIndex}`;
		commandIds.push(commandId);
		return host.host.command(session.id, "dynamic-provider-smoke", { commandId, incarnation, command, payload });
	};
	const modelNames = async (): Promise<Set<string>> => {
		const response = await send("get_available_models", {});
		if (response.status !== "completed") throw new Error(`OMP dynamic provider smoke failed: same live OMP session get_available_models returned ${response.status}`);
		const raw = record(response.result, "models command result");
		const data = record(raw.data ?? raw, "models data");
		if (!Array.isArray(data.models)) throw new Error("OMP dynamic provider smoke failed: runtime model catalog is not an array");
		return new Set((data.models as Record<string, unknown>[]).map(model => `${String(model.provider ?? "")}/${String(model.id ?? "")}`));
	};
	let models = await modelNames();
	check(!models.has(`${PROVIDER}/${MODEL_ID}`), "dynamic provider is absent before the extension command");
	const available = await send("get_available_commands", {});
	const availableData = record(record(available.result, "available command result").data, "available command data");
	check(Array.isArray(availableData.commands), "runtime returned available commands");
	check((availableData.commands as Record<string, unknown>[]).some(command => command.name === "dynamic-provider"), "fixture extension command is loaded into the live OMP session");
	const add = await sendTracked("prompt", { message: "/dynamic-provider add" });
	check(add.status === "acknowledged" || add.status === "completed", `extension command prompt was accepted (${add.status})`);
	const addTerminal = await until(async () => host.host.store.getCommand(session.id, commandIds.at(-1)!)!, value => value.status === "completed" || value.status === "failed", "extension command prompt result");
	check(addTerminal.status === "completed", `local extension add command completes (${addTerminal.status}: ${addTerminal.error ?? JSON.stringify(addTerminal.result ?? {})})`);
	check(record(addTerminal.result, "provider add prompt result").agentInvoked === false, "provider add ran locally without an agent or inference turn");
	const afterAdd = await modelNames();
	models = afterAdd;
	check(models.has(`${PROVIDER}/${MODEL_ID}`), "provider add appears atomically in live OMP model catalog");
	check(models.has("cedia-dynamic-baseline/baseline-model"), "adding the provider preserves existing catalog rows");
	const removed = await sendTracked("prompt", { message: "/dynamic-provider remove" });
	check(removed.status === "acknowledged" || removed.status === "completed", `extension remove prompt was accepted (${removed.status})`);
	const removeTerminal = await until(async () => host.host.store.getCommand(session.id, commandIds.at(-1)!)!, value => value.status === "completed" || value.status === "failed", "extension remove prompt result");
	check(removeTerminal.status === "completed" && record(removeTerminal.result, "provider remove prompt result").agentInvoked === false, `local extension remove command completes without a model turn (${removeTerminal.status})`);
	models = await modelNames();
	check(!models.has(`${PROVIDER}/${MODEL_ID}`), "provider removal appears atomically in live OMP model catalog");
	check(models.has("cedia-dynamic-baseline/baseline-model"), "removal preserves baseline model rows");
	const stale = await send("set_model", { provider: PROVIDER, modelId: MODEL_ID });
	check(stale.status === "failed", `stale selection of the removed provider is refused (${stale.status})`);
	const providerError = JSON.stringify(stale.error ?? stale.result ?? stale.ack ?? {});
	check(/not found|unknown|unavailable|invalid model/i.test(providerError), `stale selection carries the runtime refusal (${providerError.slice(0, 300)})`);
	check(providerCalls === 0, "no provider inference request was made");
	console.log(JSON.stringify({ ok: true, version, runtimeFingerprint, sessionId: session.id, sessionIncarnation: incarnation,
		provider: `${PROVIDER}/${MODEL_ID}`, transitions: ["absent", "added", "removed", "stale-selection-refused"], providerCalls,
		limitations: "One live host-backed RPC session and one local fixture extension/provider were exercised; packaged UI, desktop/web/iPhone renderer propagation, other O-packet fixtures, and full F acceptance remain unverified." }, null, 2));
} finally {
	await host.close();
	await new Promise<void>(done => held.close(() => done()));
	await Promise.all([rm(projectDir, { recursive: true, force: true }), rm(profileDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]);
}
