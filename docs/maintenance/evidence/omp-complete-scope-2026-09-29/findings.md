# Full pinned-OMP planning closure — 2026-09-29

This is a dated audit receipt. CEDIA-PLAN.md is the only product specification;
§2.8 defines scope, §8.2 defines the implementation packets and §10 owns unfinished work.
No application implementation, deployment, model request or runtime acceptance was performed.

## Source identity

- OMP 18.4.3 base: `fc671eba383f2a7208500836673b485c0dc7073d`.
- Manifest patch SHA-256: `a90b75f9fbcde9979e68af0ddd9ceca740f3b3720dd93f732f286fdc366782d5`.
- `verifyOmpSource` passed for the full tracked/untracked non-ignored source tree:
  `3b333bd1fea898e8c5c81e6e06d83db26d70d61d`.
- The dirty checkout is exactly the base plus recorded patch.
- `coverage.json` records SHA-256 of 23 directly inventoried source files. Source identity
  does not establish the identity or behavior of a currently running packaged application.

## Coverage evidence

| Companion | Coverage |
|---|---|
| [rpc.md](rpc.md), [rpc.json](rpc.json) | 61 RPC commands, 11 UI methods, 7 host-frame kinds and 28 session events; stock versus CEDIA patch distinguished |
| [tools.md](tools.md), [tools.json](tools.json) | 30 built-in tools, 3 hidden controls, 1 alias and 6 dynamic discovery classes |
| [config-cli.md](config-cli.md), [config-cli.json](config-cli.json) | 516 settings, 82 slash commands, 8 aliases, 120 declared subcommands, 50 top-level CLI commands, 6 aliases and 66 launch flags |
| [sdk.md](sdk.md), [sdk.json](sdk.json) | 106 selected public SDK/service references beyond the RPC inventory; not every internal SDK symbol |
| [coverage.json](coverage.json), [verify.py](verify.py) | 1,101 source-to-plan mappings to O01–O12, with explicit required/equivalent/owner-only/deferred classification; none claims implementation verified |

The verifier compares source names for RPC/settings/slash/CLI/static tools and source hashes,
then checks set equality for all inventory-to-plan mapping categories. It also rejects
unassigned packets and duplicate mappings. This closes the enumerated planning coverage;
it is not the future handler/renderer/runtime coverage checker required by O12.

## Independent contract review

A read-only reviewer examined the new full-integration contract and packet dependencies.
It found one material issue: inherited `codexResets.autoRedeem=yes` could spend credits
through OMP's automatic reset or background sweep paths after usage fetching or rate-limit
handling, despite a UI promise of explicit confirmation.

The plan now requires an OMP session-level CEDIA policy guard, preserving shared terminal
configuration. It must apply before usage subscription and qualified CLI control, survive
reload/reconnect, and deny automatic redemption. O03/O04 acceptance includes inherited-yes
fixtures for usage fetch, rate-limit retry, reload, reconnect and attach; all must produce
zero redemption. Only separately confirmed owner redemption is allowed. No application fix
is claimed here. The reviewer found no other material contract finding in its bounded pass.
## Verification performed

- `python3 docs/maintenance/evidence/omp-complete-scope-2026-09-29/verify.py`: passed;
  1,101 mappings, 23 source hashes and exact named registry sets.
- `bun scripts/check-omp-coverage.ts`: Integrity PASS, 0 gaps.
- `bun scripts/check-omp-coverage.ts --require-complete`: PASS.
- `verifyOmpSource(...)` through the existing `scripts/lib/omp-runtime-integrity.ts`:
  passed with the tree above; it uses temporary indexes and leaves the user's index intact.
- `git diff --check`: passed.

Runtime suites, native-device checks and paid provider tests were not run for this
planning-only change. Those remain explicit implementation acceptance under §10 item 70.
Speech-to-text remains owner-deferred in every language and client. TTS output, native
OMP account providers and OMP jobs are classified separately so unrelated capabilities
are not accidentally removed by that deferral or by the ban on alternate harnesses.
