# R3 staged packaged-app crash/relaunch attachment

**Result:** A staged packaged Cedia app was force-killed and relaunched against the same
scratch profile. The relaunched UI showed the existing project and task, and its pre-existing
fixture host still reported the same task incarnation and idle OMP owner PID. The OMP summary
remained readable and the loopback provider received zero requests. This qualifies UI
reattachment to an existing host; it does not qualify the packaged app's ownership or startup of
that host, active-turn recovery, a real Login Item cycle, or D/W/N/F acceptance.

## Runtime proof

Run:

```text
CEDIA_APP_OWNER_ADOPTION_APP_PATH=/var/folders/r7/96w_6l296fnck1z_4vnydbp80000gn/T/cedia-app-owner-adoption-stage.d55NtJ/Cedia.app CEDIA_CUA_OBSERVE_MS=30000 bun run smoke:packaged-app-owner-adoption
```

Proof result directory: `dist/packaged-app-owner-adoption-proof/2026-09-28T12-22-50-527Z/`.
The script started a current-source host in the harness, created an isolated project/task and
started an idle OMP owner, then launched two generations of the staged app against the same
profile. It SIGKILLed only the first staged app process. The source host and OMP owner remained
alive; the second app showed the same project/task and the host still served the exact same
task/incarnation/owner. The CUA inspection independently found `Packaged app owner adoption`
and `Surviving OMP owner` in the staged app's sidebar after relaunch.

| Observation | Result |
|---|---|
| OMP runtime | `omp/18.1.18` |
| First / relaunched staged app PIDs | `86735` / `87169` |
| Harness-owned source host PID / generation | `86724` / `39c993c3-1052-4095-8637-321fad803a44` |
| CEDIA task / incarnation | `e5bb5833-ab28-4974-8822-81f30e1a434b` / `286b304a-a66f-4d7e-bc83-8a4f7eb25205` |
| Surviving OMP owner PID | `86731` |
| Owner summary after relaunch | `available` |
| Provider requests / renderer exceptions | `0` / `0` |

The staged app was copied to a unique temporary directory. The proof patched only that copy's
Login Item calls to record interception and simulate `openedAtLogin: false`, then ad-hoc signed
the staged bundle. It did not launch or modify the repository's installed app and did not invoke
the personal launcher or touch Keychain items. The two recorded Login Item setter interceptions
are test shims, not Login Item evidence.

## Scope and limits

- This proves a packaged UI process crash/relaunch can reconnect to the same already-running
  current-source host and show its durable task row while its idle OMP owner survives.
- The harness owns the host lifetime. This does not prove the packaged app starts/restarts the
  host, or that the host adopts an owner after its own crash; the latter has its own receipt.
- The OMP task was idle. Active-turn crash behavior, real Login Item/background launch, shared
  draft restart and conflicting legacy-draft migration remain open.
- No external provider, paid request, physical device or off-LAN connection was used.
- D/W/N/F remain unaccepted. D still needs a real Login Item cycle and shared-draft restart and
  migration evidence; W needs an off-LAN tailnet run; N needs a physical iPhone; F retains the
  applicable §11.1 semantic, dynamic and platform evidence.

## Source identity

The checkout was dirty during this proof. Repository `HEAD` was
`0676dd70d54e429b5a72c98cb3f22a646bbd10eb`; these hashes identify the relevant working-tree
sources at the recorded run:

| File | SHA-256 |
|---|---|
| `scripts/omp-packaged-app-owner-adoption-proof.ts` | `6116cbc35dcf18ed17cae4c7cf50125a9b25bbc38b5286c78c59ba16ccf67cc0` |
| `package.json` | `1093a4aea5ca751d16d2e2ee0ef43e9c0b169669c601469735c2cb7577c1e9f9` |
| `apps/host/src/server.ts` | `1d816c2a02ad08d84b8c3a1f35b230793de61b49541dea228ce8bd2bd590870b` |
| `apps/host/src/owner-endpoint.ts` | `6a1b19cc1ab6dab5fbf64adfefc967f834edc11ee668301afffc0ea629fb2561` |

## Captures and verification

- [Before app crash](app-before-crash.png) and [after app relaunch](app-after-crash-adoption.png)
  are Playwright captures from the staged packaged app. The after-relaunch screenshot shows the
  project and surviving task in the sidebar.
- Computer Use (`cua.getApp` on the staged bundle) inspected the live app before the crash and
  after relaunch; both accessibility trees exposed the project and task names.
- `CEDIA_APP_OWNER_ADOPTION_APP_PATH=... CEDIA_CUA_OBSERVE_MS=30000 bun run smoke:packaged-app-owner-adoption`:
  PASS; zero provider requests and zero renderer exceptions.
