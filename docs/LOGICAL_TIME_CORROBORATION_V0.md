# AXM Global State — Logical Time Corroboration v0

Status: **EXPERIMENTAL / CORROBORATION BOUNDARY**

Proof 013 can hold a provenance-valid forward-time claim when it exceeds a product's automatic single-source admission policy.

This layer asks a narrower follow-up:

> Can multiple explicitly configured source chains corroborate a held shared-time advance without silently disabling the admission boundary?

## External architectural references

NTPv4 uses source-selection and clustering algorithms across multiple time sources, including majority/intersection logic intended to discard inconsistent candidates (“falsetickers”). Roughtime represents server time as a signed midpoint plus radius and describes chaining requests across multiple independent servers to expose contradictory time behavior.

References:

- https://www.rfc-editor.org/info/rfc5905
- https://roughtime.googlesource.com/roughtime/+/HEAD/PROTOCOL.md
- https://roughtime.googlesource.com/roughtime/

AXM does not claim NTP/Roughtime correctness or equivalent security here. These are design references only.

## v0 policy

A corroboration policy explicitly binds:

- policy ID;
- trust scope;
- comparable time-contract ID;
- configured source IDs;
- minimum required distinct sources;
- maximum allowed tick spread inside one agreement group.

There is no assumption that arbitrary new source IDs are trustworthy.

## v0 selection

The evaluator:

1. verifies each supplied normalized source result belongs to the configured trust scope and time contract;
2. rejects duplicate use of one source ID;
3. rejects unconfigured source IDs;
4. excludes configured sources whose current tick is behind already-admitted global time;
5. finds candidate source groups whose tick spread is within the policy bound;
6. selects the largest group, then the smallest spread;
7. if more than one equally strong distinct group remains, returns `hold` for ambiguity;
8. if no group reaches `minSources`, returns `hold` for insufficient corroboration;
9. for one unique group, admits the conservative minimum tick reported by that group.

The conservative-min rule avoids choosing a time later than every selected source has claimed.

## Important non-claim: source independence

Different configured source IDs do **not** prove real-world independence.

Two source identities could still share:

- one operator;
- one physical clock;
- one upstream provider;
- one compromised machine;
- one correlated failure mode.

v0 only proves agreement among separately configured evidence identities. Real independence, authentication, topology diversity, signatures, and operator provenance are later layers.

## Relationship to Proof 013

A single-source forward claim may remain held under Proof 013 while a separate corroboration policy evaluates independent configured source chains.

Corroboration is not implemented as “raise the max-forward limit.” It is a distinct explicit release path with its own evidence and policy.

## Truth boundary

v0 does not establish physical-time correctness, real-world source independence, Byzantine consensus, authentication, signatures, uncertainty intervals, or a universally correct quorum/spread policy.
