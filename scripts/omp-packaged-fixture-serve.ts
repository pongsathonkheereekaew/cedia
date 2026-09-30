/**
 * Fixture host + packaged app for computer-use driving (no provider, no spend, no user data).
 *
 * Mirrors the launch block of `scripts/agent-window-smoke.ts --native`: a scratch git
 * project, an in-process host on scratch state with the provider-free fixture OMP, and the
 * packaged Cedia.app on a fresh profile pointed at that host. Unlike the smoke, this driver
 * stays alive so an operator (computer use) can drive the live windows, then quits on SIGTERM.
 *
 * Run: nohup bun scripts/omp-packaged-fixture-serve.ts > /tmp/cedia-fixture-serve.log 2>&1 &
 * Stop: kill the printed PID, then remove the printed scratch dir.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";

const root = resolve(import.meta.dir, "..");
const scratch = await realpath(await mkdtemp(join(tmpdir(), "cedia-fixture-serve-")));
const projectPath = join(scratch, "project");
await mkdir(projectPath);
await writeFile(join(projectPath, "hello.txt"), "Fixture serve hello\n");
execFileSync("git", ["init"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["add", "hello.txt"], { cwd: projectPath, stdio: "ignore" });
execFileSync("git", ["-c", "user.email=fixture@cedia", "-c", "user.name=Cedia Fixture", "commit", "-m", "fixture"], { cwd: projectPath, stdio: "ignore" });

const started = await startHostServer({
	stateDir: join(scratch, "host"),
	ompExecutable: join(root, "apps/macos/test/fixtures/agent-window-omp"),
	ompEnv: { CEDIA_NODE: process.execPath },
});
const project = started.host.store.createProject({ path: projectPath, name: "Agent Window fixture" });
const session = started.host.createSession(project.id, "Fixture task");

const app = join(root, `VSCode-darwin-${process.arch}`, "Cedia.app", "Contents", "MacOS", "Cedia");
let child: ChildProcess | undefined;
try {
	child = spawn(app, ["--user-data-dir", join(scratch, "profile"), "--password-store=basic", "--use-inmemory-secretstorage", "--skip-welcome", "--skip-release-notes"],
		{ env: { ...process.env, CEDIA_STATE_DIR: join(scratch, "host"), CEDIA_HOST_NODE: "/Users/pond/.caret-tools/node-v24.18.0-darwin-arm64/bin/node" }, stdio: "ignore", detached: true });
	child.unref();
	console.log(JSON.stringify({ ok: true, pid: process.pid, scratch, session: session.id, project: project.id, appPid: child.pid }));
	await new Promise(resolveVerify => setTimeout(resolveVerify, 5000));
	const { execSync: verifyPs } = await import("node:child_process");
	const tree = verifyPs("ps -ax -o pid,ppid,command", { encoding: "utf8" }).split("\n")
		.filter(line => /Cedia\.app\/Contents\/MacOS\/Cedia( |$)/.test(line)).join("\n");
	console.log("APP_TREE:\n" + tree);
} catch (error) {
	console.error(`fixture serve launch failed: ${error instanceof Error ? error.message : error}`);
	process.exitCode = 1;
}
const shutdown = async () => {
	try { child?.kill(); } catch {}
	await started.close().catch(() => {});
	process.exit(process.exitCode ?? 0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
// Stay alive for the operator; the process ends only on SIGTERM/SIGINT.
await new Promise(() => {});
