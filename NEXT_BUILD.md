# AXM Global State — Next Build

Status: **PROPOSED FIRST PROOF**

Do not begin with networking, P2P consensus, a giant world, WebGPU or a database.

The first useful proof should answer one question:

> Can two different reconstruction methods start from the same trusted state and elapsed logical time and produce the exact same final state/evidence?

## Proof 001 — offline catch-up equivalence

Build a tiny deterministic state containing:

- logical tick/time index;
- one producer/consumer resource;
- one scheduled completion event;
- one deterministic recurring event stream;
- one accepted external command with a stable command ID;
- one state digest.

Implement two paths:

### A. Reference stepping

Advance through every logical boundary in order. This path is intentionally slow/simple and acts as the reference oracle for small intervals.

### B. Temporal catch-up

Advance directly across elapsed time where arithmetic is exact, stepping only meaningful event boundaries.

## Required evidence

For a matrix of seeds, starting states, event positions and elapsed intervals:

```text
reference_final_state === catchup_final_state
reference_digest === catchup_digest
```

Also prove:

- replaying the same accepted command ID is idempotent;
- conflicting reuse of one command ID fails closed;
- time cannot silently move backward;
- changing rule version changes provenance and cannot masquerade as the same replay;
- shutdown/reload from serialized checkpoint + journal reproduces the same final digest.

## Proof 002 — browser execution

Once Proof 001 is green in a headless/runtime test, run the exact same fixture in a browser with no special browser-only physics.

Required result:

```text
Node/headless digest === browser digest
```

If floating-point/runtime differences break this, treat that as evidence and tighten the deterministic numeric contract rather than hiding the mismatch.

## Proof 003 — long absence

Demonstrate a deliberately large gap, for example:

- 1 minute;
- 1 hour;
- 1 day;
- 30 days;
- 1 year of logical time.

The catch-up cost should scale primarily with meaningful crossed boundaries/events, not blindly with every empty tick.

## Proof 004 — first consumer adapter

Only after the generic proof is credible, adapt one bounded system from `axm-global-state-rts` as an external consumer.

A good candidate is one aggregate city economy because it already has deterministic food/material production and low-detail state.

Do not move RTS code into this repo merely to make the demo pass. The general kernel should expose a small adapter/transition contract and the RTS should remain its own product experiment.

## Stop condition for first wave

Stop expanding when the repo can truthfully demonstrate:

1. deterministic state reconstruction after offline time;
2. equivalence between reference stepping and eventful catch-up;
3. restart/replay continuity;
4. portable execution in at least two compatible runtimes;
5. explicit truth boundaries around authority and networking.

At that point, review the evidence before adding shared-world networking research to the implementation core.
