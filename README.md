# AXM Global State

Status: **EXPERIMENTAL RESEARCH FOUNDATION**

AXM Global State researches one simple question:

> **Given what was true before, what happened, and how much time passed — what is true now?**

The goal is a reusable state foundation for games, worlds, software and machine environments that can survive shutdown, disconnection, device changes and periods where nothing is continuously running.

The first practical experiment is [`axm-global-state-rts`](https://github.com/mike-axiom-mir/axm-global-state-rts), but this repository is deliberately **not RTS-specific**.

## Core idea

A compatible runtime should be able to reconstruct current state from a small set of explicit inputs:

```text
genesis or trusted checkpoint
+ authoritative / logical time
+ deterministic transition rules
+ accepted ordered events
+ sparse persistent mutations
= current global state
```

The compute may happen in a browser, local application, phone, desktop, hosted worker or another compatible runtime. The research target is **not zero computation**. The target is reducing unnecessary dependence on an always-running simulation server.

## Important distinction

`running compute` and `requiring a dedicated server` are not the same thing.

A browser executing JavaScript / WebAssembly / WebGPU is useful compute on the participant's own device. If six hours pass while no runtime is active, the system should be able to reconstruct what those six hours mean when a compatible runtime returns, instead of requiring six hours of continuous simulation simply to preserve continuity.

## Technical core name

The reusable technical mechanism inside this research is called the **AXM Temporal State Kernel**.

The repository name stays human-readable: **Global State** describes the thing we are protecting. Logical clocks, event journals, replay, checkpoints, deterministic catch-up and synchronization are mechanisms for producing and preserving it.

## Starting principles

1. **State before presentation.** A renderer, website or UI is an expression of state, not the state itself.
2. **Deterministic where practical.** Equivalent trusted inputs should reconstruct equivalent state.
3. **Time is explicit input.** Offline time must not be hidden inside wall-clock assumptions.
4. **Do not tick what can be derived.** Continuous quantities should jump by elapsed-time arithmetic when exact.
5. **Resolve meaningful boundaries.** Scheduled events, decisions and conflicts are processed when intermediate ordering matters.
6. **Persist mutations, not untouched possibility.** Procedural or reconstructable state should remain reconstructable.
7. **Replay must be evidence.** History should be inspectable and failures should fail closed rather than silently rewriting the past.
8. **Compute and authority are separate questions.** A participant device may compute state without automatically having authority to invent shared truth.
9. **Human and machine participants use the same state contracts where possible.** Controller type should not silently change world truth.
10. **No fake serverless claim.** Shared global history may still need a minimal authority / agreement mechanism. This project researches how small that dependency can become; it does not pretend consensus is free.

## First research targets

- deterministic offline catch-up;
- logical/global time contracts;
- event sourcing and append-only journals;
- checkpoints and replay verification;
- sparse state / procedural reconstruction;
- browser and device runtimes;
- reconnect and state convergence;
- shared-state patterns used by chat/group websites;
- conflict ordering and idempotence;
- minimal shared authority for multi-user worlds;
- local/offline mode with zero remote dependency;
- adapters for games, simulations and ordinary software.

See `FOUNDATION.md`, `RESEARCH_MAP.md`, and `NEXT_BUILD.md`.

## Constitutional merge gate

AXM internal integration is evaluated through four roots:

- **Truth**
- **Agency / non-domination**
- **Continuity**
- **Wisdom before speed**

There is no automatic CANON. Evidence and the four roots decide what survives.
