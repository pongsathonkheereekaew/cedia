# O08: a qualified launcher owns the `omp` CLI path, and it ships in the packaged runtime — 2026-09-24

This receipt records the launcher half of §8.2's O08 packet. The owner endpoint already existed
(the runtime publishes `owner.json` and a mode-0600 socket; the host decides `absent`/`attached`/
`stale`/`conflict`), and what was missing was the path a user's own `omp` command goes through.
It also records a build-breaking defect found while verifying that path, and the honest state of
the CLI verb family afterwards. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with this and the other open slices.
- New: `apps/host/src/cli-launcher.ts`, `scripts/cedia-omp.ts`,
  `apps/host/test/cli-launcher.test.ts`. Changed: `scripts/build-cedia.ts`, `package.json`
  (a `cedia-omp` script), and the CLI/launch-flag half of `scripts/check-omp-coverage.ts`.

## What changed

- `decideCediaCliInvocation` is the decision only; it starts no process. With no session named
  there is nothing to conflict with and the verb runs. With a session named, the owner endpoint
  decides: an absent owner runs the pinned runtime, a live owner brokers the one verb the endpoint
  can answer, and anything else is refused by name (`owner_active`, `owner_stale`, `owner_conflict`)
  with the reason - never by killing, adopting or deleting anything.
- Launch flags that would pick or attach a session (`--session`, `--session-dir`, `--fork`,
  `--resume`/`-r`, `--continue`/`-c`) are refused while an owner is live, whatever the verb is:
  forwarding one is how a second executor gets started by accident.
- `scripts/cedia-omp.ts` is the path itself: it resolves the pinned runtime (explicit override,
  then the packaged neighbour, then the development build), keeps the child's stdout/stderr, and
  exits with the child's code.
- The packaged runtime ships it (`dist/mac-extension/runtime/omp/cedia-omp` plus the `.mjs`
  bundle) beside a `runtime/node/bin/node`, so the packaged CLI is instrumented rather than the
  bare binary being handed to a user.

## Defect found and fixed while verifying the packaged path

The bundling step was written as `format: "cjs"` with a `.mjs` name. Bun refuses that build
outright - the launcher awaits its own exit code at the top level, which CommonJS cannot express -
so `bun scripts/build-cedia.ts --portable` (and therefore `package:mac`) would have failed at the
launcher step and taken the whole packaged build with it. It is an ESM bundle now, and the `.mjs`
extension is what tells the packaged Node to run it as ESM.

## Verification

```
bun test apps/host/test/cli-launcher.test.ts                 # 9 pass, 0 fail
CEDIA_HOST_NODE=<packaged node> bun scripts/build-cedia.ts --portable
  -> dist/mac-extension/runtime/omp/{cedia-omp,cedia-omp.mjs}
./dist/mac-extension/runtime/omp/cedia-omp                   # usage, exit 64
./dist/mac-extension/runtime/omp/cedia-omp --version         # omp/18.1.18, exit 0
bun run check:omp-coverage                                   # Integrity PASS, live omp/18.1.18
git diff --check                                             # clean
```

The last two commands are the packaged artefact running the packaged runtime through the launcher
shim and its bundled Node 24 (`v24.18.0`): the qualified path is what a user's `omp` verb now
travels. The suite covers the decisions against a fake endpoint and against a **real** owner: the
verb that brokers returns the owner's own answer, a second executor is refused, a session-owning
flag is refused, a stale record and an unprovable endpoint are reported as such, and the launcher
exits non-zero with the reason instead of pretending success.

## What this does not claim

- **No full `package:mac` / `check:packaged` run after this fix.** The portable build step and the
  packaged launcher were executed directly; the app was not repackaged, and the currently installed
  `Cedia.app` predates the launcher.
- **O08's discovery half is still open**: listing live owners in the application, attaching to an
  instrumented owner, and detaching without stopping it.
- **Eight CLI verbs stay `integration_missing`** and are not claimed by shipping a path:
  `auth-broker`, `auth-gateway`, `browser-relay`, `join`, `share`, `ssh`, `update` and
  `tiny-models`. Each names the qualification the plan requires (credential service, forward proxy,
  external browser relay, collab room, remote host, OMP's own updater, local model provisioning).
  The gate maps them to this launcher as their handler and keeps them blocking.
- No provider, network or model call is made by any of the above.
