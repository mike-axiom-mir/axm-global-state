# Action Report — Proof 010: fully cold end-to-end resume

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Test whether continuity survives an interval where the browser, relay, and accepted-history authority are all stopped.

## Candidate flow

1. Authority starts at trusted revision 0 and persists accepted receipt R1.
2. Chromium receives and verifies R1, stores it in its persistent browser profile, and closes.
3. The relay closes.
4. Authority accepts and persists R2 while the browser is absent, then stops.
5. During the cold interval no browser, relay, or authority process is running.
6. A fresh authority process restores revision 2 from accepted receipt history.
7. A fresh relay starts on the same browser origin.
8. A fresh Chromium process restores local verified revision 1 and requests only receipts after revision 1.
9. The recovered authority returns R2.
10. Chromium verifies R1 and R2, reconstructs revision 2 state, and matches an independent Node reconstruction.

## Required evidence

- browser restored revision 1;
- authority restored revision 2;
- wake sync request is afterRevision 1;
- exactly one receipt is transferred after wake;
- final revision is 2;
- browser and Node state and digest are identical;
- expected final digest is fnv1a32:bab65c1b.

## Architectural boundary

The relay is transport only. The authority stores accepted compact history only. No product or world state is simulated while the participants are stopped. The browser reconstructs from verified accepted history plus deterministic rules.

## Truth boundary

Do not claim PASS until real Chromium CI succeeds on the exact candidate head. A pass will remain bounded experimental evidence and will not establish production durability, distributed consensus, large-history scaling, or broad browser compatibility.
