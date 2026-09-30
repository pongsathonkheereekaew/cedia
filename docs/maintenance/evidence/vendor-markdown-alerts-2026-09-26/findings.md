# Selective backport batch 6: GitHub-style markdown alerts (#1273) — 2026-09-26

Ports upstream #1273 (`> [!NOTE]`-style alert blockquotes with titled,
icon-bearing callouts). Global vendor pin unchanged
(`33333439c4b9c74d0097bc01196cccc921f67cf3`); our `ChatMarkdown.tsx` verified
byte-identical to the pre-change base before porting. Source: immutable
checkout `a33435c…` (ref verified). No provider involvement. §10 item 70 owns
status.

## What was ported (owned by this slice)

- `lib/remarkGithubAlerts.ts` (new, exact copy): remark plugin tagging alert
  blockquotes (all five kinds, body offsets past blockquote prefixes).
- `components/ChatMarkdown.tsx`: plugin registration, `GITHUB_ALERTS` title +
  icon table, blockquote renderer (plain quotes untouched).
- `index.css`: alert callout styles (uses existing theme vars in both modes).
- `components/ChatMarkdown.alerts.test.tsx` (new): alert renders with title
  and strips the marker, non-alert quotes stay plain, wiki links survive on
  alert first lines (both line endings) — 4 green.
- `lib/icons.tsx`: `LightbulbIcon`/`OctagonAlertIcon` via the file's Tabler
  `adaptIcon` pattern (`IconBulb`/`IconAlertOctagon` — Tabler names differ
  from Lucide, mapped explicitly). No other icon touched.

## Proof

- Alert tests (plain vitest, node): 4 passed.
- Root `tsc --noEmit`: clean. Vendor program: only the known pre-existing
  foreign-file error, untouched.
- Rebuilt bundle + `bun scripts/agent-window-smoke.ts`: PASS (`ok: true`, 0
  provider calls) — alerts code ships without transcript regression.

## Not claimed

- No visual pixel check of callout rendering (static markup + smoke only).
- No other #1273-adjacent work; no wholesale markdown pipeline changes.
