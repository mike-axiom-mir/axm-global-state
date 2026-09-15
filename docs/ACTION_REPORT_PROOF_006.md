# Action Report — Proof 006: real browser-local receipt transport

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Prove that the mutation-agreement receipt seam survives a real browser transport without changing authority or reconstruction semantics.

## Implemented

The proof uses two real Chromium pages on the same origin and one native `BroadcastChannel`.

The authority and Node reference path create two accepted chained receipts. The sender page deliberately transmits:

```text
R2, R1, R1
```

The receiver page uses the existing `normalizeAcceptedReceipts(...)` layer to recover the canonical accepted order, verify the chain, convert accepted proposal IDs into stable replay command IDs, and reconstruct through the existing Temporal State Kernel.

The browser result is compared with an independent Node reconstruction from the same trusted checkpoint + accepted receipts.

## Architectural boundary

No transport-specific code is added to mutation agreement or product state logic.

The browser page only carries receipt objects. Authority remains in `mutation-agreement.mjs`; world/software reconstruction remains in `temporal-state-kernel.mjs`.

## CI evidence

Candidate head before this report-only evidence update: `cf647bbd4d1f632a443d105aa1d40013dd9fbaa2`.

Proof 006 workflow:

- run: `34962417705`
- job: `104358875962`
- result: **SUCCESS**
- runner: Ubuntu 24.04 / Node.js `v22.23.2`
- Chromium: Playwright `1.55.0`, Chromium `140.0.7339.16` / build `1187`

Observed proof evidence:

```text
AXM Global State proof 006 browser-local receipt transport: PASS
transport: BroadcastChannel
receivedMessages: 3
normalizedRevision: 2
acceptedHead: fnv1a32:e4b47257
finalStateDigest: fnv1a32:bab65c1b
```

The same candidate also kept the deterministic Proof 001/003, consumer-time contract and Proof 005 agreement suite green. The existing Node/Chromium portability workflow also passed on the candidate.

## What this proves

Within the tested same-origin Chromium surface:

- a real browser communication mechanism can carry accepted Global State receipts without becoming state authority;
- deliberately out-of-order and duplicate delivery can normalize back to the accepted sequence;
- receipt verification and deterministic reconstruction remain unchanged by the transport;
- the browser receiver and independent Node reference reconstruct the exact same canonical state/digest;
- no continuously running world simulation is required merely to move accepted state changes between those browser contexts.

## Truth boundary

This proves only same-origin browser-local receipt transport using `BroadcastChannel`. It does **not** prove:

- cross-device/network transport;
- internet multiplayer;
- persistence after all tabs/processes close;
- WebSocket behavior;
- reconnect after network loss;
- authentication/signatures;
- hostile-network security;
- P2P consensus;
- production browser compatibility outside the tested Chromium surface.

`BroadcastChannel` remains transport evidence only.

## Next safe rung

The next useful comparison is a **remote-style transport adapter** while leaving the sequencer and reconstruction layers untouched.

A bounded WebSocket proof can test connection loss/reconnect and replaying accepted receipts after a client missed messages. The server side should act only as transport/coordinator for the proof; it must not silently become the world simulator or redefine canonical state.
