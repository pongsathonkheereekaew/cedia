# Packaged Task-controls capture (all 13 Cedia surfaces in place) — 2026-09-27

Closes the "no packaged capture" limit ~27 O-slice receipts name: the composer
`Task controls` disclosure now opens in the packaged run and every Cedia surface
renders from the live host (fixture OMP). §10 item 70 owns status. No provider,
no spend.

## Done

- `scripts/agent-window-panels-smoke.ts` (default = packaged Electron run): after the
  context-meter step, clicks the `Task controls` summary, waits, screenshots
  `dist/agent-window-panels-smoke/task-controls-open.png`, and records the
  `[aria-label]` inventory of `.cedia-surface-stack` into `result.json:taskControls`.
- Two smoke-harness fixes on the way (no product code): the Automations row is
  capability-gated (`integration_missing` hides it — assert absence-or-honest-disabled,
  not presence); the theme painted-surface tie (white card in both modes) is a recorded
  finding, not a failure (`--background` token still must flip).
- Product fix: `Sidebar.tsx` primary row now forwards `disabledReason` as
  `aria-description` (the reason lived only on the label span's `title`, invisible to
  the row query). Vendor tsc clean; `git diff --check` clean.

## Observed (packaged, fixture OMP)

- Disclosure opens (`taskControls.open: true`); 27 aria-labels across all 13 surfaces:
  plan mode, progress, advisor, agents, queue, side question (ask/branch/copy),
  cleanse (request/run/abort), rule forging (complaint/draft), shell (language +
  command), tree, tool catalog, context, usage (refresh + saved resets).
- Surfaces render honest absence against the fixture runtime ("Plan mode unavailable —
  the live OMP runtime does not advertise the Cedia plan bridge", etc.); the capture
  proves placement/rendering, not live-bridge data (the O-slice smokes prove each
  bridge against the real runtime).
- Full smoke green: `Agent Window panel smoke passed`, `providerCalls: 0`.

## Preserved

- D1–D5, deferred voice, W/N deferred per owner. `switchSession`/`browser-relay`
  untouched. Nothing committed.
