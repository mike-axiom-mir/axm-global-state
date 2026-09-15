# Action Report — Proof 008: browser process restart continuity

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Prove that a participant runtime can disappear completely, return later, restore its last verified accepted history from browser-local durable storage, request only later accepted receipts, and reconstruct the same current Global State.

## Candidate proof

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

## Why this matters

This is closer to the original Global State goal than a reconnect inside one process:

```text
verified checkpoint + accepted history
            ↓
persist locally
            ↓
all browser compute disappears
            ↓
time / absence
            ↓
new browser process
            ↓
restore verified local evidence
            ↓
request only missed accepted history
            ↓
reconstruct current state
```

Nothing needs to keep the full world simulation alive merely because the user closed the browser.

## Truth boundary

Do not claim Proof 008 PASS until exact-head CI succeeds.

Even after a pass this will prove only Chromium persistent-profile `localStorage` continuity for the bounded fixture. It will not prove:

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

## Next safe rung if green

Test **durable accepted-history authority across relay/server process restart** separately from world simulation.

That proof should restart the small receipt-history service itself, recover its accepted revision/head/history from durable storage, then let a browser reconnect from its own persisted verified revision. The service should still never continuously simulate product/world state.
