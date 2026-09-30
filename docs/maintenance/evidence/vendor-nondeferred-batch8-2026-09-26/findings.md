# Selective intake batch 8: remaining N/A dispositions with tree proof — 2026-09-26

Dispositions the remaining v0.9.2 release PRs that need no port, each verified
against the current tree (not by memory of the intake note). No product code
changed; no gap change (stays **2**: `switchSession`, `browser-relay`).
§10 item 70 owns status. No provider involvement.

## Dispositions (all no-change)

- #1302 onboarding detection: not applicable as written. The tree has no
  Synara-style multi-provider CLI setup flow to adapt (no provider-detection
  or setup/probe flow in the vendored chat sources or `apps/macos/src`);
  provider/model/auth stay routed through OMP.
- #1300 Windows missing paths: not applicable. Mac Code-OSS target; the host
  owns no project-import path handling (grep over `apps/host/src` finds only
  unrelated wording).
- #1321 blank provider paths: not applicable as written. CEDIA owns no
  Synara-style provider path settings; a blank-means-default rule will apply
  if an OMP endpoint/path preference is ever added.
- #1293 Windows editor event loop: not applicable. The tree's `executable`
  uses are configured binary paths (`ompExecutable`, `gitExecutable` passed
  to `execFile`), not a PATH-wide synchronous discovery loop; nothing blocks
  an event loop to fix.
- #1303 labels/size buckets: not applicable. Repository workflow policy, not
  product behavior; our `.github/workflows/` holds only `ci.yml`.
- #1324 test/CI trimming: deferred, do not copy. Upstream's deletions are not
  replayed here; suites are retained (this slice re-ran
  `apps/host/test/cleanup.test.ts`: 12 pass).
- #1325 release parallelism: deferred. CEDIA install is manually owned;
  `scripts/build-cedia.ts` ad-hoc signs and states "not notarized" with no
  publish step.
- #1327 full worktree cleanup: reference only, deletion stays off. The host
  states its own rule in source (`service.ts`: "The host never calls this
  automatically"), removal is capability-gated with `enabled: false`, and the
  existing suite pins disabled-without-removal (12 pass, this turn).
- #1311 beta lane/crash reports: deferred. No telemetry upload in
  `apps/host/src` and no beta-install/import lane; no external diagnostics
  service follows from this intake.
- #1329 updater latch: not applicable. CEDIA owns no auto-updater flow
  (manual installation); there is no update state machine to latch.
- #1295 Pi SDK 0.87.1: not applicable. No Pi/provider-SDK dependency in the
  workspace manifests; adding one would create the alternate execution/auth
  path the baseline forbids.

## Still undispositioned (future selective batches, not this one)

- #1166 OMP provider (Beta ACP adapter): needs its own differential
  investigation before any presentation/test adaptation; replacing the RPC
  owner is explicitly out.
- Port candidates needing design: #1266/#1271 project import-relocation,
  #1276 delegated-result delivery, #1261 human-message recency, #1255
  mention/split drag-and-drop, #1290 remainder, Computer Use consent
  patterns for O10.
- Separate app-feature intake with owner/auth prerequisites: #1257/#1262
  GitHub PR UX.

## Preserved

- D1–D5, deferred voice, `switchSession` open, #1332 durable-catalog
  exclusion, no wholesale vendor upgrade, no ACP migration, no OMP pin
  change, no worktree deletion. Pin unchanged. Nothing committed;
  uncommitted tree preserved (`git diff --check` clean).
