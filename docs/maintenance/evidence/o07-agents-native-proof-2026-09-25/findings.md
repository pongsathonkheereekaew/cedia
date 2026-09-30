# Slice (O07 revive of a natively-parked agent: real provider turn, zero spend)

Supersedes the open item in `o07-agents-parked-proof-2026-09-25` (fixture-backed) with
the real thing — using the user's own OMP-native auth, not a new key.

## Auth findings (read-only inspection, no secret printed)

- The personal profile carries API-key auth for three providers in
  `~/.omp/agent/models.yml` (mode 600): `opencode-go`, `commandcode`
  (default role model), `opencode-zen` (`union-alpha`, cost 0 — "Union Alpha Free").
  No OAuth login is involved on this path; no Keychain item is read (file-based keys).
- OAuth provider accounts (`auth.accounts.list`) are empty — irrelevant here, since
  the configured models authenticate by API key, not by OAuth account.
- Integration path verified, not fixed: production `startHostServer` passes no
  `ompEnv`, so personal runtimes inherit the real HOME and resolve the personal
  profile natively. No credential was moved, duplicated, or re-pathed.
- Correction: the earlier "provider credential blocker" was an isolated-fixture
  artifact only — those smokes point HOME at throwaway dirs, which trivially have no
  auth. The personal profile was never inspected before this slice. No new API key
  was requested or needed.

## What the proof shows (`scripts/omp-agents-native-proof.ts`, green)

- Session `/switch union-alpha` (200, no turn), `/tan` dispatched through the host
  commands route (no parent model call), exactly ONE worker turn on the cost-0 model
  with a tool-free prompt and a 240 s budget (timeout kills through the same kill
  route, recorded, never retried into spend).
- The worker completed natively and parked through the real controller path;
  transcript answers 200; durable revive answers `{available: true, revived: true}`.
- Spend: one zero-cost worker turn. No purchase, top-up, signup, or login flow.
- Real auth stays out of G0/isolated tests: all fixture smokes are untouched and
  still provider-free; only this explicitly-marked script uses native auth.

## Still not claimed

Provider-completed behavior on a paid model (unneeded — the lifecycle path is
model-independent and the free model exercised it), packaged/window-live capture of
revive, and anything requiring new authorization. No gap change: no coverage row
hinged on this proof.

## Addendum: re-verified on the twice-rebuilt binary

The pinned runtime was re-derived twice after the first native run (per-agent config
ops, then the `/move` RPC guard). All three lifecycle proofs re-ran green against the
current binary: live kill of a running worker (`omp-agents-live-proof.ts`), canned
park+revive (`omp-agents-parked-proof.ts`), and one more zero-cost native worker turn
park+revive (`omp-agents-native-proof.ts`, union-alpha). No behavior drift from either
patch regen.
