// FILE: localIdentity.ts
// Purpose: Local-only identity defaults for Settings → Profile. The upstream stats
// RPC (home-dir basename, default handle, initials) is not backed in Cedia, so
// the panel seeds name/handle/initials from stable local values instead of a
// server round-trip. Name/handle edits still persist via the profile hooks.
// Layer: web profile feature.

import { normalizeHandle, toDisplayName } from "./profileFormatting";

function localBasename(): string {
  try {
    const stored =
      typeof window !== "undefined" ? window.localStorage.getItem("synara:profile:name:v1") : null;
    const trimmed = (stored ?? "").trim().replace(/^"+|"+$/g, "");
    if (trimmed.length > 0) return trimmed;
  } catch {
    // localStorage may be unavailable — fall through to the default.
  }
  return "Cedia";
}

export interface LocalIdentity {
  /** Friendly display name. */
  readonly name: string;
  /** Normalized @handle. */
  readonly handle: string;
  /** Avatar fallback initials derived from the name. */
  readonly initials: string;
}

export function deriveIdentity(): LocalIdentity {
  const name = toDisplayName(localBasename());
  const handle = normalizeHandle(
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 30) || "cedia",
  );
  const initials = name
    .split(" ")
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  return { name, handle, initials };
}
