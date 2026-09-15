# AXM Global State — Next Build

Status: **FIRST PROOF WAVE COMPLETE / SECOND-WAVE RESEARCH**

The original first-wave stop condition has been reached for the bounded experimental kernel.

Do not widen into a giant multiplayer/networking stack simply because the first proofs are green.

See:

- `docs/FIRST_WAVE_REVIEW_2026-09-15.md`
- `docs/SHARED_STATE_SYNC_PATTERNS_2026-09-15.md`
- `docs/STATE_SYNC_RESPONSIBILITY_MATRIX_V0.md`

## What is already tested

The repository can currently demonstrate, within its explicit JavaScript proof boundary:

1. deterministic state reconstruction after offline logical time;
2. equivalence between fine reference stepping and eventful catch-up;
3. restart/replay continuity and idempotent accepted commands;
4. exact canonical reconstruction in Node.js and real Chromium;
5. long-absence catch-up that skips empty per-tick work;
6. explicit versioned consumer time modes (`closed-form`, `fixed-quantum`, `event-boundary`);
7. fail-closed boundaries for overflow, backward time, missing history and incompatible temporal contracts.

This is still experimental infrastructure, not a production distributed system.

## First external consumer result

The first `axm-global-state-rts` aggregate-city investigation did not produce a fake easy integration. It exposed a real product contract question: one large city `advance(totalElapsed)` is not equivalent to repeated updates under the current nonlinear starvation/readiness/training behavior.

That RTS research stays product-owned and draft. Global State must not silently pick the game's canonical time quantum.

## Second-wave question

> What is the smallest shared mutation-agreement layer needed when state reconstruction itself can happen independently on participant devices?

The architecture must keep these responsibilities separate:

```text
transport
mutation admission / identity
ordering or merge semantics
accepted durable history
checkpointing
logical-time reconstruction
presentation
```

WebSocket, P2P, HTTP or a browser-local channel are transports. None of them automatically define state truth.

## Proof 005 candidate — provider-neutral mutation agreement seam

Do **not** begin with real networking.

Build a tiny deterministic proof with two simulated participants and a replaceable in-memory transport.

Required shape:

```text
trusted checkpoint R0
       │
A proposes mutation ─┐
                     ├─> authority mode -> accepted receipts R1, R2...
B proposes mutation ─┘
                              │
                  ┌───────────┴───────────┐
                  ▼                       ▼
             runtime one              runtime two
                  │                       │
                  └── reconstruct same now ┘
```

### Required evidence

- mutation proposals name the checkpoint/revision they were based on;
- stable proposal/event IDs make duplicate delivery idempotent;
- stale/conflicting proposals fail closed unless the selected authority mode explicitly defines reconciliation;
- accepted receipts have deterministic sequence/revision + previous-head binding;
- transport may reorder/duplicate delivery without changing accepted canonical reconstruction;
- two independent runtimes given the same trusted checkpoint + accepted receipts produce identical state/digest;
- transport implementation can be replaced without changing state semantics;
- no participant may directly mutate canonical state through the transport layer.

### First authority mode

Start with **`single-sequencer`**, because it is the smallest honest model for a non-commutative shared causal world.

This does **not** mean Global State becomes server-first. The sequencer should own only what cannot be reconstructed independently:

- identity/admission evidence;
- accepted ordering;
- compact durable mutation history/head.

It must not continuously simulate the world merely because it sequences events.

## Later research modes — do not mix into Proof 005

### `local-owner`

No remote authority. Useful for private/offline software and worlds.

### `mergeable`

CRDT-like mode for operations explicitly proven order-independent/mergeable. Do not apply this to causal game actions by default.

### `multi-peer-agreement`

Later P2P consensus/trust/identity research for non-commutative state. This is explicitly **not** the next implementation rung.

## Stop condition for second-wave implementation

Stop again once one provider-neutral agreement proof demonstrates:

1. accepted mutation ordering independent of transport delivery order;
2. deterministic reconstruction on two independent runtimes;
3. stale/conflicting mutation rejection;
4. duplicate delivery idempotence;
5. authority responsibilities separated from simulation compute;
6. explicit non-claims around identity security, production persistence, consensus and hostile-network resilience.

Then review before attaching WebSocket, P2P or a hosted provider.
