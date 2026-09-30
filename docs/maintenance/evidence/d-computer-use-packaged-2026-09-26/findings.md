# D packaged proof by computer use (Sky) — 2026-09-26

First live driving of the packaged app through computer use (`@oai/sky` via node REPL;
the bundled computer-use skill's own SKILL.md path is absent from the plugin cache, so the
wrapper skill's runtime contract was followed and every API shape was probed, never assumed).
Zero provider calls, zero spend, user profile left clean (verified). §10 item 70 owns status.

## Proven live in the packaged app (screenshots in `dist/cua-d-2026-09-26/`)

- Capability status destination renders with honest states (`capability-status.png`):
  Available (app/host lifetime, OMP execution, Tailscale), Needs setup (OMP settings with
  no runtime, inactive workspace cleanup), Not implemented yet (live CLI attach, automations,
  deferred speech-to-text) — each with its reason, matching the §2.3 vocabulary.
- Two windows live: Agents window → IDE button click opens the full workbench (Explorer on
  home, Source Control with the real dirty count, `main* 0 ahead 21` status matching the
  checkout, offline→ready flip).
- IDE AGENT dock opens via the `Agent: Focus on Agent View` palette command and renders the
  compact bundle: Plan strip, Advisor strip ($0/0 msgs), composer, model picker
  (`ide-agent-dock.png`).
- Environment panel (Subagents/Sources/Local Servers/Editor/Open in Cedia IDE), splash with
  the Pangaea-petal mark, composer honest-absence rows and usage honesty rows
  (`environment-panel.png` — since rotated out of tmp; `honest-absence.png` kept).
- Settings center navigation (General/Archived destinations render; archived empty state honest).

## Driving notes (for the next computer-use session)

- Clicks take window-relative logical points; rejected clicks report the attempted screen
  point, which calibrates edges safely (rejections act on nothing). Per-window geometry
  must be re-solved when windows open/close/move; never carry a model across window changes.
- Special keys Tab/Shift+Tab/Escape/Down/Up/Return/F1/comma work; letter keys map through
  the active Thai layout (unusable for shortcuts/text); `type_text({app, text})` is accepted
  but never visibly landed in webviews here; `set_value` rejects every element index tried;
  Backspace/delete key names are unknown (`keyNotFound`).
- The packaged app ignores `CEDIA_STATE_DIR` for reads: `descriptorStateDir` uses the
  `cedia.hostStateDir` setting or the default user state, so `open -n --env` isolation does
  NOT apply — fixture driving must go through the established smoke vehicle (in-process host
  + fresh profile), not env flags. Recorded as a product finding, unchanged by this slice.

## Cleanup (verified, not claimed)

- One stray Thai char typed into a dock composer by a layout probe found via store scan
  (draft `d5f0fd34`) and cleared through the product PATCH route (rev 1 → 2, text now empty).
  Full draft-table scan: all rows empty. Journal since driving began: 0 turn intents; only
  routine terminal-resize/get_state/get_login_providers commands. No send was ever pressed;
  the composer model picker showed real providers throughout and was never dispatched.

## Still open (no gap change, stays 2)

- Same-draft-visible-in-both-windows: blocked on three independent gaps — the dock's thread
  context has no discovered UI path, typing into webviews is unreliable under this layout,
  and dock content is AX-isolated (screenshots only). Headless two-adapter proof stands.
- Live confirm-click: needs a real provider turn (spend) — explicitly not attempted.
- Dirty-file picker UI: unbuilt, not testable. `switchSession`/`browser-relay` untouched.

## Preserved

- D1–D5, deferred voice, W/N deferred per owner. Nothing committed. The app was left running.
