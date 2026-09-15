# Action Report — Proof 005: provider-neutral mutation agreement

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Prove that shared mutation ordering can remain a small authority layer while deterministic world/software reconstruction remains independent runtime work.

## Candidate implementation

`src/mutation-agreement.mjs` adds one bounded `single-sequencer` proof authority.

The sequencer:

- accepts proposals only against its current revision/head;
- emits chained accepted receipts;
- makes duplicate accepted proposal delivery idempotent;
- rejects conflicting proposal-ID reuse;
- rejects stale proposals;
- does not import or mutate Temporal State Kernel state.

`normalizeAcceptedReceipts(...)` lets a runtime receive accepted receipts in shuffled/duplicated transport order, then:

- deduplicate exact repeats;
- restore canonical sequence;
- verify contiguous revision progression;
- verify previous-head/based-on-head continuity;
- recompute each deterministic receipt head;
- reject tampering, gaps or conflicting sequence/proposal reuse;
- return the accepted command sequence for reconstruction.

## Candidate proof fixture

Two simulated participants propose against the same initial checkpoint.

- participant A is accepted at revision 1;
- participant B's original revision-0 proposal becomes stale and is rejected;
- participant B explicitly rebases/retries against revision 1 and is accepted at revision 2;
- an exact duplicate A proposal returns the original receipt without consuming another revision;
- conflicting reuse of A's proposal ID fails closed.

Two independent runtimes receive the two accepted receipts in different shuffled/duplicated delivery orders. Both normalize them and reconstruct the same final canonical Temporal State state/digest.

The fixture also rejects:

- missing earlier accepted receipt;
- tampered accepted command with unchanged receipt head;
- conflicting reuse of one accepted sequence.

## Truth boundary

Do not claim Proof 005 PASS until exact-head CI succeeds.

Even after a pass this will prove only a provider-neutral in-memory agreement seam. It will not prove:

- identity/authentication;
- cryptographic signatures;
- production durability;
- hostile-network security;
- multi-host consensus/failover;
- WebSocket/P2P transport;
- CRDT reconciliation;
- automatic conflict resolution;
- production scale/performance.

The current FNV receipt heads remain deterministic test checksums, not security primitives.
