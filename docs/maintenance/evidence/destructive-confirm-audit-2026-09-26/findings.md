# Destructive-confirm audit: §11.1 reset-preview item covered — 2026-09-26

Resolves the D-audit open "reset preview" item by mapping every destructive
or resetting control to its confirm behavior in the current tree. No product
code changed; no gap change (stays **2**). §10 item 70 owns status.

## Mapping (source-verified)

- "Delete all" archived threads: `api.dialogs.confirm` with explicit
  copy ("Permanently delete N archived threads? … forever"); declined =
  no-op; children deleted before parents so mid-flight failure cannot
  strand a subtree (`ConversationStorageSettingsPanels.tsx`).
- Per-row archived delete: inline confirmation (`ArchivedThreadDeleteButton`,
  focus-trapped confirm affordance).
- Per-row setting resets (`SettingResetButton`): immediate-apply by design —
  non-destructive (restores a default value, re-settable, tooltip-labeled
  `Reset <label> to default`). No preview owed; standard control behavior.

## Reading

The §11.1 "reset preview" expectation is satisfied in proportion to risk:
irreversible deletes confirm (twice, at both scopes), reversible resets
apply at once. No confirm/preview gap remains on these surfaces.

## Preserved

- D1–D5, `switchSession` open. Pin unchanged. Nothing committed;
  uncommitted tree preserved (`git diff --check` clean).
