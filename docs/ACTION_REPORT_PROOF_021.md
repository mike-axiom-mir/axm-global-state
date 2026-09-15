# Action Report — Proof 021: real Chromium partial-floor checkpoint adoption

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Carry Proof 020's partial-compaction replay-checkpoint handoff through a real persistent Chromium profile and a real WebSocket transport, then prove the adopted checkpoint can survive another full browser-process restart with the relay gone.

## Candidate flow

### Browser process 1 — before compaction

- persistent Chromium profile starts empty;
- browser requests accepted history after revision 0;
- relay sends receipts 1–10;
- browser verifies and persists receipt-mode history at revision 10;
- browser process exits completely.

### While browser is absent

- authority partially compacts accepted history through revision 32;
- authority admits/persists revision 41 after the compacted suffix;
- replay checkpoint is built at mutation revision 32 / logical tick 320;
- retained suffix contains only receipts 33–41.

### Browser process 2 — checkpoint adoption

- fresh Chromium process opens the same durable profile and restores revision 10;
- browser requests sync after revision 10;
- relay does **not** pretend removed receipts 11–32 still exist;
- relay sends one checkpoint package containing the revision-32 replay checkpoint and only receipts 33–41;
- relay is forbidden from sending the trusted checkpoint digest;
- browser receives the trusted checkpoint digest separately from configured trust context;
- browser verifies/adopts the checkpoint, replays only receipts 33–41 to revision 41, reconstructs logical tick 600, and persists checkpoint-mode evidence;
- final state must equal independent uninterrupted Node replay exactly.

### Browser process 3 — offline restart

- WebSocket relay is shut down completely;
- third Chromium process opens the same durable profile;
- browser restores checkpoint-mode evidence;
- browser re-verifies it against the separately supplied trusted checkpoint digest;
- browser reconstructs revision 41 / logical tick 600 without attempting any network connection;
- persisted checkpoint evidence must remain unchanged merely because it was replayed.

## Candidate evidence

Required:

- 3 browser processes;
- exactly 2 relay connections;
- sync requests `[0, 10]`;
- first process persists revision 10 in receipt mode;
- second process adopts checkpoint revision 32 / tick 320;
- exactly 9 retained receipt payloads (33–41) cross after wake;
- relay supplies no trust anchor;
- adopted browser storage no longer contains compacted prefix receipt payload bytes;
- third process performs offline checkpoint restore with `connectionAttempted=false`;
- second and third process states equal the independent Node state and digest exactly.

## Architecture boundary

Proof 021 adds no new canonical Global State source semantics. It is a browser/transport/storage integration proof over existing:

- Proof 018 partial receipt payload compaction;
- Proof 020 replay checkpoints;
- persistent Chromium profile storage;
- WebSocket transport.

The HTTP server only serves static repository files. The WebSocket relay transports either accepted receipts or the already-created checkpoint package; it does not run product state, logical time, or checkpoint trust.

## Trust boundary

The expected checkpoint digest is supplied through test configuration independently of the WebSocket package. This proves separation of the transport path from the trust anchor, not real authentication.

Browser localStorage is continuity evidence, not a hostile-storage security boundary. Proof 021 does not claim protection against a malicious local user rewriting both application files and trusted configuration.

## Truth boundary

Do not claim PASS until real Chromium CI succeeds on the exact candidate head.

Even if green, Proof 021 will not establish:

- cryptographic checkpoint signatures/authentication;
- public-network security;
- malicious checkpoint-source resistance;
- cross-device checkpoint migration;
- browser-vendor compatibility beyond tested Chromium;
- production storage limits/compaction;
- power-loss durability;
- distributed checkpoint authority or consensus.

## Next safe rung if green

Connect checkpoint discovery to the provider-neutral sync contract itself: a participant should receive an explicit `history-compacted`/checkpoint-required response when its requested revision is below the retained floor, rather than relying on proof-harness connection ordinals. Keep checkpoint trust/authorization separate from that discovery response.
