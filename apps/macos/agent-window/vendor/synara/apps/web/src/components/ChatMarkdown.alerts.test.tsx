import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@pierre/diffs", () => ({
  getFiletypeFromFileName: (fileName: string) => (fileName.endsWith(".ts") ? "ts" : "text"),
  getSharedHighlighter: () =>
    Promise.resolve({
      codeToHtml(code: string) {
        return `<pre class="shiki"><code>${code}</code></pre>`;
      },
    }),
}));

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

function renderWithQueryClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

async function renderMarkdown(text: string, cwd = "C:\\Users\\LENOVO\\synara") {
  const { default: ChatMarkdown } = await import("./ChatMarkdown");

  return renderWithQueryClient(<ChatMarkdown text={text} cwd={cwd} isStreaming={false} />);
}

describe("ChatMarkdown GitHub alerts (ported from upstream #1273)", () => {
  it("renders GitHub alert blockquotes with a title and strips the marker", async () => {
    const markup = await renderMarkdown("> [!NOTE]\n> **Medium Risk**\n> Details");

    expect(markup).toContain('data-github-alert="note"');
    expect(markup).toContain('class="markdown-alert-title"');
    expect(markup).toContain(">Note</p>");
    expect(markup).not.toContain("[!NOTE]");
    expect(markup).toContain("<strong>Medium Risk</strong>");
  });

  it("leaves blockquotes with inline text after the marker as plain quotes", async () => {
    const markup = await renderMarkdown("> [!NOTE] not an alert");

    expect(markup).not.toContain("data-github-alert");
    expect(markup).toContain("[!NOTE] not an alert");
  });

  it.each(["\n", "\r\n"])(
    "keeps wiki links on the first line of a GitHub alert (%j)",
    async (eol) => {
      const { default: ChatMarkdown } = await import("./ChatMarkdown");
      const markup = renderWithQueryClient(
        <ChatMarkdown
          text={`> [!NOTE]${eol}> See [[My note]] now`}
          cwd="/vault"
          wikiLinkRoot="/vault"
        />,
      );
      expect(markup).toContain('data-github-alert="note"');
      expect(markup).toContain('href="/vault/My%20note.md"');
      expect(markup).not.toContain("[[My note]]");
    },
  );
});
