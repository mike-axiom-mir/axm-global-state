# Action Report — Proof 007: WebSocket reconnect receipt sync

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Prove that a browser can lose and restore a remote-style transport connection, request only accepted receipts after its last verified revision, and reconstruct the same canonical state without receiving a full world snapshot.

## Candidate fixture

The sequencer creates accepted receipts `R1` and `R2` first.

The test relay then deliberately behaves as follows:

1. browser connects and requests `afterRevision=0`;
2. relay sends `R1` and closes the connection;
3. browser verifies revision 1 and reconnects;
4. browser requests `afterRevision=1`;
5. relay sends `R2` twice;
6. browser normalizes the accepted chain and reconstructs revision 2 state;
7. browser state/digest must exactly equal an independent Node reconstruction.

## Architectural boundary

The relay transports already-accepted receipts only. It does not advance time, execute product commands, calculate product state or admit/reorder proposals.

The client keeps its verified receipt evidence in memory across this connection loss. Browser-process restart persistence is not part of this rung.

## Dependency provenance

The Node test relay uses `ws` version `8.21.3` as an exact development dependency. Browser code uses the native WebSocket API.

## Truth boundary

Do not claim Proof 007 PASS until real Chromium CI succeeds.

Even after a pass this will not prove production durability, deployment, authentication, hostile-network security, multi-host failover, consensus, P2P, large-history performance or browser-process restart continuity.
