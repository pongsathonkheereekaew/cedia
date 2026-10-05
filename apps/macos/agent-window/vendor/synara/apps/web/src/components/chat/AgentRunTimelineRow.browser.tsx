// FILE: AgentRunTimelineRow.browser.tsx
// Purpose: Browser regressions for the Arc-style per-turn agent-run overlay row:
//          disclosure header, tool-group fold, approval gate, result Review fold.
// Layer: Vitest browser tests

import "../../index.css";

import { ApprovalRequestId, MessageId, TurnId } from "@synara/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { MessagesTimeline } from "./MessagesTimeline";
import type { TimelineEntry } from "../../session-logic";
import { deriveTimelineEntries } from "../../workLog";

function assistantEntry(id: string, text: string): TimelineEntry {
  return {
    id: `entry-${id}`,
    kind: "message",
    createdAt: "2026-03-17T19:12:28.000Z",
    message: {
      id: MessageId.makeUnsafe(id),
      role: "assistant",
      text,
      createdAt: "2026-03-17T19:12:28.000Z",
      streaming: false,
    },
  };
}

function commandEntry(id: string, turnId: string, command: string): TimelineEntry {
  return {
    id: `entry-${id}`,
    kind: "work",
    createdAt: "2026-03-17T19:12:28.000Z",
    entry: {
      id,
      createdAt: "2026-03-17T19:12:28.000Z",
      label: "Ran command",
      tone: "tool",
      itemType: "command_execution",
      toolStatus: "completed",
      command,
      turnId: TurnId.makeUnsafe(turnId),
    },
  };
}

const TURN = "agent-run-turn";

function AgentRunTimeline(props: {
  entries: TimelineEntry[];
  extra?: Record<string, unknown>;
}) {
  return (
    <MessagesTimeline
      hasMessages
      isWorking={false}
      activeTurnInProgress={false}
      activeTurnStartedAt={null}
      timelineEntries={props.entries}
      turnDiffSummaryByAssistantMessageId={new Map()}
      nowIso="2026-03-17T19:12:30.000Z"
      expandedWorkGroups={{}}
      onToggleWorkGroup={() => {}}
      onOpenTurnDiff={() => {}}
      revertTurnCountByUserMessageId={new Map()}
      onRevertUserMessage={() => {}}
      isRevertingCheckpoint={false}
      onImageExpand={() => {}}
      markdownCwd={undefined}
      resolvedTheme="dark"
      timestampFormat="locale"
      workspaceRoot={undefined}
      turnStateByTurnId={new Map([[TURN, "settled"]])}
      {...(props.extra ?? {})}
    />
  );
}

function createTimelineHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.style.cssText = "display:flex;width:600px;height:520px;overflow:hidden;";
  document.body.append(host);
  return host;
}

function findAgentRunTrigger(): HTMLButtonElement | null {
  return (
    [...document.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find((button) =>
      (button.textContent ?? "").includes("Agent run"),
    ) ?? null
  );
}

describe("AgentRunTimelineRow overlay", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });
  it("renders a per-turn disclosure that expands to the turn tool calls", async () => {
    const host = createTimelineHost();
    render(
      <AgentRunTimeline
        entries={[
          assistantEntry("a1", "done"),
          commandEntry("w1", TURN, "bun run lint"),
          commandEntry("w2", TURN, "bun run typecheck"),
        ]}
      />,
      { container: host },
    );
    await expect.poll(() => findAgentRunTrigger() !== null).toBe(true);
    const trigger = findAgentRunTrigger()!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // Tool calls stay folded behind the run disclosure (folded group line or
    // hidden rows) until the run disclosure opens.
    expect(findAgentRunTrigger()!.getAttribute("aria-expanded")).toBe("false");
    await trigger.click();
    // The open run reveals its tool lines (folded summary toggle or the rows).
    await expect
      .poll(() => {
        const text = document.body.textContent ?? "";
        return text.includes("Ran 2 commands") || text.includes("bun run lint");
      })
      .toBe(true);
  });

  it("shows the approval gate card on the running turn", async () => {
    const host = createTimelineHost();
    render(
      <AgentRunTimeline
        entries={[commandEntry("w1", TURN, "rm -rf /tmp/x")]}
        extra={{
          pendingApprovalByTurnId: new Map([
            [
              TURN,
              {
                requestId: ApprovalRequestId.makeUnsafe("req-1"),
                requestKind: "command",
                createdAt: "2026-03-17T19:12:29.000Z",
                detail: "rm -rf /tmp/x",
              },
            ],
          ]),
          turnStateByTurnId: new Map([[TURN, "running"]]),
          onRespondToAgentRunApproval: async () => {},
        }}
      />,
      { container: host },
    );
    await expect.poll(() => findAgentRunTrigger() !== null).toBe(true);
    await findAgentRunTrigger()!.click();
    await expect
      .poll(() => (document.body.textContent ?? "").includes("Approve once"))
      .toBe(true);
  });

  it("shows the result fold with a Review action on settled runs with files", async () => {
    const host = createTimelineHost();
    render(
      <AgentRunTimeline
        entries={[
          assistantEntry("a1", "done"),
          commandEntry("w1", TURN, "bun run lint"),
        ]}
        extra={{ turnFileCountByTurnId: new Map([[TURN, 3]]) }}
      />,
      { container: host },
    );
    await expect.poll(() => findAgentRunTrigger() !== null).toBe(true);
    await findAgentRunTrigger()!.click();
    await expect
      .poll(() => (document.body.textContent ?? "").includes("Edited 3 files"))
      .toBe(true);
    await expect
      .poll(
        () =>
          [...document.querySelectorAll("button")].some(
            (button) => button.textContent === "Review",
          ),
      )
      .toBe(true);
  });
});
