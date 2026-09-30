/** Interactive acceptance fixture: CUA/operator types and undoes in the real Cedia editor.
 * No simulated EditorConnections and no external inference. Keep the printed fixture
 * until its UI is closed. Create ready/undone marker files only after the UI action.
 */
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, realpath, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startHostServer } from "../apps/host/src/server.ts";
import { attestOmpRuntime } from "./lib/omp-runtime-integrity.ts";
import type { Json } from "../packages/protocol/src/index.ts";
const root = resolve(import.meta.dir, "..");
const executable = process.env.CEDIA_OMP_BINARY ?? join(root, "dist/omp-standalone/omp");
const attestation = attestOmpRuntime(root, executable);
const dir = await realpath(await mkdtemp(join(tmpdir(), "cedia-codeoss-editor-")));
const workspace = join(dir, "workspace"); await mkdir(workspace);
const path = join(workspace, "fixture.txt"); await writeFile(path, "disk original\n");
const stateDir = join(dir, "host");
await mkdir(join(workspace, ".vscode"));
await writeFile(join(workspace, ".vscode", "settings.json"), JSON.stringify({ "cedia.hostStateDir": stateDir }, null, 2) + "\n");
const interactiveApproval = process.env.CEDIA_INTERACTIVE_APPROVAL === "1";
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
let requests = 0;
let modelFailure: unknown;
const model = createServer(async (req, res) => {
  try {
    check(req.method === "POST" && req.url === "/v1/chat/completions", "Unexpected model route");
    let body = "";
    for await (const chunk of req) { body += String(chunk); check(body.length < 2_000_000, "Model body limit"); }
    const input = JSON.parse(body);
    check(input.model === "editor-fixture" && input.stream, "Wrong fixture model");
    const step = ++requests; check(step <= 6, "Unexpected model loop");
    const latestTool = [...input.messages].reverse().find((message: { role?: string }) => message.role === "tool");
    if (step === 2 || step === 6) check(JSON.stringify(latestTool).includes("unsaved original"), "Model did not see the original dirty buffer");
    if (step === 4) check(JSON.stringify(latestTool).includes("unsaved edited"), "Guarded edit was not visible in the native buffer");
    const finish = step === 4 || step === 6;
    const tool = step === 2
      ? { name: "edit", arguments: JSON.stringify({ path, old_string: "unsaved original", new_string: "unsaved edited" }) }
      : { name: "read", arguments: JSON.stringify({ path }) };
    const delta = finish ? { role: "assistant", content: "Fixture verified." }
      : { role: "assistant", tool_calls: [{ index: 0, id: `native-${step}`, type: "function", function: tool }] };
    const frame = (delta: unknown, reason: string | null) => ({ id: `fixture-${step}`, object: "chat.completion.chunk", created: 0, model: "editor-fixture", choices: [{ index: 0, delta, finish_reason: reason }] });
    res.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
    res.end([frame(delta, null), frame({}, finish ? "stop" : "tool_calls"), "[DONE]"].map(value => `data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`).join(""));
  } catch (error) { modelFailure = error; res.writeHead(500); res.end("Fixture rejected request"); }
});
await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve));
const address = model.address(); if (!address || typeof address === "string") throw new Error("No fixture port");
await writeFile(join(dir, "models.yml"), `providers:\n  cedia-fixture:\n    baseUrl: http://127.0.0.1:${address.port}/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: editor-fixture\n        name: Cedia local editor fixture\n        reasoning: false\n        input: [text]\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n        contextWindow: 128000\n        maxTokens: 4096\n`);
const server = await startHostServer({ stateDir, ompExecutable: executable, editorBridge: true,
  ompEnv: { PATH: "/usr/bin:/bin", HOME: dir, PI_CODING_AGENT_DIR: dir, PI_EDIT_VARIANT: "replace", PI_NOTIFICATIONS: "off", TERM: "xterm-256color" },
  ompArgs: ["--no-skills", "--no-rules", "--no-extensions"] });
const host = server.host;
let serial = 0, approvals = 0;
const observedApprovalTokens = new Set<string>();
const waitMarker = async (name: string) => {
  const deadline = performance.now() + 10 * 60_000;
  while (performance.now() < deadline) {
    try { await access(join(dir, name)); return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for native UI ${name}; fixture retained at ${dir}`);
};
try {
  const project = host.store.createProject({ path: workspace });
  const session = await host.startSession(host.createSession(project.id).id);
  const command = (name: string, payload: Record<string, Json>) => host.command(session.id, "fixture-owner", { commandId: `native-${++serial}`, incarnation: session.incarnation, command: name, payload });
  for (const [name, payload] of [["set_model", { provider: "cedia-fixture", modelId: "editor-fixture" }], ["set_auto_retry", { enabled: false }], ["set_auto_compaction", { enabled: false }]] as const)
    check((await command(name, payload)).status === "completed", `Setup ${name} failed`);
  console.log(JSON.stringify({ stage: "prepare-native-ui", fixture: dir, workspace, stateDir, path,
    instructions: "Open workspace in Cedia. Type unsaved original plus newline without saving; create ready marker." }));
  const run = async (message: string) => {
    const prompt = await command("prompt", { message });
    const deadline = performance.now() + (interactiveApproval ? 5 * 60_000 : 60_000);
    while (performance.now() < deadline && host.store.getCommand(session.id, prompt.commandId)?.status !== "completed") {
      if (modelFailure) throw modelFailure;
      for (const pending of host.pendingUi(session.id) as { token: string; request: { method: string } }[]) {
        check(pending.request.method === "confirm", "Unexpected fixture approval");
        if (!observedApprovalTokens.has(pending.token)) {
          observedApprovalTokens.add(pending.token);
          approvals++;
          if (interactiveApproval) console.log(JSON.stringify({ stage: "approve-in-native-ui", fixture: dir, tokenObserved: true }));
        }
        if (!interactiveApproval) await host.respond(session.id, "fixture-owner", { commandId: `approve-${approvals}`, incarnation: session.incarnation, token: pending.token, answer: true });
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    check(!modelFailure, String(modelFailure));
    check(host.store.getCommand(session.id, prompt.commandId)?.status === "completed", "Native UI turn did not complete");
    check(await readFile(path, "utf8") === "disk original\n", "Native UI operation saved behind the editor");
  };
  await waitMarker("ready");
  await run("Read, edit and read the fixture buffer");
  check(requests === 4 && approvals === 1, "Missing native read/edit confirmation");
  console.log(JSON.stringify({ stage: "undo-in-native-ui", fixture: dir, instructions: "Focus fixture.txt, invoke Undo once, then create undone marker. Do not save." }));
  await waitMarker("undone");
  await run("Read the fixture buffer after native Undo");
  check(requests === 6, "Missing post-Undo read");
  check(JSON.stringify(attestOmpRuntime(root, executable)) === JSON.stringify(attestation), "Runtime changed during acceptance");
  const receipt = { capturedAt: new Date().toISOString(), realNativeEditor: true, scriptedModelOnly: true, paidModelCalls: 0, modelRequests: requests, approvalMode: interactiveApproval ? "native-ui" : "fixture-owner", ...attestation,
    checks: ["native-dirty-read", "native-guarded-edit", "native-read-after-edit", "single-permission", "disk-unchanged", "native-undo-restores-dirty-text"] };
  const evidence = join(root, "docs/maintenance/evidence/omp-codeoss-editor-2026-09-13");
  await mkdir(evidence, { recursive: true }); await writeFile(join(evidence, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt));
} finally { await server.close(); await new Promise<void>(resolve => model.close(() => resolve())); }
