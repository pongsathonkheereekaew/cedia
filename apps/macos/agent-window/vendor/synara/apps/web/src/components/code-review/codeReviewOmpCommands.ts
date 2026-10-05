import type { ForgeReviewOmpInput } from "~/lib/forgeReview";
type ForgeReviewOmpMode = "review" | "ask";

function newCommandId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `forge-review-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function commandKey(mode: ForgeReviewOmpMode, request: Omit<ForgeReviewOmpInput, "commandId">): string {
  const { threadId: _threadId, ...identity } = request;
  return canonical({ mode, request: identity });
}

type OmpCommandStorage = Pick<Storage, "getItem" | "setItem">;
export type StoredOmpCommand = {
  readonly commandId: string;
  readonly request: Omit<ForgeReviewOmpInput, "commandId">;
};
const OMP_COMMAND_STORAGE_KEY = "cedia:forge-review:omp-commands:v1";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function readOmpCommands(storage: OmpCommandStorage): Record<string, StoredOmpCommand> {
  const raw = storage.getItem(OMP_COMMAND_STORAGE_KEY);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OMP review request history could not be read. Restore it before retrying to avoid a duplicate task.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OMP review request history is invalid. Restore it before retrying to avoid a duplicate task.");
  }
  const commands: Record<string, StoredOmpCommand> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("OMP review request history is invalid. Restore it before retrying to avoid a duplicate task.");
    }
    const record = value as { commandId?: unknown; request?: unknown };
    if (typeof record.commandId !== "string" || !record.commandId || !record.request || typeof record.request !== "object" || Array.isArray(record.request)) {
      throw new Error("OMP review request history is invalid. Restore it before retrying to avoid a duplicate task.");
    }
    commands[key] = { commandId: record.commandId, request: record.request as Omit<ForgeReviewOmpInput, "commandId"> };
  }
  return commands;
}

function ompStorage(): OmpCommandStorage {
  if (typeof window === "undefined" || !window.localStorage) throw new Error("OMP review request history is unavailable; retry after storage is restored.");
  return window.localStorage;
}

export function reserveOmpCommand(key: string, request: Omit<ForgeReviewOmpInput, "commandId">): StoredOmpCommand {
  const storage = ompStorage();
  const commands = readOmpCommands(storage);
  const existing = commands[key];
  if (existing) {
    if (commandKey("review", existing.request) !== commandKey("review", request) ||
        (existing.request.threadId !== undefined && typeof existing.request.threadId !== "string")) {
      throw new Error("OMP review request history does not match this request. Restore it before retrying.");
    }
    return existing;
  }
  if (Object.keys(commands).length >= 128) throw new Error("Resolve outstanding OMP review requests before starting more reviews.");
  const commandId = newCommandId();
  const record: StoredOmpCommand = { commandId, request };
  try {
    storage.setItem(OMP_COMMAND_STORAGE_KEY, JSON.stringify({ ...commands, [key]: record }));
  } catch {
    throw new Error("OMP review request history could not be saved; retry after storage is restored.");
  }
  return record;
}

export function completeOmpCommand(key: string): void {
  const storage = ompStorage();
  const commands = readOmpCommands(storage);
  if (!(key in commands)) return;
  delete commands[key];
  try {
    storage.setItem(OMP_COMMAND_STORAGE_KEY, JSON.stringify(commands));
  } catch {
    throw new Error("OMP review was accepted, but its retry record could not be cleared. Keep this review open and retry only after storage is restored.");
  }
}

