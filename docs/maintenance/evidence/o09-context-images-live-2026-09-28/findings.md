# O09 live image-context reduction — 2026-09-28

## Result

`bun scripts/omp-context-images-live-smoke.ts` passed against the prepared, source-attested OMP
18.1.18 development runtime. In one isolated host-owned session, a valid 1×1 PNG attachment was
normalized by OMP to a WebP image block. Before the owner invoked
`POST /v1/sessions/:id/context/shake` with `mode: "images"`, the persisted transcript branch
contained that one WebP image. Afterward the branch contained zero image blocks and OMP returned
`imagesDropped: 1` with an available context snapshot.

The smoke read the selected live model state and confirmed the fixture model was
`openai-completions`, advertised `input: ["text", "image"]`, and did not set
`compat.stripImageInput`. The loopback endpoint captured one outgoing `image_url` part on the
first turn. Its URL was a `data:image/webp;base64,...` URI whose decoded payload was 168 bytes and
had the `RIFF/WEBP` signature. After shake, the follow-up provider request contained zero image
parts. The smoke reports only this bounded structural metadata; it does not log payload bytes.

## Data-flow trace

- `apps/host/src/router.ts` passes the commands body to `HostService.command`; the host's
  `#dispatch` in `apps/host/src/service.ts` forwards the prompt payload through the OMP RPC
  client without discarding `images`.
- OMP's `packages/coding-agent/src/modes/rpc/rpc-mode.ts` passes `command.images` to
  `session.prompt`. `AgentSession` normalizes the attachment for the selected model before
  storing the user message. The provider-context transform in `packages/coding-agent/src/sdk.ts`
  applies image budgeting, model normalization and unreadable-image validation before encoding.
- `packages/ai/src/providers/openai-completions.ts` emits supported user image blocks as
  `image_url` parts, using a data URI when no provider URL is supplied. The live model metadata
  and loopback request capture match this path.

The smoke verified that every pre-existing transcript text block remained byte-identical, both
fixture model/config files remained byte-identical, repeating the same command id returned the
identical receipt, and a stale incarnation returned 409 before creating a durable command row. A
post-reduction follow-up turn completed, and its persisted transcript remained image-free while
preserving the seed text, first assistant answer, follow-up text, and second assistant answer.

## Root cause and boundary

The earlier `false` result came from a corrupt PNG fixture, not from a host/RPC/provider conversion
defect. Its IDAT chunk CRC did not match its bytes, and OMP's `dropUnreadableContextImages` guard
correctly replaced it with a text omission marker before provider conversion. The smoke now uses a
valid PNG fixture and asserts both the outgoing WebP image part and the image-free follow-up. No
production code or OMP safety guard was changed.

Both turns used a model fixture bound to loopback only. This proves host → OMP prompt image
forwarding, OMP image normalization, OpenAI-compatible `image_url` serialization to the local
fixture, and OMP image removal from the persisted branch before the follow-up. The canned fixture
does not perform vision inference. No external provider or packaged app was used. This verifies
one O05 prompt-image forwarding/serialization case and one O09 images-mode case, not full O05,
O09 or F acceptance.

## Runtime identity

- OMP version: `18.1.18`
- Runtime kind: development source launcher
- Source revision: `00085d4e7dfdcfbf302c122fa2682b410a0f43d1`
- Attested source tree: `1543a4c9ee84f8e3fb195023a47e1082176200ec`
- Patch manifest SHA-256: `4f9324c38647d37754bee14fc9f7c699807ab5072b37a1bef383110f9dcfed12`
- Launcher SHA-256: `f78a41a46ca6f76240f4e0c6c07dcc9b6537823babbe97cc5872cdc435a1c107`
- Bun SHA-256: `35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5`
- Native runtime SHA-256: `05774ec09950a150b7c1cce63359bd26ed6d3eecc44a6261e09e9403371e7869`

The smoke's final structured output records the same attestation object and exact counts (`before: 1`,
`shakeReportedDropped: 1`, `after: 0`), two loopback chat calls, first-request image metadata
(`image/webp`, data URI, 168 decoded bytes, RIFF/WEBP), no image parts on the second request, and
stale command status 409.
