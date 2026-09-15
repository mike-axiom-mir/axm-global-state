# Action Report — Proof 020: replay checkpoint across partial-compaction floor

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Prove a truthful recovery path for a client whose verified mutation revision is older than Proof 018's partial-receipt compaction floor.

Proof 019 already covers the separate full-epoch case, where a trusted full-head checkpoint retires old identity state and a lagging client adopts the new epoch. Proof 020 instead preserves Proof 018's old proposal-ID semantics and gives a lagging client a deterministic replay checkpoint at the partial-compaction floor.

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

Do not claim PASS until the consolidated exact-head regression suite succeeds against current main, including Proofs 017, 018 and 019.

Even if green, Proof 020 will not establish:

- cryptographic checkpoint authenticity;
- automatic checkpoint discovery/distribution;
- malicious checkpoint-source resistance;
- browser-local checkpoint storage/adoption;
- checkpoint compression;
- repeated checkpoint rotation;
- fsync/power-loss durability;
- concurrent writers or distributed consensus;
- production deployment/scale.

## Next safe rung if green

Carry the same partial-compaction replay-checkpoint handoff through real Chromium/local storage so a browser below the compaction floor can adopt the verified checkpoint, fetch only the retained suffix, and reconstruct the same current state without a full world-snapshot service.
