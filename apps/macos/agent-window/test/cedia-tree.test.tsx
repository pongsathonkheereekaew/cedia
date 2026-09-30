import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CediaTreePanel,
} from "../vendor/synara/apps/web/src/components/chat/CediaTreeSurface";
import {
  parseCediaTreeAnswer,
  parseCediaTreeNavigateAnswer,
} from "../vendor/synara/apps/web/src/lib/serverReactQuery";
import { createCediaNativeApi } from "../src/cedia-adapter.ts";

const treeAnswer = {
  available: true,
  leafId: "leaf-2",
  nodes: [
    {
      id: "root",
      parentId: null,
      kind: "prompt",
      timestamp: "2026-09-24T00:00:00.000Z",
      label: "Start task",
      labelTruncated: false,
    },
    {
      id: "leaf-2",
      parentId: "root",
      kind: "prompt",
      timestamp: "2026-09-24T00:01:00.000Z",
      label: "Continue from here",
      labelTruncated: true,
    },
  ],
  pathIds: ["root", "leaf-2"],
  truncated: true,
  lineage: {
    sessionFile: "/state/session-1.json",
    parentSession: "parent-session",
    previousSessionFiles: ["/state/session-0.json"],
  },
};

describe("Cedia session tree", () => {
  it("strictly parses the runtime tree and its lineage", () => {
    const parsed = parseCediaTreeAnswer(treeAnswer);
    expect(parsed).toMatchObject({
      state: "available",
      leafId: "leaf-2",
      pathIds: ["root", "leaf-2"],
      lineage: { sessionFile: "/state/session-1.json", parentSession: "parent-session" },
    });
    if (parsed.state === "available") expect(parsed.nodes).toHaveLength(2);
    expect(() => parseCediaTreeAnswer({ ...treeAnswer, extra: true })).toThrow(/invalid session tree response/);
    expect(() => parseCediaTreeAnswer({ ...treeAnswer, nodes: [{ ...treeAnswer.nodes[0], labelTruncated: "no" }] })).toThrow(/tree node label/);
  });

  it("renders the runtime rows, active path, lineage, and truncation without inventing points", () => {
    const html = renderToStaticMarkup(
      <CediaTreePanel state={parseCediaTreeAnswer(treeAnswer)} onNavigate={() => undefined} />,
    );
    expect(html).toContain("Own session file: ");
    expect(html).toContain("/state/session-1.json");
    expect(html).toContain("Parent session:");
    expect(html).toContain("The runtime truncated this tree; more points are not shown.");
    expect(html).toContain('data-tree-node-id="root"');
    expect(html).toContain('data-tree-active="true"');
    expect(html).toContain("label truncated");
    expect(html).toContain("Switch to this point");
    expect(html).not.toContain("synthetic");
  });

  it("keeps unavailable, parked, cancelled, and summarized navigation states honest", () => {
    const unavailable = renderToStaticMarkup(
      <CediaTreePanel state={{ state: "unavailable", reason: "session tree is disabled" }} />,
    );
    expect(unavailable).toContain("session tree is disabled");
    expect(unavailable).not.toContain("Switch to this point");

    const parked = parseCediaTreeNavigateAnswer({
      available: true,
      moved: false,
      cancelled: false,
      aborted: false,
      askReopen: true,
      summarized: false,
      editorText: null,
      editorTextTruncated: false,
      editorImageCount: 0,
      leafId: "leaf-2",
    });
    const parkedHtml = renderToStaticMarkup(
      <CediaTreePanel state={parseCediaTreeAnswer(treeAnswer)} navigation={parked} />,
    );
    expect(parkedHtml).toContain("parked the target and did not move this task");

    const summary = parseCediaTreeNavigateAnswer({
      available: true,
      moved: true,
      cancelled: false,
      aborted: false,
      askReopen: false,
      summarized: true,
      editorText: "Target prompt",
      editorTextTruncated: true,
      editorImageCount: 2,
      leafId: "root",
    });
    const summaryHtml = renderToStaticMarkup(
      <CediaTreePanel state={parseCediaTreeAnswer(treeAnswer)} navigation={summary} />,
    );
    expect(summaryHtml).toContain("runtime summarized the conversation");
    expect(summaryHtml).toContain("text was truncated before it was put back in the composer");
    expect(summaryHtml).toContain("2 images were reported for the target");
  });

  it("uses the tree routes and durable command envelope through the adapter", async () => {
    const calls: Array<{ method?: string; path?: string; body?: unknown }> = [];
    const session = {
      id: "session-1",
      projectId: "project-1",
      title: "Task",
      cwd: "/workspace",
      sessionFile: "/state/session-1.json",
      incarnation: "inc-1",
      status: "idle",
      archived: false,
      createdAt: "2026-09-24T00:00:00.000Z",
      updatedAt: "2026-09-24T00:00:00.000Z",
    };
    const bridge = {
      invoke: async (_channel: string, input: unknown) => {
        const request = input as { kind?: string; method?: string; path?: string; body?: unknown };
        if (request.kind === "request") calls.push(request);
        if (request.path === "/v1/sessions/session-1") return session;
        if (request.path === "/v1/sessions/session-1/tree" && request.method === "GET") return treeAnswer;
        if (request.path === "/v1/sessions/session-1/tree/navigate" && request.method === "POST") {
          return {
            available: true,
            moved: true,
            cancelled: false,
            aborted: false,
            askReopen: false,
            summarized: false,
            editorText: "Continue from here",
            editorTextTruncated: false,
            editorImageCount: 0,
            leafId: "root",
          };
        }
        throw new Error(`Unexpected ${request.method} ${request.path}`);
      },
    };
    const api = createCediaNativeApi({ bridge });
    await api.cedia.getTree("session-1");
    await api.cedia.navigateTree("session-1", "root", true);
    expect(calls).toContainEqual({
      kind: "request",
      method: "GET",
      path: "/v1/sessions/session-1/tree",
    });
    const navigateCall = calls.find((call) => call.path === "/v1/sessions/session-1/tree/navigate");
    expect(navigateCall?.body).toMatchObject({
      incarnation: "inc-1",
      entryId: "root",
      summarize: true,
    });
    expect((navigateCall?.body as { commandId?: unknown }).commandId).toEqual(expect.any(String));
  });
});
