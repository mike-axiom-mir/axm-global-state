import assert from 'node:assert/strict';
import {
  createSingleSequencerAuthority,
  normalizeAcceptedReceipts
} from '../src/mutation-agreement.mjs';
import {
  createCheckpointEpoch,
  createEpochBoundSequencerAuthority,
  normalizeEpochAcceptedReceipts,
  qualifyEpochProposalId
} from '../src/checkpoint-epoch.mjs';
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
const authority = createSingleSequencerAuthority({
  checkpointRevision: 0,
  checkpointHead: genesisHead
});

const acceptedA = authority.submit({
  id: 'proposal-a',
  actorId: 'participant-a',
  basedOnRevision: 0,
  basedOnHead: genesisHead,
  command: { atTick: 17, type: 'stock.add', payload: { amountMilli: 31 } }
});
const checkpointA = authority.checkpoint();
const acceptedB = authority.submit({
  id: 'proposal-b',
  actorId: 'participant-b',
  basedOnRevision: checkpointA.revision,
  basedOnHead: checkpointA.head,
  command: { atTick: 90, type: 'rate.set', payload: { ratePerTickMilli: 5 } }
});
const checkpointB = authority.checkpoint();
const acceptedAtCheckpointTick = authority.submit({
  id: 'proposal-c',
  actorId: 'participant-c',
  basedOnRevision: checkpointB.revision,
  basedOnHead: checkpointB.head,
  command: { atTick: 3600, type: 'stock.add', payload: { amountMilli: 11 } }
});

const preCompactionCheckpoint = authority.checkpoint();
assert.equal(preCompactionCheckpoint.revision, 3);
const fullHistory = normalizeAcceptedReceipts(authority.receipts(), {
  checkpointRevision: 0,
  checkpointHead: genesisHead
});
const stateAtCheckpoint = advanceCatchup(makeBaseState(), 3600, {
  commands: fullHistory.commands,
  rules
});
assert.equal(stateAtCheckpoint.tick, 3600);
assert.equal(Object.keys(stateAtCheckpoint.appliedCommands).length, 3);
assert.ok(stateAtCheckpoint.appliedCommands['proposal-c'], 'checkpoint-tick command must already be absorbed into state');

const epoch = createCheckpointEpoch({
  checkpointRevision: preCompactionCheckpoint.revision,
  checkpointHead: preCompactionCheckpoint.head,
  state: stateAtCheckpoint,
  priorEpochId: 'genesis'
});

assert.equal(epoch.checkpointRevision, 3);
assert.equal(epoch.checkpointHead, preCompactionCheckpoint.head);
assert.equal(epoch.checkpointTick, 3600);
assert.equal(epoch.retiredCommandCount, 3);
assert.equal(epoch.sourceStateDigest, digestState(stateAtCheckpoint));
assert.equal(Object.keys(epoch.compactedState.appliedCommands).length, 0, 'old command-id replay metadata is intentionally retired at epoch boundary');
assert.deepEqual(physicalState(epoch.compactedState), physicalState(stateAtCheckpoint));
assert.notEqual(epoch.compactedStateDigest, epoch.sourceStateDigest, 'canonical checkpoint digest records that replay metadata was compacted');

const sameEpoch = createCheckpointEpoch({
  checkpointRevision: preCompactionCheckpoint.revision,
  checkpointHead: preCompactionCheckpoint.head,
  state: stateAtCheckpoint,
  priorEpochId: 'genesis'
});
assert.equal(sameEpoch.epochId, epoch.epochId, 'same trusted checkpoint deterministically derives the same epoch id');

const tamperedState = structuredClone(stateAtCheckpoint);
tamperedState.stockMilli += 1;
const differentEpoch = createCheckpointEpoch({
  checkpointRevision: preCompactionCheckpoint.revision,
  checkpointHead: preCompactionCheckpoint.head,
  state: tamperedState,
  priorEpochId: 'genesis'
});
assert.notEqual(differentEpoch.epochId, epoch.epochId, 'state changes must change the derived epoch identity');

// Old receipts at or before the new checkpoint are absorbed, not replayed.
const oldReceiptAtCheckpoint = normalizeEpochAcceptedReceipts(
  [acceptedAtCheckpointTick.receipt],
  {
    checkpointRevision: preCompactionCheckpoint.revision,
    checkpointHead: preCompactionCheckpoint.head,
    epochId: epoch.epochId
  }
);
assert.equal(oldReceiptAtCheckpoint.receipts.length, 0);
assert.equal(oldReceiptAtCheckpoint.commands.length, 0);

// A post-checkpoint receipt created without the epoch namespace is invalid even
// if its sequence/head chain is otherwise valid.
const unscopedPostCheckpointAuthority = createSingleSequencerAuthority({
  checkpointRevision: preCompactionCheckpoint.revision,
  checkpointHead: preCompactionCheckpoint.head
});
const unscopedR4 = unscopedPostCheckpointAuthority.submit({
  id: 'proposal-unscoped',
  actorId: 'participant-x',
  basedOnRevision: preCompactionCheckpoint.revision,
  basedOnHead: preCompactionCheckpoint.head,
  command: { atTick: 4000, type: 'stock.add', payload: { amountMilli: 5 } }
}).receipt;
assert.throws(
  () => normalizeEpochAcceptedReceipts([unscopedR4], {
    checkpointRevision: preCompactionCheckpoint.revision,
    checkpointHead: preCompactionCheckpoint.head,
    epochId: epoch.epochId
  }),
  /checkpoint-epoch-receipt-mismatch:4/
);

const epochAuthority = createEpochBoundSequencerAuthority({
  checkpointRevision: preCompactionCheckpoint.revision,
  checkpointHead: preCompactionCheckpoint.head,
  epochId: epoch.epochId
});

assert.throws(
  () => epochAuthority.submit({
    epochId: 'genesis',
    id: 'proposal-a',
    actorId: 'participant-a',
    basedOnRevision: preCompactionCheckpoint.revision,
    basedOnHead: preCompactionCheckpoint.head,
    command: { atTick: 4000, type: 'stock.add', payload: { amountMilli: 7 } }
  }),
  /proposal-epoch-mismatch:genesis/
);

// Local IDs may be reused after checkpoint because the epoch-qualified identity
// is different. The old global `proposal-a` is not silently treated as the new
// proposal identity.
const newEpochProposal = {
  epochId: epoch.epochId,
  id: 'proposal-a',
  actorId: 'participant-a',
  basedOnRevision: preCompactionCheckpoint.revision,
  basedOnHead: preCompactionCheckpoint.head,
  command: { atTick: 4000, type: 'stock.add', payload: { amountMilli: 7 } }
};
const acceptedNewEpoch = epochAuthority.submit(newEpochProposal);
assert.equal(acceptedNewEpoch.accepted, true);
assert.equal(acceptedNewEpoch.duplicate, false);
assert.equal(acceptedNewEpoch.receipt.sequence, 4);
assert.equal(
  acceptedNewEpoch.receipt.proposalId,
  qualifyEpochProposalId(epoch.epochId, 'proposal-a')
);
assert.notEqual(acceptedNewEpoch.receipt.proposalId, acceptedA.receipt.proposalId);

const duplicateNewEpoch = epochAuthority.submit(newEpochProposal);
assert.equal(duplicateNewEpoch.accepted, true);
assert.equal(duplicateNewEpoch.duplicate, true);
assert.deepEqual(duplicateNewEpoch.receipt, acceptedNewEpoch.receipt);

assert.throws(
  () => epochAuthority.submit({
    ...structuredClone(newEpochProposal),
    command: { atTick: 4000, type: 'stock.add', payload: { amountMilli: 999 } }
  }),
  /proposal-id-conflict:/
);

const postCheckpointHistory = normalizeEpochAcceptedReceipts(epochAuthority.receipts(), {
  checkpointRevision: preCompactionCheckpoint.revision,
  checkpointHead: preCompactionCheckpoint.head,
  epochId: epoch.epochId
});
assert.equal(postCheckpointHistory.fromRevision, 3);
assert.equal(postCheckpointHistory.toRevision, 4);
assert.equal(postCheckpointHistory.commands.length, 1);
assert.equal(postCheckpointHistory.commands[0].id, acceptedNewEpoch.receipt.proposalId);

const compactedFuture = advanceCatchup(structuredClone(epoch.compactedState), 7200, {
  commands: postCheckpointHistory.commands,
  rules
});
const uncompactedReference = advanceCatchup(makeBaseState(), 7200, {
  commands: [...fullHistory.commands, ...postCheckpointHistory.commands],
  rules
});

assert.deepEqual(
  physicalState(compactedFuture),
  physicalState(uncompactedReference),
  'compacted checkpoint + new epoch history must preserve physical world result'
);
assert.equal(Object.keys(compactedFuture.appliedCommands).length, 1);
assert.equal(Object.keys(uncompactedReference.appliedCommands).length, 4);

console.log('AXM Global State proof 017 checkpoint epoch compaction: PASS');
console.log({
  compactedThroughRevision: epoch.checkpointRevision,
  checkpointTick: epoch.checkpointTick,
  retiredCommandIds: epoch.retiredCommandCount,
  epochId: epoch.epochId,
  retainedPostCheckpointReceipts: postCheckpointHistory.receipts.length,
  compactedAppliedCommandIds: Object.keys(compactedFuture.appliedCommands).length,
  uncompactedAppliedCommandIds: Object.keys(uncompactedReference.appliedCommands).length,
  oldEpochRejected: true,
  unscopedPostCheckpointReceiptRejected: true,
  localIdReuseAcrossEpochsExplicit: true,
  physicalStatePreserved: true
});
