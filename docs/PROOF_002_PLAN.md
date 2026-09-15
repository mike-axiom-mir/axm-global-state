# Proof 002 plan — browser / Node portability

Status: **PROPOSED TEST RUNG**

Goal: prove that the same Global State kernel, rules and fixture reconstruct the same canonical state in Node.js and a real browser runtime.

This proof must compare canonical state, not screenshots or presentation.

## Required comparison

For the same fixture and target ticks:

```text
Node canonical state === browser canonical state
Node digest === browser digest
```

The browser must import the same `src/temporal-state-kernel.mjs` module used by Node. Do not create a browser-only copy of the rules or physics.

## Portable numeric contract for this rung

Until evidence justifies widening it:

- canonical numeric state uses JavaScript safe integers only;
- fractional quantities use explicit fixed-point units such as `*Milli` rather than binary floating-point fractions;
- arithmetic that leaves the safe-integer range must fail closed;
- deterministic ordering must not depend on locale-sensitive collation;
- rule version is part of replay provenance;
- canonical state must remain JSON-serializable.

This is a bounded JavaScript portability contract, not a claim of cross-language or cross-architecture determinism.

## Browser evidence

A headless real Chromium instance should load a tiny same-origin test page through an HTTP server, import the kernel + shared fixture as ES modules, reconstruct the target states, and expose only the resulting canonical evidence to the Node test harness.

The Node harness should independently compute the same result and fail on any mismatch.

## Stop condition

Proof 002 passes only when Node and Chromium match exactly for the committed fixture matrix. Any mismatch is evidence to diagnose, not something to normalize away.
