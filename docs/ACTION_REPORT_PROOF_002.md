# Action Report — Proof 002: Node / Chromium portability

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Prove that the exact same Temporal State Kernel and committed fixture reconstruct identical canonical state in Node.js and a real Chromium runtime.

## Implemented

This rung adds:

- a shared portable fixture imported by both runtimes;
- a real browser ES-module proof page;
- a Playwright Chromium harness that independently computes the Node result and compares it with the browser result;
- a portable state/numeric contract;
- fail-closed safe-integer arithmetic;
- deterministic non-locale command ordering;
- rejection of a checkpoint that silently lacks an earlier supplied command;
- a GitHub Actions gate that installs Chromium and runs both Node and browser proofs.

## Local evidence

The Node-side candidate was exercised locally with Node.js `v22.16.0`:

- original Proof 001 regression: PASS;
- portability contract safety checks: PASS;
- portable fixture reconstruction: 11 target ticks through 30 logical days;
- restart digest: `fnv1a32:b9b4e061`.

A locally installed real Chromium could launch under Playwright, but this execution environment blocks browser navigation to localhost with `ERR_BLOCKED_BY_ADMINISTRATOR`. That local attempt is recorded as environment-blocked and is not counted as portability evidence.

## GitHub Actions evidence

Workflow run: `34959680971`
Job: `node-chromium-equivalence` (`104350029900`)
Runner: Ubuntu 24.04 / Node.js `v22.23.2`
Playwright: `1.55.0`
Chromium: Playwright build `1187`, Chromium `140.0.7339.16`

Observed results on the exact PR candidate:

```text
AXM Global State proof 001: PASS
AXM Global State portability contract: PASS
AXM Global State proof 002: PASS
{
  comparedTargets: 11,
  largestTargetTick: 2592000,
  restartDigest: 'fnv1a32:b9b4e061'
}
```

The browser and Node harness compare the complete canonical proof object with exact deep equality. A digest-only coincidence is therefore not sufficient for this gate to pass.

## What the proof means

For the committed fixture/rules and portable-state contract, Node.js and Chromium reconstructed exactly the same canonical states and evidence across 11 target ticks, including a 30-logical-day catch-up target and restart reconstruction.

This is the first tested evidence that the Temporal State Kernel can execute as the same state machinery in both a headless/server-style JavaScript runtime and an actual browser runtime without browser-specific physics.

## Truth boundary

This evidence is bounded to:

- the committed JavaScript Temporal State Kernel;
- JavaScript safe-integer/fixed-point canonical state;
- Node.js and Chromium;
- the exercised fixture and target matrix;
- local deterministic state reconstruction.

It does **not** prove:

- Firefox/WebKit parity;
- cross-language or cross-architecture determinism;
- cryptographic integrity (FNV remains a test checksum);
- networking or shared mutation authority;
- distributed consensus;
- production persistence;
- arbitrary game/world simulation determinism;
- WebGPU/rendering determinism.

## Next safe rung

Proof 003 should focus on long-absence cost and boundary scaling rather than another feature surface: measure catch-up work across 1 minute, 1 hour, 1 day, 30 days and 1 year, and report the number of meaningful boundaries actually processed versus empty logical ticks skipped.
