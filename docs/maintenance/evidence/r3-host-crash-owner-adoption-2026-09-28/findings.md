# R3 host crash and surviving owner adoption

**Result:** The provider-free host-process crash/restart slice passes against the prepared OMP
18.1.18 runtime. A new host adopts the same idle task and surviving OMP owner process, then reads
the owner's live summary. No provider request is made. This is a host CLI process proof, not a
packaged Cedia app crash proof or a full D/W/N/F acceptance.

## Runtime proof

Run:

```text
bun run smoke:host-crash-adoption
```

Proof timestamp: `2026-09-28T11:44:23.038Z` (run result directory timestamp). The script started
an isolated host, project and task, then SIGKILLed only its first host process. The idle OMP task
owner stayed alive and authenticated as the same task incarnation. A second host process started
with a new generation and adopted that exact owner.

| Observation | Result |
|---|---|
| OMP runtime | `omp/18.1.18` |
| First / second host PIDs | `80497` / `80506` |
| Surviving OMP owner PID | `80500` |
| CEDIA task / incarnation | `1aa4fea1-2b2e-484d-8cb7-35c6cac8d54d` / `d5276470-cf38-47ae-9752-83d045ad16f4` |
| Adopted owner summary | `available` |
| Provider requests | `0` |

The script verifies that the old host is gone, the OMP PID remains alive, the authenticated owner
identity still matches the task and incarnation, the restarted host generation differs, and the
same task/incarnation/OMP PID are attached after restart. Cleanup signals only the exact scratch
host and OMP processes after checking the private owner record and authenticated endpoint.

## Summary identity regression

The first adoption proof found that the owner's live summary was classified as `conflict`. The
authenticated owner identity correctly reported the CEDIA task id, but OMP `get_state` reports its
own transcript session id. Those identifiers can differ for host-started tasks. The host compared
the summary's transcript id to the CEDIA task id and rejected an otherwise valid summary.

The regression test was first run before the fix and failed with expected `available`, received
`conflict`. After the fix, the targeted test passed:

```text
bun test apps/host/test/omp-owner-attach.test.ts -t "keeps the Cedia task identity separate from OMP's internal summary session id"
```

`readCediaOwnerSummary` now continues to compare the authenticated owner identity against the
probed identity, including task id, incarnation, PID and process-start identity, while treating
the summary session id as OMP's transcript identifier. This preserves the owner identity checks
and removes only the invalid cross-domain equality check.

## Scope and limits

- This proves a host CLI process crash/restart with an **idle** surviving OMP owner.
- It does not prove an active-turn crash, packaged Cedia app crash/adoption, Login Item/background
  launch, or paired-client behavior.
- The loopback model endpoint was a tripwire and received zero requests; no paid provider was used.
- It does not close shared-draft restart or conflicting legacy-draft migration.
- D/W/N/F remain unaccepted. The real Login Item cycle and physical iPhone are still external
  prerequisites; W also needs an off-LAN tailnet run, and F retains §11.1 semantic/dynamic/platform
  evidence.

## Source identity

The checkout was dirty during this proof. Repository `HEAD` was
`0676dd70d54e429b5a72c98cb3f22a646bbd10eb`; these hashes identify the relevant working-tree
sources at the recorded run:

| File | SHA-256 |
|---|---|
| `apps/host/src/owner-endpoint.ts` | `6a1b19cc1ab6dab5fbf64adfefc967f834edc11ee668301afffc0ea629fb2561` |
| `apps/host/test/omp-owner-attach.test.ts` | `02144408d6e9d3f0406e5a76d71c420affb6653b0457f0d698e500df9fc3abbb` |
| `scripts/omp-host-crash-adoption-proof.ts` | `f54de80b81c0ab40396e215680d9bb8c1b52649a7d971402c3d359e6f494d1f7` |
| `package.json` | `91f7ce4e13a0f4f0ff58a69014e0a73cb612f9e537d9d85a1b53f06044fc521d` |

## Verification

- `bun run smoke:host-crash-adoption`: PASS; 23 assertions, OMP 18.1.18, zero provider calls.
- `bun test apps/host/test/omp-owner-attach.test.ts -t "keeps the Cedia task identity separate from OMP's internal summary session id"`:
  PASS after the fix; the same test was red before it.
- `bun run typecheck`: PASS.
- `bun run test`: PASS; 1,431 tests, 8,508 expectations.
- `bun run check:repo`: PASS; 875 document links, 383 Markdown files, 338 evidence items.
- `bun run check:omp-coverage --require-complete`: PASS; 1,041/1,041 audited mappings,
  498 settings, 50 RPC commands, 73 capability descriptors; source completeness only.
- `git diff --check`: PASS.
