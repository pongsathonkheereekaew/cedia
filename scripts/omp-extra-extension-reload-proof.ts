/**
 * Acceptance probe for the operator extra-extension path (O06 packaged-reload requirement).
 * Same A→B→rollback→removal flow as omp-extension-hot-reload-smoke, but the fixture
 * travels through HostOptions.extraTrustedExtensions (server startup /
 * CEDIA_EXTRA_TRUSTED_EXTENSIONS) instead of ompArgs. No provider inference or
 * tool execution occurs.
 * Run: bun scripts/omp-extra-extension-reload-proof.ts
 */
import { mkdtemp, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import type { Json } from "../packages/protocol/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

const PREFIX = "OMP extra extension reload proof failed:";
const PROVIDER = "cedia_hot_reload_fixture";
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`${PREFIX} ${message}`);
  console.log(`OK   ${message}`);
}
function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${PREFIX} ${message}`);
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
async function until<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  label: string,
): Promise<T> {
  const deadline = Date.now() + 20_000;
  let value = await read();
  while (!accept(value)) {
    if (Date.now() >= deadline) throw new Error(`${PREFIX} timed out waiting for ${label}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    value = await read();
  }
  return value;
}
function fixtureSource(generation: "A" | "B" | "broken"): string {
  if (generation === "broken")
    return `
export default function (pi) {
	pi.registerCommand("hot-reload-broken", { description: "Must roll back", handler: async () => {} });
	throw new Error("intentional hot reload candidate failure");
}
`;
  const suffix = generation.toLowerCase();
  const modelId = `hot-reload-model-${suffix}`;
  return `
export default function (pi) {
	pi.registerCommand("hot-reload-${suffix}", {
		description: "Hot reload fixture generation ${generation}",
		handler: async () => {},
	});
	pi.registerTool({
		name: "hot_reload_${suffix}_tool",
		label: "Hot reload ${generation}",
		description: "Catalog-only smoke fixture",
		parameters: pi.zod.object({}),
		async execute() { return { content: [{ type: "text", text: "fixture" }] }; },
	});
	pi.registerProvider(${JSON.stringify(PROVIDER)}, {
		baseUrl: "http://127.0.0.1:9/v1", apiKey: "fixture-never-used", authHeader: false,
		api: "openai-completions",
		models: [{ id: ${JSON.stringify(modelId)}, name: "Hot Reload ${generation}", reasoning: false,
			input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 8192, maxTokens: 1024 }],
	});
}
`;
}

const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/")
  ? resolve(requested)
  : ((process.env.PATH ?? "")
      .split(delimiter)
      .map((dir) => join(dir, requested))
      .find(Boolean) ?? requested);
check(await exists(executable), `OMP runtime exists at ${executable}`);
const version = execFileSync(executable, ["--version"], {
  encoding: "utf8",
  timeout: 20_000,
}).trim();
check(isSupportedOmpVersion(version), `runtime is pinned (${version})`);

const projectDir = await mkdtemp(join(tmpdir(), "cedia-extra-ext-project-"));
const profileDir = await mkdtemp(join(tmpdir(), "cedia-extra-ext-profile-"));
const stateDir = await mkdtemp(join(tmpdir(), "cedia-extra-ext-state-"));
const extensionPath = join(projectDir, "hot-reload-fixture.ts");
const hostLockExtension = resolve(import.meta.dir, "../apps/host/src/runtime-lock.ts");
await writeFile(
  join(profileDir, "models.yml"),
  `providers:\n  cedia-hot-reload-baseline:\n    baseUrl: http://127.0.0.1:9/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: baseline-model\n        name: Baseline fixture model\n        api: openai-completions\n        reasoning: false\n        input: [text]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 8192\n        maxTokens: 1024\n`,
  { mode: 0o600 },
);
await writeFile(extensionPath, fixtureSource("A"), { mode: 0o600 });

let host = await startHostServer({
  stateDir,
  port: 0,
  ompExecutable: executable,
  virtualUi: true,
  lockExtension: hostLockExtension,
  extraTrustedExtensions: [extensionPath],
  ompEnv: {
    HOME: profileDir,
    PI_CODING_AGENT_DIR: profileDir,
    PI_NO_PTY: "1",
    PI_NOTIFICATIONS: "off",
  },
});
try {
  const project = host.host.store.createProject({ path: projectDir, name: "Hot reload fixture" });
  const session = host.host.createSession(project.id, "Hot reload fixture");
  await host.host.startSession(session.id);
  const incarnation = host.host.store.getSession(session.id)!.incarnation;
  let commandIndex = 0;
  const send = (command: string, payload: { [key: string]: Json }) =>
    host.host.command(session.id, "extension-hot-reload-smoke", {
      commandId: `extra-extension-reload-${++commandIndex}`,
      incarnation,
      command,
      payload,
    });
  const commandNames = async (): Promise<Set<string>> => {
    const response = await send("get_available_commands", {});
    if (response.status !== "completed")
      throw new Error(`${PREFIX} get_available_commands returned ${response.status}`);
    const data = record(record(response.result, "command result").data, "command data");
    if (!Array.isArray(data.commands))
      throw new Error(`${PREFIX} runtime command catalog is not an array`);
    return new Set(
      (data.commands as Record<string, unknown>[]).map((command) => String(command.name)),
    );
  };
  const modelNames = async (): Promise<Set<string>> => {
    const response = await send("get_available_models", {});
    if (response.status !== "completed")
      throw new Error(`${PREFIX} get_available_models returned ${response.status}`);
    const data = record(record(response.result, "model result").data, "model data");
    if (!Array.isArray(data.models)) throw new Error(`${PREFIX} model catalog is not an array`);
    return new Set(
      (data.models as Record<string, unknown>[]).map(
        (model) => `${String(model.provider ?? "")}/${String(model.id ?? "")}`,
      ),
    );
  };
  const toolNames = async (): Promise<Set<string>> => {
    const catalog = await host.host.toolCatalogSnapshot(session.id);
    if (!catalog.available)
      throw new Error(`${PREFIX} tool catalog unavailable: ${catalog.reason}`);
    return new Set(catalog.tools.map((tool) => tool.name));
  };
  const ownerPid = async (): Promise<number> => {
    const answer = await host.host.knownOwnerStates();
    const owner = answer.owners.find((item) => item.taskId === session.id);
    if (!owner?.identity) throw new Error(`${PREFIX} could not read live OMP owner PID`);
    return owner.identity.pid;
  };
  const runReload = async (
    label: string,
    outcome: "completed" | "failed" = "completed",
  ): Promise<void> => {
    const response = await send("prompt", { message: "/reload-plugins" });
    check(
      response.status === "acknowledged" ||
        response.status === "completed" ||
        (outcome === "failed" && response.status === "failed"),
      `${label}: /reload-plugins accepted (${response.status})`,
    );
    const result = await until(
      async () => host.host.store.getCommand(session.id, `extra-extension-reload-${commandIndex}`)!,
      (value) => value.status === "completed" || value.status === "failed",
      `${label} prompt result`,
    );
    check(
      result.status === outcome,
      `${label}: /reload-plugins ${outcome} (${result.error ?? ""})`,
    );
    const stats = await send("get_session_stats", {});
    if (stats.status !== "completed")
      throw new Error(`${PREFIX} ${label}: get_session_stats returned ${stats.status}`);
    const usage = record(record(stats.result, `${label} stats result`).data, `${label} stats data`);
    check(
      usage.assistantMessages === 0 && usage.toolCalls === 0 && usage.cost === 0,
      `${label}: reload caused no assistant turn, tool call, or provider spend`,
    );
  };

  const pid = await ownerPid();
  const initialCommands = await commandNames();
  check(initialCommands.has("hot-reload-a"), "generation A command loaded at startup");
  const initialModels = await modelNames();
  check(
    initialModels.has(`${PROVIDER}/hot-reload-model-a`),
    "generation A provider/model loaded at startup",
  );
  const initialTools = await toolNames();
  check(initialTools.has("hot_reload_a_tool"), "generation A tool loaded at startup");

  await writeFile(extensionPath, fixtureSource("B"), { mode: 0o600 });
  await runReload("generation B add");
  let commands = await until(
    commandNames,
    (names) => names.has("hot-reload-b"),
    "generation B command in live catalog",
  );
  check(!commands.has("hot-reload-a"), "generation B atomically removes generation A command");
  let models = await modelNames();
  check(
    models.has(`${PROVIDER}/hot-reload-model-b`) && !models.has(`${PROVIDER}/hot-reload-model-a`),
    "generation B replaces generation A in the live provider/model catalog",
  );
  const tools = await toolNames();
  check(
    tools.has("hot_reload_b_tool") && !tools.has("hot_reload_a_tool"),
    "generation B atomically replaces tool catalog entry",
  );
  check(
    models.has("cedia-hot-reload-baseline/baseline-model"),
    "extension reload preserves baseline models",
  );
  check((await ownerPid()) === pid, "generation B reload keeps the same OMP process PID");

  await writeFile(extensionPath, fixtureSource("broken"), { mode: 0o600 });
  await runReload("failed candidate rollback", "failed");
  commands = await commandNames();
  check(
    commands.has("hot-reload-b") && !commands.has("hot-reload-broken"),
    "failed candidate retains last-good B command without partial registration",
  );
  models = await modelNames();
  check(
    models.has(`${PROVIDER}/hot-reload-model-b`) && !models.has(`${PROVIDER}/hot-reload-model-a`),
    "failed candidate retains last-good B provider/model without partial replacement",
  );
  check((await toolNames()).has("hot_reload_b_tool"), "failed candidate retains last-good B tool");
  check((await ownerPid()) === pid, "failed candidate rollback keeps the same OMP process PID");

  await unlink(extensionPath);
  await runReload("extension removal");
  commands = await until(
    commandNames,
    (names) => !names.has("hot-reload-b"),
    "removed B command to disappear",
  );
  check(!commands.has("hot-reload-a"), "removal leaves no old generation command");
  models = await modelNames();
  check(
    !models.has(`${PROVIDER}/hot-reload-model-a`) && !models.has(`${PROVIDER}/hot-reload-model-b`),
    "extension removal removes fixture provider/models from live catalog",
  );
  check(
    models.has("cedia-hot-reload-baseline/baseline-model"),
    "extension removal preserves baseline models",
  );
  const removedTools = await toolNames();
  check(
    !removedTools.has("hot_reload_a_tool") && !removedTools.has("hot_reload_b_tool"),
    "extension removal removes fixture tools",
  );
  const staleError = await send("prompt", {
    message: "/hot-reload-b",
    cediaSelectedSlashCommand: "hot-reload-b",
  }).then(() => undefined, (error: unknown) => error);
  const staleDetail = record(staleError, "stale selected slash refusal");
  check(staleDetail.code === "stale_slash_command" && staleDetail.status === 409,
    "host refuses selected removed slash command with a 409 before dispatch");
  check(
    /no longer available/i.test(String(staleDetail.message ?? "")),
    "stale selection carries an explicit refusal message",
  );
  check((await ownerPid()) === pid, "extension removal keeps the same OMP process PID");
  check(
    host.host.store.getSession(session.id)?.incarnation === incarnation,
    "all transitions stay in one host session incarnation",
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        version,
        sessionId: session.id,
        sessionIncarnation: incarnation,
        ompPid: pid,
        transitions: [
          "generation-A",
          "same-path-generation-B",
          "failed-candidate-kept-B",
          "removed",
          "stale-selected-slash-refused",
        ],
        provider: PROVIDER,
        inferenceRequests: 0,
        limitations:
          "Host-backed RPC-UI development runtime only; no packaged macOS capture, interactive standalone/ACP race test, or provider inference was exercised.",
      },
      null,
      2,
    ),
  );
} finally {
  await host.close();
  await Promise.all([
    rm(projectDir, { recursive: true, force: true }),
    rm(profileDir, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true }),
  ]);
}
