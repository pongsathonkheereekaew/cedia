# F: an SDK record is now settled only by a source-verified RPC link — 2026-09-24

The coverage audit's SDK supplement lists 106 in-process `AgentSession` methods. §2.8 forbids
reaching an operation by starting an SDK session alongside the existing one, so those records can
only be settled through a Cedia path over RPC — and until now every one of them carried the same
generic reason. This slice makes the gate prove the path instead. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with this and the other open slices.
- Changed: `scripts/lib/omp-coverage.ts` (the link table and its verifier),
  `scripts/check-omp-coverage.ts` (the SDK rows and the wiring), `scripts/lib/omp-coverage.test.ts`.

## What changed

- `OMP_SDK_VIA_RPC` names, for each settled SDK entry, the audited RPC command that carries the same
  operation. Eight operations qualify today: `prompt`, `steer`, `followUp`, `abort`, `setModel`,
  `setThinkingLevel`, `branch`, `compact`.
- `verifyOmpSdkSourceLinks` refuses three things, and `main` folds its issues into the report:
  a link naming an RPC command the audit does not record, a link whose literal command name no longer
  appears in `apps/macos/agent-window/src/cedia-adapter.ts`, and (as `source_missing`) a link claimed
  while that file cannot be read at all. So a settled SDK row can never be a memory of a call site
  that stopped existing.
- The settled rows carry the adapter as the handler, the Cedia control for the same operation as the
  presentation, and the link test as their test.
- **Verified that the verifier fires.** With `compact`'s link temporarily renamed to an unaudited
  command, `bun run check:omp-coverage` failed:
  `Integrity FAIL: 1 fatal issue(s) … unclassified: compact — SDK link names 'compact_v2', which the
  dated audit does not record as an RPC command.` Restoring the table returned `Integrity PASS`.

## Verification

```
bun test scripts/lib/omp-coverage.test.ts   # 12 pass, 0 fail
bun run check:omp-coverage                  # Integrity PASS; 633 records without a settled disposition (was 641)
bun run typecheck                           # the same 10 pre-existing errors, none new
git diff --check                            # clean
```

The eight settled operations are the ones Cedia's adapter really sends, which the existing adapter
suite already exercises (Send/Steer/Stop, the model picker, thinking level, conversation rewind and
compaction); this receipt adds the proof that the *registry* names them, not a second behavioural
claim about them.

## What this does not claim

- **98 SDK entries remain gaps**, and each is a real operation with no Cedia path: queue contents and
  clearing, session tree/handoff/export, OAuth account selection and reset-credit actions, context
  breakdown/shake/retry/compaction controls beyond what exists, memory backends, Plan/Goal/Vibe/
  Prewalk/Todo/Advisor controls, tool/MCP/skill management, and async job/work-pool/IRC controls.
  They block F until their packets land, and this slice does not shrink that by relabelling.
- The link table is a claim about *operations reachable through a named RPC command*, not about the
  SDK method's exact parameter surface; the audit's own SDK supplement remains the description of the
  in-process API Cedia deliberately does not load.
