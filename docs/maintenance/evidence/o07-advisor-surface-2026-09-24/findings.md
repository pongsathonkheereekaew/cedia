# The session's advisor is a Cedia surface — 2026-09-24

This receipt records the O07 Advisor slice: the session's own advisor - OMP's second model that
reviews each turn - is projected by the host and rendered in the shared composer strip, with a
control that switches it through the runtime's own operation and a view of the transcript the
runtime renders for `/advisor dump` (§8.1's "Native Plan/Goal/AgentHub/Advisor controls are required
for F"). Four SDK records are settled; `/advisor configure` deliberately stays open. §10 item 70 owns
status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned OMP patch regenerated for this slice: manifest sha
  `7066c0a114eac3a26c2e46ec934130b5850b782036cfd92c3c2962319844c955`, runtime rebuilt with
  `bun scripts/prepare-omp-runtime.ts` (`omp/18.1.18`).
- Runtime: `packages/coding-agent/src/modes/rpc/cedia-advisor-bridge.ts` (new),
  `.../rpc/{cedia-capability-bridge.ts,rpc-mode.ts,rpc-types.ts}` and
  `test/cedia-capability-bridge.test.ts`.
- Cedia: `apps/host/src/{omp-advisor.ts,service.ts,router.ts}`, `apps/host/test/omp-advisor.test.ts`,
  `apps/macos/agent-window/src/cedia-adapter.ts`, vendor `lib/serverReactQuery.ts`,
  the new `components/chat/CediaAdvisorSurface.tsx` and its mount in `components/ChatView.tsx`,
  `apps/macos/agent-window/test/cedia-advisor*.test.*`.
- Gate and proof: `scripts/lib/omp-coverage.ts`, `scripts/check-omp-coverage.ts`,
  `scripts/omp-advisor-smoke.ts` (new), `scripts/omp-capabilities-smoke.ts`,
  `packages/omp-adapter/test/cedia-capabilities.test.ts`.

## What changed

- **The advisor is read, never imitated.** Three registered operations join the runtime's capability
  table (O07, session scope, controller principal): `advisor.get` answers
  `{ enabled, active, configured, model?, contextWindow, contextTokens, tokens, cost, messages,
  advisors[] }` from the session's own `getAdvisorStats`/`isAdvisorEnabled`; `advisor.set` switches
  through `setAdvisorEnabled`, the same call `/advisor on|off` makes; `advisor.history` answers the
  transcript `formatAdvisorHistoryAsText` renders, bounded to 128 KiB with `truncated` named. A model
  is reduced to `provider/id/name`: the runtime's full model object never crosses the wire.
- **Owner-only host routes.** `GET /v1/sessions/:id/advisor`, `POST` (`{ op: "set", enabled }`, the
  existing durable idempotent command envelope) and `GET /v1/sessions/:id/advisor/history`. Strict
  parsers: a shape the host does not recognise is `unavailable` with a reason, not a half-parsed
  snapshot; a session with no runtime (or a runtime without the bridge) is `unavailable` and starts
  nothing; a malformed answer is ignored rather than guessed.
- **The strip keeps the runtime's own words.** The composer panel shows `Advisor off` / `Advisor on ·
  <model or advisor count>` / the runtime's exact sentence `Advisor setting enabled, but no model is
  assigned to the 'advisor' role.`, the session's context/token/cost/message figures, a toggle, and a
  transcript action. Per-advisor rows render only while the runtime reports the advisor actually
  running, each with its own status string verbatim - no invented health word, no percentage.

## Verification

| Command | Result |
|---|---|
| `bun scripts/omp-advisor-smoke.ts` | every check OK against the prepared runtime: a fresh session reports the advisor off with no roster; the switch turns it on and answers `enabled: true, configured: true, active: false` (the fixture assigns no `advisor` role model - the runtime's own honest answer rather than a fabricated success); the transcript read answers `text: null` with no running advisor; the switch turns it off again; `advisor.set` without `enabled`, `advisor.get` with a payload and `advisor.history` with an unknown field are each refused; then over the host routes: `unavailable` with a reason before any runtime, a live snapshot, a switch answered with the post-change snapshot, a replayed `commandId` answering the recorded outcome, `text: null` from the history route, an unknown body field refused 400 before any runtime call, 401 without the owner token, and `unavailable` again after a stop |
| `bun test apps/host packages/omp-adapter` | 363 pass, 0 fail |
| `bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib` | 1212 pass, 0 fail |
| `bun test apps/macos/agent-window/test` | 192 pass, 0 fail |
| `bun run --cwd apps/macos/agent-window typecheck` | pass |
| `bun run check:types` (runtime package) | clean |
| `bun scripts/omp-capabilities-smoke.ts` | every check OK; the available-row list now carries `advisor.get`, `advisor.set`, `advisor.history` |
| `bun run check:omp-coverage` | integrity PASS, 1041 audited records, 20 descriptors, gaps 122 -> 118 |
| `bun run typecheck` | 10 pre-existing errors, all in the vendor tree's `~/nativeApi` alias and `apps/macos/test/state.test.ts`; none in this slice's files |
| packaged run: `build:agent`, `CEDIA_HOST_NODE=… package:mac`, `check:packaged` | `Cedia.app` rebuilt and every `check:packaged` row OK |
| packaged window (live runtime) | with a real session started: the strip rendered `Advisor off` / `Turn advisor on` / zeroed counters; clicking it switched the **real** runtime on - `Advisor on · openai-codex/gpt-5.6-sol`, `Turn advisor off`, and a `default running` row with `Context tokens: 0 / 272000` - with no provider traffic (0 tokens, 0 messages, no turn); clicking it again returned `Advisor off` with zeroed counters; `Read advisor transcript` with no running advisor rendered the runtime's own sentence `Advisor is not active for this session.` |
| quit drain | the first check 12 s after Quit still saw the host process and a `ready` lifecycle; the authoritative check a minute later found no Cedia app, host or OMP process and `lifecycle.json` `phase: stopped`. The drain was slower than 12 s in this run - recorded rather than claimed as instant |

Records the gate settles (4): `setAdvisorEnabled` (`advisor.set`), `getAdvisorStatusOverview` and
`getAdvisorStats` (`advisor.get`), `formatAdvisorHistoryAsText` (`advisor.history`).

## Defects and decisions found while building

- **The roster outlived the switch.** The packaged run showed `Advisor off` and a `default running`
  row at the same time: the runtime's status map keeps the last known status after a stop, so the
  rows were real data but read as a contradiction. The strip now renders the roster only when the
  runtime reports the advisor actually running, with a regression test for the off-with-roster
  snapshot; the runtime's own status string is still shown verbatim while it is running.
- **`/advisor configure` stays a gap on purpose.** It is the runtime's own TUI editor over
  `WATCHDOG.yml`; editing that file belongs to the IDE and applying it live needs a config-file
  writer Cedia does not have yet. The gate keeps the row open rather than crediting a control that
  does not exist.
- **The capability probe needed the smallest valid payload.** The adapter's "every available row is
  really runnable" test drives each registered operation; `advisor.set` needs its flag, so the probe
  names `{ enabled: false }` the same way it already does for `plan.set`/`goal.set`.

## Not done, and why

- **No advisor review was observed.** The advisor reviews a streaming primary turn; watching it produce
  notes needs a provider turn, which this slice does not run. Its state, spend and transcript access
  are proven; the note-producing path is the same runtime the terminal uses.
- **No advisor spend to display in the packaged run.** The advisor started with 0 tokens and 0
  messages because no turn ran, so the cost columns rendered their zero state.
- **The rest of O07 remains open**: `applyAdvisorConfigs` (`/advisor configure`), Prewalk,
  `get_subagent_messages`, `/agents`/`/hub`/`/loop`/`/guided-goal`, and `goal show`/`goal budget`.
