# Action Report — Proof 017: compacted accepted history with idempotence continuity

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Reduce retained accepted-history payload without silently losing the ability to recognize an exact old proposal retry or reject conflicting reuse of an old proposal ID after restart.

## Candidate mechanism

A validated contiguous prefix of accepted receipts is replaced by:

- a later mutation checkpoint revision/head;
- one compact evidence entry per compacted proposal containing only:
  - proposal ID;
  - deterministic proposal fingerprint;
  - accepted sequence;
  - accepted head;
- the un-compacted receipt suffix.

For an exact retry of a compacted proposal, the retry itself supplies the original actor/base/command fields. If its fingerprint matches the compact evidence, the original accepted receipt is deterministically rebuilt and its accepted head must match the retained evidence. Conflicting reuse of the same proposal ID still fails closed.

## Candidate fixture

- create 40 sequential accepted proposals with deliberately payload-heavy commands;
- compact receipts 1–32;
- retain full receipts 33–40;
- require the compacted file to be materially smaller than the original receipt payload fixture;
- retry compacted proposal 6 and require the exact original receipt to be reconstructed;
- mutate proposal 6 and require `proposal-id-conflict`;
- retry retained proposal 36 through the ordinary live-receipt path;
- accept and persist proposal 41 after compaction;
- hard logical restart by reopening only the compacted document plus its trusted compaction checkpoint;
- repeat old compacted retry/conflict checks after restart;
- require revision 41 continuity;
- tamper compact proposal evidence without changing the trusted evidence digest and require fail-closed opening.

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

Do not claim PASS until the consolidated exact-head Global State regression workflow succeeds.

Even after a pass, Proof 017 will not establish:

- lagging-client recovery across the compaction floor;
- a product-state checkpoint format;
- repeated/cascaded compaction of an already compacted identity index;
- bounded lifetime identity memory;
- cryptographic tamper resistance;
- hostile local-storage protection;
- fsync/power-loss guarantees;
- concurrent writers or distributed consensus;
- production-scale compaction performance.

## Next safe rung if green

Prove a **state/replay checkpoint + compacted receipt suffix** handoff for a client below the compaction floor. The client should adopt a verified checkpoint and then replay only the retained suffix, while the authority continues to preserve old proposal-ID conflict/idempotence evidence independently.
