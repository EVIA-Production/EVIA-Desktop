# Desktop 1.0.69

- A bubble can no longer visibly shrink. The server emits a turn's accumulated
  text, so within one turn the text only grows; anything shorter arriving is a
  stale interim that overtook a newer one, and rendering it produced the brief
  flicker where a sentence shortened and jumped back. Genuine revisions of the
  same or different wording are still accepted.

