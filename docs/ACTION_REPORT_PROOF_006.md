# Action Report — Proof 006: real browser-local receipt transport

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Prove that the mutation-agreement receipt seam survives a real browser transport without changing authority or reconstruction semantics.

## Candidate implementation

The proof uses two real Chromium pages on the same origin and one native `BroadcastChannel`.

The authority and Node reference path create two accepted chained receipts. The sender page deliberately transmits:

```text
R2, R1, R1
```

The receiver page must use the existing `normalizeAcceptedReceipts(...)` layer to recover the canonical accepted order, reject any invalid chain, convert accepted proposal IDs into stable replay command IDs, and reconstruct through the existing Temporal State Kernel.

The browser result is compared with an independent Node reconstruction from the same trusted checkpoint + accepted receipts.

## Architectural boundary

No transport-specific code is added to mutation agreement or product state logic.

The browser page only carries receipt objects. Authority remains in `mutation-agreement.mjs`; world/software reconstruction remains in `temporal-state-kernel.mjs`.

## Truth boundary

Do not claim Proof 006 PASS until real Chromium CI succeeds.

Even after a pass this will prove only same-origin browser-local receipt transport using `BroadcastChannel`. It will not prove:

- cross-device/network transport;
- internet multiplayer;
- persistence after all tabs/processes close;
- WebSocket behavior;
- reconnect after network loss;
- authentication/signatures;
- hostile-network security;
- P2P consensus;
- production browser compatibility outside the tested Chromium surface.
