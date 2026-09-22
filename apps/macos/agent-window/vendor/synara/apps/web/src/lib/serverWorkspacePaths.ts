// FILE: serverWorkspacePaths.ts
// Purpose: Normalize the server-reported home and chat workspace paths.
// Layer: Web domain helper
// Exports: ServerWorkspacePaths plus normalization and fallback helpers.

import { resolveChatContainerWorkspaceRoot } from "@synara/shared/projectContainers";

export interface ServerWorkspacePaths {
  readonly homeDir: string | null | undefined;
  readonly chatWorkspaceRoot?: string | null | undefined;
}

export interface NormalizedServerWorkspacePaths {
  readonly homeDir: string | null;
  readonly chatWorkspaceRoot: string | null;
}

export function normalizeServerWorkspacePaths(
  paths: ServerWorkspacePaths,
): NormalizedServerWorkspacePaths {
  return {
    homeDir: paths.homeDir?.trim() || null,
    chatWorkspaceRoot: paths.chatWorkspaceRoot?.trim() || null,
  };
}

export function resolveServerChatWorkspaceRoot(paths: ServerWorkspacePaths): string | null {
  return resolveChatContainerWorkspaceRoot(paths);
}
