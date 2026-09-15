# Action Report — Proof 007: WebSocket reconnect receipt sync

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Prove that a browser can lose and restore a remote-style transport connection, request only accepted receipts after its last verified revision, and reconstruct the same canonical state without receiving a full world snapshot.

## Tested fixture

The sequencer creates accepted receipts `R1` and `R2` before browser synchronization begins.

The test relay deliberately behaves as follows:

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

## CI evidence

Candidate head before this report-only evidence update: `faa9f925e950c0d07c55546b684531306d697b00`.

Proof 007 workflow:

- run: `34962877189`
- job: `104360392403`
- result: **SUCCESS**
- runner: Ubuntu 24.04 / Node.js `v22.23.2`
- Chromium: Playwright `1.55.0`, Chromium `140.0.7339.16` / build `1187`

Observed result:

```text
AXM Global State proof 007 WebSocket reconnect receipt sync: PASS
transport: WebSocket
connectionCount: 2
syncRequests: [0, 1]
receivedMessages: 3
normalizedRevision: 2
acceptedHead: fnv1a32:e4b47257
finalStateDigest: fnv1a32:bab65c1b
```

The same candidate kept Proofs 001, 003, Consumer Time Contract v0 and Proof 005 green. Other regression workflows for portability and browser-local transport were also triggered on the candidate.

## What this proves

Within this bounded real-Chromium/local-relay proof:

- a browser can survive loss of a WebSocket transport connection without losing the semantic state-sync model;
- reconnect can name the last verified revision and receive only later accepted history;
- duplicate replay after reconnect remains idempotent;
- the relay does not need to send a reconstructed world snapshot;
- the browser independently reconstructs the exact same canonical state/digest as Node from trusted base state + accepted receipts + deterministic rules;
- the transport relay still does not need to continuously simulate the world merely to preserve state continuity.

## Truth boundary

This evidence does **not** prove:

- production durability;
- public internet deployment;
- identity/authentication;
- cryptographic signatures;
- malicious relay/client security;
- multi-host failover;
- consensus;
- P2P;
- large-history bandwidth/performance;
- browser-process restart persistence;
- recovery when the client loses both its local checkpoint and accepted receipt evidence.

The relay and accepted history in this proof remain process-local test infrastructure.

## Next safe rung

Before wider networking or P2P work, prove **durable browser-local continuity across process/page restart**.

A useful Proof 008 should persist a trusted checkpoint/revision/head and accepted receipts in browser storage, fully close the first browser context, reopen a fresh context/page, restore local verified state, reconnect with `afterRevision=<persisted revision>`, receive only missed accepted history, and reconstruct the same final canonical state.

That would test the original Global State goal more directly: a participant runtime can disappear entirely and later return without requiring an always-running simulation process to preserve its world understanding.
