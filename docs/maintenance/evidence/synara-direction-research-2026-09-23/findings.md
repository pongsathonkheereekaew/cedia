# Synara direction research — 2026-09-23

Research date: 2026-09-23 (UTC dates below are taken from the GitHub API). Sources are the upstream repository, issues, pull requests, release records, and source files; this note does not treat a contributor proposal as a maintainer commitment.

## OMP status

- **Released/current main:** There is no OMP provider in `main` at the observed head (`eaa61eded31b6755d4f30ba8eabc5d905cf817cb`, pushed 2026-09-23). The main tree has no OMP adapter/provider docs, and the `v0.9.0` and `v0.9.1` release notes do not list OMP. The latest GitHub release is **v0.9.1**, published 2026-09-22 20:39:44Z; **v0.9.0** was published 2026-09-21 22:52:38Z. Therefore OMP is not a released Synara capability as of this research date.

- **Original request / issue #466:** Opened 2026-07-26 17:07:14Z and still open (last update 2026-07-31 14:25:20Z). It is a contributor request, “Add Oh My Pi (OMP) as an ACP provider?” The visible comments are contributor discussion and testing reports; no maintainer acceptance, merge, or release commitment appears in the issue. On 2026-07-31 the author reported that the implementation had been rebased and split into #496–#499, with focused checks passing and 35 baseline web `localStorage` failures reproduced on upstream main.

- **PR #496:** `feat(provider): add OMP ACP provider`; opened 2026-07-31, still open, non-draft, 7 commits/39 files, `mergeable=false`, `mergeable_state=dirty`, no merge commit, last update 2026-09-13 02:38:13Z. Its body describes the server/provider slice and says #497 is a prerequisite; web support is in cumulative follow-ups. Devin Review’s 2026-09-13 comment reports three bugs and three flags, including stale gateway authority after a turn, missing OMP remaining selectable, chunked UTF-8 corruption, duplicated ACP lifecycle, raw discovery logging, and web support depending on follow-ups.

- **PR #497:** `refactor(provider/acp): generalize session lifecycle helpers`; opened 2026-07-31, still open, non-draft, 1 commit/7 files, `mergeable=true`, `mergeable_state=clean`, no merge commit, last update 2026-07-31 14:24:32Z. It is only the lifecycle-helper prerequisite and does not add OMP by itself.

- **PR #498:** `feat(web): add OMP catalog and thinking picker`; opened 2026-07-31, still open, non-draft, 8 commits/74 files, `mergeable=false`, `mergeable_state=dirty`, no merge commit, last update 2026-09-13 02:32:09Z. Its body says it is cumulative on #496/#497 and should be rebased after prerequisites merge. Devin Review reports five bugs and three flags, including ignored custom OMP directory, unavailable OMP still sendable, corrupted UTF-8 model names, lost `max` effort in drafts, and broad prefetch / cumulative-review concerns.

- **PR #499:** `feat(provider): add OMP model roles picker`; opened 2026-07-31, still open, non-draft, 9 commits/77 files, `mergeable=false`, `mergeable_state=dirty`, no merge commit, last update 2026-09-13 02:26:10Z. Its body says it is cumulative on #498. Devin Review reports ignored custom OMP directory, unavailable OMP still sendable, blank role names breaking discovery, and flags around prefetch and role-selection commit behavior.

- **Canonical descendant / current proposal, PR #1166:** `feat: add Oh My Pi as a first-class provider`; opened 2026-09-13 04:26:25Z, updated 2026-09-22 17:21:19Z, still open, non-draft, **36 commits, 134 files**, `mergeable=false`, `mergeable_state=dirty`, `rebaseable=false`, no reviews and no merge commit. Its own body explicitly calls it the “canonical consolidation,” says it supersedes #496–#499 and the alpha port, and says it is the source of truth for handoff. This is the active implementation proposal, not a landed or released feature.

### PR #1166 evidence and limits

The PR description reports a substantially fuller implementation than #496–#499: OMP ACP adapter/runtime, model and role discovery, web pickers/settings, agent-directory handling, import, tests, and docs. It also records an author-run live desktop exercise against `omp` 18.2.8 (40-model discovery, roles, turns, approvals, plan elicitation, fork, image attachments, subagents, native `/compact`, cancellation, restart/resume, and OMP session import). These are **author-reported PR-description results**, not upstream release evidence or an independent CEDIA runtime test.

The same description records material limits: the real-`omp` E2E suite was included but not run in CI (it needs a locally installed/authenticated `omp`); Computer/AppSnap control was not live-tested; OMP’s own `write`/third-party MCP permission path remains an upstream gap; OMP skills are not surfaced as mentions; and Synara keeps native thread-compaction support false even though OMP’s native `/compact` command was exercised. The PR’s known-gap section also says some browser tests were not run.

## Remote phone/browser access versus polished remote control

The upstream `REMOTE.md` is present on `main` and documents a manual self-hosted path: build the web app, start the server on a LAN/Tailscale address, set an auth token, disable auto-open, and open `http://<machine-ip>:3773` from a phone/tablet/other laptop. It explicitly recommends auth tokens and trusted interfaces. It is a server/browser exposure guide, not a product contract for mobile control of a Mac task.

The main source also contains security/session plumbing beyond the short guide: `pairingBootstrap.ts` consumes a one-time token from `/pair` by POSTing `/api/auth/bootstrap` and then redirects to `/`; the server-side bootstrap credential service records expiry/revocation/consumption; server config rejects non-loopback binds without authentication and requires HTTPS public origin or an explicit insecure-remote opt-in; and `wsTransport.ts` reconnects WebSocket RPC, resets or reuses server-generation cursors, and re-establishes thread streams via snapshots/event replay. Those source paths indicate that a remote browser can reconnect to the same server’s persisted workspace/thread state. They do not by themselves prove a live phone takeover of an in-progress Mac task, cross-device approval handoff, or a polished mobile-specific control surface; no such cross-device runtime was independently tested for this note.

The distinction matters for CEDIA’s requirement: “remote” means a phone/other computer controls the **same running Mac task**, including prompts, results, and approvals; it does not mean SSH execution on another host. The open remote-host RFC #366 proposes running a full Synara server on another machine over SSH (a different product shape), so it is not evidence for the same-running-Mac requirement. Issue #373 proposes opt-in `tailscale serve` for the local server and remains open; its “validated end-to-end from an iPhone” statement is the contributor’s proposal text, not a merged/released guarantee.

## Maintainer commitments and roadmap signal

- Issue #335 (“Web remote control + CLI version”) was closed by maintainer Emanuele-web04 on 2026-07-13 with the comment **“will come this month.”** As of 2026-09-23, the visible release notes (v0.9.0/v0.9.1) do not announce that feature, and the issue has no linked merged implementation. Treat the statement as a historical commitment that lacks shipped evidence, not as current availability.
- Issue #366 (remote hosts over SSH) and issue #373 (`tailscale serve`) remain open proposals with no visible maintainer acceptance date. Their bodies are useful direction signals only. #366 explicitly describes remote execution on another machine, while #373 is an exposure/configuration seam for the local server.
- No dated maintainer commitment to merge OMP #466/#496–#499/#1166 was visible in the queried issue/PR records. The only concrete current status is the open, dirty, superseding PR #1166.

## Harness selection and integrated editing clarification

Synara uses "provider" for a coding-agent runtime such as Codex, Claude Code, Pi, or Droid.
Its provider guides say models are discovered from the installed runtime/account, with
permissions and session behavior varying by runtime. Thus selecting a different model
within the same runtime is distinct from selecting another runtime. In the proposed OMP
integration, OMP is the runtime; its model providers and models form the next selection layer.
An OMP-only product can fix that runtime and expose only OMP's model/provider catalog and
supported effort. This is a proposed product constraint, not a capability of a released
OMP-enabled Synara build.

Source: [Synara provider guides](https://www.trysynara.com/docs/providers), plus the linked
OMP proposal above.

Synara's workspace-editor guide documents syntax highlighting, autosave, undo/redo, conflict
handling, and repository/turn diff scopes. These provide an existing in-app editing surface.
The guide does not establish language-server, debugger, or extension-platform parity; this
reading must not be turned into an unverified claim that those features exist or are absent.

Source: [Workspace editor and diffs](https://www.trysynara.com/docs/features/workspace-editor).

## Separate-editor option

Synara's changelog records native editor discovery and launcher support including Zed.
Zed's CLI supports opening projects and files, so using it as an external editor does not
require embedding an editor in the agent application. This is a supported integration
shape, not a measured performance advantage or a verified Synara-to-Zed handoff here.

Zed also documents external ACP agents and terminal-backed threads. Those are optional
agent surfaces, not evidence that a Zed thread automatically shares a Synara session.
The owner's desired arrangement can keep the AI task in Synara and use Zed only for code.

Sources: [Synara changelog](https://github.com/Emanuele-web04/synara/blob/main/CHANGELOG.md),
[Zed CLI](https://zed.dev/docs/reference/cli),
[Zed external agents](https://zed.dev/docs/ai/external-agents),
[Zed terminal threads](https://zed.dev/docs/ai/terminal-threads).

## Follow-up: one harness, model selection, and integrated editing

Synara uses "provider" to mean a coding-agent runtime. Its task has a provider session,
and that runtime supplies the model catalog, tools, permissions, and session behavior.
Changing a model within one runtime does not inherently require selecting another harness.
CEDIA's clarified requirement is to expose only OMP and obtain model/provider choices from
OMP; a Synara runtime-provider selector and an OMP model-provider selector are different concepts.
Source: [Core concepts: providers, models, and sessions](https://www.trysynara.com/docs/getting-started/core-concepts).

The current upstream editor documentation describes in-app file editing, highlighting,
line numbers, autosave, undo/redo, conflict recovery, and revision/diff inspection.
It does not establish parity with a full IDE's language services, debugger, or extension
ecosystem. Those requirements need an explicit owner decision and separate verification.
Source: [Workspace editor and diffs](https://www.trysynara.com/docs/features/workspace-editor).

Architecture assessment (recommendation, not an adopted design): a Synara-based fork with
a bounded OMP-only policy could inherit shared workspace features when upstream is merged.
Runtime-specific features still require OMP capability mapping and validation. Keeping the
shared UI, storage, and editor close to upstream reduces integration work; importing the
UI into a different application base or replacing the editor substantially increases it.
Future upstream OMP support could replace local adapter changes only after equivalent behavior
is verified. No estimate of merge cost or promise of automatic feature parity is established.

## Follow-up: ACP versus OMP-specific integration

ACP transports an agent's session operations; using OMP over ACP still runs OMP. It does
not require selecting a different harness when selecting a model served through OMP.
ACP supports custom methods, notifications, and capability metadata. Current OMP ACP
source exposes `_omp/` methods for sessions, projects, usage, and extensions. Consequently,
an OMP-specific UI can extend the ACP integration; ACP is not inherently a ceiling on all
OMP-specific features. Sources: [ACP extensibility](https://agentclientprotocol.com/protocol/v1/extensibility)
and [OMP ACP source](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/modes/acp/acp-agent.ts).

The retained CEDIA adapter instead launches `--mode rpc-ui` and declares native RPC
controls including subagent subscriptions/history, steering/follow-up modes, compaction,
host tools, and host URI schemes. Its `cedia_*` terminal/model-role/auth commands are
explicitly separate patched capabilities, not claims about stock OMP. Local evidence:
`packages/omp-adapter/src/client.ts` (launch path) and `packages/omp-adapter/src/types.ts`
(canonical versus patched command sets). These declarations establish available seams,
not that every corresponding CEDIA UI is implemented and verified.

Recommendation for a candidate evaluation: start with the upstream-oriented OMP ACP adapter,
map specific missing user controls/events, and choose extensions or a native RPC adapter
only for demonstrated gaps. Both approaches must preserve one execution/session owner;
do not launch an independent RPC session beside an ACP session to simulate extra controls.
Changing transport adds lifecycle, approvals, replay, cancellation, and compatibility work.

A Synara fork can expose only OMP while retaining upstream multi-provider architecture
internally. An OMP-only backend policy must cover background jobs, automation, writing-model
helpers, and handoffs as well as the composer. This is a proposed integration discipline,
not functionality proved in the current branch. A narrow fork can merge shared upstream
improvements; features tied to another runtime still need adaptation, and no merge-cost
or schedule guarantee follows from choosing a fork.

## Primary sources

- [Repository main](https://github.com/Emanuele-web04/synara/tree/main) and [main commit](https://github.com/Emanuele-web04/synara/commit/eaa61eded31b6755d4f30ba8eabc5d905cf817cb)
- [Issue #466](https://github.com/Emanuele-web04/synara/issues/466)
- [PR #496](https://github.com/Emanuele-web04/synara/pull/496), [PR #497](https://github.com/Emanuele-web04/synara/pull/497), [PR #498](https://github.com/Emanuele-web04/synara/pull/498), [PR #499](https://github.com/Emanuele-web04/synara/pull/499)
- [Canonical OMP PR #1166](https://github.com/Emanuele-web04/synara/pull/1166)
- [v0.9.0 release](https://github.com/Emanuele-web04/synara/releases/tag/v0.9.0), [v0.9.1 release](https://github.com/Emanuele-web04/synara/releases/tag/v0.9.1)
- [REMOTE.md](https://github.com/Emanuele-web04/synara/blob/main/REMOTE.md)
- [Headless server / remote-access documentation](https://github.com/Emanuele-web04/synara/blob/main/apps/marketing/content/docs/workflows/headless-server.mdx)
- [Pairing bootstrap source](https://github.com/Emanuele-web04/synara/blob/main/apps/web/src/pairingBootstrap.ts), [WebSocket transport/reconnect source](https://github.com/Emanuele-web04/synara/blob/main/apps/web/src/wsTransport.ts), [server remote-access policy](https://github.com/Emanuele-web04/synara/blob/main/apps/server/src/config.ts)
- [Issue #335](https://github.com/Emanuele-web04/synara/issues/335), [Issue #366](https://github.com/Emanuele-web04/synara/issues/366), [Issue #373](https://github.com/Emanuele-web04/synara/issues/373)
