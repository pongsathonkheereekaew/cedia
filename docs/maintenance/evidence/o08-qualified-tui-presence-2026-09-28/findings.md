# O08 qualified TUI presence — 2026-09-28

## Boundary implemented

The host writes a private, versioned `.cedia-task-context.json` beside each persisted task's
session lock. It refreshes task ID, incarnation, transcript path and cwd when those durable
fields change. `cedia-omp --cedia-session-dir <task-dir> launch` requires that explicit task
directory, validates the context and transcript containment, refuses session-override flags,
and injects the host identity, credit guard and trusted lock extension. Missing or conflicting
context is a refusal; the launcher does not infer ownership from a folder name or an untrusted
environment variable.

The trusted lock extension records a process-local marker only after its exclusive SQLite
transaction succeeds. The OMP interactive path checks that marker, the private sidecar and the
opened transcript before publishing a v2 authenticated owner endpoint. This TUI endpoint reports
`mode: "inspect_only"` in its record and identity. It answers presence/status and rejects
`claim_controller`; it does not expose an RPC command dispatcher. Legacy v2 records with no mode
remain controller-compatible, while a record/reply mode mismatch is a conflict. The host's
known-owner picker labels inspection-only owners and offers no Attach action; host start refuses
their adoption before version probing, incarnation rotation or another spawn.

## Verification

- A provider-free manual PTY launch used an isolated profile and a loopback model endpoint with no
  reachable service. The explicit launcher published a private owner record with the task ID,
  incarnation, cwd, transcript and `inspect_only` mode. Authenticated status returned the same
  identity; `claim_controller` returned `inspect_only`. SIGINT removed the endpoint and left no
  OMP child. This was a source/launcher proof, not a packaged-app capture or a model turn.
- On the refreshed development runtime, host launcher/context/service/owner tests passed
  **68/68, 380 assertions**. OMP owner bridge tests passed **9/9, 181 assertions**. Agent Window
  passed **414/414, 1505 assertions**. Root, OMP and Agent Window typechecks passed.
- `bun run check:omp-coverage` mapped **1041/1041** audited records with zero fatal issues;
  `git diff --check` passed. Coverage completeness is a source mapping, not F acceptance.
- The consolidated OMP patch SHA-256 is
  `57720486da416bbb155976ea92c113265799efed80e8b589ef5763343c012b87`.
  `attestOmpRuntime` reported `sourceVerified: true`, pinned revision
  `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`, source tree
  `bc8f98db7bc844e0da9dde596a465ceaefd1feab`, development executable SHA-256
  `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`, and patch
  manifest SHA-256 `4a15038d9a6b99220f96c4faba7fb4413db989dbc20ac895fd3c833219994e7f`.

## Open boundary

TUI presence is inspection only. Interactive control still requires an OMP-owned dispatcher
shared with interactive mode, exclusive handoff and recovery tests; an RPC executor must not be
spawned beside the TUI. Uninstrumented `omp` processes are external. OS process-birth identity,
hard-crash recovery, packaged owner selection and D/F acceptance remain open. No packaged app,
Keychain, Login Item, paid provider, device, commit or push was used for this slice.
