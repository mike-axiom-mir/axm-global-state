# Action Report — Proof 019: replay checkpoint across partial-compaction floor

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Prove a practical recovery path for a client whose verified mutation revision is older than Proof 018's partial-compaction floor.

The client must not pretend the removed receipt prefix still exists. Instead it explicitly adopts a trusted product/replay checkpoint bound to the compaction revision/head, then replays only the retained accepted-receipt suffix.

## Candidate model

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

## Candidate fixture

- build accepted revisions 1–40 with command tick `revision * 10`;
- partially compact receipts 1–32 using Proof 018;
- demonstrate a lagging client at revision 10 cannot request history below floor 32;
- accept/persist revision 41 after compaction;
- build a replay checkpoint at revision 32 / tick 320;
- serialize and re-verify that checkpoint against an explicit trusted checkpoint digest;
- client adopts checkpoint 32, requests only receipts 33–41, and advances to tick 600;
- resulting state must exactly equal uninterrupted replay from genesis through all 41 accepted commands;
- checkpoint tick 319 must reject because compacted proposal 32 occurs at tick 320;
- checkpoint tick 330 must reject because retained proposal 33 occurs at tick 330;
- tampered checkpoint state, wrong trusted digest, wrong expected mutation head, and retained-suffix sequence gap must fail closed.

## Important continuity truth

The replay checkpoint state currently retains applied-command fingerprints for the absorbed prefix. This is intentional for the first lagging-client handoff proof and keeps kernel idempotence explicit.

Proof 019 therefore does **not** claim the client checkpoint is O(1) in historical identity metadata. Proof 017 epoch compaction is the separate mechanism that can retire old applied-command identity at a full-head state checkpoint.

## Trust boundary

The deterministic checkpoint digest is not a cryptographic signature and does not prove who authored the checkpoint or whether the source is trustworthy.

Proof 019 treats `expectedCheckpointDigest` as an already-trusted input. Authentication/signing/distribution of that trust anchor is separate research.

## Truth boundary

Do not claim PASS until the consolidated exact-head regression suite succeeds.

Even if green, Proof 019 will not establish:

- cryptographic checkpoint authenticity;
- automatic checkpoint discovery/distribution;
- malicious checkpoint-source resistance;
- browser-local checkpoint storage/adoption;
- checkpoint compression;
- full-head epoch checkpoint retirement during the same handoff;
- repeated checkpoint rotation;
- fsync/power-loss durability;
- concurrent writers or distributed consensus;
- production deployment/scale.

## Next safe rung if green

Carry the same verified replay-checkpoint handoff through real Chromium/local storage so a browser whose local receipt history falls below the authority compaction floor can adopt the checkpoint, fetch only the retained suffix, and reconstruct the same state without a full world snapshot service.
