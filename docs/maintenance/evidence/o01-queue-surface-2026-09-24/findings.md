# The queue OMP is holding is a Cedia surface — 2026-09-24

This receipt records the O01 queue slice. OMP holds the submissions the owner makes while a turn is
running; Cedia now reads that list from the runtime itself and can remove from it, so the composer
shows what is waiting and the owner can take work back (§8.2 O01, §2.8's "queue" requirement).
Three SDK records and two slash records are settled by it. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned OMP patch regenerated for this slice: manifest sha
  `6d0f8764711092bf297ec7297113bca693da5b34502c0e0f0655f7a0ba990a7f`, runtime rebuilt with
  `bun scripts/prepare-omp-runtime.ts` (`omp/18.1.18`).
- Runtime (all under `upstream/omp/packages/coding-agent/`): new
  `src/modes/rpc/cedia-queue-bridge.ts`; changed `src/modes/rpc/{cedia-capability-bridge,rpc-mode,rpc-types}.ts`;
  new `test/cedia-queue-bridge.test.ts`, changed `test/cedia-capability-bridge.test.ts`.
- Cedia: new `apps/host/src/omp-queue.ts`, `apps/host/test/omp-queue.test.ts`,
  `scripts/omp-queue-smoke.ts`, `scripts/refresh-omp-patch.ts`; changed
  `apps/host/src/{service,router}.ts`, `apps/host/test/fixtures/fake-host.mjs`,
  `apps/macos/agent-window/src/cedia-adapter.ts`, vendor `lib/serverReactQuery.ts`,
  new `components/chat/CediaQueueSurface.tsx`, `components/ChatView.tsx`, `routes/__root.tsx`,
  `apps/macos/agent-window/test/cedia-queue*.test.*`, `packages/omp-adapter/test/cedia-capabilities.test.ts`,
  `scripts/{omp-capabilities-smoke,lib/omp-coverage,check-omp-coverage}.ts`.

## What changed

- **The queue stays OMP's.** Two registered operations join the runtime's capability table (O01,
  session scope, controller principal). `queue.get` answers the submission list the session already
  holds (`getQueuedMessages`), and `queue.drop` names which end it takes - `last` is
  `popLastQueuedMessage()` (what the terminal's dequeue keybinding does) and `all` is `clearQueue()`
  (the clear action), so the two modes are OMP's own two removals and not a second queue. Both
  refuse a payload with an unknown field before any handler runs, and `queue.drop` refuses a mode
  outside `last|all` by name.
- **The projection is bounded and honest.** A submission becomes its text, whether that text was
  cut (4096 characters, `truncated: true`) and how many images travel with it - never image bytes,
  never a full message object - and at most 50 rows per side are listed. A drop answers `dropped`
  with what it removed, in OMP's own drain order, so a window can put the text back into its draft
  the way the keybinding restores it to the editor; a drop with nothing to remove reports an empty
  `dropped` rather than a silent success. Removing a queued submission never claims to be an
  interruption: OMP's own clear keeps non-user queued messages (advisor cards, hidden goal/plan
  turns) so a continuing stream still receives them.
- **Owner-only host routes.** `GET /v1/sessions/:id/queue` and
  `POST /v1/sessions/:id/queue/drop` (`{ commandId, incarnation, mode }`), routed through the same
  durable command envelope the sibling mutations use, so a repeated command id replays the same
  receipt and cannot drop twice. An unknown query parameter, an unknown body field, a missing
  command id and an unknown mode are typed refusals; the routes are owner-only (401) and an exact
  path with the wrong method is a typed 405. A session with no live runtime is `unavailable` with
  the runtime's own reason and starts nothing.
- **The composer shows it.** `CediaQueueSurface` follows Plan → Progress → Advisor → Agents in the
  composer column: steering and follow-up rows with bounded text, an explicit truncation mark, an
  image count, `Nothing queued` for a real empty queue, an unavailable state that renders only the
  host's reason and no controls, and `Drop last` / `Drop all`. A drop shows what left the queue, and
  a refusal (code restored through the adapter's one error funnel) renders as an alert. The panel
  re-reads on the same thread-activity invalidation the sibling strips use, with no polling.

## Evidence (this revision and build)

- `bun test apps/host packages/omp-adapter` → 377 pass, 0 fail, 3026 expect() calls, 46 files.
- `bun test apps/macos/agent-window/test` → 208 pass, 0 fail, 654 expect() calls, 47 files.
- `bun run --cwd apps/macos/agent-window typecheck` → exit 0.
- `cd upstream/omp && bun test packages/coding-agent/test/cedia-queue-bridge.test.ts packages/coding-agent/test/cedia-capability-bridge.test.ts`
  → 27 pass, 0 fail.
- `bun scripts/omp-queue-smoke.ts` → 15 `OK` lines against the prepared `omp/18.1.18` (the runtime
  answers its own two queue sides, a fresh runtime reports empty queues honestly, a session with no
  runtime reports absence with a reason, the repeated command id replays the same drop receipt, an
  unknown mode is refused before the runtime call, the routes are owner-only), final
  `{"ok":true,"version":"omp/18.1.18"}`.
- `bun scripts/omp-capabilities-smoke.ts` → every check OK; the available table now lists 23
  descriptors including `queue.get` and `queue.drop`.
- `bun run check:omp-coverage` → integrity PASS, 112 audited records without a disposition (was
  117). Settled here: `getQueuedMessages`, `popLastQueuedMessage`, `clearQueue`, and the `/queue`
  slash row; `/drop` was re-read against OMP's own description ("Delete the current session and
  start a new one") and settled against Cedia's task deletion plus the New Chat draft, not against a
  queue operation the command never performed. Nothing was excluded to shrink the number.

## Limits

- No live run put a submission in the queue and dropped it: reaching that needs a provider turn in
  flight, which G0 does not start. The live smoke proves the read path and the empty-drop path
  against the real runtime; a drop with a real queued item is proven by the fixture tests above.
- No packaged window was captured rendering the panel. The bundle's rendered tests cover the panel's
  states; a packaged capture remains open under §10 item 70.
