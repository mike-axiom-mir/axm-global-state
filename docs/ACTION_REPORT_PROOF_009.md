# Action Report — Proof 009: durable accepted-history authority restart

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Prove that the small accepted-mutation authority can disappear completely and later recover its ordering/idempotence state from durable accepted receipt history without preserving a continuously running world simulation.

## Tested implementation

`src/durable-receipt-history.mjs` adds a deliberately small Node/file proof store.

It persists:

- the trusted checkpoint revision/head;
- verified accepted receipts after that checkpoint.

On open/restart it re-runs `normalizeAcceptedReceipts(...)` across the retained history before exposing a recovered revision/head.

`restoreSingleSequencerAuthority(...)` rebuilds the in-memory sequencer from that verified accepted history, including retained proposal-ID fingerprints needed to preserve duplicate/id-conflict behavior after process loss.

The file store writes a complete next snapshot to a temporary file and renames it into place before the service acknowledges the durable state in the proof harness.

## Process-restart fixture

The test uses a real child-process authority service and one temporary on-disk history file.

### Process 1

1. initialize from trusted revision `0`;
2. accept `proposal-a` as receipt `R1`;
3. persist `R1`;
4. acknowledge revision `1`;
5. receive `SIGKILL`.

### Process 2

1. start from the same file only;
2. recover revision/head `1` and retained `R1`;
3. receive an exact retry of `proposal-a` based on old revision `0`;
4. return the original `R1` as an idempotent duplicate without consuming revision `2`;
5. reject conflicting reuse of `proposal-a` with different command content;
6. accept a properly rebased `proposal-b` as `R2`;
7. persist revision `2`;
8. receive `SIGKILL`.

### Process 3

1. recover revision/head `2` from disk;
2. expose `R1,R2` for a client asking after revision `0`;
3. expose only `R2` for a client asking after revision `1`;
4. expose nothing after revision `2`;
5. reconstruct the same final Temporal State digest from recovered history.

The test also writes a separately corrupted history file where `R1` command bytes are changed without updating its accepted head. Opening that history fails closed with a receipt-digest mismatch.

## CI evidence

Candidate head before this report-only evidence update: `3897f67c624f6590b41e8bc5a5ab9e7e72db1c84`.

Proof 009 workflow:

- run: `35002710428`
- job: `104494768011`
- result: **SUCCESS**
- runner: Ubuntu 24.04 / Node.js `v22.23.2`

Observed result:

```text
AXM Global State proof 009 durable receipt authority restart: PASS
authorityProcesses: 3
hardRestarts: 2
retainedReceipts: 2
recoveredRevision: 2
recoveredHead: fnv1a32:e4b47257
duplicateProposalAfterRestart: true
conflictAfterRestartRejected: true
finalStateDigest: fnv1a32:bab65c1b
```

The same head also kept the existing deterministic, mutation-agreement, Chromium portability, browser-local transport and WebSocket reconnect regressions green as their runners completed.

## What this proves

Within the bounded tested Node/Linux/file fixture:

- the accepted-history authority can be hard-killed after durable acknowledgement and later reconstruct its revision/head from retained receipts;
- exact retry of a previously accepted proposal remains idempotent after process loss;
- conflicting reuse of that proposal ID remains rejected after process loss;
- new accepted history can continue from the recovered head;
- a second hard restart recovers the two-receipt history and serves correct receipt suffixes;
- recovered accepted history reconstructs the same canonical product-state digest as before;
- changed durable receipt bytes without a matching accepted head fail closed;
- none of this requires the authority process to continuously simulate the product/world while idle.

## Architectural boundary

This durable authority stores **accepted compact history**, not world/product state.

It does not:

- tick a game/world while idle;
- calculate current product state;
- render anything;
- choose product time semantics;
- become a database for arbitrary application objects.

A compatible runtime still reconstructs product state from trusted checkpoint + accepted history + deterministic rules/time semantics.

## Important continuity finding

Persisting only the latest revision/head is insufficient for full idempotence. After restart, the authority also needs enough retained proposal identity/history to know that an old exact retry was already accepted and to distinguish it from conflicting reuse.

This proof keeps the full bounded accepted receipt window after the checkpoint. Future compaction/checkpoint work must explicitly decide what proposal-ID/idempotence evidence survives compaction.

## Truth boundary

This evidence proves only a bounded single-process-at-a-time JSON-file history store on the tested Node/Linux surface. It does not prove:

- database/filesystem transactional guarantees beyond the tested temp-write + rename path;
- `fsync`/power-loss durability;
- arbitrary crash points before durable acknowledgement;
- recovery after a failed durable write while the same process continues;
- concurrent writers;
- multi-host consensus/failover;
- authentication/signatures;
- malicious local storage protection;
- production scaling or compaction;
- public network deployment;
- remote durable hosting;
- automatic recovery from arbitrary disk corruption.

## Next safe rung

Combine the two proven continuity sides in one end-to-end restart test:

- browser process persists its verified revision/history and disappears;
- authority/history service process also disappears;
- both restart independently;
- service recovers accepted history from its durable store;
- browser recovers its verified local history;
- browser requests only receipts after its local revision;
- browser reconstructs the same current state.

That would prove a shared world can go completely cold at both ends and later resume from compact continuity evidence, without an always-running simulation process.
