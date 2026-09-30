import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { buildMenuItems } from "../vendor/synara/apps/web/src/components/GitActionsControl.logic";
import {
  DIFF_PANEL_PICKER_SCOPE_OPTIONS,
  resolveDiffPanelPickerLabel,
  resolveDiffPanelViewSource,
} from "../vendor/synara/apps/web/src/components/DiffPanel.logic";
import { MessageCopyButton } from "../vendor/synara/apps/web/src/components/chat/MessageCopyButton";
import { CediaExtensionsSection } from "../vendor/synara/apps/web/src/components/chat/CediaToolCatalogSurface";
import { CediaAgentsPanel } from "../vendor/synara/apps/web/src/components/chat/CediaAgentsSurface";
import { InlineLinkChip } from "../vendor/synara/apps/web/src/components/InlineLinkChip";
import { normalizeComposerLinkUrl } from "../vendor/synara/apps/web/src/lib/linkChips";

describe("Cedia equivalents for selected TUI slash commands", () => {
  it("/git is backed by GitActionsControl's real commit/push menu", () => {
    const menu = buildMenuItems(
      {
        branch: "feature/tree",
        hasWorkingTreeChanges: true,
        workingTree: { files: [{ path: "README.md", insertions: 1, deletions: 0 }], insertions: 1, deletions: 0 },
        hasUpstream: true,
        upstreamBranch: "origin/feature/tree",
        aheadCount: 0,
        behindCount: 0,
        pr: null,
      },
      false,
      true,
      false,
    );
    expect(menu.map((item) => item.id)).toEqual(["commit", "commit_push", "push", "pr"]);
    expect(menu.find((item) => item.id === "commit")?.kind).toBe("open_dialog");
    expect(menu.find((item) => item.id === "commit_push")?.dialogAction).toBe("commit_push");
    expect(DIFF_PANEL_PICKER_SCOPE_OPTIONS).toEqual(expect.arrayContaining(["unstaged", "staged"]));
    expect(resolveDiffPanelPickerLabel(resolveDiffPanelViewSource({ diffViewKind: "repo", repoDiffScope: "staged", selectedTurnId: null }))).toBe("Staged");
  });

  it("/copy is backed by the transcript MessageCopyButton action", () => {
    const html = renderToStaticMarkup(<MessageCopyButton text="selected conversation text" />);
    expect(html).toContain('aria-label="Copy message"');
  });

  it("/extensions is backed by the Tool catalog panel's per-row extension toggles", () => {
    const answer = {
      available: true as const,
      roots: { explicit: [], mode: "merge", configured: ["/tmp/p"], configuredLevel: "project" },
      extensions: [
        { id: "mcp:echo", kind: "mcp", name: "echo", displayName: "Echo", description: "Echo server", descriptionTruncated: false, path: "/tmp/p/.omp/mcp.json", source: { provider: "mcp", providerName: "MCP", level: "project" }, state: "active" },
      ],
      truncated: false,
      total: 1,
    };
    const html = renderToStaticMarkup(
      <CediaExtensionsSection extensions={answer} onToggleExtension={() => {}} />,
    );
    expect(html).toContain('data-testid="cedia-extensions-section"');
    expect(html).toContain('data-extension-id="mcp:echo"');
    expect(html).toContain('aria-label="Disable extension Echo"');
  });

  it("/agents is backed by the Agents panel roster, transcript viewer and lifecycle toggles", () => {
    const answer = {
      state: "available" as const,
      revision: 9,
      agents: [
        { id: "live", name: "Runner", kind: "sub", status: "running", createdAt: 1, lastActivity: 2, sessionFile: "/tmp/live.json" },
        { id: "parked", name: "Sleeper", kind: "sub", status: "parked", createdAt: 3, lastActivity: 4 },
      ],
    };
    const html = renderToStaticMarkup(
      <CediaAgentsPanel state={answer} onKillAgent={() => {}} onReviveAgent={() => {}} />,
    );
    expect(html).toContain('data-testid="cedia-agents-surface"');
    expect(html).toContain('data-agent-id="live"');
    expect(html).toContain('aria-label="Read transcript for Runner"');
    expect(html).toContain('aria-label="Kill agent Runner"');
    expect(html).toContain('aria-label="Revive agent Sleeper"');
  });

  it("/open is backed by the conversation InlineLinkChip browser action", () => {
    const html = renderToStaticMarkup(<InlineLinkChip url="https://example.com/docs" interactive />);
    expect(html).toContain('<button type="button"');
    expect(html).toContain('title="https://example.com/docs"');
    expect(normalizeComposerLinkUrl("example.com/docs")).toBe("https://example.com/docs");
  });
});
