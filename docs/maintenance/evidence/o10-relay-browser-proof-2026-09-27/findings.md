# O10 packaged browser-relay action proof — 2026-09-27

This closes item 70's named O10 browser-relay slice: a scoped, prelude-driven
action on a selected tab plus packaged qualification. It exercises the separate
headed Chrome relay path, not the embedded per-thread CDP endpoint. No external
provider, credentials, account data, or non-fixture tab contents were used.

## Build and runtime

- Repository revision: `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`; prior dirty
  work preserved. This proof adds `scripts/omp-relay-browser-proof.ts` and the
  `smoke:browser-relay-packaged` package command; no production OMP or CEDIA
  runtime behavior changed.
- Packaged app: `Cedia.app`, packaged `2026-09-27T03:55:26.505Z`, upstream
  `ea1912fd6a05`, 18 desktop patches; `bun run check:packaged` passed with
  patch digest `086d31f75d3688905304e07758c808e138632c4fb672167950c6df01e45a31b5`.
- Pinned OMP runtime: `omp/18.1.18`.
- Relay: the already-running owner-installed extension and loopback relay at
  `127.0.0.1:9224`; the proof did not stop or reconfigure the owner's relay.
- Cedia host state, app profile, model profile, and project were created under a
  temporary directory. The temporary model endpoint bound to loopback only.

## Proof performed

`bun run smoke:browser-relay-packaged` passed. It created a dedicated fixture
tab through the live relay with a unique title and a `127.0.0.1` URL. A packaged
Cedia session ran the pinned OMP runtime. Its loopback canned model issued one
fixed `eval` call using `browser.open` with `app.relay: true` and the fixture's
exact `app.target`, without a URL. OMP read that selected tab's title, clicked
the fixture button, read the changed DOM marker, and released the named tab
handle. The local fixture server observed exactly one click; the host command
settled `completed`. A second canned response closed the turn. `result.json`
records `packaged: true`, `commandStatus: completed`, `fixtureClicks: 1`, two
local model requests, and `externalProviderRequests: 0`.

The proof tab was closed during teardown. The live relay remained running and
only the pre-existing unrelated browser tab remained listed. The proof stores
the fixture title and local URL in `dist/o10-relay-browser-proof/result.json`;
it does not store page contents or screenshots.

## Verification and disposition

- `bun run check:omp-coverage`: integrity PASS, 1,041 records / 1,041 mappings,
  0 fatal issues; only O02 `switchSession` remains without a disposition.
- `bun run check:omp-coverage --require-complete`: fails only on O02
  `switchSession`, which remains open for the owner decision in the existing
  session-placement receipt.
- `bun run typecheck`, `bun run check:packaged`, and `git diff --check`: pass.

The O10 `browser-relay` row is now `integrated` because the required relay-path
action and packaged qualification are directly evidenced here, alongside the
existing install and live-connect receipts. D/W/N/F product acceptance remains
open; this single O10 packet does not certify a broader checkpoint.
