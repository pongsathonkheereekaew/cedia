import type { ForgeReviewMutationOperation } from "../../../../../../../../../../packages/protocol/src/forge-review-workflow.ts";

export interface ReviewMutationIdentity {
  projectId: string;
  url: string;
  expectedHeadSha: string;
  operation: ForgeReviewMutationOperation;
}
type CommandStorage = Pick<Storage, "getItem" | "setItem">;
const storageKey = "cedia:forge-review:unresolved-commands:v1";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function read(storage: CommandStorage): Record<string, string> {
  const raw = storage.getItem(storageKey);
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((id) => typeof id !== "string" || !id)) {
    throw new Error("Review command history could not be read. Restore it before publishing to avoid duplicate feedback.");
  }
  return value as Record<string, string>;
}

/** Persist before sending. Closing/reopening or reloading must reuse an uncertain write. */
export function getReviewMutationCommandId(input: ReviewMutationIdentity, storage: CommandStorage = window.localStorage): string {
  const commands = read(storage);
  const key = canonical(input);
  if (commands[key]) return commands[key];
  if (Object.keys(commands).length >= 128) throw new Error("Resolve outstanding review actions before publishing more feedback.");
  const commandId = crypto.randomUUID();
  storage.setItem(storageKey, JSON.stringify({ ...commands, [key]: commandId }));
  return commandId;
}

/** Only a confirmed or definitively rejected receipt releases the exact request. */
export function completeReviewMutationCommand(input: ReviewMutationIdentity, storage: CommandStorage = window.localStorage): void {
  const commands = read(storage);
  delete commands[canonical(input)];
  storage.setItem(storageKey, JSON.stringify(commands));
}
