# O06 interactive live reload proof (VirtualTerminal) — 2026-10-01

## Result

PASS. `bun test scripts/omp-interactive-reload-proof.test.ts` builds a real
session through the production SDK bootstrap, mounts a real InteractiveMode
on a VirtualTerminal, and drives A→B→rollback→removal with B atomically
replacing A, the throwing candidate keeping B with no partial registration,
and removal clearing the fixture — zero provider calls (no prompt text is
ever submitted and the session has no API key; usage cost reads 0).

This qualifies the interactive `/reload-plugins` path live: B-swap and
removal go through the terminal composer exactly like a human operator
(sendInput + Enter through the real composer, `Plugins reloaded.` rendered
in the captured viewport), and the throwing candidate goes through the real
interactive builtin (`reloadTuiPluginState`) with the real session,
including the real shortcut refresh. Per-phase terminal captures and
`result.json` are written under the ignored runtime directory
`dist/interactive-reload-proof/<timestamp>/`.

## Driver notes (verified, reusable)

- Plain `bun <script>` cannot drive the composer: input never submits
  (identical flow passes under `bun test` in ~1.5 s). Write interactive
  probes as test files.
- Type slash text, wait for the echo row, then Enter; a composer-submitted
  slash does not resolve `getUserInput` (stays pending; execution errors
  reject it instead) — poll the live catalog, do not await the input.
- A failing reload submitted through the terminal rejects inside the
  input-controller chain where no harness can contain it (bun fails the run
  even with an `unhandledRejection` listener); route that one phase through
  the real builtin and assert the thrown candidate error plus intact B.
- The rewrite must cross the change-detection tick (~1.3 s settle before
  `/reload-plugins`); removal deletes the file (an empty file is a load
  error, not a removal).
- Over a real PTY the standalone TUI composer ignores plain-keystroke text
  (control keys navigate, model search accepts text) — automation should
  use this in-process path, not PTY keystrokes.

## Limits

One session, one fixture, command-catalog assertions plus usage-cost zero.
Interactive shortcut internals stay unit-covered; provider inference turns,
the packaged swappable-extension path (recorded blocked), and live
shared-source provider replacement remain open.
