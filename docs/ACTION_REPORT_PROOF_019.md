# Action Report — Proof 019: lagging-client checkpoint adoption

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Prove that a client still on a retired mutation epoch can recover after checkpoint compaction without requiring the compacted historical receipt payloads.

## Candidate model

A checkpoint-adoption package contains:

- a self-consistent checkpoint epoch descriptor;
- the compacted deterministic checkpoint state;
- the retained accepted receipt suffix for the current epoch;
- the declared target revision/head that the suffix must reach.

The adoption layer verifies and normalizes those pieces only. It does **not** choose product time semantics or silently run product rules.

## Candidate fixture

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

## Architectural boundary

Checkpoint adoption is not checkpoint authority.

This proof can verify internal consistency of a supplied checkpoint package and continuity from a configured prior epoch. It does not decide **who is authorized to declare a checkpoint trusted**. Authentication/signatures/consensus/checkpoint-source policy remain separate.

The layer also does not choose how a product advances from checkpoint tick to the client's admitted logical time. Existing consumer time contracts remain responsible for that product-specific decision.

## Truth boundary

Do not claim Proof 019 PASS until the consolidated exact-head regression suite succeeds.

Even after a pass, this will remain bounded experimental evidence. It will not prove:

- remote checkpoint authentication or signatures;
- malicious checkpoint-authority resistance;
- multi-host consensus;
- arbitrary partial-history compaction;
- durable checkpoint rotation/power-loss guarantees;
- large checkpoint transfer efficiency;
- browser checkpoint adoption;
- automatic checkpoint retention policy;
- universal product time semantics.

## Next safe rung if green

Use the same package in a real Chromium restart/adoption proof: a persistent browser remains on the retired epoch, the authority compacts while it is absent, then the browser returns, detects that receipt-only catch-up is impossible, adopts the verified checkpoint package, requests only the retained epoch suffix, and reconstructs its current admitted logical time.
