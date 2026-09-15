# Action Report — Proof 021: Chromium checkpoint adoption

Date: 2026-09-15
Status: **PRE-FINAL TEST PASS / EXACT-HEAD CI PENDING / EXPERIMENTAL**

## Goal

Prove the deterministic Proof 019 checkpoint-adoption package can be used by a real persistent Chromium client that wakes on a retired epoch after compaction.

## Tested flow

1. Chromium process 1 verifies only genesis revision 1 and persists that verified receipt locally.
2. Browser disappears.
3. Genesis advances through revisions 2–3 and compacts at revision 3 / tick 3600.
4. New epoch accepts revision 4 at tick 4000.
5. Chromium process 2 restarts from the same profile/origin, reports retired epoch `genesis` revision 1, and receives a checkpoint-adoption package rather than an impossible receipt-only suffix.
6. Browser verifies the package, atomically replaces its old mutation base, reconstructs to already-admitted tick 7200, and persists the verified adoption package.
7. Chromium process 3 restarts again and re-verifies the persisted package without another network request.
8. Browser-local storage is deliberately tampered; Chromium process 4 fails on compacted-state digest verification.

## Semantic repair found by CI

The first browser run exposed an incorrect proof assertion, not a runtime defect: a full uncompacted state retains four historical `appliedCommands` identities, while a full-epoch adopted state intentionally retires the three pre-epoch identities and retains only the current-epoch command ID.

Therefore full-state digests are expected to differ across the epoch boundary even when the physical product state is identical.

The repaired proof now checks both truths explicitly:

- adopted compacted-state digest at tick 7200: `fnv1a32:ba4ed3fc`;
- uncompacted full-history digest at tick 7200: `fnv1a32:809851c1`;
- physical state with identity metadata removed: exactly equal;
- adopted `appliedCommands`: 1;
- uncompacted `appliedCommands`: 4.

## CI evidence

Repaired semantic head: `bcb1a9f68f6d3db3aee76dd573cd7c850d27e5b8`.

Consolidated Global State regression:

- run: `35018803902`
- job: `104548901868`
- result: **SUCCESS**
- runner: Ubuntu 24.04 / Node.js `v22.23.2`

Observed Proof 021 result:

```text
browserProcesses: 4
retiredEpochId: genesis
laggingRevisionBeforeAdoption: 1
adoptedCheckpointRevision: 3
adoptedCheckpointTick: 3600
adoptedEpochId: fnv1a32:7ac841cf
adoptedRevision: 4
retainedSuffixReceipts: 1
oldCompactedReceiptPayloadsTransferred: false
retiredHistoricalCommandIds: 3
persistedAdoptionReverifiedAfterRestart: true
persistedCheckpointTamperRejected: true
physicalStatePreserved: true
adoptedStateDigest: fnv1a32:ba4ed3fc
uncompactedReferenceDigest: fnv1a32:809851c1
```

The same exact run kept Proofs 001–020, durable authority, logical-time evidence/admission/corroboration/intervals, checkpoint epoch compaction, partial receipt compaction, full-epoch deterministic adoption, partial-floor replay checkpoints, Chromium portability, browser receipt transport/restart, WebSocket reconnect, fully-cold resume and fully-cold elapsed-time catch-up green.

This report commit changes evidence text only and therefore still requires one final consolidated run on the report-bearing exact head before integration.

## Architectural boundary

This is browser integration of Proof 019, not new checkpoint semantics. The browser treats the supplied adoption package as eligible input from the configured relay; this proof does not authenticate the relay or establish who is allowed to declare a checkpoint trusted.

No Temporal State, mutation-agreement, epoch, or checkpoint-adoption semantics are changed by this proof.

## Truth boundary

Do not promote Proof 021 to final PASS until the consolidated exact-head regression suite succeeds on the report-bearing head.

Even after a pass, this does not prove remote authentication/signatures, hostile relay resistance, multi-host consensus, production storage encryption, power-loss durability, cross-device browser-profile migration, or checkpoint retention policy.

## Next safe rung if green

Carry Proof 020's separate partial-compaction replay-checkpoint handoff through a real persistent Chromium client. A browser below the partial-compaction floor should adopt the trusted replay checkpoint, retain the explicit historical command-fingerprint semantics of that mode, fetch only the retained suffix, persist/re-verify the checkpoint across process restart, and reconstruct the same exact current state.
