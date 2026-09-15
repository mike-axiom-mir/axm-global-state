# Action Report — Proof 013: logical-time forward admission policy

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Separate a valid logical-time evidence claim from the product decision to advance canonical time automatically.

Proof 012 can establish that a tick claim is internally consistent, provenance-bound and monotonic. Proof 013 asks:

> What happens when the configured source is valid but the forward jump is larger than the product is willing to accept automatically?

## Candidate modes

`unbounded-monotonic`

- any forward tick from matching already-verified evidence is accepted;
- this must be selected explicitly;
- there is no hidden default maximum.

`max-forward-delta`

- product declares `maxForwardTicks`;
- candidate within the declared delta is accepted;
- candidate beyond the delta is returned as `hold`;
- hold leaves canonical admitted time unchanged.

## Candidate proof

The same Proof-012-valid claim advances from tick `600` to tick `86,400`, a delta of `85,800` ticks.

It is evaluated under three policies:

1. explicit unbounded shared-authority policy → accepted at `86,400`;
2. bounded shared-authority policy with max `3,600` → held at `600`;
3. bounded shared-authority policy with max exactly `85,800` → accepted at `86,400`.

The held result must never clamp the tick to `4,200` or manufacture intermediate time evidence.

## Required adversarial evidence

- rollback candidate relative to last admitted tick fails closed;
- bounded policy without a maximum is invalid;
- unbounded policy carrying a contradictory maximum is invalid;
- source mismatch fails closed;
- local-owner policy cannot be applied to shared-authority evidence;
- contract mismatch fails closed;
- held evidence leaves Temporal State at the prior admitted tick;
- accepted evidence reaches the same tick-86,400 product state as Proofs 011/012.

## Truth boundary

Do not claim Proof 013 PASS until exact-head CI succeeds.

Even after a pass this policy does not determine a universally correct maximum, authenticate the time source, measure clock uncertainty, perform multi-source corroboration, or protect against every malicious authorized-source strategy.

Its bounded contribution is to make automatic forward-time admission explicit and fail-safe instead of silently treating every provenance-valid future claim as immediately canonical.
