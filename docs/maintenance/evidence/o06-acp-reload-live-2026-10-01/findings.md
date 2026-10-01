# O06 ACP live reload proof (standalone binary) — 2026-10-01

## Result

PASS. `bun scripts/omp-acp-reload-proof.ts` drives the compiled
`dist/omp-standalone/omp acp` server over stdio JSON-RPC with a fixture
TypeScript extension: generation A at startup → B atomically replaces A →
a second live session makes reload refuse with the parking error → closing
the sibling lets reload proceed (A restored, B reloaded) → throwing
candidate fails with B intact and no partial registration → removal clears
the fixture with builtins surviving. One OS process throughout; the only
prompts ever sent are `/reload-plugins` (local-only), so provider inference
is impossible by construction.

This qualifies the ACP `/reload-plugins` path live plus the shared-registry
parking boundary — both were source/unit-only before (the interim refusal
had "source and typecheck coverage but no dedicated live-child reload
probe"). Model options over ACP are open-time snapshots (no push update
exists), so post-reload model reads use fresh `session/new` configOptions;
command catalogs push live via `available_commands_update`.

## Runtime evidence

- OMP 18.4.3 standalone binary, scratch HOME/profile/cwd, baseline
  `models.yml`, fixture via `--trusted-extension`, dead-port provider URLs.
- Command swap, rollback, removal and the refuse→close→proceed cycle all
  observed on the wire; `stopReason: end_turn` with no protocol error on
  successful reloads; `-32603` with explicit details on the candidate
  failure and the parking refusal.
- No product code changed; scratch dirs removed in `finally`.

## Limits

Covers one process, one fixture, command-catalog assertions plus open-time
model snapshots. Interactive TUI reload, provider inference turns, and the
packaged swappable-extension path (recorded blocked in the companion
boundary receipt) remain open. Tool-catalog reads have no ACP wire surface;
they stay covered by the RPC-UI smoke and unit tests.
