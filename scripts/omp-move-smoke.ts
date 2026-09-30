/**
 * Live proof that `/move <existing-dir>` relocates the session headless (O02).
 *
 * The with-args form for an existing directory relocates the session headless into
 * the session's own `moveSession`: the session file lands under the destination
 * directory with no model turn and no provider call. Bare and missing-target forms are
 * answered headless by the RPC guard in rpc-mode.ts with the ACP handler's own texts
 * (usage / not-a-directory), so no form wedges the turn anymore; the fence entry left
 * with them (see evidence/o02-move-headless-answered-2026-09-25/).
 *
 * Run: bun scripts/omp-move-smoke.ts
 */
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, OmpRpcClient, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP move smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP move smoke failed: ${message}`);
	return value as Record<string, unknown>;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? "dist/omp/omp";
const executable = requested.includes("/")
	? resolve(requested)
	: ((process.env.PATH ?? "")
			.split(delimiter)
			.map(dir => join(dir, requested))
			.find(candidate => candidate) ?? requested);
check(await exists(executable), `OMP runtime is present at ${executable}`);
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `the runtime is the pinned ${OMP_BASELINE_VERSION} or later (${version})`);

const base = await mkdtemp(join(tmpdir(), "cedia-move-"));
await mkdir(join(base, "subdir"), { recursive: true });
await mkdir(join(base, "sdir"), { recursive: true });

let client: OmpRpcClient | undefined;
try {
	client = await OmpRpcClient.start({
		executable,
		args: ["--session", join(base, "sdir", "session.jsonl"), "--session-dir", join(base, "sdir"), "--no-skills", "--no-rules", "--no-extensions", "--no-title", "--cwd", base],
		cwd: base,
		env: {
			PATH: `${dirname(executable)}${delimiter}/usr/bin${delimiter}/bin`,
			HOME: base,
			PI_CODING_AGENT_DIR: base,
			PI_NO_PTY: "1",
			PI_NOTIFICATIONS: "off",
			TERM: "xterm-256color",
			CEDIA_RPC_VIRTUAL_UI: "1",
		},
		readyTimeoutMs: 30_000,
		requestTimeoutMs: 30_000,
		onFrame() {
			/* frames are not needed for this proof */
		},
	});
	await client.requestCedia("cedia_terminal_negotiate", { version: 1, cols: 40, rows: 8 });
	const before = record((await client.request("get_state", {}) as { data?: unknown })?.data ?? {}, "get_state before the move");
	const beforeFile = String(before.sessionFile ?? "");
	check(beforeFile.length > 0, "get_state names the live session file");
	const started = Date.now();
	const moved = (await client.request("prompt", { message: "/move subdir" })) as { success?: unknown; data?: unknown };
	const elapsed = Date.now() - started;
	check(moved?.success === true, "/move subdir answers success");
	check(record(moved?.data ?? {}, "move answer").agentInvoked === false, "the move runs as a builtin command with no agent turn");
	check(elapsed < 30_000, `the move settles instead of hanging (${elapsed}ms)`);
	const after = record((await client.request("get_state", {}) as { data?: unknown })?.data ?? {}, "get_state after the move");
	const afterFile = String(after.sessionFile ?? "");
	check(afterFile.length > 0 && afterFile !== beforeFile, "the session file relocated");
	check(await exists(afterFile), "the relocated session file exists on disk");
	check(!(await exists(beforeFile)), "the source session file is gone (the runtime renamed it, not copied it)");
	await client.close();
	client = undefined;
} finally {
	await client?.close().catch(() => {});
}
await rm(base, { recursive: true, force: true });
console.log("OMP move smoke passed: /move <existing-dir> relocates the session headless with no turn and no provider call.");
