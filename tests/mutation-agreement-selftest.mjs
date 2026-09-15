import assert from 'node:assert/strict';
import {
  createSingleSequencerAuthority,
  normalizeAcceptedReceipts
} from '../src/mutation-agreement.mjs';
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

function baseState() {
  return createState({
    tick: 0,
    stockMilli: 1000,
    ratePerTickMilli: 3,
    rulesVersion: rules.version,
    completions: [{ id: 'shared-build', atTick: 120, rewardMilli: 25 }]
  });
}

const initialState = baseState();
const checkpointHead = `state:${digestState(initialState)}`;
const authority = createSingleSequencerAuthority({
  checkpointRevision: 0,
  checkpointHead
});

const proposalA = {
  id: 'proposal-a',
  actorId: 'participant-a',
  basedOnRevision: 0,
  basedOnHead: checkpointHead,
  command: {
    atTick: 17,
    type: 'stock.add',
    payload: { amountMilli: 31 }
  }
};

const proposalBStale = {
  id: 'proposal-b',
  actorId: 'participant-b',
  basedOnRevision: 0,
  basedOnHead: checkpointHead,
  command: {
    atTick: 90,
    type: 'rate.set',
    payload: { ratePerTickMilli: 5 }
  }
};

const acceptedA = authority.submit(proposalA);
assert.equal(acceptedA.accepted, true);
assert.equal(acceptedA.duplicate, false);
assert.equal(acceptedA.receipt.sequence, 1);
assert.equal(initialState.stockMilli, 1000, 'sequencer must not mutate product state');
assert.equal(initialState.tick, 0, 'sequencer must not advance simulation time');

assert.throws(
  () => authority.submit(proposalBStale),
  /stale-proposal:proposal-b/,
  'a proposal based on a superseded revision/head must fail closed'
);

const afterA = authority.checkpoint();
const proposalBRebased = {
  ...proposalBStale,
  basedOnRevision: afterA.revision,
  basedOnHead: afterA.head
};
const acceptedB = authority.submit(proposalBRebased);
assert.equal(acceptedB.receipt.sequence, 2);

const duplicateA = authority.submit(proposalA);
assert.equal(duplicateA.duplicate, true, 'same accepted proposal delivery is idempotent');
assert.deepEqual(duplicateA.receipt, acceptedA.receipt);
assert.equal(authority.checkpoint().revision, 2, 'duplicate delivery must not consume a new revision');

assert.throws(
  () => authority.submit({
    ...proposalA,
    command: {
      atTick: 17,
      type: 'stock.add',
      payload: { amountMilli: 999 }
    }
  }),
  /proposal-id-conflict:proposal-a/,
  'same accepted proposal id with different meaning must fail closed'
);

const acceptedReceipts = authority.receipts();
assert.equal(acceptedReceipts.length, 2);

// Simulate a transport that delivers accepted receipts out of order and duplicates one.
const deliveredToRuntimeOne = [
  acceptedReceipts[1],
  acceptedReceipts[0],
  acceptedReceipts[0]
];
const deliveredToRuntimeTwo = [
  acceptedReceipts[0],
  acceptedReceipts[1],
  acceptedReceipts[1]
];

const normalizedOne = normalizeAcceptedReceipts(deliveredToRuntimeOne, {
  checkpointRevision: 0,
  checkpointHead
});
const normalizedTwo = normalizeAcceptedReceipts(deliveredToRuntimeTwo, {
  checkpointRevision: 0,
  checkpointHead
});

assert.deepEqual(
  normalizedOne.receipts,
  normalizedTwo.receipts,
  'transport reordering/duplication must normalize to the same accepted sequence'
);
assert.deepEqual(normalizedOne.commands, normalizedTwo.commands);
assert.equal(normalizedOne.toRevision, 2);
assert.equal(normalizedOne.head, authority.checkpoint().head);

const runtimeOneState = advanceCatchup(baseState(), 3600, {
  commands: normalizedOne.commands,
  rules
});
const runtimeTwoState = advanceCatchup(baseState(), 3600, {
  commands: normalizedTwo.commands,
  rules
});

assert.deepEqual(
  runtimeOneState,
  runtimeTwoState,
  'independent runtimes must reconstruct identical state from checkpoint + accepted receipts'
);
assert.equal(digestState(runtimeOneState), digestState(runtimeTwoState));

// Missing an earlier accepted receipt cannot be hidden by later delivery.
assert.throws(
  () => normalizeAcceptedReceipts([acceptedReceipts[1]], {
    checkpointRevision: 0,
    checkpointHead
  }),
  /receipt-sequence-gap:1/
);

// A tampered accepted command cannot keep the original receipt head.
const tampered = structuredClone(acceptedReceipts[0]);
tampered.command.payload.amountMilli = 999;
assert.throws(
  () => normalizeAcceptedReceipts([tampered], {
    checkpointRevision: 0,
    checkpointHead
  }),
  /receipt-digest-mismatch:1/
);

// Conflicting reuse of one accepted sequence in delivery fails closed.
const conflictingSequence = structuredClone(acceptedReceipts[0]);
conflictingSequence.proposalId = 'forged-proposal-id';
assert.throws(
  () => normalizeAcceptedReceipts([acceptedReceipts[0], conflictingSequence], {
    checkpointRevision: 0,
    checkpointHead
  }),
  /receipt-sequence-conflict:1/
);

console.log('AXM Global State proof 005 mutation agreement: PASS');
console.log({
  checkpointHead,
  acceptedRevision: authority.checkpoint().revision,
  acceptedHead: authority.checkpoint().head,
  finalStateDigest: digestState(runtimeOneState),
  acceptedProposalIds: normalizedOne.receipts.map((receipt) => receipt.proposalId)
});
