# Action Report — Proof 014: logical-time corroboration

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Provide an explicit evidence path for releasing a Proof-013-held shared-time advance when multiple configured source chains agree closely enough under a product-defined corroboration policy.

## Tested proof

A primary valid source (`clock-a`) claims tick `86,400`. Under a single-source max-forward policy of `3,600` ticks from the last admitted tick `600`, that claim is correctly held.

The corroboration policy configures three shared-authority source IDs, requires at least two distinct sources, and permits a maximum spread of `30` ticks:

- `clock-a`: `86,400`;
- `clock-b`: `86,420`;
- `clock-c`: `200,000`.

Observed result:

- unique best agreement group = `clock-a + clock-b`;
- spread = `20` ticks;
- outlier `clock-c` excluded;
- admitted tick = conservative minimum = `86,400`;
- Temporal State reconstructed at that tick matches the existing Proof-011/012/013 digest.

## CI evidence

Candidate head before this report-only evidence update: `91c492d25df571779655d7d6669b4225b6c6a122`.

Proof 014 workflow:

- run: `35011723873`
- job: `104525065212`
- result: **SUCCESS**
- runner: Ubuntu 24.04 / Node.js `v22.23.2`
- Proof 012 time-evidence regression: **PASS**
- Proof 013 time-admission regression: **PASS**

Observed output:

```text
AXM Global State proof 014 logical time corroboration: PASS
primarySingleSourceStatus: hold
priorAdmittedTick: 600
corroborationStatus: accepted
corroboratedTick: 86400
supportingSourceIds: clock-a, clock-b
spreadTicks: 20
excludedOutlierIds: clock-c
insufficientStatus: hold
ambiguousStatus: hold
laggingSourceExcluded: clock-a
duplicateSourceRejected: true
crossTrustSourceRejected: true
finalStateDigest: fnv1a32:74f37cf0
sourceIdsProveRealWorldIndependence: false
```

## Adversarial evidence

The tested candidate also proves:

- `clock-a + clock-c` alone → insufficient corroboration → hold;
- two equally strong disjoint source clusters → ambiguous corroboration → hold;
- duplicate use of one source ID → fail closed;
- unconfigured source ID → fail closed;
- trust-scope mismatch → fail closed;
- time-contract mismatch → fail closed;
- configured source behind already-admitted global time → record/exclude it, never move time backward;
- duplicate configured policy source IDs → invalid policy;
- impossible `minSources` greater than configured source count → invalid policy.

## Selection boundary

v0 uses one deterministic policy:

1. eligible source results must be at or ahead of already-admitted time;
2. source groups must fit within configured `maxSpreadTicks`;
3. prefer largest group;
4. among equal-size groups prefer smallest spread;
5. if more than one distinct equally strong group remains, **hold**;
6. for one group, admit its minimum tick.

No random tie-break is permitted. Canonical text ordering uses direct code-unit comparison rather than locale-sensitive collation.

## Independence truth boundary

Different source IDs do **not** prove real-world independence. The proof establishes agreement among separately configured evidence identities only.

It does not establish that the sources use separate operators, hardware, upstream clocks, networks, keys, or failure domains.

## Research basis

NTPv4 uses selection/clustering across multiple sources to reject inconsistent candidates, while Roughtime uses authenticated time intervals and chained queries to expose contradictory server behavior. These are architectural references only; AXM does not claim equivalent correctness or security.

## Truth boundary

Proof 014 remains bounded experimental corroboration logic. It does not authenticate sources, prove physical time, provide signatures, establish Byzantine consensus, use uncertainty intervals as canonical evidence, prove real-world source independence, or choose universally correct source-count/spread values.

A next safe research rung is explicit **uncertainty intervals** rather than exact source ticks: preserve each source's claimed earliest/latest range, corroborate interval overlap, and advance only to a lower bound supported by the configured evidence policy.
