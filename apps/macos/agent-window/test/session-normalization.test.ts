import { expect, test } from "bun:test";
import { normalizeThreadSession } from "../vendor/synara/apps/web/src/storeNormalization";
import { ThreadId } from "../vendor/synara/packages/contracts/src/index";

test("OMP session remains OMP in the renderer store so sends use its availability", () => {
  const session = normalizeThreadSession({
    threadId: ThreadId.makeUnsafe("task"), providerName: "omp", status: "ready",
    runtimeMode: "approval-required", activeTurnId: null, lastError: null,
    updatedAt: "2026-09-19T10:00:00.000Z",
  }, null);
  expect(session?.provider).toBe("omp");
  expect(session?.status).toBe("ready");
});

test("the held model change survives normalization instead of being dropped by the store", () => {
  const base = {
    threadId: ThreadId.makeUnsafe("task"), providerName: "omp", status: "running" as const,
    runtimeMode: "approval-required" as const, activeTurnId: null, lastError: null,
    updatedAt: "2026-09-24T10:00:00.000Z",
  };
  const pending = {
    revision: 3,
    state: "awaiting" as const,
    requested: { provider: "anthropic", modelId: "claude-sonnet-5" },
    acceptedAt: "2026-09-24T10:00:00.000Z",
  };
  const session = normalizeThreadSession({ ...base, pendingModel: pending }, null);
  expect(session?.pendingModel).toMatchObject({ revision: 3, state: "awaiting" });

  // A change to the record alone repaints the row rather than returning the previous session.
  const unchanged = normalizeThreadSession({ ...base, pendingModel: pending }, session);
  expect(unchanged).toBe(session);
  const applied = normalizeThreadSession(
    { ...base, pendingModel: { ...pending, state: "in-effect" as const, applied: { model: "anthropic/claude-sonnet-5", at: "2026-09-24T10:00:05.000Z", via: "turn-boundary" as const } } },
    session,
  );
  expect(applied).not.toBe(session);
  expect(applied?.pendingModel?.state).toBe("in-effect");

  // A session that no longer holds one drops the record it used to carry.
  expect(normalizeThreadSession(base, session)?.pendingModel).toBeNull();
});

test("the archive receipt survives normalization so a restored row can say where it resumed", () => {
  const base = {
    threadId: ThreadId.makeUnsafe("task"), providerName: "omp", status: "stopped" as const,
    runtimeMode: "approval-required" as const, activeTurnId: null, lastError: null,
    updatedAt: "2026-09-24T10:00:00.000Z",
  };
  const receipt = {
    state: "retained" as const,
    branch: "cedia/task-1",
    commit: "0123456789abcdef0123456789abcdef01234567",
    worktree: "/tmp/task-1",
    dirty: true,
    ignored: false,
    recordedAt: "2026-09-24T10:00:00.000Z",
    reason: "Cleanup is inactive, so the worktree and its branch were kept.",
  };
  const archived = normalizeThreadSession({ ...base, archive: receipt }, null);
  expect(archived?.archive).toMatchObject({ state: "retained", dirty: true });
  expect(normalizeThreadSession({ ...base, archive: receipt }, archived)).toBe(archived);

  // Continue rewrites the receipt, and that alone repaints the row.
  const restored = normalizeThreadSession(
    { ...base, archive: { ...receipt, state: "restored" as const, restored: { at: "2026-09-24T10:05:00.000Z", worktree: "/tmp/task-1", branch: "cedia/task-1", reattached: true, reason: "The task branch still pointed at the archived commit." } } },
    archived,
  );
  expect(restored).not.toBe(archived);
  expect(restored?.archive?.state).toBe("restored");

  // A session that no longer carries one drops the record it used to carry.
  expect(normalizeThreadSession(base, restored)?.archive).toBeNull();
});

test("the turn projection survives normalization so a surface can say what OMP is holding", () => {
  const base = {
    threadId: ThreadId.makeUnsafe("task"), providerName: "omp", status: "running" as const,
    runtimeMode: "approval-required" as const, activeTurnId: null, lastError: null,
    updatedAt: "2026-09-24T10:00:00.000Z",
  };
  const turns = [
    { turnIntentId: "intent-1", state: "running" as const, model: "anthropic/claude-sonnet-5" },
    { turnIntentId: "intent-2", state: "queued" as const, queuePosition: 1 },
  ];
  const running = normalizeThreadSession({ ...base, turns }, null);
  expect(running?.turns).toHaveLength(2);
  expect(normalizeThreadSession({ ...base, turns }, running)).toBe(running);

  // A queued turn becoming the running one repaints the row.
  const advanced = normalizeThreadSession(
    { ...base, turns: [{ ...turns[0]!, turnIntentId: "intent-2", state: "running" as const }, { ...turns[0]!, state: "completed" as const }] },
    running,
  );
  expect(advanced).not.toBe(running);
  expect(advanced?.turns?.[0]?.turnIntentId).toBe("intent-2");

  // A session that stops reporting turns drops the projection it used to carry.
  expect(normalizeThreadSession(base, advanced)?.turns).toEqual([]);
});
