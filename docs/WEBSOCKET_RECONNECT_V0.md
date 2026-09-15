# AXM Global State — WebSocket reconnect receipt sync v0

Status: **EXPERIMENTAL PROOF CONTRACT**

## Purpose

Test a remote-style browser transport failure/reconnect seam without turning the WebSocket relay into the world simulator or canonical product state.

## Proof shape

A Node test host serves one static browser page and one WebSocket endpoint.

The already-tested single sequencer creates accepted receipts `R1` and `R2` before browser synchronization begins.

The browser client then performs:

```text
connect #1
  -> sync.request(afterRevision=0)
  <- R1
  X  deliberate clean disconnect

reconnect #2
  -> sync.request(afterRevision=1)
  <- R2
  <- R2 duplicate
```

The client retains accepted receipt evidence in its own browser runtime across the reconnect, re-normalizes the receipt chain, reaches revision 2 and reconstructs through the unchanged Temporal State Kernel.

## Relay responsibilities in this proof

The WebSocket side may:

- accept a sync request naming the client's last verified revision;
- send already-accepted receipts after that revision;
- close/reopen transport connections.

It may **not**:

- invent product state;
- run world time;
- execute commands;
- choose product rules;
- mutate accepted receipts;
- silently create a new authority order.

The accepted history exists before transport delivery in this proof.

## Why this matters

A participant does not need the server to stream the whole reconstructed world after reconnect if the client already has a trusted checkpoint/rules and can obtain the accepted mutations it missed.

The minimal reconnect question becomes:

> What accepted history am I missing after my last verified revision/head?

That is much smaller than "send me the entire live world again" when the product's state is deterministically reconstructable.

## Truth boundary

This proof uses a local test WebSocket server and in-memory accepted receipt history. It does **not** establish:

- production persistence;
- remote internet deployment;
- identity/authentication;
- cryptographic signatures;
- malicious relay/client security;
- multi-host failover;
- consensus;
- P2P;
- long offline history compaction;
- bandwidth/performance at scale;
- reconnect after the browser process itself loses its local receipt/checkpoint state.

The `ws` package is used only by the Node test relay. Browser code uses the native WebSocket API.
