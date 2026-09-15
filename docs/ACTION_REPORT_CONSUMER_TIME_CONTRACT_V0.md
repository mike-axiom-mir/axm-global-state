# Action Report — Consumer Time Contract v0

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Prevent Global State from guessing temporal semantics when adapting external software, games or worlds.

## Tested contract

A consumer explicitly declares one of three modes:

- `closed-form` — direct elapsed-time reconstruction is part of the proven product semantics;
- `fixed-quantum` — completed canonical temporal quanta are replayed; v0 holds any remainder rather than silently inventing partial semantics;
- `event-boundary` — accepted meaningful boundary ticks are ordered and exposed for product transition handling.

The contract also binds consumer ID, contract version, time unit and rule version. Fixed-quantum mode additionally binds the quantum, phase and remainder policy.

## Why this rung exists now

The first RTS aggregate-city investigation proved why a generic kernel needs this declaration. On `axm-global-state-rts` draft PR #159, the same deterministic food-pressured damaged city advanced over the same 43,200 elapsed seconds produced materially different physical/economic results when processed as one large call versus repeated calls.

Observed research evidence on RTS head `efc12037007dd25a0989f8d7d693963e7259ded0`, workflow run `34960805493`, job `104353671023`:

- existing city regression: PASS;
- Global State city-time characterization: `GAP CONFIRMED`;
- one 43,200s call: defense `5,254`, readiness about `0.91059`, starvation about `0.16256`;
- twelve 3,600s calls: defense `11,209`, readiness `0.45`, starvation `1`;
- 720 60s calls: defense `11,209`, readiness `0.45`, starvation `1`, with a small floating accumulation difference in materials versus hourly stepping.

This does not declare the RTS behavior wrong. It proves that the product must explicitly choose its temporal semantics before long offline catch-up can preserve intended behavior.

## Global State implementation

`src/consumer-time-contract.mjs` adds:

- validated versioned consumer contracts;
- compact closed-form catch-up plans;
- compact fixed-quantum plans with full-step count, applied-through tick and held remainder;
- ordered/deduplicated event-boundary plans;
- fail-closed backward time, invalid mode, missing quantum and misaligned fixed-quantum checkpoint handling.

The planner does not run product rules and does not grant mutation authority.

## CI evidence

Candidate head before this report-only evidence update: `5952ed23d26e28c5f661bc1227f24f88a883edcb`.

- consumer-time-contract workflow run `34960969172`: **SUCCESS**;
- Proof 003 long-absence regression run `34960968972`: **SUCCESS**;
- Proof 002 Node/Chromium portability regression run `34960969097`, job `104354197105`: **SUCCESS**.

The deterministic suite includes the new contract selftest plus Proofs 001–003. Chromium continues to reconstruct the committed portable fixture identically to Node.

## Truth boundary

This evidence does **not** prove:

- integrated reconstruction of any product yet;
- correctness of a particular RTS city quantum;
- automatic conversion of arbitrary code into one of these modes;
- large event-boundary indexing/performance;
- networking/shared authority;
- production readiness.

The RTS remains responsible for choosing its own temporal semantics. Global State only makes that choice explicit and versioned.

## Next safe rung

Keep RTS PR #159 as research-only and let its active builders decide the city time policy. In Global State, the next generic research can focus on consumer adapters that compose modes without importing product rules—for example closed-form linear accumulation plus event/fixed boundaries for nonlinear state.
