# F: an RPC row is now settled by a path, not by the transport accepting its name — 2026-09-24

The coverage gate marked every one of the 50 audited RPC commands `integrated`, with
`packages/omp-adapter/src/client.ts#request` as the handler. That is true of the *transport* — Cedia's
adapter can send any command name — and it is not the same claim as the operation having a Cedia path,
which is what `integrated` means. This slice measured the difference and settled each row on a checked
basis. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with this and the other open slices.
- Changed: `scripts/lib/omp-coverage.ts` (the path tables and `verifyOmpRpcPaths`),
  `scripts/check-omp-coverage.ts` (the RPC rows), `scripts/lib/omp-coverage.test.ts`.

## The measurement

Every audited RPC command name was searched across `apps/host/src`, `apps/macos/src`,
`apps/macos/agent-window/src` and `packages/omp-adapter/src`:

- **31 commands appear somewhere in Cedia's own code.** Where a row was settled on a caller, the call
  site was read (for example `sendCommand(session, id(), "abort")` for `abort`, or
  `client.requestCedia('cedia_get_auth_providers', {})` for that command).
- **19 appear only in the adapter's own command-type union**, i.e. declared and never sent. They are
  `set_fast_mode`, `set_todos`, `set_host_uri_schemes`, `get_subagents`, `get_subagent_messages`,
  `cycle_model`, `cycle_thinking_level`, `set_steering_mode`, `set_follow_up_mode`,
  `set_interrupt_mode`, `set_auto_compaction`, `set_auto_retry`, `abort_retry`, `bash`, `abort_bash`,
  `get_session_stats`, `export_html`, `get_last_assistant_text`, `set_session_name`.

## What each of the 19 became

- **14 have a checked Cedia path** (`OMP_RPC_VIA_OTHER_PATH`), and the checker proves each one:
  - 7 carry the operation through a slash command the audit itself marks reachable over the prompt
    path — `cycle_model`→`/model`, `set_fast_mode`→`/fast`, `set_todos`→`/todo`,
    `abort_retry`→`/retry`, `get_session_stats`→`/stats`, `export_html`→`/export`,
    `set_session_name`→`/rename`. A link to a slash command the audit does not mark reachable fails
    the run.
  - 5 carry it through the runtime's own setting, writable in Cedia's OMP settings surface —
    `set_steering_mode`→`steeringMode`, `set_follow_up_mode`→`followUpMode`,
    `set_interrupt_mode`→`interruptMode`, `set_auto_compaction`→`compaction.enabled`,
    `set_auto_retry`→`retry.enabled`. A link to a path the schema does not define fails the run.
  - 2 carry it through another command Cedia really sends — `cycle_thinking_level`→`set_thinking_level`
    (the effort picker sets a level rather than cycling one) and `get_last_assistant_text`→`get_messages`
    (Cedia reads the task's transcript itself; the last assistant response is what the chat shows).
- **5 have no Cedia path at all** (`OMP_RPC_UNCARRIED`) and are now `integration_missing` with the
  packet the audit files them under: `set_host_uri_schemes` (O05), `get_subagents` and
  `get_subagent_messages` (O07), `bash` and `abort_bash` (O11).

## The number went up, which is the honest direction

`bun run check:omp-coverage` reports **638** records without a settled disposition, up from 633: five
rows that were claimed now say they are not carried. Integrity still passes, and
`--require-complete` still exits 1.

## Verification

```
bun test scripts/lib/omp-coverage.test.ts   # 17 pass, 0 fail
bun run check:omp-coverage                  # Integrity PASS; 638 records unsettled, RPC family now O05 1 / O07 2 / O11 2
bun run typecheck                           # the same 10 pre-existing errors, none new
git diff --check                            # clean
```

**The verifier was verified.** Renaming one link's settings path to `compaction.notReal` made the real
gate fail:

```
Integrity FAIL: 1 fatal issue(s)
  unclassified: set_auto_compaction — RPC path link claims the setting 'compaction.notReal',
  which the runtime's schema does not define.
```

Restoring it returned `Integrity PASS`.

## What this does not claim

- **Only the 19 no-caller rows were re-settled.** The other 31 keep the earlier claim and a
  `file:line` was read only where a link needed one. A future pass that requires an exact call site
  for every RPC row would be a stronger claim than this receipt makes, and the gate would be the
  place to enforce it.
- `bash`/`abort_bash` being gaps does not mean Cedia cannot run a shell: the `bash` **tool** inside a
  turn and the IDE/host terminals are different owners, which is exactly why this row is a gap.
- No runtime, provider or model call was made; the evidence is source, audit and fixture.
