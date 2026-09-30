/**
 * Coordinates the Electron application's lifetime with the single Cedia host.
 *
 * This module deliberately has no Electron import.  The main process supplies
 * the small gateway and quit hook, which keeps the state machine testable with
 * in-memory fixtures and prevents a second host or execution owner from being
 * introduced here.
 */

export interface CediaLifecycleGateway {
	ensure(): Promise<void>;
	/** Raw host answer; the coordinator normalizes it and never trusts its shape. */
	lifecycle(): Promise<unknown>;
	/**
	 * Read-only look at a host that is already running; it must never start one.
	 * The quit path uses this so asking to quit cannot spawn the host it is stopping.
	 */
	peek?(): Promise<unknown>;
	/** Durable on-disk receipt the host leaves behind as it stops. */
	shutdownReceipt?(): Promise<{ phase?: string } | undefined>;
	/**
	 * Close admission at the host without stopping it, so no new local or remote work
	 * starts while the owner is deciding about a quit (plan §2.7 "Deliberate Quit").
	 */
	fence?(): Promise<unknown>;
	/** Reopen admission after the owner cancels that decision. */
	resume?(): Promise<unknown>;
	quit(): Promise<unknown>;
	reliable(): boolean;
}

export type CediaLifecyclePhase = "unreachable" | "ready" | "quitting" | "stopped";

export interface CediaLifecycleStatus {
	phase: CediaLifecyclePhase;
	accepting: boolean;
	runningSessions: number;
	remotePaired: boolean;
	dirtyEditors: number;
	hostGeneration?: string;
	busy: boolean;
}

export interface CediaAppLifecycle {
	status(): CediaLifecycleStatus;
	refresh(): Promise<CediaLifecycleStatus>;
	tryQuit(options?: CediaTryQuitOptions): Promise<CediaQuitResult>;
}

export interface CediaTryQuitOptions {
	/**
	 * Whether to ask the owner before stopping active work. The pre-quit surface
	 * asks; the Code-OSS shutdown seam has already committed to quitting, so it
	 * stops the host and reports the result instead of prompting again.
	 */
	readonly confirm?: boolean;
}

export interface CediaQuitResult {
	readonly outcome: "idle" | "stopped" | "cancelled" | "failed";
	readonly status: CediaLifecycleStatus;
	readonly error?: string;
}

export interface CediaAppLifecycleOptions {
	readonly gateway: CediaLifecycleGateway;
	readonly readDirtyEditors?: () => Promise<number> | number;
	readonly confirmStopAndQuit: (state: {
		runningSessions: number;
		remotePaired: boolean;
		dirtyEditors: number;
	}) => Promise<"stop" | "cancel">;
	readonly onChange?: (state: CediaLifecycleStatus) => void;
	/** Test seam for the bounded shutdown poll. */
	readonly sleep?: (milliseconds: number) => Promise<void> | void;
	/** Test seam for the bounded shutdown deadline. */
	readonly now?: () => number;
	readonly pollIntervalMs?: number;
	readonly maxPollAttempts?: number;
	readonly pollTimeoutMs?: number;
}

export interface CediaQuitDecisionOptions {
	readonly lifecycle: CediaAppLifecycle;
	/**
	 * How many work windows are open. Cedia only decides a quit it can ask about:
	 * with every window closed there is no surface to prompt on and the shutdown
	 * join owns stopping the host.
	 */
	readonly windowsOpen?: () => number;
}

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_MAX_POLL_ATTEMPTS = 20;
const DEFAULT_POLL_TIMEOUT_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function errorText(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

function normalizeCount(value: unknown): number {
	return nonNegativeInteger(value) ? value : 0;
}

function normalizeSnapshot(
	value: unknown,
	dirtyEditors: number,
	busy: boolean,
): CediaLifecycleStatus | undefined {
	if (!isRecord(value)) return undefined;
	const phase = value.phase;
	if (phase !== "ready" && phase !== "quitting" && phase !== "stopped") return undefined;
	if (typeof value.accepting !== "boolean" || typeof value.remotePaired !== "boolean") return undefined;
	if (!nonNegativeInteger(value.runningSessions)) return undefined;
	return {
		phase,
		accepting: value.accepting,
		runningSessions: value.runningSessions,
		remotePaired: value.remotePaired,
		dirtyEditors,
		...(typeof value.generation === "string" && value.generation.length > 0 ? { hostGeneration: value.generation } : {}),
		busy,
	};
}

function unreachableStatus(dirtyEditors: number, busy: boolean): CediaLifecycleStatus {
	return { phase: "unreachable", accepting: false, runningSessions: 0, remotePaired: false, dirtyEditors, busy };
}

function copyStatus(status: CediaLifecycleStatus): CediaLifecycleStatus {
	return { ...status };
}

/** Build the app/host lifetime state machine without importing Electron. */
export function createCediaAppLifecycle(options: CediaAppLifecycleOptions): CediaAppLifecycle {
	const readDirtyEditors = options.readDirtyEditors ?? (() => 0);
	const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
	const now = options.now ?? (() => Date.now());
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
	const pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
	if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0) throw new RangeError("pollIntervalMs must be a non-negative integer");
	if (!Number.isSafeInteger(maxPollAttempts) || maxPollAttempts < 1) throw new RangeError("maxPollAttempts must be a positive integer");
	if (!Number.isSafeInteger(pollTimeoutMs) || pollTimeoutMs < 0) throw new RangeError("pollTimeoutMs must be a non-negative integer");

	let current: CediaLifecycleStatus = unreachableStatus(0, false);
	let quitting: Promise<CediaQuitResult> | undefined;

	const publish = (next: CediaLifecycleStatus): CediaLifecycleStatus => {
		current = copyStatus(next);
		try { options.onChange?.(copyStatus(current)); } catch { /* observers cannot break lifecycle ownership */ }
		return copyStatus(current);
	};

	const dirtyCount = async (): Promise<number> => {
		try {
			const value = await readDirtyEditors();
			return normalizeCount(value);
		} catch {
			// A dirty-editor probe is advisory.  If it cannot read, the host state
			// still remains authoritative and the normal quit confirmation applies.
			return 0;
		}
	};

	/**
	 * Read the host lifetime state.
	 *
	 * `ensureHost` is true for a status refresh, which may start the app's host.
	 * The quit path passes false: asking to quit must never start the process it
	 * is about to stop, and an absent host is simply nothing to shut down.
	 */
	const readStatus = async (ensureHost: boolean): Promise<CediaLifecycleStatus> => {
		const dirtyEditors = await dirtyCount();
		try {
			if (ensureHost) await options.gateway.ensure();
			const snapshot = ensureHost || !options.gateway.peek
				? await options.gateway.lifecycle()
				: await options.gateway.peek();
			const normalized = normalizeSnapshot(snapshot, dirtyEditors, current.busy);
			if (normalized) return publish(normalized);
			// A gateway may retain a stale descriptor after its process disappears.
			// A missing/invalid snapshot is never treated as a healthy host.
			try { options.gateway.reliable(); } catch { /* classify as unreachable below */ }
		} catch {
			// The app can still quit when its host is unavailable; it has no host
			// shutdown work to perform in that state.
		}
		return publish(unreachableStatus(dirtyEditors, current.busy));
	};
	const refresh = (): Promise<CediaLifecycleStatus> => readStatus(true);

	/**
	 * The host removes its descriptor and leaves `lifecycle.json` with phase
	 * `stopped` before the process exits, so a host that disappears immediately
	 * after acknowledging the quit is still provably stopped rather than unknown.
	 */
	const receiptSaysStopped = async (): Promise<boolean> => {
		if (!options.gateway.shutdownReceipt) return false;
		try {
			const receipt = await options.gateway.shutdownReceipt();
			return receipt?.phase === "stopped";
		} catch {
			return false;
		}
	};
	/** A durable `stopped` receipt is authoritative, so publish that state before finishing. */
	const finishFromReceipt = () => {
		publish({ ...current, phase: "stopped", accepting: false, runningSessions: 0 });
		return finish("stopped");
	};

	const finish = (
		outcome: "idle" | "stopped" | "cancelled" | "failed",
		error?: string,
	): CediaQuitResult => {
		const status = publish({ ...current, busy: false });
		return error === undefined ? { outcome, status } : { outcome, status, error };
	};

	const performQuit = async (request: CediaTryQuitOptions): Promise<CediaQuitResult> => {
		publish({ ...current, busy: true });
		const refreshed = await readStatus(false);
		if (refreshed.phase === "unreachable") return finish("idle");

		const needsDecision = (request.confirm ?? true) && (refreshed.runningSessions > 0 || refreshed.dirtyEditors > 0);
		// Close admission before the dialog, not after it: §2.7 requires a deliberate Quit to
		// reject new starts and mutations, including remote ones, so the decision window cannot
		// admit work that the answer is about to ignore.
		let fenced = false;
		if (needsDecision && options.gateway.fence) {
			try {
				const receipt = await options.gateway.fence() as { accepted?: boolean } | undefined;
				if (receipt && receipt.accepted === false) return finish("failed", "The host refused to close admission for the quit decision");
				fenced = true;
			} catch (error) {
				// Asking about a quit that has not closed admission would report a safety the
				// host does not have, so the refusal is the honest outcome here.
				return finish("failed", `Could not close host admission before asking about the quit: ${errorText(error, "fence failed")}`);
			}
		}

		if (needsDecision) {
			let decision: "stop" | "cancel";
			try {
				decision = await options.confirmStopAndQuit({
					runningSessions: refreshed.runningSessions,
					remotePaired: refreshed.remotePaired,
					dirtyEditors: refreshed.dirtyEditors,
				});
			} catch (error) {
				return finish("failed", `Could not confirm application quit: ${errorText(error, "confirmation failed")}`);
			}
			if (decision === "cancel") {
				// §2.7: Cancel reopens admission. A reopen this process cannot confirm is
				// reported, because a silently fenced host would refuse work after the cancel.
				if (fenced) {
					try {
						const receipt = await options.gateway.resume?.() as { accepted?: boolean } | undefined;
						if (receipt && receipt.accepted === false) return finish("failed", "The host did not reopen admission after the quit was cancelled");
						await readStatus(false);
					} catch (error) {
						return finish("failed", `The quit was cancelled but the host did not reopen admission: ${errorText(error, "resume failed")}`);
					}
				}
				return finish("cancelled");
			}
		}

		try {
			const receipt = await options.gateway.quit() as { accepted?: boolean } | undefined;
			if (receipt && receipt.accepted === false) {
				return finish("failed", "The host refused the shutdown request");
			}
		} catch (error) {
			return finish("failed", `Could not request host shutdown: ${errorText(error, "shutdown request failed")}`);
		}

		let lastError = "Host did not stop accepting work before the shutdown deadline";
		const deadline = now() + pollTimeoutMs;
		for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
			try {
				const snapshot = await options.gateway.lifecycle();
				const normalized = normalizeSnapshot(snapshot, current.dirtyEditors, true);
				if (normalized) {
					publish(normalized);
					if (!normalized.accepting) return finish("stopped");
					lastError = "Host is still accepting work";
				}
				else {
					// The host may close its listener the moment it accepts the quit,
					// so an unavailable lifecycle is checked against the durable receipt
					// it writes before exiting rather than being reported as a failure.
					if (await receiptSaysStopped()) return finishFromReceipt();
					lastError = "Host lifecycle became unavailable before it reported stopped";
				}
			} catch (error) {
				if (await receiptSaysStopped()) return finishFromReceipt();
				lastError = `Could not read host shutdown state: ${errorText(error, "lifecycle read failed")}`;
			}
			if (attempt + 1 >= maxPollAttempts || now() >= deadline) break;
			await sleep(pollIntervalMs);
		}
		return finish("failed", lastError);
	};

	return {
		status: () => copyStatus(current),
		refresh,
		tryQuit: (options?: CediaTryQuitOptions) => {
			if (quitting) return quitting;
			const attempt = performQuit(options ?? {});
			const settled = attempt.finally(() => {
				if (quitting === settled) quitting = undefined;
			});
			quitting = settled;
			return settled;
		},
	};
}

export interface CediaShutdownJoinOptions {
	readonly lifecycle: CediaAppLifecycle;
	readonly log?: (message: string) => void;
}

/**
 * The Code-OSS shutdown seam.
 *
 * `ILifecycleMainService.onWillShutdown` hands every listener a `join(promise)`
 * and waits for it before the process exits, which is where Cedia stops its host
 * and leaves the durable `stopped` receipt behind. Shutdown is already committed
 * at this point, so this never prompts and never blocks the exit: a host that
 * cannot be stopped is logged and reported, and the app still quits (plan §2.7 -
 * the failure stays visible and is never presented as a successful Quit).
 */
export function createCediaShutdownJoin(options: CediaShutdownJoinOptions): () => Promise<void> {
	let pending: Promise<void> | undefined;
	return () => pending ??= (async () => {
		try {
			const result = await options.lifecycle.tryQuit({ confirm: false });
			if (result.outcome === "failed") options.log?.(`Cedia host did not confirm shutdown: ${result.error ?? "unknown reason"}`);
			else options.log?.(`Cedia host shutdown: ${result.outcome}`);
		} catch (error) {
			options.log?.(`Cedia host shutdown failed: ${errorText(error, "unknown error")}`);
		}
	})();
}

export interface CediaLoginItemOptions {
	readonly isPackaged: boolean;
	readonly setLoginItemSettings: (settings: { openAtLogin: boolean; openAsHidden?: boolean }) => void;
	readonly log?: (message: string) => void;
}

/**
 * Register the packaged application as a macOS login item (plan §3.C login row).
 *
 * Only a packaged build may register: a development checkout would otherwise
 * install the Electron binary as the user's login item. Failures are reported
 * rather than swallowed, and nothing here touches the macOS Keychain.
 */
export function registerCediaLoginItem(options: CediaLoginItemOptions): { enabled: boolean; reason?: string } {
	if (!options.isPackaged) {
		return { enabled: false, reason: "Not a packaged build; Cedia does not register a development binary as a login item." };
	}
	try {
		options.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
		return { enabled: true };
	} catch (error) {
		const reason = errorText(error, "login item registration failed");
		options.log?.(`Cedia login item was not registered: ${reason}`);
		return { enabled: false, reason };
	}
}

export interface CediaLoginLaunchInput {
	readonly isPackaged: boolean;
	readonly wasOpenedAtLogin: boolean;
	/** A folder, file or protocol argument always opens a window. */
	readonly hasOpenableArguments: boolean;
}

/**
 * Whether this launch opens a work window.
 *
 * A packaged macOS login launch starts Cedia in the background: the host may run,
 * but no work window opens and no task replays (§3.C "Login to macOS", §6.4
 * "Layout restoration / startup"). An explicit argument always opens its window,
 * and a normal launch is unchanged.
 */
export function shouldOpenFirstWindowAtLaunch(input: CediaLoginLaunchInput): boolean {
	if (input.hasOpenableArguments) return true;
	return !(input.isPackaged && input.wasOpenedAtLogin);
}

/**
 * Cedia's quit decision for the main process (plan §2.7, "Deliberate Quit").
 *
 * The Code-OSS lifecycle service asks this before it records a quit and before
 * `onBeforeShutdown` fires, so answering `false` is a real cancel: no window
 * closes and no shutdown starts. A visible answer of `true` lets that same quit
 * continue into the shutdown join, which is where the host actually stops.
 *
 * A host that will not confirm its own shutdown is reported rather than hidden,
 * but it does not hold the application hostage: the quit continues, the window
 * surface shows the failed stop, and the host reaps itself once its parent is
 * gone instead of being reported as a successful Quit (§2.7).
 */
export function createCediaQuitDecision(options: CediaQuitDecisionOptions): () => Promise<boolean> {
	const windowsOpen = options.windowsOpen ?? (() => 1);
	return async () => {
		let open = 1;
		try { open = windowsOpen(); } catch { /* retain the safe default: a window is open */ }
		if (open === 0) return true;
		const result = await options.lifecycle.tryQuit();
		// Only a cancelled prompt stops the quit. `idle`, `stopped` and `failed` all
		// continue it: the first two have nothing left to stop, and a failed stop is
		// reported on the window surface and retried by the shutdown join.
		return result.outcome !== "cancelled";
	};
}
