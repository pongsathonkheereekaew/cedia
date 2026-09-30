/** Trusted OMP extension: the execution process itself retains the session lock. */
import { DatabaseSync } from "node:sqlite";
import { chmodSync, closeSync, openSync, realpathSync } from "node:fs";

let owner: DatabaseSync | undefined;
export default function lockOmpSession(): void {
  const path = process.env.CEDIA_SESSION_LOCK;
  if (!path) {
    process.stderr.write("Cedia requires a session ownership lock\n");
    process.exit(73);
  }
  try {
    closeSync(openSync(path, "a", 0o600));
    chmodSync(path, 0o600);
    owner = new DatabaseSync(path);
    owner.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
    // The TUI presence bridge must prove this process acquired the lock. A second SQLite
    // connection seeing SQLITE_BUSY only proves that some process holds it.
    (globalThis as unknown as Record<symbol, string>)[Symbol.for("cedia.runtime-lock")] = realpathSync(path);
  } catch {
    process.stderr.write("Cedia session is still owned by another OMP process\n");
    process.exit(73);
  }
  process.once("exit", () => { try { owner?.close(); } catch { /* OS also releases the lock. */ } });
}
