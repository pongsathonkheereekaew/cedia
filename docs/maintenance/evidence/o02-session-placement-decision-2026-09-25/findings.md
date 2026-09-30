# Session placement stays host-owned: moveSession has no route, switchSession has no link kind — 2026-09-25

This receipt records a decision-and-pin slice with no gap change. O02's `moveSession`
and `switchSession` stood as "OMP owns this SDK service; Cedia has no equivalent
implementation surface". The investigation below splits that verdict in two precise
halves and pins the half that is already true. §10 item 70 owns status. No provider
request was made.

## moveSession: decided, and now pinned by a test

`moveSession(newCwd, targetSessionDir?)` relocates the live session's cwd and
artifacts from inside the runtime (`sessionManager.moveTo`). In Cedia that operation
has no legal executor: the host owns placement end to end (§3.C workspace identity,
worktree dir, session file, incarnation binding, owner endpoint), and a runtime that
moved itself would desync every one of those records with no API to reconcile them.
The route already enforces this — `PATCH /v1/sessions/:id` accepts only `title`,
`archived` and `pinned`, and refuses anything else with `invalid_body` — but no test
pinned the refusal, so a future field addition could silently reopen relocation.

Pinned now: `apps/host/test/http.test.ts` ("a live session cannot be relocated
through the task route: placement stays host-owned") sends `cwd`, `sessionFile`,
`incarnation` and `status` at the route, expects 400 `invalid_body` for each, and
asserts the row is byte-identical afterwards. A `moveSession` equivalent would need
a host-owned move operation with re-derived identity first; until such a design
exists there is nothing to build, and the row stays open by rule rather than by
missing behavior.

## switchSession: scoped, not claimed

`switchSession(sessionPath)` swaps the live runtime to another session file (the
TUI session selector: abort current op, load messages, restore model/thinking).
Cedia carries the user goal differently — the window navigates between tasks that
keep their own runtimes, so no turn is ever aborted to look at another task — but
the coverage gate cannot record that: every SDK link kind (`OMP_SDK_VIA_RPC`,
other-path slash/setting/command, operation links) requires an audited runtime
artifact Cedia sends, and task navigation is window-local with none. Settling it
needs either a new window-local link kind (a gate-philosophy change for the O02
packet to design) or a runtime-visible switch affordance. Neither is started here.

## Triaged in the same pass (surfaces genuinely missing, no change)

- `/btw` + `branchFromBtw`: the ephemeral side-question overlay (branch/copy/escape
  interactions) has no Cedia counterpart; the durable sidechat fork is a different
  persistence semantic, not an equivalent.
- `/tan`, `/omfg`, `/cleanse`, `/loop`, `/guided-goal`: full background agent,
  rule forge, diagnostics workflow, auto-resubmit loop and goal interview all need
  surfaces that do not exist.

## Evidence (this revision and build)

- `bun test apps/host/test/http.test.ts`: 14 pass / 0 fail (incl. the new placement test).
- `bun run check:omp-coverage`: integrity PASS, gap count **40** (unchanged).
- `bun test scripts/lib`: 84 pass / 0 fail.
- `git diff --check`: clean.
