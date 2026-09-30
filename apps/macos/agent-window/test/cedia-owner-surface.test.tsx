import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { createCediaNativeApi } from "../src/cedia-adapter.ts";
import {
  CediaOwnerPanel,
  type CediaOwnerAnswer,
} from "../vendor/synara/apps/web/src/components/chat/CediaOwnerSurface";
import {
  parseCediaOwnerAnswer,
  serverOwnersQueryOptions,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";

const ATTACHED = {
  taskId: "task-live",
  title: "Live task",
  archived: false,
  state: "attached" as const,
  identity: {
    mode: "controller" as const,
    sessionId: "task-live",
    incarnation: "inc-live",
    pid: 42,
    ownerStartedAt: "2026-09-28T00:00:00.000Z",
  },
};

const ANSWER: CediaOwnerAnswer = {
  owners: [
    ATTACHED,
    { taskId: "task-absent", title: "Stopped task", archived: false, state: "absent" },
    { taskId: "task-stale", title: "Stale task", archived: false, state: "stale", reason: "owner process is gone" },
    { taskId: "task-conflict", title: "Conflict task", archived: true, state: "conflict", reason: "owner identity differs" },
    { taskId: "task-tui", title: "TUI task", archived: false, state: "attached", identity: { ...ATTACHED.identity, sessionId: "task-tui", mode: "inspect_only" } },
  ],
  truncated: false,
};

describe("Cedia owner listing", () => {
  it("strictly parses owner states and keeps the bounded identity projection", () => {
    expect(parseCediaOwnerAnswer(ANSWER)).toEqual(ANSWER);
    expect(() => parseCediaOwnerAnswer({ ...ANSWER, owners: [{ ...ATTACHED, identity: { ...ATTACHED.identity, cwd: "/secret" } }] })).toThrow(/owner/);
    expect(() => parseCediaOwnerAnswer({ ...ANSWER, owners: [{ ...ATTACHED, state: "running" }] })).toThrow(/owner/);
    expect(() => parseCediaOwnerAnswer({ ...ANSWER, extra: true })).toThrow(/owner/);
  });

  it("refreshes the owner probe before posting attach", async () => {
    const calls: Array<{ method?: string; path?: string }> = [];
    const bridge = {
      invoke: async (_channel: string, input: { method?: string; path?: string }) => {
        calls.push(input);
        if (input.method === "GET" && input.path === "/v1/owners") return ANSWER;
        if (input.method === "POST" && input.path === "/v1/sessions/task-live/start") {
          return {
            id: "task-live",
            projectId: "project",
            title: "Live task",
            cwd: "/workspace",
            sessionFile: "/state/task-live.json",
            incarnation: "inc-live",
            status: "running",
            archived: false,
            createdAt: "2026-09-28T00:00:00.000Z",
            updatedAt: "2026-09-28T00:00:00.000Z",
          };
        }
        throw new Error(`Unexpected ${input.method} ${input.path}`);
      },
    };
    const api = createCediaNativeApi({ bridge });

    await api.cedia.attachOwner("task-live");

    expect(calls).toEqual([
      { kind: "request", method: "GET", path: "/v1/owners" },
      { kind: "request", method: "POST", path: "/v1/sessions/task-live/start" },
    ]);
  });

  it("renders selected attached rows with an attach action and names unsafe states", () => {
    const html = renderToStaticMarkup(
      <CediaOwnerPanel
        state={ANSWER}
        selectedTaskId="task-live"
        onSelectTask={() => undefined}
        onAttach={() => undefined}
      />,
    );
    expect(html).toContain('data-testid="cedia-owner-surface"');
    expect(html).toContain("Live task");
    expect(html).toContain("Attach");
    expect(html).toContain("No live owner");
    expect(html).toContain("Stale owner record");
    expect(html).toContain("Owner conflict");
    expect(html).toContain("inspection only");
    expect(html).toContain("archived");
    expect(html).toContain('aria-pressed="true"');
  });

  it("does not offer attach for an absent or stale selection", () => {
    const absent = renderToStaticMarkup(
      <CediaOwnerPanel state={ANSWER} selectedTaskId="task-absent" onSelectTask={() => undefined} onAttach={() => undefined} />,
    );
    const stale = renderToStaticMarkup(
      <CediaOwnerPanel state={ANSWER} selectedTaskId="task-stale" onSelectTask={() => undefined} onAttach={() => undefined} />,
    );
    const inspectOnly = renderToStaticMarkup(
      <CediaOwnerPanel state={ANSWER} selectedTaskId="task-tui" onSelectTask={() => undefined} onAttach={() => undefined} />,
    );
    expect(absent).not.toContain(">Attach<");
    expect(stale).not.toContain(">Attach<");
    expect(inspectOnly).not.toContain(">Attach<");
  });

  it("uses live re-reads when the owner list query is configured", () => {
    const options = serverOwnersQueryOptions();
    expect(options.queryKey).toEqual(["server", "owners"]);
    expect(options.refetchOnWindowFocus).toBe(true);
    expect(options.refetchInterval).toBe(false);
  });
});
