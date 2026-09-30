# O12: the coverage checker now speaks the plan's dispositions, and `tuiOnly` is not an exclusion — 2026-09-24

This receipt records a correction to the gate and to a proposal I made from it. The gate had its
own two-word vocabulary and used the audit's `tuiOnly` metadata as a disposition, which §2.2 does
not allow. §10 item 70 owns status.

## Source state

- Workspace `/Users/pond/cedia`, branch `main`, revision
  `0676dd70d54e429b5a72c98cb3f22a46bbd10eb`, dirty with the open slices.
- Changed: `scripts/lib/omp-coverage.ts`, `scripts/lib/omp-coverage.test.ts`,
  `scripts/check-omp-coverage.ts`.

## What was wrong

1. **A private vocabulary.** The checker scored records as `available | dependency_unavailable |
   integration_missing`, while §2.2 settles a per-operation disposition as **integrated**,
   **dependency unavailable**, **platform presentation equivalent**, **owner-only** or **explicitly
   excluded**, with **integration missing** as the state that blocks F. A record Cedia genuinely
   carries is *integrated*; a Cedia surface that replaces a TUI panel is a *platform presentation
   equivalent*; and neither is a gap.
2. **`tuiOnly` treated as scope.** I had left 51 slash records (38 commands, 9 subcommands, 4
   aliases) as gaps and proposed asking the owner whether they were in scope. §2.2 already answers
   that: "TUI rendering, terminal keybindings, gallery/developer fixtures and protocol hosting
   modes (RPC/ACP/print) have CEDIA equivalents or CLI-only developer roles rather than duplicate
   application modes", and the plan's O02/O05/O07 rows require the operations behind those commands
   (resume, fork, plan, goals, provider auth). `tuiOnly` says which surface the *command* is bound
   to; it says nothing about the operation.

## What changed

- `OmpDisposition` is now the plan's five states plus `integration_missing`; the report's `gaps`
  (and therefore `complete`) contains only `unmapped` and `integration_missing`. A new lib test
  pins that: every settled state leaves the record out of `gaps`, and the two unsettled states do
  not.
- Every slash record the audit does not mark reachable over `rpc`/`acp` is classified by the
  **operation behind it**, in a table in the checker where each row names either the Cedia surface
  that carries it or the packet that owes it. Aliases inherit their parent's answer, because
  `providers` is `setup`'s alias and therefore the same operation.
- Classified as `platform_presentation_equivalent` because the surface exists today: `settings`
  (the settings destination over `/v1/settings`), `setup`/`providers` (Settings > Providers over
  `/v1/providers`), `login`, `logout`, `hotkeys` (`Cedia/User/keybindings.json`), `new` (draft
  creation), `resume` (the archive/restore Continue pair), `branch`/`rewind` (conversation rewind),
  `fork` (sidechat), `exit`/`quit`/`q` (§2.7's quit).
- Classified as `explicitly_excluded` with the §2.2 clause as its reason: `debug`, a developer
  fixture panel.
- Left `integration_missing` with the owning packet named: plan/plan-review, goal (+ its six
  subcommands), guided-goal, vibe, loop, queue, agents, hub, collab (+ view/status/stop), join,
  leave, extensions/status, tree, clear, drop, pause, cleanse, copy, open, restart, live.
- **Corrected my own first reading**: `btw`, `tan` and `omfg` are not novelty commands. Their
  descriptions are "ask an ephemeral side question using the current session context", "run a full
  background agent on tangential work" and "forge a TTSR rule from a complaint" - three real
  operations with no Cedia surface, so they are back in scope as `integration_missing`.

## Verification

```
bun test scripts/lib          # 55 pass, 0 fail (includes the disposition rule)
bun run check:omp-coverage    # Integrity PASS; 741 gaps (was 756)
bun test packages/omp-adapter packages/relay apps/host apps/macos/test scripts/lib
                              # 1124 pass, 0 fail
bun run typecheck             # same 10 pre-existing errors, none new
git diff --check              # clean
```

## What remains for this family, and what does not

- The remaining 26 TUI-bound slash commands and 9 of their subcommands still need their
  handler-level mapping: separate the TUI presentation from the underlying OMP operation, then
  either name an existing Cedia surface or keep `integration_missing` with the packet that owes it.
  The rows already say which packet that is; what is missing is the operation-level evidence for
  each handler.
- **No product decision is needed for this family.** The earlier proposal to add a fourth
  disposition keyed on `tuiOnly` is withdrawn: the plan's five states already cover the cases, and
  `tuiOnly` alone never decides scope.
- F is still not claimed, and nothing was renamed from missing to excluded to make the gate green:
  the count moved because 15 records now map to Cedia surfaces that exist (or to the one documented
  developer-fixture exclusion), and every one of them carries a reason.
