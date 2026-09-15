# AXM Global State — Research Map

Status: **OPEN RESEARCH MAP**

This file records the main questions to investigate without pretending they are already solved.

## A. Shared-state web patterns

Study how modern multi-user web systems keep many browsers grounded in one evolving shared state.

Questions:

- snapshots versus event logs;
- push updates versus polling;
- reconnect/catch-up behavior;
- optimistic revisions;
- conflict resolution;
- idempotent command IDs;
- authoritative ordering;
- partial replication;
- state hashing;
- event sourcing;
- CRDTs where convergence without a central order is useful;
- when WebSocket-style live streams help and when they are unnecessary;
- what can remain static-hosted versus what needs a minimal write/authority surface.

The goal is not to copy chat architecture blindly. Chat/group systems are one mature reference for keeping many clients on shared ground.

## B. Logical time

Define time as an explicit input to state transitions.

Research:

- monotonic logical indexes;
- real-time → logical-time mapping;
- pause policies;
- clock skew;
- reconnect after long absence;
- deterministic scheduled events;
- local clock versus shared world clock;
- rule-version changes across long elapsed intervals.

## C. Catch-up strategies

Compare three classes of update:

1. **Closed-form / direct delta** — jump exact continuous quantities mathematically.
2. **Boundary/event stepping** — process only moments where state interactions matter.
3. **Fine simulation** — use bounded detailed stepping only when the system truly requires it.

Research how a kernel can combine all three while preserving identical results.

## D. Checkpoints and journals

Research:

- append-only command/event journals;
- snapshot/checkpoint frequency;
- hash chains;
- replay verification;
- compaction without erasing provenance;
- rollback and branching;
- migration between schema/rule versions;
- corruption recovery;
- deterministic checkpoint IDs.

## E. Sparse state

Explore systems where most possible state never needs storage.

Examples:

- procedural worlds where untouched regions are derived from seed;
- economies where only changed accounts/items exist explicitly;
- scheduled systems where future events are generated from seed + time index;
- dormant capabilities represented by compact descriptors until activated.

## F. Authority without simulation dependency

Separate authoritative history from simulation compute.

Research paths:

- tiny hosted mutation/order service + client reconstruction;
- append-only shared store;
- signed command receipts;
- deterministic validators;
- fixed opt-in relays;
- P2P exchange;
- multi-writer compare-and-swap;
- quorum/consensus approaches only where actually necessary;
- offline-first single-owner state with later merge where safe.

Do not claim “no server” when a shared authority dependency still exists. The goal is to minimize dependency, not rename it.

## G. Device/browser runtime

Research practical execution in:

- JavaScript;
- WebAssembly;
- WebGPU for suitable parallel compute;
- desktop/local runtimes;
- phones;
- headless verification runtimes.

Questions include deterministic numeric behavior across runtimes, performance, memory budgets, sandboxing, and rule-version compatibility.

## H. Security / cheating boundary

A deterministic client can reproduce truth but should not automatically be trusted to author truth.

Research:

- command validation;
- replay receipts;
- signed identities where appropriate;
- hidden-information boundaries;
- deterministic anti-cheat evidence;
- malicious event/journal injection;
- stale-state writes;
- duplicate/reordered events;
- client clock manipulation.

## I. Human + machine participation

Where products expose participant seats, keep the state contract controller-neutral when practical.

Research:

- same command surface;
- same state visibility;
- same action/rate limits;
- machine-readable observations without privileged hidden state;
- reproducible receipts for human and machine actions.

## J. Candidate consumers

Potential experiments after the kernel is credible:

- `axm-global-state-rts`;
- persistent RPG/world simulation;
- Juicy-Empire-like persistent worlds;
- WALMI environments;
- long-running local simulations;
- collaborative spaces;
- economy/strategy sandboxes;
- software workflows where scheduled state should advance while the app is closed.

## Research discipline

For every mechanism, record separately:

- **known / sourced behavior**;
- **AXM hypothesis**;
- **implemented proof**;
- **tested evidence**;
- **not yet known**.

Research may broaden. CANON may not broaden without evidence.
