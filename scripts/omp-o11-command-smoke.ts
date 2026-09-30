/** Real standalone OMP + Cedia host: every pinned RPC name except turn/OAuth. No paid model calls. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { RPC_COMMAND_TYPES, type RpcCommandType } from "../packages/omp-adapter/src/types.ts";
import type { Json } from "../packages/protocol/src/index.ts";
import { CediaHost } from "../apps/host/src/service.ts";
import { DurableStore } from "../apps/host/src/store.ts";
import { fileSha256 } from "./lib/omp-runtime-integrity.ts";

const root = resolve(import.meta.dir, "..");
const executable = resolve(process.env.CEDIA_OMP_BINARY ?? join(root, "dist/omp-standalone/omp"));
const skipped = new Set<RpcCommandType>([
	"prompt",
	"steer",
	"follow_up",
	"abort_and_prompt",
	"handoff",
	"compact",
	"login",
]);
const fixture = mkdtempSync(join(tmpdir(), "cedia-o11-"));
const checks: string[] = [];
const results: Array<{ command: string; status: string }> = [];
const check = (condition: unknown, message: string) => {
	if (!condition) throw new Error(message);
};
let complete = false;
const store = DurableStore.open({ stateDir: fixture, recover: false });
const host = new CediaHost({
	store,
	stateDir: fixture,
	ompExecutable: executable,
	ompArgs: ["--no-skills", "--no-rules", "--no-extensions"],
	ompEnv: {
		PATH: `${dirname(executable)}:/usr/bin:/bin`,
		HOME: fixture,
		PI_CODING_AGENT_DIR: fixture,
		PI_NO_PTY: "1",
		PI_NOTIFICATIONS: "off",
	},
});
try {
	writeFileSync(
		join(fixture, "models.yml"),
		`providers:
  probe:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: probe-model
        name: Cedia O11 fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`,
		{ mode: 0o600 },
	);
	const projectPath = join(fixture, "project");
	mkdirSync(projectPath);
	writeFileSync(join(projectPath, "readme.txt"), "o11 fixture\n");
	const project = store.createProject({ path: projectPath, name: "O11 fixture" });
	const created = host.createSession(project.id, "O11 commands");
	const started = await host.startSession(created.id);
	check(started.status === "idle", "Real OMP session did not become idle");
	checks.push("standalone-omp-start-without-provider");
	const sessionFile = store.getSession(created.id)!.sessionFile;
	const payloads: Record<RpcCommandType, { [key: string]: Json }> = {
		negotiate_protocol: { protocolVersion: 2 },
		prompt: { message: "must-not-send" },
		steer: { message: "must-not-send" },
		follow_up: { message: "must-not-send" },
		abort: {},
		abort_and_prompt: { message: "must-not-send" },
		new_session: {},
		get_state: {},
		set_fast_mode: { enabled: false },
		get_available_commands: {},
		set_todos: { phases: [] },
		set_host_tools: { tools: [] },
		set_host_uri_schemes: { schemes: [] },
		set_subagent_subscription: { level: "off" },
		get_subagents: {},
		get_subagent_messages: {},
		set_model: { provider: "probe", modelId: "probe-model" },
		cycle_model: {},
		get_available_models: {},
		set_thinking_level: { level: "off" },
		cycle_thinking_level: {},
		get_available_thinking_levels: {},
		set_steering_mode: { mode: "all" },
		set_follow_up_mode: { mode: "all" },
		set_interrupt_mode: { mode: "immediate" },
		compact: {},
		set_auto_compaction: { enabled: false },
		set_auto_retry: { enabled: false },
		abort_retry: {},
		bash: { command: "printf o11" },
		abort_bash: {},
		get_session_stats: {},
		export_html: { outputPath: join(fixture, "export.html") },
		switch_session: { sessionPath: sessionFile },
		branch: { entryId: "missing-entry" },
		get_branch_messages: {},
		get_last_assistant_text: {},
		set_session_name: { name: "o11-real" },
		handoff: {},
		get_messages: {},
		get_messages_page: { limit: 5 },
		get_entries: {},
		get_tree: {},
		open_session: { sessionDir: sessionFile },
		set_event_filter: { events: null },
		get_login_providers: {},
		login: { providerId: "must-not-send" },
	};
	check(Object.keys(payloads).length === 47, "Payload map drifted from the 47-command inventory");
	const queries = [
		"get_state",
		"get_available_commands",
		"get_available_models",
		"get_session_stats",
		"get_messages",
		"get_messages_page",
		"get_login_providers",
		"get_subagents",
		"get_last_assistant_text",
	] as const;
	for (const command of RPC_COMMAND_TYPES) {
		if (skipped.has(command)) {
			results.push({ command, status: "skipped" });
			continue;
		}
		const commandId = `o11-${command}`;
		const result = await host.command(created.id, "owner", {
			commandId,
			incarnation: started.incarnation,
			command,
			payload: payloads[command],
		});
		results.push({ command, status: result.status });
		check(result.status !== "not_dispatched", `${command} was not dispatched to a ready session`);
		check(["completed", "failed", "acknowledged", "outcome_unknown"].includes(result.status), `${command} had unexpected status ${result.status}`);
	}
	for (const command of queries) {
		check(results.find(row => row.command === command)?.status === "completed", `${command} must complete on a provider-free session`);
	}
	check(results.filter(row => row.status === "skipped").length === skipped.size, "Skip set and results diverged");
	check(results.length === 42, "Did not cover every pinned RPC command");
	checks.push("query-commands-complete-without-provider");
	checks.push("non-turn-commands-reach-omp");
	checks.push("turn-and-oauth-commands-not-sent");
	await host.stopSession(created.id);
	checks.push("graceful-stop");
	const evidence = join(root, "docs/maintenance/evidence/omp-o11-2026-09-13");
	mkdirSync(evidence, { recursive: true });
	const receipt = {
		capturedAt: new Date().toISOString(),
		syntheticOnly: true,
		paidModelCalls: 0,
		ompSha256: fileSha256(executable),
		checks,
		results,
		skipped: [...skipped],
	};
	writeFileSync(join(evidence, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
	console.log(JSON.stringify(receipt, null, 2));
	complete = true;
} finally {
	await host.close().catch(() => {});
	store.close();
	if (complete) rmSync(fixture, { recursive: true, force: true });
	else console.error(`Retained failed O11 fixture: ${fixture}`);
}
