# Action Report — Proof 016: fully cold interval-source continuity

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Compose durable accepted mutation history with durable interval-time evidence so all live mutation/time-source objects may disappear, then later restore from compact evidence and reconstruct the later present from a corroborated uncertainty lower bound.

## Candidate flow

Before cold:

1. accepted mutation authority persists `R1`;
2. three configured interval sources emit uncertainty around logical tick `600` and their accepted interval chains are serialized;
3. product state is reconstructed to sleep tick `600`;
4. authority persists `R2`, effective at tick `900`.

Cold interval:

- discard live mutation authority;
- discard live receipt-history handle;
- discard all interval-source issuer objects;
- preserve only serialized accepted mutation receipts and serialized accepted interval evidence.

Wake:

1. reopen durable accepted mutation history and recover revision `2`;
2. reload each interval source chain and restore a fresh issuer from its accepted evidence;
3. A emits `[86,390,86,410]`;
4. B emits `[86,400,86,430]`;
5. C emits outlier `[199,990,200,010]`;
6. interval corroboration selects A+B overlap `[86,400,86,410]`;
7. canonical catch-up target becomes conservative lower bound `86,400`;
8. deterministic catch-up from recovered mutation history must match existing `fnv1a32:74f37cf0` state.

## Design constraint

Proof 016 adds no new canonical runtime subsystem. It composes existing durable receipt history, interval evidence restoration, interval corroboration, and Temporal State catch-up.

The CI gate also reruns Proof 011's real Chromium fully-cold elapsed-time proof so this Node-side interval composition cannot silently substitute for browser continuity evidence.

## Truth boundary

Do not claim Proof 016 PASS until exact-head CI succeeds.

Even after a pass, serialized interval evidence remains proof-level compact continuity evidence, not authenticated secure time storage. The proof does not establish physical-time accuracy, source independence, signatures, Byzantine consensus, filesystem power-loss guarantees, or broad deployment behavior.
