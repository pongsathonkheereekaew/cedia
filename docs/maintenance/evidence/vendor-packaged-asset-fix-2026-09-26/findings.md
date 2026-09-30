# Packaged missing-asset fix: info-circle → circle-info — 2026-09-26

A real defect found by the new smoke URL diagnostics (batch-21 harness
hardening): the packaged app 404'd
`.../out/vs/cedia/agent/central-icons-reversed/info-circle.svg`, referenced
by the Capability-status settings nav item, with no such file shipped
upstream. The glyph exists as `circle-info.svg` in both Central variants —
an upstream naming slip, fixed by retargeting the one reference
(`settingsNavigation.ts`). A tree-wide sweep for other Central names
without shipped files found no further genuine miss (`commit`/`pr`/`sync`/
`test` hits are action ids and test content; `compose-pencil` resolves via
the default variant; two regex false positives are className strings).

## Proof

- Headless smoke green; `package:mac` + `check:packaged` all-OK.
- Packaged `--native` green with the fix: `ok: true`, 0 provider calls,
  `errors: []` (the 404 gone), `archiveRestore` present with worktree/ref/
  commit — full flow incl. window-button restore and IDE open/return.
- Both typechecks clean (only the known pre-existing vendor error).

## Preserved

- D1–D5, `switchSession` open. Pin unchanged (reference retarget, no
  vendor upgrade). Nothing committed; uncommitted tree preserved
  (`git diff --check` clean).

## Addendum: sweep closed per-loader (2026-09-26)

Each remaining sweep hit resolved to its loader: `configure`/`lint`/`test`
are internal action ids mapped explicitly to Tabler components in
`ProjectScriptsControl.tsx` (never Central asset names); `commit`/`pr`/
`sync` hits are variable names, action kinds and test content;
`compose-pencil` (`NewThreadIcon`) resolves through the default reversed
variant, which ships. No further genuine miss; the sweep is closed.
