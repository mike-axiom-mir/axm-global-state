# Action Report — Proof 011: fully cold elapsed-time catch-up

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Compose fully cold continuity with deterministic elapsed-time catch-up so the reconstructed present can move forward even though no browser, relay, or authority process evaluated product/world transitions during the cold interval.

## Tested flow

1. Authority accepts and durably retains `R1`.
2. Real Chromium verifies `R1` and reconstructs logical tick `600`, then exits while retaining only its verified receipt prefix.
3. The relay closes.
4. While the browser is absent, authority accepts `R2`; its command takes effect at logical tick `900`.
5. Authority stops. Browser, relay, and authority are all absent.
6. No product/world transition is evaluated during the cold interval.
7. On wake, a fresh authority restores accepted revision `2` from durable receipt history.
8. Fresh Chromium restores verified revision `1` from its persistent profile and requests only receipts after revision `1`.
9. It receives only `R2` and is supplied a later trusted logical target tick of `86,400`.
10. Browser reconstruction advances to tick `86,400` and matches an independent measured Node reconstruction from freshly recovered authority history.

## CI evidence

Candidate head before this report-only evidence update: `ad3ed38956dca5af217ae2e0d74878eeb31159ad`.

Proof 011 workflow:

- run: `35008896569`
- job: `104515561594`
- result: **SUCCESS**
- runner: Ubuntu 24.04 / Node.js `v22.23.2`
- real Chromium: Playwright Chromium `140.0.7339.16`

Observed result:

```text
AXM Global State proof 011 fully cold elapsed-time catch-up: PASS
sleepTick: 600
wakeTick: 86400
coldLogicalTicks: 85800
authorityRestoredRevision: 2
requestedMissingAfterRevision: 1
receivedAfterWake: 1
catchupJumps: 1441
perTickTransitionsAvoided: 84959
finalRevision: 2
finalStateDigest: fnv1a32:74f37cf0
```

The same workflow first passed the deterministic suite, repaired Proof 009 durable-authority regression, and Proof 010 fully-cold-resume regression.

## What this proves

Within the bounded tested fixture:

- Chromium had previously verified revision `1` and state at logical tick `600`;
- authority later retained revision `2`, including a command whose effect begins at tick `900`;
- browser, relay, and authority were then all absent;
- no product/world transitions were evaluated during that absence;
- after wake, authority restored revision `2` and Chromium restored its verified revision-`1` receipt prefix;
- Chromium requested only the missing suffix after revision `1` and received one accepted receipt;
- the reconstructed present advanced to logical tick `86,400`;
- state changes after the sleep point were therefore resolved on wake rather than continuously simulated during absence;
- browser state/digest exactly matched the independent Node reconstruction at the same later tick;
- catch-up used `1,441` meaningful jumps and avoided `84,959` individual per-tick transitions.

## Architectural boundary

This proof does **not** introduce or validate a clock authority. The later logical tick is a trusted input to reconstruction. The proven question is narrower:

> Given a later trusted logical tick, can a compatible runtime truthfully reconstruct the later present after complete process absence?

For this fixture, yes.

The source, authentication, consensus, drift, rollback resistance, and anti-tamper properties of a shared current logical tick remain separate research problems.

The browser continuity store remains accepted receipts rather than opaque product/world state. The authority remains accepted-history storage/admission rather than an always-running simulation process. The relay remains transport only.

## Truth boundary

This remains bounded experimental evidence. It does not establish a production global clock, secure time authority, distributed consensus, database durability, hostile-network protection, broad browser compatibility, large-history performance, or universal product time semantics.

A next safe research rung is to define and adversarially test the **logical-time evidence contract** itself: what evidence a wake-up runtime is allowed to accept as the current tick, how rollback/conflict is detected, and how a single-device/offline mode differs from a shared-world mode.
