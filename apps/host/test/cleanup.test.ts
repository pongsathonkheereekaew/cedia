import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CediaHost } from "../src/service.ts";
import { DurableStore } from "../src/store.ts";

const fixtures: Array<{ host: CediaHost; store: DurableStore; directory: string }> = [];

function git(cwd: string, args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function fixture(cleanupEnabled = false, guards: ConstructorParameters<typeof CediaHost>[0]["cleanupGuards"] = {
	userTerminals: () => ({ state: "clear" }),
	ide: () => ({ state: "clear" }),
}, operations?: ConstructorParameters<typeof CediaHost>[0]["cleanupOperations"]): { host: CediaHost; store: DurableStore; directory: string; sessionId: string; worktree: string; projectPath: string } {
	const directory = mkdtempSync(join(tmpdir(), "cedia-cleanup-"));
	const projectPath = join(directory, "project");
	mkdirSync(projectPath, { recursive: true });
	git(projectPath, ["init", "-q", "-b", "main"]);
	git(projectPath, ["config", "user.email", "cedia@example.test"]);
	git(projectPath, ["config", "user.name", "Cedia test"]);
	writeFileSync(join(projectPath, "README.md"), "cleanup fixture\n");
	git(projectPath, ["add", "README.md"]);
	git(projectPath, ["commit", "-qm", "fixture"]);
	const store = DurableStore.open({ stateDir: directory, recover: false });
	const project = store.createProject({ path: projectPath, name: "Cleanup fixture" });
	const host = new CediaHost({
		store,
		stateDir: directory,
		cleanupEnabled,
		cleanupGuards: guards,
		...(operations === undefined ? {} : { cleanupOperations: operations }),
	});
	const session = host.createSession(project.id, "Cleanup task", "worktree");
	fixtures.push({ host, store, directory });
	return { host, store, directory, sessionId: session.id, worktree: session.cwd, projectPath };
}

afterEach(async () => {
	for (const fixture of fixtures.splice(0)) {
		await fixture.host.close().catch(() => {});
		fixture.store.close();
		rmSync(fixture.directory, { recursive: true, force: true });
	}
});

describe("cleanup protocol", () => {
	it("persists workspace cleanup metadata and reports the disabled capability without removing a worktree", async () => {
		const { host, store, sessionId, worktree } = fixture();
		const archived = host.archiveSession(sessionId);
		const metadata = store.getSession(sessionId)?.workspaceMetadata;
		expect(metadata).toMatchObject({
			taskId: sessionId,
			projectId: archived.projectId,
			actualCwd: worktree,
			worktreeRoot: worktree,
			cleanupGeneration: 0,
			cleanupState: "retained",
		});

		const result = await host.cleanupSession(sessionId);
		expect(result).toMatchObject({ state: "retained", capability: { enabled: false } });
		expect(result.reason).toMatch(/disabled|inactive/i);
		expect(store.getSession(sessionId)?.workspaceMetadata?.cleanupState).toBe("retained");
		expect(git(worktree, ["rev-parse", "--show-toplevel"])).toBe(realpathSync(worktree));
	});

	it("creates a generation ref and removes only the clean worktree when explicitly enabled", async () => {
		const { host, store, sessionId, worktree, projectPath } = fixture(true);
		host.archiveSession(sessionId);
		const result = await host.cleanupSession(sessionId);
		expect(result).toMatchObject({ removed: true, state: "removed", generation: 1, capability: { enabled: true } });
		expect(result.gates.at(-1)).toMatchObject({ id: "recheck", state: "passed" });
		expect(existsSync(worktree)).toBe(false);
		expect(git(projectPath, ["show-ref", "--verify", `refs/cedia/archive/${sessionId}/1`])).toContain(sessionId);
		expect(git(projectPath, ["show-ref", "--verify", `refs/heads/cedia/task-${sessionId}`])).toContain(sessionId);
		const repeated = await host.cleanupSession(sessionId);
		expect(repeated).toMatchObject({ removed: true, state: "removed", generation: 1 });
		const restored = host.restoreSession(sessionId);
		expect(restored).toMatchObject({ archived: false, archive: { state: "restored" }, workspaceMetadata: { cleanupState: "retained" } });
		expect(existsSync(worktree)).toBe(true);
	});

	it("retains tracked, untracked and ignored worktree data", async () => {
		for (const kind of ["tracked", "untracked", "ignored"] as const) {
			const { host, worktree } = fixture(true);
			if (kind === "tracked") writeFileSync(join(worktree, "README.md"), "changed\n");
			if (kind === "untracked") writeFileSync(join(worktree, "untracked.txt"), "keep\n");
			if (kind === "ignored") {
				writeFileSync(join(worktree, ".gitignore"), "ignored.txt\n");
				writeFileSync(join(worktree, "ignored.txt"), "keep\n");
			}
			const session = host.archiveSession(host.store.listSessions(undefined, { includeArchived: true })[0]!.id);
			const result = await host.cleanupSession(session.id);
			expect(result).toMatchObject({ removed: false, state: "retained" });
			expect(result.gates.find(gate => gate.id === "working_tree")?.state).toBe("blocked");
		}
	});

	it("vetoes an active terminal and retains when IDE state is unavailable", async () => {
		const terminal = fixture(true, { userTerminals: () => ({ state: "blocked", reason: "user terminal is attached" }), ide: () => ({ state: "clear" }) });
		const terminalSession = terminal.host.archiveSession(terminal.sessionId);
		const terminalResult = await terminal.host.cleanupSession(terminalSession.id);
		expect(terminalResult.gates.find(gate => gate.id === "terminals")).toMatchObject({ state: "blocked", reason: "user terminal is attached" });

		const unavailable = fixture(true, { userTerminals: () => ({ state: "clear" }) });
		const unavailableSession = unavailable.host.archiveSession(unavailable.sessionId);
		const unavailableResult = await unavailable.host.cleanupSession(unavailableSession.id);
		expect(unavailableResult.gates.find(gate => gate.id === "ide")?.state).toBe("unavailable");
	});

	it("requires a proven integration ancestry", async () => {
		const notProven = fixture(true);
		const archived = notProven.host.archiveSession(notProven.sessionId);
		const unrelated = git(notProven.projectPath, ["write-tree"]);
		const commit = git(notProven.projectPath, ["commit-tree", unrelated, "-m", "unrelated"]);
		git(notProven.projectPath, ["update-ref", "refs/heads/main", commit]);
		notProven.store.updateSessionWorkspaceMetadata(archived.id, { integrationTargetCommit: commit, integrationObservedCommit: commit });
		const noProof = await notProven.host.cleanupSession(archived.id);
		const noProofState = noProof.gates.find(gate => gate.id === "integration")?.state;
		expect(noProofState === "blocked" || noProofState === "uncertain").toBe(true);
		expect(noProof.reason).toMatch(/ancestor|integrated|squash/i);
	});

	it("refuses a changed primary branch", async () => {
		const primaryMoved = fixture(true);
		const primaryArchived = primaryMoved.host.archiveSession(primaryMoved.sessionId);
		const primaryCommit = git(primaryMoved.projectPath, ["commit-tree", git(primaryMoved.projectPath, ["write-tree"]), "-m", "moved-primary"]);
		git(primaryMoved.projectPath, ["update-ref", "refs/heads/main", primaryCommit]);
		const primaryResult = await primaryMoved.host.cleanupSession(primaryArchived.id);
		expect(primaryResult.reason).toMatch(/target changed/i);
	});

	it("refuses a changed task branch", async () => {
		const taskMoved = fixture(true);
		const taskArchived = taskMoved.host.archiveSession(taskMoved.sessionId);
		const taskCommit = git(taskMoved.projectPath, ["commit-tree", git(taskMoved.projectPath, ["write-tree"]), "-m", "moved-task"]);
		git(taskMoved.projectPath, ["update-ref", `refs/heads/cedia/task-${taskArchived.id}`, taskCommit]);
		const taskResult = await taskMoved.host.cleanupSession(taskArchived.id);
		expect(taskResult.reason).toMatch(/task branch moved/i);
	});

	it("retains when immutable ref creation fails", async () => {
		const refFailure = fixture(true, undefined, { createArchiveRef: () => { throw new Error("ref unavailable"); } });
		const refArchived = refFailure.host.archiveSession(refFailure.sessionId);
		const refResult = await refFailure.host.cleanupSession(refArchived.id);
		expect(refResult.reason).toMatch(/archive ref/i);
		expect(refFailure.store.getSession(refArchived.id)?.workspaceMetadata?.cleanupState).toBe("retained");
	});

	it("retains when receipt persistence fails", async () => {
		const receiptFailure = fixture(true, undefined, { persistReceipt: () => { throw new Error("receipt unavailable"); } });
		const receiptArchived = receiptFailure.host.archiveSession(receiptFailure.sessionId);
		const receiptResult = await receiptFailure.host.cleanupSession(receiptArchived.id);
		expect(receiptResult.reason).toMatch(/durably recorded/i);
		expect(receiptFailure.store.getSession(receiptArchived.id)?.workspaceMetadata?.cleanupState).toBe("retained");
	});

	it("retains when non-force removal fails", async () => {
		const removalFailure = fixture(true, undefined, { removeWorktree: () => { throw new Error("remove unavailable"); } });
		const removalArchived = removalFailure.host.archiveSession(removalFailure.sessionId);
		const removalResult = await removalFailure.host.cleanupSession(removalArchived.id);
		expect(removalResult.reason).toMatch(/removal/i);
		expect(existsSync(removalFailure.worktree)).toBe(true);
	});

	it("keeps prepared evidence when completion persistence fails after removal", async () => {
		const completionFailure = fixture(true, undefined, { persistCompletion: () => { throw new Error("completion unavailable"); } });
		const completionArchived = completionFailure.host.archiveSession(completionFailure.sessionId);
		const completionResult = await completionFailure.host.cleanupSession(completionArchived.id);
		expect(completionResult).toMatchObject({ removed: true, state: "prepared" });
		expect(completionFailure.store.getSession(completionArchived.id)?.workspaceMetadata?.cleanupState).toBe("prepared");
	});

	it("aborts when a target mutation is detected during the immediate recheck", async () => {
		let projectPath = "";
		const race = fixture(true, undefined, {
			persistReceipt: (directory, receipt) => {
				writeFileSync(join(directory, "archive-receipt.json"), JSON.stringify({ version: 1, ...receipt }), { mode: 0o600 });
				const commit = git(projectPath, ["commit-tree", git(projectPath, ["write-tree"]), "-m", "race"]);
				git(projectPath, ["update-ref", "refs/heads/main", commit]);
			},
		});
		projectPath = race.projectPath;
		const archived = race.host.archiveSession(race.sessionId);
		const result = await race.host.cleanupSession(archived.id);
		expect(result.reason).toMatch(/race|changed/i);
		expect(result.removed).toBe(false);
		expect(existsSync(race.worktree)).toBe(true);
	});
});
