# Live Thai-IME turn on Muse (packaged) — 2026-10-01

## Result

PASS. The full Thai composition path works end to end on a staged scratch
Cedia.app: the operator typed a Thai prompt into the packaged Agents-window
composer through computer-use, Sent it, and the live
`opencode-go/muse-spark-1.3-contributor` turn (user-approved spend row,
exactly one completed turn) answered `ผมเห็นข้อความของคุณแล้วครับ` with no
CJK substitution. The journal proves the dispatched turn carries the exact
Thai bytes; the window screenshot retains the rendered Thai user bubble
and Thai answer. Zero staged survivors.

Run ID `2026-10-01T10-20-10-486Z`, session `6a421d9f`; artifacts
(`thai-ime-answer.png`, `answer.txt`, `result.json`, Login Item shim log)
under the ignored runtime directory
`dist/live-thai-ime-proof/2026-10-01T10-20-10-486Z/`. Staged app only
(Login Item shimmed, re-signed; installed app never launched), scratch
project/profile, always-ask overlay with no approval arising on the
read-only turn.

## Driver notes (verified, reusable)

- Computer-use `typeText` is Balayout-dependent: with the ABC layout active,
  Thai characters are dropped (only spaces land); switching to the Thai
  layout (Ctrl+Space, verified via `defaults`) makes full Thai composition
  land verbatim. Check the composer value back after every typed input.
- Accessibility observations can report stale "no change" while the action
  actually landed — verify with a fresh full-tree read, not the diff.
- The host journal stores frames FLAT (`frame_json` is the frame); readers
  must use `e.frame ?? e`, not `e.frame` alone.

## Limits

One short Thai turn, Agents window only. Mixed-script paragraphs, IME
inline composition/preedit rendering, Thai search, and IDE-dock composer
Thai input remain open. An earlier same-day attempt failed only on the
flat-frame journal read (fixed); its journal independently confirms the
same Thai question and Thai answer.
