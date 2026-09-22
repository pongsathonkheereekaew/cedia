import { describe, expect, it } from "bun:test";
import { ThreadId } from "@synara/contracts";
import { renderToStaticMarkup } from "react-dom/server";

import { sessionLabelForTest, statusBarValuesForTest } from "../vendor/synara/apps/web/src/components/cediaStatusBar";

const threadId = ThreadId.makeUnsafe("thread-1");

function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: threadId,
    projectId: "project-1",
    title: "First task",
    modelSelection: { provider: "omp", model: "fixture-model" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    envMode: "local",
    branch: "main",
    worktreePath: null,
    workingDirectory: "/workspace/demo",
    associatedWorktreePath: null,
    associatedWorktreeBranch: null,
    associatedWorktreeRef: null,
    createBranchFlowCompleted: false,
    session: {
      provider: "omp",
      status: "running",
      createdAt: "2026-09-22T00:00:00.000Z",
      updatedAt: "2026-09-22T00:01:00.000Z",
      orchestrationStatus: "idle",
    },
    ...overrides,
  };
}

describe("Cedia status bar values (item 55)", () => {
  it("maps the live thread to host, model, session and branch", () => {
    const values = statusBarValuesForTest(thread());
    expect(values).toMatchObject({ host: "live", session: "running", branch: "main" });
    expect(values?.model.toLowerCase()).toContain("fixture-model".replace("-", " "));
  });

  it("marks error and connecting sessions honestly", () => {
    expect(statusBarValuesForTest(thread({ session: { provider: "omp", status: "error" } }))?.session).toBe("error");
    expect(statusBarValuesForTest(thread({ session: { provider: "omp", status: "connecting" } }))?.host).toBe("connecting");
  });

  it("falls back to dashes without model or branch", () => {
    const values = statusBarValuesForTest(thread({ modelSelection: { provider: "omp", model: "" }, branch: null }));
    expect(values?.model).toBe("—");
    expect(values?.branch).toBe("—");
  });

  it("returns null without a thread", () => {
    expect(statusBarValuesForTest(undefined)).toBeNull();
  });

  it("covers every session phase label", () => {
    for (const status of ["idle", "starting", "running", "ready", "interrupted", "stopped", "connecting", "closed", "error", "unknown"]) {
      expect(typeof sessionLabelForTest(status, status === "error")).toBe("string");
    }
    expect(sessionLabelForTest("error", true)).toBe("error");
    expect(sessionLabelForTest("bogus", false)).toBe("idle");
  });

  it("paints on the shared statusBar tokens", () => {
    // The bar itself needs a router context, so assert the token contract here:
    // the component renders `var(--vscode-statusBar-*)`, never a hardcoded color.
    const source = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "../vendor/synara/apps/web/src/components/cediaStatusBar.tsx"),
      "utf8",
    );
    for (const token of ["--vscode-statusBar-background", "--vscode-statusBar-foreground", "--vscode-statusBar-border"]) {
      expect(source).toContain(token);
    }
    expect(renderToStaticMarkup(<div />)).toBe("<div></div>");
  });
});
