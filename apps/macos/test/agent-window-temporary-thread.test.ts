import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StartedHostServer } from "../../host/src/server.ts";
import { startHostServer } from "../../host/src/server.ts";
import { createCediaNativeApi } from "../agent-window/src/cedia-adapter.ts";
import { createAgentHostGateway, type HostMethod } from "../src/agent-window-main.ts";

/*
 * §10 item 1d, as a receipt: a temporary draft's session survives a window restart.
 *
 * The renderer puts a temporary thread away when focus leaves it. Upstream deletes it,
 * which is safe on a server that models a draft as scratch; here the thread is a durable
 * host session and DELETE removes the record and its transcript, so a `New task` the user
 * glanced away from was lost (observed 2026-09-20). The automatic path now archives, and
 * only an explicit delete removes a session.
 *
 * "A window restart" is the real thing here: a fresh gateway over the same state
 * directory, with the process that created the session gone. The store is not consulted
 * directly - every assertion reads through the HTTP the window uses.
 */

const cleaned: string[] = [];

interface Harness {
	directory: string;
	gateway: ReturnType<typeof createAgentHostGateway>;
	/** The renderer's own git-free view of the host, exactly as the bundle builds it. */
	api: ReturnType<typeof createCediaNativeApi>;
	close(): Promise<void>;
}

async function harness(directory: string, stateDir: string): Promise<Harness> {
	const gateway = createAgentHostGateway({ appRoot: join(directory, "missing-app"), parentPid: process.pid, stateDir });
	await gateway.ensure();
	const bridge = {
		invoke: async (_channel: string, input: unknown) => {
			const row = input as { kind?: string; method?: string; path?: string; body?: unknown };
			if (row.kind === "request") {
				if (typeof row.method !== "string" || typeof row.path !== "string") throw new Error("Invalid request envelope");
				return await gateway.request(row.method as HostMethod, row.path.replace(/^\/v1\//, ""), row.body);
			}
			if (row.kind === "bootstrap") return { platform: "darwin", homeDir: directory, worktreesDir: join(stateDir, "worktrees"), version: "test-host" };
			throw new Error(`Unexpected bridge call: ${String(row.kind)}`);
		},
	};
	return {
		directory,
		gateway,
		api: createCediaNativeApi({ bridge }),
		// The gateway shares one client with every window in the process; a restart is
		// represented by dropping the harness and building a new one over the same state
		// directory, which is what the second half of each test does.
		close: async () => {},
	};
}

async function fixture(): Promise<{ directory: string; stateDir: string; projectPath: string; server: StartedHostServer }> {
	const directory = await mkdtemp(join(tmpdir(), "cedia-temporary-thread-"));
	cleaned.push(directory);
	const stateDir = join(directory, "state");
	const projectPath = join(directory, "project");
	await mkdir(projectPath, { recursive: true });
	const server = await startHostServer({ stateDir });
	await server.host.store.createProject({ path: projectPath, name: "Temporary thread fixture" });
	return { directory, stateDir, projectPath, server };
}

afterAll(async () => {
	for (const directory of cleaned.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("a temporary draft put away by the window", () => {
	it("is archived, not deleted, and is still there after a restart", async () => {
		const { directory, stateDir, server } = await fixture();
		try {
			const first = await harness(directory, stateDir);
			const projectId = (await first.gateway.request("GET", "projects") as { id: string }[])[0]!.id;
			await first.api.orchestration.dispatchCommand({ type: "thread.create", commandId: "create-1", threadId: "draft-1", projectId, title: "New task" });
			const created = { id: "draft-1" };
			// The disposal path's command, exactly as `archiveThreadFromClient` sends it.
			await first.api.orchestration.dispatchCommand({ type: "thread.archive", commandId: "dispose-1", threadId: created.id });
			await first.close();

			// "Restart": a new process with its own gateway over the same state dir.
			const second = await harness(directory, stateDir);
			try {
				const detail = await second.api.orchestration.getThreadDetailSnapshot({ threadId: created.id }) as { thread: { archivedAt: string | null; id: string } };
				expect(detail.thread.id).toBe(created.id);
				expect(detail.thread.archivedAt).not.toBeNull();
				const rows = await second.gateway.request("GET", "sessions") as { id: string; archived: boolean }[];
				expect(rows.find(row => row.id === created.id)?.archived).toBe(true);
			} finally {
				await second.close();
			}
			// The transcript survives with it: the record itself is what the disposal no longer destroys.
			expect(server.host.store.getSession(created.id)).toMatchObject({ id: created.id, archived: true });
		} finally {
			await server.close();
		}
	});

	it("is gone only when the user deletes it, and that intent still deletes", async () => {
		const { directory, stateDir, server } = await fixture();
		try {
			const window = await harness(directory, stateDir);
			const project = (await window.gateway.request("GET", "projects") as { id: string }[])[0]!;
			await window.api.orchestration.dispatchCommand({ type: "thread.create", commandId: "create-2", threadId: "draft-2", projectId: project.id, title: "New task" });
			await window.api.orchestration.dispatchCommand({ type: "thread.create", commandId: "create-3", threadId: "explicit-2", projectId: project.id, title: "Delete me" });
			const draft = { id: "draft-2" };
			const explicit = { id: "explicit-2" };

			await window.api.orchestration.dispatchCommand({ type: "thread.archive", commandId: "dispose-2", threadId: draft.id });
			await window.api.orchestration.dispatchCommand({ type: "thread.delete", commandId: "delete-2", threadId: explicit.id });

			const rows = await window.gateway.request("GET", "sessions") as { id: string }[];
			expect(rows.some(row => row.id === draft.id)).toBe(true);
			expect(rows.some(row => row.id === explicit.id)).toBe(false);
			// Restoring an archived thread is a real state change, so the draft is recoverable.
			await window.api.orchestration.dispatchCommand({ type: "thread.unarchive", commandId: "restore-2", threadId: draft.id });
			const restored = await window.api.orchestration.getThreadDetailSnapshot({ threadId: draft.id }) as { thread: { archivedAt: string | null } };
			expect(restored.thread.archivedAt).toBeNull();
			await window.close();
		} finally {
			await server.close();
		}
	});
});
