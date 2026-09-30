/**
 * Live proof of Cedia's guarded advisor-config writer against the pinned runtime.
 *
 * The runtime validates raw `WATCHDOG.yml` text strictly before touching disk, writes exactly
 * what was validated, then re-discovers the merged roster and applies it without a restart.
 * This smoke proves Cedia's host routes carry both halves: the owner-only GET reads one scope
 * as raw text, and the owner-only durable POST writes it through the registered
 * `advisor.config.set` operation. No advisor turn runs and no provider is configured, so no
 * model endpoint is needed at all.
 *
 * Run: bun scripts/omp-advisor-config-smoke.ts
 */
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { OMP_BASELINE_VERSION, isSupportedOmpVersion } from "../packages/omp-adapter/src/index.ts";
import { startHostServer } from "../apps/host/src/server.ts";

function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(`OMP advisor config smoke failed: ${message}`);
	console.log(`OK   ${message}`);
}

function record(value: unknown, message = "Expected an object"): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`OMP advisor config smoke failed: ${message}`);
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

const modelsYaml = `providers:
  cedia-advisor-config-fixture:
    baseUrl: http://127.0.0.1:9/v1
    auth: none
    api: openai-completions
    models:
      - id: cedia-advisor-config-fixture-model
        name: Cedia advisor config smoke fixture
        api: openai-completions
        reasoning: false
        input: [text]
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        contextWindow: 128000
        maxTokens: 4096
`;

const VALID = "# smoke config\nadvisors:\n  - name: smoke-reviewer\n";
const hostStateDir = await mkdtemp(join(tmpdir(), "cedia-advisor-config-host-state-"));
const hostProfileDir = await mkdtemp(join(tmpdir(), "cedia-advisor-config-host-profile-"));
const hostWorkDir = await mkdtemp(join(tmpdir(), "cedia-advisor-config-host-work-"));
await writeFile(join(hostProfileDir, "models.yml"), modelsYaml, { mode: 0o600 });
const started = await startHostServer({
	stateDir: hostStateDir,
	port: 0,
	ompExecutable: executable,
	virtualUi: true,
	ompEnv: { HOME: hostProfileDir, PI_CODING_AGENT_DIR: hostProfileDir, PI_NO_PTY: "1", PI_NOTIFICATIONS: "off" },
});
try {
	const owner = started.auth.ownerToken;
	const project = started.host.store.createProject({ path: hostWorkDir, name: "Advisor config smoke" });
	const session = started.host.createSession(project.id, "Advisor config smoke");
	const projectFile = join(hostWorkDir, "WATCHDOG.yml");

	const before = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/advisor/config?scope=project`, token: owner });
	const beforeBody = record(before.body, "config body before start");
	check(before.status === 200 && beforeBody.state === "unavailable" && typeof beforeBody.reason === "string", "a session with no runtime reports absence with a reason");

	await started.host.startSession(session.id);
	const incarnation = started.host.store.getSession(session.id)!.incarnation;

	const read = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/advisor/config?scope=project`, token: owner });
	const readBody = record(read.body, "live config body");
	check(read.status === 200 && readBody.state === "available" && readBody.exists === false && readBody.text === "", "a fresh project scope reads as absent");
	check(typeof readBody.path === "string" && (readBody.path as string).length > 0, "the read names the file it looked for");

	const malformed = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/advisor/config`,
		token: owner,
		body: { commandId: "advisor-config-smoke-malformed", incarnation, scope: "project", text: "advisors: [unclosed" },
	});
	const malformedBody = record(malformed.body, "malformed body");
	check(malformed.status === 200 && malformedBody.state === "unavailable" && String(malformedBody.reason).includes("not YAML"), "text that is not YAML is refused with the reason");
	check(!(await exists(projectFile)), "a refused write leaves no file behind");

	const invalid = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/advisor/config`,
		token: owner,
		body: { commandId: "advisor-config-smoke-invalid", incarnation, scope: "project", text: "advisors: nope\n" },
	});
	const invalidBody = record(invalid.body, "invalid body");
	check(invalid.status === 200 && invalidBody.state === "unavailable" && String(invalidBody.reason).includes("invalid"), "schema-violating YAML is refused with the reason");
	check(!(await exists(projectFile)), "a schema refusal leaves no file behind");

	const written = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/advisor/config`,
		token: owner,
		body: { commandId: "advisor-config-smoke-write", incarnation, scope: "project", text: VALID },
	});
	check(written.status === 200, `an owner write is accepted (${written.status})`);
	const writtenBody = record(written.body, "config write body");
	// Nothing is runnable here: the fixture models carry no advisor role, so OMP stores the
	// roster with zero active advisors — the same answer the terminal save path gives before
	// `/advisor on`. The roster reaching the live subsystem is proven below instead.
	check(writtenBody.state === "available" && writtenBody.exists === true && writtenBody.advisors === 0, "the write answer carries the stored roster with zero active advisors");

	const reread = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/advisor/config?scope=project`, token: owner });
	check(record(reread.body, "config reread body").text === VALID, "a second read shows exactly the validated text");

	const enable = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/advisor`,
		token: owner,
		body: { commandId: "advisor-config-smoke-enable", incarnation, op: "set", enabled: true },
	});
	check(enable.status === 200, `the advisor switch turns on (${enable.status})`);
	const roster = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/advisor`, token: owner });
	const advisors = (record(record(roster.body, "advisor body").advisor, "advisor snapshot").advisors as { name: string; status: string }[]);
	const probe = advisors.find(entry => entry.name === "smoke-reviewer");
	check(probe !== undefined, "the applied roster names the configured advisor on the live session");
	check(typeof probe?.status === "string" && (probe?.status as string).length > 0, `the live roster reports why it cannot run (${probe?.status})`);
	const disable = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/advisor`,
		token: owner,
		body: { commandId: "advisor-config-smoke-disable", incarnation, op: "set", enabled: false },
	});
	check(disable.status === 200, `the advisor switch turns back off (${disable.status})`);

	const replayed = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/advisor/config`,
		token: owner,
		body: { commandId: "advisor-config-smoke-write", incarnation, scope: "project", text: VALID },
	});
	check(JSON.stringify(replayed.body) === JSON.stringify(written.body), "a repeated write command id replays the same receipt");

	const removed = await started.router({
		method: "POST",
		path: `/v1/sessions/${session.id}/advisor/config`,
		token: owner,
		body: { commandId: "advisor-config-smoke-remove", incarnation, scope: "project", text: "  \n" },
	});
	const removedBody = record(removed.body, "config remove body");
	check(removed.status === 200 && removedBody.exists === false, "an empty write removes the file");
	check(!(await exists(projectFile)), "the file is really gone");

	for (const [label, body] of [
		["missing scope", { commandId: "advisor-config-smoke-bad-1", incarnation, text: VALID }],
		["unknown scope", { commandId: "advisor-config-smoke-bad-2", incarnation, scope: "global", text: VALID }],
		["non-string text", { commandId: "advisor-config-smoke-bad-3", incarnation, scope: "project", text: 7 }],
	] as const) {
		const refused = await started.router({ method: "POST", path: `/v1/sessions/${session.id}/advisor/config`, token: owner, body });
		check(refused.status === 400, `${label} is refused before any runtime call (${refused.status})`);
	}
	const badScope = await started.router({ method: "GET", path: `/v1/sessions/${session.id}/advisor/config?scope=global`, token: owner });
	check(badScope.status === 400, `an unknown read scope is refused (${badScope.status})`);
} finally {
	await started.close();
}

await Promise.all([
	rm(hostStateDir, { recursive: true, force: true }),
	rm(hostProfileDir, { recursive: true, force: true }),
	rm(hostWorkDir, { recursive: true, force: true }),
]);
