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

The child authority service now also serializes its IPC request boundary so proposal admission, durable append, rehydration, reads and shutdown cannot overlap out of order inside one authority process.

## Process-restart fixture

The main fixture uses real child-process authority services and one temporary on-disk history file.

### Process 1

1. initialize from trusted revision `0`;
2. accept/persist `proposal-a` as receipt `R1`;
3. acknowledge revision `1`;
4. receive `SIGKILL`.

### Process 2

1. recover revision/head `1` and retained `R1` from disk;
2. return an exact retry of `proposal-a` as the original idempotent `R1`;
3. reject conflicting reuse of `proposal-a`;
4. accept/persist properly rebased `proposal-b` as `R2`;
5. receive `SIGKILL`.

### Process 3

1. recover revision/head `2`;
2. serve `R1,R2` after revision `0`;
3. serve only `R2` after revision `1`;
4. serve nothing after revision `2`;
5. reconstruct the same final Temporal State digest from recovered history.

The test also corrupts retained `R1` bytes without changing the accepted receipt head and requires open/recovery to fail closed with a receipt-digest mismatch.

## Concurrency review finding and repair

The first serial-path green run exposed a missing adversarial case during review: the original async IPC listener could process overlapping `proposal.submit` handlers while one durable append awaited filesystem I/O. That allowed in-memory sequencing and final rename order to diverge in principle, so an older durable snapshot could land after a newer acknowledged snapshot.

The repair:

- serializes all child authority requests through one explicit queue;
- adds a test-only persistence delay to widen the old race window;
- submits `R1` and a correctly rebased `R2` without awaiting the first response;
- requires both acknowledgements to succeed in sequence;
- hard-kills the service after both acknowledgements;
- starts a fresh process and requires revision `2` plus both proposal IDs to survive.

This distinguishes a genuine single-process async race from the still-out-of-scope case of multiple authority processes writing the same history concurrently.

## Exact repaired CI evidence

Repaired candidate head before this report-only evidence update: `16e48c641ca289576e0a2aeb081dc37787ec7f46`.

Proof 009 workflow:

- run: `35003694877`
- job: `104498056786`
- result: **SUCCESS**
- runner: Ubuntu 24.04 / Node.js `v22.23.2`

Observed result:

```text
AXM Global State proof 009 durable receipt authority restart: PASS
authorityProcesses: 5
hardRestarts: 3
retainedReceipts: 2
recoveredRevision: 2
recoveredHead: fnv1a32:e4b47257
duplicateProposalAfterRestart: true
conflictAfterRestartRejected: true
concurrentSubmitSerialized: true
concurrentRecoveredRevision: 2
finalStateDigest: fnv1a32:bab65c1b
```

The same exact repaired head also passed all seven other active regression gates: consumer-time contract, browser process restart, WebSocket reconnect, Chromium portability, long-absence scaling, browser-local transport, and mutation agreement.

## What this proves

Within the bounded tested Node/Linux/file fixture:

- the accepted-history authority can be hard-killed after durable acknowledgement and recover revision/head from retained receipts;
- exact retries remain idempotent after process loss;
- conflicting proposal-ID reuse remains rejected after process loss;
- new accepted history can continue from the recovered head;
- later hard restarts recover the complete acknowledged receipt sequence;
- changed durable receipt bytes without a matching accepted head fail closed;
- overlapping requests at one authority process are serialized across asynchronous persistence;
- the latest acknowledged concurrent revision survives hard restart;
- recovered accepted history reconstructs the same canonical product-state digest;
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

## Important continuity findings

Persisting only the latest revision/head is insufficient for full idempotence. After restart, the authority also needs enough retained proposal identity/history to recognize an exact old retry and distinguish it from conflicting reuse.

A single sequencer must also serialize its own mutation/admission boundary across asynchronous durable writes. “One authority process” is not enough if multiple async handlers can overlap inside that process.

This proof keeps the full bounded accepted receipt window after the checkpoint. Future compaction/checkpoint work must explicitly decide what proposal-ID/idempotence evidence survives compaction.

## Truth boundary

This proof establishes only a bounded single-authority-process JSON-file history store on the tested Node/Linux surface. It does not prove:

- filesystem transactional guarantees beyond the tested temp-write + rename path;
- `fsync`/power-loss durability;
- arbitrary crash points before durable acknowledgement;
- recovery after a failed durable write while the same process continues;
- multiple authority processes writing the same history concurrently;
- multi-host consensus/failover;
- authentication/signatures;
- malicious local storage protection;
- production scaling or compaction;
- public network deployment;
- remote durable hosting;
- automatic recovery from arbitrary disk corruption.

## Next safe rung

Combine the two proven continuity sides in one end-to-end cold-resume test:

- browser process persists its verified revision/history and disappears;
- authority/history service process also disappears;
- both restart independently;
- service recovers accepted history from its durable store;
- browser recovers its verified local history;
- browser requests only receipts after its local revision;
- browser reconstructs the same current state.

That would prove a shared world can go completely cold at both ends and later resume from compact continuity evidence, without an always-running simulation process.
