import assert from 'node:assert/strict';
import {
  createLogicalTimeEvidenceIssuer,
  normalizeLogicalTimeEvidence
} from '../src/logical-time-evidence.mjs';
import { evaluateLogicalTimeAdmission } from '../src/logical-time-admission.mjs';
import {
  evaluateLogicalTimeCorroboration,
  normalizeLogicalTimeCorroborationPolicy
} from '../src/logical-time-corroboration.mjs';
import {
  advanceCatchup,
  createState,
  digestState
} from '../src/temporal-state-kernel.mjs';

const contractId = 'proof-012:logical-seconds-v0';
const trustScope = 'shared-authority';

function normalizedSource(sourceId, tick, { scope = trustScope, contract = contractId } = {}) {
  const checkpoint = {
    sourceId,
    trustScope: scope,
    contractId: contract,
    checkpointSequence: 0,
    checkpointTick: 0,
    checkpointHead: `time-root:${sourceId}:${scope}:${contract}`
  };
  const issuer = createLogicalTimeEvidenceIssuer(checkpoint);
  const evidence = issuer.issue(tick);
  return normalizeLogicalTimeEvidence([evidence], checkpoint);
}

const clockA = normalizedSource('clock-a', 86_400);
const clockB = normalizedSource('clock-b', 86_420);
const clockCOutlier = normalizedSource('clock-c', 200_000);

const policy = normalizeLogicalTimeCorroborationPolicy({
  policyId: 'shared-two-of-three-30tick-v0',
  trustScope,
  contractId,
  sourceIds: ['clock-a', 'clock-b', 'clock-c'],
  minSources: 2,
  maxSpreadTicks: 30
});

// One large primary claim is held by Proof 013 when it exceeds the automatic
// single-source delta. Corroboration is a separate release path, not a bypass
// inside the admission evaluator itself.
const primaryHeld = evaluateLogicalTimeAdmission(clockA, {
  lastAdmittedTick: 600,
  policy: {
    policyId: 'shared-auto-one-hour-v0',
    sourceId: 'clock-a',
    trustScope,
    contractId,
    mode: 'max-forward-delta',
    maxForwardTicks: 3_600
  }
});
assert.equal(primaryHeld.status, 'hold');
assert.equal(primaryHeld.admittedTick, 600);

const corroborated = evaluateLogicalTimeCorroboration(
  [clockCOutlier, clockB, clockA],
  { lastAdmittedTick: 600, policy }
);
assert.equal(corroborated.status, 'accepted');
assert.equal(corroborated.reason, 'corroborated-forward-advance');
assert.equal(corroborated.admittedTick, 86_400, 'v0 admits the conservative minimum of the selected agreement group');
assert.equal(corroborated.deltaTicks, 85_800);
assert.equal(corroborated.spreadTicks, 20);
assert.deepEqual(
  corroborated.supportingSources.map((source) => source.sourceId).sort(),
  ['clock-a', 'clock-b']
);
assert.deepEqual(corroborated.excludedConfiguredSourceIds, ['clock-c']);

const insufficient = evaluateLogicalTimeCorroboration(
  [clockA, clockCOutlier],
  { lastAdmittedTick: 600, policy }
);
assert.equal(insufficient.status, 'hold');
assert.equal(insufficient.reason, 'insufficient-corroboration');
assert.equal(insufficient.admittedTick, 600);

// Two disjoint equally strong clusters must not be resolved with an arbitrary
// tie-break. Hold until the evidence/policy changes.
const clockA2 = normalizedSource('clock-a', 86_400);
const clockB2 = normalizedSource('clock-b', 86_410);
const clockC2 = normalizedSource('clock-c', 200_000);
const clockD2 = normalizedSource('clock-d', 200_010);
const ambiguousPolicy = normalizeLogicalTimeCorroborationPolicy({
  policyId: 'shared-two-of-four-20tick-v0',
  trustScope,
  contractId,
  sourceIds: ['clock-a', 'clock-b', 'clock-c', 'clock-d'],
  minSources: 2,
  maxSpreadTicks: 20
});
const ambiguous = evaluateLogicalTimeCorroboration(
  [clockD2, clockB2, clockA2, clockC2],
  { lastAdmittedTick: 600, policy: ambiguousPolicy }
);
assert.equal(ambiguous.status, 'hold');
assert.equal(ambiguous.reason, 'ambiguous-corroboration');
assert.equal(ambiguous.admittedTick, 600);
assert.equal(ambiguous.candidateGroups.length, 2);

assert.throws(
  () => evaluateLogicalTimeCorroboration([clockA, clockA, clockB], {
    lastAdmittedTick: 600,
    policy
  }),
  /duplicate-time-corroboration-evidence-source:clock-a/
);

const unknownClock = normalizedSource('clock-z', 86_405);
assert.throws(
  () => evaluateLogicalTimeCorroboration([clockA, unknownClock], {
    lastAdmittedTick: 600,
    policy
  }),
  /time-corroboration-source-not-configured:clock-z/
);

const localClockB = normalizedSource('clock-b', 86_420, { scope: 'local-owner' });
assert.throws(
  () => evaluateLogicalTimeCorroboration([clockA, localClockB], {
    lastAdmittedTick: 600,
    policy
  }),
  /time-corroboration-trust-scope-mismatch:clock-b/
);

const otherContractB = normalizedSource('clock-b', 86_420, { contract: 'other-time-contract' });
assert.throws(
  () => evaluateLogicalTimeCorroboration([clockA, otherContractB], {
    lastAdmittedTick: 600,
    policy
  }),
  /time-corroboration-contract-mismatch:clock-b/
);

// A configured source that is behind already-admitted global time is recorded as
// behind and excluded. It must not pull the corroborated result backward or block
// a sufficient fresh agreement group.
const clockABehind = normalizedSource('clock-a', 500);
const clockBFresh = normalizedSource('clock-b', 86_400);
const clockCFresh = normalizedSource('clock-c', 86_420);
const freshAgreement = evaluateLogicalTimeCorroboration(
  [clockABehind, clockBFresh, clockCFresh],
  { lastAdmittedTick: 600, policy }
);
assert.equal(freshAgreement.status, 'accepted');
assert.equal(freshAgreement.admittedTick, 86_400);
assert.deepEqual(freshAgreement.behindSources.map((source) => source.sourceId), ['clock-a']);

assert.throws(
  () => normalizeLogicalTimeCorroborationPolicy({
    policyId: 'duplicate-config',
    trustScope,
    contractId,
    sourceIds: ['clock-a', 'clock-a'],
    minSources: 2,
    maxSpreadTicks: 30
  }),
  /duplicate-time-corroboration-source-id/
);

assert.throws(
  () => normalizeLogicalTimeCorroborationPolicy({
    policyId: 'impossible-quorum',
    trustScope,
    contractId,
    sourceIds: ['clock-a', 'clock-b'],
    minSources: 3,
    maxSpreadTicks: 30
  }),
  /invalid-time-corroboration-min-sources/
);

// Product-state integration remains downstream. A held single-source claim leaves
// state at 600; corroborated evidence may advance to the conservative admitted
// tick without changing the Temporal State rules themselves.
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
const heldState = advanceCatchup(baseState, primaryHeld.admittedTick, { commands, rules });
const corroboratedState = advanceCatchup(baseState, corroborated.admittedTick, { commands, rules });
assert.equal(heldState.tick, 600);
assert.equal(corroboratedState.tick, 86_400);
assert.equal(digestState(corroboratedState), 'fnv1a32:74f37cf0');

console.log('AXM Global State proof 014 logical time corroboration: PASS');
console.log({
  primarySingleSourceStatus: primaryHeld.status,
  priorAdmittedTick: 600,
  corroborationStatus: corroborated.status,
  corroboratedTick: corroborated.admittedTick,
  supportingSourceIds: corroborated.supportingSources.map((source) => source.sourceId),
  spreadTicks: corroborated.spreadTicks,
  excludedOutlierIds: corroborated.excludedConfiguredSourceIds,
  insufficientStatus: insufficient.status,
  ambiguousStatus: ambiguous.status,
  laggingSourceExcluded: freshAgreement.behindSources[0].sourceId,
  duplicateSourceRejected: true,
  crossTrustSourceRejected: true,
  finalStateDigest: digestState(corroboratedState),
  sourceIdsProveRealWorldIndependence: false
});
