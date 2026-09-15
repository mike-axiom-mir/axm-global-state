# Action Report — Proof 016: fully cold interval-source continuity

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Compose durable accepted mutation history with durable interval-time evidence so all live mutation/time-source objects may disappear, then later restore from compact evidence and reconstruct the later present from a corroborated uncertainty lower bound.

## Tested flow

Before cold:

1. accepted mutation authority persists `R1`;
2. three configured interval sources emit uncertainty around logical tick `600` and their accepted interval chains are serialized;
3. product state is reconstructed to sleep tick `600`;
4. authority persists `R2`, effective at tick `900`.

Cold interval:

- discard live mutation authority;
- discard live receipt-history handle;
- discard all three live interval-source issuer objects;
- preserve only serialized accepted mutation receipts and serialized accepted interval evidence.

Wake:

1. reopen durable accepted mutation history and recover revision `2`;
2. reload each interval source chain and restore a fresh issuer from its accepted evidence;
3. each restored source resumes from accepted interval sequence `1`;
4. A emits `[86,390,86,410]`;
5. B emits `[86,400,86,430]`;
6. C emits outlier `[199,990,200,010]`;
7. interval corroboration selects A+B overlap `[86,400,86,410]`;
8. canonical catch-up target becomes conservative lower bound `86,400`;
9. deterministic catch-up from recovered mutation history matches existing `fnv1a32:74f37cf0` state.

## CI evidence

Candidate head before this report-only evidence update: `8a72caac31487afff506520048f1d7b25457759b`.

Proof 016 workflow:

- run: `35013175330`
- job: `104529941537`
- result: **SUCCESS**
- runner: Ubuntu 24.04 / Node.js `v22.23.2`
- real Chromium Proof 011 cold-time regression: **PASS**
- repaired Proof 009 durable-authority regression: **PASS**
- deterministic Proofs 001/003/005/012/013/014/015 regressions: **PASS**

Observed result:

```text
AXM Global State proof 016 cold interval source continuity: PASS
coldLiveObjectsDiscarded:
  mutation-authority
  receipt-history-handle
  clock-a-issuer
  clock-b-issuer
  clock-c-issuer
restoredMutationRevision: 2
restoredIntervalSequences: [1, 1, 1]
wakeOverlapInterval: [86400, 86410]
admittedConservativeLowerBound: 86400
excludedOutlierIds: [clock-c]
catchupJumps: 1441
perTickTransitionsAvoided: 84959
finalStateDigest: fnv1a32:74f37cf0
exactTimestampInvented: false
```

## What this proves

Within the bounded tested fixture:

- accepted mutation history survives loss of the live authority/history objects;
- interval-source provenance chains survive loss of their live issuer objects;
- fresh interval issuers can resume from serialized accepted evidence without resetting sequence/history;
- post-wake A/B overlap can establish a conservative lower-bound catch-up target while C is excluded as an outlier;
- the reconstructed later state matches the previously proven tick-86,400 state;
- interval uncertainty is preserved through cold continuity without converting the overlap into a fabricated exact midpoint;
- real Chromium fully-cold elapsed-time continuity remains green as a dependency of this Node-side composition proof.

## Design constraint

Proof 016 adds no new canonical runtime subsystem. It composes existing durable receipt history, interval evidence restoration, interval corroboration, and Temporal State catch-up.

## Truth boundary

Serialized interval evidence remains proof-level compact continuity evidence, not authenticated secure time storage. Proof 016 does not establish physical-time accuracy, source independence, signatures, Byzantine consensus, filesystem power-loss guarantees, or broad deployment behavior.

A next maintenance rung is warranted before adding more clock sophistication: the repository now runs many overlapping CI workflows per PR head, repeatedly installing Chromium and rerunning the same dependency proofs. Consolidating stale-run cancellation and shared regression execution would improve speed without changing any canonical Global State semantics.
