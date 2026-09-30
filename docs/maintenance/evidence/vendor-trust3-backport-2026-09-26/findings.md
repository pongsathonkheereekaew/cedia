# Selective intake batch 5: approval scope (#1304) — 2026-09-26

Assessed as NO-CHANGE with evidence. No product behavior changed. No provider
involvement. §10 item 70 owns status.

## Why the #1304 bug class cannot occur here

Upstream fixed its adapter setting a session-wide always-allow flag from any
request kind (including tools). CEDIA has no such client-side flag: the
adapter reduces `thread.approval.respond` to a boolean accept/deny
(`cedia-adapter.ts`, approval dispatch) and forwards it through the host UI
respond path, leaving scope entirely to OMP on its own channel. There is no
session-widening bookkeeping to mis-scope, and no substring classifier
anywhere in the approval path (verified by search: no always-allow session
state, no kind-substring matching in adapter/host approval code).

## Why labels were left alone

The intake allows aligning approval labels with OMP's actual scoped grant,
but OMP's per-kind session semantics on the pinned runtime are unverified
here and probing them needs a live approval (answering model — externally
blocked). Inventing per-kind blast-radius copy without that evidence would be
a UI promise broader than the verified grant. The kind prompt table stays
exhaustive at the type level; enforcement stays deferred to OMP as decided.
