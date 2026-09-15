# Action Report — Proof 012: logical-time evidence chain

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Make the input that advances canonical logical time explicit and verifiable without pretending the proof has solved physical clock accuracy or distributed clock consensus.

Proof 011 established that a runtime can reconstruct a later present after complete process absence **if** it is given a later trusted logical tick. Proof 012 addresses the immediate next boundary:

> How is a later logical-tick claim bound to source, trust model, contract version, and prior accepted time evidence so rollback/conflict/tampering cannot be silently accepted?

## Candidate contract

`src/logical-time-evidence.mjs` introduces `single-source-chain-v0`.

Each evidence record binds:

- `sourceId`;
- `trustScope` (`local-owner` or `shared-authority`);
- versioned `contractId`;
- monotonically increasing evidence `sequence`;
- claimed logical `tick`;
- `previousHead`;
- deterministic evidence `head`.

The deterministic head is test/replay evidence only; it is **not** a cryptographic signature or identity proof.

## Candidate proof

1. trusted time checkpoint begins at sequence `0`, tick `0`;
2. configured shared-authority source emits `E1` at tick `600`;
3. source continuity is restored from `E1` after simulated absence;
4. restored source emits `E2` at tick `86,400`;
5. verifier receives `E2,E1,E1`, deduplicates exact delivery, restores canonical `E1,E2`, and accepts current tick `86,400`;
6. accepted tick is supplied only as the target to the existing Temporal State catch-up kernel;
7. Temporal State produces the same state as an explicit target of `86,400`.

## Required adversarial evidence

The candidate must fail closed on:

- a validly checksummed later sequence whose tick rolls back below the prior accepted tick;
- an issuer attempting an obvious local rollback;
- a missing accepted evidence sequence;
- conflicting reuse of one evidence sequence;
- unexpected source ID;
- unexpected trust scope;
- unexpected time-contract identity;
- changed evidence bytes with unchanged head.

Exact duplicate delivery may be deduplicated idempotently.

## Trust-scope boundary

`local-owner` and `shared-authority` are explicit policy labels, not proofs of honesty.

For a single-owner/local product, the product may explicitly choose a local/user-controlled time source policy. For a shared world, a participant's local wall clock is not automatically canonical merely because the participant can read it.

The verifier prevents one configured trust model from silently masquerading as the other.

## Research basis

The research note `docs/LOGICAL_TIME_EVIDENCE_RESEARCH_V0.md` records the external architectural references. Browser monotonic timers are useful within a runtime but do not by themselves provide durable shared-world time across process/device restart. Distributed systems such as Spanner make clock uncertainty/order guarantees explicit rather than assuming local wall clocks are perfect.

AXM does not claim equivalent guarantees here.

## Truth boundary

Do not claim Proof 012 PASS until exact-head CI succeeds.

Even after a pass, Proof 012 will establish only internally consistent, provenance-bound, monotonic logical-time claims from one configured source. It will **not** prove:

- that the source measured physical time correctly;
- that the source is authenticated or uncompromised;
- protection from an authorized source making a maliciously large forward jump;
- bounded clock drift or uncertainty;
- NTP/PTP/GPS/secure-hardware time correctness;
- signatures;
- multi-source quorum or consensus;
- production cryptographic integrity.

Those remain later research layers above this contract.
