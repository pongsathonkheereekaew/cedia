import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HostHttpError } from "./api.ts";

export interface ExtensionStateStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export type LegacyDraftRequest = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown) => Promise<unknown>;
export interface LegacyDraftMigrationPort {
  read(): Readonly<Record<string, string>> | undefined | Promise<Readonly<Record<string, string>> | undefined>;
  markImported(ids: readonly string[], snapshot: Readonly<Record<string, string>>): void | Promise<void>;
}

/** The old state remains as a local recovery copy after the host import is verified. */
export function legacyDraftMigrationFromExtensionState(state: ExtensionStateStore) {
  return {
    read(): Readonly<Record<string, string>> | undefined {
      const marker = state.get<{ version?: unknown }>("cedia.drafts.migration");
      if (marker?.version === 1) return undefined;
      const drafts = state.get<unknown>("cedia.drafts");
      if (drafts === undefined) return {};
      if (!drafts || typeof drafts !== "object" || Array.isArray(drafts)) throw new Error("Legacy extension drafts are not a record");
      return drafts as Record<string, string>;
    },
    async markImported(ids: readonly string[], snapshot: Readonly<Record<string, string>>): Promise<void> {
      const drafts = state.get<unknown>("cedia.drafts") ?? {};
      if (!drafts || typeof drafts !== "object" || Array.isArray(drafts)) throw new Error("Legacy extension drafts are not a record");
      const ordered = (value: Record<string, string>) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
      if (JSON.stringify(ordered(drafts as Record<string, string>)) !== JSON.stringify(ordered(snapshot as Record<string, string>))) {
        throw new Error("Legacy extension drafts changed during migration");
      }
      await state.update("cedia.drafts.migration", { version: 1, importedIds: [...ids] });
    },
  };
}

/** Import old extension composer copies without choosing them over app-side drafts. */
export async function importLegacyExtensionDrafts(request: LegacyDraftRequest, migration: LegacyDraftMigrationPort): Promise<void> {
  const snapshot = await migration.read();
  if (snapshot === undefined) return;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("Legacy extension drafts are not a record");
  const entries = Object.entries(snapshot).sort(([a], [b]) => a.localeCompare(b)).map(([key, text]) => {
    if (typeof text !== "string") throw new Error("Legacy extension draft text is not a string");
    const draftId = `legacy-extension-${createHash("sha256").update(key, "utf8").update("\0").update(text, "utf8").digest("hex")}`;
    const content = { draft: { prompt: text }, legacy: { store: "cedia.drafts", key } };
    return { draftId, text, content, source: "cedia.drafts" };
  });
  const batches: typeof entries[] = [];
  let batch: typeof entries = [];
  for (const entry of entries) {
    if (batch.length >= 4) { batches.push(batch); batch = []; }
    batch.push(entry);
  }
  if (batch.length > 0) batches.push(batch);
  for (const rows of batches) {
    await request("POST", "drafts/import", { entries: rows });
    for (const expected of rows) {
      const stored = await request("GET", `drafts/${encodeURIComponent(expected.draftId)}`) as { revision?: unknown; text?: unknown; source?: unknown; content?: unknown };
      if (typeof stored?.revision !== "number" || !Number.isSafeInteger(stored.revision) || stored.revision < 1
        || stored.text !== expected.text || stored.source !== expected.source || JSON.stringify(stored.content) !== JSON.stringify(expected.content)) {
        throw new Error(`Legacy draft import could not be verified for ${expected.draftId}`);
      }
    }
  }
  const latest = await migration.read();
  const expectedSnapshot = entries.map(({ text, content }) => [content.legacy.key, text]);
  const sameSnapshot = latest !== undefined
    && JSON.stringify(Object.entries(latest).sort(([a], [b]) => a.localeCompare(b))) === JSON.stringify(expectedSnapshot);
  if (!sameSnapshot) throw new Error("Legacy extension drafts changed during migration");
  await migration.markImported(entries.map(entry => entry.draftId), snapshot);
}

export function agentUiStateDir(stateDir?: string): string {
  return join(stateDir ?? process.env.CEDIA_STATE_DIR ?? join(homedir(), "Library", "Application Support", "Cedia", "host"), "agent-ui");
}
export function validAgentThreadId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function fileFor(directory: string, key: string): string {
  return join(directory, `${createHash("sha256").update(key).digest("hex")}.json`);
}
export async function readAgentUiState(directory: string, key: string): Promise<unknown> {
  try { return JSON.parse(await readFile(fileFor(directory, key), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function writeAgentUiState(directory: string, key: string, value: unknown): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = fileFor(directory, key);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, destination);
}

/** Drop one cached record. A missing file is already the state this asks for. */
export async function removeAgentUiState(directory: string, key: string): Promise<void> {
  try { await unlink(fileFor(directory, key)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
export async function saveIdeHandoff(stateDir: string | undefined, cwd: string, sessionId: string): Promise<void> {
  await writeAgentUiState(agentUiStateDir(stateDir), `handoff:${resolve(cwd)}`, { sessionId, revision: randomUUID() });
}
export async function readIdeHandoff(stateDir: string, cwd: string): Promise<{ sessionId: string; revision: string } | null> {
  const value = await readAgentUiState(agentUiStateDir(stateDir), `handoff:${resolve(cwd)}`) as { sessionId?: unknown; revision?: unknown } | null;
  return value && validAgentThreadId(value.sessionId) && typeof value.revision === "string" ? { sessionId: value.sessionId, revision: value.revision } : null;
}

/** A local unsent draft has an identity before the host creates its OMP session. */
export async function resolveAgentUiThread(stateDir: string | undefined, id: string,
  request: (path: string) => Promise<unknown>): Promise<{ id: string; cwd: string; durable: boolean }> {
  if (!validAgentThreadId(id)) throw new Error("Invalid Agent task");
  try {
    const session = await request(`sessions/${encodeURIComponent(id)}`) as { id?: unknown; cwd?: unknown };
    if (typeof session.cwd !== "string") throw new Error("Invalid Agent session workspace");
    return { id, cwd: session.cwd, durable: true };
  } catch (error) {
    if (!(error instanceof HostHttpError) || error.status !== 404) throw error;
  }
  const payload = await readAgentUiState(agentUiStateDir(stateDir), `draft:${id}`) as { draftThread?: { projectId?: unknown; worktreePath?: unknown; workingDirectory?: unknown } } | null;
  const draft = payload?.draftThread;
  if (!draft || typeof draft.projectId !== "string") throw new Error("Agent draft is unavailable");
  const projects = await request("projects") as { id: string; path: string }[];
  const project = projects.find(item => item.id === draft.projectId);
  if (!project) throw new Error("Agent draft workspace is unavailable");
  const cwd = typeof draft.worktreePath === "string" ? draft.worktreePath : typeof draft.workingDirectory === "string" ? draft.workingDirectory : project.path;
  return { id, cwd, durable: false };
}
