# Action Report — Proof 008: browser process restart continuity

Date: 2026-09-15
Status: **TEST PASS / EXPERIMENTAL**

## Goal

Prove that a participant runtime can disappear completely, return later, restore its last verified accepted history from browser-local durable storage, request only later accepted receipts, and reconstruct the same current Global State.

## Tested proof

The proof uses a real persistent Chromium profile and two separate Chromium process lifetimes.

### Browser process 1

1. start with the trusted base checkpoint at revision `0`;
2. connect by WebSocket and request `afterRevision=0`;
3. receive accepted receipt `R1`;
4. verify the receipt chain;
5. persist the verified accepted receipt evidence into browser `localStorage`;
6. reach verified revision `1`;
7. fully close the persistent Chromium context/process.

### Browser process 2

1. launch Chromium again against the same user-data directory;
2. load the same origin;
3. read persisted receipt evidence from `localStorage`;
4. re-run `normalizeAcceptedReceipts(...)` instead of trusting a naked stored revision number;
5. restore verified revision `1` and its accepted head;
6. reconnect and request `afterRevision=1`;
7. receive only accepted receipt `R2`;
8. persist the now-complete accepted history;
9. reconstruct current state through the existing Temporal State Kernel;
10. match an independent Node reconstruction exactly.

## Architectural boundary

Browser storage is a continuity surface, not authority.

The proof deliberately stores accepted receipt evidence rather than simply storing `lastRevision=1`. On restart, the browser recomputes/validates the accepted chain from the trusted checkpoint before using that revision to request later history.

The WebSocket relay still does not run world simulation or decide product state.

## CI evidence

Candidate head before this report-only evidence update: `6cb12c35b6e6b93616775c80c02516b252054aa7`.

Proof 008 workflow:

- run: `35001959475`
- job: `104492237235`
- result: **SUCCESS**
- runner: Ubuntu 24.04 / Node.js `v22.23.2`
- browser: real Playwright Chromium in a persistent user-data profile

Observed result:

```text
AXM Global State proof 008 browser process restart continuity: PASS
storage: localStorage in persistent Chromium profile
browserProcesses: 2
syncRequests: [0, 1]
restoredReceiptCount: 1
normalizedRevision: 2
acceptedHead: fnv1a32:e4b47257
finalStateDigest: fnv1a32:bab65c1b
```

The same CI job also kept the deterministic proof suite and Proof 007 WebSocket reconnect regression green before running the new process-restart seam.

## What this proves

Within this bounded Chromium fixture:

- verified accepted history survives a full Chromium process/context shutdown;
- a fresh Chromium process can recover that local evidence from the same persistent profile;
- the recovered receipt chain is revalidated from the trusted checkpoint rather than trusting a naked stored revision;
- the new process requests only history after its recovered verified revision;
- the relay therefore sends `R2` rather than resending a whole reconstructed world snapshot;
- the returned accepted history reconstructs the same final canonical state/digest as Node;
- continuous world simulation is not required merely because no browser process is alive.

## Why this matters

```text
verified checkpoint + accepted history
            ↓
persist locally
            ↓
all browser compute disappears
            ↓
new browser process
            ↓
restore + verify local evidence
            ↓
request only missed accepted history
            ↓
reconstruct current state
```

This directly supports the Global State direction: continuity can be encoded in compact trusted state/history and deterministic rules rather than in an always-running simulation process.

## Truth boundary

This evidence proves only Chromium persistent-profile `localStorage` continuity for the bounded fixture. It does not prove:

- IndexedDB or other storage backends;
- storage durability guarantees under OS/device failure;
- encrypted local state;
- anti-tamper protection against a malicious local user/process;
- cross-device migration;
- durable remote history after relay restart;
- authentication/signatures;
- public internet deployment;
- consensus or multi-host failover;
- arbitrary browser compatibility;
- production storage quotas/performance.

`localStorage` is useful here as the smallest real durability proof, not a claim that it is the final storage architecture.

## Next safe rung

Test **durable accepted-history authority across relay/server process restart** separately from world simulation.

That proof should restart the small receipt-history service itself, recover its accepted revision/head/history from durable storage, then let a browser reconnect from its own persisted verified revision. The service should still never continuously simulate product/world state.
