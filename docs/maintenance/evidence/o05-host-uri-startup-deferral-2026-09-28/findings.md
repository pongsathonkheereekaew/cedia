# Host URI-scheme registration defers past the OMP startup gate — 2026-09-28

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty by design.
- Pinned runtime OMP `18.1.18` (attested standalone build, source tree
  `d0105be6509186319c7ae76249d1dc61932c7967`).
- Changed by this slice: `apps/host/src/service.ts` only — URI-scheme install extracted to
  `#installHostUriSchemes`, startup defers on the startup-gate refusal, `#dispatch` retries
  a pending registration. No OMP patch, protocol, store, or renderer change. No provider call.

## What failed

`bun scripts/omp-virtual-ui-smoke.ts` (committed, last receipted green 2026-09-13) failed 2/2
on the current tree. Host session startup sent `set_host_uri_schemes` while the fixture's
`session_start` custom interaction was still pending, and OMP refused it with
`Complete the startup interaction before sending this command` (code `cedia_initializing`).
The URI-scheme install step (plan item 37, landed after the smoke's last green run) was the
only startup step the gate refuses: `get_state` and `set_host_tools` proceed concurrently,
which the 2026-09-13 receipt records as supported behavior.

## What changed

- Startup attempts the install as before. A refusal carrying code `cedia_initializing`
  marks `runtime.uriSchemesPending` and continues startup with an `onDiagnostic` line; any
  other refusal still fails startup exactly as before.
- `#dispatch` retries a pending registration before the command goes out (RPC clients
  only). The retry never fails the command: the flag stays set for a later command, and a
  turn that references an unregistered scheme still fails loudly at OMP with its own error.
- A startup custom that waits for user input can therefore no longer fail session startup,
  and the schemes land on the first post-gate command instead of never.

## Verification

- `bun scripts/omp-virtual-ui-smoke.ts`: PASS — every check green, including
  `host-bootstrap-concurrent-get-state-and-host-tools` with the session_start custom
  pending and input delivered through the durable command path.
- `bun test apps/host/test/host-uri-schemes.test.ts`: gate-once fixture
  (`CEDIA_FAKE_SCHEMES_GATE=startup-once`) proves session startup succeeds past the
  refusal with a deferral diagnostic, exactly one schemes call at startup, and the
  second (successful) call before the next command completes. A second test with a
  persistently refusing fixture (`startup-once-then-refuse`) proves both commands still
  complete while the non-gate retry failure is reported on diagnostics exactly once.
- `bun run typecheck`: clean. `bun run test`: full root suite rerun after the change.
- `bun run check:repo`: unchanged apart from the same 102 pre-existing dead links in
  historical `.scratch/cedia-direction` and brand-prototype evidence.

## Limitations

- The retry was proven through the smoke's post-input commands, not through an OMP-side
  artifact read; a `cedia://artifact` turn reference on a packaged renderer is still open.
- Packaged renderer observation, Login Item/real-login behavior, tailnet/off-LAN, physical
  iPhone, and full D/W/N/F acceptance remain open under item 70.
