/**
 * Cedia's product-policy layer as the runtime reports it (plan §2.8).
 *
 * The rule itself lives in the runtime, because it has to be true where the spend decision is made:
 * a Cedia-controlled process never redeems a saved Codex reset on its own, and it never asks and
 * persists an answer into the owner's shared configuration. This module only reads what the runtime
 * reports - the stored value, the value the session acts on, and the reason they differ - so a
 * surface can say "off, by Cedia" instead of silently rewriting a preference another owner set.
 */
import { OmpClientStateError, type OmpRpcClient } from "../../../packages/omp-adapter/src/client.ts";
import type { CediaUiCommandType, RpcAck } from "../../../packages/omp-adapter/src/types.ts";

export type OmpAutoRedeemMode = "unset" | "yes" | "no";

export interface OmpCreditPolicy {
  readonly guardActive: boolean;
  readonly stored: OmpAutoRedeemMode;
  readonly effective: OmpAutoRedeemMode;
  readonly overridden: boolean;
  readonly reason: string;
}

export class OmpPolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmpPolicyValidationError";
  }
}

/** The only adapter surface this reader needs. */
export type OmpPolicyClient = Pick<OmpRpcClient, "requestCedia">;

function autoRedeemMode(value: unknown, field: string): OmpAutoRedeemMode {
  if (value === "unset" || value === "yes" || value === "no") return value;
  throw new OmpPolicyValidationError(`The runtime answered a credit policy ${field} that is not a Codex auto-redeem mode`);
}

/**
 * Every field is checked, because a half-parsed policy would let a window show "off" for a session
 * that is not actually guarded. A shape the host does not recognise is a refusal, never a default.
 */
export function parseOmpCreditPolicy(value: unknown): OmpCreditPolicy {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new OmpPolicyValidationError("The runtime answered a credit policy that is not an object");
  const row = value as Record<string, unknown>;
  if (typeof row.guardActive !== "boolean")
    throw new OmpPolicyValidationError("The runtime answered a credit policy without saying whether the guard is active");
  if (typeof row.overridden !== "boolean")
    throw new OmpPolicyValidationError("The runtime answered a credit policy without saying whether the stored value was overridden");
  if (typeof row.reason !== "string" || row.reason.length === 0)
    throw new OmpPolicyValidationError("The runtime answered a credit policy without a reason");
  return {
    guardActive: row.guardActive,
    stored: autoRedeemMode(row.stored, "stored"),
    effective: autoRedeemMode(row.effective, "effective"),
    overridden: row.overridden,
    reason: row.reason,
  };
}

/**
 * The credit policy of the live runtime, or `undefined` when it has no capability bridge.
 *
 * A runtime without the bridge is an honest absence: the caller reports that it cannot say, rather
 * than assuming a guard it never observed.
 */
export async function readOmpCreditPolicy(client: OmpPolicyClient): Promise<OmpCreditPolicy | undefined> {
  let ack: RpcAck;
  try {
    ack = await client.requestCedia("cedia_control" as CediaUiCommandType, { operation: "policy.get" });
  } catch (error) {
    if (error instanceof OmpClientStateError) return undefined;
    throw error;
  }
  const data = ack.data;
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new OmpPolicyValidationError("The runtime answered a capability control without a result object");
  const result = (data as { result?: unknown }).result;
  if (result === undefined)
    throw new OmpPolicyValidationError("The runtime answered a capability control without a result");
  return parseOmpCreditPolicy(result);
}
