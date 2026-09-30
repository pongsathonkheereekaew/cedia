/**
 * Live proof that a `dirtyFiles` selection reaches a real worktree (CEDIA-PLAN §3.C, §11.1 D row).
 *
 * A real host plus a real fixture Git repository: one task names exactly the tracked file it
 * carries (an untracked file stays behind), a second task names an empty selection (clean
 * checkout), and a malformed selection is refused before anything is created. The dispatches
 * go through the production adapter `thread.create` path, so the vendor command shape, the
 * adapter forwarding, the host resolution and the Git carry are all exercised. Session
 * creation needs no runtime and no provider: zero turns, zero spend.
 *
 * Run: bun scripts/omp-dirty-carry-proof.ts
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startHostServer } from "../apps/host/src/server.ts";
import { createAgentWindowHandler } from "../apps/macos/src/agent-window-main.ts";
import { createCediaNativeApi } from "../apps/macos/agent-window/src/cedia-adapter.ts";

const FAIL_PREFIX = "OMP dirty-carry proof failed";
function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`${FAIL_PREFIX}: ${message}`);
	console.log(`OK   ${message}`);
}
function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${FAIL_PREFIX}: ${message}`);
	return value as Record<string, unknown>;
}
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${FAIL_PREFIX}: timed out waiting for ${label}`)), ms); }),
		]);
	} finally { if (timer !== undefined) clearTimeout(timer); }
}

const git = (args: string[], cwd: string, input?: string): string => {
	const result = execFileSync("git", args, { cwd, encoding: "utf8", timeout: 30_000, input });
	return typeof result === "string" ? result : "";
};

const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-dirty-host-state-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-dirty-host-work-"));
const windowStateDir = await mkdtemp(join(tmpdir(), "cedia-dirty-window-state-"));
const cleanupDirs = async () => {
	await Promise.all([
		rm(hostStateDir, { recursive: true, force: true }),
		rm(hostWorkDir, { recursive: true, force: true }),
		rm(windowStateDir, { recursive: true, force: true }),
	]);
};

// Fixture repository: committed base plus one tracked modification and one untracked file.
git(["init"], hostWorkDir);
git(["config", "user.email", "fixture@cedia"], hostWorkDir);
git(["config", "user.name", "Cedia Fixture"], hostWorkDir);
await writeFile(join(hostWorkDir, "keep.txt"), "base\n");
await writeFile(join(hostWorkDir, "drop.txt"), "base\n");
git(["add", "keep.txt", "drop.txt"], hostWorkDir);
git(["commit", "-m", "fixture base"], hostWorkDir);
await writeFile(join(hostWorkDir, "keep.txt"), "dirty carry me\n");
await writeFile(join(hostWorkDir, "new.txt"), "do not carry me\n");
const branch = git(["branch", "--show-current"], hostWorkDir).trim();
check(branch.length > 0, `fixture repository is on a branch (${branch})`);

let exitCode = 0;
try {
	const started = await withTimeout(startHostServer({
		stateDir: hostStateDir,
		port: 0,
		ompExecutable: resolve("dist/omp/omp"),
		virtualUi: true,
		ompEnv: { HOME: hostStateDir, PI_CODING_AGENT_DIR: hostStateDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
	}), 60_000, "host boot");
	try {
		const owner = started.auth.ownerToken;
		const route = async (method: string, path: string, body?: unknown): Promise<unknown> => {
			const res = await started.router({ method, path, token: owner, body });
			if (res.status >= 400) {
				const failure = record(res.body, `error body for ${method} ${path}`);
				const detail = record(failure.error, `error detail for ${method} ${path}`);
				const error = new Error(typeof detail.message === "string" ? detail.message : `Host refused ${method} ${path}`) as Error & { code?: string };
				error.code = typeof detail.code === "string" ? detail.code : undefined;
				throw error;
			}
			return res.body;
		};
		const gatewayRequest = async (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<unknown> =>
			route(method, path.startsWith("/v1/") ? path : `/v1/${path}`, body);
		const handler = createAgentWindowHandler({
			stateDir: windowStateDir,
			authorize: () => true,
			ensure: async () => {},
			request: gatewayRequest,
			pickFolder: async () => { throw new Error("pickFolder is out of scope for the dirty-carry proof"); },
			openIde: async () => { throw new Error("openIde is out of scope for the dirty-carry proof"); },
			openExternal: async () => { throw new Error("openExternal is disabled in the dirty-carry proof"); },
			broadcastDraft: () => {},
			version: "dirty-carry-proof",
		});
		const api = createCediaNativeApi({ bridge: { invoke: async (_channel: unknown, input: unknown) => handler({ window: "A" }, input) } as never });
		const project = started.host.store.createProject({ path: hostWorkDir, name: "Dirty carry" });

		const create = (commandId: string, threadId: string, extra: Record<string, unknown>) =>
			api.orchestration.dispatchCommand({
				type: "thread.create",
				commandId,
				threadId,
				projectId: project.id,
				title: "Dirty carry",
				modelSelection: { provider: "omp", model: "fixture/fixture-model" },
				runtimeMode: "approval-required",
				interactionMode: "default",
				envMode: "worktree",
				branch,
				worktreePath: null,
				createdAt: "2026-09-19T00:04:00.000Z",
				...extra,
			} as never);
		const worktreeOf = async (threadId: string): Promise<string> => {
			const row = record(await route("GET", `/v1/sessions/${threadId}`), "session row");
			const cwd = typeof row.cwd === "string" ? row.cwd : undefined;
			check(cwd !== undefined && cwd !== hostWorkDir, `the task works in its own worktree (${cwd})`);
			return cwd as string;
		};

		// Case 1: a selection carries exactly the named tracked file.
		await withTimeout(create("carry-one", "draft-carry-one", { dirtyFiles: ["keep.txt"] }), 90_000, "selected creation");
		const first = await worktreeOf("draft-carry-one");
		check((await readFile(join(first, "keep.txt"), "utf8")) === "dirty carry me\n", "the selected tracked change arrives byte-exact");
		let newMissing = false;
		try { await readFile(join(first, "new.txt"), "utf8"); } catch { newMissing = true; }
		check(newMissing, "the unselected untracked file stays behind");

		// Case 2: an explicit empty selection carries a clean checkout.
		await withTimeout(create("carry-none", "draft-carry-none", { dirtyFiles: [] }), 90_000, "empty creation");
		const second = await worktreeOf("draft-carry-none");
		check((await readFile(join(second, "keep.txt"), "utf8")) === "base\n", "an empty selection carries the clean base");
		let secondMissing = false;
		try { await readFile(join(second, "new.txt"), "utf8"); } catch { secondMissing = true; }
		check(secondMissing, "an empty selection carries no untracked file");

		// Case 3: a malformed selection is refused before anything is created.
		let refused: unknown;
		try {
			await withTimeout(create("carry-bad", "draft-carry-bad", { dirtyFiles: "keep.txt" }), 90_000, "malformed creation");
		} catch (error) { refused = error; }
		check(refused !== undefined, "a malformed selection is refused");
		const sessions = started.host.store.listSessions?.() ?? [];
		check(!sessions.some((session: { id?: unknown }) => session.id === "draft-carry-bad"), "the refused creation left no session behind");

		// The source repository is untouched apart from the managed worktrees it owns.
		const dirt = git(["status", "--porcelain"], hostWorkDir);
		check(dirt.trim() === "M keep.txt\n?? new.txt", "source dirt is intact");
		console.log(JSON.stringify({ ok: true, selected: "keep.txt carried, new.txt left", empty: "clean checkout", malformed: "refused" }, null, 2));
		await started.close().catch(() => {});
	} finally {
		await started.close().catch(() => {});
	}
} catch (error) {
	exitCode = 1;
	console.error(error instanceof Error ? error.message : error);
} finally {
	await cleanupDirs();
}
process.exit(exitCode);
