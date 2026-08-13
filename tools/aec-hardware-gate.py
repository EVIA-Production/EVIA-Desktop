#!/usr/bin/env python3
"""Does the shipped canceller remove real echo, on this machine, right now?

    python3 tools/aec-hardware-gate.py

Plays speech through the SPEAKERS, records the MICROPHONE, and reports the four
numbers that decide whether AEC can work here - then hands the recording to the
real `Aec3Canceller` and measures what it actually removed.

Two mistakes made this look broken for days, and the gate refuses to repeat
either:

1. **AirPods.** In-ear speakers have no path to the microphone, so there is no
   echo to cancel and every telemetry line reads "REFERENCE SILENT" or
   "REFERENCE UNRELATED". That is a correct reading of an untestable call. The
   gate aborts unless the built-in speakers and mic are selected.

2. **Two clocks.** Driving playback and capture as separate processes puts them
   on independent device clocks with resampling on both sides. Measured on the
   same hardware, minutes apart: coherence 0.002 and 2.0 dB ERLE that way,
   versus 0.708 and 17.5 dB through one full-duplex stream. The rig was broken,
   not the canceller. `sounddevice.playrec` keeps both on one clock.

Requires: sounddevice, scipy, numpy, sox, and a built `dist/main`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import sounddevice as sd
from scipy import signal

RATE = 48_000
AEC_RATE = 24_000
SECONDS = 15
SPEECH = Path(__file__).resolve().parent / "aec-speech" / "far.wav"

# What a working path looks like. Below these the run is reported as a failure
# rather than a number, because a number without a verdict is what let this sit
# broken while everyone read per-window telemetry.
MIN_PEAK_SHARPNESS = 10.0
MIN_COHERENCE = 0.30
MIN_ERLE_DB = 10.0


def require_builtin_devices() -> None:
    inp = sd.query_devices(kind="input")["name"]
    out = sd.query_devices(kind="output")["name"]
    print(f"  input : {inp}\n  output: {out}")
    bad = [n for n in (inp, out) if "airpod" in n.lower() or "bluetooth" in n.lower()]
    if bad:
        sys.exit(
            f"\nABORT: {bad[0]} is selected.\n"
            "  In-ear/bluetooth headsets have no speaker-to-mic acoustic path, so\n"
            "  there is no echo to cancel and this gate would measure nothing.\n"
            "  Select the built-in speakers AND built-in microphone, then re-run."
        )


def probe() -> np.ndarray:
    if not SPEECH.exists():
        sys.exit(f"missing speech probe: {SPEECH}")
    raw = subprocess.run(
        [shutil.which("sox") or "sox", str(SPEECH), "-t", "raw", "-r", str(RATE),
         "-e", "signed", "-b", "16", "-c", "1", "-"],
        check=True, capture_output=True,
    ).stdout
    x = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    return x[: RATE * SECONDS]


def write_wav(path: Path, data: np.ndarray, rate: int) -> None:
    pcm = (np.clip(data, -1, 1) * 32767).astype("<i2")
    subprocess.run(
        [shutil.which("sox") or "sox", "-t", "raw", "-r", str(rate), "-e", "signed",
         "-b", "16", "-c", "1", "-", str(path)],
        input=pcm.tobytes(), check=True, capture_output=True,
    )


def main() -> int:
    print("=" * 68)
    print("  AEC HARDWARE GATE - plays audio OUT LOUD for %ds" % SECONDS)
    print("=" * 68)
    require_builtin_devices()

    x = probe()
    print(f"\n  playing + recording {len(x)/RATE:.0f}s in FULL DUPLEX (one clock)...")
    y = sd.playrec(x.reshape(-1, 1), samplerate=RATE, channels=1, blocking=True)[:, 0]
    y = np.asarray(y, dtype=np.float32)

    rms = lambda a: float(np.sqrt(np.mean(a ** 2)))
    erl = 20 * np.log10(rms(x) / max(rms(y), 1e-12))

    n = 1 << int(np.ceil(np.log2(len(x) * 2)))
    cc = np.fft.irfft(np.conj(np.fft.rfft(x, n)) * np.fft.rfft(y, n), n)[: RATE // 2]
    lag = int(np.argmax(np.abs(cc)))
    sharpness = float(np.abs(cc[lag]) / max(np.median(np.abs(cc)), 1e-12))

    m = min(len(x), len(y) - lag)
    _, cxy = signal.coherence(x[:m], y[lag:lag + m], fs=RATE, nperseg=4096)
    freqs = np.linspace(0, RATE / 2, len(cxy))
    coherence = float(np.mean(cxy[(freqs >= 300) & (freqs <= 3400)]))

    print("\n" + "-" * 68)
    print(f"  ECHO RETURN LOSS   {erl:6.1f} dB   speaker -> mic attenuation")
    print(f"  BULK DELAY         {lag/RATE*1000:6.1f} ms   peak/median {sharpness:.1f}x")
    print(f"  COHERENCE          {coherence:6.3f}      300-3400 Hz")
    print("-" * 68)

    tmp = Path("/tmp")
    write_wav(tmp / "aecgate_far.wav", signal.resample_poly(x, 1, 2), AEC_RATE)
    write_wav(tmp / "aecgate_mic.wav", signal.resample_poly(y, 1, 2), AEC_RATE)

    node = subprocess.run(
        ["node", str(Path(__file__).resolve().parent / "aec-hardware-gate.cjs")],
        capture_output=True, text=True, cwd=str(Path(__file__).resolve().parents[1]),
    )
    if node.returncode != 0:
        print(node.stdout + node.stderr)
        sys.exit("canceller step failed")
    erle = json.loads(node.stdout.strip().splitlines()[-1])["erleDb"]
    print(f"  MEASURED ERLE      {erle:6.1f} dB   what AEC3 actually removed")
    print("-" * 68)

    failures = []
    if sharpness < MIN_PEAK_SHARPNESS:
        failures.append(f"correlation peak {sharpness:.1f}x - playback or capture is not landing")
    if coherence < MIN_COHERENCE:
        failures.append(f"coherence {coherence:.3f} - path is not linearly cancellable")
    if erle < MIN_ERLE_DB:
        failures.append(f"ERLE {erle:.1f} dB below the {MIN_ERLE_DB:.0f} dB gate")

    if failures:
        print("\n  FAIL")
        for line in failures:
            print(f"    - {line}")
        return 1
    print(f"\n  PASS - AEC3 removed {erle:.1f} dB of real echo on this machine")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
