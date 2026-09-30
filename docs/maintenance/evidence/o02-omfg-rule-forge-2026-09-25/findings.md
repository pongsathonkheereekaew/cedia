# Slice (O02 rule forging): complaint in, reviewed rule out, file on disk — 2026-09-25

`/omfg` forges a TTSR rule from a complaint: the model drafts a candidate over an
ephemeral turn, the candidate is validated against the assistant history, and the owner
saves it into the project or global rules directory with the runtime registering it
live. The terminal carries this in an overlay panel with pickers and confirms; Cedia
runs the same generate-validate-save chain with explicit parameters instead: the
composer Forge-rule panel drafts (feedback carries the amend loop), reviews the bounded
draft, saves with scope plus opt-in guards, and aborts through the run signal.
Gap count **24 → 23** (O02 slash 3 → 2).

## What was built

- Runtime (`upstream/omp`, pinned `omp/18.1.18`): `cedia-omfg-bridge.ts` —
  `createCediaOmfgBridge({session})` with `draft` (same rendered kickoff, up to three
  generate attempts with failure feedback, validation against `session.messages`,
  feedback regenerating from the held rule as the previous revision), `read`, `save`
  (scope resolution, existing-file refusal without `overwrite`, unvalidated refusal
  without `allowUnvalidated`, live registration via `session.ttsrManager`, consuming
  the draft like the terminal disposing), and `abort` through the run's own signal.
  Rule names with path separators are refused rather than escaped — a deliberate
  hardening over the terminal, which trusts model output across no boundary.
  `omfg.state.get` (controller) + `omfg.draft`/`omfg.save`/`omfg.abort` (owner) with
  strict payload rules. `cedia-omfg-bridge.test.ts` (8 pass, driving a canned rule
  through validation, file write into tmp dirs, and live-registration capture).
- Host (`apps/host/src/omp-omfg.ts`): strict parses, `OmpOmfg` projection,
  controller-visible `GET /v1/sessions/:id/omfg`, owner-only durable
  `POST .../omfg/draft`, `POST .../omfg/save`, `POST .../omfg/abort`.
  `omp-omfg.test.ts` (5 pass, including a fixture round trip that drafts, saves,
  consumes, refuses the second save, and returns to idle).
- Window: `CediaOmfgSurface.tsx` (complaint, Draft/Abort, bounded draft review with
  validated marker, scope select, overwrite checkbox, Save, Amend) mounted in the
  composer panel stack; query with a 2 s poll while drafting plus strict parses in
  `serverReactQuery.ts`; `getOmfg`/`draftOmfg`/`saveOmfg`/`abortOmfg` in
  `cedia-adapter.ts` + native exposure. `omfg-rule-surface.test.tsx` (6 pass).

## Design notes

- Dispatch-at-once throughout (btw/cleanse pattern): generation occupies no call;
  the panel polls while drafting; receipts are acceptances. No timeout cliff was
  introduced for this slice at all.
- The amend loop is a second `draft` call with `feedback`, not a separate op: the
  bridge regenerates from the held rule exactly like the terminal's amend path.
- Save consumes the draft; refusal (unvalidated without opt-in, existing without
  overwrite, nothing held) leaves the draft held and writes nothing.

## Live proof (prepared runtime, dead endpoint, no provider request anywhere)

`bun scripts/omp-omfg-smoke.ts` (21 checks): idle reads with nothing held; the draft
dispatches at once; the failure lands with the runtime's own error and holds no
candidate; saving with nothing held is refused before any file is touched; host routes
hold (controller read-only ×3, owner draft/save/abort, replay, 400s, 409). The
draft-validate-save path is fixture-proven (canned rule through validation, real file
write, registration capture) and renderer-tested; reaching it live needs a provider turn.

## Still open

- A live draft-validate-save run (needs a provider turn).
- O02 `tan`, `move`/`moveSession`/`switchSession` remain gaps.

## Evidence (this revision and build)

- `bun scripts/omp-omfg-smoke.ts`: all 21 checks pass.
- Upstream omfg/capability/model-state bridges (38 pass); `check:types` clean.
- Host suite 428 pass / 0 fail; agent-window suite 347 pass / 0 fail; root typecheck clean.
- `bun run check:omp-coverage`: integrity PASS, gap count **23** (was 24).
- Patch regen is faithful to the worktree (spot-audited); runtime re-prepared with attestation.
- `git diff --check`: clean.
