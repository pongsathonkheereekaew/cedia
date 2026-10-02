# Cedia — upstream lock

Every external revision Cedia builds against is pinned here as a full 40-hex SHA. Re-pin
explicitly before a release; never float. `scripts/ci-validate.mjs` parses this file and rejects a
short or non-hex revision, so the format below is load-bearing.

Machine-readable pins live in [`../upstream-lock.json`](../upstream-lock.json) and are consumed by
`scripts/build-cedia.ts`. This document is the human-readable half and the single list of every
pinned external source; there is no second lock file anywhere in the repo.

## Pinned sources

| Component | Repository | Revision | Role | License |
|---|---|---|---|---|
| OMP | `can1357/oh-my-pi` | `717f97f4d22b3d65c4a4eef6a744255d46f4d1a6` | The harness: execution and transcript owner, RPC and tool contract | MIT |
| Cedia Code-OSS fork | `pongsathonkheereekaew/cedia` | `ea1912fd6a05b80a56b2ad9b955075211deea521` | Mac IDE build baseline; `patches/desktop/manifest.json` pins the same revision as `baseRevision` | MIT |
| Paseo | `getpaseo/paseo` | `d1b705a0cd91617a5707fae25d80cb0be3057950` | Relay E2EE primitives only, via `@getpaseo/relay 0.8.0`; no other Paseo source is vendored | Apache-2.0, per-file with third-party exceptions |

Retained license texts: `docs/upstream-notices/omp-LICENSE.txt`,
`docs/upstream-notices/cedia-native-LICENSE.txt`, and `packages/relay/LICENSES/` (Paseo Apache-2.0
plus `tweetnacl`, `base64-js` and `ws`).

## Runtime baseline

- OMP baseline: **18.4.8** (pin moved 2026-09-29 from 18.1.18 to 18.4.3, then to 18.4.8 per `upstream-lock.json`; floor stays 18.1.18; human-readable row reconciled in S1a, no runtime upgrade in this change). `isSupportedOmpVersion()` in `packages/omp-adapter/src/types.ts`
  accepts the baseline floor or any newer release, and rejects older
  versions and non-version strings. `scripts/prepare-omp-runtime.ts` still pins the exact revision
  because it builds the artifact that ships.
- Cedia Code-OSS: pinned `ea1912fd…`; `scripts/prepare-desktop.ts` verifies the base revision and
  every patch digest before applying.

## Rules

- Never mix client, protocol and server revisions across components; the handshake rejects an
  incompatible major protocol before any mutation.
- A snapshot taken while researching is not a lock. Only this file and `upstream-lock.json` are.
- Adding a component means adding a row here **and** an entry in `upstream-lock.json`, with its
  retained license text.
- This file is not a release SBOM and is not a third-party dependency license certification; the
  dependency tree is covered by the package manifests and the retained notices above.
