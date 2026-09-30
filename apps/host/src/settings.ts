import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Json } from "../../../packages/protocol/src/index.ts";

export interface SettingField { readonly key: string; readonly type: "string" | "number" | "boolean" | "string[]"; readonly scope: "app" | "device"; readonly owner: "cedia"; readonly default: Json }
export interface SettingsSnapshot { readonly revision: number; readonly values: Readonly<Record<string, Json>>; readonly fields: readonly SettingField[] }
export class SettingsConflictError extends Error { readonly code = "settings_conflict"; }

const FIELDS: readonly SettingField[] = [
  { key: "appTheme", type: "string", scope: "app", owner: "cedia", default: "system" },
  { key: "uiDensity", type: "string", scope: "app", owner: "cedia", default: "comfortable" },
  { key: "chatWidth", type: "string", scope: "app", owner: "cedia", default: "standard" },
  { key: "chatFontSizePx", type: "number", scope: "app", owner: "cedia", default: 12 },
  { key: "composerEffortSlider", type: "boolean", scope: "app", owner: "cedia", default: true },
  { key: "enableAssistantStreaming", type: "boolean", scope: "app", owner: "cedia", default: true },
  { key: "sidebarThreadSortOrder", type: "string", scope: "app", owner: "cedia", default: "updated_at" },
  { key: "hiddenSidebarNavItems", type: "string[]", scope: "app", owner: "cedia", default: [] },
];
const defaults = Object.fromEntries(FIELDS.map(field => [field.key, field.default])) as Record<string, Json>;
function valid(field: SettingField, value: unknown): value is Json {
    if (field.type === "string") return typeof value === "string" && value.length <= 128
      && (field.key !== "appTheme" || ["system", "light", "dark"].includes(value))
      && (field.key !== "uiDensity" || ["compact", "comfortable", "spacious"].includes(value))
      // The renderer's own vocabulary, not a second one: the shared bundle offers standard/wide/full
      // for the chat column and updated_at/created_at for task order (§6.4 "merge duplicate ...
      // into this one key"). A host-only word would be a value no control can produce or show.
      && (field.key !== "chatWidth" || ["standard", "wide", "full"].includes(value))
      && (field.key !== "sidebarThreadSortOrder" || ["updated_at", "created_at"].includes(value));
  if (field.type === "number") return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 256;
  if (field.type === "boolean") return typeof value === "boolean";
  return Array.isArray(value) && value.length <= 100 && value.every(item => typeof item === "string" && item.length <= 128);
}

/** Versioned host owner for the explicitly CEDIA-owned app preferences subset. */
export class SettingsStore {
  readonly #path: string;
  readonly #directory: string;
  #revision = 0;
  #values: Record<string, Json> = { ...defaults };

  constructor(stateDir: string) {
    this.#directory = join(stateDir, "settings");
    this.#path = join(this.#directory, "app-preferences.json");
    mkdirSync(this.#directory, { recursive: true, mode: 0o700 }); chmodSync(this.#directory, 0o700);
    if (!existsSync(this.#path)) return;
    const saved = JSON.parse(readFileSync(this.#path, "utf8")) as { version?: number; revision?: number; values?: Record<string, unknown> };
    if (saved.version !== 1 || !Number.isSafeInteger(saved.revision) || saved.revision! < 0 || !saved.values || typeof saved.values !== "object" || Array.isArray(saved.values)) throw new Error("Unsupported Cedia settings store");
    for (const [key, value] of Object.entries(saved.values)) {
      const field = FIELDS.find(candidate => candidate.key === key);
      if (field && valid(field, value)) this.#values[key] = value;
    }
    this.#revision = saved.revision!;
  }

  read(): SettingsSnapshot { return { revision: this.#revision, values: { ...this.#values }, fields: FIELDS.map(field => ({ ...field })) }; }
  patch(expectedRevision: number, category: string, patch: Record<string, unknown>): SettingsSnapshot {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError("Invalid settings revision");
    if (category !== "appearance" && category !== "layout" && category !== "composer") throw new TypeError("Unsupported settings category");
    const allowed = FIELDS.filter(field => categoryFor(field.key) === category);
    for (const [key, value] of Object.entries(patch)) {
      const field = allowed.find(item => item.key === key);
      if (!field) throw new TypeError(`Unsupported Cedia preference: ${key}`);
      if (!valid(field, value)) throw new TypeError(`Invalid Cedia preference: ${key}`);
    }
    if (expectedRevision !== this.#revision) throw new SettingsConflictError("Settings changed elsewhere; reload before applying this patch");
    const next = { ...this.#values };
    for (const [key, value] of Object.entries(patch)) next[key] = value as Json;
    this.#persist(this.#revision + 1, next);
    this.#values = next; this.#revision++;
    return this.read();
  }
  #persist(revision: number, values: Record<string, Json>): void {
    const temporary = `${this.#path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify({ version: 1, revision, values })); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, this.#path);
    const dir = openSync(this.#directory, "r"); try { fsyncSync(dir); } finally { closeSync(dir); }
    try { unlinkSync(temporary); } catch { /* rename already consumed it */ }
  }
}

function categoryFor(key: string): string {
  if (key === "appTheme" || key === "uiDensity" || key === "chatWidth" || key === "chatFontSizePx") return "appearance";
  if (key.startsWith("sidebar" ) || key === "hiddenSidebarNavItems") return "layout";
  return "composer";
}
