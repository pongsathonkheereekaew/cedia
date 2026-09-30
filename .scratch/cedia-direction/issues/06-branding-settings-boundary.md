# Define CEDIA branding and the supported settings boundary

Parent: [Choose a coherent Synara-based OMP workspace](../../../docs/maintenance/CEDIA-PLAN.md#wayfinder-map-choose-a-coherent-synara-based-omp-workspace)
Label: wayfinder:grilling
Type: grilling
Status: claimed
Assignee: current owner conversation (Codex)
Blocked by: none

## Question

Which application identity, theme controls, and settings belong in the two-window,
OMP-only CEDIA product, and how will unrelated upstream surfaces stay out when Synara
updates are integrated? Define each setting's actual owner, scope, supported behavior,
and migration/reset semantics before declaring the product direction ready to implement.

## Comments

### Owner concern — 2026-09-23

The owner explicitly asks whether the plan is complete and whether Synara branding or
unused settings will remain mixed into CEDIA. This boundary is not yet fully specified.
The accepted product shape does not resolve its individual settings or integration owners.

### Current source findings — 2026-09-23

These are code observations, not a new packaged-runtime acceptance run.

- `settingsNavigation.ts` still describes Appearance as customizing the theme, while
  `_chat.settings.tsx` renders a read-only theme row directing the user to the IDE.
- The navigation description for Agent providers still describes selecting coding agents
  and managing their CLIs. `ProvidersSettingsPanel.tsx` routes the shipped OMP-only
  descriptor set to `OmpProviderSettingsPanel` before the generic provider panel mounts.
  Generic provider source alone is therefore not evidence that those controls are visible.
- `_chat.settings.tsx` still counts AppSnap, custom models for other harnesses, provider
  visibility/order, and provider-install state when computing changed settings and the
  Restore defaults confirmation. Visibility depends on persisted values differing from
  defaults; this is a remaining migration/reset path to audit, not proof all those panels mount.
- `SynaraLogo.tsx` intentionally preserves the upstream component name while drawing
  CEDIA's mark and accessible name. An internal name is not itself a user-facing brand leak.

Sources:
[settings navigation](../../../apps/macos/agent-window/vendor/synara/apps/web/src/settingsNavigation.ts),
[settings route](../../../apps/macos/agent-window/vendor/synara/apps/web/src/routes/_chat.settings.tsx),
[provider panel](../../../apps/macos/agent-window/vendor/synara/apps/web/src/components/settings/ProvidersSettingsPanel.tsx),
[provider descriptors](../../../apps/macos/agent-window/vendor/synara/packages/shared/src/providerMetadata.ts),
[logo boundary](../../../apps/macos/agent-window/vendor/synara/apps/web/src/components/SynaraLogo.tsx).

### Proposed decision output

Produce a named inventory in the existing authoritative plan, not a second spec. For each
retained setting, record its user-facing label, value owner, application/project/task scope,
real read/write path, capability condition, default/reset behavior, and migration policy.
Cover search results, deep links, onboarding, background effects, and old profiles as well
as the visible Settings sections.

Proposed principles for the owner discussion:

- CEDIA owns product-facing names, marks, onboarding, support, release history, and updater
  routing; upstream provenance and required attribution remain intact. Avoid broad internal
  renaming solely to erase upstream identifiers, which increases merge divergence.
- OMP is the only runtime; model providers are selected within OMP. Unsupported runtime
  controls must not become active through deep links, persisted profiles, or background effects.
- Shared app appearance and shortcuts have one value owner and coherent controls across the
  two windows. IDE-specific editor/language/debug settings retain their IDE implementation.
  The current `workbench.colorTheme` authority remains the existing contract until explicitly
  reconciled with the new Synara-led appearance requirement.
- Show settings only when the selected product and a real implementation support them.
  Unused upstream settings are excluded from navigation, search, reset summaries, and active
  effects; intentionally planned unavailable capabilities follow the plan's honest-state rule.
- Validate fresh and migrated profiles in both packaged windows, including a theme change,
  settings persistence/reset, navigation/search, and zero unintended upstream service requests.
  Re-run the relevant acceptance checks after upstream updates.

Do not close this ticket on a source search or a global string replacement. Its decision
must name the retained settings and owners; implementation/runtime checks remain separate work.

### Confirmed interview decisions — round 2, 2026-09-23

The owner answered 4A, 5A, 6C:

- Shared appearance: one CEDIA theme across the AI and IDE windows, changed once and
  reflected in both. Syntax colors and code fonts remain a later editor-detail question.
- Settings entry: one CEDIA settings center, accessible from both windows, organized into
  general, AI/OMP, and IDE categories. This selects the user experience, not a second
  underlying settings store or a requirement to reimplement every workbench settings control.
- Pending capabilities: keep unsupported-yet applicable Synara features out of normal work
  menus and settings; list them on a separate capability-status page. Enable/add them when
  their integration is ready under the accepted release policy. Other harnesses remain
  outside the product rather than becoming promised future capabilities.

These are requirements for the new direction. Reconcile the old plan's disabled-in-place
entries and read-only Appearance entry when consolidating the final contract. Do not claim
the current build already implements the new settings center or capability-status page.
The per-setting inventory, scopes, and read/write/reset ownership remain unresolved.

### Confirmed OMP settings decision — round 3, 2026-09-23

The owner chose 7A, explaining that CEDIA and OMP should form one integrated system.
Use the existing OMP configuration rather than a separate CEDIA OMP profile: provider/login,
skills, and persistent shared settings remain shared with terminal OMP. Edits to those
shared persistent settings through CEDIA must reach OMP's authoritative configuration.
Per-task model selection remains distinct from changing persistent defaults.

This does not authorize credential copying, a second auth store, or simultaneous independent
execution owners for one session. Import/resume of terminal-created sessions, configuration
reload timing, and concurrent edits still need explicit behavior and verification.

### Confirmed interview decisions — round 13, 2026-09-23

The owner answered A, A, A to questions 37, 38, 39:

- Use Synara's screen structure and components as the primary visual foundation, with
  CEDIA branding and targeted adaptations for OMP, the IDE, and remote clients. Do not
  blend the other reference products into a new visual system by default. This selects
  the visual direction, not the application base, backend ownership, or a rewrite.
- One CEDIA application theme controls the AI and IDE window chrome. Code syntax colors
  and code fonts may be selected independently. An arbitrary IDE theme must not silently
  take over the entire application's appearance. The mapping to existing IDE theme
  settings still requires design and explicit reconciliation with the retained build.
- The shared settings center shows frequently used supported controls first; Advanced
  and search expose the remaining supported controls. Clearly identify each control's
  application, project, or task scope. Advanced is not a place for unsupported features
  or other harnesses. Exclude other-harness settings from navigation, search, and reset
  summaries as well as preventing their activation via legacy values or deep links.

Upstream attribution and internal source names remain distinct from user-facing branding.
The exact inventory, migration/reset behavior, shortcuts, and implementation owners are
still open; these choices do not establish that the current runtime is free of conflicts.

### Confirmed interview decisions — round 14, 2026-09-23

The owner answered A, A, A to questions 40, 41, 42:

- Migrate existing task history, project associations, OMP configuration references, and
  compatible IDE settings. Initialize application appearance and layout according to the
  new design and report settings that were not migrated. Preserve the authoritative shared
  OMP configuration rather than resetting it or creating a second profile. This is a desired
  migration policy, not permission to discard source data or a claim that every historical
  session format can already be imported; unsupported items must be reported and retained.
- Retain familiar Cursor/VS Code-style IDE shortcuts. Common actions such as Send, Stop,
  and opening Settings should behave consistently across the two windows. Provide a common
  shortcut configuration entry and visible conflict reporting, accounting for focus/context
  so editor, terminal, and chat commands are not indiscriminately intercepted.
- Product menus and settings use English. Conversation language remains the user's choice,
  including Thai. This does not add a requirement for translated product UI or a language
  model/harness switch based on the conversation language.

The initial visual reset is distinct from any future Reset settings action. Exact import
compatibility, per-setting ownership, reset scope, and conflict handling still require an
inventory and verification before migration or implementation can be declared ready.

### Bounded source inventory — 2026-09-23

Read-only inspection of the retained build, not packaged-runtime verification or a new
settings contract. Paths below are relative to the repository; vendor web paths begin at
`apps/macos/agent-window/vendor/synara/apps/web/src/`.

| Area | Observed value owner and path | Gap against the chosen experience |
|---|---|---|
| Layout, typography, chat behavior, notification preferences | `appSettings.ts`: `synara:app-settings:v1` localStorage; `updateSettingsAndWait` maps some fields to `api.server.updateSettings` | Cross-window consistency and ownership need verification; local preference persistence is not proof that server-backed controls work |
| Application theme | Code-OSS `workbench.colorTheme`, propagated into the bundle; `_chat.settings.tsx` shows read-only following-IDE status | No shared editable theme control as selected; syntax and chrome separation requires an explicit mapping |
| Shortcuts | `KeyboardShortcutsSettingsPanel.tsx` → adapter `server.upsertKeybinding` → `apps/macos/src/agent-window-keybindings.ts` → `Cedia/User/keybindings.json` | Verify editing, conflict reporting, and contextual dispatch across both windows |
| Models and provider credentials | `OmpProviderSettingsPanel.tsx` and `apps/macos/agent-window/src/cedia-adapter.ts` → host `/v1/models` and provider auth routes; `apps/host/src/provider-auth.ts` delegates credential ownership to OMP | Live model catalog and session selection are distinct from persistent defaults; do not duplicate credentials in UI preferences |
| Skills, MCP, plugins | Adapter skill discovery is session-scoped; sessionless skill catalog and plugin list return empty; no MCP settings control found in inspected navigation | A complete OMP settings center is not present; missing UI/catalog wiring is not evidence that OMP itself lacks the capability |
| IDE settings/extensions | Code-OSS owns editor, syntax, fonts, and extensions | No unified IDE category found in Synara settings; retain workbench capabilities without introducing a second value owner |
| Remote and device enrollment | Host `/v1/remote` and `/v1/devices` routes | No corresponding settings-center category found; simulator/device-pane controls are not paired-device management |

Concrete sources of unwanted settings are broader than visible provider panels:

- `settingsSearchIndex.ts` still indexes legacy provider CLI/update/visibility/install
  concepts and other-harness wording. The OMP-only provider panel does not by itself
  establish clean search results.
- `_chat.settings.tsx` builds `changedSettingLabels` from legacy provider install/activity/
  visibility/order and custom-model arrays. `appSettings.ts` `resetSettings` resets the
  full preference defaults and emits a server patch, preserving the onboarding marker.
- `buildInitialServerSettingsMigrationPatch` in `appSettings.ts` still maps other-harness
  configuration. Migration must use an explicit supported-settings boundary, not blindly
  replay the generic upstream migration into the OMP-only product.
- The CEDIA adapter declares `server.updateSettings` unsupported while generic upstream
  preference code can call it. Synthetic server defaults and local writes therefore cannot
  be treated as a working end-to-end Synara settings backend.

This inventory supports targeted integration work rather than a cosmetic rename. It does
not decide the application base or establish that the entire application must be rewritten.

### Confirmed reset decision — round 16, 2026-09-23

The owner chose 47A: Reset applies only to the selected settings category, with a preview
of the affected values before execution. Explicitly identify when the selected category
changes OMP configuration shared with terminal use. Reset does not delete task history,
workspace files, or authentication credentials. Other-harness and unsupported settings
must not enter the reset payload or preview through legacy profile values.

This resolves the reset experience, not its implementation or the per-setting read/write
ownership mapping. The current global upstream reset must not be represented as satisfying it.


### Planning consolidation draft — 2026-09-23

The owner instructed the agent to start the detailed consolidation. The concrete draft is
in the canonical plan: §6.4 settings/defaults/migration/branding and §8 R2. Existing owner answers remain
accepted; newly proposed technical boundaries/defaults await review. This record links
rationale to that single contract and does not duplicate its requirements. Tailscale is now selected and the behavior interview is complete. Concrete technical
boundaries/defaults await design review; implementation feasibility/dependency gates remain
explicit in the canonical plan. No application implementation,
deployment or current runtime acceptance is implied, and this HITL ticket is not closed merely
because the document was written.
