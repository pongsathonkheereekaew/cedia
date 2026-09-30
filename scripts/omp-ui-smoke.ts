/** Real OMP extension UI broker conformance; local commands only, no model turns. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, stat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { OmpRpcClient } from "../packages/omp-adapter/src/client.ts";
import { ExtensionUiBroker } from "../packages/omp-adapter/src/ui.ts";
import { isSupportedOmpVersion, OMP_BASELINE_VERSION } from "../packages/omp-adapter/src/types.ts";

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
for (const file of ["client.ts", "framing.ts", "types.ts", "ui.ts"]) {
  const source = new URL(`../packages/omp-adapter/src/${file}`, import.meta.url);
  implementationSourceHashes[`packages/omp-adapter/src/${file}`] = createHash("sha256").update(await readFile(source)).digest("hex");
}
implementationSourceHashes["scripts/omp-ui-smoke.ts"] = createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex");
const cwd = await mkdtemp(join(tmpdir(), "cedia-g1-omp-"));
const marker = join(cwd, "ui-results.json");
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
const uiMethods: string[] = [];
const presentations: string[] = [];
let serverCancellations = 0;
let statusCleared = false;
let widgetCleared = false;
let broker: ExtensionUiBroker | undefined;
let staleToken: string | undefined;
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
  api.registerCommand("cedia-g1-ui", {
    description: "Local Cedia G1 UI fixture; never invokes a model",
    handler: async (_args, ctx) => {
      const denied = await ctx.ui.confirm("Cedia G1 deny", "Deny this fixture");
      const allowed = await ctx.ui.confirm("Cedia G1 allow", "Allow this fixture");
      const selected = await ctx.ui.select("Cedia G1 select", ["first", "second"]);
      const input = await ctx.ui.input("Cedia G1 input", "fixture placeholder");
      const edited = await ctx.ui.editor("Cedia G1 editor", "prefill");
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 30);
      const cancelled = await ctx.ui.input("Cedia G1 server cancel", undefined, { signal: controller.signal });
      const timedOut = await ctx.ui.confirm("Cedia G1 timeout", "No answer", { timeout: 30 });
      ctx.ui.notify("cedia-fixture-notice", "info");
      ctx.ui.setStatus("cedia-fixture", "active");
      ctx.ui.setStatus("cedia-fixture", undefined);
      ctx.ui.setWidget("cedia-fixture", ["line"], {placement:"belowEditor"});
      ctx.ui.setWidget("cedia-fixture", undefined);
      ctx.ui.setTitle("Cedia G1 fixture title");
      ctx.ui.setEditorText("fixture composer text");
      await writeFile(${JSON.stringify(marker)}, JSON.stringify({denied,allowed,selected,input,edited,cancelled:cancelled ?? null,timedOut}));
    }
  });
}
`);
  broker = new ExtensionUiBroker({
    send: async frame => { check(client, "UI request before ready"); await client.send(frame); },
    onEvent: event => {
      // Only the explicit trusted fixture command is answered by this test driver.
      if (event.kind === "server-cancel") serverCancellations++;
      if (event.kind === "presentation") {
        presentations.push(event.request.method);
        if (event.request.method === "setStatus" && event.request.statusKey === "cedia-fixture" && event.request.statusText === undefined) statusCleared = true;
        if (event.request.method === "setWidget" && event.request.widgetKey === "cedia-fixture" && event.request.widgetLines === undefined) widgetCleared = true;
      }
      if (event.kind === "diagnostic" && ["invalid-frame", "unknown-method", "send-failed", "listener-failed"].includes(event.diagnostic.code)) callbackError = event.diagnostic.message;
      if (event.kind !== "interactive") return;
      const { request, token } = event;
      const title = request.title;
      uiMethods.push(String(request.method));
      let answer: string | boolean;
      switch (title) {
        case "Cedia G1 deny": answer = false; staleToken = token; break;
        case "Cedia G1 allow": answer = true; break;
        case "Cedia G1 select": answer = "second"; break;
        case "Cedia G1 input": answer = "fixture input"; break;
        case "Cedia G1 editor": answer = "fixture edited text"; break;
        default: return;
      }
      void broker!.respond(token, answer).catch(error => { callbackError = error; });
    },
  });
  client = await OmpRpcClient.start({
    executable,
    args: ["--no-session", "--no-skills", "--no-rules", "--no-extensions", "--no-title", "--cwd", cwd, "--trusted-extension", extension],
    cwd,
    // Intentionally do not inherit credentials, proxy variables, HOME or user OMP settings.
    env: { PATH: `${dirname(executable)}${delimiter}/usr/bin${delimiter}/bin`, PI_CODING_AGENT_DIR: cwd, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off", PI_RPC_EMIT_TITLE: "1" },
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
      broker!.ingest(event);
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
  check(Array.isArray(commands) && commands.some(command => record(command).name === "cedia-g1-ui"), "Trusted fixture command not loaded; refusing to submit it");
  checks.push("trusted-command-discovery");
  const messages = record((await client.request("get_messages_page", { limit: 10 })).data);
  check(Array.isArray(messages.messages) && messages.messages.length === 0, "Expected isolated empty history");
  await client.request("set_steering_mode", { mode: "all" });
  const after = record((await client.request("get_state")).data);
  check(after.steeringMode === "all", "Queue configuration readback mismatch");
  checks.push("history-and-config-readback");

  const ack = await client.request("prompt", { message: "/cedia-g1-ui" });
  check(typeof ack.id === "string", "Missing request correlation ID");
  const completed = await waitForLocalResult(ack.id);
  check(completed.agentInvoked === false, "Fixture unexpectedly invoked an agent");
  check(!callbackError, `UI response failed: ${String(callbackError)}`);
  const result = JSON.parse(await readFile(marker, "utf8"));
  check(result.denied === false && result.allowed === true, "Confirm semantics mismatch");
  check(result.selected === "second" && result.input === "fixture input" && result.edited === "fixture edited text", "Value dialog mismatch");
  check(result.cancelled === null && result.timedOut === false, "Cancel/timeout semantics mismatch");
  checks.push("confirm-deny-allow", "select-input-editor", "server-cancel-and-timeout");
  check(serverCancellations === 1, "Broker did not observe server cancellation");
  check(["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"].every(method => presentations.includes(method)) && statusCleared && widgetCleared, "Presentation/clear semantics missing");
  checks.push("presentation-events-and-clear");
  check(staleToken, "Missing response token");
  let staleRejected = false;
  try { await broker.respond(staleToken, true); } catch { staleRejected = true; }
  check(staleRejected, "Already-consumed UI response accepted");
  checks.push("duplicate-response-rejected");
  broker.dispose();
  const stats = record((await client.request("get_session_stats")).data);
  check(stats.assistantMessages === 0 && stats.toolCalls === 0 && stats.cost === 0, "Fixture has unexpected model/tool activity");
  checks.push("zero-model-turns");
  await client.close();
  checks.push("bounded-close");
  const receipt = { date: new Date().toISOString(), hostRuntime: { name: process.versions.bun ? "bun" : "node", version: process.versions.bun ?? process.versions.node }, version, binarySha256, implementationSourceHashes, sourceReference: "fc671eba383f2a7208500836673b485c0dc7073d", mode: "rpc-ui", checks, eventCounts, toolNames, uiMethods, presentations, serverCancellations, limitations: "Local extension UI protocol only; not rendered Mac/iPhone UI, custom TUI components, tool-policy enforcement or full OMP conformance. open_url covered by unit fixture only." };
  if (process.env.CEDIA_SMOKE_RECEIPT) {
    const output = resolve(process.env.CEDIA_SMOKE_RECEIPT);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(receipt, null, 2) + "\n");
  }
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  broker?.dispose();
  try { await client?.close(); }
  finally { await rm(cwd, { recursive: true, force: true }); }
}
