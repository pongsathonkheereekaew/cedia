# Intake follow-up: environment-navigation commit assessed — 2026-09-26

Assesses the remaining intake-table item (environment navigation commit
`5c0fe49`, "Improve environment task creation and navigation", 2.2k-line
patch read from the release PR). No product code changed; no gap change
(stays **2**). §10 item 70 owns status. No provider involvement.

## Verdict: excluded with the #1256 rationale

Beyond its Computer/CUA driver half (excluded driver scope, batch 16),
the commit is starred-model presets and provider-model options —
Codex/Claude catalog mechanics. OMP owns CEDIA's catalog; the one generic
behavior (a stale advertised pick reads unavailable, never selectable) is
already closed via the D1/item-5a path. The `skillsSettingsModel` +
`SkillsSettingsPanel` thread from the same family is confirmed absent in
this tree (verified this turn), closing that pair as not-applicable rather
than merely deferred.

## Preserved

- D1–D5, deferred voice, `switchSession` open. Pin unchanged. Nothing
  committed; uncommitted tree preserved (`git diff --check` clean).
