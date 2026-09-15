# Action Report — Proof 003: long-absence boundary scaling

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Measure whether deterministic catch-up work tracks meaningful crossed boundaries rather than blindly performing one simulation transition for every elapsed logical tick.

The measurement fixture uses one logical tick as one second only for readable test intervals. The Temporal State Kernel itself does not require that unit.

## What this rung adds

`advanceCatchupMeasured(...)` runs the same canonical catch-up transition path and returns a separate, non-canonical metrics object containing:

- elapsed/ticks traversed;
- jump count;
- individual per-tick transitions avoided;
- largest jump;
- eventful boundary count;
- recurring events applied;
- completions applied;
- commands applied;
- total event applications.

Metrics are evidence about execution shape. They are not written into canonical state and therefore do not change the state digest.

## Exact candidate evidence

PR candidate head before this report-only evidence update: `7ca4a5d9b5b4485aa273b889426bf9c73ffc81cf`.

Proof 003 workflow:

- run: `34960310552`
- job: `104352055755`
- result: **SUCCESS**
- runner: Ubuntu 24.04 / Node.js `v22.23.2`

The same code head also passed the existing real Chromium portability regression:

- Proof 002 portability run: `34960310403`
- job: `104352055405`
- result: **SUCCESS**

Observed structural results from the CI log:

| Interval | Elapsed ticks | Catch-up jumps | Per-tick transitions avoided | Recurring events |
| --- | ---: | ---: | ---: | ---: |
| 1 minute | 60 | 3 | 57 | 1 |
| 1 hour | 3,600 | 64 | 3,536 | 60 |
| 1 day | 86,400 | 1,444 | 84,956 | 1,440 |
| 30 days | 2,592,000 | 43,204 | 2,548,796 | 43,200 |
| 1 year | 31,536,000 | 525,604 | 31,010,396 | 525,600 |

The one-year fixture therefore avoids about 98.33% of the individual per-tick transitions even though it deliberately contains a meaningful recurring event every 60 ticks.

The one-year canonical digest is `fnv1a32:bd25b8b4`.

The measured path is required to produce exactly the same canonical state as ordinary `advanceCatchup(...)`; instrumentation is not canonical input.

## Important interpretation

This is a **structural work-count proof**, not a wall-clock performance benchmark and not a claim of 98.33% CPU savings.

The current `nextBoundary(...)` implementation still scans the small completion/command arrays while finding the next boundary. A future world with very large event journals will need an indexed/scheduled boundary structure rather than assuming these small-list costs remain constant.

The proof establishes that the kernel does not inherently require one transition per empty elapsed tick. It does not establish final scale/performance for a large product.

## Truth boundary

This evidence does **not** prove:

- production performance;
- millions of scheduled commands/events;
- aggregate closed-form skipping of recurring events themselves;
- distributed/shared authority;
- first RTS consumer integration;
- arbitrary product simulation determinism.

Browser portability remains bounded to the existing Proof 002 JavaScript safe-integer/fixed-point contract.

## Next safe rung

The general kernel is now ready to investigate its first bounded external consumer adapter. The intended candidate is one aggregate economy/city state from `axm-global-state-rts`, without moving RTS product rules into this repository.

Initial inspection already identifies a useful compatibility question: the current RTS aggregate city uses finite floating-point values and nonlinear updates (starvation smoothing, repair, training floors). Proof 004 must test whether its existing `advance(deltaSeconds)` is chunk-size invariant before any Global State catch-up claim is made. If it is not invariant, that is a product-contract gap to expose rather than silently normalize.
