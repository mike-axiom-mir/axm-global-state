# Action Report — Proof 022: Chromium partial replay checkpoint

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Prove that a persistent Chromium client below Proof 018's partial-compaction floor can adopt the merged Proof 020 replay checkpoint, retain the partial-compaction identity semantics, fetch only the retained suffix, and reconstruct the exact current state.

## Candidate flow

1. Chromium process 1 verifies only mutation revisions 1–10 and persists them locally.
2. Browser disappears.
3. Authority partially compacts receipt payloads through revision 32 while retaining compact identity evidence.
4. Revision 41 is accepted after compaction.
5. Build the trusted replay checkpoint at revision 32 / tick 320 and retain only receipts 33–41.
6. Chromium process 2 restarts from revision 10, receives the replay checkpoint + suffix, independently compares it with trusted checkpoint digest/revision/head configuration, and reconstructs exactly to revision 41 / tick 600.
7. Chromium process 3 restarts from the same profile, re-verifies the persisted checkpoint + suffix, and reconstructs without another network request.
8. Browser-local checkpoint state is deliberately tampered; Chromium process 4 must fail closed during replay-checkpoint verification.

## Required evidence

- lagging browser revision: 10;
- partial-compaction floor / replay checkpoint revision: 32;
- replay checkpoint tick: 320;
- checkpoint retains 32 historical applied-command identities;
- suffix contains only receipts 33–41 (9 receipts);
- prefix receipt payload bytes are absent from the handoff;
- final revision / target tick: 41 / 600;
- browser state equals uninterrupted full replay exactly, including identity metadata;
- persisted replay checkpoint is re-verified after browser process restart;
- tampered browser checkpoint state fails closed;
- expected final digest: `fnv1a32:1dfc90e1`.

## Trust boundary

The relay transports the checkpoint but does not make it trusted by sending it. The browser receives `expectedCheckpointDigest`, expected mutation revision/head, and expected rules version as separate trusted configuration and verifies against them.

The deterministic checkpoint digest is integrity evidence, not authentication/signature. This proof does not define where the trusted expected digest comes from.

## Relation to Proof 021

- Proof 021/full epoch: historical applied-command identities are intentionally retired; physical-state equivalence is the continuity contract.
- Proof 022/partial compaction: historical identity remains explicit; exact full-state equality is required.

## Architectural boundary

Browser integration only. No Temporal State, mutation sequencer, partial-compaction, or replay-checkpoint semantics are changed.

## Truth boundary

Do not claim PASS until the consolidated exact-head regression suite succeeds in real Chromium.

Even after a pass, this does not prove checkpoint authentication/signatures, malicious relay resistance, power-loss durability, encrypted browser storage, cross-device migration, multi-host consensus, or automatic compaction/checkpoint retention policy.
