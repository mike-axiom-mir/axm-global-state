import assert from 'node:assert/strict';
import {
  createLogicalTimeEvidenceIssuer,
  normalizeLogicalTimeEvidence,
  restoreLogicalTimeEvidenceIssuer
} from '../src/logical-time-evidence.mjs';
import {
  advanceCatchup,
  createState,
  digestState
} from '../src/temporal-state-kernel.mjs';

const contract = Object.freeze({
  sourceId: 'shared-clock-proof',
  trustScope: 'shared-authority',
  contractId: 'proof-012:logical-seconds-v0',
  checkpointSequence: 0,
  checkpointTick: 0,
  checkpointHead: 'time-root:proof-012'
});

const issuer = createLogicalTimeEvidenceIssuer(contract);
const evidenceAtSleep = issuer.issue(600);
assert.equal(evidenceAtSleep.sequence, 1);
assert.equal(evidenceAtSleep.tick, 600);

// The source itself may disappear. Restore its continuity from accepted evidence
// and issue a later claim without requiring it to have run continuously.
const restoredIssuer = restoreLogicalTimeEvidenceIssuer({
  ...contract,
  acceptedEvidence: [evidenceAtSleep]
});
assert.equal(restoredIssuer.checkpoint().sequence, 1);
assert.equal(restoredIssuer.checkpoint().tick, 600);
const evidenceAtWake = restoredIssuer.issue(86_400);
assert.equal(evidenceAtWake.sequence, 2);
assert.equal(evidenceAtWake.tick, 86_400);

// Delivery order and exact duplication are transport concerns, not canonical
// time ordering. The verifier recovers E1,E2 from E2,E1,E1.
const normalized = normalizeLogicalTimeEvidence(
  [evidenceAtWake, evidenceAtSleep, evidenceAtSleep],
  contract
);
assert.equal(normalized.toSequence, 2);
assert.equal(normalized.tick, 86_400);
assert.equal(normalized.head, evidenceAtWake.head);
assert.deepEqual(normalized.evidence.map((item) => item.sequence), [1, 2]);

// A validly checksummed later sequence that claims time moved backward must fail
// because monotonicity is independent of checksum validity.
const rollbackIssuer = createLogicalTimeEvidenceIssuer({
  ...contract,
  checkpointSequence: 1,
  checkpointTick: 0,
  checkpointHead: evidenceAtSleep.head
});
const validButRollbackEvidence = rollbackIssuer.issue(500);
assert.throws(
  () => normalizeLogicalTimeEvidence([evidenceAtSleep, validButRollbackEvidence], contract),
  /time-evidence-rollback:2/
);

// Issuers also refuse to create an obvious rollback relative to their own last
// accepted checkpoint.
const issuerRollbackCheck = restoreLogicalTimeEvidenceIssuer({
  ...contract,
  acceptedEvidence: [evidenceAtSleep]
});
assert.throws(() => issuerRollbackCheck.issue(599), /time-evidence-rollback/);

// Missing accepted history cannot be silently skipped.
assert.throws(
  () => normalizeLogicalTimeEvidence([evidenceAtWake], contract),
  /time-evidence-sequence-gap:1/
);

// Conflicting reuse of one evidence sequence fails closed even before chain
// interpretation.
assert.throws(
  () => normalizeLogicalTimeEvidence([
    evidenceAtSleep,
    { ...structuredClone(evidenceAtSleep), tick: 601 }
  ], contract),
  /time-evidence-sequence-conflict:1/
);

const otherSourceEvidence = createLogicalTimeEvidenceIssuer({
  ...contract,
  sourceId: 'other-shared-clock'
}).issue(600);
assert.throws(
  () => normalizeLogicalTimeEvidence([otherSourceEvidence], contract),
  /time-evidence-source-mismatch:1/
);

const localScopeEvidence = createLogicalTimeEvidenceIssuer({
  ...contract,
  trustScope: 'local-owner'
}).issue(600);
assert.throws(
  () => normalizeLogicalTimeEvidence([localScopeEvidence], contract),
  /time-evidence-trust-scope-mismatch:1/
);

const otherContractEvidence = createLogicalTimeEvidenceIssuer({
  ...contract,
  contractId: 'proof-012:other-time-contract'
}).issue(600);
assert.throws(
  () => normalizeLogicalTimeEvidence([otherContractEvidence], contract),
  /time-evidence-contract-mismatch:1/
);

assert.throws(
  () => normalizeLogicalTimeEvidence([
    { ...structuredClone(evidenceAtSleep), head: 'fnv1a32:00000000' }
  ], contract),
  /time-evidence-digest-mismatch:1/
);

// Integrate only at the seam: accepted logical-time evidence supplies the target
// tick to Temporal State. Time evidence does not execute product rules itself.
const rules = {
  version: 'axm-global-state-proof-001',
  recurringEvery: 60,
  recurringRewardMilli: 7
};
const baseState = createState({
  tick: 0,
  stockMilli: 1000,
  ratePerTickMilli: 3,
  rulesVersion: rules.version,
  completions: [{ id: 'shared-build', atTick: 120, rewardMilli: 25 }]
});
const commands = [
  {
    id: 'proposal-a',
    atTick: 17,
    type: 'stock.add',
    payload: { amountMilli: 31 }
  },
  {
    id: 'proposal-b',
    atTick: 900,
    type: 'rate.set',
    payload: { ratePerTickMilli: 5 }
  }
];
const stateFromAcceptedTime = advanceCatchup(baseState, normalized.tick, { commands, rules });
const stateFromExplicitTarget = advanceCatchup(baseState, 86_400, { commands, rules });
assert.deepEqual(stateFromAcceptedTime, stateFromExplicitTarget);
assert.equal(stateFromAcceptedTime.tick, 86_400);

console.log('AXM Global State proof 012 logical time evidence chain: PASS');
console.log({
  sourceId: normalized.sourceId,
  trustScope: normalized.trustScope,
  contractId: normalized.contractId,
  acceptedSequence: normalized.toSequence,
  acceptedTick: normalized.tick,
  acceptedHead: normalized.head,
  stateDigestAtAcceptedTick: digestState(stateFromAcceptedTime),
  rollbackRejected: true,
  gapRejected: true,
  sourceMismatchRejected: true,
  scopeMismatchRejected: true,
  contractMismatchRejected: true,
  tamperRejected: true
});
