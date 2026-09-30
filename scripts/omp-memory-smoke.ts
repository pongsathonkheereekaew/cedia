/**
 * Live proof of Cedia's O09 memory view against the pinned runtime.
 *
 * OMP owns the effective backend and its memory session state. This smoke reads the shape-only
 * projection, applies the selected backend through the owner-only route, and proves command
 * idempotency. The fixture provider endpoint never answers, so no model request can complete.
 *
 * Run: bun scripts/omp-memory-smoke.ts
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { startHostServer } from "../apps/host/src/server.ts";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/types.ts";

function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`OMP memory smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP memory smoke failed: ${message}`);
	return value as Record<string, unknown>;
}

const root = resolve(import.meta.dir, "..");
const requested = process.env.CEDIA_OMP_PATH ?? process.env.CEDIA_OMP_BINARY ?? join(root, "dist/omp/omp");
const executable = requested.includes("/") ? resolve(requested) : requested;
const version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim();
check(isSupportedOmpVersion(version), `the runtime is the pinned ${OMP_BASELINE_VERSION} or later (${version})`);

const stateDir = mkdtempSync(join("/tmp", "cedia-omp-memory-"));
const profileDir = mkdtempSync(join("/tmp", "cedia-omp-memory-profile-"));
const workDir = mkdtempSync(join("/tmp", "cedia-omp-memory-work-"));
const held: Server = createServer(() => {
	/* never responds: no provider request in this run may complete */
});
await new Promise<void>(ready => held.listen(0, "127.0.0.1", () => ready()));
held.unref();
const address = held.address();
const port = address !== null && typeof address === "object" ? address.port : 0;
check(port > 0, "fixture listener bound");
// A provider whose listener never answers: no model call can complete in this smoke.
writeFileSync(join(profileDir, "models.yml"), `providers:
  cedia-memory-fixture:
    baseUrl: http://127.0.0.1:${port}/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-memory-fixture-model
        name: Cedia memory smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`, { mode: 0o600 });

const started = await startHostServer({
	stateDir,
	port: 0,
	ompExecutable: executable,
	ompEnv: {
		PATH: `${dirname(executable)}${delimiter}/usr/bin${delimiter}/bin`,
		HOME: profileDir,
		PI_CODING_AGENT_DIR: profileDir,
		PI_NO_PTY: "1",
		PI_NOTIFICATIONS: "off",
	},
});

try {
	const project = started.host.store.createProject({ path: workDir, name: "Memory smoke" });
	const session = started.host.createSession(project.id, "Memory smoke");
	const owner = started.auth.ownerToken;

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/memory`, token: owner });
	const beforeBody = record(before.body, "memory body before start");
	check(before.status === 200 && beforeBody.state === "unavailable" && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);
	const live = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/memory`, token: owner });
	const liveBody = record(live.body, "live memory body");
	check(live.status === 200 && liveBody.state === "available" && liveBody.backend === "off", "the memory route answers OMP's effective backend");
	check(!Object.hasOwn(liveBody, "mnemopi") && !Object.hasOwn(liveBody, "hindsight"), "an absent backend state stays absent in JSON");

	const incarnation = started.host.store.getSession(session.id)!.incarnation;
	const apply = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/memory/apply`,
		token: owner,
		body: { commandId: "memory-smoke-apply", incarnation },
	});
	const applyBody = record(apply.body, "memory apply body");
	check(apply.status === 200 && applyBody.state === "available" && applyBody.backend === "off" && applyBody.applied === true, "memory.apply answers the applied state beside the same backend");

	const replay = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/memory/apply`,
		token: owner,
		body: { commandId: "memory-smoke-apply", incarnation },
	});
	check(JSON.stringify(replay.body) === JSON.stringify(apply.body), "a repeated memory command id replays the same receipt");

	const notOwner = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/memory` });
	check(notOwner.status === 401 || notOwner.status === 403, `the memory routes are owner-only (${notOwner.status})`);
} finally {
	await started.close();
	await new Promise<void>(close => held.close(() => close()));
	rmSync(stateDir, { recursive: true, force: true });
	rmSync(profileDir, { recursive: true, force: true });
	rmSync(workDir, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, version }, null, 2));
