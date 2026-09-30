/**
 * Cedia's qualified launcher decision for an `omp` verb (plan §8.2 O08).
 *
 * The audit records every CLI verb OMP ships. Cedia does not reimplement them and must not pretend
 * to own them; what it owns is the *path*: one launcher that resolves the pinned runtime, refuses
 * to start a second executor for a session somebody already owns, and states exactly why it
 * refused instead of killing or adopting anything.
 *
 * This module is the decision only - no process is started here. `scripts/cedia-omp.ts` acts on it,
 * and the packaged app ships that launcher beside the bundled runtime.
 */
import { probeCediaOwner, type CediaOwnerAttachment } from "./owner-endpoint.ts";

/** Verbs this launcher can answer from a live owner instead of running anything (O08's broker). */
export const CEDIA_OWNER_BROKERED_VERBS: Readonly<Record<string, true>> = {
  /** The owner's own uptime and identity: the smallest useful answer, and the one that proves a path. */
  status: true,
};

export function isCediaBrokeredVerb(verb: string): boolean {
  return Object.prototype.hasOwnProperty.call(CEDIA_OWNER_BROKERED_VERBS, verb) && CEDIA_OWNER_BROKERED_VERBS[verb] === true;
}

export type CediaCliDecision =
  /** Run the pinned runtime with these arguments. */
  | { readonly action: "run"; readonly reason: string }
  /** Ask the live owner instead of starting anything. */
  | { readonly action: "attach"; readonly attachment: Extract<CediaOwnerAttachment, { state: "attached" }>; readonly reason: string }
  /** Do nothing and say why. The caller exits non-zero. */
  | { readonly action: "refuse"; readonly code: string; readonly reason: string };

/**
 * Launch flags that choose or attach a session.
 *
 * Forwarding one of these while somebody already owns the session is how a second executor gets
 * started by accident, so they are the flags that meet the ownership rule. Every other audited
 * flag configures the run (models, prompts, tools, printing) and is passed through untouched.
 *
 * Taken from the dated audit's own launch-flag list, not invented: `--session`, `--resume`/`-r`,
 * `--session-dir`, `--fork` and `--continue`/`-c`.
 */
export const CEDIA_SESSION_OWNING_FLAGS: ReadonlySet<string> = new Set([
  "--session", "--session-dir", "--fork", "--resume", "-r", "--continue", "-c",
]);

export function cediaOwnershipFlag(args: readonly string[]): string | undefined {
  return args.find(argument => CEDIA_SESSION_OWNING_FLAGS.has(argument.startsWith("--") || argument.startsWith("-") ? argument.split("=", 1)[0]! : argument));
}

export interface CediaCliDecisionInput {
  readonly verb: string;
  /** Every argument after the verb, forwarded to the pinned runtime unless ownership refuses it. */
  readonly args?: readonly string[];
  /** The session directory to respect, when the caller named one. */
  readonly sessionDirectory?: string;
  readonly timeoutMs?: number;
}

/**
 * Decide what a `cedia-omp <verb>` invocation should do.
 *
 * With no session named there is nothing to conflict with, so the verb runs. With a session named,
 * the owner endpoint decides: a live owner means this verb must not start a second executor, a
 * record that is stale or names something else is refused as-is, and only an absent owner runs.
 */
export async function decideCediaCliInvocation(input: CediaCliDecisionInput): Promise<CediaCliDecision> {
  if (input.sessionDirectory === undefined) {
    return { action: "run", reason: "No session directory was named, so this verb cannot conflict with a running owner." };
  }
  const attachment = await probeCediaOwner(input.sessionDirectory, { timeoutMs: input.timeoutMs });
  switch (attachment.state) {
    case "absent":
      return { action: "run", reason: "No owner has published an endpoint for this session, so this verb runs the pinned runtime." };
    case "attached": {
      // A flag that picks or attaches a session would start a second executor for work somebody
      // already owns, whatever the verb is, so it is refused before the verb is even considered.
      const owningFlag = cediaOwnershipFlag(input.args ?? []);
      if (owningFlag !== undefined) {
        return {
          action: "refuse",
          code: "owner_active",
          reason: `\`${owningFlag}\` would start or attach a second executor while pid ${attachment.identity.pid} owns this session. Cedia refuses it rather than racing the running owner.`,
        };
      }
      if (isCediaBrokeredVerb(input.verb)) {
        return { action: "attach", attachment, reason: `Cedia brokers \`${input.verb}\` through the running owner instead of starting a second executor.` };
      }
      return {
        action: "refuse",
        code: "owner_active",
        reason: `An OMP owner (pid ${attachment.identity.pid}) is already running this session, and Cedia does not broker \`${input.verb}\`. Stop that task or use a verb Cedia brokers (${Object.keys(CEDIA_OWNER_BROKERED_VERBS).join(", ")}).`,
      };
    }
    case "stale":
      return {
        action: "refuse",
        code: "owner_stale",
        reason: `A record for this session names an owner that is not there (${attachment.reason}). Cedia does not delete the record or start a replacement; resolve the session from Cedia and retry.`,
      };
    case "conflict":
      return {
        action: "refuse",
        code: "owner_conflict",
        reason: `Cedia cannot prove who owns this session: ${attachment.reason}`,
      };
  }
}
