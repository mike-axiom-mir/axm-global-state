# Action Report — Proof 003: long-absence boundary scaling

Date: 2026-09-15
Status: **LOCAL TEST PASS / CI PENDING / EXPERIMENTAL**

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

## Local evidence

The existing Proof 001 and portability-contract tests remain green locally. Proof 003 also passes locally and checks that measured execution produces exactly the same canonical state as ordinary `advanceCatchup(...)`.

Observed structural results:

| Interval | Elapsed ticks | Catch-up jumps | Per-tick transitions avoided | Recurring events |
| --- | ---: | ---: | ---: | ---: |
| 1 minute | 60 | 3 | 57 | 1 |
| 1 hour | 3,600 | 64 | 3,536 | 60 |
| 1 day | 86,400 | 1,444 | 84,956 | 1,440 |
| 30 days | 2,592,000 | 43,204 | 2,548,796 | 43,200 |
| 1 year | 31,536,000 | 525,604 | 31,010,396 | 525,600 |

The one-year fixture therefore avoids about 98.33% of the individual per-tick transitions even though it deliberately contains a meaningful recurring event every 60 ticks.

The one-year canonical digest is `fnv1a32:bd25b8b4`.

## Important interpretation

This is a **structural work-count proof**, not a wall-clock performance benchmark.

The current `nextBoundary(...)` implementation still scans the small completion/command arrays while finding the next boundary. A future world with very large event journals will need an indexed/scheduled boundary structure rather than assuming these small-list costs remain constant.

The proof establishes that the kernel does not inherently require one transition per empty elapsed tick. It does not establish final scale/performance for a large product.

## Truth boundary

Not yet claimed by this report:

- CI evidence on the branch head;
- browser parity after the instrumentation change;
- production performance;
- millions of scheduled commands/events;
- aggregate closed-form skipping of recurring events themselves;
- distributed/shared authority;
- first RTS consumer integration.

## Next safe rung after CI

Once exact-head Node + Chromium regressions remain green, the general kernel is ready for the first bounded external consumer adapter. The intended candidate remains one aggregate economy/city state from `axm-global-state-rts`, without moving RTS product rules into this repository.
