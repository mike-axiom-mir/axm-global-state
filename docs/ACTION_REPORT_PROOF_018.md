# Action Report — Proof 018: durable checkpoint generation rotation

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Persist Proof 017 checkpoint epochs without exposing a mixed state where a new compacted checkpoint is paired with old receipt history, or old checkpoint state is paired with truncated new history.

## Candidate storage model

The proof uses one directory with:

```text
CURRENT.json

generations/
  <generation-a>.json
  <generation-b>.json
  ...
```

Each generation file is immutable and contains one complete recovery package:

- checkpoint epoch identity and compacted deterministic state;
- checkpoint mutation revision/head;
- accepted receipts after that checkpoint;
- current accepted revision/head;
- parent generation identity;
- deterministic package digest.

`CURRENT.json` contains only the selected generation ID + package digest.

A rotation therefore has two phases:

1. **prepare** — write and validate a complete immutable generation while the old `CURRENT` pointer remains unchanged;
2. **commit** — atomically replace only `CURRENT.json` with a pointer to that complete prepared generation.

Recovery follows `CURRENT.json`; it never scans for the newest-looking generation.

## Candidate continuity fixture

The test creates an epoch-0 history with three accepted mutations and then a compacted epoch-1 checkpoint at revision 3 / tick 3600.

It must prove:

### Prepared but not committed

- write two valid staged epoch-1 generations while epoch 0 remains current;
- discard the in-memory store object and reopen from disk;
- recovery still returns the complete old epoch-0 package and all three old receipts;
- staged generations alone do not become canonical.

### Tampered staged generation

- stage another epoch-1 generation;
- mutate compacted state bytes without updating the epoch/package evidence;
- commit must fail closed;
- `CURRENT` must remain the old generation.

### Pointer commit

- commit one valid prepared epoch-1 generation;
- reopen immediately with no reliance on the committer's RAM;
- recovery must return the complete epoch-1 compacted checkpoint with zero old receipts and empty old `appliedCommands` metadata.

### Stale prepared generation

- a second generation prepared from the old canonical generation must not be allowed to overwrite the newly committed current generation;
- stale-base commit fails closed.

### Continue after rotation

- restore the epoch-bound sequencer from the new package;
- accept one new epoch-1 mutation;
- persist it through the same generation-pointer mechanism;
- reopen again at revision 4;
- compacted checkpoint + retained post-checkpoint receipt must reconstruct the same physical state as the uncompacted reference history.

## Identity/integrity bindings

The package digest binds:

- generation ID;
- parent generation ID;
- checkpoint epoch package;
- post-checkpoint receipts;
- current revision/head.

The pointer binds generation ID + package digest. Opening verifies that the pointer-selected filename, embedded generation ID and package digest agree.

FNV remains deterministic corruption/provenance evidence only; it is not a cryptographic security claim.

## Truth boundary

Do not claim Proof 018 PASS until the consolidated exact-head regression suite succeeds.

Even after a pass, this proves only the bounded tested Node/Linux generation-pointer protocol. It does not prove:

- `fsync`/power-loss durability of file contents or directory metadata;
- filesystem behavior outside the tested atomic rename assumptions;
- multiple processes concurrently writing one store;
- remote/object-store atomicity;
- garbage collection of orphan/retired generation files;
- arbitrary partial checkpoint compaction;
- cryptographic tamper resistance;
- a malicious checkpoint producer cannot lie about state;
- multi-host consensus/failover;
- production-scale retention policy.

A prepared generation is intentionally allowed to remain orphaned after an interrupted rotation; cleanup is a later concern and must never decide canonical truth by itself.

## Next safe rung if green

Add a real child-process crash harness around prepare/commit/append boundaries, then research safe orphan/retired-generation garbage collection. The canonical rule should remain pointer-based so cleanup cannot promote an uncommitted generation.
