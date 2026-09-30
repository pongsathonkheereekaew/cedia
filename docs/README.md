# CEDIA documentation

There is exactly **one** authoritative plan and spec:
[maintenance/CEDIA-PLAN.md](maintenance/CEDIA-PLAN.md)

Checkout is `/Users/pond/cedia` on branch `main`.

## Current sources

| Topic | File |
|---|---|
| Project agent rules and documentation entry point | [AGENTS.md](../AGENTS.md) |
| Shared agent preferences (canonical file; home/editor links point here) | [../.agents/AGENTS.md](../.agents/AGENTS.md) |
| **Product definition + architecture + workspace surface contract + settings/ownership + R1–R8 (including the full pinned-OMP F gate and O01–O12 packets) integration sequence + open work** | [maintenance/CEDIA-PLAN.md](maintenance/CEDIA-PLAN.md) |
| Runtime receipts (scripts write here) | [maintenance/evidence/](maintenance/evidence/) |
| Desktop / OMP pins (`ci-validate` reads this file) | [UPSTREAM-LOCK.md](UPSTREAM-LOCK.md) |
| Workspace identifiers: 198 parents / 75 UI families | [../backlog/requirement-graph.json](../backlog/requirement-graph.json) |
| Per-item evidence referenced by that graph | [../backlog/](../backlog/) |

## Where to start

1. [AGENTS.md](../AGENTS.md) — project rules and invariants.
2. [CEDIA-PLAN.md](maintenance/CEDIA-PLAN.md) — §0 for the definition, then §6 (SSOT), §8 (plan)
   and §10 (what is open right now).
3. The receipts the plan cites, under `maintenance/evidence/`.

## Documentation rules

- **Everything here is written in English.** There are no `.th.md` files and no mixed-language
  sections; a Thai `.th.md` name is a defect, not a convention. User-facing product copy may still
  be localized — documentation may not.
- `CEDIA-PLAN.md` is the only document that decides new work. If the plan changes, change it there.
- **Do not create a second plan or spec anywhere in this repository.** Superseded documents are
  deleted, not archived: git history is the archive, and a live tree with two owners of truth is
  the failure this rule exists to prevent.
- Receipts live in `maintenance/evidence/` permanently, because scripts and tests reference those
  paths by name.
- `AGENTS.md` owns project working rules; `.agents/AGENTS.md` owns shared preferences. The plan owns product requirements and the open-work list. These responsibilities are distinct; do not copy the full spec into agent instructions.
- READMEs, backlog records, and runtime receipts do not override the product plan. Linked Wayfinder tickets record the owner's answers and rationale; §10 item 69 records completed planning, while item 70 tracks implementation. Read the plan's opening implementation reading contract before executing. A proposal or historical passing receipt does not establish current implementation readiness.
| [`r1-r2-implementation-2026-09-24`](maintenance/evidence/r1-r2-implementation-2026-09-24/findings.md) | Partial R1 host capability/lifecycle and R2 preference-owner implementation; source tests/build passed, packaged app gate failed on stale existing bundle; no D/W/N/F acceptance |
