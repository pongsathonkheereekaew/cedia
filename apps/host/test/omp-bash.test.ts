import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
	MAX_BASH_COMMAND_CHARS,
	NO_OMP_BASH_RUNTIME_REASON,
	OmpBashValidationError,
	parseOmpBashResult,
	type OmpBashExecRequest,
} from "../src/omp-bash.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const result = {
	output: "fixture output",
	exitCode: 0,
	cancelled: false,
	truncated: false,
	totalLines: 3,
	totalBytes: 14,
	outputLines: 3,
	outputBytes: 14,
};

const session = {
	id: "bash-session",
	projectId: "project-1",
	title: "Shell task",
	cwd: "/tmp/bash-project",
	sessionFile: "/tmp/bash-session.jsonl",
	incarnation: "inc-bash-1",
	status: "idle" as const,
	archived: false,
	createdAt: "2026-09-24T00:00:00.000Z",
	updatedAt: "2026-09-24T00:00:00.000Z",
};

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "cedia-bash-route-"));
	const auth = new DeviceAuth(directory);
	const calls: (OmpBashExecRequest | { commandId: string; incarnation: string })[] = [];
	const outcome = { state: "available" as const, revision: 4, exitCode: 0, output: "ok\n", outputTruncated: false, cancelled: false, timedOut: false, images: 0 };
	const host = {
		store: { getSession: (id: string) => id === session.id ? session : undefined },
		bashExec: async (_id: string, _deviceId: string, request: OmpBashExecRequest) => { if (calls.length === 0) calls.push(request); return outcome; },
		bashAbort: async () => ({ state: "available" as const, revision: 5, aborted: true }),
	} as unknown as CediaHost;
	return { directory, auth, router: createRouter(host, auth), calls, outcome, session };
}

describe("OMP session bash projection", () => {
	it("strictly parses shell results and command receipts", () => {
		expect(parseOmpBashResult(result)).toEqual({
			exitCode: 0,
			output: "fixture output",
			outputTruncated: false,
			cancelled: false,
			timedOut: false,
			images: 0,
		});
		expect(parseOmpBashResult({ ...result, exitCode: null, timedOut: true, workingDir: "/task", images: [{ type: "image" }] })).toMatchObject({
			exitCode: null,
			timedOut: true,
			workingDir: "/task",
			images: 1,
		});
		expect(() => parseOmpBashResult({ ...result, extra: true })).toThrow(OmpBashValidationError);
		expect(() => parseOmpBashResult({ ...result, output: 7 })).toThrow(/output/);
		expect(() => parseOmpBashResult({ ...result, output: "x".repeat(257 * 1024) })).toThrow(/exceeds/);
	});
});

describe("authenticated OMP shell routes", () => {
	it("answers exec and abort, and replays a command id without re-running", async () => {
		const f = fixture();
		try {
			const body = { commandId: "bash-1", incarnation: f.session.incarnation, command: "printf ok" };
			expect(await f.router({ method: "POST", path: `/v1/sessions/${f.session.id}/bash/exec`, token: f.auth.ownerToken, body })).toEqual({ status: 200, body: f.outcome });
			expect(await f.router({ method: "POST", path: `/v1/sessions/${f.session.id}/bash/exec`, token: f.auth.ownerToken, body })).toEqual({ status: 200, body: f.outcome });
			expect(f.calls).toEqual([body]);
			const abort = { commandId: "bash-abort-1", incarnation: f.session.incarnation };
			expect(await f.router({ method: "POST", path: `/v1/sessions/${f.session.id}/bash/abort`, token: f.auth.ownerToken, body: abort })).toEqual({ status: 200, body: { state: "available", revision: 5, aborted: true } });
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});

	it("refuses malformed envelopes before any runtime call", async () => {
		const f = fixture();
		try {
			for (const invalid of [
				{ commandId: "missing-command", incarnation: f.session.incarnation },
				{ commandId: "blank-command", incarnation: f.session.incarnation, command: "  " },
				{ commandId: "huge-command", incarnation: f.session.incarnation, command: "x".repeat(MAX_BASH_COMMAND_CHARS + 1) },
				{ commandId: "extra", incarnation: f.session.incarnation, command: "printf x", extra: true },
				{ incarnation: f.session.incarnation, command: "printf x" },
				{ commandId: "missing-incarnation", command: "printf x" },
			]) {
				const response = await f.router({ method: "POST", path: `/v1/sessions/${f.session.id}/bash/exec`, token: f.auth.ownerToken, body: invalid });
				expect(response).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
			}
			expect(f.calls).toEqual([]);
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});

	it("checks owner before wrong-method refusal", async () => {
		const f = fixture();
		const controller = f.auth.issue("bash-controller");
		try {
			expect(await f.router({ method: "POST", path: `/v1/sessions/${f.session.id}/bash/exec`, token: controller.token, body: {} })).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
			expect(await f.router({ method: "GET", path: `/v1/sessions/${f.session.id}/bash/exec`, token: f.auth.ownerToken })).toMatchObject({ status: 405, body: { error: { code: "method_not_allowed" } } });
			expect(await f.router({ method: "GET", path: `/v1/sessions/${f.session.id}/bash/abort`, token: f.auth.ownerToken })).toMatchObject({ status: 405, body: { error: { code: "method_not_allowed" } } });
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});
});

describe("real CediaHost shell route", () => {
	it("runs a command through the fixture shell and aborts nothing running", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-bash-host-"));
		const projectPath = join(directory, "project");
		mkdirSync(projectPath, { recursive: true });
		const store = DurableStore.open({ stateDir: directory, recover: false });
		const project = store.createProject({ path: projectPath, name: "Shell fixture" });
		const fixturePath = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
		const fixtureNode = process.env.CEDIA_FIXTURE_NODE ?? process.execPath;
		const commandLog = join(directory, "commands.log");
		const host = new CediaHost({ store, stateDir: directory, ompExecutable: fixturePath, ompEnv: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_COMMAND_LOG: commandLog } });
		const auth = new DeviceAuth(directory);
		const router = createRouter(host, auth);
		const live = host.createSession(project.id, "Shell fixture");
		try {
			await host.startSession(live.id);
			const incarnation = store.getSession(live.id)!.incarnation;
			const ran = await router({ method: "POST", path: `/v1/sessions/${live.id}/bash/exec`, token: auth.ownerToken, body: { commandId: "bash-host-run", incarnation, command: "printf hello" } });
			expect(ran).toMatchObject({ status: 200, body: { state: "available", exitCode: 0, cancelled: false } });
			expect(String((ran.body as { output: string }).output)).toContain("printf hello");
			const replay = await router({ method: "POST", path: `/v1/sessions/${live.id}/bash/exec`, token: auth.ownerToken, body: { commandId: "bash-host-run", incarnation, command: "printf hello" } });
			expect(replay.body).toEqual(ran.body);
			const aborted = await router({ method: "POST", path: `/v1/sessions/${live.id}/bash/abort`, token: auth.ownerToken, body: { commandId: "bash-host-abort", incarnation } });
			expect(aborted).toMatchObject({ status: 200, body: { state: "available", aborted: true } });
			const bashCalls = readFileSync(commandLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { type?: string }).filter(command => command.type === "bash");
			expect(bashCalls).toHaveLength(1);
		} finally {
			await host.close().catch(() => {});
			store.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
