/**
 * Provider-free evidence for Cedia's slash-command path (§8.2 O05/O06).
 *
 * The claim is that a builtin slash command - including one with a subcommand - is executed by
 * the runtime over the RPC surface Cedia actually uses, rather than being sent to the model as
 * an ordinary prompt. The runtime routes a `/`-prefixed prompt through its builtin dispatcher
 * once the client has negotiated the virtual terminal, which is exactly what the Cedia host does
 * when `virtualUi` is on (`apps/host/src/service.ts`).
 *
 * The model endpoint is a local HTTP server that accepts a request and never answers, so a
 * prompt that does reach the provider is visible as a hit. Every candidate here must leave that
 * count at zero.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function record(value: unknown): Record<string, unknown> {
  check(typeof value === "object" && value !== null && !Array.isArray(value), "Expected object");
  return value as Record<string, unknown>;
}
async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/")
  ? resolve(requested)
  : (process.env.PATH ?? "").split(delimiter).map(dir => join(dir, requested)).find(candidate => candidate) ?? requested;
check(await exists(executable), `OMP runtime is missing at ${executable}; run bun run prepare:omp first`);
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `Expected OMP ${OMP_BASELINE_VERSION} or later, received ${version}`);

const cwd = await mkdtemp(join(tmpdir(), "cedia-slash-"));
// A model endpoint that never answers: reaching it at all is the failure this smoke looks for.
const held: Server = createServer(() => { /* deliberately never respond */ });
await new Promise<void>(resolveListen => held.listen(0, "127.0.0.1", () => resolveListen()));
const address = held.address();
check(address !== null && typeof address === "object", "Fixture listener did not bind");
const port = address.port;
let providerRequests = 0;
held.on("request", () => { providerRequests += 1; });

const checks: string[] = [];
const frames: string[] = [];
let client: OmpRpcClient | undefined;
try {
  await writeFile(join(cwd, "models.yml"), `providers:
  fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: slash-fixture-model
        name: Cedia slash fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
      - id: slash-second-fixture-model
        name: Cedia slash second fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`);
  client = await OmpRpcClient.start({
    executable,
    cwd,
    args: ["--no-session", "--no-title", "--no-extensions", "--no-skills", "--no-rules"],
    env: {
      PATH: process.env.PATH ?? `/usr/bin${delimiter}/bin`, HOME: cwd, PI_CODING_AGENT_DIR: cwd,
      PI_NO_PTY: "1", PI_NOTIFICATIONS: "off", CEDIA_RPC_VIRTUAL_UI: "1",
    },
    readyTimeoutMs: 30_000, requestTimeoutMs: 15_000,
    onFrame: frame => { frames.push(String(frame.type ?? "?")); },
  });
  check(client.readyFrame?.cediaVirtualUiVersion === 1, "The runtime did not advertise the Cedia virtual UI");
  // The same negotiation the Cedia host performs before a session accepts a prompt.
  await client.requestCedia("cedia_terminal_negotiate", { version: 1, cols: 100, rows: 30 });
  checks.push("virtual-terminal-negotiated");
  // The catalog the composer lists arrives from the runtime itself, unasked.
  check(frames.includes("available_commands_update"), "The runtime never published its command catalog");
  checks.push("command-catalog-published");

  const candidates = ["/status", "/tools", "/usage", "/security status", "/security scans", "/security disposition", "/jobs", "/prewalk", "/mcp reload", "/switch slash-second-fixture-model"];
  const outcomes: { message: string; agentInvoked: unknown; providerRequests: number }[] = [];
  for (const message of candidates) {
    const before = providerRequests;
    const ack = await client.request("prompt", { message });
    const data = record((ack as { data?: unknown }).data ?? {});
    // A builtin answers with `agentInvoked: false`: the command runs, no turn starts and no
    // model call is made. A slash command that fell through to the model would start a turn.
    check(data.agentInvoked === false, `${message} invoked the agent instead of the builtin dispatcher: ${JSON.stringify(data)}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 400));
    check(providerRequests === before, `${message} reached the model endpoint`);
    outcomes.push({ message, agentInvoked: data.agentInvoked, providerRequests: providerRequests - before });
  }
  checks.push("every-slash-command-stayed-local");
  check(!frames.includes("agent_start"), "A slash command started an agent turn");
  checks.push("no-turn-started");
  // `/switch <model>` is the carrier behind the `setModelTemporary` SDK row, and unlike a
  // dispatch-only proof this one observes the effect: the fixture's second model must be the
  // session's live model afterwards, still with no turn and no provider call.
  const stateAfterSwitch = record(((await client.request("get_state", {})) as { data?: unknown }).data ?? {});
  const switchedModel = record((stateAfterSwitch.model ?? {}) as unknown);
  check(switchedModel.id === "slash-second-fixture-model", `The /switch carrier did not take effect: get_state reports ${JSON.stringify(switchedModel.id)}`);
  checks.push("switch-carrier-took-effect");

  const binarySha256 = createHash("sha256").update(await readFile(executable)).digest("hex");
  console.log(JSON.stringify({
    ok: true,
    runtime: { executable, version, binarySha256 },
    surface: "rpc-ui with the Cedia virtual terminal negotiated (what apps/host/src/service.ts does)",
    candidates: outcomes,
    providerRequests,
    framesSeen: [...new Set(frames)],
    checks,
    limitations: "Builtin slash commands that are local to the session; a command that starts a turn is a normal prompt and is not covered here.",
  }, null, 2));
} finally {
  await client?.close().catch(() => {});
  await new Promise<void>(resolveClose => held.close(() => resolveClose()));
  await rm(cwd, { recursive: true, force: true });
}
