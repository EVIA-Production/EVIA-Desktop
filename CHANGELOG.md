# Desktop 1.0.68

Fixes a regression shipped in 1.0.67.

- A turn no longer explodes into many small bubbles after a few seconds of
  continuous speech. 1.0.67 froze a partial's timestamp to stabilise ordering,
  which also made it unmatchable once it aged past the matcher's 5s window, so
  every further interim started a new bubble. Liveness and position are now
  tracked separately.
- Together with the deployed backend, a turn's visible text only ever grows: no
  bubble is replaced by the next sentence, and no text double-prints when the
  final lands.
- Unfinished bubbles order by when they were spoken, so they interleave with
  finished ones instead of forming a second list underneath.

