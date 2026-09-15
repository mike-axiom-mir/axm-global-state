# Action Report — Proof 013: logical-time forward admission policy

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Separate a valid logical-time evidence claim from the product decision to advance canonical time automatically.

Proof 012 establishes that a tick claim is internally consistent, provenance-bound and monotonic. Proof 013 asks:

> What happens when the configured source is valid but the forward jump is larger than the product is willing to accept automatically?

## Tested modes

`unbounded-monotonic`

- any forward tick from matching already-verified evidence is accepted;
- this must be selected explicitly;
- there is no hidden default maximum.

`max-forward-delta`

- product declares `maxForwardTicks`;
- candidate within the declared delta is accepted;
- candidate beyond the delta is returned as `hold`;
- hold leaves canonical admitted time unchanged.

## Tested proof

The same Proof-012-valid claim advances from tick `600` to tick `86,400`, a delta of `85,800` ticks.

It is evaluated under three policies:

1. explicit unbounded shared-authority policy → accepted at `86,400`;
2. bounded shared-authority policy with max `3,600` → held at `600`;
3. bounded shared-authority policy with max exactly `85,800` → accepted at `86,400`.

The held result does not clamp the tick to `4,200` or manufacture intermediate time evidence.

## CI evidence

Candidate head before this report-only evidence update: `307eef392743dabb568d966199f5c98e4ce80305`.

Proof 013 workflow:

- run: `35010854398`
- job: `104522143568`
- result: **SUCCESS**
- runner: Ubuntu 24.04 / Node.js `v22.23.2`
- Proof 012 logical-time evidence regression: **PASS**

Observed result:

```text
AXM Global State proof 013 logical time admission policy: PASS
evidenceTick: 86400
priorAdmittedTick: 600
forwardDelta: 85800
unboundedStatus: accepted
boundedSmallStatus: hold
boundedSmallAdmittedTick: 600
boundedExactStatus: accepted
boundedExactAdmittedTick: 86400
heldStateDigest: fnv1a32:a5004c2e
acceptedStateDigest: fnv1a32:74f37cf0
crossTrustPolicyRejected: true
silentClampUsed: false
```

## Adversarial evidence

The tested candidate also proves:

- rollback relative to last admitted tick fails closed;
- bounded policy without a maximum is invalid;
- unbounded policy carrying a contradictory maximum is invalid;
- source mismatch fails closed;
- local-owner policy cannot be applied to shared-authority evidence;
- contract mismatch fails closed;
- held evidence leaves Temporal State at the prior admitted tick;
- accepted evidence reaches the same tick-86,400 product state as Proofs 011/012.

## Policy boundary

Global State does not define a universal maximum forward jump. Products differ too much for that to be truthful.

A large provenance-valid claim may therefore be:

- accepted automatically under an explicit unbounded policy;
- accepted under a bounded policy whose configured limit covers the delta;
- held without changing canonical time when it exceeds the configured automatic limit.

The hold action is deliberately non-destructive and non-fictional: it does not clamp or synthesize a partial time advance.

## Research basis

Network Time Security demonstrates that authentication/replay protection does not remove all time-accuracy risks such as asymmetric delay, and discusses multiple sources as one mitigation. TrueTime-style systems make uncertainty explicit. These are architectural references only; AXM does not claim equivalent guarantees.

## Truth boundary

Proof 013 does not determine a universally correct maximum, authenticate the time source, measure clock uncertainty, perform multi-source corroboration, or protect against every malicious authorized-source strategy.

Its bounded contribution is to make automatic forward-time admission explicit and fail-safe instead of silently treating every provenance-valid future claim as immediately canonical.

A next safe research rung is corroboration/uncertainty evidence for held shared-authority claims: define how independent sources or explicit human/product authority may release a held forward jump without weakening the single-source evidence chain.
