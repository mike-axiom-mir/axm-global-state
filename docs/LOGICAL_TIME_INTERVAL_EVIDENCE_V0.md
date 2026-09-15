# AXM Global State — Logical Time Interval Evidence v0

Status: **EXPERIMENTAL / UNCERTAINTY BOUNDARY**

Proofs 012–014 model exact logical ticks, explicit admission policy, and corroboration across configured sources. Exact ticks are still stronger precision than some real time systems can honestly provide.

This layer allows a configured source to say:

> Current logical time is somewhere between `earliestTick` and `latestTick`.

The interval is evidence of claimed uncertainty, not proof that physical time truly lies inside it.

## External architectural reference

Roughtime represents server time with a midpoint and radius, effectively an uncertainty interval, and chains queries across servers to make contradictory behavior visible.

Reference:

- https://roughtime.googlesource.com/roughtime/+/HEAD/PROTOCOL.md

AXM does not claim Roughtime security or signatures here. The interval idea is used only as an architectural constraint against fake precision.

## Single-source interval chain

Each interval evidence record binds:

- source ID;
- trust scope;
- contract ID;
- sequence;
- `earliestTick`;
- `latestTick`;
- previous accepted head;
- deterministic evidence head.

Requirements:

- earliest/latest are non-negative safe integers;
- `latestTick >= earliestTick`;
- sequence is contiguous;
- source/scope/contract remain bound;
- previous-head chain and deterministic head verify;
- the **guaranteed lower bound** (`earliestTick`) may never move backward.

The upper bound is allowed to shrink when uncertainty improves. Example: `[600,700] -> [650,660]` is legal because the source now guarantees at least tick 650 while expressing a narrower uncertainty range.

## Interval corroboration

A product configures:

- explicit source IDs;
- minimum distinct source count;
- maximum allowed individual source uncertainty width;
- maximum allowed final intersection width;
- trust scope and comparable contract ID.

Wholly lagging intervals are recorded/excluded. Intervals wider than `maxSourceWidthTicks` are also recorded/excluded; a source with an enormous interval must not count as corroboration merely because it covers every possible time.

For eligible sources, the evaluator searches for common-overlap groups.

Selection:

1. group must contain at least `minSources`;
2. common intersection must exist;
3. intersection width must fit `maxIntersectionWidthTicks`;
4. prefer largest source group;
5. among equal-size groups prefer smallest intersection width;
6. if more than one distinct equally strong group remains, `hold` for ambiguity;
7. for one selected group, canonical admitted tick is the intersection's **lower bound**.

The lower bound is conservative: every selected source jointly permits the statement that time has reached at least that tick. The midpoint is not invented as canonical truth.

## Important non-claims

- Interval evidence does not prove the interval contains physical time.
- Different source IDs do not prove independent operators/hardware/upstreams.
- This is not authentication, signatures, Byzantine consensus, NTP, Roughtime, or TrueTime.
- Policy widths are product choices; Global State defines no universal values.
- Deterministic FNV heads remain test/replay evidence, not security primitives.
