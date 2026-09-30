# O01: the session-event kinds are classified, and the three recognition gaps are typed — 2026-09-24

This receipt closes the audit's `sessionEvents` requirement: "add a typed event capability
registry and acceptance fixtures for every sourceUnion event; never silently drop the three
recognitionGap events." §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Changed: `packages/protocol/src/index.ts`, `apps/macos/src/state.ts`,
  new `apps/macos/test/session-event-kinds.test.ts`, and `scripts/check-omp-coverage.ts`.

## What the gap actually was

The dated audit compared `agent-session-events.ts`'s union with what the RPC client recognises
and named three kinds it did not: `config_warnings_changed`, `advisor_cost_changed` and
`advisor_yielded`. The pinned source shows why they are the odd ones out - all three are
payload-free:

```ts
| { type: "model_changed" }
| { type: "config_warnings_changed" }
| { type: "advisor_cost_changed" }
| { type: "advisor_yielded" }
```

They are invalidation signals: OMP emits them to say a piece of session state changed (the
config warnings situation, the advisor's cost, that the advisor yielded this turn) and the
client should re-read it. Cedia journalled every frame already, but the renderer had no name for
these three, so they fell through to the generic "unknown frame" row: visible, but not
recognised, and nothing could react to them.

## What changed

- `CEDIA_SESSION_EVENT_KINDS` is Cedia's typed registry of all 28 kinds the pinned union
  declares, with `CEDIA_SESSION_EVENT_SIGNALS` naming the three payload-free ones and
  `isCediaSessionEventSignal` as the guard the reducer uses. The registry is Cedia's own list,
  not a copy of OMP's source: it exists so an unclassified kind is reported rather than absorbed.
- The reducer recognises the three by name: the signal becomes a bounded, typed
  `sessionSignals` entry (oldest first, 20 kept) and the transcript row stays in place with its
  own words ("Config warnings changed", "Advisor cost changed", "Advisor yielded"). Nothing is
  dropped, and nothing is hidden.
- An unrelated unknown frame keeps the documented generic path, so recognition is by name and not
  by "some frame arrived".
- `scripts/check-omp-coverage.ts` now decides an `event` record from the registry instead of the
  audit's dated `recognitionGap` list. A kind the registry does not classify stays a gap whose
  reason names the registry; the audit's list is kept only as context in that reason.

## Verification

```
bun test apps/macos/test/session-event-kinds.test.ts     # 4 pass, 0 fail, 96 expect() calls
bun run check:omp-coverage                               # 950 gaps (was 953); no event gap remains
bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib
                                                         # 1107 pass, 0 fail
bun run typecheck                                        # same 10 pre-existing errors, none new
git diff --check                                         # clean
```

The fixture file is the acceptance set the audit asked for. It asserts the registry equals the
audit's `sourceUnion` exactly (so drift fails a test, not just the gate), applies a frame of every
one of the 28 kinds and pins each one's outcome through the production guard
(`isCediaSessionEventSignal`), checks the three signals' order, labels and 20-entry bound, and
proves an unrelated unknown name still takes the generic path.

## Not done here

- This is typed recognition, not a rendered advisor/cost/warning surface. The signals are
  available to a surface with their kind and position; no control draws an advisor-cost readout
  or a config-warning banner yet, and O01's remaining presentation work is separate.
- The other 25 kinds are classified (registry plus named row) but not individually typed into
  richer state: plan/goal, compaction, retry and todo events still land as named rows, which is
  the O07/O09 work the packets own.
