# Action Report — Proof 017: compacted accepted history with idempotence continuity

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Reduce retained accepted-history payload without silently losing the ability to recognize an exact old proposal retry or reject conflicting reuse of an old proposal ID after restart.

## Tested mechanism

A validated contiguous prefix of accepted receipts is replaced by:

- a later mutation checkpoint revision/head;
- one compact evidence entry per compacted proposal containing only:
  - proposal ID;
  - deterministic proposal fingerprint;
  - accepted sequence;
  - accepted head;
- the un-compacted receipt suffix.

For an exact retry of a compacted proposal, the retry itself supplies the original actor/base/command fields. If its fingerprint matches the compact evidence, the original accepted receipt is deterministically rebuilt and its accepted head must match the retained evidence. Conflicting reuse of the same proposal ID still fails closed.

The compacted store independently verifies direct duplicate appends as well. Reusing an old proposal ID/sequence/head with changed receipt content is rejected rather than acknowledged as a duplicate.

## Tested fixture

- created 40 sequential accepted proposals with deliberately payload-heavy commands;
- compacted receipts 1–32;
- retained full receipts 33–40;
- retried compacted proposal 6 and reconstructed its exact original receipt;
- changed proposal 6 and received `proposal-id-conflict`;
- forged a direct compacted-receipt append with altered command bytes and received fail-closed rejection;
- retried retained proposal 36 through the ordinary live-receipt path;
- accepted and persisted proposal 41 after compaction;
- reopened only the compacted document plus its trusted compaction checkpoint;
- repeated old compacted retry/conflict behavior after restart;
- recovered revision 41 continuity;
- tampered compact proposal evidence without changing the trusted evidence digest and received fail-closed opening.

## CI evidence

Exact candidate head before this report-only evidence update: `43b48842104a7d4ddf1b38aee841acfbe1c00754`.

Consolidated Global State regression:

- run: `35015585474`
- job: `104538052433`
- result: **SUCCESS**
- Proof 017 result: **PASS**
- all retained deterministic, durable-history, cold-interval, Chromium portability, browser transport, reconnect, browser restart, cold-resume, and cold-time regressions: **PASS**

Observed Proof 017 output:

```text
sourceReceipts: 40
compactedThroughRevision: 32
compactedProposalEvidenceEntries: 32
retainedReceiptPayloads: 9
currentRevision: 41
oldExactRetryReconstructed: true
oldConflictRejected: true
forgedDirectAppendRejected: true
preCheckpointSuffixRequestRejected: true
fullReceiptBytes: 96649
compactedBytes: 23377
byteRatio: 0.242
```

The byte ratio is evidence for this deliberately payload-heavy fixture only. It is not claimed as a universal compression ratio.

## Explicit compaction floor

After compaction through revision 32, `receiptsAfter(revision)` rejects requests below 32.

This is intentional. A client whose verified state predates the compaction checkpoint cannot be recovered from the remaining receipt suffix alone. It needs a compatible product/replay checkpoint. Proof 017 does **not** invent that checkpoint implicitly.

## Important scaling truth

This proof compacts old receipt **payload**, not all historical identity information.

If proposal IDs retain lifetime idempotence/conflict semantics, some durable membership/fingerprint evidence must remain for each compacted proposal. The v0 proof therefore keeps an O(number of compacted proposal IDs) compact identity index.

Future research may explore explicit idempotence windows, hierarchical indexes, checkpoint transfer, or other bounded policies, but Proof 017 does not silently expire old proposal identities.

## Design boundary

The existing v0 `FileReceiptHistory` remains unchanged. Proof 017 adds a separate compacted-history surface and two deterministic mutation-agreement helper exports. Existing receipts and mutation wire schema remain unchanged.

## Truth boundary

This is tested experimental compaction evidence, not production durability.

Proof 017 does **not** establish:

- lagging-client recovery across the compaction floor;
- a product-state checkpoint format;
- repeated/cascaded compaction of an already compacted identity index;
- bounded lifetime identity memory;
- cryptographic tamper resistance;
- hostile local-storage protection;
- fsync/power-loss guarantees;
- concurrent writers or distributed consensus;
- production-scale compaction performance.

The current compact evidence/checksum surfaces remain deterministic integrity evidence, not cryptographic security primitives.

## Next safe rung

Prove a **state/replay checkpoint + compacted receipt suffix** handoff for a client below the compaction floor. The client should adopt a verified checkpoint and then replay only the retained suffix, while the authority continues to preserve old proposal-ID conflict/idempotence evidence independently.
