# Action Report — Proof 002: Node / Chromium portability

Date: 2026-09-15
Status: **PENDING CI / NOT YET A PASS CLAIM**

## Goal

Prove that the exact same Temporal State Kernel and committed fixture reconstruct identical canonical state in Node.js and a real Chromium runtime.

## Candidate implementation

This branch adds:

- a shared portable fixture imported by both runtimes;
- a real browser ES-module proof page;
- a Playwright Chromium harness that independently computes the Node result and compares it with the browser result;
- a portable state/numeric contract;
- fail-closed safe-integer arithmetic;
- deterministic non-locale command ordering;
- rejection of a checkpoint that silently lacks an earlier supplied command;
- a GitHub Actions gate that installs Chromium and runs both Node and browser proofs.

## Local evidence available

The Node-side candidate was exercised locally with Node.js `v22.16.0`:

- original Proof 001 regression: PASS;
- portability contract safety checks: PASS;
- portable fixture reconstruction: 11 target ticks through 30 logical days;
- restart digest remains `fnv1a32:b9b4e061`.

A locally installed real Chromium could launch under Playwright, but this execution environment blocks browser navigation to localhost with `ERR_BLOCKED_BY_ADMINISTRATOR`. That is an environment limitation, not browser-equivalence evidence. Therefore this report intentionally remains **PENDING CI**.

## Truth boundary

Do not claim Proof 002 passed until the GitHub Actions Chromium gate reports success on this exact branch/PR head.

Even after a pass, the evidence will remain bounded to Node.js + Chromium + this JavaScript safe-integer/fixed-point contract. It will not prove arbitrary browser engines, languages, architectures, networking, distributed authority or production persistence.
