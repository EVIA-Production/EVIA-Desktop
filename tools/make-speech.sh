#!/usr/bin/env bash
# Regenerate the bench's test speech.
#
# The generated files are committed explicitly despite the repository-wide WAV
# ignore rule. macOS ships different voices in
# different releases, so regenerating on a new machine would silently change the
# test material and make today's ERLE incomparable with last month's. Run this
# only when you mean to move the baseline, and say so when you do.
#
# Two distinct voices, because the point of the material is that a canceller has
# to tell them apart: `far` is the prospect coming out of the speakers, `near`
# is the rep talking into the microphone.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p aec-speech
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

say -v Samantha -o "$tmp/far.aiff" \
  "Hi, thanks for taking the time today. So right now our sales team is about \
forty people, and honestly the biggest problem we have is ramp time. A new rep \
takes about five months before they hit quota, and we just cannot afford that \
anymore. We looked at two other tools last quarter but neither of them handled \
objection handling in real time."

say -v Daniel -o "$tmp/near.aiff" \
  "Right, that makes sense. Let me ask you something about that. When you say \
ramp time, are you measuring from the first day or from the end of onboarding? \
Because most teams we work with measure it differently, and that changes the \
number quite a lot. Also, how are you tracking it today?"

for name in far near; do
  ffmpeg -y -loglevel error -i "$tmp/$name.aiff" \
    -ac 1 -ar 24000 -c:a pcm_s16le "aec-speech/$name.wav"
done

echo "wrote tools/aec-speech/far.wav and tools/aec-speech/near.wav"
