import { afterEach, describe, expect, it } from "bun:test";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { OmpRpcClient } from "../../../packages/omp-adapter/src/index.ts";
import { CEDIA_SESSION_OWNING_FLAGS, cediaOwnershipFlag, decideCediaCliInvocation } from "../src/cli-launcher.ts";
import { readCediaProcessStartIdentity } from "../../../packages/protocol/src/process-start-identity.ts";
import { CEDIA_OWNER_BRIDGE_VERSION, cediaOwnerRecordPath } from "../src/owner-endpoint.ts";
import { parseLauncherArguments, qualifyCediaTuiLaunch, readCediaTaskContext, resolvePinnedRuntime, runLauncher, type CediaTaskContext } from "../../../scripts/cedia-omp.ts";

/**
 * §8.2 O08's delivery half: one launcher for OMP's own CLI.
 *
 * The decisions are what matter. A verb with no session named runs; a verb against a session whose
 * owner answers is brokered or refused by name; a session-owning flag is refused while somebody
 * owns the session; a stale or ambiguous record is refused as-is. Nothing here starts a second
 * executor, and nothing kills or cleans up an owner.
 */

const run = promisify(execFile);
const runtime = process.env.CEDIA_OMP_BINARY ?? resolve(import.meta.dir, "../../../dist/omp/omp");
const RUNTIME_READY = existsSync(runtime);
const launcherScript = resolve(import.meta.dir, "../../../scripts/cedia-omp.ts");
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixtureDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "cedia-launcher-"));
  directories.push(directory);
  return directory;
}

const BASE_RECORD = {
  version: 1,
  protocolVersion: CEDIA_OWNER_BRIDGE_VERSION,
  sessionId: "session-launcher",
  incarnation: "inc-launcher",
  pid: process.pid,
  processStartIdentity: readCediaProcessStartIdentity(process.pid)!,
  ownerStartedAt: "2026-09-24T10:00:00.000Z",
  startedAt: "2026-09-24T10:00:00.000Z",
  cwd: "/workspace/demo",
  token: "fixture-token",
  socket: "",
};

/** A live owner endpoint that answers as the record says it should. */
async function liveOwner(directory: string) {
  const socket = join(directory, "owner.sock");
  const server = createServer(client => {
    client.setEncoding("utf8");
    client.on("data", chunk => {
      const request = JSON.parse(String(chunk).trim()) as { id: string };
      client.write(`${JSON.stringify({ id: request.id, protocolVersion: CEDIA_OWNER_BRIDGE_VERSION, ok: true, identity: { ...BASE_RECORD, socket }, status: { uptimeMs: 1 } })}\n`);
    });
    client.on("error", () => {});
  });
  await new Promise<void>(resolveListen => server.listen(socket, () => resolveListen()));
  mkdirSync(directory, { recursive: true });
  writeFileSync(cediaOwnerRecordPath(directory), `${JSON.stringify({ ...BASE_RECORD, socket })}\n`, { mode: 0o600 });
  return { socket, close: () => new Promise<void>(done => server.close(() => done())) };
}

describe("Cedia's qualified launcher decisions", () => {
  it("runs a verb with no session named, because there is nothing to conflict with", async () => {
    expect(await decideCediaCliInvocation({ verb: "bench" })).toMatchObject({ action: "run" });
  });

  it("brokers what it can and refuses what it cannot while an owner is live", async () => {
    const directory = fixtureDirectory();
    const owner = await liveOwner(directory);
    try {
      expect(await decideCediaCliInvocation({ verb: "status", sessionDirectory: directory })).toMatchObject({ action: "attach" });
      // Every other verb is refused by name rather than run beside the owner.
      const refused = await decideCediaCliInvocation({ verb: "launch", sessionDirectory: directory });
      expect(refused).toMatchObject({ action: "refuse", code: "owner_active" });
      expect((refused as { reason: string }).reason).toContain("does not broker");
    } finally { await owner.close(); }
  });

  it("refuses a flag that would start or attach a second executor", async () => {
    const directory = fixtureDirectory();
    const owner = await liveOwner(directory);
    try {
      for (const flag of ["--session", "--resume", "--fork", "--session-dir", "--continue", "-r", "-c"]) {
        const decision = await decideCediaCliInvocation({ verb: "status", args: [flag, "x"], sessionDirectory: directory });
        expect(decision).toMatchObject({ action: "refuse", code: "owner_active" });
      }
      // A configuration flag is not an ownership flag, so the brokered verb still works.
      expect(await decideCediaCliInvocation({ verb: "status", args: ["--model", "x"], sessionDirectory: directory })).toMatchObject({ action: "attach" });
    } finally { await owner.close(); }
  });

  it("refuses a stale or ambiguous record instead of resolving it", async () => {
    const directory = fixtureDirectory();
    mkdirSync(directory, { recursive: true });
    writeFileSync(cediaOwnerRecordPath(directory), `${JSON.stringify({ ...BASE_RECORD, socket: join(directory, "owner.sock") })}\n`, { mode: 0o600 });
    expect(await decideCediaCliInvocation({ verb: "status", sessionDirectory: directory })).toMatchObject({ action: "refuse", code: "owner_stale" });

    writeFileSync(cediaOwnerRecordPath(directory), `${JSON.stringify({ hello: "world" })}\n`, { mode: 0o600 });
    expect(await decideCediaCliInvocation({ verb: "status", sessionDirectory: directory })).toMatchObject({ action: "refuse", code: "owner_conflict" });
  });

  it("takes its ownership flags from the audit's own list", () => {
    const audit = JSON.parse(
      readFileSync(join(import.meta.dir, "../../../docs/maintenance/evidence/omp-complete-scope-2026-09-23/config-cli.json"), "utf8"),
    ) as { launchFlags: Record<string, string[]> };
    const audited = new Set(Object.entries(audit.launchFlags).filter(([key]) => key !== "source").flatMap(([, value]) => value));
    // Every flag this launcher guards is a real OMP flag, and the guard covers the session ones.
    for (const flag of CEDIA_SESSION_OWNING_FLAGS) expect([...audited]).toContain(flag);
    expect(cediaOwnershipFlag(["--model", "x", "--session", "y"])).toBe("--session");
    expect(cediaOwnershipFlag(["--print"])).toBeUndefined();
  });

	it("parses its own flags out of the OMP arguments", () => {
    expect(parseLauncherArguments(["status", "--cedia-session-dir", "/tmp/x", "--print"], {})).toEqual({ verb: "status", args: ["--print"], sessionDirectory: "/tmp/x" });
    expect(parseLauncherArguments(["--cedia-session-dir=/tmp/y", "bench"], {})).toEqual({ verb: "bench", args: [], sessionDirectory: "/tmp/y" });
    expect(parseLauncherArguments(["bench"], { CEDIA_SESSION_OWNER_DIR: "/tmp/z" })).toEqual({ verb: "bench", args: [], sessionDirectory: "/tmp/z" });
    expect(parseLauncherArguments([], {})).toEqual({ verb: undefined, args: [] });
	});

	it("accepts only a private host-authored task context for qualified TUI launches", () => {
		const directory = fixtureDirectory();
		const cwd = fixtureDirectory();
		const taskId = directory.split("/").at(-1)!;
		const contextPath = join(directory, ".cedia-task-context.json");
		const context = {
			version: 1,
			taskId,
			incarnation: "inc-tui",
			sessionFile: join(directory, "session.jsonl"),
			cwd,
			creditGuard: true,
		} satisfies CediaTaskContext;
		writeFileSync(contextPath, `${JSON.stringify(context)}\n`, { mode: 0o600 });
		expect(readCediaTaskContext(directory)).toEqual({ context });

		chmodSync(contextPath, 0o644);
		expect(readCediaTaskContext(directory)).toMatchObject({ reason: expect.stringContaining("private") });
	});

	it("injects the host lock, guard and forced transcript for an explicit TUI launch", () => {
		const directory = fixtureDirectory();
		const cwd = fixtureDirectory();
		const taskId = directory.split("/").at(-1)!;
		const context = {
			version: 1,
			taskId,
			incarnation: "inc-tui",
			sessionFile: join(directory, "session.jsonl"),
			cwd,
			creditGuard: true,
		} satisfies CediaTaskContext;
		writeFileSync(join(directory, ".cedia-task-context.json"), `${JSON.stringify(context)}\n`, { mode: 0o600 });
		const lockExtension = resolve(import.meta.dir, "../src/runtime-lock.ts");
		const qualified = qualifyCediaTuiLaunch(directory, ["--model", "fixture/model"], { CEDIA_RUNTIME_LOCK_EXTENSION: lockExtension });
		expect(qualified).toMatchObject({
			args: ["--model", "fixture/model", "--session", context.sessionFile, "--cwd", context.cwd, "--trusted-extension", lockExtension],
			environment: {
				CEDIA_SESSION_LOCK: join(realpathSync(directory), "owner.sqlite"),
				CEDIA_HOST_SESSION_ID: taskId,
				CEDIA_SESSION_INCARNATION: "inc-tui",
				CEDIA_POLICY_CREDIT_GUARD: "1",
				CEDIA_TUI_OWNER_BRIDGE: "1",
			},
		});
	});

  it("resolves the pinned runtime the repo prepared", () => {
    expect(resolvePinnedRuntime({ CEDIA_OMP_PATH: runtime }, "/nonexistent")).toBe(runtime);
    const environment = { ...process.env };
    delete environment.CEDIA_OMP_PATH;
    delete environment.CEDIA_OMP_BINARY;
    expect(resolvePinnedRuntime(environment, resolve(import.meta.dir, "../../../scripts"))).toBe(resolve(import.meta.dir, "../../../dist/omp/omp"));
    expect(resolvePinnedRuntime({}, "/nonexistent")).toBeUndefined();
  });

  it("exits non-zero with the reason when it refuses", async () => {
    const directory = fixtureDirectory();
    const owner = await liveOwner(directory);
    try {
      // `runLauncher` writes the refusal to stderr and returns the launcher's own exit code.
      const before = process.stderr.write;
      let captured = "";
      process.stderr.write = ((chunk: string) => { captured += String(chunk); return true; }) as typeof process.stderr.write;
      let code: number;
      try { code = await runLauncher(["launch", "--cedia-session-dir", directory], { CEDIA_OMP_PATH: runtime }); }
      finally { process.stderr.write = before; }
      expect(code).toBe(75);
      expect(captured).toContain("does not broker");
    } finally { await owner.close(); }
  });
});

describe.skipIf(!RUNTIME_READY)("the launcher against a real owner", () => {
  it("brokers status through the running owner and refuses a second executor", async () => {
    const directory = fixtureDirectory();
    const profile = fixtureDirectory();
    const cwd = fixtureDirectory();
    writeFileSync(join(profile, "models.yml"), `providers:
  fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: launcher-fixture-model
        name: Cedia launcher fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`);
    let client: OmpRpcClient | undefined;
    try {
      client = await OmpRpcClient.start({
        executable: runtime,
        cwd,
        args: ["--no-session", "--no-title", "--no-extensions", "--no-skills", "--no-rules"],
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: profile, PI_CODING_AGENT_DIR: profile,
          PI_NO_PTY: "1", PI_NOTIFICATIONS: "off",
          CEDIA_SESSION_LOCK: join(directory, "owner.sqlite"), CEDIA_SESSION_INCARNATION: "inc-launcher", CEDIA_RPC_OWNER_BRIDGE: "1",
        },
        readyTimeoutMs: 30_000, requestTimeoutMs: 15_000,
      });

      // The launcher, as a real process, brokered through the real owner.
      const brokered = await run(process.execPath, [launcherScript, "status", "--cedia-session-dir", directory], { env: { ...process.env, CEDIA_OMP_PATH: runtime } });
      expect(JSON.parse(brokered.stdout)).toMatchObject({ ok: true, status: { uptimeMs: expect.any(Number) } });

      // A second executor is refused with the launcher's own exit code and no process started.
      await expect(run(process.execPath, [launcherScript, "launch", "--cedia-session-dir", directory], { env: { ...process.env, CEDIA_OMP_PATH: runtime } }))
        .rejects.toMatchObject({ code: 75 });
    } finally {
      await client?.close().catch(() => {});
    }
  }, 60_000);
});
