# Computer Use check: consent principles mapped, driver out — 2026-09-26

Compares upstream's Computer Use qualification doc
(`docs/computer-use-cua/README.md` at release `a33435c`, ref verified)
against CEDIA's O10 tab-driving scope. No product code changed; no gap
change (stays **2**: `switchSession`, `browser-relay`). §10 item 70 owns
status. No provider involvement.

## Scope boundary (not a port)

Upstream drives the native desktop (Cua driver + AppSnap grants,
foreground/background ownership, per-app reservations, Spaces rules). CEDIA
drives only browser tabs over a loopback CDP endpoint: no desktop input, no
AppSnap surface, no second browser engine, `--remote-debugging-port`
explicitly rejected. The driver, flavor packaging and TCC material stay out
entirely.

## Consent principles already held (test-pinned, current tree)

- Explicit per-thread attach behind a confirm; a declined confirm does
  nothing; detach clears steering (`browser-agent-attach-bar`, incl. relay
  and tools-disabled warnings prepended to the confirm).
- Thread switch re-steers to the new thread's live endpoint or clears when
  nothing is attached; split view always clears without asking
  (`browser-steering-guard`) — the no-silent-re-arm half of upstream's
  "a new task ends permission" rule.
- At-most-one-thread-drivable isolation (packaged proof) mirrors exclusive
  ownership at CEDIA's narrower scope.

## Open (recorded, not claimed)

- Drain semantics for interrupting an in-flight CDP evaluation
  (upstream: active native mutations drain before input resumes) — CEDIA
  has close/thread/owner invalidation but no stated drain rule; needs a
  decision with the O10 driving vertical.
- Model-driven tool use of the endpoint and the `browser-relay` CLI row
  stay open as before.

## Proof

- `bun test` attach-bar + steering-guard suites: 15 pass, 0 fail
  (34 expects), this turn.
- `git diff --check`: clean.

## Preserved

- D1–D5, deferred voice, `switchSession` open, single OMP
  execution/transcript/auth owner. Pin unchanged. Nothing committed;
  uncommitted tree preserved.
