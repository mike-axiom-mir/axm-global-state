# Action Report — Proof 012: logical-time evidence chain

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Make the input that advances canonical logical time explicit and verifiable without pretending the proof has solved physical clock accuracy or distributed clock consensus.

Proof 011 established that a runtime can reconstruct a later present after complete process absence if it is given a later trusted logical tick. Proof 012 addresses the immediate next boundary:

> How is a later logical-tick claim bound to source, trust model, contract version, and prior accepted time evidence so rollback/conflict/tampering cannot be silently accepted?

## Tested contract

`src/logical-time-evidence.mjs` introduces `single-source-chain-v0`.

Each evidence record binds:

- `sourceId`;
- `trustScope` (`local-owner` or `shared-authority`);
- versioned `contractId`;
- monotonically increasing evidence `sequence`;
- claimed logical `tick`;
- `previousHead`;
- deterministic evidence `head`.

The deterministic head is test/replay evidence only; it is not a cryptographic signature or identity proof.

## Tested flow

1. trusted time checkpoint begins at sequence `0`, tick `0`;
2. configured shared-authority source emits `E1` at tick `600`;
3. source continuity is restored from `E1` after simulated absence;
4. restored source emits `E2` at tick `86,400`;
5. verifier receives `E2,E1,E1`, deduplicates exact delivery, restores canonical `E1,E2`, and accepts current tick `86,400`;
6. accepted tick is supplied only as the target to the existing Temporal State catch-up kernel;
7. Temporal State produces the same state/digest as the explicit tick-`86,400` target already exercised by Proof 011.

## CI evidence

Candidate head before this report-only evidence update: `bb003ad3d2d99552cb985fa327841ea51ae0a66c`.

Proof 012 workflow:

- run: `35009785462`
- job: `104518576233`
- result: **SUCCESS**
- runner: Ubuntu 24.04 / Node.js `v22.23.2`
- Proof 011 real Chromium regression: **PASS**

Observed Proof 012 result:

```text
AXM Global State proof 012 logical time evidence chain: PASS
sourceId: shared-clock-proof
trustScope: shared-authority
contractId: proof-012:logical-seconds-v0
acceptedSequence: 2
acceptedTick: 86400
acceptedHead: fnv1a32:76496942
stateDigestAtAcceptedTick: fnv1a32:74f37cf0
rollbackRejected: true
gapRejected: true
sourceMismatchRejected: true
scopeMismatchRejected: true
contractMismatchRejected: true
tamperRejected: true
```

## Adversarial evidence

The tested candidate fails closed on:

- a validly checksummed later sequence whose tick rolls back below the prior accepted tick;
- an issuer attempting an obvious local rollback;
- a missing accepted evidence sequence;
- conflicting reuse of one evidence sequence;
- unexpected source ID;
- unexpected trust scope;
- unexpected time-contract identity;
- changed evidence bytes with unchanged head.

Exact duplicate delivery is deduplicated idempotently.

The rollback fixture is intentionally stronger than a simple tamper test: the sequence-2 rollback claim is issued with a valid deterministic evidence head and correct source/contract metadata, so rejection is specifically due to monotonic-time violation.

## Trust-scope boundary

`local-owner` and `shared-authority` are explicit policy labels, not proofs of honesty.

For a single-owner/local product, the product may explicitly choose a local/user-controlled time source policy. For a shared world, a participant's local wall clock is not automatically canonical merely because the participant can read it.

The verifier prevents one configured trust model from silently masquerading as the other.

## Research basis

`docs/LOGICAL_TIME_EVIDENCE_RESEARCH_V0.md` records the external architectural references. Browser monotonic timers are useful within a runtime but do not by themselves provide durable shared-world time across process/device restart. Distributed systems such as Spanner make clock uncertainty/order guarantees explicit rather than assuming local wall clocks are perfect.

AXM does not claim equivalent guarantees here.

## What this proves

Within the bounded tested contract, one configured source can produce internally consistent logical-time evidence whose sequence, provenance, trust scope, contract identity, monotonic tick progression, and previous-head chain are independently verifiable.

The accepted evidence tick can be handed to Temporal State as a target without embedding clock logic into product/world rules.

## Truth boundary

Proof 012 establishes only internally consistent, provenance-bound, monotonic logical-time claims from one configured source. It does not prove:

- that the source measured physical time correctly;
- that the source is authenticated or uncompromised;
- protection from an authorized source making a maliciously large forward jump;
- bounded clock drift or uncertainty;
- NTP/PTP/GPS/secure-hardware time correctness;
- signatures;
- multi-source quorum or consensus;
- production cryptographic integrity.

Those remain later research layers above this contract.

A next safe rung is a forward-jump/uncertainty policy: make explicit whether a product accepts exact ticks, bounded intervals, maximum uncorroborated advances, or multi-source corroboration rather than silently trusting any arbitrarily large forward claim from an otherwise valid source.
