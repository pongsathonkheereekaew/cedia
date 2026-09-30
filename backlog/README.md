# CEDIA workspace identifiers and evidence

This folder is **not a spec**. Per [AGENTS.md](../AGENTS.md) and [docs/README.md](../docs/README.md)
the authoritative plan is [docs/maintenance/CEDIA-PLAN.md](../docs/maintenance/CEDIA-PLAN.md).
What lives here is the workspace identifier graph and the per-item evidence it cites.

## Files

| File | What it is |
|---|---|
| `requirement-graph.json` | The workspace identifier graph: 198 parents, derived from the retired baseline plans. `scripts/ci-validate.mjs` reads it on every gate run and enforces its schema and its evidence links. **Do not move, rename or reshape it.** |
| `*-evidence.md` | Per-item evidence. Each file cited by a child node in the graph is linked from that node's `evidence` field. |
| `command-map.md` | Historical shortcut/conflict baseline and implementation notes; current policy and open work live in the plan. |
| `agent-corpus-baseline.json` | Raw rows behind `Q11-agent-baseline-evidence.md`. |

## Rules

1. Every `evidence` path in the graph must exist; the gate fails on a dangling link. Adding a child
   means adding or reusing a real evidence file.
2. The graph's `source_doc` fields point at the plan, because the baseline documents they were
   derived from were deleted. The graph itself is the surviving record of those identifiers.
3. A status of `verified` requires every child to be `pass`. `blocked-external` never counts as a
   pass.
4. Everything here is written in English, like the rest of the repository.
