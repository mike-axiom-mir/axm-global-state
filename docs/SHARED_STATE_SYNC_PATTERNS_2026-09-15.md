# AXM Global State — shared-state synchronization patterns

Date: 2026-09-15
Status: **RESEARCH MAP / NOT AN IMPLEMENTATION CLAIM**

## Research question

How do real browser/chat/collaboration systems keep multiple clients aligned, and which responsibilities can AXM Global State reduce through deterministic reconstruction rather than continuous server-side simulation?

The important finding is that "shared state" is not one mechanism. Mature systems separate several responsibilities that are easy to accidentally collapse into one word such as server, sync, or realtime.

## Responsibility layers

```text
transport
  moves messages/updates

local cache / local persistence
  lets a device remain responsive and retain useful state

mutation admission / identity
  decides who is allowed to propose or commit a change

ordering / conflict semantics
  decides which changes count and in what relation/order

journal / durable history
  preserves accepted mutations

checkpoint / snapshot
  shortens reconstruction cost

deterministic reconstruction
  derives current state from prior truth + accepted changes + logical time

presentation
  renders one view of current state
```

Global State should not turn all of these layers into one giant runtime.

## Pattern A — WebSocket transport

Browser WebSockets provide a long-lived two-way communication channel between browser and server without repeated HTTP polling.

What this solves:

- low-latency message transport;
- server → client push;
- client → server messages over one live connection.

What this does **not** solve by itself:

- which client is authoritative;
- conflict resolution;
- durable history;
- offline reconstruction;
- canonical ordering;
- state persistence.

**AXM interpretation:** WebSocket is a possible transport adapter. It should never become the definition of Global State.

Source: MDN WebSocket API — https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API

## Pattern B — local-first responsiveness + central convergence

Firebase Realtime Database clients keep a local version of active data. Writes are applied locally first so the app responds immediately, then synchronized with remote database servers and other clients. After reconnect, the client receives events needed to synchronize with current server state.

That demonstrates a useful separation:

```text
local responsive state
      +
remote canonical/converged state
      +
reconnect synchronization
```

The Firebase web API also has an important boundary: browser-local offline data does not automatically survive closing the page unless the write reached the server.

**AXM interpretation:** Global State can preserve the good local-runtime property while making explicit which data is locally reconstructable and which accepted mutations require shared persistence.

Source: Firebase Realtime Database web read/write docs — https://firebase.google.com/docs/database/web/read-and-write

## Pattern C — append-only event history + snapshots

Event sourcing stores accepted domain changes as an append-only event sequence rather than only overwriting current state. Current state can be rebuilt by replaying those events. Optimistic concurrency can reject an append when the stream changed after a client read it.

Long histories make full replay expensive, so event-sourced systems commonly use snapshots/checkpoints and replay only the events after the latest snapshot. The event stream remains the historical source of truth; the snapshot is an optimization.

This is extremely close to several Global State pieces already proven experimentally:

```text
checkpoint
+ accepted ordered events
+ deterministic rules
= reconstructed state
```

**AXM difference:** Global State also treats elapsed logical time as explicit reconstruction input, so reconstructable world evolution does not need to be recorded as millions of synthetic events merely because time passed.

Source: Microsoft Azure Architecture Center, Event Sourcing pattern — https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing

## Pattern D — CRDT / order-independent convergence

Yjs demonstrates a different class of shared state. For its CRDT document updates, the network transport is deliberately separate from the data model: as long as all updates eventually arrive, update application order does not matter and a central source of truth is not required for conflict resolution.

This is powerful but must not be generalized to every Global State consumer.

A text/document collaboration operation can often be designed to commute/merge. A causal strategy world may contain non-commutative actions:

```text
player A buys final unit
player B buys final unit
```

or:

```text
army A destroys bridge
army B crosses bridge
```

For those cases, event order can change world truth. A CRDT transport/model cannot magically remove the need for an agreed causal relation unless the product semantics themselves are redesigned to commute.

**AXM interpretation:** Global State should support an order-independent/mergeable authority mode later, but only for consumers whose operations genuinely satisfy that contract.

Source: Yjs documentation — https://docs.yjs.dev/

## Pattern E — hibernating coordinator

Cloudflare Durable Objects show that a shared coordinator does not have to remain continuously active in memory. Their WebSocket hibernation model can keep clients connected while an idle object is evicted from memory and wake it when new events arrive.

That is not dependency-free—there is still hosted infrastructure and a coordinating authority—but it demonstrates an important principle:

> persistent shared semantics do not require continuously hot simulation compute.

**AXM interpretation:** Global State goes after a related but broader target: if deterministic time/state reconstruction is sufficient, even the *world simulation itself* can remain dormant and be reconstructed on the next compatible runtime. A minimal coordinator, when needed, should protect accepted history/order rather than continuously simulate every reconstructable detail.

Source: Cloudflare Durable Objects WebSocket / Hibernation docs — https://developers.cloudflare.com/durable-objects/best-practices/websockets/

## Pattern F — same-device / same-origin synchronization

The browser Broadcast Channel API lets same-partition browsing contexts such as tabs or workers communicate by subscribing to a named channel. The API transports messages but does not define their semantics.

This is useful for local multi-context coordination:

```text
Tab A ─┐
Worker ├─ BroadcastChannel ─ local state/event coordination
Tab B ─┘
```

No remote server is required for those contexts to exchange messages.

**AXM interpretation:** a future browser Global State runtime can use same-device channels as one local transport while keeping canonical reconstruction and authority contracts above it.

Source: MDN Broadcast Channel API — https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API

## The central AXM separation

The research points toward one architectural rule:

> **State reconstruction and mutation agreement are different problems.**

Global State can potentially eliminate or reduce a large amount of continuous simulation and state transmission without claiming it has eliminated the need to agree about conflicting shared mutations.

### Reconstruction problem

Given trusted inputs:

```text
checkpoint/genesis
+ logical time
+ accepted ordered/mergeable mutations
+ deterministic consumer rules
= current state
```

A browser, phone, desktop, hosted process or other compatible device can perform that computation.

### Agreement problem

When two participants propose changes, determine:

- identity / authorization;
- whether each mutation is admissible;
- whether order matters;
- the accepted order or merge relation;
- duplicate/idempotence handling;
- which history/checkpoint is canonical or mutually agreed.

Deterministic reconstruction does not answer those questions automatically.

## Candidate Global State authority modes

These are research categories, not implemented capabilities.

### Mode 1 — `local-owner`

One device/user owns the history.

- no remote authority dependency;
- local durable checkpoint/journal;
- logical-time catch-up on wake;
- other local tabs/workers may coordinate through local browser/device messaging.

Best first target for ordinary offline software and private worlds.

### Mode 2 — `single-sequencer`

A small shared authority admits and orders mutations.

```text
participants propose compact intents
          ↓
minimal sequencer / authority
          ↓
accepted append-only event order
          ↓
devices independently reconstruct state
```

The sequencer need not continuously simulate the whole product. Its responsibility is much smaller: identity/admission/order/durable accepted history.

This looks like the most practical near-term mode for one shared causal game world.

### Mode 3 — `mergeable`

For operations explicitly proven commutative/mergeable, participants can exchange changes without one global order and converge after all accepted updates arrive.

CRDT-style research belongs here.

Do not use this mode merely because decentralization is attractive.

### Mode 4 — `multi-peer-agreement`

Peers collectively agree on non-commutative mutations/order without one permanent sequencer.

This is a later consensus / trust / identity research problem. Do not pull it into the kernel before simpler modes are exhausted.

## What Global State may actually remove

Where product semantics allow it, Global State can aim to remove or dramatically reduce:

- always-running simulation loops;
- per-frame server updates for distant/dormant state;
- retransmission of state that can be reconstructed from seed/checkpoint/rules;
- full-history replay after every reconnect when checkpoints exist;
- duplicated simulation authority on every presentation surface;
- server compute devoted only to making time pass.

## What it cannot honestly remove by determinism alone

For a shared adversarial/causal system, Global State cannot simply wish away:

- participant identity/authentication;
- admission rules;
- conflicting non-commutative mutations;
- agreed event order or merge relation;
- durable availability of accepted shared history;
- cheating/forged inputs;
- version migration when rules change;
- network partitions and reconnection conflicts.

Those are agreement/trust/persistence problems, not simulation problems.

## Emerging target architecture

```text
              PRODUCT / WORLD
                    │
             consumer time contract
                    │
                    ▼
          TEMPORAL STATE KERNEL
        reconstructs canonical "now"
                    ▲
                    │
       checkpoint + accepted history
                    ▲
                    │
          MUTATION AGREEMENT LAYER
      local-owner / sequencer / mergeable
                    ▲
                    │
              TRANSPORT ADAPTERS
     WebSocket / WebRTC / HTTP / local channel
                    ▲
                    │
              HUMAN + MACHINE USERS
```

The layers should remain replaceable. A game should not need different world physics merely because its transport changes from WebSocket to P2P or from hosted to LAN.

## Proposed next research proof

Do **not** build a multiplayer stack yet.

The smallest useful next proof should be a **mutation-agreement seam** independent of networking:

1. two simulated participants propose mutations against the same checkpoint revision;
2. one authority mode orders/adopts them deterministically;
3. accepted event receipts are compact and append-only;
4. two independent runtimes receive only checkpoint + accepted receipts;
5. both reconstruct identical final state;
6. duplicate receipts are idempotent;
7. stale/conflicting proposals fail closed;
8. transport is mocked/replaced without changing state semantics.

That would prove the boundary before choosing WebSocket, P2P or any hosting provider.

## Research truth boundary

This document maps external patterns and derives candidate AXM architecture. It does not claim:

- Global State networking exists;
- consensus is solved;
- a central coordinator is unnecessary for all consumers;
- CRDT semantics fit games by default;
- current browser storage is production durability;
- a provider-specific system should be copied wholesale.

The next implementation should remain provider-neutral and evidence-first.
