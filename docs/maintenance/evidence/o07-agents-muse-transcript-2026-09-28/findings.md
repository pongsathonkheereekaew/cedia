# O07 Muse subagent transcript finding — 2026-09-28

## Result

An authorized, bounded live check verified model selection and provider auth metadata before
dispatching `/tan` through an isolated Cedia host/OMP session. The exact effective model was
`opencode-go/muse-spark-1.3-contributor`; OMP reported `opencode-go` available and authenticated
without exposing credentials. The real child appeared in the host's OMP roster as a `sub` agent
with parent `Main` and reached `parked`.

The live paid run's completion marker could not be verified and the run stopped before stale-
incarnation and revive transitions. No paid completion/revive claim is made. Subsequent diagnosis
used the existing local canned-SSE `/tan` fixture and identified the implementation defect: OMP
projects CEDIA's roster from its process-global `AgentRegistry`, while the existing transcript RPC
only authorized files remembered by the separate task-subagent observer registry. A real `/tan`
child was present in the former, had a valid persisted JSONL file, but was rejected by the latter
with `Unknown subagent session file`.

The narrow fix lets `get_subagent_messages` authorize an exact child `sessionFile` only when the
same process-global registry currently names it for an agent whose runtime-owned `kind` is `sub`.
It continues to reject an arbitrary path. The local `/tan` regression now compares persisted
JSONL metadata to the projected response: 9 complete lines, 2 message entries, host `nextByte`
21,528 matching the child JSONL byte length, then revive to `idle` with byte-identical command
replay. The fixture used two canned loopback completions and zero provider calls. The diagnostic
preserves only metadata and failure reason in scratch on failure; its JSONL is not copied into the
repository.

## One-turn Muse verification after the fix

The proof runner now records redacted failure metadata (child identity/status/parent, transcript
state/reason, and JSONL byte/line counts) while deleting scratch host/profile/session data during
cleanup. Typecheck and runtime attestation passed before dispatch. Exactly one bounded turn ran on
the exact selected model; no retry was made.

- Model-state readback: `opencode-go/muse-spark-1.3-contributor`.
- Provider metadata: `opencode-go` available and authenticated; no credential material read or
  printed.
- Child `Tan-15906376bbd7a3eb`: OMP kind `sub`, parent `Main`, parked before transcript read.
- Host transcript route returned two messages and contained `SUBAGENT_PROOF_DONE`.
- Revive with a stale incarnation returned HTTP 409 `stale_incarnation` and created no durable
  command receipt.
- Owner revive returned `{available: true, revived: true}`. The child became `idle`; transcript
  projection before/after was identical, proving revive did not start an unrequested turn.
- Exactly one Muse worker turn was dispatched. No retry, purchase, top-up, login, package, Keychain,
  Login Item, relay, signing or device action occurred.

The independent `bun scripts/omp-agents-smoke.ts` also passed after the runtime refresh.

## Runtime provenance

- OMP `18.1.18`; source verified.
- Source revision `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`.
- Refreshed source tree `a26d0a50f37e654336b8e481663b9ab6986207a6`.
- Launcher SHA-256 `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`.
- Consolidated patch SHA-256 `f1c67b9f3b801ff551ac3c1b50551da78234ff6d1806d98a40d9d9161c76edb4`.
- Patch manifest SHA-256 `cec59519303bfed686acafffd594798dab714550744a42a712e23573c40da49e`.
- Bun SHA-256 `35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5`.
- Native binary SHA-256 `05774ec09950a150b7c1cce63359bd26ed6d3eecc44a6261e09e9403371e7869`.

## Verification after the fix

- `cd upstream/omp && bun test packages/coding-agent/test/rpc-subagents.test.ts` — 12 passed.
- `bun scripts/omp-agents-parked-proof.ts` — passed: child file has 9 complete JSONL records
  including 2 messages; host returns 2 messages at offset 0, `nextByte` equals the 21,528-byte
  file size, revive restores `idle`, replay is byte-identical; 2 fixture completions, 0 provider
  calls.
- `bun scripts/omp-agents-smoke.ts` — passed on refreshed OMP 18.1.18.
- `bun test apps/host/test/omp-agents.test.ts` — 11 passed.
- `bun run typecheck` — passed.
- `attestOmpRuntime` — `sourceVerified: true`, source tree
  `a26d0a50f37e654336b8e481663b9ab6986207a6`.
- `bun run typecheck` — passed immediately before the one-turn live proof.

## Next diagnostic

The initial paid-run scratch files were removed by that runner before diagnosis. The later fixture
retained redacted failure metadata and found the decisive RPC rejection. The post-fix Muse turn
then verified completion, stale refusal and revive on the attested runtime. This lifecycle slice is
now evidenced; broader O07 acceptance, packaged presentation and remaining F rows stay open.

O07 and F remain open. No package, Keychain, Login Item, relay, signing or device action was used.
