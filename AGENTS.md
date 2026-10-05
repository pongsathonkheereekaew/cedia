# Caret workspace instructions

This file is the living agent SSOT. [HANDOFF.md](HANDOFF.md) is a status pointer. The document map is [docs/README.md](docs/README.md).

- Product: private Mac/iPhone agent app. OMP is the sole harness and the owner of execution and transcripts. Caret owns the host and transport. Code-OSS is the Mac IDE. Codex is the UI reference. iPhone continues the same Mac session.
- Task model: one task is one branch, one worktree, chat, diff, terminal, preview, and archive. Review is a proof package (chat + diff + running result) with the same build identity on Mac and iPhone.
- Layout: one git repo. Folders are module boundaries, not remotes.
- Identifiers: 198 parents and 75 UI families stay in `backlog/requirement-graph.json`. The [archived 9 September baseline](docs/archive/2026-09-09/agent.md) keeps those IDs. It does not expand a bounded task into the entire backlog, and it does not win conflicts with this file.
- Dated plans live in [docs/archive/](docs/archive/README.md). `docs/UPSTREAM-LOCK.md` is a pin ledger, not architecture. Distinguish proposals from implemented behavior.
- Preserve one execution/session owner and provider authentication boundaries. Relay, signing, devices, and paid services need the existing authorization or an explicit missing input.
- Complete the requested slice with evidence from its actual revision and runtime. Report implemented, verified, and externally blocked work separately. Resolve routine local failures within scope.
- For complex work use `astra-orchestrator`: root owns architecture and integration; Luna agents own bounded exploration, implementation, and tests; Astra reviews. Keep file ownership separate. Verify the changed behavior and run `node scripts/ci-validate.mjs` before reporting completion.
- Isolated fixture tests do not call providers.
