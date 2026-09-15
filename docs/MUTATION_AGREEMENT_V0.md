# AXM Global State — mutation agreement v0

Status: **EXPERIMENTAL PROOF CONTRACT**

## Purpose

Separate shared mutation agreement from simulation compute.

A causal shared world may need one agreed order for non-commutative changes, but the component that admits/orders those changes does **not** need to run the world simulation continuously.

## v0 authority mode

The first mode is `single-sequencer`.

Its responsibilities are intentionally narrow:

- receive a mutation proposal;
- verify the proposal names the current revision/head;
- reject stale proposals;
- make proposal IDs idempotent after acceptance;
- reject conflicting reuse of an accepted proposal ID;
- append one accepted receipt with a deterministic sequence and previous-head binding;
- expose accepted receipts/checkpoint metadata.

It does **not**:

- advance product time;
- calculate product outcomes;
- mutate product state;
- render anything;
- provide authentication/security;
- define networking;
- choose product rules.

## Proposal shape

```text
proposal id
actor id
based-on revision
based-on head
command intent
```

The command intent remains product/kernel input. The sequencer does not execute it.

## Accepted receipt shape

```text
sequence
proposal id
actor id
based-on revision/head
command intent
previous accepted head
new accepted head
```

The current FNV-1a receipt head is a deterministic proof checksum, **not cryptographic authentication**.

## Transport independence

Accepted receipt delivery may be duplicated or arrive out of order. A reconstruction runtime normalizes receipts by canonical sequence, deduplicates exact repeats, verifies the head chain, rejects sequence/proposal conflicts and refuses gaps.

This means WebSocket, HTTP, P2P, file transfer or a test transport can carry the same accepted receipts without changing state semantics.

The sequencer's proposal-arrival order is still authority input in this v0 mode. This proof does not claim transport arrival order is irrelevant before acceptance; it proves that **post-acceptance receipt delivery order** is irrelevant to reconstruction.

## Stale concurrent proposal behavior

If participants A and B both propose against revision 0 and A is accepted first, B's original proposal is stale and fails closed. B may rebase/retry against the new checkpoint if the product/user still wants that mutation.

v0 intentionally does not auto-merge conflicting causal proposals.

## Reconstruction boundary

The sequencer produces accepted history only.

Independent runtimes can then use:

```text
trusted checkpoint state
+ accepted normalized command receipts
+ logical time
+ deterministic product rules
= current state
```

If two runtimes receive the same trusted checkpoint and accepted receipts, Global State expects them to reconstruct the same canonical state under the already-tested portable kernel contract.

## Truth boundary

This proof contract does not provide:

- user authentication;
- digital signatures;
- hostile-network security;
- production durability;
- multi-host consensus;
- failover leadership;
- CRDT merging;
- P2P agreement;
- real WebSocket/network transport;
- automatic conflict reconciliation.

Those remain separate later layers.
