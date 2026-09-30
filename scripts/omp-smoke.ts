/** Provider-free integration evidence for the Cedia adapter, not full OMP conformance. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, stat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { isSupportedOmpVersion, OMP_BASELINE_VERSION, OmpRpcClient } from "../packages/omp-adapter/src/index.ts";

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

const requestedBinary = process.env.CEDIA_OMP_BINARY ?? "omp";
let executable: string | undefined;
for (const candidate of requestedBinary.includes("/")
  ? [resolve(requestedBinary)]
  : (process.env.PATH ?? "").split(delimiter).map(dir => join(dir, requestedBinary))) {
  if (await exists(candidate)) { executable = candidate; break; }
}
check(executable, `OMP is missing; set CEDIA_OMP_BINARY to an OMP ${OMP_BASELINE_VERSION} or later executable`);
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 10_000 }).trim();
check(isSupportedOmpVersion(version), `Expected OMP ${OMP_BASELINE_VERSION} or later, received ${version}`);
const binarySha256 = createHash("sha256").update(await readFile(executable)).digest("hex");
const implementationSourceHashes: Record<string, string> = {};
for (const file of ["client.ts", "framing.ts", "types.ts", "index.ts"]) {
  const source = new URL(`../packages/omp-adapter/src/${file}`, import.meta.url);
  implementationSourceHashes[`packages/omp-adapter/src/${file}`] = createHash("sha256").update(await readFile(source)).digest("hex");
}
implementationSourceHashes["scripts/omp-smoke.ts"] = createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex");
const cwd = await mkdtemp(join(tmpdir(), "cedia-g0-omp-"));
const marker = join(cwd, "ui-confirmed.txt");
const extension = join(cwd, "cedia-fixture.ts");
const modelConfig = `providers:
  probe:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: probe-model
        name: Cedia fixture model
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;
let client: OmpRpcClient | undefined;
const eventCounts: Record<string, number> = {};
const fixtureUiResponses: boolean[] = [];
let approveFixture = false;
let callbackError: unknown;
const checks: string[] = [];
const localPromptResults = new Map<string, Record<string, unknown>>();
const resultWaiters = new Map<string, (event: Record<string, unknown>) => void>();
async function waitForLocalResult(id: string): Promise<Record<string, unknown>> {
  const seen = localPromptResults.get(id);
  if (seen) return seen;
  return new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => {
      resultWaiters.delete(id);
      reject(new Error("Local command did not complete; an ACK is not completion"));
    }, 10_000);
    resultWaiters.set(id, event => { clearTimeout(timer); resultWaiters.delete(id); resolveResult(event); });
  });
}
try {
  await writeFile(join(cwd, "models.yml"), modelConfig);
  await writeFile(extension, `import { writeFile } from "node:fs/promises";
export default function(api) {
  api.registerCommand("cedia-g0-ui", {
    description: "Local Cedia G0 fixture; never invokes a model",
    handler: async (_args, ctx) => {
      const allowed = await ctx.ui.confirm("Cedia G0 fixture", "Write the temporary fixture marker?");
      if (allowed) await writeFile(${JSON.stringify(marker)}, "confirmed");
      ctx.ui.notify(allowed ? "cedia-fixture-allowed" : "cedia-fixture-denied", "info");
    }
  });
}
`);
  client = await OmpRpcClient.start({
    executable,
    args: ["--no-session", "--no-skills", "--no-rules", "--no-extensions", "--no-title", "--cwd", cwd, "--trusted-extension", extension],
    cwd,
    // Intentionally do not inherit credentials, proxy variables, HOME or user OMP settings.
    env: { PATH: `${dirname(executable)}${delimiter}/usr/bin${delimiter}/bin`, PI_CODING_AGENT_DIR: cwd, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
    readyTimeoutMs: 15_000,
    requestTimeoutMs: 10_000,
    onFrame(frame) {
      const event = record(frame);
      const type = String(event.type);
      eventCounts[type] = (eventCounts[type] ?? 0) + 1;
      if (type === "prompt_result" && typeof event.id === "string") {
        localPromptResults.set(event.id, event);
        resultWaiters.get(event.id)?.(event);
      }
      if (type === "extension_ui_request" && event.method === "confirm" && event.title === "Cedia G0 fixture") {
        fixtureUiResponses.push(approveFixture);
        if (!client) { callbackError = new Error("Fixture UI before ready"); return; }
        // Only this exact local fixture is answered automatically; this is not a production policy.
        void client.send({ type: "extension_ui_response", id: String(event.id), confirmed: approveFixture })
          .catch(error => { callbackError = error; });
      }
    },
  });
  check(client.protocolVersion === 2, "Protocol v2 negotiation failed");
  checks.push("ready-and-v2");
  const state = record((await client.request("get_state")).data);
  check(Array.isArray(state.dumpTools), "Missing effective tool registry");
  const toolNames = state.dumpTools.map(tool => record(tool).name);
  check(toolNames.includes("ask"), "rpc-ui did not expose ask");
  checks.push("rpc-ui-effective-tools");
  const commands = record((await client.request("get_available_commands")).data).commands;
  check(Array.isArray(commands) && commands.some(command => record(command).name === "cedia-g0-ui"), "Trusted fixture command not loaded; refusing to submit it");
  checks.push("trusted-command-discovery");
  const messages = record((await client.request("get_messages_page", { limit: 10 })).data);
  check(Array.isArray(messages.messages) && messages.messages.length === 0, "Expected isolated empty history");
  await client.request("set_steering_mode", { mode: "all" });
  const after = record((await client.request("get_state")).data);
  check(after.steeringMode === "all", "Queue configuration readback mismatch");
  checks.push("history-and-config-readback");

  for (const allowed of [false, true]) {
    approveFixture = allowed;
    const ack = await client.request("prompt", { message: "/cedia-g0-ui" });
    check(typeof ack.id === "string", "Missing request correlation ID");
    const completed = await waitForLocalResult(ack.id);
    check(completed.agentInvoked === false, "Fixture unexpectedly invoked an agent");
    check(!callbackError, `UI response failed: ${String(callbackError)}`);
    check(await exists(marker) === allowed, "UI-confirm fixture marker violated deny/allow ordering");
    checks.push(allowed ? "extension-ui-confirm-allow" : "extension-ui-confirm-deny");
  }
  check(fixtureUiResponses.length === 2, "Expected two fixture confirmation requests");
  const stats = record((await client.request("get_session_stats")).data);
  check(stats.assistantMessages === 0 && stats.toolCalls === 0 && stats.cost === 0, "Fixture has unexpected model/tool activity");
  checks.push("zero-model-turns");
  await client.close();
  checks.push("bounded-close");
  const receipt = { date: new Date().toISOString(), hostRuntime: { name: process.versions.bun ? "bun" : "node", version: process.versions.bun ?? process.versions.node }, version, binarySha256, implementationSourceHashes, sourceReference: "fc671eba383f2a7208500836673b485c0dc7073d", mode: "rpc-ui", checks, eventCounts, toolNames, fixtureUiResponses, limitations: "Local extension UI confirmation only; not tool-policy approval enforcement, provider streaming, durable host, Mac UI or full OMP conformance." };
  if (process.env.CEDIA_SMOKE_RECEIPT) {
    const output = resolve(process.env.CEDIA_SMOKE_RECEIPT);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(receipt, null, 2) + "\n");
  }
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  try { await client?.close(); }
  finally { await rm(cwd, { recursive: true, force: true }); }
}
