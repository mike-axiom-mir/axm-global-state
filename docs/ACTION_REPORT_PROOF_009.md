# Action Report — Proof 009: durable accepted-history authority restart

Date: 2026-09-15
Status: **REPAIR CI PENDING / EXPERIMENTAL**

## Goal

Prove that the small accepted-mutation authority can disappear completely and later recover its ordering/idempotence state from durable accepted receipt history without preserving a continuously running world simulation.

## Candidate implementation

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

The test also writes a separately corrupted history file where `R1` command bytes are changed without updating its accepted head. Opening that history must fail closed with a receipt-digest mismatch.

## Prior serial-path CI evidence

Pre-repair candidate head: `3897f67c624f6590b41e8bc5a5ab9e7e72db1c84`.

Proof 009 workflow:

- run: `35002710428`
- job: `104494768011`
- result: **SUCCESS**
- runner: Ubuntu 24.04 / Node.js `v22.23.2`

Observed result on that serial-only fixture:

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

That evidence remains valid for the serial request path it exercised, but it is **not sufficient to claim the repaired current head passed**.

## Concurrency review finding and repair

A review after the first green run found a continuity race in the proof service itself.

The original IPC listener used an async message handler directly. While one accepted proposal awaited filesystem persistence, a second `proposal.submit` message could enter another handler and mutate the in-memory sequencer concurrently. Because durable writes use asynchronous temp-write + rename, acknowledged authority order and final rename order could diverge. In the bad interleaving, a newer `R1,R2` durable snapshot could be followed by an older `R1` rename, so a later hard restart could recover revision `1` after revision `2` had effectively been admitted.

The repair on the current branch:

- serializes the child authority IPC boundary through one explicit request queue;
- keeps proposal admission, durable append, rehydration, reads and shutdown in one observable service order;
- adds a test-only delay before first-proposal persistence to deliberately widen the old race window;
- fires `R1` and a correctly rebased `R2` request without waiting for the first response;
- requires both acknowledgements to succeed in sequence;
- hard-kills the service;
- requires the next process to recover revision `2` and both proposal IDs.

Current repaired candidate head before this report update: `9c32801547508f83b97d44b466b7a2f7d1bd3dd6`.

Exact-head CI for this repaired concurrency case is pending. Do **not** promote Proof 009 back to PASS until that gate and the relevant regressions succeed on the repaired head.

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

Persisting only the latest revision/head is insufficient for full idempotence. After restart, the authority also needs enough retained proposal identity/history to know that an old exact retry was already accepted and to distinguish it from conflicting reuse.

A second finding is now explicit: a single sequencer must serialize its own mutation/admission boundary across asynchronous durable writes. “One authority process” is not enough if multiple async handlers can overlap inside that process.

This proof keeps the full bounded accepted receipt window after the checkpoint. Future compaction/checkpoint work must explicitly decide what proposal-ID/idempotence evidence survives compaction.

## Truth boundary

Even after repaired CI passes, this proof will establish only a bounded single-authority-process JSON-file history store on the tested Node/Linux surface. It will not prove:

- database/filesystem transactional guarantees beyond the tested temp-write + rename path;
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

After repaired exact-head CI passes, combine the two continuity sides in one end-to-end cold-resume test:

- browser process persists its verified revision/history and disappears;
- authority/history service process also disappears;
- both restart independently;
- service recovers accepted history from its durable store;
- browser recovers its verified local history;
- browser requests only receipts after its local revision;
- browser reconstructs the same current state.

That would prove a shared world can go completely cold at both ends and later resume from compact continuity evidence, without an always-running simulation process.
