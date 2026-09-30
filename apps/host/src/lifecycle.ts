import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostLifecyclePhase, HostLifecycleSnapshot } from "../../../packages/protocol/src/index.ts";

export interface LifecycleIdentity {
  readonly generation: string;
  readonly processStartedAt: string;
  readonly stateDir: string;
  readonly protocolVersion: number;
  readonly appGeneration?: string;
}

/** Stable for this process and resistant to a PID being recycled after a crash. */
export function processStartIdentity(pid: number, startedAt: string): string {
  return `${pid}:${startedAt}`;
}

export class HostLifecycle {
	readonly #path: string;
	#identity: LifecycleIdentity;
	#phase: HostLifecyclePhase = "ready";

  constructor(stateDir: string, processStartedAt: string, protocolVersion = 1, appGeneration?: string) {
    this.#path = join(stateDir, "lifecycle.json");
    this.#identity = { generation: randomUUID(), processStartedAt, stateDir, protocolVersion, ...(appGeneration ? { appGeneration } : {}) };
    this.#write();
  }

  snapshot(): HostLifecycleSnapshot {
    return { phase: this.#phase, generation: this.#identity.generation, processStartedAt: this.#identity.processStartedAt };
  }

  identity(): LifecycleIdentity { return { ...this.#identity }; }

  adopt(input: unknown, actualStateDir: string, actualProtocolVersion: number): HostLifecycleSnapshot {
    const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
    if (this.#phase !== "ready" || value.generation !== this.#identity.generation
      || value.processStartedAt !== this.#identity.processStartedAt || value.stateDir !== actualStateDir
      || (this.#identity.appGeneration !== undefined && value.appGeneration !== this.#identity.appGeneration)
      || value.protocolVersion !== actualProtocolVersion || this.#identity.stateDir !== actualStateDir
      || this.#identity.protocolVersion !== actualProtocolVersion) throw new Error("Host adoption identity is stale or incompatible");
    this.#identity = { ...this.#identity, generation: randomUUID(), ...(typeof value.appGeneration === "string" ? { appGeneration: value.appGeneration } : {}) };
    this.#write(); // rotate the lease before accepting the new application generation
    return this.snapshot();
  }

	requestQuit(): HostLifecycleSnapshot {
		if (this.#phase === "ready") this.#phase = "quitting";
		this.#write();
		return this.snapshot();
	}

	/** Backwards-compatible name for callers that predate the lifecycle API. */
	beginQuit(): HostLifecycleSnapshot { return this.requestQuit(); }

	/**
	 * Reopen admission after a cancelled quit decision (plan §2.7 "Deliberate Quit":
	 * "Cancel reopens admission").
	 *
	 * A `quitting` host has only fenced new work - nothing was stopped - so reopening is
	 * safe. A `stopped` host is a completed shutdown and an owner cannot take it back:
	 * that is refused instead of being reported as a successful reopen.
	 */
	resume(): HostLifecycleSnapshot {
		if (this.#phase === "stopped") throw new Error("Host has already stopped and cannot reopen admission");
		if (this.#phase === "quitting") { this.#phase = "ready"; this.#write(); }
		return this.snapshot();
	}

	completeQuit(): HostLifecycleSnapshot {
		if (this.#phase !== "stopped") this.#phase = "stopped";
		this.#write();
		return this.snapshot();
	}

	accepting(): boolean { return this.#phase === "ready"; }

  assertAccepting(): void {
    if (this.#phase !== "ready") throw new Error("Host is quitting and no longer accepts commands");
  }

  #write(): void {
    const temporary = `${this.#path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ ...this.#identity, phase: this.#phase }), { mode: 0o600 });
    renameSync(temporary, this.#path);
  }
}

export function readLifecycleIdentity(path: string): LifecycleIdentity | undefined {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<LifecycleIdentity>;
    if (typeof value.generation !== "string" || typeof value.processStartedAt !== "string" || typeof value.stateDir !== "string" || typeof value.protocolVersion !== "number") return undefined;
    return value as LifecycleIdentity;
  } catch { return undefined; }
}

/** Read the durable phase after the host process has exited. */
export function readLifecycleSnapshot(path: string): HostLifecycleSnapshot | undefined {
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
		const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		if (!value || typeof value !== "object"
			|| (value.phase !== "ready" && value.phase !== "quitting" && value.phase !== "stopped")
			|| typeof value.generation !== "string" || typeof value.processStartedAt !== "string") return undefined;
		return { phase: value.phase as HostLifecyclePhase, generation: value.generation, processStartedAt: value.processStartedAt };
	} catch { return undefined; }
}
