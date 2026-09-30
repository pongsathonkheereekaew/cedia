import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeviceAuth } from "../src/auth.ts";
import {
	MAX_PYTHON_CODE_CHARS,
	NO_OMP_PYTHON_RUNTIME_REASON,
	OmpPythonValidationError,
	parseOmpPythonResult,
	type OmpPythonExecRequest,
} from "../src/omp-python.ts";
import { createRouter } from "../src/router.ts";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const result = {
	exitCode: 0,
	output: "3\n",
	outputTruncated: false,
	cancelled: false,
	displayOutputs: 2,
};

const session = {
	id: "python-session",
	projectId: "project-1",
	title: "Python task",
	cwd: "/tmp/python-project",
	sessionFile: "/tmp/python-session.jsonl",
	incarnation: "inc-python-1",
	status: "idle" as const,
	archived: false,
	createdAt: "2026-09-24T00:00:00.000Z",
	updatedAt: "2026-09-24T00:00:00.000Z",
};

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "cedia-python-route-"));
	const auth = new DeviceAuth(directory);
	const calls: (OmpPythonExecRequest | { commandId: string; incarnation: string })[] = [];
	const outcome = { state: "available" as const, revision: 4, exitCode: 0, output: "3\n", outputTruncated: false, cancelled: false, displayOutputs: 0 };
	const host = {
		store: { getSession: (id: string) => id === session.id ? session : undefined },
		pythonExec: async (_id: string, _deviceId: string, request: OmpPythonExecRequest) => { if (calls.length === 0) calls.push(request); return outcome; },
		pythonAbort: async () => ({ state: "available" as const, revision: 5, aborted: true }),
	} as unknown as CediaHost;
	return { directory, auth, router: createRouter(host, auth), calls, outcome, session };
}

describe("OMP Python execution projection", () => {
	it("strictly parses kernel results and command receipts", () => {
		expect(parseOmpPythonResult(result)).toEqual(result);
		expect(parseOmpPythonResult({ ...result, exitCode: null, displayOutputs: 0 })).toMatchObject({
			exitCode: null,
			displayOutputs: 0,
		});
		expect(() => parseOmpPythonResult({ ...result, extra: true })).toThrow(OmpPythonValidationError);
		expect(() => parseOmpPythonResult({ ...result, output: 7 })).toThrow(/output/);
		expect(() => parseOmpPythonResult({ ...result, output: "x".repeat(257 * 1024) })).toThrow(/exceeds/);
		expect(() => parseOmpPythonResult({ ...result, displayOutputs: -1 })).toThrow(/displayOutputs/);
	});
});

describe("authenticated OMP Python routes", () => {
	it("answers exec and abort, and replays a command id without re-running", async () => {
		const f = fixture();
		try {
			const body = { commandId: "python-1", incarnation: f.session.incarnation, code: "print(1 + 2)" };
			expect(await f.router({ method: "POST", path: `/v1/sessions/${f.session.id}/python/exec`, token: f.auth.ownerToken, body })).toEqual({ status: 200, body: f.outcome });
			expect(await f.router({ method: "POST", path: `/v1/sessions/${f.session.id}/python/exec`, token: f.auth.ownerToken, body })).toEqual({ status: 200, body: f.outcome });
			expect(f.calls).toEqual([body]);
			const abort = { commandId: "python-abort-1", incarnation: f.session.incarnation };
			expect(await f.router({ method: "POST", path: `/v1/sessions/${f.session.id}/python/abort`, token: f.auth.ownerToken, body: abort })).toEqual({ status: 200, body: { state: "available", revision: 5, aborted: true } });
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});

	it("refuses malformed envelopes before any runtime call", async () => {
		const f = fixture();
		try {
			for (const invalid of [
				{ commandId: "missing-code", incarnation: f.session.incarnation },
				{ commandId: "blank-code", incarnation: f.session.incarnation, code: "  " },
				{ commandId: "huge-code", incarnation: f.session.incarnation, code: "x".repeat(MAX_PYTHON_CODE_CHARS + 1) },
				{ commandId: "extra", incarnation: f.session.incarnation, code: "print(1)", extra: true },
				{ incarnation: f.session.incarnation, code: "print(1)" },
				{ commandId: "missing-incarnation", code: "print(1)" },
			]) {
				const response = await f.router({ method: "POST", path: `/v1/sessions/${f.session.id}/python/exec`, token: f.auth.ownerToken, body: invalid });
				expect(response).toMatchObject({ status: 400, body: { error: { code: "invalid_body" } } });
			}
			expect(f.calls).toEqual([]);
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});

	it("checks owner before wrong-method refusal", async () => {
		const f = fixture();
		const controller = f.auth.issue("python-controller");
		try {
			expect(await f.router({ method: "POST", path: `/v1/sessions/${f.session.id}/python/exec`, token: controller.token, body: {} })).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
			expect(await f.router({ method: "GET", path: `/v1/sessions/${f.session.id}/python/exec`, token: f.auth.ownerToken })).toMatchObject({ status: 405, body: { error: { code: "method_not_allowed" } } });
			expect(await f.router({ method: "GET", path: `/v1/sessions/${f.session.id}/python/abort`, token: f.auth.ownerToken })).toMatchObject({ status: 405, body: { error: { code: "method_not_allowed" } } });
		} finally {
			rmSync(f.directory, { recursive: true, force: true });
		}
	});
});

describe("real CediaHost Python route", () => {
	it("runs code through the fixture kernel and aborts nothing running", async () => {
		const directory = mkdtempSync(join(tmpdir(), "cedia-python-host-"));
		const projectPath = join(directory, "project");
		mkdirSync(projectPath, { recursive: true });
		const store = DurableStore.open({ stateDir: directory, recover: false });
		const project = store.createProject({ path: projectPath, name: "Python fixture" });
		const fixturePath = fileURLToPath(new URL("./fixtures/fake-host-launcher", import.meta.url));
		const fixtureNode = process.env.CEDIA_FIXTURE_NODE ?? process.execPath;
		const commandLog = join(directory, "commands.log");
		const host = new CediaHost({ store, stateDir: directory, ompExecutable: fixturePath, ompEnv: { CEDIA_NODE: fixtureNode, CEDIA_FAKE_COMMAND_LOG: commandLog } });
		const auth = new DeviceAuth(directory);
		const router = createRouter(host, auth);
		const live = host.createSession(project.id, "Python fixture");
		try {
			await host.startSession(live.id);
			const incarnation = store.getSession(live.id)!.incarnation;
			const ran = await router({ method: "POST", path: `/v1/sessions/${live.id}/python/exec`, token: auth.ownerToken, body: { commandId: "python-host-run", incarnation, code: "print(1 + 2)" } });
			expect(ran).toMatchObject({ status: 200, body: { state: "available", exitCode: 0, cancelled: false } });
			expect(String((ran.body as { output: string }).output)).toContain("print(1 + 2)");
			const replay = await router({ method: "POST", path: `/v1/sessions/${live.id}/python/exec`, token: auth.ownerToken, body: { commandId: "python-host-run", incarnation, code: "print(1 + 2)" } });
			expect(replay.body).toEqual(ran.body);
			const aborted = await router({ method: "POST", path: `/v1/sessions/${live.id}/python/abort`, token: auth.ownerToken, body: { commandId: "python-host-abort", incarnation } });
			expect(aborted).toMatchObject({ status: 200, body: { state: "available", aborted: true } });
			const execCalls = readFileSync(commandLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { type?: string; operation?: string }).filter(command => command.type === "cedia_control" && command.operation === "python.exec");
			expect(execCalls).toHaveLength(1);
		} finally {
			await host.close().catch(() => {});
			store.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
