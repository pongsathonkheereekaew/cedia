# Cedia hands the runtime a URI scheme with a reader behind it — 2026-09-24

This receipt records the O05 host-URI slice. `set_host_uri_schemes` was the one audited RPC command
Cedia never sent; the plan's condition for closing it was not "send the command" but "register a
scheme something can actually read", because a scheme with no reader would be the fake capability §5
forbids. Cedia now registers one whose reader is the host's immutable artifact store, and the host
verifies that the runtime installed it. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb`, dirty with the open slices.
- Pinned runtime `00085d4e7dfdcfbf302c122fa2682b410a0f43d1` prepared as `omp/18.1.18`; this slice adds
  no runtime change (the host-URI bridge is in the already-pinned patch).
- Cedia: new `apps/host/src/host-uri.ts`, `apps/host/test/host-uri.test.ts`,
  `scripts/omp-host-uri-smoke.ts`; changed `apps/host/src/service.ts`,
  `apps/host/test/fixtures/fake-host.mjs`, `scripts/lib/omp-coverage.ts`.

## What changed

- **A scheme whose reader is real.** `cedia://artifact/<sha256>` resolves against the task's own
  content-addressed artifact store: `capture` has already copied the bytes into a private directory
  keyed by their digest, and `read` verifies the digest on every access. That is what the scheme
  adds over a path read - the exact bytes that were captured, still reachable after the workspace
  file changed or disappeared, with the store's integrity check. The scheme is registered
  read-only and `immutable: true`, because there is nothing to write back into a receipt.
- **Strict in, strict out.** A URL with another scheme, another host, a query or fragment, an extra
  path segment, or an id that is not a 64-character lowercase hex digest is refused; a task id that
  does not own the artifact is refused by the store; bytes that cannot be handed to a text reader
  (they contain a NUL) are refused rather than silently mangled into replacement characters. A
  successful read answers the content, `text/plain`, `immutable: true`, and notes naming the source
  path, the size and the digest, and whether the read was complete or truncated at the 96 KiB bound.
- **The handshake is verified, not assumed.** The host sends `set_host_uri_schemes` with the
  dispatcher's own definitions and then checks the runtime's answer: a scheme the runtime did not
  report as installed fails the session start with `host_uri_scheme_refused`. A registered scheme
  the runtime dropped would otherwise leave the reader unreachable while the host believed it was
  live.

## Evidence (this revision and build)

- `bun scripts/omp-host-uri-smoke.ts` → every check OK against the prepared `omp/18.1.18` and a real
  host, with an unresponsive local fixture listener (no provider request can complete): the artifact
  route captures a file, the capture is content-addressed, the session starts (which is the verified
  acceptance of the scheme), and after the workspace file is rewritten the artifact still answers
  the captured bytes. The route stays owner-only.
- `bun test apps/host/test/host-uri.test.ts` → 6 pass, including the parser's refusals, the
  cross-task denial, the non-text refusal, and the runtime's own `host_uri_request` frame answered
  through the dispatcher with a `host_uri_result` - plus a write refusal because the scheme is not
  writable.
- `bun test apps/host packages/omp-adapter` → 402 pass, 0 fail. The fixture runtime now answers
  `set_host_uri_schemes` the way the patched runtime does, so the host's verification is exercised
  in fixtures too.
- `bun run check:omp-coverage` → integrity PASS, **102 → 101** records without a disposition:
  `set_host_uri_schemes` leaves the uncarried list and becomes a named Cedia caller the gate
  re-reads (`apps/host/src/service.ts`). `bun test scripts/lib` → 77 pass.
- `node scripts/ci-validate.mjs` → CI-OK; `git diff --check` clean; `bun run typecheck` → the 10
  pre-existing errors, none in a file this slice touched.

## Limits

- O05's two dynamic tools (`generate_image`, `tts`) are still open. They are registered by OMP only
  when their own setting is on and their backing provider or worker exists
  (`generate_image.enabled` plus a resolvable image model; `speechgen.enabled` for `tts`), so the
  honest disposition is a dependency-unavailable one with a readiness probe - and the probe needs a
  way to read a session's active tool catalog, which is O05/O06 work (`getAllToolInfos` has no
  bridge yet). Neither is claimed here.
- No agent turn exercised the scheme: reaching `cedia://` needs a model to call the read tool, which
  G0 does not start; the reader and the runtime's own frame path are proven above, and the runtime's
  acceptance is live.
