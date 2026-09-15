# Action Report — Proof 018: partial receipt payload compaction

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Complement Proof 017 checkpoint-epoch compaction with a different bounded mechanism: shrink a partial prefix of accepted receipt payloads **without** requiring a full product-state checkpoint and **without** retiring old proposal IDs.

## Why this is different from Proof 017

Proof 017 is a full-head checkpoint epoch transition. It absorbs prior effects into deterministic state, retires the prior proposal namespace, clears old applied-command metadata, and gives future proposals a new epoch identity. That is the path for actually bounding old identity memory.

Proof 018 instead preserves lifetime retry/conflict semantics for old proposal IDs while dropping their payload-heavy full receipts. It therefore keeps a compact identity index. It is useful when payload reduction is wanted before/without a full state checkpoint, but it does **not** bound identity memory.

The two mechanisms are complementary, not interchangeable.

## Tested mechanism

A validated contiguous receipt prefix is replaced by:

- a later mutation checkpoint revision/head;
- one compact entry per compacted proposal containing only proposal ID, deterministic proposal fingerprint, accepted sequence, and accepted head;
- the un-compacted receipt suffix.

For an exact retry of a compacted proposal, the retry itself supplies the original actor/base/command fields. Matching fingerprint evidence allows deterministic reconstruction of the original accepted receipt, whose accepted head must match retained evidence. Conflicting reuse still fails closed.

The compacted store independently revalidates direct duplicate appends so callers cannot bypass the authority wrapper with altered receipt content.

## Tested fixture

- created 40 sequential payload-heavy accepted proposals;
- compacted receipts 1–32;
- retained full receipts 33–40;
- exact retry of compacted proposal 6 reconstructed the original receipt;
- altered proposal 6 was rejected;
- forged direct append for compacted proposal 6 was rejected;
- retained proposal 36 kept ordinary duplicate behavior;
- proposal 41 was accepted and persisted after compaction;
- restart from compacted evidence and retained suffix preserved behavior;
- tampered compact evidence failed closed;
- suffix requests below compaction revision 32 failed closed.

## CI evidence

Tested candidate head: `6954f06a31252ae1b2acfbca92eaf4b3880ed247`.

Consolidated Global State regression:

- run: `35016334998`
- job: `104540590702`
- result: **SUCCESS**
- Proof 017 checkpoint epoch compaction: **PASS**
- Proof 018 partial receipt payload compaction: **PASS**
- all retained deterministic, durable-history, cold-interval, Chromium portability, browser transport, reconnect, browser restart, cold-resume, and cold-time regressions: **PASS**

Observed Proof 018 output:

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

The measured byte ratio is evidence for this deliberately payload-heavy fixture only. It is not a universal compression claim.

## Important scaling truth

Partial payload compaction does not make history O(1).

If old proposal IDs must preserve lifetime idempotence/conflict semantics, some durable membership/fingerprint evidence remains O(number of compacted proposal IDs).

Proof 017's epoch retirement is the separate mechanism for allowing that identity history to be bounded after a trusted full-head state checkpoint.

## Explicit compaction floor

After compaction through revision 32, requests for receipt suffixes below revision 32 reject. Proof 018 does not pretend a lagging client can reconstruct from a suffix whose required prefix was removed.

A compatible product/replay checkpoint handoff remains a separate research rung.

## Truth boundary

Proof 018 is tested experimental evidence, not production persistence or compaction.

It does **not** establish:

- bounded lifetime identity memory;
- lagging-client recovery across the compaction floor;
- product-state checkpoint transfer;
- repeated/cascaded partial compaction;
- production compaction performance;
- cryptographic integrity;
- fsync/power-loss guarantees;
- concurrent writers or distributed consensus.

The current compact evidence/checksum surfaces are deterministic integrity evidence, not cryptographic security primitives.

## Next safe rung

Prove a verified product/replay checkpoint handoff for a client below the partial-compaction floor, then replay only the retained receipt suffix. That would connect partial payload compaction to practical lagging-client recovery without weakening the separate authority-side idempotence evidence.
