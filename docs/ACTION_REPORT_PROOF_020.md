# Action Report — Proof 020: replay checkpoint across partial-compaction floor

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Prove a truthful recovery path for a client whose verified mutation revision is older than Proof 018's partial-receipt compaction floor.

Proof 019 covers the separate full-epoch case, where a trusted full-head checkpoint retires old identity state and a lagging client adopts the new epoch. Proof 020 instead preserves Proof 018's old proposal-ID semantics and gives a lagging client a deterministic replay checkpoint at the partial-compaction floor.

## Tested model

`src/replay-checkpoint.mjs` creates a deterministic checkpoint package containing:

- mutation revision/head;
- checkpoint tick;
- rules version;
- checkpoint state;
- deterministic state digest;
- deterministic checkpoint digest.

The checkpoint digest is an explicit expected/trusted input during verification. Internal checksum consistency alone is not treated as authority.

## Boundary safety rule

For a checkpoint at mutation revision R and logical tick T:

- every command absorbed into revisions <= R must have `atTick <= T`;
- every retained suffix command after R must have `atTick > T`.

This prevents a checkpoint from silently dropping a compacted-prefix command that has not happened yet, or omitting/double-handling a suffix command that should already have happened.

## Tested fixture

- built accepted revisions 1–40 with command tick `revision * 10`;
- partially compacted receipts 1–32 using Proof 018;
- demonstrated a lagging client at revision 10 cannot request history below floor 32;
- accepted/persisted revision 41 after compaction;
- built a replay checkpoint at revision 32 / tick 320;
- serialized and re-verified that checkpoint against an explicit trusted checkpoint digest;
- client adopted checkpoint 32, replayed only receipts 33–41, and advanced to tick 600;
- resulting state exactly matched uninterrupted replay from genesis through all 41 accepted commands;
- checkpoint tick 319 rejected because compacted proposal 32 occurs at tick 320;
- checkpoint tick 330 rejected because retained proposal 33 occurs at tick 330;
- tampered checkpoint state, wrong trusted digest, wrong expected mutation head, and retained-suffix sequence gap failed closed.

## CI evidence

Tested candidate head: `92b8b5f29b4279f98f0e78014c8cfd00b13c8f3d`.

Consolidated Global State regression:

- run: `35017926202`
- job: `104545985370`
- result: **SUCCESS**
- executable proof label: `AXM Global State proof 020 replay checkpoint across partial-compaction floor: PASS`
- Proof 017 checkpoint epoch compaction: **PASS**
- Proof 018 partial receipt payload compaction: **PASS**
- Proof 019 full-epoch lagging-client checkpoint adoption: **PASS**
- all retained durable-authority, interval-time, Chromium portability, browser transport/restart, WebSocket reconnect, fully-cold resume and fully-cold elapsed-time regressions: **PASS**

Observed Proof 020 result:

```text
laggingClientRevision: 10
compactionFloorRevision: 32
checkpointTick: 320
checkpointAppliedCommandFingerprints: 32
retainedSuffixReceipts: 9
resumedRevision: 41
targetTick: 600
finalStateDigest: fnv1a32:1dfc90e1
unsafeEarlyCheckpointRejected: true
unsafeLateCheckpointRejected: true
tamperedCheckpointRejected: true
suffixGapRejected: true
```

This report-only evidence commit still requires one final consolidated run before integration so the merged head itself remains evidence-clean.

## Important continuity truth

The replay checkpoint state retains applied-command fingerprints for the absorbed partial-compaction prefix. This is intentional: Proof 020 preserves exact kernel idempotence across a partial checkpoint rather than retiring historical identity.

Proof 020 therefore does **not** claim the client checkpoint is O(1) in historical identity metadata. Proof 017/019 full-epoch checkpointing is the separate path that can retire old applied-command identity after a trusted full-head transition.

## Trust boundary

The deterministic checkpoint digest is not a cryptographic signature and does not prove who authored the checkpoint or whether the source is trustworthy.

Proof 020 treats `expectedCheckpointDigest` as an already-trusted input. Authentication/signing/distribution of that trust anchor remains separate research.

## Coordination boundary

Proof 019 and Proof 020 solve different lagging-client states:

- Proof 019: old epoch -> full-head epoch checkpoint adoption; old identity may be retired.
- Proof 020: below partial-compaction floor -> replay checkpoint at floor + retained suffix; old identity remains explicit.

Neither silently replaces the other.

## Truth boundary

Proof 020 is tested experimental evidence, not production checkpoint infrastructure.

It does not establish:

- cryptographic checkpoint authenticity;
- automatic checkpoint discovery/distribution;
- malicious checkpoint-source resistance;
- browser-local checkpoint storage/adoption;
- checkpoint compression;
- repeated checkpoint rotation;
- fsync/power-loss durability;
- concurrent writers or distributed consensus;
- production deployment/scale.

## Next safe rung

Carry the same partial-compaction replay-checkpoint handoff through real Chromium/local storage so a browser below the compaction floor can adopt the verified checkpoint, fetch only the retained suffix, and reconstruct the same current state without a full world-snapshot service.
