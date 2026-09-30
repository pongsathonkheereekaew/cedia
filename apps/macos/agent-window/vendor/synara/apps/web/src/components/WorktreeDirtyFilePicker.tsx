// FILE: WorktreeDirtyFilePicker.tsx
// Purpose: Dirty-file checklist for a first worktree send: which uncommitted paths the new
//          worktree carries. Untouched means the host default (carry the checkout's changes);
//          an explicit empty list carries none. (Cedia addition, not upstream.)
// Layer: Composer worktree flow beside the base-branch selector.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { gitStatusQueryOptions } from "~/lib/gitReactQuery";
import type { ThreadWorkspacePatch } from "../types";

export interface DirtyFileEntry {
  path: string;
  insertions: number;
  deletions: number;
}

/**
 * Effective carry list for the checklist: the explicit selection once the user touched
 * it, otherwise every dirty file (exactly what the host does with no selection).
 */
export function resolveDirtyFileSelection(
  files: ReadonlyArray<DirtyFileEntry>,
  selection: ReadonlyArray<string> | null | undefined,
): string[] {
  if (selection !== undefined && selection !== null) return [...selection];
  return files.map((file) => file.path);
}

export function WorktreeDirtyFileList(props: {
  files: ReadonlyArray<DirtyFileEntry>;
  selection: ReadonlyArray<string> | null | undefined;
  onToggle: (path: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const effective = useMemo(
    () => new Set(resolveDirtyFileSelection(props.files, props.selection)),
    [props.files, props.selection],
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[length:var(--app-font-size-ui-sm,11px)] text-[var(--color-text-foreground-secondary)]">
        <span>
          Carry changes into worktree ({effective.size} of {props.files.length})
        </span>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" onClick={props.onSelectAll} aria-label="Carry all dirty files">
            All
          </button>
          <button type="button" onClick={props.onClear} aria-label="Carry no dirty files">
            None
          </button>
        </span>
      </div>
      <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto">
        {props.files.map((file) => {
          const checked = effective.has(file.path);
          return (
            <li key={file.path}>
              <label className="flex cursor-pointer items-center gap-2 text-[length:var(--app-font-size-ui-sm,11px)]">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => props.onToggle(file.path)}
                  aria-label={`Carry ${file.path} into the worktree`}
                />
                <span className="truncate font-mono">{file.path}</span>
                <span className="text-[var(--color-text-foreground-tertiary)]">
                  +{file.insertions}/-{file.deletions}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function WorktreeDirtyFilePicker(props: {
  cwd: string | null;
  selection: ReadonlyArray<string> | null | undefined;
  onSetThreadWorkspace: (patch: ThreadWorkspacePatch) => void;
}) {
  const statusQuery = useQuery(gitStatusQueryOptions(props.cwd));
  const files = useMemo<DirtyFileEntry[]>(
    () =>
      (statusQuery.data?.workingTree.files ?? []).map((file) => ({
        path: file.path,
        insertions: file.insertions,
        deletions: file.deletions,
      })),
    [statusQuery.data],
  );
  // No cwd, still loading, errored, or a clean tree: nothing to pick.
  if (!props.cwd || files.length === 0) return null;
  const toggle = (path: string) => {
    const current = new Set(resolveDirtyFileSelection(files, props.selection));
    if (current.has(path)) {
      current.delete(path);
    } else {
      current.add(path);
    }
    props.onSetThreadWorkspace({
      dirtyFiles: files.map((file) => file.path).filter((candidate) => current.has(candidate)),
    });
  };
  return (
    <WorktreeDirtyFileList
      files={files}
      selection={props.selection}
      onToggle={toggle}
      onSelectAll={() => props.onSetThreadWorkspace({ dirtyFiles: files.map((file) => file.path) })}
      onClear={() => props.onSetThreadWorkspace({ dirtyFiles: [] })}
    />
  );
}
