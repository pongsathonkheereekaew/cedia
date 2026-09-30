import { randomUUID } from "node:crypto";
import { chmodSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The task-local context consumed by an explicitly qualified Cedia OMP launch. */
export const OWNER_LAUNCH_CONTEXT_FILENAME = ".cedia-task-context.json" as const;

export interface OwnerLaunchContext {
  readonly version: 1;
  readonly taskId: string;
  readonly incarnation: string;
  readonly sessionFile: string;
  readonly cwd: string;
  readonly creditGuard: true;
}

export type OwnerLaunchContextFields = Pick<OwnerLaunchContext, "taskId" | "incarnation" | "sessionFile" | "cwd">;

const OWNER_LAUNCH_CONTEXT_KEYS = ["version", "taskId", "incarnation", "sessionFile", "cwd", "creditGuard"] as const;

export function ownerLaunchContextPath(directory: string): string {
  return join(directory, OWNER_LAUNCH_CONTEXT_FILENAME);
}

function assertFields(fields: OwnerLaunchContextFields): void {
  for (const key of ["taskId", "incarnation", "sessionFile", "cwd"] as const) {
    if (typeof fields[key] !== "string" || fields[key].length === 0) throw new TypeError(`Owner launch context ${key} must be a non-empty string`);
  }
}

/**
 * Persist the launch context with a same-directory rename so a launcher never observes a partial
 * JSON document. The temporary and final files are both kept private because this record names the
 * task's authenticated session identity, even though it intentionally contains no credential.
 */
export function writeOwnerLaunchContext(directory: string, fields: OwnerLaunchContextFields): OwnerLaunchContext {
  assertFields(fields);
  const value: OwnerLaunchContext = { version: 1, ...fields, creditGuard: true };
  const path = ownerLaunchContextPath(directory);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } catch (error) {
    try { rmSync(temporary, { force: true }); } catch { /* Preserve the original write/rename error. */ }
    throw error;
  }
  return value;
}

function parseOwnerLaunchContext(value: unknown): OwnerLaunchContext | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== OWNER_LAUNCH_CONTEXT_KEYS.length || OWNER_LAUNCH_CONTEXT_KEYS.some(key => !Object.hasOwn(record, key))) return undefined;
  if (record.version !== 1 || record.creditGuard !== true) return undefined;
  const fields = {
    taskId: record.taskId,
    incarnation: record.incarnation,
    sessionFile: record.sessionFile,
    cwd: record.cwd,
  };
  if (Object.values(fields).some(value => typeof value !== "string" || value.length === 0)) return undefined;
  return { version: 1, taskId: fields.taskId as string, incarnation: fields.incarnation as string, sessionFile: fields.sessionFile as string, cwd: fields.cwd as string, creditGuard: true };
}

export function readOwnerLaunchContext(directory: string): OwnerLaunchContext | undefined {
  try {
    return parseOwnerLaunchContext(JSON.parse(readFileSync(ownerLaunchContextPath(directory), "utf8")));
  } catch {
    return undefined;
  }
}

/** A launcher may proceed only when every durable identity field is still current. */
export function isOwnerLaunchContextCurrent(context: OwnerLaunchContext | undefined, expected: OwnerLaunchContextFields): boolean {
  if (context === undefined) return false;
  try { assertFields(expected); } catch { return false; }
  return context.version === 1
    && context.creditGuard === true
    && context.taskId === expected.taskId
    && context.incarnation === expected.incarnation
    && context.sessionFile === expected.sessionFile
    && context.cwd === expected.cwd;
}
