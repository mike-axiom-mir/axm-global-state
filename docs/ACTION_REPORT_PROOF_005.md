# Action Report — Proof 005: provider-neutral mutation agreement

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Prove that shared mutation ordering can remain a small authority layer while deterministic world/software reconstruction remains independent runtime work.

## Implemented

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
- convert accepted proposal IDs into the stable replay command IDs required by the Temporal State Kernel.

## Proof fixture

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

## First failed candidate — preserved repair evidence

The first CI candidate exposed an interface gap rather than being silently rewritten away.

Workflow run `34961897854`, job `104357184790`: **FAIL**.

Cause:

- accepted receipts contained stable `proposalId` values;
- `normalizeAcceptedReceipts(...)` returned the embedded product command without converting that accepted proposal ID into the Temporal State Kernel's required stable command `id`;
- reconstruction therefore failed closed with `invalid-command-id`.

Repair:

- normalized replay commands now use `id = receipt.proposalId`;
- the kernel's existing command-id/idempotence requirement was preserved rather than weakened.

Repair commit: `0864e98ea5e15bb4ee9cc9a8065f528b253a8206`.

## Passing evidence after repair

Proof 005 run `34961982094`, job `104357462159`: **SUCCESS**.

Observed proof evidence:

```text
AXM Global State proof 005 mutation agreement: PASS
checkpointHead: state:fnv1a32:f8df04a3
acceptedRevision: 2
acceptedHead: fnv1a32:e4b47257
finalStateDigest: fnv1a32:bab65c1b
acceptedProposalIds: proposal-a, proposal-b
```

The same repaired head also passed:

- consumer-time-contract regression run `34961982329`;
- Proof 003 long-absence regression run `34961982314`;
- real Node/Chromium portability run `34961982351`, job `104357462767`.

## What this proves

Within this bounded proof:

- mutation admission/order can be separated from world simulation;
- the sequencer does not need to advance world time or hold live product state;
- stale concurrent causal proposals fail closed;
- accepted proposal delivery can be reordered/duplicated by transport and still normalize to one verified sequence;
- independent runtimes reconstruct identical canonical state from the same trusted checkpoint + accepted receipts;
- the stable accepted proposal identity can serve as the downstream replay command identity.

## Truth boundary

This proves only a provider-neutral in-memory agreement seam. It does **not** prove:

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

## Next safe rung

Do not jump directly to P2P consensus.

First prove that the exact accepted-receipt seam survives a replaceable transport adapter while remaining semantically unchanged. A useful next test can compare an in-process transport with a simple browser/WebSocket-style message adapter under deliberate duplicate/reordered delivery, while keeping authority and reconstruction modules untouched.
