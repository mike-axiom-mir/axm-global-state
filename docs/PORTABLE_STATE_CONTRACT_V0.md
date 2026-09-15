# AXM Global State — portable state contract v0

Status: **EXPERIMENTAL / PROOF-BOUND CONTRACT**

This contract exists to make the first Temporal State Kernel reproducible across compatible JavaScript runtimes without pretending arbitrary software is automatically deterministic.

## Canonical numeric state

For this rung:

- canonical numeric fields are JavaScript safe integers;
- fractional domain quantities use explicit fixed-point units such as `*Milli`;
- arithmetic that would leave the safe-integer range fails closed;
- no canonical transition depends on wall-clock floating-point deltas;
- logical time is an explicit integer tick supplied to the kernel.

This is deliberately narrower than supporting arbitrary floating-point simulation.

## Canonical ordering

When multiple accepted commands share one logical tick, their stable command IDs are ordered by direct JavaScript string/code-unit comparison.

Locale-sensitive collation such as `localeCompare(...)` is not part of canonical ordering because locale/ICU behavior is an unnecessary runtime dependency.

## Canonical serialization / digest

State remains plain JSON-serializable data. The current proof checksum uses a stable key-ordered serialization and FNV-1a 32-bit checksum.

The checksum is **test evidence only**. It is not a cryptographic integrity or security primitive.

## Historical command continuity

A checkpoint may contain commands already applied before its current tick. Their fingerprints make replay idempotent and conflicting command-ID reuse fails closed.

If the caller supplies a command from before the current checkpoint tick that the checkpoint does not record as applied, the kernel fails closed instead of silently skipping missing history.

## Cross-runtime claim boundary

Proof 002 is allowed to claim only what is exercised:

- same committed kernel module;
- same committed fixture/rules;
- Node.js execution;
- real Chromium execution;
- exact canonical state/digest equality for the test matrix.

It does **not** establish cross-language, cross-engine, cross-architecture, WebGPU, networking, distributed-consensus or production-database determinism.
