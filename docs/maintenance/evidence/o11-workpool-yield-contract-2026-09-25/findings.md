# Slice (O11 work-pool yield contract): `get/setWorkPoolYieldItems` as executor-internal plumbing

No new runtime, host or window code. The two remaining O11 SDK rows are the live
pooled-turn yield contract, and every party to that contract is OMP's own machinery:

- The task executor installs the contract at run start from launch options
  (`executor.ts`: `setWorkPoolYieldItems(options.workPoolYieldItems ?? [])`), reinstalls it
  around prompt races, and the pool scheduler clears it when retiring idle workers
  (`workpool.ts`: `setWorkPoolYieldItems([])` — items already terminal, drop the worker
  rather than reusing it with a stale contract).
- The yield tool reads it during a turn (`tools/yield.ts` `#workPoolItems()`) to decide
  which pooled items a turn may submit.
- The setter rebuilds the provider prompt as part of applying (`agent-session.ts`:
  `#workPoolYieldItems = applied` on the serialized transition tail).

No user action corresponds to reading or replacing that contract — a Cedia control
supplying its own items would corrupt what the yield tool enforces — and turn outcomes
already reach Cedia through its turn projection. This follows the `o06-o11-turn-flow`
precedent (quiescence barrier/drain settled the same way). A future work-pool hub surface
(O07 `hub`) would supersede these rows with a real reader rather than inheriting them.

## Changes

- `scripts/lib/omp-coverage.ts`: two `OMP_SDK_DISPOSITIONS` rows
  (`platform_presentation_equivalent` with file+needle evidence in `agent-session.ts`,
  re-read by `verifyOmpSdkDispositions` every run).

## Proof (pinned runtime 18.1.18)

- `bun run check:omp-coverage`: integrity PASS, gap count **37** (was 39), O11 sdk 0 (was 2).
- `bun test scripts/lib` (84 pass).

## Still open in O11

`ssh` (Tailscale-side owner decision, R6) and the `tts` dynamic tool (provider-backed).
O11 async-job and work-pool *views* remain future surfaces; only the contract accessor
pair is settled here.
