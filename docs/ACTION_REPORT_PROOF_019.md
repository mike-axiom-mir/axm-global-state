# Action Report — Proof 019: lagging-client checkpoint adoption

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Prove that a client still on a retired mutation epoch can recover after checkpoint compaction without requiring the compacted historical receipt payloads.

## Tested model

A checkpoint-adoption package contains:

- a self-consistent checkpoint epoch descriptor;
- the compacted deterministic checkpoint state;
- the retained accepted receipt suffix for the current epoch;
- the declared target revision/head that the suffix must reach.

The adoption layer verifies and normalizes those pieces only. It does **not** choose product time semantics or silently run product rules.

## Fixture

The old genesis epoch accepts revisions 1–3 and compacts at revision 3 / logical tick 3600. The compaction boundary includes a command exactly at tick 3600.

A new epoch then accepts revision 4.

A lagging client still knows only genesis revision 1 but has already advanced its admitted logical time to tick 7200.

The proof requires:

1. sending only new-epoch R4 to the old genesis base fails because revisions 2–3 are absent;
2. the adoption package transfers the compacted revision-3 checkpoint plus only R4;
3. epoch descriptor/state digests and epoch identity verify after JSON transport;
4. the client adopts the new base and immediately reconstructs back to its already-admitted tick 7200;
5. the adopted physical state equals an uncompacted full-history reference exactly;
6. compacted historical proposal payloads are absent from the package;
7. wrong prior epoch, adoption that would drop a newer client revision, compacted-state tamper, epoch-ID tamper, truncated suffix, wrong declared target head and unscoped new-epoch receipt all fail closed.

## Exact-head CI evidence

Corrected/report-predecessor head `f9b3f0e50394857964f6f989f0891429d8503d4f` passed the consolidated Global State regression suite:

- workflow run: `35017327189`
- job: `104544044182`
- result: **SUCCESS**
- runner: Ubuntu 24.04 / Node.js `v22.23.2`
- executable proof label: `AXM Global State proof 019 lagging client checkpoint adoption: PASS`

Observed adoption result:

```text
laggingClientRevision: 1
laggingClientTick: 7200
adoptedCheckpointRevision: 3
adoptedCheckpointTick: 3600
adoptedEpochId: fnv1a32:7ac841cf
retainedSuffixReceipts: 1
adoptedRevision: 4
oldReceiptPayloadsTransferred: false
staleBaseSuffixReplayRejected: true
compactedStateTamperRejected: true
epochIdentityTamperRejected: true
truncatedSuffixRejected: true
olderCheckpointOverNewerClientRejected: true
physicalStatePreserved: true
finalStateDigest: fnv1a32:ba4ed3fc
```

The same exact-head run kept Proof 017 checkpoint epoch compaction, Proof 018 partial receipt payload compaction, durable authority, interval time, Chromium portability, browser transport/restart, WebSocket reconnect, fully-cold resume and fully-cold elapsed-time regressions green.

This report-only evidence commit still requires one final consolidated run before integration so the merged head itself remains evidence-clean.

## Architectural boundary

Checkpoint adoption is not checkpoint authority.

This proof verifies internal consistency of a supplied checkpoint package and continuity from a configured prior epoch. It does not decide **who is authorized to declare a checkpoint trusted**. Authentication/signatures/consensus/checkpoint-source policy remain separate.

The layer also does not choose how a product advances from checkpoint tick to the client's admitted logical time. Existing consumer time contracts remain responsible for that product-specific decision.

## Truth boundary

This remains bounded experimental evidence. It does not prove:

- remote checkpoint authentication or signatures;
- malicious checkpoint-authority resistance;
- multi-host consensus;
- arbitrary partial-history compaction;
- durable checkpoint rotation/power-loss guarantees;
- large checkpoint transfer efficiency;
- browser checkpoint adoption;
- automatic checkpoint retention policy;
- universal product time semantics.

## Next safe rung

Use the same package in a real Chromium restart/adoption proof: a persistent browser remains on the retired epoch, the authority compacts while it is absent, then the browser returns, detects that receipt-only catch-up is impossible, adopts the verified checkpoint package, requests only the retained epoch suffix, and reconstructs its current admitted logical time.
