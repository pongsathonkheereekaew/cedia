# Live Muse turns unblock the approval/tool loop — 2026-09-30

## Result

PASS (live, provider-backed). With an answering model, the native turn path
works end-to-end through the Cedia host on isolated scratch state:

- Pong: `opencode-go/muse-spark-1.3-contributor` set via `set_model`
  (completed), single-word pong prompt, assistant answered `pong` in ~5 s,
  turn completed, session idle. No fixture, no loopback.
- Tool loop: same model asked to list the working directory with a read-only
  tool then reply `done`. Event journal shows `message_update` streaming,
  `tool_execution_start` → `tool_execution_end`, assistant replied `done`,
  `turn_end` terminal, `cedia_turn_boundary`, `agent_end`, `prompt_result`,
  `session_settled`. The read tool needed no permission prompt; a write turn
  with an approval click is still open.

## Runtime evidence

- Runners (new, isolated scratch host + real `dist/omp/omp` 18.4.3, OMP-native
  auth from a scratch copy of the user OMP config; nothing written to the real
  config, scratch deleted after each run):
  `bun scripts/omp-muse-catalog-proof.ts` (read-only catalog list, 136 rows),
  `bun scripts/omp-muse-pong-proof.ts` (set_model + one prompt, 120 s deadline,
  abort on timeout).
- Live catalog confirms all muse rows `available: true`, including
  `opencode-zen/muse-spark-1.3-contributor-free` and
  `opencode-go/muse-spark-1.3-contributor`.
- Negative result retained: the free row
  (`opencode-zen/muse-spark-1.3-contributor-free`) stayed silent — turn queued
  with zero assistant text at the 120 s deadline, aborted to `needs_continue`,
  same signature as the union-alpha free-tier outage. Catalog `available: true`
  does not imply upstream health.

## Limits

This unblocks but does not close the live-turn proofs: the on-screen composer
turn with a permission prompt and approve/deny click (items 1, 32), live
streaming in-place verification (33), attachment-carrying turn (34), visible
tool output (35), and the F semantic/dynamic packets still need their own
packaged/device receipts. Provider spend: trivial text turns on the
user-approved unlimited Muse row only. D/W/N/F acceptance remains open.
