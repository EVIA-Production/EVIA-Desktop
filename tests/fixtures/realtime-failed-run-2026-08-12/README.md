# Realtime failure fixture: 2026-08-12

This fixture freezes the production acceptance failure that invalidated macOS
release `v1.0.74` (`a26bf54`) against backend `008ed093`.

## Expected opening

1. Seller/mic: `Start.`
2. Prospect/system: `Weber Praezisionstechnik, Martin Weber am Apparat. Worum geht es konkret? Ich habe gerade hoechstens eine Minute.`
3. Seller/mic: the cold-call opener and response.

## Observed failure

- Prospect/system words survived in the mic transcript as seller speech.
- The opening prospect turn rendered after later seller speech.
- Provider utterances were fragmented into alternating false turns.
- A mic utterance ID was reused and updated an unrelated live row.
- Seller finals triggered prospect-grounded downstream refreshes.

## Evidence files

- `audio-diagnostics-session.jsonl`: exact audio diagnostic window beginning at
  `2026-08-12T02:54:21.169Z` and ending at the last available diagnostic at
  `2026-08-12T02:59:10.790Z`.
- `renderer-acceptance-log.txt`: the complete renderer/user report supplied for
  this failed acceptance run. It includes the rendered transcript and all
  available ListenView/AskView traces.

The source audio diagnostic log remains unchanged at
`~/Library/Logs/Taylos/audio-diagnostics.log`.

## Proven startup timing

- Mic stream acquired: `02:54:22.465Z`
- Mic handler registered: `02:54:22.547Z`
- System capture requested: `02:54:22.552Z`
- System capture ready: `02:54:25.560Z`
- First system audio chunk: `02:54:25.717Z`

The microphone therefore processed audio for about three seconds before the
required system stream was ready. AEC telemetry then repeatedly classified the
reference as silent or unrelated to the microphone. `AEC3 ready` only proved
that the WASM module loaded; it did not prove operational echo cancellation.

This fixture is a pre-fix oracle, not a passing golden transcript. The release
gate must reproduce the scripted dialogue through deterministic full-duplex
audio and demonstrate correct words, speaker attribution, order, identity, and
latency.
