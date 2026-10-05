// FILE: CodeReviewDiffBody.tsx
// Purpose: Forge-backed review diff surface with Codex-style display controls.
// Layer: Code Review UI
// Notes: Inline comments are local drafts. The parent workflow owns persistence
//        and any GitHub/GitLab mutation.

import { useQuery } from "@tanstack/react-query";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { useTheme } from "~/hooks/useTheme";
import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
import {
  Columns2Icon,
  CopyIcon,
  FolderIcon,
  FoldersIcon,
  LoaderIcon,
  Rows3Icon,
  TextWrapIcon,
} from "~/lib/icons";
import {
  buildFileDiffRenderKey,
  getRenderablePatch,
  resolveDiffCopyText,
  resolveFileDiffPath,
  sortFileDiffsByPath,
  type RenderablePatch,
} from "~/lib/diffRendering";
import {
  formatForgeReviewError,
  forgeReviewQueryKeys,
  getForgeReviewApi,
  type ForgeReviewDetail,
  type ForgeReviewDetailInput,
  type ForgeReviewDiffResult,
} from "~/lib/forgeReview";
import { scrollDiffFileIntoView } from "~/lib/diffScrollSurface";

import {
  DiffPanelChangeNavigationButtons,
  type DiffPanelChangeNavigation,
} from "../DiffPanelChangeNavigation";
import { DiffPanelFileJumpMenu } from "../DiffPanelFileJumpMenu";
import { DiffPanelPatchViewport } from "../DiffPanelPatchViewport";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import { ReviewFileTreePanel } from "../ReviewFileTreePanel";
import type { DiffInlineCommentDraft } from "../DiffPanelFileList";

import { CodeReviewSnapshotNotice } from "./CodeReviewPresentation";

export type CodeReviewInlineCommentDraft = DiffInlineCommentDraft;

export interface CodeReviewDiffBodyProps {
  input: ForgeReviewDetailInput;
  detail: ForgeReviewDetail;
  /** Emits a local draft; publishing remains in the review workflow owner. */
  onAddInlineComment?: (comment: CodeReviewInlineCommentDraft) => void;
}

function viewedFilesStorageKey(input: ForgeReviewDetailInput, detail: ForgeReviewDetail): string {
  const encode = (value: string) => encodeURIComponent(value);
  return [
    "cedia",
    "forge-review",
    "viewed-files",
    encode(input.projectId),
    encode(input.url),
    encode(detail.refs.head?.sha ?? detail.snapshot.headSha ?? "unknown-head"),
    encode(detail.refs.base?.sha ?? detail.snapshot.baseSha ?? "unknown-base"),
  ].join(":");
}

function readViewedFiles(storageKey: string): ReadonlySet<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

function DiffBodyError(props: { error: unknown; onRetry: () => void }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-8">
      <div role="alert" className="max-w-md rounded-xl border border-destructive/30 bg-destructive/8 p-5 text-center">
        <h2 className="text-sm font-semibold">Review changes could not load</h2>
        <p className="mt-1 text-xs text-muted-foreground">{formatForgeReviewError(props.error)}</p>
        <Button size="sm" variant="outline" className="mt-4" onClick={props.onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

function DiffToolbar(props: {
  renderablePatch: RenderablePatch | null;
  renderableFiles: ReadonlyArray<FileDiffMetadata>;
  resolvedTheme: "light" | "dark";
  diffRenderMode: "stacked" | "split";
  diffWordWrap: boolean;
  fileTreeOpen: boolean;
  selectedFilePath: string | null;
  allFilesCollapsed: boolean;
  copyState: "idle" | "copied";
  changeNavigation: DiffPanelChangeNavigation;
  onDiffRenderModeChange: (mode: "stacked" | "split") => void;
  onDiffWordWrapChange: (enabled: boolean) => void;
  onToggleFileTree: () => void;
  onToggleCollapseAll: () => void;
  onSelectFile: (path: string) => void;
  onCopyDiff: () => void;
}) {
  const hasFiles = props.renderableFiles.length > 0;
  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-1 border-b border-border/70 px-2 py-1">
      <span className="mr-1 text-[11px] font-medium text-muted-foreground">Changes</span>
      {hasFiles ? (
        <span className="mr-1 text-[10px] tabular-nums text-muted-foreground/70">
          {props.renderableFiles.length} {props.renderableFiles.length === 1 ? "file" : "files"}
        </span>
      ) : null}
      <div className="flex items-center rounded-md border border-border/70 p-0.5" role="group" aria-label="Diff layout">
        <Button
          size="xs"
          variant={props.diffRenderMode === "split" ? "subtle" : "ghost"}
          aria-pressed={props.diffRenderMode === "split"}
          onClick={() => props.onDiffRenderModeChange("split")}
          title="Split diff"
        >
          <Columns2Icon className="size-3.5" aria-hidden />
          <span className="sr-only sm:not-sr-only">Split</span>
        </Button>
        <Button
          size="xs"
          variant={props.diffRenderMode === "stacked" ? "subtle" : "ghost"}
          aria-pressed={props.diffRenderMode === "stacked"}
          onClick={() => props.onDiffRenderModeChange("stacked")}
          title="Stacked diff"
        >
          <Rows3Icon className="size-3.5" aria-hidden />
          <span className="sr-only sm:not-sr-only">Stacked</span>
        </Button>
      </div>
      <Button
        size="xs"
        variant={props.diffWordWrap ? "subtle" : "ghost"}
        aria-pressed={props.diffWordWrap}
        onClick={() => props.onDiffWordWrapChange(!props.diffWordWrap)}
        title="Wrap long lines"
      >
        <TextWrapIcon className="size-3.5" aria-hidden />
        <span className="sr-only sm:not-sr-only">Wrap</span>
      </Button>
      {hasFiles ? (
        <>
          <DiffPanelFileJumpMenu
            renderableFiles={props.renderableFiles}
            selectedFilePath={props.selectedFilePath}
            resolvedTheme={props.resolvedTheme}
            onSelectFile={props.onSelectFile}
          />
          <IconButton
            variant={props.fileTreeOpen ? "subtle" : "ghost"}
            size="icon-xs"
            label={props.fileTreeOpen ? "Hide changed files" : "Show changed files"}
            title={props.fileTreeOpen ? "Hide changed files" : "Show changed files"}
            aria-pressed={props.fileTreeOpen}
            onClick={props.onToggleFileTree}
          >
            <FoldersIcon className="size-3.5" aria-hidden />
          </IconButton>
          <IconButton
            variant="ghost"
            size="icon-xs"
            label={props.allFilesCollapsed ? "Expand all files" : "Collapse all files"}
            title={props.allFilesCollapsed ? "Expand all files" : "Collapse all files"}
            onClick={props.onToggleCollapseAll}
          >
            {props.allFilesCollapsed ? <FolderIcon className="size-3.5" aria-hidden /> : <FoldersIcon className="size-3.5" aria-hidden />}
          </IconButton>
          <DiffPanelChangeNavigationButtons navigation={props.changeNavigation} />
        </>
      ) : null}
      <span className="flex-1" />
      <IconButton
        variant="ghost"
        size="icon-xs"
        label={props.copyState === "copied" ? "Copied diff" : "Copy diff"}
        title={props.copyState === "copied" ? "Copied diff" : "Copy diff"}
        disabled={props.renderablePatch === null}
        onClick={props.onCopyDiff}
      >
        <CopyIcon className="size-3.5" aria-hidden />
      </IconButton>
    </div>
  );
}

export function CodeReviewDiffBody(props: CodeReviewDiffBodyProps) {
  const { resolvedTheme } = useTheme();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<ReadonlySet<string>>(() => new Set());
  const [diffRenderMode, setDiffRenderMode] = useState<"stacked" | "split">("split");
  const [diffWordWrap, setDiffWordWrap] = useState(true);
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const reviewViewedStorageKey = useMemo(
    () => viewedFilesStorageKey(props.input, props.detail),
    [props.detail, props.input],
  );
  const [viewedFiles, setViewedFiles] = useState<ReadonlySet<string>>(() =>
    readViewedFiles(reviewViewedStorageKey),
  );
  const diffInput = useMemo(
    () => ({
      ...props.input,
      ...(props.detail.refs.head?.sha ? { headSha: props.detail.refs.head.sha } : {}),
      ...(props.detail.refs.base?.sha ? { baseSha: props.detail.refs.base.sha } : {}),
    }),
    [props.detail.refs.base?.sha, props.detail.refs.head?.sha, props.input],
  );
  const diffQuery = useQuery({
    queryKey: forgeReviewQueryKeys.diff(diffInput),
    queryFn: () => getForgeReviewApi().diff(diffInput),
    staleTime: 30_000,
    retry: false,
  });
  const diff = diffQuery.data;
  const renderablePatch = useMemo(
    () => (diff ? getRenderablePatch(diff.patch, `forge-review:${props.input.projectId}:${props.input.url}`) : null),
    [diff, props.input.projectId, props.input.url],
  );
  const renderableFiles = useMemo(
    () => (renderablePatch?.kind === "files" ? sortFileDiffsByPath(renderablePatch.files) : []),
    [renderablePatch],
  );
  const diffFilePaths = useMemo(() => renderableFiles.map(resolveFileDiffPath), [renderableFiles]);
  const allFilesCollapsed = renderableFiles.length > 0 && renderableFiles.every((fileDiff) => collapsedFiles.has(buildFileDiffRenderKey(fileDiff)));

  useEffect(() => {
    setCollapsedFiles(new Set());
    setSelectedFilePath(null);
    setCopyState("idle");
    setViewedFiles(readViewedFiles(reviewViewedStorageKey));
  }, [diffInput.baseSha, diffInput.headSha, diffInput.projectId, diffInput.url, reviewViewedStorageKey]);

  useEffect(() => {
    if (copyState !== "copied") return;
    const timeoutId = window.setTimeout(() => setCopyState("idle"), 1_500);
    return () => window.clearTimeout(timeoutId);
  }, [copyState]);

  const toggleFileCollapsed = useCallback((fileKey: string) => {
    setCollapsedFiles((current) => {
      const next = new Set(current);
      if (next.has(fileKey)) next.delete(fileKey);
      else next.add(fileKey);
      return next;
    });
  }, []);
  const toggleCollapseAll = useCallback(() => {
    setCollapsedFiles(
      allFilesCollapsed
        ? new Set()
        : new Set(renderableFiles.map((fileDiff) => buildFileDiffRenderKey(fileDiff))),
    );
  }, [allFilesCollapsed, renderableFiles]);
  const scrollToFile = useCallback((filePath: string) => {
    setSelectedFilePath(filePath);
    scrollDiffFileIntoView(viewportRef.current, filePath, "start");
  }, []);
  const toggleFileViewed = useCallback(
    (filePath: string) => {
      setViewedFiles((current) => {
        const next = new Set(current);
        if (next.has(filePath)) next.delete(filePath);
        else next.add(filePath);
        try {
          window.localStorage.setItem(reviewViewedStorageKey, JSON.stringify([...next]));
        } catch {
          // Local review markers are best-effort when storage is unavailable.
        }
        return next;
      });
    },
    [reviewViewedStorageKey],
  );
  const changeNavigation = useMemo<DiffPanelChangeNavigation>(() => {
    const currentIndex = selectedFilePath ? diffFilePaths.indexOf(selectedFilePath) : -1;
    const previousIndex = currentIndex > 0 ? currentIndex - 1 : -1;
    const nextIndex = currentIndex < 0 ? 0 : currentIndex + 1;
    return {
      canGoToPrevious: previousIndex >= 0,
      canGoToNext: nextIndex < diffFilePaths.length,
      previousShortcutLabel: null,
      nextShortcutLabel: null,
      onGoToPrevious: () => {
        const previousPath = previousIndex >= 0 ? diffFilePaths[previousIndex] : undefined;
        if (previousPath) scrollToFile(previousPath);
      },
      onGoToNext: () => {
        const nextPath = nextIndex < diffFilePaths.length ? diffFilePaths[nextIndex] : undefined;
        if (nextPath) scrollToFile(nextPath);
      },
    };
  }, [diffFilePaths, scrollToFile, selectedFilePath]);
  const copyDiff = useCallback(() => {
    const copyText = resolveDiffCopyText(diff?.patch, diff?.truncated ?? false);
    if (!copyText) return;
    void copyTextToClipboard(copyText).then(() => setCopyState("copied"));
  }, [diff]);

  if (diffQuery.isPending) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
        <LoaderIcon className="size-3.5 animate-spin" aria-hidden /> Loading changes…
      </div>
    );
  }
  if (diffQuery.isError || !diff) {
    return <DiffBodyError error={diffQuery.error} onRetry={() => void diffQuery.refetch()} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="forge-review-diff-loaded">
      <CodeReviewSnapshotNotice detail={props.detail} diff={diff} />
      <DiffToolbar
        renderablePatch={renderablePatch}
        renderableFiles={renderableFiles}
        resolvedTheme={resolvedTheme}
        diffRenderMode={diffRenderMode}
        diffWordWrap={diffWordWrap}
        fileTreeOpen={fileTreeOpen}
        selectedFilePath={selectedFilePath}
        allFilesCollapsed={allFilesCollapsed}
        copyState={copyState}
        changeNavigation={changeNavigation}
        onDiffRenderModeChange={setDiffRenderMode}
        onDiffWordWrapChange={setDiffWordWrap}
        onToggleFileTree={() => setFileTreeOpen((open) => !open)}
        onToggleCollapseAll={toggleCollapseAll}
        onSelectFile={scrollToFile}
        onCopyDiff={copyDiff}
      />
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div ref={viewportRef} className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <DiffWorkerPoolProvider>
            <DiffPanelPatchViewport
              renderablePatch={renderablePatch}
              renderableFiles={renderableFiles}
              resolvedTheme={resolvedTheme}
              diffRenderMode={diffRenderMode}
              diffWordWrap={diffWordWrap}
              workspaceRoot={null}
              collapsedFiles={collapsedFiles}
              onToggleFileCollapsed={toggleFileCollapsed}
              onAddInlineComment={props.onAddInlineComment}
              viewedFiles={viewedFiles}
              onToggleFileViewed={toggleFileViewed}
              isLoading={diffQuery.isFetching}
              hasNoChanges={diffQuery.isSuccess && !renderablePatch}
              error={null}
              loadingLabel="Loading review diff…"
              emptyLabel="This review has no file changes."
              unavailableLabel="The review diff is unavailable."
              viewKind="repo"
            />
          </DiffWorkerPoolProvider>
        </div>
        {fileTreeOpen && renderableFiles.length > 0 ? (
          <div className="w-[min(42%,28rem)] shrink-0 border-l border-border/70">
            <ReviewFileTreePanel
              files={renderableFiles}
              selectedFilePath={selectedFilePath}
              resolvedTheme={resolvedTheme}
              onSelectFile={scrollToFile}
              onClose={() => setFileTreeOpen(false)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
