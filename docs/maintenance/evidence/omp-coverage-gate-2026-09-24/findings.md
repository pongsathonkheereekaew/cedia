# OMP coverage gate: F's remaining scope, measured — 2026-09-24

§8.2 says F requires the registry-to-surface mapping to be finite and inspectable and names
`scripts/check-omp-coverage.ts` as the artifact that does it. This receipt records that artifact
running on today's tree, and the number it puts on the remaining work. §10 item 70 owns status.

## What the gate is

- `scripts/lib/omp-coverage.ts` (pure) builds the audited record set from the dated audit
  (`docs/maintenance/evidence/omp-complete-scope-2026-09-23`), builds Cedia's own side from the
  adapter command surface, the host capability aggregate and the runtime descriptor table, and
  classifies every record.
- `scripts/check-omp-coverage.ts` is the entry point: it hashes the audit's recorded sources,
  optionally asks a live prepared runtime for its own settings paths, RPC commands and capability
  descriptors, and reports.
- `bun run check:omp-coverage` is the script. It is deliberately NOT wired into
  `scripts/ci-validate.mjs`: the integrity half is a release gate, not a documentation lint.

**Dispositions.** `available` (a real handler or presentation exists), `dependency_unavailable`
(the capability is real but a declared dependency is missing), `integration_missing` (Cedia has
not implemented it), and `unmapped` when no Cedia entry exists at all. Every incomplete record
keeps a reason.

**Two modes, two different questions.** Default mode is the *integrity* gate: the mapping must be
well formed — no orphan Cedia entry without an audited record, no duplicate, no family that is not
`O01`..`O12`, no Cedia family that contradicts the audited one, no audit source that changed
outside the tracked OMP patch, and no live-runtime answer that disagrees with the audit. It passes
today. `--require-complete` adds F's own condition — every audited record has an available Cedia
disposition — and therefore fails today, with the gap list.

## What it measured (revision `0676dd70d54` + working tree)

```
bun scripts/check-omp-coverage.ts
OMP coverage: 1041 audited records; 1041 Cedia mappings.
Live runtime: checked omp/18.1.18; 498 settings, 50 audited RPC commands and 10 capability descriptors read.
Integrity PASS: 0 fatal issue(s); 953 audited records without an available Cedia disposition.
```

Gap totals by kind: `setting` 498, `slash-subcommand` 108, `sdk` 106, `slash` 79, `launch-flag`
64, `cli` 41, `tool` 31, `event` 3, `cli-alias` 3, `dynamic-tool` 6, `extension-ui` 5,
`slash-alias` 7, `tool-alias` 2. 88 of the 1,041 records already have an available disposition.

`--require-complete` exits 1 and prints those totals with up to 15 example names per kind, so the
next slice can be chosen from the list rather than from memory.

## Evidence

| Command | Result |
|---|---|
| `bun scripts/check-omp-coverage.ts` | exit 0 — integrity pass, 1,041 records, 953 gaps |
| `bun scripts/check-omp-coverage.ts --require-complete` | exit 1 — the F gate, with the actionable gap list |
| `CEDIA_OMP_BINARY=<missing> bun scripts/check-omp-coverage.ts` | exit 0 with an absent-runtime note: no runtime is a stated reason, not a failure |
| `bun test scripts/lib` | 54 pass, 0 fail (fixtures for unmapped, orphan, duplicate, invalid family, unclassified, stale hash and a well-formed pass) |
| `bun build scripts/check-omp-coverage.ts --target bun` | passes |
| `git diff --check` | clean |

## Deliberate limits, stated rather than hidden

- The audit's recorded source hashes predate the tracked OMP patch, so the exact paths
  `patches/omp/0001-cedia-rpc-bridges.patch` touches are exempt from the stale-hash check. The
  exemption is parsed from that patch and applies to nothing else: a change to any other audited
  source still fails `stale_source`, and the pure hash helper itself keeps its strict behaviour
  under test.
- Cedia's own bridge-internal commands (`cedia_get_capabilities`, `cedia_control`,
  `cedia_turn_queue`, `cedia_pending_model`) are skipped as audited records for the same reason —
  they are Cedia additions, not part of the stock audit — while a future adapter command that is
  not audited still surfaces as an orphan.
- Static analysis only: dynamic provider/MCP/extension discovery is not enumerated (the audit
  records those as dynamic patterns), and no model or network call is made.
- Passing integrity does not mean F is close: the gap list is the work, and 953 records are still
  on it.
