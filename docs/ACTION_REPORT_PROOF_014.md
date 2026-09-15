# Action Report — Proof 014: logical-time corroboration

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Provide an explicit evidence path for releasing a Proof-013-held shared-time advance when multiple configured source chains agree closely enough under a product-defined corroboration policy.

## Candidate proof

A primary valid source (`clock-a`) claims tick `86,400`. Under a single-source max-forward policy of `3,600` ticks from the last admitted tick `600`, that claim is correctly held.

The corroboration policy configures three shared-authority source IDs, requires at least two distinct sources, and permits a maximum spread of `30` ticks:

- `clock-a`: `86,400`;
- `clock-b`: `86,420`;
- `clock-c`: `200,000`.

Expected result:

- unique best agreement group = `clock-a + clock-b`;
- spread = `20` ticks;
- outlier `clock-c` excluded;
- admitted tick = conservative minimum = `86,400`;
- Temporal State reconstructed at that tick matches the existing Proof-011/012/013 digest.

## Required adversarial evidence

- `clock-a + clock-c` alone → insufficient corroboration → hold;
- two equally strong disjoint source clusters → ambiguous corroboration → hold;
- duplicate use of one source ID → fail closed;
- unconfigured source ID → fail closed;
- trust-scope mismatch → fail closed;
- time-contract mismatch → fail closed;
- configured source behind already-admitted global time → record/exclude it, never move time backward;
- duplicate configured policy source IDs → invalid policy;
- impossible `minSources` greater than configured source count → invalid policy.

## Selection truth boundary

v0 uses a deterministic policy:

1. eligible source results must be at or ahead of already-admitted time;
2. source groups must fit within configured `maxSpreadTicks`;
3. prefer largest group;
4. among equal-size groups prefer smallest spread;
5. if more than one distinct equally strong group remains, **hold**;
6. for one group, admit its minimum tick.

No random tie-break is permitted.

## Independence truth boundary

Different source IDs do not prove real-world independence. The proof establishes agreement among separately configured evidence identities only.

It does not establish that the sources use separate operators, hardware, upstream clocks, networks, keys, or failure domains.

## Truth boundary

Do not claim Proof 014 PASS until exact-head CI succeeds.

Even after a pass this remains bounded experimental corroboration logic. It does not authenticate sources, prove physical time, provide signatures, establish Byzantine consensus, use uncertainty intervals, or choose universally correct source-count/spread values.
