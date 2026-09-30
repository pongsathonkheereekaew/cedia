# O07 live Muse plan-review proof — 2026-09-28

## Scope

Exercise the provider-backed `xd://propose` path through the pinned OMP plan bridge and CEDIA host
without starting the packaged app. The runner uses one isolated scratch project and state directory,
checks model/auth/runtime provenance before dispatch, sends one user prompt without retry, then
cancels the held plan review and closes the host.

## Result

- OMP `18.1.18` was source-attested before any provider turn. Runtime tree:
  `7e0ac3862e0c849b4467c508b8b3c175217968cc`; patch manifest SHA-256
  `246014bfe03ee7dbf1e6f2034c4e7df516b2a43919228f183811ea3fc2fb0431`; executable SHA-256
  `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`; OMP source revision
  `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`.
- The host selected and read back exactly `opencode-go/muse-spark-1.3-contributor`; provider
  metadata reported authenticated and available before the prompt.
- OMP entered its own plan mode. One accepted prompt caused a live plan review to appear through
  the owner-only host route, with OMP review id `1`, a non-empty title, a `local://` plan artifact,
  and 1,079 untruncated characters. The plan text is not retained; SHA-256:
  `35714b3babe6e9b76a29a425802df95141b7e477f2606a08ca57879f24662696`.
- The owner cancelled that review through `POST /v1/sessions/:id/plan`; the response reported a
  change and no review, and a fresh `GET` confirmed there was no pending review.
- The scratch project/state was removed when the proof closed. No packaged app, Login Item,
  Keychain, physical device, commit or push was used.

## Verification

- `bun scripts/omp-plan-review-muse-live-proof.ts`: **PASS**; one user prompt, live review observed,
  cancelled, no retry.
- Before the live run, `bun test upstream/omp/packages/coding-agent/test/cedia-plan-bridge.test.ts apps/host/test/omp-progress.test.ts`:
  **25 pass, 0 fail, 99 expectations**.
- Before the live run, root `bun run typecheck` and `bun run check:repo` passed.
- The live proof runner SHA-256 is
  `ef8aab655e67da50653d132f5110a05bb96f01ae0dc93e619bba26d3801bd33e` at repository revision
  `0676dd70d54e429b5a72c98cb3f22a646bbd10eb` (dirty working tree).

## Limits

This closes the provider-backed host/runtime plan-review behavior only. The packaged review panel
was not captured; the approval-tier control and O07 Advisor, Prewalk, AgentHub and loop records
remain open. This is not D, N or F acceptance.
