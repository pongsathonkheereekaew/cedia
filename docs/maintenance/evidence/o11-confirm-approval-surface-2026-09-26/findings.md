# O11 confirm-approval surface (broker confirm frames render) — 2026-09-26

Closes the rendering gap the paid-probe receipt named: `confirm`-method broker
frames projected to token-only `approval` settlements with no `approval.requested`
activity, so the bundle rendered nothing clickable and the turn stalled with no path
to an answer. No provider, no model, no spend. W/N out of scope per owner. §10 item 70
owns status.

## Done

- `apps/macos/agent-window/src/cedia-adapter.ts`: new `pendingApprovalActivities`
  beside `pendingInputActivities` — a `confirm` row with a title synthesizes one
  `approval.requested` activity (`requestKind: file-change`, detail = title plus the
  request message bounded at 2000 chars with a `[truncated]` marker). The only in-tree
  producer of `confirm` frames is the native editor bridge
  (`apps/host/src/service.ts`, "Allow this editor change?"), so the kind is exact,
  not a guess. The bundle's own approval UI answers through the already-proven
  `thread.approval.respond` boolean path; no respond-side, host, runtime, or vendor
  change. No other broker field leaves the journal (#1305 holds).
- `apps/macos/agent-window/test/adapter.test.ts`: two tests — synthesized shape,
  settlement pairing, secret/`params` non-forwarding; and the adapter projection run
  through the vendor's own `derivePendingApprovals`, yielding one pending file-change
  approval (adapter-to-bundle proof with zero provider involvement).

## Verified (current tree, no provider calls)

- `bun test apps/macos/agent-window/test/adapter.test.ts`: 53 pass, 0 fail (was 51).
- Falsification: with only the adapter hunk stashed, the 2 new tests fail; popped, green.
- `bun test apps/macos/agent-window/test`: 388 pass, 0 fail, 74 files.
- `bun run --cwd apps/macos/agent-window typecheck`: 1 error, pre-existing and untouched —
  untracked O06 vendor file `CediaToolCatalogSurface.tsx` (`CediaExtensionsAnswer`
  shape); zero errors in the touched files.

## Still open (no gap change, stays 2)

- A live click on a rendered confirm approval (native editor-change request during a
  real turn, answered through `thread.approval.respond`) has not been observed; probe 11
  proved the same path for `select`. `switchSession` and `browser-relay` untouched.

## Preserved

- D1–D5, deferred voice, W/N deferred per owner. Nothing committed.
