import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHostServer } from "../src/server.ts";

/** A real repository with one commit, created through git itself. */
function gitFixtureRepo(parent: string, name: string): { path: string; head: string } {
  const repository = join(parent, name);
  mkdirSync(repository, { recursive: true });
  for (const args of [
    ["init", "--quiet"],
    ["config", "user.email", "cedia-fixture@example.invalid"],
    ["config", "user.name", "Cedia fixture"],
  ]) execFileSync("git", ["-C", repository, ...args]);
  writeFileSync(join(repository, "README.md"), "fixture\n");
  execFileSync("git", ["-C", repository, "add", "."]);
  execFileSync("git", ["-C", repository, "commit", "--quiet", "-m", "fixture"]);
  return { path: repository, head: execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() };
}

test("loopback HTTP authenticates all reads, rejects browser origins and revokes controller access", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-"));
  const server = await startHostServer({ stateDir });
  try {
    const url = `${server.descriptor.url}/v1/health`;
    const headers = { Authorization: `Bearer ${server.descriptor.token}` };
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers })).status).toBe(200);
    const health = await (await fetch(url, { headers })).json() as { identity: { generation: string; processStartedAt: string; stateDir: string; protocolVersion: number } };
    const capabilities = await (await fetch(`${server.descriptor.url}/v1/capabilities`, { headers })).json() as { capabilities: Array<{ id: string; availability: string; reason?: string }> };
    // This host was started without a packaged web client, so the selected remote path exists but
    // has nothing to serve: that is "needs setup", not "not implemented", and it must not read as
    // a working remote control either (§3.B).
    const remote = capabilities.capabilities.find(item => item.id === "remote.tailscale");
    expect(remote?.availability).toBe("dependency_unavailable");
    expect(remote?.reason).toContain("no remote web client");
    // The settings surface is on screen and its bridge exists; without a runtime there is nothing
    // to read, which the row has to say instead of claiming the integration is missing.
    const settingsRow = capabilities.capabilities.find(item => item.id === "omp.settings");
    expect(settingsRow?.availability).toBe("dependency_unavailable");
    expect(settingsRow?.reason).toContain("No OMP runtime is running");
    // The Cedia UI gates its sidebar on these ids (§3.B); the row must not exist as a
    // working control while nothing backs it.
    expect(capabilities.capabilities.find(item => item.id === "app.automations")?.availability).toBe("integration_missing");
    expect(capabilities.capabilities.find(item => item.id === "omp.execution")?.availability).toBe("available");
    const adopted = await fetch(`${server.descriptor.url}/v1/lifecycle/adopt`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ ...health.identity, stateDir, protocolVersion: 1, appGeneration: "restart-generation" }) });
    expect(adopted.status).toBe(200);
    const adoptedHealth = await (await fetch(url, { headers })).json() as { identity: { generation: string; processStartedAt: string; stateDir: string; protocolVersion: number; appGeneration: string } };
    expect(adoptedHealth.identity.appGeneration).toBe("restart-generation");
    const invalidAdoption = await fetch(`${server.descriptor.url}/v1/lifecycle/adopt`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ ...adoptedHealth.identity, generation: "stale", stateDir, protocolVersion: 1, appGeneration: "other-generation" }) });
    expect(invalidAdoption.status).toBe(409);
    const controller = server.auth.issue("non-owner");
    const settingsUrl = `${server.descriptor.url}/v1/settings`;
    const deniedQuit = await fetch(`${server.descriptor.url}/v1/lifecycle/quit`, { method: "POST", headers: { Authorization: `Bearer ${controller.token}`, "Content-Type": "application/json" }, body: "{}" });
    expect(deniedQuit.status).toBe(403);
    expect(server.lifecycle.snapshot().phase).toBe("ready");
    const deniedSettingsRead = await fetch(settingsUrl, { headers: { Authorization: `Bearer ${controller.token}` } });
    expect(deniedSettingsRead.status).toBe(403);
    const settings = await (await fetch(settingsUrl, { headers })).json() as { revision: number; values: Record<string, unknown> };
    const changed = await fetch(settingsUrl, { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: settings.revision, category: "appearance", patch: { appTheme: "dark" } }) });
    expect(changed.status).toBe(200);
    const stale = await fetch(settingsUrl, { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: settings.revision, category: "appearance", patch: { appTheme: "light" } }) });
    expect(stale.status).toBe(409);
    const unsupported = await fetch(settingsUrl, { method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: 1, category: "appearance", patch: { provider: "other-harness" } }) });
    expect(unsupported.status).toBe(400);
    expect((await fetch(url, { headers: { ...headers, Origin: "https://malicious.example" } })).status).toBe(403);
    const issued = server.auth.issue("Fixture phone");
    const phone = { Authorization: `Bearer ${issued.token}` };
    expect((await fetch(url, { headers: phone })).status).toBe(200);
    server.auth.revoke(issued.device.id);
    expect((await fetch(url, { headers: phone })).status).toBe(401);
    expect((await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers, body: "{" })).status).toBe(400);
  } finally { await server.close(); rmSync(stateDir, { recursive: true, force: true }); }
});

test("owner-only draft routes provide revisioned create, conflict, submit, and clear", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-drafts-"));
  const server = await startHostServer({ stateDir });
  const owner = { Authorization: `Bearer ${server.descriptor.token}`, "Content-Type": "application/json" };
  const controller = server.auth.issue("draft controller");
  const remote = { Authorization: `Bearer ${controller.token}`, "Content-Type": "application/json" };
  const draftUrl = `${server.descriptor.url}/v1/drafts/task-1`;
  try {
    const denied = [
      fetch(draftUrl, { headers: remote }),
      fetch(draftUrl, { method: "PATCH", headers: remote, body: JSON.stringify({ expectedRevision: 0, text: "remote" }) }),
      fetch(`${draftUrl}/submissions`, { method: "POST", headers: remote, body: JSON.stringify({ expectedRevision: 1, commandId: "remote", payloadHash: "hash" }) }),
      fetch(`${draftUrl}/clear`, { method: "POST", headers: remote, body: JSON.stringify({ expectedRevision: 1 }) }),
      fetch(`${server.descriptor.url}/v1/drafts/import`, { method: "POST", headers: remote, body: JSON.stringify({ entries: [] }) }),
    ];
    expect((await Promise.all(denied)).map(response => response.status)).toEqual([403, 403, 403, 403, 403]);

    const created = await fetch(draftUrl, { method: "PATCH", headers: owner, body: JSON.stringify({ expectedRevision: 0, text: "hello", attachments: [{ id: "a", kind: "text" }] }) });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ draftId: "task-1", revision: 1, text: "hello" });
    const patched = await fetch(draftUrl, { method: "PATCH", headers: owner, body: JSON.stringify({ expectedRevision: 1, text: "hello again" }) });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ revision: 2, text: "hello again" });
    const stale = await fetch(draftUrl, { method: "PATCH", headers: owner, body: JSON.stringify({ expectedRevision: 1, text: "stale" }) });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("draft_conflict");
    const submitted = await fetch(`${draftUrl}/submissions`, { method: "POST", headers: owner, body: JSON.stringify({ expectedRevision: 2, commandId: "cmd-1", payloadHash: "hash-a" }) });
    expect(submitted.status).toBe(200);
    expect(await submitted.json()).toMatchObject({ accepted: true, created: true, draft: { revision: 2 } });
    const cleared = await fetch(`${draftUrl}/clear`, { method: "POST", headers: owner, body: JSON.stringify({ expectedRevision: 2 }) });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ cleared: true });
  } finally { await server.close(); rmSync(stateDir, { recursive: true, force: true }); }
});

test("owner quit is acknowledged before mutations are fenced and leaves a stopped lifecycle", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-lifecycle-"));
  const server = await startHostServer({ stateDir });
  const headers = { Authorization: `Bearer ${server.descriptor.token}`, "Content-Type": "application/json" };
  try {
    const quit = await fetch(`${server.descriptor.url}/v1/lifecycle/quit`, { method: "POST", headers, body: "{}" });
    expect(quit.status).toBe(200);
    expect(await quit.json()).toMatchObject({ accepted: true, alreadyRequested: false, phase: "quitting", runningSessions: 0 });

    const mutation = await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers, body: "{}" });
    expect(mutation.status).toBe(409);
    expect(await mutation.json()).toMatchObject({ error: { code: "host_quitting" } });

    const lifecycle = await fetch(`${server.descriptor.url}/v1/lifecycle`, { headers });
    expect(lifecycle.status).toBe(200);
    expect(await lifecycle.json()).toMatchObject({ phase: "quitting", accepting: false, runningSessions: 0, remotePaired: false });
    const health = await fetch(`${server.descriptor.url}/v1/health`, { headers });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ lifecycle: { phase: "quitting" } });

    const repeated = await fetch(`${server.descriptor.url}/v1/lifecycle/quit`, { method: "POST", headers, body: "{}" });
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ accepted: true, alreadyRequested: true, phase: "quitting" });
  } finally {
    await server.close();
    expect(JSON.parse(readFileSync(join(stateDir, "lifecycle.json"), "utf8"))).toMatchObject({ phase: "stopped" });
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("fencing admission keeps the host alive, and Cancel reopens it", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-fence-"));
  const server = await startHostServer({ stateDir });
  const headers = { Authorization: `Bearer ${server.descriptor.token}`, "Content-Type": "application/json" };
  try {
    // The owner asks for a quit and the host only fences admission first, so the pre-quit
    // decision happens with new work already refused (plan §2.7 "Deliberate Quit").
    const fenced = await fetch(`${server.descriptor.url}/v1/lifecycle/fence`, { method: "POST", headers, body: "{}" });
    expect(fenced.status).toBe(200);
    expect(await fenced.json()).toMatchObject({ accepted: true, changed: true, phase: "quitting", runningSessions: 0 });

    const mutation = await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers, body: "{}" });
    expect(mutation.status).toBe(409);
    expect(await mutation.json()).toMatchObject({ error: { code: "host_quitting" } });

    // Fencing is not a quit: the listener and its descriptor survive it.
    expect(server.lifecycle.snapshot().phase).toBe("quitting");
    const lifecycle = await fetch(`${server.descriptor.url}/v1/lifecycle`, { headers });
    expect(lifecycle.status).toBe(200);
    expect(await lifecycle.json()).toMatchObject({ phase: "quitting", accepting: false });

    const repeated = await fetch(`${server.descriptor.url}/v1/lifecycle/fence`, { method: "POST", headers, body: "{}" });
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ accepted: true, changed: false, phase: "quitting" });

    const resumed = await fetch(`${server.descriptor.url}/v1/lifecycle/resume`, { method: "POST", headers, body: "{}" });
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ accepted: true, changed: true, phase: "ready" });

    // Cancel reopened admission for real: the same mutation the fence refused now works.
    mkdirSync(join(stateDir, "project"), { recursive: true });
    const admitted = await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers, body: JSON.stringify({ path: join(stateDir, "project"), name: "Admitted" }) });
    expect(admitted.status).toBe(200);
    expect((await admitted.json() as { path: string; name: string }).name).toBe("Admitted");

    const reopenAgain = await fetch(`${server.descriptor.url}/v1/lifecycle/resume`, { method: "POST", headers, body: "{}" });
    expect(reopenAgain.status).toBe(200);
    expect(await reopenAgain.json()).toMatchObject({ accepted: true, changed: false, phase: "ready" });

    // Fence and reopen are owner-only, like the shutdown request itself.
    const controller = { Authorization: `Bearer ${server.auth.issue("non-owner").token}`, "Content-Type": "application/json" };
    expect((await fetch(`${server.descriptor.url}/v1/lifecycle/fence`, { method: "POST", headers: controller, body: "{}" })).status).toBe(403);
    expect((await fetch(`${server.descriptor.url}/v1/lifecycle/resume`, { method: "POST", headers: controller, body: "{}" })).status).toBe(403);
    expect(server.lifecycle.snapshot().phase).toBe("ready");
  } finally { await server.close(); rmSync(stateDir, { recursive: true, force: true }); }
});

test("a fenced host still stops when the owner confirms the quit", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-fence-stop-"));
  const server = await startHostServer({ stateDir });
  const headers = { Authorization: `Bearer ${server.descriptor.token}`, "Content-Type": "application/json" };
  try {
    expect((await fetch(`${server.descriptor.url}/v1/lifecycle/fence`, { method: "POST", headers, body: "{}" })).status).toBe(200);
    const quit = await fetch(`${server.descriptor.url}/v1/lifecycle/quit`, { method: "POST", headers, body: "{}" });
    expect(quit.status).toBe(200);
    // `alreadyRequested` stays honest: the fence, not this call, entered `quitting`.
    expect(await quit.json()).toMatchObject({ accepted: true, alreadyRequested: true, phase: "quitting" });
  } finally {
    await server.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("a new worktree task carries only the uncommitted files the caller selected", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-dirtycopy-"));
  const repository = gitFixtureRepo(stateDir, "copy-project");
  writeFileSync(join(repository.path, "README.md"), "selected change\n");
  writeFileSync(join(repository.path, "unselected.txt"), "unselected change\n");
  const server = await startHostServer({ stateDir });
  const headers = { Authorization: `Bearer ${server.descriptor.token}`, "Content-Type": "application/json" };
  try {
    const project = await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers, body: JSON.stringify({ path: repository.path, name: "Copy project" }) });
    expect(project.status).toBe(200);
    const projectId = (await project.json() as { id: string }).id;

    const created = await fetch(`${server.descriptor.url}/v1/sessions`, {
      method: "POST", headers,
      body: JSON.stringify({ projectId, title: "Selected copy", workspaceMode: "worktree", dirtyFiles: ["README.md"] }),
    });
    expect(created.status).toBe(200);
    const session = await created.json() as { id: string; cwd: string; workspace?: { mode: string; dirtyCopy?: { mode: string; entries: unknown[] } } };
    expect(session.workspace?.mode).toBe("worktree");
    expect(session.workspace?.dirtyCopy).toEqual({ mode: "selected", entries: [{ path: "README.md", state: "applied" }] });
    expect(readFileSync(join(session.cwd, "README.md"), "utf8")).toBe("selected change\n");
    expect(existsSync(join(session.cwd, "unselected.txt"))).toBe(false);
    // The source folder keeps both of its uncommitted files.
    expect(readFileSync(join(repository.path, "unselected.txt"), "utf8")).toBe("unselected change\n");

    // The record is durable, not just the creation answer.
    const reread = await fetch(`${server.descriptor.url}/v1/sessions/${session.id}`, { headers });
    expect(reread.status).toBe(200);
    expect((await reread.json() as { workspace?: { dirtyCopy?: unknown } }).workspace?.dirtyCopy).toEqual({ mode: "selected", entries: [{ path: "README.md", state: "applied" }] });

    // A selection is only meaningful where there is a worktree to carry it into.
    const local = await fetch(`${server.descriptor.url}/v1/sessions`, {
      method: "POST", headers,
      body: JSON.stringify({ projectId, title: "Local copy", workspaceMode: "local", dirtyFiles: ["README.md"] }),
    });
    expect(local.status).toBe(409);
    expect(await local.json()).toMatchObject({ error: { code: "worktree_required" } });

    const malformed = await fetch(`${server.descriptor.url}/v1/sessions`, {
      method: "POST", headers,
      body: JSON.stringify({ projectId, title: "Bad copy", workspaceMode: "worktree", dirtyFiles: [1] }),
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "invalid_body" } });
  } finally { await server.close(); rmSync(stateDir, { recursive: true, force: true }); }
});

test("DELETE removes a task, its transcript directory, and 404s the id afterwards", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-delete-"));
  const projectPath = join(stateDir, "project");
  mkdirSync(projectPath, { recursive: true });
  const server = await startHostServer({ stateDir });
  const headers = { Authorization: `Bearer ${server.descriptor.token}`, "Content-Type": "application/json" };
  try {
    const project = await (await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers, body: JSON.stringify({ path: projectPath }) })).json() as { id: string };
    const session = await (await fetch(`${server.descriptor.url}/v1/sessions`, { method: "POST", headers, body: JSON.stringify({ projectId: project.id, title: "Delete me" }) })).json() as { id: string };
    const transcript = join(stateDir, "sessions", session.id);
    expect(existsSync(transcript)).toBe(true);
    const deleted = await fetch(`${server.descriptor.url}/v1/sessions/${session.id}`, { method: "DELETE", headers });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ deleted: true });
    expect(existsSync(transcript)).toBe(false);
    expect((await fetch(`${server.descriptor.url}/v1/sessions/${session.id}`, { headers })).status).toBe(404);
    expect((await fetch(`${server.descriptor.url}/v1/sessions/${session.id}`, { method: "DELETE", headers })).status).toBe(404);
  } finally { await server.close(); rmSync(stateDir, { recursive: true, force: true }); }
});

test("refuses every browser Origin, before credentials and without writing anything", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-origin-"));
  const projectPath = join(stateDir, "project");
  mkdirSync(projectPath, { recursive: true });
  const server = await startHostServer({ stateDir });
  const url = `${server.descriptor.url}/v1/health`;
  const token = `Bearer ${server.descriptor.token}`;
  try {
    // Web origins are refused before authentication, so a malicious page cannot even
    // probe whether the owner's token is live.
    const unauthenticated = await fetch(url, { headers: { Origin: "https://malicious.example" } });
    expect(unauthenticated.status).toBe(403);
    expect(await unauthenticated.json()).toMatchObject({ error: { code: "origin_forbidden" } });
    // The listener's own loopback origin is refused too: native clients send no Origin,
    // so a browser is never the intended caller, not even the owner's browser.
    const own = await fetch(url, { headers: { Authorization: token, Origin: `http://127.0.0.1:${new URL(url).port}` } });
    expect(own.status).toBe(403);
    const write = await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers: { Authorization: token, Origin: "null", "Content-Type": "application/json" }, body: JSON.stringify({ path: projectPath }) });
    expect(write.status).toBe(403);
    expect(await (await fetch(`${server.descriptor.url}/v1/projects`, { headers: { Authorization: token } })).json()).toEqual([]);
    // The same write without an Origin is accepted, so the refusal is about the origin.
    expect((await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers: { Authorization: token, "Content-Type": "application/json" }, body: JSON.stringify({ path: projectPath }) })).status).toBe(200);
  } finally { await server.close(); rmSync(stateDir, { recursive: true, force: true }); }
});

test("answers only to the loopback names of its own listener", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-host-"));
  const server = await startHostServer({ stateDir });
  const headers = { Authorization: `Bearer ${server.descriptor.token}` };
  try {
    const url = `${server.descriptor.url}/v1/health`;
    // A page on a rebound DNS name reaches 127.0.0.1 but cannot claim the listener's
    // own name, and a mismatched port is the same refusal.
    for (const host of ["relay.attacker.example", "127.0.0.1:1"]) {
      const rebound = await fetch(url, { headers: { ...headers, Host: host } });
      expect(rebound.status).toBe(403);
      expect(await rebound.json()).toMatchObject({ error: { code: "host_forbidden" } });
    }
    expect((await fetch(url, { headers })).status).toBe(200);
    expect((await fetch(`http://localhost:${new URL(url).port}/v1/health`, { headers })).status).toBe(200);
  } finally { await server.close(); rmSync(stateDir, { recursive: true, force: true }); }
});

test("caps a request body at 16 MiB while it streams, before parsing it", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-body-"));
  const server = await startHostServer({ stateDir });
  const headers = { Authorization: `Bearer ${server.descriptor.token}`, "Content-Type": "application/json" };
  const post = (body: string) => fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers, body });
  try {
    // A body exactly at the cap is read and then rejected as JSON: the cap is a size
    // limit, not a blanket refusal of large requests.
    const atCap = await post("x".repeat(16 * 1024 * 1024));
    expect(atCap.status).toBe(400);
    expect(await atCap.json()).toMatchObject({ error: { code: "invalid_request" } });
    // One byte more is refused as too large, not as malformed: the limit is applied as
    // the body streams in, so the host never buffers or parses the oversized payload.
    const overCap = await post("x".repeat(16 * 1024 * 1024 + 1));
    expect(overCap.status).toBe(413);
    expect(await overCap.json()).toMatchObject({ error: { code: "too_large" } });
    // The listener survived both and still serves the next request.
    expect((await fetch(`${server.descriptor.url}/v1/health`, { headers })).status).toBe(200);
  } finally { await server.close(); rmSync(stateDir, { recursive: true, force: true }); }
});

test("a second task in one Git folder needs its own worktree, and every task records the commit it started from", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-workspace-"));
  const { path: projectPath, head } = gitFixtureRepo(stateDir, "repo");
  const server = await startHostServer({ stateDir });
  const headers = { Authorization: `Bearer ${server.descriptor.token}`, "Content-Type": "application/json" };
  const create = (body: Record<string, unknown>) => fetch(`${server.descriptor.url}/v1/sessions`, { method: "POST", headers, body: JSON.stringify(body) });
  try {
    const project = await (await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers, body: JSON.stringify({ path: projectPath }) })).json() as { id: string };

    const first = await create({ projectId: project.id, title: "First" });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ workspace: { mode: "local", isGit: true, sourceCommit: head } });

    // §3.C: one file-mutating task per folder. The refusal names the worktree instead of
    // letting two tasks share the folder.
    const second = await create({ projectId: project.id, title: "Second" });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: "worktree_required" } });

    const isolated = await create({ projectId: project.id, title: "Second", workspaceMode: "worktree" });
    expect(isolated.status).toBe(200);
    const isolatedRow = await isolated.json() as { id: string; workspace?: { mode: string; sourceCommit?: string } };
    expect(isolatedRow.workspace).toMatchObject({ mode: "worktree", sourceCommit: head });
    // A read of the task agrees with what creation answered.
    const read = await (await fetch(`${server.descriptor.url}/v1/sessions/${isolatedRow.id}`, { headers })).json() as { workspace?: { mode: string; sourceCommit?: string } };
    expect(read.workspace).toMatchObject({ mode: "worktree", sourceCommit: head });

    // §3.C: a task may name the revision it starts from, and the host resolves that label to
    // a commit before creating the worktree - then records the commit it actually used.
    writeFileSync(join(projectPath, "second.txt"), "second\n");
    execFileSync("git", ["-C", projectPath, "add", "."]);
    execFileSync("git", ["-C", projectPath, "commit", "--quiet", "-m", "second"]);
    const newer = execFileSync("git", ["-C", projectPath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    execFileSync("git", ["-C", projectPath, "branch", "base-line", head]);
    const older = await create({ projectId: project.id, title: "Older", workspaceMode: "worktree", baseRef: "base-line" });
    expect(older.status).toBe(200);
    const olderRow = await older.json() as { cwd: string; workspace?: { mode: string; sourceCommit?: string; baseRef?: string } };
    expect(olderRow.workspace).toMatchObject({ mode: "worktree", sourceCommit: head, baseRef: "base-line" });
    expect(execFileSync("git", ["-C", olderRow.cwd, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(head);
    expect(newer).not.toBe(head);

    // A revision Git does not know is refused before anything is created, and a base revision
    // cannot be checked out inside the project folder itself.
    const unknownRef = await create({ projectId: project.id, title: "Unknown", workspaceMode: "worktree", baseRef: "no-such-ref" });
    expect(unknownRef.status).toBe(409);
    expect(await unknownRef.json()).toMatchObject({ error: { code: "unknown_base_ref" } });
    const localBaseRef = await create({ projectId: project.id, title: "Local", workspaceMode: "local", baseRef: "base-line" });
    expect(localBaseRef.status).toBe(409);
    expect(await localBaseRef.json()).toMatchObject({ error: { code: "worktree_required" } });
  } finally { await server.close(); rmSync(stateDir, { recursive: true, force: true }); }
});

test("archiving refuses a running task and otherwise keeps the worktree with an immutable restoration ref", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-archive-"));
  const { path: projectPath, head } = gitFixtureRepo(stateDir, "repo");
  const server = await startHostServer({ stateDir });
  const headers = { Authorization: `Bearer ${server.descriptor.token}`, "Content-Type": "application/json" };
  try {
    const project = await (await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers, body: JSON.stringify({ path: projectPath }) })).json() as { id: string };
    const created = await (await fetch(`${server.descriptor.url}/v1/sessions`, { method: "POST", headers, body: JSON.stringify({ projectId: project.id, title: "Isolated", workspaceMode: "worktree" }) })).json() as { id: string; cwd: string };
    const archive = (id: string) => fetch(`${server.descriptor.url}/v1/sessions/${id}`, { method: "PATCH", headers, body: JSON.stringify({ archived: true }) });

    // A running task is never archived behind the user's back.
    server.host.store.updateSession(created.id, { status: "running" });
    const refused = await archive(created.id);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "task_running" } });

    // A task that stopped with tracked changes says so instead of claiming a clean state.
    server.host.store.updateSession(created.id, { status: "idle" });
    writeFileSync(join(created.cwd, "uncommitted.txt"), "still here\n");
    const archived = await archive(created.id);
    expect(archived.status).toBe(200);
    const row = await archived.json() as { archived: boolean; archive?: { state: string; ref?: string; commit?: string; worktree?: string; dirty: boolean; ignored: boolean } };
    expect(row.archived).toBe(true);
    expect(row.archive).toMatchObject({ state: "retained", commit: head, worktree: created.cwd, dirty: true });

    // The ref is durable and points at the commit the task stopped on; nothing was removed.
    expect(row.archive?.ref).toMatch(/^refs\/cedia\/archive\//);
    expect(execFileSync("git", ["-C", projectPath, "rev-parse", "--verify", row.archive!.ref!], { encoding: "utf8" }).trim()).toBe(head);
    expect(existsSync(created.cwd)).toBe(true);
    expect(existsSync(join(created.cwd, "uncommitted.txt"))).toBe(true);
    expect(execFileSync("git", ["-C", projectPath, "branch", "--list", `cedia/task-${created.id}`], { encoding: "utf8" }).trim()).not.toBe("");

    // A task that works in the project folder keeps no ref in the user's repository.
    // A plain folder, not a repository: the task works in it directly instead of in a worktree.
    const plainFolder = join(stateDir, "other");
    mkdirSync(plainFolder, { recursive: true });
    const second = await (await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers, body: JSON.stringify({ path: plainFolder }) })).json() as { id: string };
    const localRow = await (await fetch(`${server.descriptor.url}/v1/sessions`, { method: "POST", headers, body: JSON.stringify({ projectId: second.id, title: "Local" }) })).json() as { id: string; cwd: string };
    const localResponse = await archive(localRow.id);
    expect(localResponse.status).toBe(200);
    const localArchived = await localResponse.json() as { archive?: { ref?: string; worktree?: string; reason: string } };
    expect(localArchived.archive?.ref).toBeUndefined();
    expect(localArchived.archive?.worktree).toBeUndefined();
    expect(localArchived.archive?.reason).toMatch(/project folder/);
  } finally { await server.close(); rmSync(stateDir, { recursive: true, force: true }); }
});

test("a live session cannot be relocated through the task route: placement stays host-owned", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-session-place-"));
  const server = await startHostServer({ stateDir });
  const headers = { Authorization: `Bearer ${server.descriptor.token}`, "Content-Type": "application/json" };
  try {
    const folder = join(stateDir, "project");
    mkdirSync(folder, { recursive: true });
    const project = await (await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers, body: JSON.stringify({ path: folder }) })).json() as { id: string };
    const created = await (await fetch(`${server.descriptor.url}/v1/sessions`, { method: "POST", headers, body: JSON.stringify({ projectId: project.id, title: "Placed" }) })).json() as { id: string };
    const before = server.host.store.getSession(created.id)!;
    // Placement fields are not task fields: a runtime-side moveSession-style relocation
    // through this route must fail before anything is written, or the host records it
    // owns (workspace identity, worktree dir, session file, incarnation) desync silently.
    for (const body of [{ cwd: join(stateDir, "elsewhere") }, { sessionFile: "other.jsonl" }, { incarnation: "deadbeef" }, { status: "stopped" }]) {
      const refused = await fetch(`${server.descriptor.url}/v1/sessions/${created.id}`, { method: "PATCH", headers, body: JSON.stringify(body) });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: { code: "invalid_body" } });
    }
    const after = server.host.store.getSession(created.id)!;
    expect(after.cwd).toBe(before.cwd);
    expect(after.sessionFile).toBe(before.sessionFile);
    expect(after.incarnation).toBe(before.incarnation);
    expect(after.status).toBe(before.status);
  } finally { await server.close(); rmSync(stateDir, { recursive: true, force: true }); }
});

test("restoring puts the workspace back at the archived revision without stealing a moved branch", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cedia-http-restore-"));
  const { path: projectPath, head } = gitFixtureRepo(stateDir, "repo");
  const server = await startHostServer({ stateDir });
  const headers = { Authorization: `Bearer ${server.descriptor.token}`, "Content-Type": "application/json" };
  try {
    const project = await (await fetch(`${server.descriptor.url}/v1/projects`, { method: "POST", headers, body: JSON.stringify({ path: projectPath }) })).json() as { id: string };
    const created = await (await fetch(`${server.descriptor.url}/v1/sessions`, { method: "POST", headers, body: JSON.stringify({ projectId: project.id, title: "Isolated", workspaceMode: "worktree" }) })).json() as { id: string; cwd: string };
    const patch = (body: Record<string, unknown>) => fetch(`${server.descriptor.url}/v1/sessions/${created.id}`, { method: "PATCH", headers, body: JSON.stringify(body) });
    const read = async () => await (await fetch(`${server.descriptor.url}/v1/sessions/${created.id}`, { headers })).json() as {
      archived: boolean; cwd: string; workspace?: { mode: string; branch?: string; sourceCommit?: string };
      archive?: { state: string; restored?: { worktree: string; branch: string; reattached: boolean; reason: string } };
    };

    expect((await patch({ archived: true })).status).toBe(200);
    // The user removed the worktree folder without telling git; the task still owns its branch.
    rmSync(created.cwd, { recursive: true, force: true });
    const restoredResponse = await patch({ archived: false });
    expect(restoredResponse.status).toBe(200);
    const restored = await restoredResponse.json() as { archived: boolean; cwd: string; archive?: { state: string; restored?: { branch: string; reattached: boolean } }; workspace?: { mode: string; branch?: string } };
    expect(restored.archived).toBe(false);
    expect(restored.archive).toMatchObject({ state: "restored", restored: { branch: `cedia/task-${created.id}`, reattached: true } });
    // The exact archived revision is back on disk, on the branch the task originally owned.
    expect(execFileSync("git", ["-C", restored.cwd, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(head);
    expect(execFileSync("git", ["-C", restored.cwd, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim()).toBe(`cedia/task-${created.id}`);
    // The folder identity still describes where the task began; the restore names the live branch.
    expect(restored.workspace).toMatchObject({ mode: "worktree", sourceCommit: head });

    // A branch that moved after the archive is left alone; the task continues on its own branch.
    expect((await patch({ archived: true })).status).toBe(200);
    rmSync(restored.cwd, { recursive: true, force: true });
    writeFileSync(join(projectPath, "later.txt"), "moved on\n");
    execFileSync("git", ["-C", projectPath, "add", "."]);
    execFileSync("git", ["-C", projectPath, "commit", "--quiet", "-m", "later"]);
    const later = execFileSync("git", ["-C", projectPath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    execFileSync("git", ["-C", projectPath, "worktree", "prune"]);
    execFileSync("git", ["-C", projectPath, "update-ref", `refs/heads/cedia/task-${created.id}`, later]);
    const second = await patch({ archived: false });
    expect(second.status).toBe(200);
    const moved = await second.json() as { cwd: string; archive?: { restored?: { branch: string; reattached: boolean; reason: string } } };
    expect(moved.archive?.restored).toMatchObject({ branch: `cedia/restore/${created.id}`, reattached: false });
    expect(moved.archive?.restored?.reason).toMatch(/no longer points/);
    expect(execFileSync("git", ["-C", moved.cwd, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(head);
    // The branch the user moved is still exactly where they put it.
    expect(execFileSync("git", ["-C", projectPath, "rev-parse", `refs/heads/cedia/task-${created.id}`], { encoding: "utf8" }).trim()).toBe(later);

    // A path something else now occupies is reported, not overwritten.
    expect((await patch({ archived: true })).status).toBe(200);
    rmSync(moved.cwd, { recursive: true, force: true });
    execFileSync("git", ["-C", projectPath, "worktree", "prune"]);
    mkdirSync(moved.cwd, { recursive: true });
    writeFileSync(join(moved.cwd, "someone-elses-file.txt"), "mine\n");
    const blocked = await patch({ archived: false });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: { code: "restore_unavailable" } });
    const stillArchived = await read();
    expect(stillArchived.archived).toBe(true);
    expect(readFileSync(join(moved.cwd, "someone-elses-file.txt"), "utf8")).toBe("mine\n");
  } finally { await server.close(); rmSync(stateDir, { recursive: true, force: true }); }
});
