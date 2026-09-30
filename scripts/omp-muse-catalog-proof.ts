// Read-only probe: list the live OMP session model catalog on isolated scratch
// state and print muse rows. No prompt is sent, no provider is called.
import { mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

const executable = resolve("dist/omp/omp");
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
if (!isSupportedOmpVersion(version)) throw new Error(`unsupported OMP ${version}`);
console.log(`OK   pinned OMP ${version}`);

const profile = await mkdtemp(join(tmpdir(), "cedia-muse-cat-profile-"));
const stateDir = await mkdtemp(join(tmpdir(), "cedia-muse-cat-state-"));
const workDir = await mkdtemp(join(tmpdir(), "cedia-muse-cat-work-"));
const realAgent = join(homedir(), ".omp", "agent");
for (const f of ["models.yml", "models.db", "models.db-shm", "models.db-wal", "config.yml"]) {
  try { await cp(join(realAgent, f), join(profile, f)); } catch { /* absent file */ }
}
const started = await startHostServer({
  stateDir, port: 0, ompExecutable: executable, virtualUi: true,
  ompEnv: { HOME: profile, PI_CODING_AGENT_DIR: profile, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
try {
  const owner = started.auth.ownerToken;
  const project = started.host.store.createProject({ path: workDir, name: "Muse catalog probe" });
  const session = started.host.createSession(project.id, "Muse catalog probe");
  await started.host.startSession(session.id);
  const res = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/models`, token: owner });
  const body = res.body as any;
  const rows: any[] = Array.isArray(body?.models) ? body.models : Array.isArray(body) ? body : [];
  console.log(`CATALOG-ROWS: ${rows.length}`);
  for (const r of rows) {
    const s = JSON.stringify(r);
    if (/muse/i.test(s)) console.log("MUSE-ROW: " + s.slice(0, 400));
  }
  await started.router({ method: "POST", path: `/v1/sessions/${session.id}/stop`, token: owner }).catch(() => {});
} finally {
  await started.close().catch(() => {});
  await rm(profile, { recursive: true, force: true });
  await rm(stateDir, { recursive: true, force: true });
  await rm(workDir, { recursive: true, force: true });
}
console.log("DONE");
