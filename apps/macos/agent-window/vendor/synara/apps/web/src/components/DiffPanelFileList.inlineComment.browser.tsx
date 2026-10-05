// FILE: DiffPanelFileList.inlineComment.browser.tsx
// Purpose: Regression coverage for the read-only inline review draft affordance.

import "../index.css";

import type { FileDiffMetadata } from "@pierre/diffs/react";
import type { PropsWithChildren, ReactNode } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { DiffLineClickProps } from "./chat/FileDiffView";

const harness = vi.hoisted(() => ({
  onAddInlineComment: vi.fn(),
}));

vi.mock("./chat/FileDiffView", () => ({
  FileDiffSurface: ({ children }: PropsWithChildren) => <div>{children}</div>,
  FileDiffCard: ({
    renderHeaderTrailing,
    onLineClick,
  }: {
    renderHeaderTrailing?: () => ReactNode;
    onLineClick?: (line: DiffLineClickProps) => void;
  }) => {
    const additionLine = {
      lineNumber: 7,
      lineType: "change-addition",
      annotationSide: "additions",
      lineElement: document.createElement("span"),
      event: new MouseEvent("click"),
    } as unknown as DiffLineClickProps;
    return (
      <>
        <div data-diff-file-header>{renderHeaderTrailing?.()}</div>
        <button type="button" data-testid="diff-line-add" onClick={() => onLineClick?.(additionLine)}>
          Added line 7
        </button>
      </>
    );
  },
}));

vi.mock("./LocalImagePreview", () => ({
  LocalImagePreview: () => null,
}));

import { DiffPanelFileList } from "./DiffPanelFileList";

function fileDiff(path: string): FileDiffMetadata {
  return {
    cacheKey: `diff:${path}`,
    name: `b/${path}`,
    prevName: `a/${path}`,
  } as FileDiffMetadata;
}

afterEach(() => {
  document.body.innerHTML = "";
  harness.onAddInlineComment.mockReset();
  vi.restoreAllMocks();
});

describe("inline review draft", () => {
  it("maps a clicked addition to a valid local draft without a remote call", async () => {
    await render(
      <DiffPanelFileList
        renderableFiles={[fileDiff("src/example.ts")]}
        resolvedTheme="light"
        diffRenderMode="split"
        diffWordWrap
        workspaceRoot={null}
        collapsedFiles={new Set()}
        onToggleFileCollapsed={vi.fn()}
        onAddInlineComment={harness.onAddInlineComment}
      />,
    );

    await page.getByTestId("diff-line-add").click();
    await page.getByRole("textbox", { name: "Comment on src/example.ts line 7" }).fill("Please add a test.");
    await page.getByRole("button", { name: "Save draft" }).click();

    expect(harness.onAddInlineComment).toHaveBeenCalledWith({
      path: "src/example.ts",
      line: 7,
      side: "RIGHT",
      body: "Please add a test.",
    });
  });
});

