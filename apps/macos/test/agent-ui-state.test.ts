import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentWindowHandler } from "../src/agent-window-main.ts";
import { readIdeHandoff } from "../src/agent-ui-state.ts";
import { HostHttpError } from "../src/api.ts";

it("hands the exact workspace session to IDE and rejects mismatched workspaces", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "cedia-ui-handoff-"));
  const opened: unknown[] = [];
  let draftRecord: { revision: number; content: unknown } | undefined;
  const handler = createAgentWindowHandler({ stateDir, authorize: event => event === "trusted",
    ensure: async () => {},
    request: async (method, path, body) => {
      if (path === "drafts/task-1") {
        if (method === "GET") {
          if (!draftRecord) throw new HostHttpError(404, path, "No draft yet");
          return draftRecord;
        }
        const patch = body as { expectedRevision: number; content: unknown };
        if (!draftRecord) {
          if (patch.expectedRevision !== 0) throw new HostHttpError(409, path, "Draft changed elsewhere");
          draftRecord = { revision: 1, content: patch.content };
        } else {
          if (patch.expectedRevision !== draftRecord.revision) throw new HostHttpError(409, path, "Draft changed elsewhere");
          draftRecord = { revision: draftRecord.revision + 1, content: patch.content };
        }
        return draftRecord;
      }
      return { id: "task-1", cwd: "/tmp/project" };
    },
    pickFolder: async () => null, openIde: async target => { opened.push(target); }, openExternal: async () => {} });
  try {
    await handler("trusted", { kind: "openIde", cwd: "/tmp/project", sessionId: "task-1" });
    expect((await readIdeHandoff(stateDir, "/tmp/project"))?.sessionId).toBe("task-1");
    await expect(handler("trusted", { kind: "openIde", cwd: "/tmp/other", sessionId: "task-1" })).rejects.toThrow("workspace");
    expect(opened).toHaveLength(1);
    await expect(handler("untrusted", { kind: "uiDraft", threadId: "task-1", action: "read" })).rejects.toThrow("Untrusted");
    const draft = { prompt: "unfinished work", modelSelection: { model: "fixture" } };
    // One host-owned draft with a revision, not a renderer-local file.
    expect(await handler("trusted", { kind: "uiDraft", threadId: "task-1", action: "write", draft, expectedRevision: 0 })).toEqual({ status: "accepted", revision: 1 });
    expect(await handler("trusted", { kind: "uiDraft", threadId: "task-1", action: "read" })).toEqual({ revision: 1, payload: draft });
    await expect(handler("trusted", { kind: "uiDraft", threadId: "task-1", action: "write", draft })).rejects.toThrow("Invalid draft revision");
    await expect(handler("trusted", { kind: "uiDraft", threadId: "../../escape", action: "read" })).rejects.toThrow("Invalid");
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});

it("hands off an unsent draft without creating or starting an OMP session", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "cedia-ui-draft-"));
  const calls: string[] = [];
  const handler = createAgentWindowHandler({ stateDir, authorize: () => true, ensure: async () => {},
    request: async (method, path) => {
      calls.push(`${method} ${path}`);
      if (path === "projects") return [{ id: "project", path: "/tmp/project" }];
      throw new HostHttpError(404, path, "No session yet");
    }, pickFolder: async () => null, openIde: async () => {}, openExternal: async () => {} });
  try {
    await handler(null, { kind: "uiDraft", action: "write", threadId: "draft-1", expectedRevision: 0, draft: { draftThread: { projectId: "project" }, draft: { prompt: "not sent" } } });
    await handler(null, { kind: "openIde", cwd: "/tmp/project", sessionId: "draft-1" });
    expect((await readIdeHandoff(stateDir, "/tmp/project"))?.sessionId).toBe("draft-1");
    // An unsent draft now lives in the host's draft store, so writing one reaches the
    // host - but only as a draft record: no session and no command is created, and the
    // workspace handoff still resolves the draft before its session exists.
    expect(calls).toEqual(["PATCH drafts/draft-1", "GET sessions/draft-1", "GET projects"]);
  } finally { await rm(stateDir, { recursive: true, force: true }); }
});
