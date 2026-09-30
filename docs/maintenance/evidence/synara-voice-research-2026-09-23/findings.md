# Synara voice transcription research — 2026-09-23

Research basis: upstream `Emanuele-web04/synara` `main` and the peeled annotated tag `v0.9.1^{}` both resolve to commit `eaa61eded31b6755d4f30ba8eabc5d905cf817cb` (2026-09-22). A read-only `git ls-remote` cross-check on 2026-09-23 returned tag object `fec57fd608af83eb1416115a23bf788780626c97`; that object is not a different release commit. The source was inspected without installing dependencies, running Synara, or sending an audio/provider request.

## Verified upstream behavior

- Synara has a reusable composer voice surface. `ComposerVoiceButton` exposes recording, stop, and transcribing states; the controller uses a recorder, a native transcription API, and an `onTranscriptReady` callback ([button](https://github.com/Emanuele-web04/synara/blob/eaa61eded31b6755d4f30ba8eabc5d905cf817cb/apps/web/src/components/chat/ComposerVoiceButton.tsx#L9-L37), [controller](https://github.com/Emanuele-web04/synara/blob/eaa61eded31b6755d4f30ba8eabc5d905cf817cb/apps/web/src/components/chat/useComposerVoiceController.ts#L37-L59)).
- The browser recorder captures microphone input with `getUserMedia`, mono/noise-suppression settings, and Web Audio processing; it returns a normalized 24 kHz WAV payload. This is recording/encoding on the client, not speech recognition ([recorder](https://github.com/Emanuele-web04/synara/blob/eaa61eded31b6755d4f30ba8eabc5d905cf817cb/apps/web/src/lib/voiceRecorder.ts#L98-L153), [payload](https://github.com/Emanuele-web04/synara/blob/eaa61eded31b6755d4f30ba8eabc5d905cf817cb/apps/web/src/lib/voiceRecorder.ts#L234-L257)).
- The controller prewarms and transcribes with a hard-coded `provider: "codex"`. After the result arrives it calls `onTranscriptReady`; the ChatView callback appends the text to the current prompt, updates the cursor, and refocuses the composer ([controller](https://github.com/Emanuele-web04/synara/blob/eaa61eded31b6755d4f30ba8eabc5d905cf817cb/apps/web/src/components/chat/useComposerVoiceController.ts#L182-L218), [submit](https://github.com/Emanuele-web04/synara/blob/eaa61eded31b6755d4f30ba8eabc5d905cf817cb/apps/web/src/components/chat/useComposerVoiceController.ts#L231-L285), [draft insertion](https://github.com/Emanuele-web04/synara/blob/eaa61eded31b6755d4f30ba8eabc5d905cf817cb/apps/web/src/components/ChatView.tsx#L2576-L2608)). The transcript is therefore an editable draft; this flow does not auto-send it.
- The desktop backend starts/queries `codex app-server` for auth, requires `authMethod` `chatgpt` or `chatgptAuthTokens`, and rejects missing/non-ChatGPT auth ([desktop bridge](https://github.com/Emanuele-web04/synara/blob/eaa61eded31b6755d4f30ba8eabc5d905cf817cb/apps/desktop/src/voiceTranscription.ts#L84-L185)).
- The shared transport posts a WAV multipart upload with a Bearer token to `https://chatgpt.com/backend-api/transcribe` ([transport](https://github.com/Emanuele-web04/synara/blob/eaa61eded31b6755d4f30ba8eabc5d905cf817cb/packages/shared/src/chatGptVoiceTranscription.ts#L1-L10), [request](https://github.com/Emanuele-web04/synara/blob/eaa61eded31b6755d4f30ba8eabc5d905cf817cb/packages/shared/src/chatGptVoiceTranscription.ts#L42-L81)). The server-side helper is explicitly named `transcribeVoiceWithChatGptSession` and retries ChatGPT auth on 401/403 ([server helper](https://github.com/Emanuele-web04/synara/blob/eaa61eded31b6755d4f30ba8eabc5d905cf817cb/apps/server/src/voiceTranscription.ts#L1-L43)).
- The latest source tree and workspace manifests contain no Whisper, MLX, ONNX, Vosk, Sherpa, or other local speech-recognition engine. The provider interface marks voice methods optional (`prewarmVoice?`, `transcribeVoice?`), so provider support is not generic ([provider contract](https://github.com/Emanuele-web04/synara/blob/eaa61eded31b6755d4f30ba8eabc5d905cf817cb/apps/server/src/provider/Services/ProviderAdapter.ts#L331-L343)). This is a bounded source-tree observation, not a guarantee about future branches.
- Synara’s own changelog says voice transcription “stays on ChatGPT sessions” and is available where that support exists ([changelog entry](https://github.com/Emanuele-web04/synara/blob/eaa61eded31b6755d4f30ba8eabc5d905cf817cb/apps/marketing/src/data/changelog.ts#L3753-L3767)). No source field selects a transcription language; Thai recognition quality/support is therefore not proven by this repository.

## CEDIA decision impact

- Reuse is sensible for the **composer UI, recording state machine, WAV normalization, cancellation guards, and draft insertion behavior**. Synara is MIT-licensed according to its repository metadata ([repository](https://github.com/Emanuele-web04/synara)). Preserve attribution and check each copied file’s notice when vendoring.
- Do not reuse Synara’s current voice backend unchanged for CEDIA’s requirement. It launches/queries Codex and sends audio to ChatGPT, which introduces the excluded Codex/ChatGPT authentication dependency and violates the selected “local transcription on the home Mac” choice (55A). It would also make voice availability depend on a ChatGPT login even when OMP is the active runtime.
- CEDIA should keep the borrowed UI contract—record, transcribe, insert editable text, then explicit Send—while owning a separate local transcription utility behind the CEDIA host voice endpoint. That utility is a speech component, not a second agent harness. Until that backend is implemented and tested on the home Mac, keep the mic control hidden from working menus and report the capability on the separate status page.
- Synara does not establish local-engine feasibility or Thai performance. The additional engine research below identifies a candidate; measured accuracy and resource costs remain unverified.


## Retained CEDIA source cross-check

The vendored controller at upstream pin `33333439c4b9c74d0097bc01196cccc921f67cf3`
also hardcodes Codex prewarm/transcription and appends recognized text through ChatView.
The CEDIA adapter forwards those requests to `/v1/voice`, but
[`router.ts`](../../../../apps/host/src/router.ts) accepts only `provider: "omp"`, and
[`server.ts`](../../../../apps/host/src/server.ts) injects no production `VoiceEndpoint`.
An injected router fixture is not a working local speech backend. The new design must
adapt capability/auth/endpoint ownership as well as reuse the recorder, rather than
merely change a provider string. No audio inference was run in this check.

## Local-engine feasibility follow-up — 2026-09-23

Read-only `sysctl -n hw.model hw.memsize hw.optional.arm64` returned `Mac15,12`,
`8589934592`, and `1`: Apple Silicon with 8 GiB physical RAM. No model was downloaded,
built or run, and no audio left the machine during this investigation.

- `git ls-remote` pinned whisper.cpp HEAD to `398997ed68095e39a6a0df3bc05c7dd880d0c607`.
  Its [README](https://github.com/ggml-org/whisper.cpp/blob/398997ed68095e39a6a0df3bc05c7dd880d0c607/README.md)
  documents MIT licensing, Apple Silicon/Metal/CPU support and offline inference. The CLI
  example accepts 16-bit WAV and shows a 16 kHz mono conversion. Its small-model estimates
  are 466 MiB disk and approximately 852 MB memory; these are upstream estimates, not CEDIA
  process measurements.
- OpenAI Whisper HEAD was `86098128c0b4f24f0e2aa2994de830614b474227`. Its
  [tokenizer](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/whisper/tokenizer.py)
  includes Thai (`th`); its [README](https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/README.md)
  distinguishes multilingual models from English-only `.en` models and licenses code and
  model weights under MIT. Language support does not establish acceptable Thai accuracy.

Engineering inference: start evaluation with multilingual `small` behind a bounded local
helper, resampling Synara's 24 kHz capture before inference. Keep transcription, not English
translation. Verify asset checksums/notices when acquiring the runtime. Evaluate silence,
Thai, English, mixed programming terms, cold/warm latency, memory pressure alongside IDE/OMP,
and cancellation/cleanup before choosing a shipping model or exposing the microphone.
This supports a no-subscription local candidate, not a working voice capability.
