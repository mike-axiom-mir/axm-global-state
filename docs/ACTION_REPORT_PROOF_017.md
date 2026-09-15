# Action Report — Proof 017: checkpoint epoch compaction

Date: 2026-09-15
Status: **CANDIDATE / CI PENDING / EXPERIMENTAL**

## Goal

Bound replay-history growth without silently forgetting enough identity evidence to reapply an old accepted mutation.

Proof 009 established that restart-safe idempotence needs retained proposal identity/history. The Temporal State checkpoint also retains `appliedCommands`, so deleting old receipt files alone would only move the unbounded-history problem into state.

This proof tests a full checkpoint **epoch boundary** instead.

## Candidate model

At a trusted full checkpoint:

1. all accepted mutations through the current accepted revision/head are already absorbed into deterministic state;
2. the source state digest, mutation revision/head, logical tick and prior epoch identify the checkpoint;
3. a deterministic new `epochId` is derived from that evidence;
4. old `appliedCommands` replay metadata is removed from the compacted state;
5. future proposal identities are qualified as `epochId::localProposalId`;
6. post-checkpoint receipts must belong to the current epoch before they are exposed to Temporal State;
7. an input proposal naming a retired/wrong epoch fails closed.

The existing single-sequencer and Temporal State Kernel remain unchanged. `src/checkpoint-epoch.mjs` is a boundary layer around them.

## Candidate adversarial fixture

The pre-checkpoint history accepts three mutations:

- `proposal-a` at tick 17;
- `proposal-b` at tick 90;
- `proposal-c` **exactly at checkpoint tick 3600**.

The checkpoint-tick case matters because, after replay metadata is cleared, a leaked historical command at exactly the current state tick could otherwise be eligible for boundary application. The proof therefore requires the epoch/history boundary to absorb/filter old revisions before the kernel sees them.

After checkpoint revision 3:

- the compacted state must preserve all physical/product fields while clearing three retired applied-command identities;
- replaying an old receipt at/before the checkpoint must produce no post-checkpoint command;
- an otherwise-valid revision-4 receipt that is not current-epoch-qualified must fail closed;
- a proposal naming the retired `genesis` epoch must fail closed;
- local ID `proposal-a` may be explicitly reused in the new epoch because its full identity is different;
- exact duplicate/conflicting reuse inside the new epoch must retain the existing idempotence/conflict behavior;
- compacted checkpoint + new-epoch history advanced to tick 7200 must match the physical state from uncompacted genesis + complete history;
- the compacted future should retain only the new epoch's applied-command identity instead of all four historical IDs.

## Identity contract

This proof deliberately changes the reusable identity unit from:

```text
proposalId
```

to:

```text
epochId + localProposalId
```

An ID reused in another epoch is a different proposal identity. This is not a hidden deletion of a globally-forever ID promise.

## Truth boundary

Do not claim Proof 017 PASS until the consolidated exact-head regression suite succeeds.

Even after a pass, this proves only a bounded **full checkpoint at the current accepted head** seam. It does not prove:

- arbitrary prefix/partial compaction;
- durable/atomic state-checkpoint + receipt-store rotation;
- `fsync` or power-loss safety;
- that an externally supplied checkpoint state is truthful;
- cryptographic integrity or hostile-storage security (FNV remains deterministic proof evidence only);
- multi-host checkpoint consensus;
- checkpoint migration across incompatible rule/product versions;
- automatic retention policy selection;
- bounded size for product-owned state unrelated to replay metadata;
- production scaling.

The checkpoint producer remains responsible for proving that its state really contains all accepted effects through the named revision/head before retiring the old epoch.

## Next safe rung if green

Persist a **checkpoint package** containing the compacted state + epoch identity + accepted mutation head, then atomically rotate the durable receipt history to that checkpoint. Crash tests should cover before/after each persistence boundary so a restart can recover either the old complete epoch or the new complete epoch, never a mixed half-transition.
