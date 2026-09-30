# O08 owner endpoint SIGTERM cleanup — 2026-09-28

## Failure and fix

An external `SIGTERM` immediately after `rpc-ui` published `owner.json` could leave that record
behind. The existing process `exit` callback was insufficient because OMP's shared postmortem
signal handler can terminate through `process.reallyExit`, and asynchronous publication left a
short interval where token-guarded cleanup could not read complete JSON. The development probe
reproduced the stale record in about five of twelve immediate-signal runs before the fix.

The owner bridge now registers an exit-only postmortem cleanup before endpoint publication, installs
its synchronous exit fallback before opening the socket, and writes/chmods the small owner record
synchronously after the socket is ready. Concurrent closes share one promise; normal close removes
the signal and exit registrations only after endpoint cleanup completes. Cleanup verifies the
record token and socket identity before unlinking, so another owner's paths are never removed.

## Verification on the final source/runtime

- `bun test upstream/omp/packages/coding-agent/test/cedia-owner-bridge-controller.test.ts`:
  8 passed, 177 assertions. A real child-process regression sends `SIGTERM` as soon as its owner
  record is readable and asserts both record and socket are absent after exit.
- The immediate-signal manual loop removed record and socket in 12/12 runs after the fix.
- `CEDIA_OMP_BINARY=/Users/pond/cedia/dist/omp/omp bun test apps/host/test/service.test.ts
  apps/host/test/omp-owner-attach.test.ts`: 49 passed, 320 assertions on the refreshed runtime.
- `bun run typecheck`, coding-agent `check:types`, Agent Window typecheck, `bun run check:repo`,
  `bun run check:omp-coverage`, and `git diff --check` passed. Agent Window tests passed 414/414.
- `bun scripts/refresh-omp-patch.ts` produced patch SHA-256
  `be3f47ad653637b7a3aa1010d1993017e6cc67ba4c5883f605c5f5d112821c33`;
  `bun scripts/prepare-omp-runtime.ts` succeeded. Runtime attestation reports
  `sourceVerified: true`, source revision `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`,
  source tree `050c04d149fc9f750e840e2974d20741e5aae9d8`, executable SHA-256
  `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`, and manifest
  SHA-256 `c80f1df653b41989e2b02c4f656d16fae9b66addcb235e49a5a346a3198dce55`.

`SIGKILL` and a hard process crash cannot run JavaScript cleanup. Their stale records remain
explicit refusal evidence; no automatic unlink or second executor was introduced. This covers
one signal lifecycle case, not crash recovery during a turn, independent CLI/TUI discovery,
packaged owner qualification, D or F acceptance. No packaged app, Keychain, Login Item, paid
provider, device, commit or push was used.
