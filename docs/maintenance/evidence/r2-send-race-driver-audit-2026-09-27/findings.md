# Packaged Send-race driver audit: two prompts came from unstaged drafts — 2026-09-27

A packaged rerun opened the pre-created fixture task in Agents and a second Cedia IDE
window. Disabling Restricted Mode in the scratch profile made the AGENT dock visible.
The IDE composer remained inside a Code-OSS webview that Playwright's IDE Page did not
expose as a frame or webview target. This run therefore used a second in-process
adapter as a diagnostic, not actual dock input. §10 item 70 owns D status.

The diagnostic produced two prompt rows for identical text: adapter command `race-b1`
at `2026-09-27T05:53:19.264Z`, then an Agents command at
`2026-09-27T05:53:20.330Z`. They shared a payload hash, but the scratch host had no
`draft_submissions` row; its draft was empty. Playwright `fill()` made text visible in
the Agents DOM without updating the shared draft owner. Each send therefore bypassed
the same-revision reservation and legitimately created a separate prompt. This is a
driver setup failure, not evidence that production CAS duplicates a reserved send.
The current packaged diagnostic now logs the draft and full prompt identity/timing and
fails on this result instead of reporting D success.

`bun run smoke:send-race` still passes the deterministic fixture with two production
adapter instances: both sends bind one revision to one command, the loser clears
only when its revision matches, and the journal survives restart with one winning
prompt per round. That proves the host/adaptor policy, not the actual packaged
Agents-versus-IDE dock interleave. D's on-screen race remains open. No product code
changed in this audit.
