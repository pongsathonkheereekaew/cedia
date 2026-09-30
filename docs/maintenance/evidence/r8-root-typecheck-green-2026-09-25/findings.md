# The root typecheck is green: 10 pre-existing errors to 0 — 2026-09-25

This receipt records a typecheck-gate repair. `bun run typecheck` carried 10
errors recorded as pre-existing since the checkpoint. Nine were one environmental
cause and one was a real (harmless) test typing bug; all three fixes are below.
§10 item 70 owns status. No provider request was made.

## What was wrong

- Nine errors came from `apps/macos/test/*.test.ts` importing vendor sources
  relatively (`../agent-window/vendor/...`), which drags those files into the
  root program without the vendor tsconfig: `~/nativeApi` unresolvable (2) and
  `window.nativeApi`/`desktopBridge` unknown (7). The isolated vendor program
  typechecks the same files cleanly, so the code was never wrong — the root
  program was missing the vendor's resolution rules.
- One error was real: `apps/macos/test/state.test.ts` built its events array
  without a contextual type, so inference produced optional-undefined members
  that fail the `Json` index signature.

## What changed

- `tsconfig.json`: `baseUrl: "."` plus a `~/*` path mapping mirroring the
  agent-window tsconfig (verified no bare import elsewhere can be shadowed by
  the new baseUrl fallback). Only the previously-unresolvable prefix is mapped;
  `@synara/*` keeps resolving through the existing symlinks.
- New `apps/macos/vendor-window.d.ts`: the `declare global` Window half of the
  vendor `vite-env.d.ts` for the root program (the vite/client half is
  intentionally not repeated). Optional props only; additive and inert at runtime.
- `apps/macos/test/state.test.ts`: the events array is annotated
  `SessionEvent[]`, so literals check contextually instead of inferring
  optional-undefined unions. No behavior change (17/17 pass).

## Evidence (this revision and build)

- `bun run typecheck`: exit 0, zero errors (was 10).
- Isolated checks unchanged green: agent-window `tsconfig.json` exit 0,
  `tsconfig.vendor.json` exit 0.
- `bun test apps/macos/test/state.test.ts apps/macos/test/agent-window-main.test.ts`:
  32 pass / 0 fail.
- `git diff --check`: clean.
