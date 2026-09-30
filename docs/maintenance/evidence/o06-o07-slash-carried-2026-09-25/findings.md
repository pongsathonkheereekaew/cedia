# SDK operations carried by reachable slash commands, with their own gate mechanism — 2026-09-25

This receipt records a two-row settlement plus the mechanism it required: `armPrewalk`
(O07) and `getAsyncJobSnapshot` (O11) have no audited RPC command and no registered
`cedia_control` operation, but the terminal commands performing them — `/prewalk` and
`/jobs` — are audit-reachable over the prompt path, so Cedia's composer already carries
both operations by sending the slash text. Forcing either row onto an unrelated audited RPC
would have been a false carrier, so the gate gains a third SDK link kind instead of
reusing a wrong one. §10 item 70 owns status. No provider request was made and no model
turn was run.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54` with this slice applied;
  the tree is dirty by design (no commit, push or publish was made).
- Pinned runtime: OMP `18.1.18`. No upstream change in this slice; `dist/omp/omp` not
  re-prepared.
- Changed for this slice: `scripts/lib/omp-coverage.ts` (`OmpSdkViaSlash` table plus
  `verifyOmpSdkViaSlash`), `scripts/lib/omp-coverage.test.ts` (unit plus shipped-table
  tests), `scripts/check-omp-coverage.ts` (map, row branch, presentations, verifier
  fold-in); this receipt; `docs/maintenance/CEDIA-PLAN.md` (item 70 row).

## What changed

- **New link kind** (`OMP_SDK_VIA_SLASH`): `{name, slash}` pairs settled while the audit
  marks the command reachable over `rpc`/`acp` and the adapter still sends the prompt
  path — the same two facts that settle the slash row itself, re-checked on every run. The
  verifier reports orphan (SDK name gone from the audit), unclassified (slash no longer
  reachable, or prompt path gone), or source-missing (adapter unreadable).
- **Two rows**: `armPrewalk` via `/prewalk` (resolves `@smol`, checks auth, calls the
  session's own `armPrewalk`; no audited RPC names the operation) and
  `getAsyncJobSnapshot` via `/jobs` (calls the session's own snapshot reader and renders
  running/recent rows; same position).
- **Deliberately not settled**: `getPrewalkState` (status-line only, no slash outputs it),
  `getCodeModeDirectToolNames`/`getEvalPreludes` (live getters with no reader of any
  kind), `refreshMCPTools` (needs discovery-owned arrays), and every TUI-only slash whose
  operation has no prompt-path carrier.

## What was observed

- `bun run check:omp-coverage`: integrity PASS, 1,041 audited records with 1,041 Cedia
  mappings, live `omp/18.1.18`; gap count **45** (was 47). `--list-gaps` no longer names
  either row.
- `bun test scripts/lib`: 84 pass / 0 fail, including the new accept/refuse/shipped-table
  tests for the mechanism itself.
- `git diff --check` clean.

## Still open (not claimed)

- No per-command live run of `/prewalk` or `/jobs` over the prompt path exists; the rows
  rest on audit reachability plus the generic prompt-path proof (`omp-slash-smoke.ts` and
  the adapter dispatch test), exactly like the 143 settled slash rows.
- O07 keeps `getPrewalkState`, `/agents`, `/guided-goal`, `/hub`, `/loop`; O06 keeps
  code-mode getters, `refreshMCPTools`, `/extensions`, `status`, dynamic tools.
