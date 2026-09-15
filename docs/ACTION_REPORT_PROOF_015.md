# Action Report — Proof 015: logical-time uncertainty intervals

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Represent logical-time uncertainty honestly as bounded intervals, preserve those interval claims through a provenance chain, and corroborate overlapping intervals without inventing a fake exact midpoint.

## Tested evidence chain

`single-source-interval-chain-v0` binds source, trust scope, contract, sequence, interval, previous head, and deterministic evidence head.

The source's guaranteed lower bound (`earliestTick`) is monotonic. Its upper bound may shrink as uncertainty improves.

## Tested corroboration fixture

From already-admitted tick `600`:

- `clock-a`: `[86,390, 86,410]`;
- `clock-b`: `[86,400, 86,430]`;
- `clock-c`: `[199,990, 200,010]`.

Policy requires two configured shared-authority sources, maximum individual width `40`, and maximum overlap width `20`.

Observed result:

- `clock-a + clock-b` overlap at `[86,400, 86,410]`;
- outlier `clock-c` excluded;
- admitted canonical tick = conservative overlap lower bound `86,400`;
- no midpoint or average is invented;
- Temporal State at admitted tick matches the existing `fnv1a32:74f37cf0` state.

## CI evidence

Candidate head before this report-only evidence update: `f5b0f0e47c6bbbca909f22ae47ad3450e7dd22a0`.

Proof 015 workflow:

- run: `35012583254`
- job: `104527945909`
- result: **SUCCESS**
- runner: Ubuntu 24.04 / Node.js `v22.23.2`
- Proofs 012, 013 and 014 regressions: **PASS**

Observed output:

```text
AXM Global State proof 015 interval time evidence + corroboration: PASS
sourceAInterval: [86390, 86410]
sourceBInterval: [86400, 86430]
outlierInterval: [199990, 200010]
overlapInterval: [86400, 86410]
admittedConservativeLowerBound: 86400
tooWideSourceExcluded: clock-b
ambiguousIntervalsHeld: true
laggingIntervalExcluded: clock-a
midpointInvented: false
sourceIdsProveRealWorldIndependence: false
finalStateDigest: fnv1a32:74f37cf0
```

## Adversarial evidence

The tested candidate proves:

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

## Interval semantics

A source interval `[earliestTick, latestTick]` is a claim about uncertainty, not an exact time value.

The guaranteed lower bound may not roll backward. The upper bound may shrink as the source becomes more certain.

For a selected source group, the common intersection is:

```text
[max(source earliest), min(source latest)]
```

Canonical admission uses the intersection's lower bound. This is conservative because every selected source jointly supports that time has reached at least that tick. The midpoint is never synthesized as truth.

A source whose uncertainty width exceeds product policy is excluded rather than allowed to “corroborate everything” with an almost-unbounded interval.

## Truth boundary

Proof 015 establishes only internally consistent interval evidence and deterministic overlap policy. It does not prove physical-time accuracy, source authentication, signatures, real-world source independence, Byzantine consensus, secure uncertainty bounds, or universally correct width/quorum settings.

The deterministic evidence heads remain replay/test checksums rather than security primitives.

A next safe rung is **interval continuity across fully cold restart**: persist/restore interval evidence sources and prove that a later overlapping uncertainty set can drive the already-tested cold-resume/catch-up path without converting intervals into fake exact timestamps.
