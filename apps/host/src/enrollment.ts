/**
 * Short-lived, single-use enrollment for a remote controller (plan §6.5).
 *
 * The owner shows a QR (the long code) or reads out a short pin; a device redeems either once,
 * before it expires, and receives its own controller credential from `DeviceAuth`. Nothing here
 * mints a long-lived credential, and a redeemed or expired record never works twice.
 *
 * The records live in their own private file rather than inside the device store: the credential
 * store keeps only token hashes and must not need a migration just to add enrollment.
 */
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface EnrollmentRecord {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly redeemedAt?: string;
  readonly deviceId?: string;
}

export interface EnrollmentOffer extends EnrollmentRecord {
  /** The long code a QR carries. Shown once. */
  readonly code: string;
  /** The short code the owner can read out. Shown once. */
  readonly pin: string;
}

export type EnrollmentRefusal = "unknown" | "expired" | "already_redeemed";

interface StoredEnrollmentRecord {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  codeHash: string;
  pinHash: string;
  redeemedAt?: string;
  deviceId?: string;
}
interface StoredEnrollment { version: 1; records: StoredEnrollmentRecord[] }
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const MAX_RECORDS = 50;
const MAX_TTL_MS = 60 * 60_000;

export class EnrollmentStore {
  readonly #path: string;
  readonly #directory: string;
  #state: StoredEnrollment;
  #faulted = false;

  constructor(stateDir: string) {
    this.#directory = stateDir;
    this.#path = join(stateDir, "enrollments.json");
    mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
    chmodSync(this.#directory, 0o700);
    if (existsSync(this.#path)) {
      if (!lstatSync(this.#path).isFile() || lstatSync(this.#path).isSymbolicLink()) throw new Error("Enrollment store must be a regular file");
      const state = JSON.parse(readFileSync(this.#path, "utf8")) as StoredEnrollment;
      if (state.version !== 1 || !Array.isArray(state.records) || state.records.length > MAX_RECORDS
        || state.records.some(record => !record || typeof record.id !== "string" || typeof record.name !== "string"
          || !/^[0-9a-f]{64}$/.test(record.codeHash) || !/^[0-9a-f]{64}$/.test(record.pinHash)
          || typeof record.createdAt !== "string" || typeof record.expiresAt !== "string"
          || (record.redeemedAt !== undefined && typeof record.redeemedAt !== "string"))) throw new Error("Unsupported enrollment store");
      this.#state = state;
      chmodSync(this.#path, 0o600);
    } else {
      this.#state = { version: 1, records: [] };
    }
  }

  /** Mint one offer. The codes are returned once and only their hashes are kept. */
  issue(name: string, options: { readonly ttlMs?: number; readonly now?: Date } = {}): EnrollmentOffer {
    const label = name.trim();
    if (!label || label.length > 100) throw new Error("Enrollment label must contain 1–100 characters");
    const ttlMs = options.ttlMs ?? 10 * 60_000;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 30_000 || ttlMs > MAX_TTL_MS) throw new Error("Enrollment lifetime must be between 30 seconds and 60 minutes");
    const now = options.now ?? new Date();
    const code = randomBytes(32).toString("base64url");
    const pin = String(randomInt(0, 100_000_000)).padStart(8, "0");
    const record = {
      id: randomUUID(),
      name: label,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      codeHash: hash(code),
      pinHash: hash(pin),
    };
    this.#state.records = [...this.#state.records, record].slice(-MAX_RECORDS);
    this.#save();
    const { codeHash: _c, pinHash: _p, ...offer } = record;
    return { ...offer, code, pin };
  }

  /**
   * Claim an offer exactly once, before it expires.
   *
   * The claim is written before the caller mints the device credential, so a crash after this point
   * costs one enrollment rather than handing the same code out twice.
   */
  claim(codeOrPin: string, options: { readonly now?: Date } = {}): { readonly ok: true; readonly record: EnrollmentRecord } | { readonly ok: false; readonly reason: EnrollmentRefusal } {
    if (this.#faulted) return { ok: false, reason: "unknown" };
    const value = typeof codeOrPin === "string" ? codeOrPin.trim() : "";
    if (!value || value.length > 128) return { ok: false, reason: "unknown" };
    const digest = hash(value);
    const record = this.#state.records.find(candidate => candidate.codeHash === digest || candidate.pinHash === digest);
    if (!record) return { ok: false, reason: "unknown" };
    if (record.redeemedAt !== undefined) return { ok: false, reason: "already_redeemed" };
    const now = options.now ?? new Date();
    if (Date.parse(record.expiresAt) <= now.getTime()) return { ok: false, reason: "expired" };
    record.redeemedAt = now.toISOString();
    try { this.#save(); } catch (error) { this.#faulted = true; throw error; }
    const { codeHash: _c, pinHash: _p, ...claimed } = record;
    return { ok: true, record: claimed };
  }

  /** Remember which device an enrollment produced, so the owner's list can say so. */
  bindDevice(id: string, deviceId: string): void {
    const record = this.#state.records.find(candidate => candidate.id === id);
    if (!record) return;
    record.deviceId = deviceId;
    this.#save();
  }

  /** What the owner may see: no hashes, and the state each offer is in. */
  list(options: { readonly now?: Date } = {}): ReadonlyArray<EnrollmentRecord & { readonly state: "pending" | "expired" | "redeemed" }> {
    const now = (options.now ?? new Date()).getTime();
    return this.#state.records.map(record => {
      const { codeHash: _c, pinHash: _p, ...visible } = record;
      return { ...visible, state: record.redeemedAt !== undefined ? "redeemed" : Date.parse(record.expiresAt) <= now ? "expired" : "pending" } as const;
    });
  }

  #save(): void {
    const temporary = `${this.#path}.${randomUUID()}.tmp`;
    try {
      const fd = openSync(temporary, "wx", 0o600);
      try { writeFileSync(fd, JSON.stringify(this.#state)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, this.#path);
      const directoryFd = openSync(this.#directory, "r");
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    } finally { try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  }
}
