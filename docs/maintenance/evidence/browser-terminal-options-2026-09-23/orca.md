# Orca research — 2026-09-23

Scope: whether `stablyai/orca` should be reused inside CEDIA's agent window,
especially the browser and terminal, while OMP remains CEDIA's sole harness.

## Verified facts

- The reviewed `main` commit is [`dac82f6`](https://github.com/stablyai/orca/commit/dac82f61bc710324f8883b11788869b6cf8a0ce2) (2026-09-23). The repository describes Orca as an AI orchestrator/IDE that runs many CLI agents side by side, one per worktree; it explicitly lists OMP among supported agents ([README](https://github.com/stablyai/orca/blob/dac82f61bc710324f8883b11788869b6cf8a0ce2/README.md#supported-agents), [supported agents](https://github.com/stablyai/orca/blob/dac82f61bc710324f8883b11788869b6cf8a0ce2/docs/site/content/docs/agents/supported.mdx)).
- It is a complete Electron application, not a browser/terminal library. Its package has an Electron main entry, native dependencies, and `agent-browser ~0.27.0`; the browser implementation owns the Electron guest lifecycle ([package.json](https://github.com/stablyai/orca/blob/dac82f61bc710324f8883b11788869b6cf8a0ce2/package.json#L1-L12), [browser-backend.ts](https://github.com/stablyai/orca/blob/dac82f61bc710324f8883b11788869b6cf8a0ce2/src/main/browser/browser-backend.ts#L1-L23), [browser-manager.ts](https://github.com/stablyai/orca/blob/dac82f61bc710324f8883b11788869b6cf8a0ce2/src/main/browser/browser-manager.ts#L7-L22)).
- Orca's browser is per-worktree Chromium with tabs, profiles, viewport emulation, downloads, and an agent CLI loop ([browser overview](https://github.com/stablyai/orca/blob/dac82f61bc710324f8883b11788869b6cf8a0ce2/docs/site/content/docs/browser/overview.mdx#L6-L42)). Design Mode captures DOM, computed CSS, screenshot, and source-map location into the active agent context ([design mode](https://github.com/stablyai/orca/blob/dac82f61bc710324f8883b11788869b6cf8a0ce2/docs/site/content/docs/browser/design-mode.mdx#L6-L24)).
- The automation bridge launches a bundled/native `agent-browser` binary or resolves it from `node_modules`/`PATH`, then executes commands through a named helper session over CDP. It has its own daemon idle/restart and stale-session lifecycle ([binary resolution](https://github.com/stablyai/orca/blob/dac82f61bc710324f8883b11788869b6cf8a0ce2/src/main/browser/agent-browser-bridge-process.ts#L10-L47), [command bridge](https://github.com/stablyai/orca/blob/dac82f61bc710324f8883b11788869b6cf8a0ce2/src/main/browser/agent-browser-bridge-execution.ts#L43-L145)).
- Orca's terminal is xterm.js-based, with native `node-pty`; the documented Ghostty feature imports Ghostty theme/font/cursor settings rather than embedding the Ghostty terminal engine ([terminal docs](https://github.com/stablyai/orca/blob/dac82f61bc710324f8883b11788869b6cf8a0ce2/docs/site/content/docs/terminal.mdx#L1-L42), [package dependencies](https://github.com/stablyai/orca/blob/dac82f61bc710324f8883b11788869b6cf8a0ce2/package.json#L179-L187)).
- Orca's Chat UI is an optional transcript/composer over the same agent terminal; the terminal remains its source of truth and OMP is decoded as one of several agents ([native chat](https://github.com/stablyai/orca/blob/dac82f61bc710324f8883b11788869b6cf8a0ce2/docs/site/content/docs/agents/native-chat.mdx#L6-L26)). This is conceptually useful, but its multi-agent launch/status model conflicts with CEDIA's OMP-only execution owner.
- Orca is MIT-licensed ([LICENSE](https://github.com/stablyai/orca/blob/dac82f61bc710324f8883b11788869b6cf8a0ce2/LICENSE)). Its browser helper dependency is a separate Apache-2.0 project; the pinned `v0.27.0` package downloads a platform native binary during install and can download Chrome for Testing ([agent-browser package](https://github.com/vercel-labs/agent-browser/blob/c830d1b67dc18b754e305859f0ae587f858a1447/package.json#L1-L45), [postinstall](https://github.com/vercel-labs/agent-browser/blob/c830d1b67dc18b754e305859f0ae587f858a1447/scripts/postinstall.js#L1-L52), [LICENSE](https://github.com/vercel-labs/agent-browser/blob/c830d1b67dc18b754e305859f0ae587f858a1447/LICENSE)).

## Scrutinize result

The simpler, safer choice is **do not fork or copy Orca's app**. It would add a second
agent lifecycle/orchestration owner, many provider-specific settings, another remote/
telemetry surface (its docs describe paired Remote Orca Servers and PostHog telemetry), and
a large upstream merge burden ([remote server](https://github.com/stablyai/orca/blob/dac82f61bc710324f8883b11788869b6cf8a0ce2/docs/site/content/docs/remote-servers.mdx#L1-L32),
[telemetry](https://github.com/stablyai/orca/blob/dac82f61bc710324f8883b11788869b6cf8a0ce2/docs/site/content/docs/telemetry.mdx#L1-L23)). MIT permits a fork, but the license does not remove those behavioral and maintenance conflicts.

Reuse ideas and narrow contracts instead:

1. **Browser candidate (later, adapt):** keep CEDIA's Electron browser host and OMP adapter. Add a
   task-scoped page registry with per-task tabs/profiles, `snapshot → action → snapshot`,
   stale-ref errors, and optional Design Mode payload `{html, css, screenshot, source}`.
   CEDIA should own the command/approval boundary; never import Orca's competing application orchestration or silently reuse a logged-in
   profile. `agent-browser` is an automation helper, not a model harness. If `agent-browser` is adopted,
   pin and audit it as a small CDP helper, package its native binaries explicitly, and
   route only typed OMP browser capabilities through it.
2. **Terminal candidate (adapt existing features first):** keep CEDIA's own xterm/node-pty surface and separate user
   shell vs OMP agent PTY. Borrow Orca's useful UX: task tabs/splits, bounded scrollback
   restore, copy-context, link actions. Ghostty theme import is only an optional future idea; automatic imports
   would conflict with CEDIA's shared application-theme ownership. OMP owns status, transcript,
   prompts, model/effort, and execution; do not import Orca's multi-agent hooks or launch flags.
3. **Later:** Design Mode source-map capture and CDP viewport/device emulation are good
   follow-up capabilities after the core OMP browser contract is verified. Full Orca
   worktree orchestration, native Chat UI, mobile relay, account switching, telemetry, and
   provider adapters stay out of CEDIA.

## Decision

Use Orca as a **reference implementation**, not as CEDIA's base and not as a runtime
dependency. Adapt the browser/terminal interaction patterns behind CEDIA-owned typed
capabilities; preserve one OMP execution/session owner and CEDIA's own branding, settings,
pairing, and Tailscale gateway. This keeps the useful ideas without importing a competing
application orchestrator or remote/cloud assumptions.
