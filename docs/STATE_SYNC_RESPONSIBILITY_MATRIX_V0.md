# AXM Global State — state sync responsibility matrix v0

Status: **RESEARCH / ARCHITECTURE AID**

The purpose of this matrix is to stop the word `sync` from hiding several different responsibilities.

| Responsibility | Traditional realtime backend | Event-sourced system | CRDT/local-first system | AXM Global State target |
| --- | --- | --- | --- | --- |
| Transport | WebSocket/HTTP/etc. | Any transport/queue | Any provider; network-agnostic possible | Replaceable adapter; never canonical physics |
| Local responsiveness | Usually client cache/prediction | Read model/cache | Local document is primary working copy | Local runtime reconstructs/acts from known state |
| Mutation admission | Server/backend | Command handler | Product/provider-specific | Explicit authority mode |
| Global ordering | Commonly server ordered | Per-stream accepted event sequence | Often unnecessary for mergeable operations | Required only where product semantics are non-commutative |
| Conflict handling | Backend/product logic | Optimistic concurrency + domain reconciliation | CRDT merge rules | Authority-mode contract; never implicit |
| Durable history | Database/current state, sometimes log | Append-only event store | Local/replicated update history | Compact accepted mutation journal where required |
| Snapshot/checkpoint | Cache/state snapshot | Replay optimization | Persistence/provider-specific | Trusted reconstruction anchor |
| Time passage | Usually server/app simulation or scheduled work | Domain events/processes | Product-specific | Explicit logical time + consumer time contract |
| Reconstruct current state | Often fetch latest server state | Snapshot + replay | Merge replicated updates | Checkpoint + time + accepted history + deterministic rules |
| Idle compute | Often still provisioned somewhere | Consumers may be inactive | Local device can be absent | Prefer zero continuous simulation when state can be reconstructed |
| Presentation | Client renders server/current state | Projection/read model | Local document view | View only; may never silently invent authoritative facts |

## Important consequence

Global State should not optimize for "no server" as a slogan. It should optimize each responsibility independently:

- **compute:** move reconstructable work to whichever compatible runtime is awake;
- **transport:** choose what fits the deployment;
- **authority:** keep only the minimum agreement machinery the product actually requires;
- **persistence:** store irreducible accepted history/checkpoints, not every reconstructable frame;
- **presentation:** remain replaceable.

A shared causal world may still need a sequencer or later consensus. That does not imply it needs an always-running simulation server.

A mergeable collaborative document may avoid a central sequencer, but that does not prove a non-commutative game economy can do the same.

## Design test

For every proposed shared-state component, ask:

> Which responsibility is this solving?

If the answer contains more than one row of the matrix, check whether those responsibilities can remain separate before coupling them.
