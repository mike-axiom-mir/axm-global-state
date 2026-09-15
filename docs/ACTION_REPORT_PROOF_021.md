# Action Report — Proof 021: Chromium checkpoint adoption

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Prove the deterministic Proof 019 checkpoint-adoption package can be used by a real persistent Chromium client that wakes on a retired epoch after compaction.

## Candidate flow

1. Chromium process 1 verifies only genesis revision 1 and persists that verified receipt locally.
2. Browser disappears.
3. Genesis advances through revisions 2–3 and compacts at revision 3 / tick 3600.
4. New epoch accepts revision 4 at tick 4000.
5. Chromium process 2 restarts from the same profile/origin, reports retired epoch `genesis` revision 1, and receives a checkpoint-adoption package rather than an impossible receipt-only suffix.
6. Browser verifies the package, atomically replaces its old mutation base, reconstructs to already-admitted tick 7200, and persists the verified adoption package.
7. Chromium process 3 restarts again and re-verifies the persisted package without another network request.
8. Browser-local storage is then deliberately tampered; Chromium process 4 must fail on compacted-state digest verification.

## Required evidence

- retired browser revision before adoption: 1;
- adopted checkpoint revision/tick: 3 / 3600;
- adopted current revision: 4;
- retained current-epoch suffix: one receipt;
- compacted revision-2/3 receipt payloads are not transferred;
- browser physical state matches uninterrupted full-history reference at tick 7200;
- adoption package survives browser process restart and is re-verified;
- tampered persisted checkpoint state fails closed;
- expected state digest: `fnv1a32:ba4ed3fc`.

## Architectural boundary

This is browser integration of Proof 019, not new checkpoint semantics. The browser treats the supplied adoption package as eligible input from the configured relay; this proof does not authenticate the relay or establish who is allowed to declare a checkpoint trusted.

No Temporal State, mutation-agreement, epoch, or checkpoint-adoption semantics are changed by this proof.

## Truth boundary

Do not claim PASS until the consolidated exact-head regression suite succeeds in real Chromium.

Even after a pass, this does not prove remote authentication/signatures, hostile relay resistance, multi-host consensus, production storage encryption, power-loss durability, cross-device browser-profile migration, or checkpoint retention policy.
