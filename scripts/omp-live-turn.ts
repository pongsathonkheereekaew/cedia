/**
 * One real OMP turn through the Cedia host API - the S2 end-to-end receipt.
 *
 * Unlike `omp-smoke.ts` this script is NOT provider-free: it spends real provider
 * credit on a single trivial prompt. It is therefore not part of `bun run test`
 * or `check:repo`; run it deliberately with `bun run smoke:omp:live`.
 *
 * The turn goes through the same path the Agents window uses:
 * host HTTP API -> startSession -> prompt command -> OMP -> streamed events.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED = "cedia-live-turn-ok";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function record(value: unknown): Record<string, unknown> {
  check(typeof value === "object" && value !== null && !Array.isArray(value), "Expected object");
  return value as Record<string, unknown>;
}
function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const descriptorPath = process.env.CEDIA_HOST_DESCRIPTOR ?? join(homedir(), "Library/Application Support/Cedia/host/host.json");
if (!existsSync(descriptorPath)) {
  // `ensure` starts the host detached and writes the descriptor the same way the app does.
  execFileSync(process.execPath, [join(ROOT, "dist/host/cli.js"), "ensure"], { stdio: "inherit", cwd: ROOT });
}
const descriptor = record(JSON.parse(readFileSync(descriptorPath, "utf8")));
const base = `${String(descriptor.url)}/v1`;
const token = String(descriptor.token);

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as unknown;
}

const health = record(await call("GET", "/health"));
console.log("health:", JSON.stringify(health));

const projectPath = resolve(process.env.CEDIA_LIVE_TURN_CWD ?? ROOT);
// `GET /projects` answers a bare array (it is the store's list, not an envelope).
const projects = await call("GET", "/projects");
const list = Array.isArray(projects) ? projects.map(record) : [];
let project = list.find(item => item.path === projectPath) ?? list.find(item => item.archived !== true);
if (!project) {
  project = record(await call("POST", "/projects", { path: projectPath }));
}
console.log("project:", project.name, project.id);

const created = record(await call("POST", "/sessions", { projectId: project.id, title: "Cedia live turn check" }));
const sessionId = String(created.id);
const beforeStart = String(created.incarnation);

// `start` allocates a fresh incarnation on purpose, so the command has to use the
// post-start value. The bundle adapter folds the same turn the same way.
const started = record(await call("POST", `/sessions/${sessionId}/start`));
const incarnation = String(started.incarnation);
check(incarnation !== beforeStart, "start did not allocate a new incarnation; the stale-incarnation guard would not be exercised");
console.log("session:", sessionId);

const prompt = `Do not read, create or modify any files. Reply with exactly this and nothing else: ${EXPECTED}`;
const command = record(await call("POST", `/sessions/${sessionId}/commands`, {
  commandId: randomUUID(),
  incarnation,
  command: "prompt",
  payload: { message: prompt },
}));
console.log("command:", command.kind, command.status, command.error ?? "");

// OMP's `prompt` ACK is immediate and `prompt_result` is reserved for scheduled prompts
// that never invoke the agent, so a real turn is complete on the terminal `agent_end`.
// The assistant text arrives as `message_start`/`message_update`/`message_end` frames.
const textOf = (message: unknown): string => {
  const content = record(message).content;
  if (!Array.isArray(content)) return "";
  return content.map(part => (typeof record(part).text === "string" ? String(record(part).text) : "")).join("");
};

let cursor = 0;
let answer = "";
let complete = false;
const frameTypes: string[] = [];
let assistantMessage: Record<string, unknown> = {};
const timeoutMs = 240_000;
const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline) {
  const page = record(await call("GET", `/sessions/${sessionId}/events?after=${cursor}&limit=200`));
  cursor = typeof page.cursor === "number" ? page.cursor : cursor;
  for (const entry of Array.isArray(page.events) ? page.events : []) {
    const frame = record(record(entry).frame ?? {});
    const type = String(frame.type);
    frameTypes.push(type);
    if (type === "message_end" || type === "turn_end") {
      const message = record(frame.message);
      const text = textOf(message);
      if (text) { answer = text.trim(); assistantMessage = message; }
    }
    if (type === "agent_end" && frame.isTerminal !== false) complete = true;
    if (type === "prompt_result") complete = true;
  }
  if (complete && answer) break;
  await new Promise(done => setTimeout(done, 1000));
}

const final = record(await call("GET", `/sessions/${sessionId}`));
check(complete, `The turn never reached a terminal agent_end within ${timeoutMs / 1000}s; status=${String(final.status)}`);
check(answer === EXPECTED, `The turn finished but the answer did not round-trip. Expected ${JSON.stringify(EXPECTED)}, received ${JSON.stringify(answer.slice(0, 200))}`);

// Leave no live OMP runtime behind: the next run starts its own session.
await call("POST", `/sessions/${sessionId}/stop`);

const receipt = {
  date: new Date().toISOString(),
  mode: "live-omp-turn",
  host: { descriptorPath, protocolVersion: health.protocolVersion, reportedOmpVersion: health.ompVersion },
  project: { id: project.id, path: project.path },
  session: { id: sessionId, incarnationBeforeStart: beforeStart, incarnation, finalStatus: final.status, finalIncarnation: final.incarnation },
  command: { id: command.commandId, kind: command.kind, status: command.status },
  stream: {
    frameCount: frameTypes.length,
    frameTypes: [...new Set(frameTypes)],
    counts: frameTypes.reduce<Record<string, number>>((tally, type) => ({ ...tally, [type]: (tally[type] ?? 0) + 1 }), {}),
  },
  result: {
    expected: EXPECTED,
    answer,
    matches: answer === EXPECTED,
    model: { provider: assistantMessage.provider, model: assistantMessage.model, api: assistantMessage.api, stopReason: assistantMessage.stopReason },
    usage: assistantMessage.usage,
  },
  implementationSourceHashes: {
    "apps/host/src/service.ts": sha256(join(ROOT, "apps/host/src/service.ts")),
    "apps/macos/src/omp-catalog.ts": sha256(join(ROOT, "apps/macos/src/omp-catalog.ts")),
    "scripts/omp-live-turn.ts": sha256(fileURLToPath(import.meta.url)),
  },
  limitations: "One prompt over one provider/model chosen by the user's OMP configuration; this is not multi-turn, tool-use, permission, or approval coverage.",
};

const output = process.env.CEDIA_SMOKE_RECEIPT;
if (output) {
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(resolve(output), JSON.stringify(receipt, null, 2) + "\n");
}
console.log(JSON.stringify(receipt, null, 2));
