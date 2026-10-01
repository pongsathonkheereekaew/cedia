# D remainder sweep (tour + slash palette + mixed-script) — 2026-10-01

## Result

PASS. One staged scratch Cedia.app run covered the remaining CUA-only D
items back to back with zero extra spend beyond two tiny live turns:

- Welcome tour: full 4-step flow observed on screen (Welcome → What Cedia
  can do with capability tabs → Add your first project → You're all set
  with shortcuts), completed through to `Start using Cedia`.
- Slash palette: the complete built-in listing captured (~90 commands with
  descriptions, incl. loop/prewalk/btw/tan/omfg/cleanse/agents/hub).
- Composer extras: Add menu (Files and folders, Goal, Plan mode,
  Debug mode).
- Mixed-script turn: one tiny live Muse turn (user-approved row) answered
  exactly `แดง red แดง` — Thai script plus English with no CJK
  substitution — with the packaged window screenshot retaining the render.
  Exactly one completed turn per mixed run, zero staged survivors.

Runners: `scripts/omp-packaged-d-sweep-proof.ts` (tour + panels gates with
per-gate window PNGs) and `scripts/omp-packaged-mixed-proof.ts`
(fully automated mixed turn + screenshot, no CUA driving needed).
Artifacts under the ignored runtime directories
`dist/packaged-d-sweep-proof/2026-10-01T11-33-10-458Z/` and
`dist/packaged-mixed-proof/2026-10-01T11-49-39-635Z/`.

## Driver notes

- The sweep runner initially missed the mixed answer to a completion race
  (turn `completed` before its `message_end` is journaled); a final full
  journal pass before asserting — the same fix as the attachment proof —
  resolves it. Fixed in both scripts.
- `/tools` submitted through the composer shows no visible change and
  leaves no journal trace (purely renderer-local with no catalog to show in
  this fixture); not counted as a panel capture.

## Limits

Armed-state panels with live content (prewalk armed needs @smol auth),
History/Tree with real content, review panel, IDE-syntax-chrome pixel
rules, IME inline preedit, crash-at-every-boundary, and CLI
discovery/attach remain open. Two same-day staged runs died to macOS
memory pressure (~200 MB free on the 8 GB machine); a Sky-launched bare
instance without harness args was caught and killed with zero survivors.
