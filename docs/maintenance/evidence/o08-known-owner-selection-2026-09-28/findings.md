# O08 known CEDIA owner selection — 2026-09-28

## Implemented

The owner-only `GET /v1/owners` route lists persisted CEDIA tasks and probes each task's local
owner endpoint without starting, stopping or deleting a process. It returns at most 500 rows,
probes with up to eight concurrent workers, and projects only the task ID, title, archived flag,
owner state, a bounded reason for stale/conflict states, and the attached owner's safe identity
fields. Endpoint token, socket, session file and cwd stay on the host. Controller tokens receive 403.

The Agent Window's Task controls show known CEDIA task owners as attached, absent, stale or
conflicting, with archived and truncated states visible. An explicit Attach action is shown for a
selected, live, non-archived row. The adapter re-reads the owner list before posting to the
existing `POST /v1/sessions/:id/start` path; the host re-probes identity and claims the lease at
that final gate. A successful attach navigates to that task. Failed attach displays the host error
and does not navigate. The renderer strictly parses the bounded response.

## Verification

- `bun test apps/host/test/service.test.ts apps/host/test/omp-owner-attach.test.ts`: 49 passed,
  320 assertions. The new route case checks attached/absent/stale/conflict projections, no endpoint
  secrets or paths, owner-only access and refusal of query/body input. The suite also exercises
  live owner adoption without a second process.
- `bun test apps/macos/agent-window/test/cedia-owner-surface.test.tsx`: 5 passed, 18 assertions.
  The cases pin response parsing, read-before-start order, render states, Attach eligibility and
  query refresh configuration.
- `bun run --cwd apps/macos/agent-window typecheck` and `bun run typecheck`: passed.
- Scoped `git diff --check`: passed.

The application list covers only persisted CEDIA tasks. Independently started CLI/TUI owners still
have no published endpoint or discovery path. This is source/fixture verification, not a packaged
UI capture, full owner migration, D or F acceptance. The CEDIA checkout remains dirty; there was
no commit, push, package, Keychain, Login Item, provider, relay or device action for this slice.
