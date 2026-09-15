import assert from 'node:assert/strict';
import {
  createLogicalTimeIntervalEvidenceIssuer,
  normalizeLogicalTimeIntervalEvidence,
  restoreLogicalTimeIntervalEvidenceIssuer
} from '../src/logical-time-interval-evidence.mjs';
import {
  evaluateLogicalTimeIntervalCorroboration,
  normalizeLogicalTimeIntervalCorroborationPolicy
} from '../src/logical-time-interval-corroboration.mjs';
import {
  advanceCatchup,
  createState,
  digestState
} from '../src/temporal-state-kernel.mjs';

const contractId = 'proof-015:logical-seconds-interval-v0';
const trustScope = 'shared-authority';

function intervalSource(sourceId, intervals, { scope = trustScope, contract = contractId } = {}) {
  const checkpoint = {
    sourceId,
    trustScope: scope,
    contractId: contract,
    checkpointSequence: 0,
    checkpointEarliestTick: 0,
    checkpointLatestTick: 0,
    checkpointHead: `interval-root:${sourceId}:${scope}:${contract}`
  };
  let issuer = createLogicalTimeIntervalEvidenceIssuer(checkpoint);
  const evidence = [];
  for (let index = 0; index < intervals.length; index += 1) {
    const item = issuer.issue(intervals[index]);
    evidence.push(item);
    // Exercise recovery from accepted interval evidence between emissions.
    if (index < intervals.length - 1) {
      issuer = restoreLogicalTimeIntervalEvidenceIssuer({
        ...checkpoint,
        acceptedEvidence: evidence
      });
    }
  }
  return {
    checkpoint,
    evidence,
    normalized: normalizeLogicalTimeIntervalEvidence(
      [...evidence].reverse().flatMap((item, index) => index === evidence.length - 1 ? [item, item] : [item]),
      checkpoint
    )
  };
}

// Width is allowed to shrink as certainty improves. Only the guaranteed lower
// bound is required to remain monotonic.
const aHistory = intervalSource('clock-a', [
  { earliestTick: 600, latestTick: 700 },
  { earliestTick: 86_390, latestTick: 86_410 }
]);
assert.equal(aHistory.normalized.toSequence, 2);
assert.equal(aHistory.normalized.earliestTick, 86_390);
assert.equal(aHistory.normalized.latestTick, 86_410);
assert.equal(aHistory.normalized.widthTicks, 20);

const bHistory = intervalSource('clock-b', [
  { earliestTick: 610, latestTick: 750 },
  { earliestTick: 86_400, latestTick: 86_430 }
]);
const cOutlier = intervalSource('clock-c', [
  { earliestTick: 199_990, latestTick: 200_010 }
]);

// Issuer refuses guaranteed-lower-bound rollback even if the new interval would
// otherwise be structurally valid.
const rollbackIssuer = createLogicalTimeIntervalEvidenceIssuer(aHistory.checkpoint);
rollbackIssuer.issue({ earliestTick: 600, latestTick: 700 });
assert.throws(
  () => rollbackIssuer.issue({ earliestTick: 599, latestTick: 900 }),
  /guaranteed-lower-bound-rollback/
);

// A validly headed sequence can still be a semantic rollback relative to the
// trusted prior accepted lower bound; verifier must reject it specifically.
const rollbackChainIssuer = createLogicalTimeIntervalEvidenceIssuer({
  ...aHistory.checkpoint,
  checkpointSequence: 1,
  checkpointEarliestTick: 0,
  checkpointLatestTick: 1_000,
  checkpointHead: aHistory.evidence[0].head
});
const validRollbackInterval = rollbackChainIssuer.issue({
  earliestTick: 500,
  latestTick: 900
});
assert.throws(
  () => normalizeLogicalTimeIntervalEvidence(
    [aHistory.evidence[0], validRollbackInterval],
    aHistory.checkpoint
  ),
  /guaranteed-lower-bound-rollback:2/
);

assert.throws(
  () => normalizeLogicalTimeIntervalEvidence([aHistory.evidence[1]], aHistory.checkpoint),
  /time-interval-evidence-sequence-gap:1/
);
assert.throws(
  () => normalizeLogicalTimeIntervalEvidence([
    aHistory.evidence[0],
    { ...structuredClone(aHistory.evidence[0]), latestTick: 701 }
  ], aHistory.checkpoint),
  /time-interval-evidence-sequence-conflict:1/
);
assert.throws(
  () => normalizeLogicalTimeIntervalEvidence([
    { ...structuredClone(aHistory.evidence[0]), head: 'fnv1a32:00000000' }
  ], aHistory.checkpoint),
  /time-interval-evidence-digest-mismatch:1/
);

const policy = normalizeLogicalTimeIntervalCorroborationPolicy({
  policyId: 'shared-two-of-three-interval-v0',
  trustScope,
  contractId,
  sourceIds: ['clock-a', 'clock-b', 'clock-c'],
  minSources: 2,
  maxSourceWidthTicks: 40,
  maxIntersectionWidthTicks: 20
});

const corroborated = evaluateLogicalTimeIntervalCorroboration([
  cOutlier.normalized,
  bHistory.normalized,
  aHistory.normalized
], {
  lastAdmittedTick: 600,
  policy
});
assert.equal(corroborated.status, 'accepted');
assert.equal(corroborated.admittedTick, 86_400);
assert.equal(corroborated.intersectionEarliestTick, 86_400);
assert.equal(corroborated.intersectionLatestTick, 86_410);
assert.equal(corroborated.intersectionWidthTicks, 10);
assert.deepEqual(
  corroborated.supportingSources.map((source) => source.sourceId).sort(),
  ['clock-a', 'clock-b']
);
assert.deepEqual(corroborated.excludedConfiguredSourceIds, ['clock-c']);

const insufficient = evaluateLogicalTimeIntervalCorroboration([
  aHistory.normalized,
  cOutlier.normalized
], {
  lastAdmittedTick: 600,
  policy
});
assert.equal(insufficient.status, 'hold');
assert.equal(insufficient.reason, 'insufficient-interval-corroboration');
assert.equal(insufficient.admittedTick, 600);

// A huge uncertainty range must not count as corroboration merely because it
// contains every candidate time.
const broadSource = intervalSource('clock-b', [
  { earliestTick: 0, latestTick: 1_000_000 }
]);
const broadHeld = evaluateLogicalTimeIntervalCorroboration([
  aHistory.normalized,
  broadSource.normalized
], {
  lastAdmittedTick: 600,
  policy
});
assert.equal(broadHeld.status, 'hold');
assert.equal(broadHeld.reason, 'insufficient-interval-corroboration');
assert.equal(broadHeld.tooUncertainSources.length, 1);
assert.equal(broadHeld.tooUncertainSources[0].sourceId, 'clock-b');

// Two equally strong, equally narrow disjoint overlap clusters are ambiguous.
const a2 = intervalSource('clock-a', [{ earliestTick: 86_390, latestTick: 86_410 }]).normalized;
const b2 = intervalSource('clock-b', [{ earliestTick: 86_400, latestTick: 86_420 }]).normalized;
const c2 = intervalSource('clock-c', [{ earliestTick: 199_990, latestTick: 200_010 }]).normalized;
const d2 = intervalSource('clock-d', [{ earliestTick: 200_000, latestTick: 200_020 }]).normalized;
const ambiguousPolicy = normalizeLogicalTimeIntervalCorroborationPolicy({
  policyId: 'shared-two-of-four-interval-v0',
  trustScope,
  contractId,
  sourceIds: ['clock-a', 'clock-b', 'clock-c', 'clock-d'],
  minSources: 2,
  maxSourceWidthTicks: 40,
  maxIntersectionWidthTicks: 20
});
const ambiguous = evaluateLogicalTimeIntervalCorroboration([d2, b2, c2, a2], {
  lastAdmittedTick: 600,
  policy: ambiguousPolicy
});
assert.equal(ambiguous.status, 'hold');
assert.equal(ambiguous.reason, 'ambiguous-interval-corroboration');
assert.equal(ambiguous.candidateGroups.length, 2);

// Wholly lagging interval is excluded; fresh B+C can still advance.
const aBehind = intervalSource('clock-a', [{ earliestTick: 400, latestTick: 500 }]).normalized;
const bFresh = intervalSource('clock-b', [{ earliestTick: 86_400, latestTick: 86_420 }]).normalized;
const cFresh = intervalSource('clock-c', [{ earliestTick: 86_410, latestTick: 86_430 }]).normalized;
const freshAgreement = evaluateLogicalTimeIntervalCorroboration([
  aBehind,
  bFresh,
  cFresh
], {
  lastAdmittedTick: 600,
  policy
});
assert.equal(freshAgreement.status, 'accepted');
assert.equal(freshAgreement.admittedTick, 86_410);
assert.deepEqual(freshAgreement.behindSources.map((source) => source.sourceId), ['clock-a']);

// If two uncertain sources both straddle already-admitted time, their overlap may
// advance only to the lower bound they jointly support, never their midpoint.
const straddleA = intervalSource('clock-a', [{ earliestTick: 550, latestTick: 700 }]).normalized;
const straddleB = intervalSource('clock-b', [{ earliestTick: 650, latestTick: 800 }]).normalized;
const straddlePolicy = normalizeLogicalTimeIntervalCorroborationPolicy({
  policyId: 'straddle-two-source-v0',
  trustScope,
  contractId,
  sourceIds: ['clock-a', 'clock-b'],
  minSources: 2,
  maxSourceWidthTicks: 200,
  maxIntersectionWidthTicks: 100
});
const straddle = evaluateLogicalTimeIntervalCorroboration([
  straddleA,
  straddleB
], {
  lastAdmittedTick: 600,
  policy: straddlePolicy
});
assert.equal(straddle.status, 'accepted');
assert.equal(straddle.intersectionEarliestTick, 650);
assert.equal(straddle.intersectionLatestTick, 700);
assert.equal(straddle.admittedTick, 650);

assert.throws(
  () => evaluateLogicalTimeIntervalCorroboration([
    aHistory.normalized,
    aHistory.normalized,
    bHistory.normalized
  ], { lastAdmittedTick: 600, policy }),
  /duplicate-time-interval-corroboration-evidence-source:clock-a/
);

const localB = intervalSource('clock-b', [
  { earliestTick: 86_400, latestTick: 86_430 }
], { scope: 'local-owner' }).normalized;
assert.throws(
  () => evaluateLogicalTimeIntervalCorroboration([
    aHistory.normalized,
    localB
  ], { lastAdmittedTick: 600, policy }),
  /time-interval-corroboration-trust-scope-mismatch:clock-b/
);

assert.throws(
  () => normalizeLogicalTimeIntervalCorroborationPolicy({
    policyId: 'bad-duplicate-source-policy',
    trustScope,
    contractId,
    sourceIds: ['clock-a', 'clock-a'],
    minSources: 2,
    maxSourceWidthTicks: 40,
    maxIntersectionWidthTicks: 20
  }),
  /duplicate-time-interval-corroboration-source-id/
);

// Downstream product state uses only the admitted conservative lower bound.
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
const state = advanceCatchup(baseState, corroborated.admittedTick, { commands, rules });
assert.equal(state.tick, 86_400);
assert.equal(digestState(state), 'fnv1a32:74f37cf0');

console.log('AXM Global State proof 015 interval time evidence + corroboration: PASS');
console.log({
  sourceAInterval: [aHistory.normalized.earliestTick, aHistory.normalized.latestTick],
  sourceBInterval: [bHistory.normalized.earliestTick, bHistory.normalized.latestTick],
  outlierInterval: [cOutlier.normalized.earliestTick, cOutlier.normalized.latestTick],
  overlapInterval: [corroborated.intersectionEarliestTick, corroborated.intersectionLatestTick],
  admittedConservativeLowerBound: corroborated.admittedTick,
  tooWideSourceExcluded: broadHeld.tooUncertainSources[0].sourceId,
  ambiguousIntervalsHeld: true,
  laggingIntervalExcluded: freshAgreement.behindSources[0].sourceId,
  midpointInvented: false,
  sourceIdsProveRealWorldIndependence: false,
  finalStateDigest: digestState(state)
});
