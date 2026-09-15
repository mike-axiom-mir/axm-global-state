# AXM Global State — Foundation

Status: **EXPERIMENTAL / ROOTED RESEARCH**

## 1. What Global State means

Global State is the smallest trustworthy description of **what is true now** for a system that may be rendered, computed or interacted with by different runtimes.

It is not a screen, game loop, website, database row, server process or model context. Those are possible mechanisms around it.

A useful abstract contract is:

```text
CurrentState = Reconstruct(
  trustedGenesisOrCheckpoint,
  acceptedOrderedEvents,
  authoritativeLogicalTime,
  deterministicRules,
  sparsePersistentMutations
)
```

The exact representation may differ by product, but equivalent trusted inputs must not silently produce incompatible realities.

## 2. The Temporal State Kernel

The **AXM Temporal State Kernel** is the technical mechanism that turns prior state + accepted change + elapsed logical time into current state.

Its responsibilities are deliberately narrow:

- identify the trusted starting point;
- determine the interval that must be advanced;
- apply exact elapsed-time transforms where no intermediate ordering matters;
- enumerate deterministic event/decision boundaries where ordering does matter;
- apply accepted external events once and in canonical order;
- preserve idempotence;
- emit current state plus replay/evidence metadata;
- fail closed when the starting state, event history or authority assumptions are incompatible.

The kernel does **not** decide game design, UI, visual presentation or who is allowed to author shared truth.

## 3. Time is data

Wall-clock time is not automatically authority.

A product must define how real time maps into its logical time domain. Examples:

- one logical tick per second;
- one world hour per real hour;
- a paused local simulation where logical time advances only while explicitly active;
- a shared world whose authority publishes a monotonic world index.

The kernel should receive the authoritative logical interval, not guess it from a random client clock when shared truth matters.

## 4. Do not replay empty time

If a quantity can be advanced exactly with arithmetic, use arithmetic.

Example:

```text
newFood = oldFood + productionRate * elapsedTicks - consumptionRate * elapsedTicks
```

Do not execute 21,600 empty one-second ticks merely because six hours passed.

But if state can cross meaningful boundaries during that interval, those boundaries must be processed in deterministic order. Examples:

- scheduled arrivals;
- research completion;
- resource depletion;
- an hourly asteroid/event stream;
- a deterministic NPC decision point;
- combat/contact between two moving forces;
- an externally accepted player command.

The target is therefore **eventful catch-up**, not naive closed-form math for everything and not brute-force ticking for everything.

## 5. Persistence model

Prefer to persist what cannot be cheaply or safely reconstructed.

A possible hierarchy:

```text
immutable rules / version
        +
world or system seed
        +
trusted checkpoint
        +
ordered accepted event journal
        +
sparse mutations
        +
logical time
        ↓
reconstructed current state
```

Untouched procedural possibility does not need to become millions of stored objects merely because it could exist.

## 6. Authority is separate from compute

A browser may correctly compute a deterministic next state and still lack authority to declare that state canonical for everyone else.

Keep these questions separate:

1. **Can this runtime compute the transition?**
2. **Is this runtime allowed to author or accept the mutation?**
3. **Can another runtime independently verify/reconstruct it?**

This lets local/offline products have zero remote dependency while shared worlds can use a minimal authority/agreement layer without moving all simulation compute onto that layer.

## 7. Local and shared modes

### Local / single-owner mode

Possible target:

- state stays on the device;
- logical time policy is local and explicit;
- no remote service is required;
- after shutdown, the next launch catches up deterministically.

### Shared mode

Possible target:

- participants receive a common trusted checkpoint/history;
- accepted mutations have canonical order;
- participant devices reconstruct state locally;
- only the minimum authority/agreement surface remains shared;
- reconnect means catch up from checkpoint + journal + logical time rather than download an opaque continuously simulated universe.

The project does **not** assume the shared-authority problem is already solved.

## 8. State views

Different consumers may render the same truth differently:

- RTS map;
- RPG character/world view;
- mobile summary;
- spectator view;
- AI-native player interface;
- audit/replay interface;
- ordinary software dashboard.

A cheaper or different view may omit presentation detail but may not silently invent or erase canonical facts.

## 9. Versioning and migration

Determinism is meaningless if two runtimes apply different rule versions while claiming the same world.

Every reconstructable state should eventually bind to enough provenance to identify:

- rules/kernel version;
- schema version;
- seed/genesis identity;
- checkpoint identity;
- event/journal head;
- logical time index;
- migration history when rules change.

Migration must be explicit. No silent rewrite of historical state.

## 10. Failure rules

Prefer explicit failure over invented continuity.

Fail closed when, for example:

- a checkpoint hash does not match;
- an event appears twice with conflicting payloads;
- a prior revision/head is stale;
- rule versions are incompatible;
- time goes backward without a defined branch/rollback operation;
- a client asserts state it cannot prove;
- an offline catch-up requires an interaction whose ordering cannot be reconstructed safely.

## 11. What success would mean

A successful Global State foundation would let a product say:

> The system did not need to run continuously. We preserved enough truth that any compatible runtime can reconstruct what the elapsed time and accepted events mean now.

That is the research target—not pretending that computation, persistence, networking or consensus have disappeared.
