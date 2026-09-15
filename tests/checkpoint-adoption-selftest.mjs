import assert from 'node:assert/strict';
import {
  createSingleSequencerAuthority,
  normalizeAcceptedReceipts
} from '../src/mutation-agreement.mjs';
import {
  createCheckpointEpoch,
  createEpochBoundSequencerAuthority,
  qualifyEpochProposalId
} from '../src/checkpoint-epoch.mjs';
import {
  createCheckpointAdoptionPackage,
  normalizeCheckpointAdoptionPackage
} from '../src/checkpoint-adoption.mjs';
import {
  advanceCatchup,
  createState,
  digestState
} from '../src/temporal-state-kernel.mjs';

const rules = Object.freeze({
  version: 'axm-global-state-proof-001',
  recurringEvery: 60,
  recurringRewardMilli: 7
});

function makeBaseState() {
  return createState({
    tick: 0,
    stockMilli: 1000,
    ratePerTickMilli: 3,
    rulesVersion: rules.version,
    completions: [{ id: 'shared-build', atTick: 120, rewardMilli: 25 }]
  });
}

function physicalState(state) {
  const snapshot = structuredClone(state);
  delete snapshot.appliedCommands;
  return snapshot;
}

const baseState = makeBaseState();
const genesisHead = `state:${digestState(baseState)}`;
const preEpochAuthority = createSingleSequencerAuthority({
  checkpointRevision: 0,
  checkpointHead: genesisHead
});

const acceptedA = preEpochAuthority.submit({
  id: 'proposal-a',
  actorId: 'participant-a',
  basedOnRevision: 0,
  basedOnHead: genesisHead,
  command: { atTick: 17, type: 'stock.add', payload: { amountMilli: 31 } }
});
const checkpointA = preEpochAuthority.checkpoint();
const acceptedB = preEpochAuthority.submit({
  id: 'proposal-b',
  actorId: 'participant-b',
  basedOnRevision: checkpointA.revision,
  basedOnHead: checkpointA.head,
  command: { atTick: 90, type: 'rate.set', payload: { ratePerTickMilli: 5 } }
});
const checkpointB = preEpochAuthority.checkpoint();
preEpochAuthority.submit({
  id: 'proposal-c',
  actorId: 'participant-c',
  basedOnRevision: checkpointB.revision,
  basedOnHead: checkpointB.head,
  command: { atTick: 3600, type: 'stock.add', payload: { amountMilli: 11 } }
});

const compactionHead = preEpochAuthority.checkpoint();
assert.equal(compactionHead.revision, 3);
const preEpochHistory = normalizeAcceptedReceipts(preEpochAuthority.receipts(), {
  checkpointRevision: 0,
  checkpointHead: genesisHead
});
const stateAtCheckpoint = advanceCatchup(makeBaseState(), 3600, {
  commands: preEpochHistory.commands,
  rules
});
const epoch = createCheckpointEpoch({
  checkpointRevision: compactionHead.revision,
  checkpointHead: compactionHead.head,
  state: stateAtCheckpoint,
  priorEpochId: 'genesis'
});

const epochAuthority = createEpochBoundSequencerAuthority({
  checkpointRevision: epoch.checkpointRevision,
  checkpointHead: epoch.checkpointHead,
  epochId: epoch.epochId
});
const acceptedNewEpoch = epochAuthority.submit({
  epochId: epoch.epochId,
  id: 'proposal-a',
  actorId: 'participant-a',
  basedOnRevision: epoch.checkpointRevision,
  basedOnHead: epoch.checkpointHead,
  command: { atTick: 4000, type: 'stock.add', payload: { amountMilli: 7 } }
});
assert.equal(acceptedNewEpoch.receipt.sequence, 4);
assert.equal(
  acceptedNewEpoch.receipt.proposalId,
  qualifyEpochProposalId(epoch.epochId, 'proposal-a')
);

// A lagging client only knows revision 1 of the retired genesis epoch, but its
// local admitted logical time has already advanced to 7200. Its current state is
// therefore both mutation-stale and later-in-time than the new checkpoint.
const laggingHistory = normalizeAcceptedReceipts([acceptedA.receipt], {
  checkpointRevision: 0,
  checkpointHead: genesisHead
});
const laggingState = advanceCatchup(makeBaseState(), 7200, {
  commands: laggingHistory.commands,
  rules
});
assert.equal(laggingState.tick, 7200);
assert.equal(laggingHistory.toRevision, 1);

// Sending only the retained post-checkpoint receipt to the old genesis base is
// not a valid catch-up strategy: revisions 2 and 3 no longer exist in the suffix.
assert.throws(
  () => normalizeAcceptedReceipts([acceptedNewEpoch.receipt], {
    checkpointRevision: 0,
    checkpointHead: genesisHead
  }),
  /receipt-sequence-gap:1/
);

const adoptionPackage = createCheckpointAdoptionPackage({
  epoch,
  acceptedReceipts: epochAuthority.receipts()
});
assert.equal(adoptionPackage.targetRevision, 4);
assert.equal(adoptionPackage.targetHead, acceptedNewEpoch.receipt.acceptedHead);
assert.equal(adoptionPackage.acceptedReceipts.length, 1);
assert.equal(adoptionPackage.epoch.checkpointRevision, 3);
assert.equal(Object.keys(adoptionPackage.epoch.compactedState.appliedCommands).length, 0);

// Transport/storage round-trip must not change verification behavior.
const transportedPackage = JSON.parse(JSON.stringify(adoptionPackage));
const adopted = normalizeCheckpointAdoptionPackage(transportedPackage, {
  expectedPriorEpochId: 'genesis',
  clientRevision: laggingHistory.toRevision
});
assert.equal(adopted.fromRevision, 3);
assert.equal(adopted.toRevision, 4);
assert.equal(adopted.head, acceptedNewEpoch.receipt.acceptedHead);
assert.equal(adopted.receipts.length, 1);
assert.equal(adopted.commands.length, 1);
assert.equal(adopted.commands[0].id, acceptedNewEpoch.receipt.proposalId);

// Adoption is atomic at the product layer: the checkpoint itself is older than
// the client's admitted logical time, so reconstruct immediately to the already
// admitted target. No client-visible logical rollback is required.
const adoptedFuture = advanceCatchup(structuredClone(adopted.compactedState), laggingState.tick, {
  commands: adopted.commands,
  rules
});
assert.equal(adoptedFuture.tick, laggingState.tick);

const uncompactedReference = advanceCatchup(makeBaseState(), laggingState.tick, {
  commands: [...preEpochHistory.commands, ...adopted.commands],
  rules
});
assert.deepEqual(
  physicalState(adoptedFuture),
  physicalState(uncompactedReference),
  'checkpoint adoption + retained epoch suffix must preserve physical state'
);
assert.equal(Object.keys(adoptedFuture.appliedCommands).length, 1);
assert.equal(Object.keys(uncompactedReference.appliedCommands).length, 4);

// The package does not contain old receipt payloads. Historical effects are
// represented by the checkpoint state + epoch identity instead.
const serializedPackage = JSON.stringify(adoptionPackage);
assert.ok(!serializedPackage.includes('proposal-b'));
assert.ok(!serializedPackage.includes('proposal-c'));

assert.throws(
  () => normalizeCheckpointAdoptionPackage(adoptionPackage, {
    expectedPriorEpochId: 'some-other-epoch',
    clientRevision: 1
  }),
  /checkpoint-adoption-prior-epoch-mismatch:genesis/
);
assert.throws(
  () => normalizeCheckpointAdoptionPackage(adoptionPackage, {
    expectedPriorEpochId: 'genesis',
    clientRevision: 4
  }),
  /checkpoint-adoption-would-drop-client-revision/
);

const tamperedStatePackage = structuredClone(adoptionPackage);
tamperedStatePackage.epoch.compactedState.stockMilli += 1;
assert.throws(
  () => normalizeCheckpointAdoptionPackage(tamperedStatePackage, {
    expectedPriorEpochId: 'genesis',
    clientRevision: 1
  }),
  /checkpoint-epoch-compacted-state-digest-mismatch/
);

const tamperedEpochPackage = structuredClone(adoptionPackage);
tamperedEpochPackage.epoch.epochId = 'fnv1a32:00000000';
assert.throws(
  () => normalizeCheckpointAdoptionPackage(tamperedEpochPackage, {
    expectedPriorEpochId: 'genesis',
    clientRevision: 1
  }),
  /checkpoint-epoch-id-mismatch/
);

const truncatedPackage = structuredClone(adoptionPackage);
truncatedPackage.acceptedReceipts = [];
assert.throws(
  () => normalizeCheckpointAdoptionPackage(truncatedPackage, {
    expectedPriorEpochId: 'genesis',
    clientRevision: 1
  }),
  /checkpoint-adoption-target-revision-mismatch/
);

const wrongHeadPackage = structuredClone(adoptionPackage);
wrongHeadPackage.targetHead = 'fnv1a32:00000000';
assert.throws(
  () => normalizeCheckpointAdoptionPackage(wrongHeadPackage, {
    expectedPriorEpochId: 'genesis',
    clientRevision: 1
  }),
  /checkpoint-adoption-target-head-mismatch/
);

const unscopedAuthority = createSingleSequencerAuthority({
  checkpointRevision: epoch.checkpointRevision,
  checkpointHead: epoch.checkpointHead
});
const unscopedReceipt = unscopedAuthority.submit({
  id: 'proposal-unscoped',
  actorId: 'participant-x',
  basedOnRevision: epoch.checkpointRevision,
  basedOnHead: epoch.checkpointHead,
  command: { atTick: 4000, type: 'stock.add', payload: { amountMilli: 7 } }
}).receipt;
assert.throws(
  () => createCheckpointAdoptionPackage({ epoch, acceptedReceipts: [unscopedReceipt] }),
  /checkpoint-epoch-receipt-mismatch:4/
);

console.log('AXM Global State proof 018 lagging client checkpoint adoption: PASS');
console.log({
  laggingClientRevision: laggingHistory.toRevision,
  laggingClientTick: laggingState.tick,
  adoptedCheckpointRevision: adopted.fromRevision,
  adoptedCheckpointTick: adopted.epoch.checkpointTick,
  adoptedEpochId: adopted.epoch.epochId,
  retainedSuffixReceipts: adopted.receipts.length,
  adoptedRevision: adopted.toRevision,
  oldReceiptPayloadsTransferred: false,
  staleBaseSuffixReplayRejected: true,
  compactedStateTamperRejected: true,
  epochIdentityTamperRejected: true,
  truncatedSuffixRejected: true,
  olderCheckpointOverNewerClientRejected: true,
  physicalStatePreserved: true,
  finalStateDigest: digestState(adoptedFuture)
});
