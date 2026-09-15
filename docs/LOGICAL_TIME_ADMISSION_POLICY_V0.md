# AXM Global State — Logical Time Admission Policy v0

Status: **EXPERIMENTAL / POLICY BOUNDARY**

Proof 012 answers whether a logical-time claim belongs to the configured monotonic evidence chain. It intentionally does **not** answer whether every valid forward claim should automatically become the product's current time.

This layer separates those questions.

## External lesson

Authenticated time is not automatically accurate time. Network Time Security (RFC 8915) authenticates NTP exchanges and provides replay/request-response protections, while its security considerations still discuss delay attacks and recommend multiple time sources as one mitigation.

Spanner/TrueTime similarly represents time uncertainty explicitly rather than pretending one local clock reading is universally exact.

References:

- https://www.rfc-editor.org/info/rfc8915
- https://docs.cloud.google.com/spanner/docs/true-time-external-consistency
- https://docs.cloud.google.com/spanner-omni/true-time-external-consistency

These are architectural inputs only. AXM does not claim NTS or TrueTime guarantees.

## v0 modes

### `unbounded-monotonic`

The product explicitly permits any forward tick from its already-verified configured evidence source.

This is a real policy choice, not the implicit default. It can be appropriate for a single-owner/local product that deliberately trusts its configured source or for another system whose stronger source guarantees live outside this layer.

### `max-forward-delta`

The product declares the maximum number of ticks it will advance **automatically** from the last admitted tick on one candidate evaluation.

If a valid evidence claim exceeds that delta, the result is `hold`.

A hold:

- leaves the admitted tick unchanged;
- does not clamp to the maximum;
- does not manufacture intermediate time evidence;
- does not execute product/world catch-up to a made-up partial tick;
- explicitly requires a policy change or later corroboration/approval.

No default maximum is defined by Global State. A product must choose its own value because legitimate absence windows differ radically between products.

## Policy provenance

A policy binds:

- policy ID;
- evidence source ID;
- trust scope (`local-owner` or `shared-authority`);
- time-contract ID;
- admission mode;
- maximum forward delta when bounded.

This prevents an unbounded local-owner policy from silently being reused for shared-authority evidence.

## What v0 does not solve

- source authentication or signatures;
- physical-time accuracy;
- clock drift/uncertainty measurement;
- multiple-source quorum;
- automatic corroboration;
- malicious but authorized sources;
- a universally correct forward limit;
- production security.

The point is narrower: **valid time evidence and automatic time admission are separate decisions, and oversized valid claims must never be silently converted into fake canonical time.**
