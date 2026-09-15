# AXM Global State — browser-local receipt transport v0

Status: **EXPERIMENTAL PROOF CONTRACT**

## Purpose

Test a real browser transport without allowing transport to become state authority.

The v0 transport is the browser `BroadcastChannel` API because it provides a genuine same-origin/same-storage-partition message channel between tabs/workers without requiring a remote server.

This is deliberately **not** a multiplayer/internet claim.

## Architecture under test

```text
single-sequencer authority
       │
accepted receipts R1, R2
       │
       ▼
BroadcastChannel transport
(deliberately sends R2, R1, R1)
       │
       ▼
receiver runtime
       │
normalize / verify receipts
       │
       ▼
Temporal State Kernel
       │
reconstruct canonical state
```

The browser transport sees opaque accepted receipt objects. It does not decide:

- proposal admission;
- receipt ordering truth;
- product rules;
- logical-time semantics;
- canonical state.

## Required proof

The real Chromium test opens two same-origin pages:

- sender page;
- receiver page.

The sender deliberately posts accepted receipts out of order and duplicates one receipt.

The receiver must:

1. receive all transport messages;
2. normalize them through the already-tested mutation-agreement layer;
3. recover canonical sequence `R1, R2`;
4. verify the accepted head chain;
5. reconstruct product state through the same Temporal State Kernel used by Node;
6. match the independently calculated Node canonical state and digest exactly.

## Why BroadcastChannel first

It proves the transport/state boundary using a real browser communication mechanism while avoiding several unrelated problems at once:

- remote hosting;
- authentication;
- TLS;
- reconnect;
- internet latency;
- WebSocket server lifecycle;
- P2P signaling.

If the semantic seam survives this transport, later transport adapters can be tested against the same invariant.

## Truth boundary

This proof does **not** establish:

- cross-device communication;
- internet multiplayer;
- persistence after all browser contexts close;
- WebSocket behavior;
- reconnect/catch-up after network loss;
- message authentication;
- hostile sender protection;
- multi-host authority;
- P2P consensus;
- production browser support outside the tested Chromium surface.

`BroadcastChannel` is transport evidence only.
