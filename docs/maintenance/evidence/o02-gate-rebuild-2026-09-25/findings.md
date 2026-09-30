# Slice (gate rebuild): `check-omp-coverage.ts` destroyed and reconstructed

No behavior change. The coverage gate entry point (`scripts/check-omp-coverage.ts`) was
accidentally truncated to zero bytes by a malformed in-place `perl -0pi` invocation (a
`BEGIN` block that consumed ARGV handling under `-i`), and the file was untracked, so no git
copy existed. The comparison rules were never at risk: every one of them lives in
`scripts/lib/omp-coverage.ts`, which was untouched.

## Recovery avenues tried, in order

- `git log --all` for the path: nothing — the newest dangling commits predate the gate.
- `git fsck --lost-found` (82 dangling blobs): all upstream/vendor files, no gate copy.
- Reconstruction from the intact rule library plus the recorded gate outputs as acceptance
  tests (see below). Audit inputs, host/adapter/protocol helpers and the prepared runtime
  were all untouched and read the same way.

## What the rebuilt entry point does (same as before)

Reads the five dated audit files, builds one Cedia entry per audited record (checked-path
RPC links, named host callers, call-site RPC, launcher CLI roles, slash reachability with
the operation it carries, tool/dynamic presentation seam, O04 per-path settings policy,
SDK operation/caller/slash/disposition links), hashes the 21 recorded audit sources with
the OMP-patch exemption, optionally asks the prepared runtime for its settings keys,
capability table (double-read compared) and version, then compares and reports.

One structural improvement folded in (not a behavior change): the headless-hang slash
exception table is now derived from the single shared owner
(`packages/protocol/src/headless-slash.ts`, added for the composer-menu guard) instead of
a gate-local literal, so the gate and the task surface cannot disagree.

## Verification (pinned runtime 18.1.18, all identical to the recorded outputs)

- `bun run check:omp-coverage`: `1041 audited records; 1041 Cedia mappings`,
  `checked omp/18.1.18; 498 settings, 50 audited RPC commands and 52 capability
  descriptors read`, `Integrity PASS: 0 fatal issue(s); 37 audited records without an
  available Cedia disposition`, same family/kind summary order, same within-group audit
  order (checked against `sdk.json`/`config-cli.json` file order, e.g. switchSession before
  branchFromBtw).
- `--list-gaps`: 37 lines, every reason verbatim-identical to the pre-incident runs.
- `--require-complete`: exit 1 with per-kind totals and example names.
- Missing binary (`CEDIA_OMP_BINARY=<missing>`): exit 0 with the absent-runtime note,
  static PASS.
- `bun build scripts/check-omp-coverage.ts --target bun`: passes.
- `bun test scripts/lib` (84 pass), `scripts/omp-slash-smoke.ts` (ok, zero provider).
- `git diff --check`: clean.

## Lesson, stated plainly

In-place stream edits with `BEGIN`/record-mode tricks are banned on irreplaceable files in
this repo: write a new file (or append), verify, and only then move it into place. The
destroyed file had no backup because the worktree is dirty by design and nothing was
committed — committing early and often would have made this a one-command recovery.

## Amendment 2026-09-25 (reconstruction claim audit)

Every gate row the rebuild wrote without a verbatim source was checked against the
current tree: `pause` (CediaRunPauseControl), `git` (GitActionsControl + DiffPanel),
`restart` (stop-plus-start lifecycle), `clear` (Context panel button, seen live),
`copy` (MessageCopyButton), `open` (linkChips lib + usages), goal show/budget
(header details query + budget mutation) all name surfaces that exist. One claim was
false and is fixed: bare `/drop` deletes the session and starts a new one — it is not
goal-drop — so the row now reads `explicitly_excluded` citing the no-delete durability
model (§2.6, item 1d) instead of the goal header. No gap count changes either way; the
audit exists so the next reader does not have to trust the reconstruction.
