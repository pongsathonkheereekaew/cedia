/**
 * Provider-free evidence for Cedia's turn bridge (§2.4), not full OMP conformance.
 *
 * The pinned runtime is asked to name the submission that starts a turn and to report its
 * queue. The model endpoint is a local HTTP server that accepts the request and never answers,
 * so a turn really starts and stays running without any provider call leaving the machine; the
 * run ends with an explicit abort.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { execFileSync } from "node:child_process";

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

const cwd = await mkdtemp(join(tmpdir(), "cedia-turn-bridge-"));
// A model endpoint that never answers: the turn starts and streams, no provider is contacted.
const held: Server = createServer(() => { /* deliberately never respond */ });
await new Promise<void>(resolveListen => held.listen(0, "127.0.0.1", () => resolveListen()));
const address = held.address();
check(address !== null && typeof address === "object", "Fixture listener did not bind");
const port = address.port;
let client: OmpRpcClient | undefined;
const frames: { type: string; cediaIntentId?: string; cediaModel?: string }[] = [];
const identityWaiters: (() => void)[] = [];
const framesWithIdentity = () => frames.filter(frame => frame.cediaIntentId !== undefined).map(frame => frame.type);

try {
  await writeFile(join(cwd, "models.yml"), `providers:
  fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: fixture-model
        name: Cedia turn bridge fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
      - id: fixture-model-2
        name: Cedia pending model fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`);
  client = await OmpRpcClient.start({
    executable,
    args: ["--no-session", "--no-skills", "--no-rules", "--no-extensions", "--no-title", "--cwd", cwd],
    cwd,
    env: { PATH: `${dirname(executable)}${delimiter}/usr/bin${delimiter}/bin`, PI_CODING_AGENT_DIR: cwd, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
    readyTimeoutMs: 20_000,
    requestTimeoutMs: 20_000,
    onFrame(frame) {
      const event = record(frame);
      const type = typeof event.type === "string" ? event.type : "unknown";
      frames.push({
        type,
        ...(typeof event.cediaIntentId === "string" ? { cediaIntentId: event.cediaIntentId } : {}),
        ...(typeof event.cediaModel === "string" ? { cediaModel: event.cediaModel } : {}),
      });
      for (const wake of identityWaiters.splice(0)) wake();
    },
  });

  // 1. The runtime advertises the turn bridge before a client relies on it.
  const ready = client.readyFrame;
  check(ready?.cediaTurnBridgeVersion === 1, "The pinned runtime does not advertise the turn bridge");
  check(ready?.cediaPendingModelVersion === 1, "The pinned runtime does not advertise pending model acceptance");
  const advertised = true;

  // 2. A named submission is echoed on its own turn boundary.
  const ack = await client.request("prompt", { message: "turn bridge smoke", cediaIntentId: "turn-smoke-1" });
  check(typeof ack.id === "string", "Missing request correlation ID");
  const deadline = Date.now() + 20_000;
  while (!frames.some(frame => (frame.type === "agent_start" || frame.type === "turn_start") && frame.cediaIntentId === "turn-smoke-1")) {
    if (Date.now() > deadline) throw new Error(`No named turn boundary arrived; frames: ${JSON.stringify(framesWithIdentity())}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  check(framesWithIdentity().includes("agent_start"), "agent_start did not name the submission");

  // 3. The queue snapshot names the running submission and the one waiting behind it.
  const running = record((await client.requestCedia("cedia_turn_queue", {})).data);
  const runningTurn = record(running.current ?? {});
  check(runningTurn.intentId === "turn-smoke-1", `Current intent mismatch: ${JSON.stringify(running)}`);
  // The runtime reports the model it is actually running this turn with, not a requested one.
  const runningModel = record(runningTurn.model ?? {});
  check(runningModel.provider === "fixture" && runningModel.id === "fixture-model", `Model mismatch: ${JSON.stringify(runningTurn)}`);
  const followUp = await client.request("follow_up", { message: "queued behind the running turn", cediaIntentId: "turn-smoke-2" });
  check(typeof followUp.id === "string", "Missing follow-up correlation ID");
  let queued: Record<string, unknown> | undefined;
  const queueDeadline = Date.now() + 10_000;
  while (queueDeadline > Date.now()) {
    const snapshot = record((await client.requestCedia("cedia_turn_queue", {})).data);
    const entries = Array.isArray(snapshot.queued) ? snapshot.queued.map(entry => record(entry)) : [];
    if (entries.some(entry => entry.intentId === "turn-smoke-2")) { queued = snapshot; break; }
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  check(queued, "The queued submission never appeared in the runtime's own queue snapshot");
  const awaiting = (queued.queued as unknown[]).map(entry => record(entry));
  const waiting = awaiting.find(entry => entry.intentId === "turn-smoke-2");
  check(waiting?.kind === "followUp" && waiting?.position === 1, `Queued entry mismatch: ${JSON.stringify(awaiting)}`);

  // 4. A pending model change is validated on acceptance, held for the next turn, and never
  // presented as the model of the turn already running.
  await client.requestCedia("cedia_pending_model", { revision: 1, provider: "fixture", modelId: "fixture-model-2" });
  const holding = record((await client.requestCedia("cedia_turn_queue", {})).data);
  check(record(holding.pending ?? {}).revision === 1, `Pending change was not held: ${JSON.stringify(holding)}`);
  check(record(holding.current ?? {}).model === undefined || record(record(holding.current ?? {}).model ?? {}).id === "fixture-model",
    `A pending change restated the running turn's model: ${JSON.stringify(holding.current)}`);
  let refused: string | undefined;
  try {
    await client.requestCedia("cedia_pending_model", { revision: 2, provider: "fixture", modelId: "no-such-model" });
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  check(refused !== undefined && refused.includes("no-such-model"), `An unknown model was not refused: ${String(refused)}`);

  // 5. Stop ends the run; nothing was replayed and no provider answered.
  await client.request("abort");
  const settleDeadline = Date.now() + 10_000;
  while (!frames.some(frame => frame.type === "agent_end") && Date.now() < settleDeadline) {
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  const echoing = frames.filter(frame => frame.cediaIntentId !== undefined);
  const echoedOn = echoing.map(frame => frame.type);
  check(echoedOn.includes("agent_start"), "agent_start did not name the submission");
  const namedModel = frames.filter(frame => frame.cediaIntentId !== undefined && frame.cediaModel !== undefined).map(frame => frame.cediaModel);
  check(namedModel.includes("fixture/fixture-model"), `A named boundary did not report the running model: ${JSON.stringify(namedModel)}`);
  check(echoedOn.includes("turn_start"), `turn_start did not name the submission: ${JSON.stringify(echoedOn)}`);
  check(echoing.filter(frame => frame.type === "agent_end").every(frame => frame.cediaIntentId === "turn-smoke-1"), "The settling boundary named the wrong submission");
  // 6. The held change is committed at the next dequeue/start boundary and reported back, and
  // that turn runs on it.
  const committed = await client.request("prompt", { message: "turn bridge smoke two", cediaIntentId: "turn-smoke-3" });
  check(typeof committed.id === "string", "Missing second-turn correlation ID");
  const commitDeadline = Date.now() + 20_000;
  while (!frames.some(frame => frame.cediaIntentId === "turn-smoke-3" && frame.cediaModel === "fixture/fixture-model-2")) {
    if (Date.now() > commitDeadline) throw new Error(`The committed change did not reach the next turn: ${JSON.stringify(frames.filter(frame => frame.cediaIntentId === "turn-smoke-3"))}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  let applied: Record<string, unknown> | undefined;
  const appliedDeadline = Date.now() + 10_000;
  while (appliedDeadline > Date.now()) {
    const snapshot = record((await client.requestCedia("cedia_turn_queue", {})).data);
    const candidate = record(snapshot.applied ?? {});
    if (candidate.revision === 1) { applied = candidate; break; }
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  check(applied !== undefined, "The runtime never reported the committed revision");
  check(record(applied.model ?? {}).id === "fixture-model-2", `Committed revision reported the wrong model: ${JSON.stringify(applied)}`);
  await client.request("abort").catch(() => {});
  await client.close();
  client = undefined;

  const binarySha256 = createHash("sha256").update(await readFile(executable)).digest("hex");
  console.log(JSON.stringify({
    ok: true,
    runtime: { executable, version, binarySha256 },
    advertisedTurnBridge: advertised,
    echoedOn,
    currentIntent: runningTurn.intentId,
    currentModel: `${String(runningModel.provider)}/${String(runningModel.id)}`,
    queued: awaiting,
    pendingModelRevision: 1,
    appliedModel: `${String(record(applied.model ?? {}).provider)}/${String(record(applied.model ?? {}).id)}`,
    framesSeen: frames.map(frame => frame.type),
  }, null, 2));
} finally {
  await client?.close().catch(() => {});
  await new Promise<void>(resolveClose => held.close(() => resolveClose()));
  await rm(cwd, { recursive: true, force: true });
}
