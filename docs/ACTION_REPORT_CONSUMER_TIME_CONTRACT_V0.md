# Action Report — Consumer Time Contract v0

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Prevent Global State from guessing temporal semantics when adapting external software, games or worlds.

## Candidate contract

A consumer explicitly declares one of three modes:

- `closed-form` — direct elapsed-time reconstruction is part of the proven product semantics;
- `fixed-quantum` — completed canonical temporal quanta are replayed; v0 holds any remainder rather than silently inventing partial semantics;
- `event-boundary` — accepted meaningful boundary ticks are ordered and exposed for product transition handling.

The contract also binds consumer ID, contract version, time unit and rule version. Fixed-quantum mode additionally binds the quantum, phase and remainder policy.

## Why this rung exists now

The first RTS aggregate-city inspection shows why a generic kernel needs this declaration. The current city transition contains history-sensitive state such as starvation/readiness smoothing and floor-based training decisions. A one-shot elapsed-time jump cannot be assumed equivalent to repeated live updates merely because both reach the same wall-clock time.

The Global State layer should expose that requirement instead of silently choosing product behavior.

## Candidate implementation

`src/consumer-time-contract.mjs` adds:

- validated versioned consumer contracts;
- compact closed-form catch-up plan;
- compact fixed-quantum plan with full-step count, applied-through tick and held remainder;
- ordered/deduplicated event-boundary plan;
- fail-closed backward time, invalid mode, missing quantum and misaligned fixed-quantum checkpoint handling.

The planner does not run product rules and does not grant mutation authority.

## Truth boundary

Not yet claimed until CI passes:

- tested integration into any product;
- correctness of a particular RTS city quantum;
- automatic conversion of arbitrary code into one of these modes;
- large event-boundary indexing/performance;
- networking/shared authority;
- production readiness.

The RTS remains responsible for choosing its own temporal semantics. Global State only makes that choice explicit and versioned.
