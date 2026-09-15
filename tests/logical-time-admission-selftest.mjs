import assert from 'node:assert/strict';
import {
  createLogicalTimeEvidenceIssuer,
  normalizeLogicalTimeEvidence
} from '../src/logical-time-evidence.mjs';
import {
  evaluateLogicalTimeAdmission,
  normalizeLogicalTimeAdmissionPolicy
} from '../src/logical-time-admission.mjs';
import {
  advanceCatchup,
  createState,
  digestState
} from '../src/temporal-state-kernel.mjs';

const evidenceContract = Object.freeze({
  sourceId: 'shared-clock-proof',
  trustScope: 'shared-authority',
  contractId: 'proof-012:logical-seconds-v0',
  checkpointSequence: 0,
  checkpointTick: 0,
  checkpointHead: 'time-root:proof-013'
});

const issuer = createLogicalTimeEvidenceIssuer(evidenceContract);
const e1 = issuer.issue(600);
const e2 = issuer.issue(86_400);
const acceptedEvidence = normalizeLogicalTimeEvidence([e2, e1], evidenceContract);
assert.equal(acceptedEvidence.tick, 86_400);

const unboundedSharedPolicy = normalizeLogicalTimeAdmissionPolicy({
  policyId: 'shared-explicit-unbounded-v0',
  sourceId: evidenceContract.sourceId,
  trustScope: 'shared-authority',
  contractId: evidenceContract.contractId,
  mode: 'unbounded-monotonic'
});

const unboundedDecision = evaluateLogicalTimeAdmission(acceptedEvidence, {
  lastAdmittedTick: 600,
  policy: unboundedSharedPolicy
});
assert.equal(unboundedDecision.status, 'accepted');
assert.equal(unboundedDecision.deltaTicks, 85_800);
assert.equal(unboundedDecision.admittedTick, 86_400);

const oneHourAutoPolicy = normalizeLogicalTimeAdmissionPolicy({
  policyId: 'shared-auto-one-hour-v0',
  sourceId: evidenceContract.sourceId,
  trustScope: 'shared-authority',
  contractId: evidenceContract.contractId,
  mode: 'max-forward-delta',
  maxForwardTicks: 3_600
});

const heldDecision = evaluateLogicalTimeAdmission(acceptedEvidence, {
  lastAdmittedTick: 600,
  policy: oneHourAutoPolicy
});
assert.equal(heldDecision.status, 'hold');
assert.equal(heldDecision.reason, 'forward-delta-exceeds-policy');
assert.equal(heldDecision.previousTick, 600);
assert.equal(heldDecision.candidateTick, 86_400);
assert.equal(heldDecision.deltaTicks, 85_800);
assert.equal(heldDecision.maxForwardTicks, 3_600);
assert.equal(heldDecision.admittedTick, 600, 'held evidence must never be silently clamped forward');
assert.equal(heldDecision.requiredAction, 'explicit-policy-change-or-corroboration');

const exactColdIntervalPolicy = normalizeLogicalTimeAdmissionPolicy({
  policyId: 'shared-auto-exact-cold-window-v0',
  sourceId: evidenceContract.sourceId,
  trustScope: 'shared-authority',
  contractId: evidenceContract.contractId,
  mode: 'max-forward-delta',
  maxForwardTicks: 85_800
});
const boundedAccepted = evaluateLogicalTimeAdmission(acceptedEvidence, {
  lastAdmittedTick: 600,
  policy: exactColdIntervalPolicy
});
assert.equal(boundedAccepted.status, 'accepted');
assert.equal(boundedAccepted.admittedTick, 86_400);

const sameTickEvidence = normalizeLogicalTimeEvidence([e1], evidenceContract);
const sameTickDecision = evaluateLogicalTimeAdmission(sameTickEvidence, {
  lastAdmittedTick: 600,
  policy: oneHourAutoPolicy
});
assert.equal(sameTickDecision.status, 'accepted');
assert.equal(sameTickDecision.reason, 'same-tick');
assert.equal(sameTickDecision.deltaTicks, 0);

assert.throws(
  () => evaluateLogicalTimeAdmission(sameTickEvidence, {
    lastAdmittedTick: 601,
    policy: oneHourAutoPolicy
  }),
  /time-admission-rollback/
);

assert.throws(
  () => normalizeLogicalTimeAdmissionPolicy({
    policyId: 'bad-bounded',
    sourceId: evidenceContract.sourceId,
    trustScope: 'shared-authority',
    contractId: evidenceContract.contractId,
    mode: 'max-forward-delta'
  }),
  /invalid-time-admission-max-forward-ticks/
);

assert.throws(
  () => normalizeLogicalTimeAdmissionPolicy({
    policyId: 'ambiguous-unbounded',
    sourceId: evidenceContract.sourceId,
    trustScope: 'shared-authority',
    contractId: evidenceContract.contractId,
    mode: 'unbounded-monotonic',
    maxForwardTicks: 999
  }),
  /time-admission-max-forward-ticks-not-allowed/
);

assert.throws(
  () => evaluateLogicalTimeAdmission(acceptedEvidence, {
    lastAdmittedTick: 600,
    policy: {
      ...unboundedSharedPolicy,
      sourceId: 'other-clock'
    }
  }),
  /time-admission-source-mismatch/
);

assert.throws(
  () => evaluateLogicalTimeAdmission(acceptedEvidence, {
    lastAdmittedTick: 600,
    policy: {
      policyId: 'local-owner-unbounded',
      sourceId: evidenceContract.sourceId,
      trustScope: 'local-owner',
      contractId: evidenceContract.contractId,
      mode: 'unbounded-monotonic'
    }
  }),
  /time-admission-trust-scope-mismatch/
);

assert.throws(
  () => evaluateLogicalTimeAdmission(acceptedEvidence, {
    lastAdmittedTick: 600,
    policy: {
      ...unboundedSharedPolicy,
      contractId: 'different-time-contract'
    }
  }),
  /time-admission-contract-mismatch/
);

// Integration seam: a held claim must leave product state at the previously
// admitted tick. An accepted claim can be used as the Temporal State target.
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
const stateWhileHeld = advanceCatchup(baseState, heldDecision.admittedTick, { commands, rules });
const stateWhenAccepted = advanceCatchup(baseState, boundedAccepted.admittedTick, { commands, rules });
assert.equal(stateWhileHeld.tick, 600);
assert.equal(stateWhenAccepted.tick, 86_400);
assert.notEqual(digestState(stateWhileHeld), digestState(stateWhenAccepted));
assert.equal(digestState(stateWhenAccepted), 'fnv1a32:74f37cf0');

console.log('AXM Global State proof 013 logical time admission policy: PASS');
console.log({
  evidenceTick: acceptedEvidence.tick,
  priorAdmittedTick: 600,
  forwardDelta: 85_800,
  unboundedStatus: unboundedDecision.status,
  boundedSmallStatus: heldDecision.status,
  boundedSmallAdmittedTick: heldDecision.admittedTick,
  boundedExactStatus: boundedAccepted.status,
  boundedExactAdmittedTick: boundedAccepted.admittedTick,
  heldStateDigest: digestState(stateWhileHeld),
  acceptedStateDigest: digestState(stateWhenAccepted),
  crossTrustPolicyRejected: true,
  silentClampUsed: false
});
