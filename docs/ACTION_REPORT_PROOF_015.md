# Action Report — Proof 015: logical-time uncertainty intervals

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Represent logical-time uncertainty honestly as bounded intervals, preserve those interval claims through a provenance chain, and corroborate overlapping intervals without inventing a fake exact midpoint.

## Candidate evidence chain

`single-source-interval-chain-v0` binds source, trust scope, contract, sequence, interval, previous head, and deterministic evidence head.

The source's guaranteed lower bound (`earliestTick`) must be monotonic. Its upper bound may shrink as uncertainty improves.

## Candidate corroboration fixture

From already-admitted tick `600`:

- `clock-a`: `[86,390, 86,410]`;
- `clock-b`: `[86,400, 86,430]`;
- `clock-c`: `[199,990, 200,010]`.

Policy requires two configured shared-authority sources, maximum individual width `40`, and maximum overlap width `20`.

Expected result:

- `clock-a + clock-b` overlap at `[86,400, 86,410]`;
- outlier `clock-c` excluded;
- admitted canonical tick = conservative overlap lower bound `86,400`;
- no midpoint or average is invented;
- Temporal State at admitted tick matches the existing `fnv1a32:74f37cf0` state.

## Required adversarial evidence

- guaranteed lower-bound rollback fails closed even with otherwise valid interval structure;
- validly headed sequence with a lower guaranteed bound than previously accepted fails closed;
- sequence gap/conflict/tamper fail closed;
- non-overlapping configured sources → hold;
- extremely wide source beyond policy uncertainty width is excluded and cannot count toward corroboration;
- two equally strong disjoint overlap clusters → ambiguous hold;
- wholly lagging interval is excluded and cannot move time backward;
- straddling intervals advance only to the common lower bound, not midpoint;
- duplicate evidence source fails closed;
- cross-trust interval source fails closed;
- duplicate configured policy source IDs fail closed.

## Truth boundary

Do not claim Proof 015 PASS until exact-head CI succeeds.

Even after a pass this proves only internally consistent interval evidence and deterministic overlap policy. It does not prove physical-time accuracy, source authentication, signatures, real-world independence, Byzantine consensus, secure uncertainty bounds, or universally correct width/quorum settings.
