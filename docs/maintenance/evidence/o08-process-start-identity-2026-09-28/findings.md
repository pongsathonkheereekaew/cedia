# O08 process-start identity — 2026-09-28

## Change

CEDIA owner bridge protocol is now v3. OMP writes `processStartIdentity` into the private owner
record and repeats it in authenticated identity, status, summary and controller-claim responses.
`ownerStartedAt` remains the distinct bridge-issued marker. The shared CEDIA helper obtains the
identity on macOS with `/bin/ps -p PID -o lstart=` under `LC_ALL=C` and `TZ=UTC`; its normalized
timestamp has one-second precision.

Before connecting to the owner socket, the host checks that the PID is live and independently
recomputes the process-start value. A mismatch is a conflict and leaves the record untouched. The
host then checks that authenticated socket responses agree with both the record and the kernel
query. Read and controller adapters carry the expected identity, and OMP refuses a controller
claim if the process-start value differs. Protocol v2 records are refused rather than adopted.

The timestamp is supplemental evidence, not a standalone PID-reuse proof: it cannot distinguish
two processes with the same PID born in the same second. Socket-token authentication remains
required, and same-second PID reuse and packaged qualification remain open.

## Verification

- TDD regression for a live PID with a forged process-start value failed before the host check:
  the old probe reached the absent socket and reported `stale`. It passes after the host compares
  the OS value and reports `conflict` before connecting.
- TDD regression for an OMP controller claim with a different process-start value failed before
  the OMP comparison (`primary_active`); it passes with `identity_mismatch` and no controller lease.
- `bun test apps/host/test/omp-owner-attach.test.ts apps/host/test/cli-launcher.test.ts`: **26 pass,
  0 fail, 113 expectations**. Includes real pinned-runtime owner publication/probe, killed-owner
  stale refusal, and the qualified launcher against a live owner.
- `bun test apps/host/test/service.test.ts -t "owner"`: **7 pass, 0 fail, 36 expectations**;
  includes real host adoption after primary transport EOF and refusal to spawn a second owner.
- `bun test upstream/omp/packages/coding-agent/test/cedia-owner-bridge-controller.test.ts`:
  **11 pass, 0 fail, 185 expectations**.
- `bun test packages/omp-adapter/test/owner-control-client.test.ts packages/omp-adapter/test/owner-read-client.test.ts`:
  **9 pass, 0 fail, 26 expectations**.
- Root `bun run typecheck` and OMP `bun run check:types` pass.
- `bun run prepare:omp` prepared the development runtime from the pinned OMP revision. A subsequent
  `attestOmpRuntime` check reported `sourceVerified: true`, runtime kind
  `development-source-launcher`, revision `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`, source tree
  `7e0ac3862e0c849b4467c508b8b3c175217968cc`, patch SHA-256
  `d76cd4d7db1418923ec7d8e73221261484eb06e871df05b04f2d82724d141afb`, patch-manifest SHA-256
  `246014bfe03ee7dbf1e6f2034c4e7df516b2a43919228f183811ea3fc2fb0431`, and executable SHA-256
  `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`.

## Limits

This proves the owner identity exchange on the prepared macOS development runtime. It does not
prove same-second PID reuse, hard-crash recovery, uninstrumented CLI/TUI discovery, packaged owner
selection, physical-device behavior, or D/F acceptance. No packaged app, Login Item, Keychain,
device, provider spend, commit or push was used for this slice.
