# Action Report — Proof 001: deterministic offline catch-up

Date: 2026-09-15
Status: **LOCAL TEST PASS / EXPERIMENTAL**

## Goal

Prove the smallest useful Global State claim:

> A state advanced by fine reference stepping and the same state advanced by eventful deterministic catch-up can produce identical final state and digest from the same trusted inputs.

## Implemented

`src/temporal-state-kernel.mjs` currently proves a deliberately tiny surface:

- explicit logical tick;
- exact continuous resource delta;
- recurring deterministic event boundaries;
- scheduled one-shot completion boundaries;
- externally accepted commands with stable IDs;
- idempotent replay of the same command;
- fail-closed conflicting command-ID reuse;
- fail-closed backward time;
- rule-version binding;
- serializable checkpoint/restart continuity;
- stable proof digest for test comparison.

`tests/offline-catchup-selftest.mjs` compares the fine reference path with the catch-up path across multiple boundary positions and elapsed intervals.

## Bug found during the first proof

The initial prototype re-entered an already-processed recurring boundary when asked to reconstruct the same tick twice, causing the recurring reward to be counted twice.

That is exactly the kind of continuity bug this research must expose.

Repair:

- recurring boundaries now retain `lastRecurringTickProcessed`;
- revisiting the same current boundary may still inspect/apply a newly supplied command, but cannot silently apply the recurring world event twice.

The idempotence test now passes.

## Local evidence

Environment used for this proof:

- Node.js `v22.16.0`;
- `npm test`;
- no external dependencies.

Observed result:

```text
AXM Global State proof 001: PASS
{
  tick: 3600,
  rulesVersion: 'axm-global-state-proof-001',
  digest: 'fnv1a32:b9b4e061'
}
{ oneYearTick: 31536000, recurringCount: 525600 }
```

The one-year catch-up uses the eventful catch-up path rather than 31,536,000 fine empty steps.

## Truth boundary

This does **not** prove:

- browser/Node cross-runtime determinism;
- cryptographic integrity (the current compact FNV digest is a deterministic test checksum, not a security claim);
- shared multi-user authority;
- networking;
- distributed consensus;
- production persistence;
- performance under complex product state;
- automatic correctness for arbitrary simulations;
- equivalence across future rule versions.

It proves only the bounded local equivalence/restart/idempotence behaviors exercised by the current selftest.

## Next safe rung

Run the exact same deterministic fixture in a real browser and require the final canonical state representation/checksum to match the headless result. If numeric/runtime differences appear, define the portable numeric contract before widening the kernel.
