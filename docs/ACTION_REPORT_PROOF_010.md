# Action Report — Proof 010: fully cold end-to-end resume

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Test whether continuity survives an interval where the browser, relay, and accepted-history authority are all stopped.

## Tested flow

1. Authority starts at trusted revision 0 and persists accepted receipt R1.
2. Chromium receives and verifies R1, stores it in its persistent browser profile, and closes.
3. The relay closes.
4. Authority accepts and persists R2 while the browser is absent, then stops.
5. During the cold interval no browser, relay, or authority process is running.
6. A fresh authority process restores revision 2 from accepted receipt history.
7. A fresh relay starts on the same browser origin.
8. A fresh Chromium process restores local verified revision 1 and requests only receipts after revision 1.
9. The recovered authority returns R2.
10. Chromium verifies R1 and R2, reconstructs revision 2 state, and matches an independent Node reconstruction built from history requested from the freshly restored authority.

## CI evidence

Candidate head before this report-only evidence update: `584753d5ab245b4d3055b5fd830e1f1a70d9a2f3`.

Proof 010 workflow:

- run: `35008050301`
- job: `104512687892`
- result: **SUCCESS**
- runner: Ubuntu 24.04 / Node.js `v22.23.2`
- real Chromium: Playwright Chromium `140.0.7339.16`

Observed result:

```text
AXM Global State proof 010 fully cold end-to-end resume: PASS
coldParticipants: browser, relay, authority
browserRestoredRevision: 1
authorityRestoredRevision: 2
requestedMissingAfterRevision: 1
receivedAfterWake: 1
finalRevision: 2
acceptedHead: fnv1a32:e4b47257
finalStateDigest: fnv1a32:bab65c1b
```

The same workflow also passed the deterministic proof suite, repaired Proof 009 durable-authority regression, and Proof 008 browser-process restart regression before running the new composition.

## What this proves

Within the bounded tested fixture:

- browser-side verified accepted history can survive complete browser-process loss;
- authority-side accepted history can survive complete authority-process loss;
- the transport relay can disappear entirely and later be recreated;
- browser and authority can wake independently from different durable receipt prefixes;
- the browser can request only the missing accepted suffix rather than a full world snapshot;
- only one missing receipt had to cross the relay after wake;
- the browser reconstructs the same canonical state/digest as an independent Node runtime from recovered authority history;
- no browser, relay, or authority process needs to continuously simulate the product/world during the cold interval.

## Architectural boundary

The relay is transport only. The authority stores accepted compact history only. The browser stores its verified accepted-receipt prefix. Product/world state is reconstructed from accepted history plus deterministic rules rather than retained as an always-hot simulation.

## Truth boundary

This remains bounded experimental evidence. It does not establish production hosting, filesystem power-loss guarantees, authentication/signatures, multi-authority consensus, large-history compaction/performance, broad browser compatibility, or universal product time semantics.

It also does **not yet prove that logical time itself advances during the fully cold interval**. Proof 010 preserves and rejoins mutation history; the next safe rung should combine this cold-resume seam with deterministic elapsed-time catch-up to a later trusted logical tick.
