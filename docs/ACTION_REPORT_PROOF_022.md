# Action Report — Proof 022: Chromium partial replay checkpoint

Date: 2026-09-15
Status: **REPAIRED CANDIDATE / EXACT-HEAD CI PENDING / EXPERIMENTAL**

## Goal

Prove that a persistent Chromium client below Proof 018's partial-compaction floor can adopt the merged Proof 020 replay checkpoint, retain partial-compaction identity semantics, fetch only the retained receipt suffix, and reconstruct the exact current state.

## Candidate flow

1. Chromium process 1 verifies mutation revisions 1–10 and persists them locally.
2. Browser disappears.
3. Authority partially compacts receipt envelopes/payload history through revision 32 while preserving historical command identity evidence.
4. Revision 41 is accepted after compaction.
5. A trusted replay checkpoint is built at revision 32 / tick 320 and only receipts 33–41 remain as the live suffix.
6. Chromium process 2 restarts from revision 10, receives the replay checkpoint + suffix, verifies the checkpoint against separately trusted digest/revision/head configuration, and reconstructs exactly to revision 41 / tick 600.
7. Chromium process 3 restarts from the same profile, re-verifies the persisted checkpoint + suffix, and reconstructs without another network request.
8. Browser-local checkpoint state is deliberately tampered; Chromium process 4 must fail closed during replay-checkpoint verification.

## First Chromium CI finding

Initial candidate head before the repair ran in consolidated workflow:

- run: `35019783841`
- job: `104552309585`
- result: **FAILURE only in the new Proof 022 browser step**
- all prior deterministic, compaction, durability and Chromium regressions stayed green.

The failing assertion incorrectly claimed that compacted historical payload bytes would be absent from the **entire replay checkpoint handoff**.

Inspection of the Temporal State Kernel showed why that claim was false: `state.appliedCommands[command.id]` stores the deterministic canonical command fingerprint, and the current v0 fingerprint is the canonical full command string including `id`, `atTick`, `type`, and `payload`.

Therefore partial compaction currently has two separate storage truths:

- old accepted **receipt envelopes/history** through revision 32 are removed from the retained suffix;
- historical command-derived material is still present inside checkpoint `appliedCommands` so exact old identity/idempotence semantics and exact full-state equality remain available.

This is not a browser defect. It is an explicit current scaling boundary of the partial-compaction/replay-checkpoint design.

## Repaired assertions

The repaired head before this report update is `3e9415bb824fe5adb1ce2e00d929725f5f6e3d3d`.

The proof now requires:

- retained network suffix contains only revisions 33–41;
- compacted receipt envelopes 1–32 are not transferred as suffix history;
- replay checkpoint retains 32 historical applied-command identities;
- historical command material is explicitly acknowledged as present in checkpoint identity state;
- browser state at revision 41 / tick 600 equals uninterrupted replay **exactly**, metadata included;
- persisted checkpoint + suffix are re-verified after browser process restart;
- browser-local checkpoint-state tampering fails closed;
- expected exact state digest remains `fnv1a32:1dfc90e1`.

## Trust boundary

The relay transports the checkpoint but does not make it trusted by sending it. Chromium receives `expectedCheckpointDigest`, expected mutation revision/head, and expected rules version as separate trusted configuration and verifies against them.

The deterministic checkpoint digest is integrity evidence, not authentication/signature. This proof does not define where the trusted expected digest comes from.

## Relation to Proof 021

- Proof 021 / full epoch: historical applied-command identities are intentionally retired; physical-state equivalence is the continuity contract.
- Proof 022 / partial compaction: historical identity remains explicit; exact full-state equality is required.

## Architectural boundary

Browser integration only. No Temporal State, mutation sequencer, partial-compaction, or replay-checkpoint semantics are changed by this repair.

This proof does **not** claim the replay checkpoint is payload-minimal. Compacting or migrating historical command identity material without weakening duplicate/conflict semantics is a separate future research problem.

## Truth boundary

Do not promote Proof 022 to PASS until the consolidated exact-head regression suite succeeds on the repaired report-bearing head.

Even after a pass, this does not prove checkpoint authentication/signatures, malicious relay resistance, power-loss durability, encrypted browser storage, cross-device migration, multi-host consensus, automatic compaction/checkpoint retention policy, or compact historical identity representation.
