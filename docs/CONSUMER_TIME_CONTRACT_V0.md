# AXM Global State — consumer time contract v0

Status: **EXPERIMENTAL RESEARCH CONTRACT**

## Why this contract exists

Global State cannot truthfully reconstruct arbitrary software from elapsed time unless the consuming system defines what elapsed time means for its own state transitions.

The kernel must not guess whether `advance(12 hours)` is equivalent to twelve `advance(1 hour)` calls.

The first RTS consumer investigation exposed exactly this boundary: an aggregate city contains nonlinear/history-sensitive logic, so a one-shot long delta is not automatically equivalent to repeated updates.

## Required consumer declaration

A consumer that wants offline / absence catch-up must declare one temporal mode.

### 1. `closed-form`

Use when the consumer proves that it can reconstruct the target state directly from prior state + elapsed time + accepted inputs without depending on arbitrary intermediate call boundaries.

Examples may include:

- linear accumulation;
- position derived from departure/arrival times;
- deterministic formula-based decay where the formula itself defines the canonical result.

A closed-form consumer should be tested for chunk invariance over representative schedules before making that claim.

### 2. `fixed-quantum`

Use when intermediate updates are part of the semantics.

The product explicitly declares a canonical quantum, for example one world minute or one world hour. Offline catch-up processes completed quantum boundaries exactly as live simulation would.

This is still useful: a world that normally renders at 60 FPS may need only 1,440 canonical hourly economy transitions for 60 days, rather than billions of render/update frames.

The quantum is product behavior. The Global State kernel must not invent it merely for performance.

### 3. `event-boundary`

Use when state can jump safely between meaningful deterministic boundaries but must resolve specific events in order.

Examples may include:

- construction completion;
- scheduled policy change;
- arrival/departure;
- resource exhaustion threshold;
- deterministic NPC decision window;
- accepted external command.

The consumer provides or derives the ordered boundary set. The kernel preserves ordering and reconstructs between those boundaries without manufacturing hidden intermediate events.

## Mixed consumers

A real system may combine modes internally.

Example:

```text
linear food production        -> closed-form
starvation/readiness update   -> fixed-quantum
construction completion       -> event-boundary
player command                -> event-boundary
```

A product-level adapter may compose those pieces, but each piece still needs explicit semantics.

## Minimum contract identity

Every consumer time contract should bind at least:

- stable consumer ID;
- contract version;
- temporal mode;
- logical-time unit / interpretation;
- rule/schema version;
- fixed quantum when applicable;
- explicit remainder behavior when applicable.

Changing any of those may change reconstruction meaning and therefore requires versioned evidence/migration rather than a silent rewrite.

## Authority is separate

This contract only answers **how accepted state advances through time**.

It does not decide:

- who may submit mutations;
- which checkpoint is authoritative;
- how multiple devices agree on event order;
- whether a shared authority is local, hosted, P2P or otherwise distributed.

Compute semantics and mutation authority remain separate layers.

## First product evidence

`axm-global-state-rts` is the first external consumer candidate. Its aggregate-city research lane is intentionally characterizing current chunk sensitivity before the RTS chooses a fixed quantum, refactors selected equations, or exposes event boundaries.

Until that product contract exists, Global State must not claim aggregate-city offline reconstruction is integrated.
