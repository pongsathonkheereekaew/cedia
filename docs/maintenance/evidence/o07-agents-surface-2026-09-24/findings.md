# The runtime's agent roster and a child's transcript are Cedia surfaces — 2026-09-24

This receipt records the O07 Agents slice. OMP already owned the subagent table and the child
transcript; Cedia now reads both from the runtime's own registry and session file instead of showing
a flat strip with no way into a child's work (§8.2 O07's "Actual OMP agent status/identity"). The
audited RPC command that carries a child transcript (`get_subagent_messages`) stops being an
uncarried command here. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned runtime `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`, prepared as `omp/18.1.18`; this slice
  adds no runtime change (the agents bridge and the registry reader are in the already-pinned patch).
- Cedia: new `apps/host/src/omp-agents.ts`, `apps/host/test/omp-agents.test.ts`,
  `scripts/omp-agents-smoke.ts`, `apps/macos/agent-window/test/cedia-agents.test.ts`,
  `apps/macos/agent-window/test/cedia-agents-surface.test.tsx`; changed
  `apps/host/src/{service,router}.ts`, `apps/macos/agent-window/src/cedia-adapter.ts`,
  vendor `lib/serverReactQuery.ts`, new `components/chat/CediaAgentsSurface.tsx`,
  `components/ChatView.tsx`, `routes/__root.tsx`, `scripts/lib/omp-coverage.ts`.

## What changed

- **The roster is the runtime's.** `agents.get` is already a registered operation; the host reads it
  with a strict parser (an optional parent, activity or session file is carried only when the
  runtime names it) and answers `GET /v1/sessions/:id/agents` owner-only. A session with no runtime
  is `unavailable` with the reason rather than an empty roster.
- **A child's transcript is read through OMP's own paged command.** `get_subagent_messages` is sent
  from `apps/host/src/omp-agents.ts` with the `sessionFile` the roster named, and the host projects
  text-only messages as one concatenated string with a count of the non-text parts, bounded to 50
  messages and 8192 characters, keeping the runtime's `nextByte` untouched so a client pages
  exactly the way the runtime does. A reset, a truncation and a page boundary each carry their own
  flag; an unknown agent, an agent with no session file and an agent the runtime never had are
  refusals with the runtime's own text.
- **The surface shows the hierarchy it is given.** `CediaAgentsSurface` renders the roster with
  child rows indented and labelled `Child of <parent>`, a transcript-less row as a non-interactive
  card labelled `No transcript available`, an empty roster as `Nothing to show`, an unavailable
  roster as only the host's reason, and a selected child's transcript with a reset sentence, a cut
  notice plus `Load more`, and in-place replacement when the runtime answers at the same offset. It
  refreshes on the same thread-activity invalidation the sibling strips use, with no polling.

## Evidence (this revision and build)

- `bun test apps/host` → 304 pass, 0 fail, 35 files (the focused agents suite is 7 pass).
- `bun test apps/macos/agent-window/test` → 208 pass, 0 fail, 47 files.
- `bun scripts/omp-agents-smoke.ts` → 12 `OK` lines against the prepared `omp/18.1.18`: the roster
  read answers the registry's own list, a transcript file is named only when the agent has one, the
  roster read refuses a payload it does not take, an unknown agent and an unknown session file are
  refused with the runtime's own sentence, a session with no runtime reports absence with a reason,
  and the routes are owner-only.
- `bun run check:omp-coverage` → integrity PASS; `get_subagent_messages` is no longer an uncarried
  command and is settled by a named Cedia caller the gate re-reads.

## Limits

- No live subagent run was captured: reaching a child needs a provider turn. The roster the smoke
  reads is the runtime's real registry, and the transcript path is proven for a refusal with the
  runtime's own text; a populated child transcript remains fixture-proven, not run-live.
- No packaged window was captured rendering the roster. The bundle's rendered tests cover it.
