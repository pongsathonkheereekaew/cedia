# Smoke hardening: window-button restore path + failure diagnostics — 2026-09-26

Upgrades `scripts/agent-window-smoke.ts` so the archive→restore cycle runs
through the window's own Restore button instead of the host API, and so
failures name their cause. No gap change (stays **2**). §10 item 70 owns
status. No provider involvement.

## Changes (shared smoke, both modes)

- Archive via host API (unchanged), then Settings → Archived threads →
  Restore button → "Thread restored" toast → host readback → "Back to
  app" → sidebar row → restored transcript + capture (replaces the
  API-level `restoreSession` + blind reload, which stranded the run on the
  settings route with no thread rows).
- Failure diagnostics: per-page `watch()` (pageerror, console errors,
  HTTP ≥400 with URL, non-aborted `requestfailed` with URL); navigation
  races (`ERR_ABORTED` favicon/icon fetches) filtered as noise. The abort
  filter and URL naming are what identified the batch-31 packaged 404.
- Hung-run hygiene: an 11-minute hung `--native` run (unconditional
  fixture-server `goto` breaking the Electron window context — fixed by
  the Back-to-app path) left a bun driver, a Cedia.app instance, helpers
  and two fixture OMP runtimes alive; all reaped and verified gone
  (`kill -9`, zero residual processes).

## Proof

- Headless green with the button path (`via: "window-button"`,
  worktree/ref/commit recorded); packaged `--native` green with empty
  errors (batch-31). `git diff --check` clean.

## Preserved

- D1–D5, `switchSession` open. Pin unchanged. Nothing committed;
  uncommitted tree preserved.
