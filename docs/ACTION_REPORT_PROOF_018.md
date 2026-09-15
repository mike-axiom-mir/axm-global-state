# Action Report — Proof 018: partial receipt payload compaction

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Complement Proof 017 checkpoint-epoch compaction with a different bounded mechanism: shrink a partial prefix of accepted receipt payloads **without** requiring a full product-state checkpoint and **without** retiring old proposal IDs.

## Why this is different from Proof 017

Proof 017 is a full-head checkpoint epoch transition. It absorbs prior effects into deterministic state, retires the prior proposal namespace, clears old applied-command metadata, and gives future proposals a new epoch identity. That is the path for actually bounding old identity memory.

Proof 018 instead preserves lifetime retry/conflict semantics for old proposal IDs while dropping their payload-heavy full receipts. It therefore keeps a compact identity index. It is useful when payload reduction is wanted before/without a full state checkpoint, but it does **not** bound identity memory.

The two mechanisms are complementary, not interchangeable.

## Candidate mechanism

A validated contiguous receipt prefix is replaced by:

- a later mutation checkpoint revision/head;
- one compact entry per compacted proposal containing only proposal ID, deterministic proposal fingerprint, accepted sequence, and accepted head;
- the un-compacted receipt suffix.

For an exact retry of a compacted proposal, the retry itself supplies the original actor/base/command fields. Matching fingerprint evidence allows deterministic reconstruction of the original accepted receipt, whose accepted head must match retained evidence. Conflicting reuse still fails closed.

The compacted store independently revalidates direct duplicate appends so callers cannot bypass the authority wrapper with altered receipt content.

## Candidate fixture

- create 40 sequential payload-heavy accepted proposals;
- compact receipts 1–32;
- retain full receipts 33–40;
- exact retry of compacted proposal 6 reconstructs the original receipt;
- altered proposal 6 is rejected;
- forged direct append for compacted proposal 6 is rejected;
- retained proposal 36 still uses normal duplicate behavior;
- proposal 41 is accepted and persisted after compaction;
- reopen from compacted evidence and retained suffix only;
- old retry/conflict behavior remains intact after restart;
- tampered compact evidence fails closed;
- suffix requests below compaction revision 32 fail closed.

## Expected measured fixture result

Earlier candidate evidence on the same payload-heavy fixture measured:

- full receipts: 96,649 bytes;
- compacted representation: 23,377 bytes;
- ratio: 0.242.

That figure must be reproduced by the current rebased exact-head test before it is treated as Proof 018 evidence. It is a fixture measurement, not a universal compression ratio.

## Important scaling truth

Partial payload compaction does not make history O(1).

If old proposal IDs must preserve lifetime idempotence/conflict semantics, some durable membership/fingerprint evidence remains O(number of compacted proposal IDs).

Proof 017's epoch retirement is the separate mechanism for allowing that identity history to be bounded after a trusted full-head state checkpoint.

## Explicit compaction floor

After compaction through revision 32, requests for receipt suffixes below revision 32 reject. Proof 018 does not pretend a lagging client can reconstruct from a suffix whose required prefix was removed.

A compatible product/replay checkpoint handoff remains a separate research rung.

## Truth boundary

Do not claim PASS until the consolidated exact-head regression suite succeeds against current main, including the already-merged Proof 017 epoch-compaction regression.

Even if green, Proof 018 will not establish:

- bounded lifetime identity memory;
- lagging-client recovery across the compaction floor;
- product-state checkpoint transfer;
- repeated/cascaded partial compaction;
- production compaction performance;
- cryptographic integrity;
- fsync/power-loss guarantees;
- concurrent writers or distributed consensus.
