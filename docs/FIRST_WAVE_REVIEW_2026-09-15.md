# AXM Global State — first-wave review

Date: 2026-09-15
Status: **REVIEW / TESTED FOUNDATION, NOT PRODUCTION**

## Original stop condition

The first wave was supposed to stop expanding once the repository could truthfully demonstrate:

1. deterministic state reconstruction after offline time;
2. equivalence between reference stepping and eventful catch-up;
3. restart/replay continuity;
4. portable execution in at least two compatible runtimes;
5. explicit truth boundaries around authority and networking.

Those conditions are now substantially met for the bounded experimental kernel.

## Evidence reached

### Proof 001 — deterministic offline catch-up

Implemented and repeatedly regression-tested:

- explicit logical tick;
- reference stepping versus eventful catch-up equivalence;
- recurring/scheduled boundaries;
- stable command IDs and idempotence;
- conflict rejection;
- backward-time rejection;
- rule-version binding;
- serialized checkpoint/restart continuity.

An early duplicate-boundary bug was found and repaired rather than hidden.

### Proof 002 — Node / Chromium portability

Tested on the same committed kernel and fixture:

- Node.js and real Chromium produce exact deep-equal canonical proof output;
- canonical numeric state is bounded to safe-integer / fixed-point semantics;
- locale-sensitive canonical ordering was removed;
- missing earlier command history fails closed.

This is JavaScript-runtime evidence, not cross-language proof.

### Proof 003 — long absence

Measured catch-up structure across one minute through one year of logical absence.

In the intentionally dense one-year fixture, 31,536,000 elapsed ticks are reconstructed with 525,604 jumps because a meaningful recurring event exists every 60 ticks. The proof avoids 31,010,396 individual per-tick transitions while producing the same canonical state as ordinary catch-up.

This is structural work-count evidence, not a CPU benchmark.

### Consumer Time Contract v0

Global State no longer assumes that every product may jump directly across arbitrary elapsed time.

Consumers explicitly declare one temporal mode:

- `closed-form`;
- `fixed-quantum`;
- `event-boundary`.

The contract binds consumer/version/rule/time semantics and fails closed on incomplete fixed-quantum configuration, phase-misaligned checkpoints and backward time.

## First external consumer finding

The first `axm-global-state-rts` aggregate-city research lane produced a useful blocker rather than a fake integration.

The same deterministic food-pressured city advanced through the same 43,200 elapsed seconds produces materially different results under one large update versus repeated updates. Existing city regression remains green.

That means the RTS must deliberately define its canonical aggregate-city time semantics before Global State can preserve intended behavior across long absence.

The RTS research PR remains draft. Global State must not choose that gameplay rule on the RTS's behalf.

## Four-root review

### Truth

The repo now has bounded passing evidence for its first claims and explicit non-claims around performance, distributed authority, product integration and arbitrary simulation determinism.

### Agency / non-domination

The generic kernel does not decide product policy. Consumer time semantics and mutation authority remain owned by the relevant product/system contract.

### Continuity

Version identity, replay evidence, checkpoint state, command history and temporal semantics are explicit rather than reconstructed from conversational intent.

### Wisdom before speed

The first external consumer surfaced a semantic mismatch before integration. That is a reason to preserve the boundary, not bypass it.

## Review decision

**Do not begin a large networking implementation yet.**

The next research pass should map how existing shared-state systems separate:

- transport;
- local cache;
- persistence;
- event/order authority;
- conflict resolution;
- snapshots/checkpoints;
- reconnect/catch-up;
- dormant/hibernating compute.

Then identify which responsibilities Global State can reconstruct deterministically and which still require agreement between participants.

This keeps the next architecture grounded in existing distributed-system lessons without turning Global State into a copy of any one backend product.
