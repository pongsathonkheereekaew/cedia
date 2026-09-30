/**
 * Slash commands the pinned OMP runtime cannot run headless.
 *
 * The audit's `surfaces` say rpc/acp for these, but live probes — provider-free endpoint,
 * virtual terminal negotiated exactly as the Cedia host does it — time out with outcome
 * unknown, so sending one wedges the turn instead of running anything. Declaring them once
 * here is what stops the coverage gate, the Mac task surface and the phone from drifting
 * apart: the gate reads this list for its slash exception table and the task state reads
 * it to keep hung commands out of the composer menu (typed text still passes through, so
 * this removes the discoverable path to the wedge, not the wedge itself).
 *
 * This is a behavioral fact about the pinned runtime, not a product decision: re-probe
 * before removing an entry (an upstream fix would silently keep hiding a working command,
 * which is the unsafe side of staleness). Probes live beside the rows they justify under
 * `docs/maintenance/evidence/`.
 */

export interface HeadlessHangSlashCommand {
	/** Base command name, without any subcommand (`move`, not `move <path>`). */
	readonly name: string;
	/** Why headless dispatch hangs, and where the probe is recorded. */
	readonly reason: string;
}

export const HEADLESS_HANG_SLASH_COMMANDS: readonly HeadlessHangSlashCommand[] = [
	// Empty since 2026-09-25: bare `/move` was the only entry and the pinned runtime now
	// answers it headless (usage for bare/missing targets, relocation for existing ones;
	// see evidence/o02-move-headless-answered-2026-09-25/). The list, the gate exception
	// table and the composer-menu funnel stay wired so the next proven hang has a home.
]

/** Whether a composer-menu row names a command known to hang headless. Matches the base name, so `move <path>` rows go with `move`. */
export function isHeadlessHangSlashCommand(name: string): boolean {
	const base = name.trim().split(/\s+/, 1)[0] ?? "";
	if (!base) return false;
	return HEADLESS_HANG_SLASH_COMMANDS.some(entry => entry.name === base);
}
