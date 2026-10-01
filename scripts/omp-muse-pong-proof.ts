// Minimal live probe: set_model to Muse Spark 1.3 Free, one single-word pong
// turn, 120 s deadline, abort on timeout. Scratch state only.
import { mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

const PROVIDER = process.env.CEDIA_PONG_PROVIDER ?? "opencode-zen";
const MODEL = process.env.CEDIA_PONG_MODEL ?? "muse-spark-1.3-contributor-free";
const executable = resolve("dist/omp/omp");
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
if (!isSupportedOmpVersion(version)) throw new Error(`unsupported OMP ${version}`);

const profile = await mkdtemp(join(tmpdir(), "cedia-pong-profile-"));
const stateDir = await mkdtemp(join(tmpdir(), "cedia-pong-state-"));
const workDir = await mkdtemp(join(tmpdir(), "cedia-pong-work-"));
const realAgent = join(homedir(), ".omp", "agent");
for (const f of ["models.yml", "models.db", "models.db-shm", "models.db-wal", "config.yml"]) {
  try { await cp(join(realAgent, f), join(profile, f)); } catch { /* absent */ }
}
const started = await startHostServer({
  stateDir, port: 0, ompExecutable: executable, virtualUi: true,
  ompEnv: { HOME: profile, PI_CODING_AGENT_DIR: profile, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
let outcome = "unknown";
try {
  const owner = started.auth.ownerToken;
  const project = started.host.store.createProject({ path: workDir, name: "Muse pong" });
  const session = started.host.createSession(project.id, "Muse pong");
  await started.host.startSession(session.id);
  const incarnation = started.host.store.getSession(session.id)!.incarnation;
  const set = await started.host.command(session.id, "owner", {
    commandId: `pong-model-${randomUUID()}`, incarnation,
    command: "set_model", payload: { provider: PROVIDER, modelId: MODEL },
  });
  console.log(`SET-MODEL: ${set.status}`);
  if (!["completed", "acknowledged"].includes(set.status)) throw new Error("set_model refused");
  const t0 = Date.now();
  await started.host.command(session.id, "owner", {
    commandId: `pong-send-${randomUUID()}`, incarnation,
    command: "prompt", payload: { message: process.env.CEDIA_PONG_MESSAGE ?? "Reply with exactly the single word pong. Call no tools." },
  });
  let answer = "";
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const ev = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/events?after=0&limit=200`, token: owner });
    if (process.env.CEDIA_PONG_DEBUG_SHAPE === "1") {
      const b = ev.body as any;
      console.log(`EV-SHAPE: status=${ev.status} keys=${JSON.stringify(Object.keys(b ?? {}))} cursor=${b?.cursor} count=${Array.isArray(b?.events) ? b.events.length : "n/a"}`);
      console.log(`EV-TYPES: ${JSON.stringify((Array.isArray(b?.events) ? b.events : []).slice(0, 12).map((e: any) => e?.frame?.type ?? "?"))}`);
      throw new Error("shape-dump-done");
    }
    let after = 0;
    for (let guard = 0; guard < 30; guard++) {
      const page = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/events?after=${after}&limit=200`, token: owner });
      const b = page.body as any;
      for (const e of (b?.events ?? []) as any[]) {
        const f = e.frame ?? {};
        if (f.type === "turn_end" || f.type === "agent_end") (globalThis as any).__lastEnd = f;
        ((globalThis as any).__frameTypes ??= []).push(f.type);
        if ((f.type === "message_end" || f.type === "turn_end") && f.message?.role === "assistant" && Array.isArray(f.message?.content)) {
          const text = f.message.content.map((x: any) => typeof x.text === "string" ? x.text : "").join("").trim();
          if (text) answer = text;
        }
      }
      if (!b?.hasMore) break;
      after = typeof b?.cursor === "number" ? b.cursor : after + 200;
    }
    if (answer) break;
    const st = await started.router({ method: "GET", path: `/v1/sessions/${session.id}`, token: owner });
    const turnStates = ((st.body as any)?.turns ?? []).map((x: any) => x.state);
    if (turnStates.includes("running")) (globalThis as any).__seenRunning = true;
    if ((globalThis as any).__seenRunning && !(st.body as any || {}).status?.includes?.("running") && !turnStates.includes("running") && (st.body as any)?.status !== "running") break;
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`LAST-END: ${JSON.stringify((globalThis as any).__lastEnd ?? null).slice(0, 800)}`);
  console.log(`FRAME-TYPES: ${JSON.stringify((globalThis as any).__frameTypes ?? [])}`);
  console.log(`PONG-ANSWER: ${JSON.stringify(answer.slice(0, 120))} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const view = await started.router({ method: "GET", path: `/v1/sessions/${session.id}`, token: owner });
  const v = view.body as any;
  console.log(`SESSION-STATUS: ${v.status} turns=${JSON.stringify((v.turns ?? []).map((x: any) => x.state))}`);
  const expected = (process.env.CEDIA_PONG_EXPECT ?? "pong").toLowerCase();
  outcome = answer.toLowerCase() === expected ? "ANSWERED" : answer ? "WRONG-TEXT" : "TIMEOUT";
  console.log(`OUTCOME: ${outcome}`);
  await started.router({ method: "POST", path: `/v1/sessions/${session.id}/stop`, token: owner }).catch(() => {});
} finally {
  await started.close().catch(() => {});
  await rm(profile, { recursive: true, force: true });
  await rm(stateDir, { recursive: true, force: true });
  await rm(workDir, { recursive: true, force: true });
}
if (outcome !== "ANSWERED") throw new Error(`pong failed: ${outcome}`);
console.log("DONE");
