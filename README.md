# CEDIA

The Agentic-IDE you own, forked from Code-OSS: the most universal and versatile workspace for
coding tasks and projects. OMP runs on your Mac as the only harness; CEDIA provides the
workspace as one application with an AI window and a full IDE window. Web and iPhone
clients for controlling the same Mac tasks are under development. OMP selects model
providers; Tailscale is the selected remote connection, with gateway/client integration still pending. These targets are
not a claim that all clients and workflows are already verified.

Current work: the plan is a single authoritative document -
[CEDIA-PLAN.md](docs/maintenance/CEDIA-PLAN.md) holds the product definition, the workspace
surface contract, settings/ownership rules, R1–R8 integration with Mac / remote-web / native-iPhone / full pinned-OMP checkpoints, and open work. The feature list below
describes the product target, not a release certification.

> This repository is private. CEDIA is in active personal development for macOS and is not publicly distributed yet.

The complete pinned-OMP integration contract and acceptance gate are in the canonical
[plan §2.8 and §8](docs/maintenance/CEDIA-PLAN.md); intermediate releases do not imply full coverage.

## Features

- **Agent composer** - describe the change, review the diff, accept or steer mid-run.
- **Inline edit** - select code, describe the change, apply it as one undo step.
- **Review and worktrees** - new concurrent Git tasks use separate worktrees. Non-Git tasks and continued terminal sessions can use their original directory, with the shared-file condition made explicit. Review and integration follow the plan's task lifecycle rules.
- **Headless CLI** - drive sessions, turns, approvals, reviews and files from the terminal with JSON output (`cedia-host help`; `rpc` reaches every OMP command).

## Getting Started

Development builds run on macOS. There is no public download yet.

1. Clone this repository.
2. Read [docs/README.md](docs/README.md) for the documentation map.
3. Read [docs/maintenance/CEDIA-PLAN.md](docs/maintenance/CEDIA-PLAN.md) for the current plan,
   §0 for the definition and §10 for open work.

## Built on Code-OSS

CEDIA is built on Code-OSS, so the editor, keybindings, and extensions you already know keep working, with an AI-native layer on top.

## Repository layout

One git repo. Folders are module boundaries, not separate remotes.

- `apps/host` - Mac host service
- `apps/macos` - desktop integration, shared Synara-derived agent UI and Code-OSS extension
- `apps/ios` - iPhone and web remote clients
- `packages/protocol`, `packages/omp-adapter`, `packages/relay` - shared libraries
- `desktop/` and `upstream/` - ignored pinned checkouts, not source of truth
- [docs/README.md](docs/README.md) - documentation map
- [docs/maintenance/CEDIA-PLAN.md](docs/maintenance/CEDIA-PLAN.md) - the plan and spec
- [backlog/](backlog) - workspace identifiers and per-item evidence
- [scripts/](scripts) - repo checks

## Development

The adapter uses Node-compatible TypeScript and Bun for development tests:

```bash
bun install --frozen-lockfile
bun run typecheck
bun test packages/omp-adapter apps/host packages/relay apps/macos/test
bun run smoke:omp
bun run smoke:omp:ui
bun run smoke:omp:g1
```

The first two smoke commands use isolated temporary configurations and local
extension commands without model turns. The G1 host smoke exercises actual OMP
tool turns with deterministic completions from a temporary loopback server;
it performs no external model inference. All accept the pinned baseline OMP 18.4.3 and any
later release (`OMP_BASELINE_VERSION` and `isSupportedOmpVersion` in
`packages/omp-adapter/src/types.ts`). Protocol compatibility does not certify the
full-integration F gate for a newer revision; that gate requires renewed source coverage
and the plan's acceptance evidence.
The Mac build uses the separately pinned
Code-OSS checkout; see the G0 evidence for its exact status.

Run the repo gate before pushing:

```bash
node scripts/ci-validate.mjs
```

See [docs/README.md](docs/README.md) for the documentation map.

## Documentation

- Documentation map: [docs/README.md](docs/README.md)
- Plan and spec: [docs/maintenance/CEDIA-PLAN.md](docs/maintenance/CEDIA-PLAN.md)
- Workspace identifiers and evidence: [backlog/](backlog)

All documentation in this repository is written in English. Superseded plans are
deleted rather than archived, so git history is the only archive.

## Security

This is a private repository. Please do not report security vulnerabilities through public issues. Contact the owner directly.
