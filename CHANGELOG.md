# Desktop 1.0.70

- Unfinished bubbles can no longer sink below finished ones. Spoken time and
  arrival time are both epoch milliseconds and so looked comparable, but
  arrival is about a second later than the speech it describes; any row keyed
  by arrival therefore sorted after every row keyed by speech from the same
  moment. All rows are now placed on one scale before sorting, and a row with
  no spoken time is pinned beside the neighbours it arrived among.

