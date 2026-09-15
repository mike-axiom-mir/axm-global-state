# AXM Global State — Logical Time Evidence Research v0

Status: **RESEARCH / PROPOSED CONTRACT BOUNDARY**

## Question

Proof 011 established that a compatible runtime can wake from complete process absence, receive a later trusted logical tick, and reconstruct the later present without continuously simulating the cold interval.

The next question is narrower and harder:

> What evidence is a runtime allowed to accept as proof that canonical logical time has advanced?

This document separates that question from deterministic catch-up itself.

## External timing lessons

Two existing timing patterns are especially useful as constraints:

1. Browser `performance.now()` is monotonic within its time origin and is not subject to ordinary wall-clock adjustments, while `Date.now()` is tied to the system wall clock and can be affected by clock skew or user/system adjustments. A per-runtime monotonic timer therefore helps measure local elapsed work but is not, by itself, durable shared-world time across process/device restarts.
   - https://developer.mozilla.org/en-US/docs/Web/API/Performance/now
   - https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/High_precision_timing

2. Distributed systems that need strong real-time ordering do not simply assume every machine clock is perfect. Google Spanner's TrueTime exposes bounded time uncertainty and uses explicit ordering guarantees. AXM Global State should likewise keep the *claim about time* and the *rules for accepting that claim* inspectable rather than treating a local wall clock as unquestioned canonical truth.
   - https://docs.cloud.google.com/spanner/docs/true-time-external-consistency

These sources are architectural references, not dependencies and not evidence that AXM currently provides TrueTime-like guarantees.

## v0 design direction

The smallest useful proof should not attempt NTP, GPS time, consensus, signatures, or clock synchronization.

Instead, define a provider-neutral **logical-time evidence chain**. Each accepted time claim binds:

- a stable source identity;
- an explicit trust scope;
- a versioned time-contract identity;
- a monotonically increasing evidence sequence;
- the claimed canonical logical tick;
- the previous accepted evidence head;
- a deterministic evidence head.

A verifier starts from a trusted time checkpoint and may accept only a contiguous, internally consistent chain.

### Trust scopes

The first contract distinguishes two policy labels:

- `local-owner` — a single-owner/local product has explicitly chosen a local/user-controlled time source policy;
- `shared-authority` — a shared system has explicitly chosen a shared time-evidence source.

The label does **not** prove that the source is honest or accurate. It prevents evidence created under one trust model from silently masquerading as the other.

For a shared world, a client's local wall clock is therefore not canonical merely because the client can read it.

## Required fail-closed behavior

Given a trusted checkpoint, v0 should reject:

- a tick lower than the last accepted tick;
- a missing sequence;
- conflicting reuse of one sequence;
- an unexpected source ID;
- an unexpected trust scope;
- a different time-contract version;
- a broken previous-head chain;
- a changed evidence body with an unchanged evidence head.

Exact duplicate delivery may be idempotently deduplicated.

## What v0 does not prove

Even a green v0 chain proves only that time claims are internally ordered and provenance-bound. It does **not** prove:

- that a source measured physical time correctly;
- that a source cannot lie or be compromised;
- protection against a malicious source jumping far into the future;
- clock-drift bounds;
- secure hardware time;
- NTP/PTP correctness;
- signatures or identity authentication;
- multi-source quorum or consensus;
- cross-device local-owner continuity after a user intentionally resets/migrates the source;
- production cryptographic integrity.

## Proposed Proof 012

Build `single-source-chain-v0` with deterministic test checksums only.

Evidence fixture:

1. trusted time checkpoint at sequence `0`, tick `0`;
2. accepted evidence `E1` at tick `600`;
3. all runtime processes may disappear;
4. restored evidence source emits `E2` at tick `86,400` chained to `E1`;
5. verifier reconstructs the accepted current tick as `86,400`;
6. exact duplicate delivery is harmless;
7. rollback, gap, source mismatch, scope mismatch, contract mismatch, sequence conflict, and tampering all fail closed.

Then use the accepted Proof 012 tick as the explicit target input to the already-merged Temporal State catch-up path. Keep the evidence verifier independent of product/world rules.
