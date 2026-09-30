/** G1 real-OMP integration with local scripted completions; no external model inference. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { OmpRpcClient } from "../packages/omp-adapter/src/client.ts";
import { OmpHostDispatcher } from "../packages/omp-adapter/src/host.ts";
import { isSupportedOmpVersion, OMP_BASELINE_VERSION } from "../packages/omp-adapter/src/types.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function record(value: unknown): Record<string, unknown> {
  check(!!value && typeof value === "object" && !Array.isArray(value), "Expected object");
  return value as Record<string, unknown>;
}
async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function until(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!predicate()) {
    check(Date.now() < deadline, `Timed out: ${description}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 10));
  }
}
const requestedBinary = process.env.CEDIA_OMP_BINARY ?? "omp";
let executable: string | undefined;
for (const candidate of requestedBinary.includes("/") ? [resolve(requestedBinary)]
  : (process.env.PATH ?? "").split(delimiter).map(dir => join(dir, requestedBinary))) {
  if (await exists(candidate)) { executable = candidate; break; }
}
check(executable, `Set CEDIA_OMP_BINARY to OMP ${OMP_BASELINE_VERSION} or later`);
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 10_000 }).trim();
check(isSupportedOmpVersion(version), `Unsupported OMP: ${version} (the contract is written from ${OMP_BASELINE_VERSION} onward)`);
const binarySha256 = createHash("sha256").update(await readFile(executable)).digest("hex");
const cwd = await mkdtemp(join(tmpdir(), "cedia-g1-omp-"));
const marker = join(cwd, "host-marker.txt");
const protectedFile = join(cwd, "dirty-fixture.txt");
let client: OmpRpcClient | undefined;
let host: OmpHostDispatcher | undefined;
let failure: unknown;
let allowHost = false;
let hostEffects = 0;
let cancellableToolEntered = false;
let cancellableToolAborted = false;
let uriContent = "initial fixture content";
let uriWrites = 0;
let agentEnds = 0;
let modelRequests = 0;
let scriptedCall: { name: string; arguments: Record<string, unknown> } | undefined;
let callIssued = false;
const checks: string[] = [];
const eventCounts: Record<string, number> = {};
const sentFrames: Record<string, number> = {};
const authorizations: string[] = [];
const toolResults: Record<string, unknown>[] = [];
const notices: string[] = [];

// Only this temporary isolated OMP process receives the loopback model config.
const server = createServer(async (request, response) => {
  try {
    check(request.method === "POST" && request.url === "/v1/chat/completions", "Unexpected fixture HTTP route");
    let body = "";
    for await (const chunk of request) {
      body += chunk.toString();
      check(Buffer.byteLength(body) < 2_000_000, "Fixture request exceeded bound");
    }
    const payload = record(JSON.parse(body));
    check(payload.model === "cedia-scripted-model" && payload.stream === true, "Unexpected model request");
    check(scriptedCall, "Model called outside a scripted fixture turn");
    modelRequests++;
    check(modelRequests <= 24, "Unexpected model retry/loop");
    const call = !callIssued ? scriptedCall : undefined;
    callIssued = true;
    if (call) {
      check(Array.isArray(payload.tools) && payload.tools.some(tool => record(record(tool).function).name === call.name),
        `Fixture tool is not advertised: ${call.name}`);
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (delta: unknown, finish_reason: string | null = null) => ({
      id: `cedia-fixture-${modelRequests}`, object: "chat.completion.chunk", created: 0,
      model: "cedia-scripted-model", choices: [{ index: 0, delta, finish_reason }],
    });
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `fixture-call-${modelRequests}`,
      type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] }
      : { role: "assistant", content: "Local scripted fixture completed." };
    response.end([chunk(delta), chunk({}, call ? "tool_calls" : "stop"), "[DONE]"]
      .map(event => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join(""));
  } catch (error) {
    failure = error;
    response.writeHead(500).end("Fixture rejected request");
  }
});

async function runTool(name: string, args: Record<string, unknown>): Promise<void> {
  check(client, "Client not ready");
  scriptedCall = { name, arguments: args };
  callIssued = false;
  const previousEnds = agentEnds;
  const previousResults = toolResults.length;
  await client.request("prompt", { message: `Execute local fixture ${name}` });
  await until(() => agentEnds > previousEnds || !!failure, `agent_end for ${name}`);
  check(!failure, String(failure));
  check(callIssued && toolResults.length > previousResults, `No tool result for ${name}`);
  scriptedCall = undefined;
}

try {
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolveListen(); });
  });
  const address = server.address();
  check(address && typeof address !== "string", "No loopback port");
  await writeFile(join(cwd, "models.yml"), `providers:
  cedia-fixture:
    baseUrl: http://127.0.0.1:${address.port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-scripted-model
        name: Local scripted fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`);
  await writeFile(protectedFile, "manual buffer fixture baseline");
  const extension = join(cwd, "cedia-g1-fixture.ts");
  // This tests the upstream pre-effect hook, not an editor-aware production policy.
  await writeFile(extension, `export default function(api) {
    api.on("tool_call", (event, ctx) => {
      if (event.toolName === "write" && event.input.path === ${JSON.stringify(protectedFile)}) {
        ctx.ui.notify("cedia-g1-protected-write-blocked", "warning");
        return { block: true, reason: "Cedia fixture marks this path dirty" };
      }
    });
  }\n`);
  host = new OmpHostDispatcher({
    send: async frame => {
      check(client, "Host request before ready");
      sentFrames[frame.type] = (sentFrames[frame.type] ?? 0) + 1;
      await client.send(frame);
    },
    authorize: (request, signal) => {
      authorizations.push(String(request.type));
      return allowHost && !signal.aborted;
    },
    onError: error => { failure = error; },
  });
  host.registerTool({
    definition: { name: "cedia_fixture_effect", description: "Local fixture marker only", loadMode: "eager",
      parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } },
    handler: async (request, context) => {
      const args = record(request.arguments);
      check(typeof args.text === "string", "Invalid marker argument");
      if (args.text === "cancel-fixture") {
        check(!context.signal.aborted, "Fixture already cancelled");
        cancellableToolEntered = true;
        return new Promise<never>((_resolve, reject) => {
          context.signal.addEventListener("abort", () => {
            cancellableToolAborted = true;
            reject(new Error("Fixture cancelled before effect"));
          }, { once: true });
        });
      }
      await context.update({ content: [{ type: "text", text: "fixture progress" }] });
      check(!context.signal.aborted, "Cancelled marker write");
      await writeFile(marker, args.text);
      hostEffects++;
      return { content: [{ type: "text", text: "fixture marker written" }] };
    },
  });
  host.registerUriScheme({
    definition: { scheme: "cediafixture", writable: true, immutable: false },
    read: async () => ({ content: uriContent, contentType: "text/plain" }),
    write: async request => { check(typeof request.content === "string", "Missing URI content"); uriContent = request.content; uriWrites++; return {}; },
  });
  client = await OmpRpcClient.start({ executable, cwd,
    args: ["--no-session", "--no-skills", "--no-rules", "--no-extensions", "--no-title", "--cwd", cwd, "--trusted-extension", extension],
    env: { PATH: `${dirname(executable)}${delimiter}/usr/bin${delimiter}/bin`, PI_CODING_AGENT_DIR: cwd, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
    readyTimeoutMs: 15_000, requestTimeoutMs: 10_000,
    onFrame: frame => {
      eventCounts[String(frame.type)] = (eventCounts[String(frame.type)] ?? 0) + 1;
      if (frame.type === "agent_end") agentEnds++;
      if (frame.type === "tool_execution_end") toolResults.push(frame);
      if (frame.type === "extension_ui_request" && frame.method === "notify") notices.push(String(frame.message));
      if (typeof frame.type === "string" && (frame.type.startsWith("host_tool_") || frame.type.startsWith("host_uri_"))) {
        void Promise.resolve(host?.handle(frame)).catch(error => { failure = error; });
      }
    },
  });
  await client.request("set_auto_retry", { enabled: false });
  await client.request("set_auto_compaction", { enabled: false });
  await client.request("set_model", { provider: "cedia-fixture", modelId: "cedia-scripted-model" });
  await client.request("set_host_tools", { tools: host.getToolDefinitions() });
  await client.request("set_host_uri_schemes", { schemes: host.getUriSchemeDefinitions() });
  checks.push("registered-local-model-and-host-capabilities");
  await runTool("cedia_fixture_effect", { text: "denied" });
  check(hostEffects === 0 && !await exists(marker), "Denied host tool produced an effect");
  check(toolResults.at(-1)?.isError === true, "Host deny not propagated to OMP");
  checks.push("host-tool-deny-before-effect");
  allowHost = true;
  await runTool("cedia_fixture_effect", { text: "allowed" });
  check(Number(hostEffects) === 1 && await readFile(marker, "utf8") === "allowed", "Allowed host tool missing effect");
  check(sentFrames.host_tool_update === 1 && toolResults.at(-1)?.isError === false, "Host update/result not propagated");
  checks.push("host-tool-update-and-result");
  await runTool("read", { path: "cediafixture://document" });
  check(JSON.stringify(toolResults.at(-1)).includes(uriContent), "Host URI read content not returned");
  checks.push("host-uri-read-through-omp-tool");
  allowHost = false;
  await runTool("write", { path: "cediafixture://document", content: "denied URI content" });
  check(uriWrites === 0 && uriContent === "initial fixture content", "Denied URI changed data");
  check(toolResults.at(-1)?.isError === true, "URI deny not propagated");
  checks.push("host-uri-write-deny-before-effect");
  allowHost = true;
  await runTool("write", { path: "cediafixture://document", content: "allowed URI content" });
  check(Number(uriWrites) === 1 && String(uriContent) === "allowed URI content", "Allowed URI write missing");
  checks.push("host-uri-write-result");
  await runTool("write", { path: protectedFile, content: "must not overwrite" });
  check(await readFile(protectedFile, "utf8") === "manual buffer fixture baseline", "Hook allowed protected path overwrite");
  check(notices.includes("cedia-g1-protected-write-blocked") && toolResults.at(-1)?.isError === true, "Native hook block not observed");
  checks.push("native-tool-call-hook-blocks-fixture-write");
  scriptedCall = { name: "cedia_fixture_effect", arguments: { text: "cancel-fixture" } };
  callIssued = false;
  const previousEnds = agentEnds;
  await client.request("prompt", { message: "Execute cancellable local fixture" });
  await until(() => cancellableToolEntered || !!failure, "cancellable host handler");
  check(!failure, String(failure));
  await client.request("abort");
  await until(() => cancellableToolAborted && agentEnds > previousEnds, "host cancellation through OMP abort");
  scriptedCall = undefined;
  check(Number(hostEffects) === 1 && await readFile(marker, "utf8") === "allowed", "Cancelled host tool produced an effect");
  check(eventCounts.host_tool_cancel === 1, "Missing real OMP host cancellation frame");
  checks.push("omp-abort-cancels-host-handler-before-effect");
  check(!failure, String(failure));
  const stats = record((await client.request("get_session_stats")).data);
  check(stats.cost === 0 && modelRequests === 13, "Unexpected model requests or cost");
  checks.push("seven-scripted-runs-zero-external-inference");
  host.dispose();
  await client.close();
  checks.push("bounded-close");
  const implementationSourceHashes: Record<string, string> = {};
  for (const path of ["packages/omp-adapter/src/client.ts", "packages/omp-adapter/src/framing.ts", "packages/omp-adapter/src/types.ts", "packages/omp-adapter/src/host.ts", "scripts/omp-g1-smoke.ts"]) {
    implementationSourceHashes[path] = createHash("sha256").update(await readFile(new URL(`../${path}`, import.meta.url))).digest("hex");
  }
  const receipt = { date: new Date().toISOString(), hostRuntime: { name: process.versions.bun ? "bun" : "node", version: process.versions.bun ?? process.versions.node },
    version, binarySha256, sourceReference: "fc671eba383f2a7208500836673b485c0dc7073d", implementationSourceHashes,
    checks, eventCounts, sentFrames, authorizations, hostEffects, uriWrites, modelRequests, cancellableToolAborted,
    limitations: "Deterministic loopback completions, not external model inference. Hook block uses a fixture path, not editor dirty-buffer integration or universal policy. No UI visual, PTY, durable host, iPhone or full OMP conformance." };
  if (process.env.CEDIA_SMOKE_RECEIPT) {
    const output = resolve(process.env.CEDIA_SMOKE_RECEIPT);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(receipt, null, 2) + "\n");
  }
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  host?.dispose();
  try { await client?.close(); } finally {
    server.closeAllConnections();
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await rm(cwd, { recursive: true, force: true });
  }
}
