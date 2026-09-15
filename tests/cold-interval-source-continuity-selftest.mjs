import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openFileReceiptHistory } from '../src/durable-receipt-history.mjs';
import {
  createLogicalTimeIntervalEvidenceIssuer,
  normalizeLogicalTimeIntervalEvidence,
  restoreLogicalTimeIntervalEvidenceIssuer
} from '../src/logical-time-interval-evidence.mjs';
import { evaluateLogicalTimeIntervalCorroboration } from '../src/logical-time-interval-corroboration.mjs';
import {
  advanceCatchupMeasured,
  createState,
  digestState
} from '../src/temporal-state-kernel.mjs';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'axm-global-state-proof-016-'));
const receiptHistoryPath = path.join(tempDir, 'accepted-history.json');
const sourceAPath = path.join(tempDir, 'clock-a-evidence.json');
const sourceBPath = path.join(tempDir, 'clock-b-evidence.json');
const sourceCPath = path.join(tempDir, 'clock-c-evidence.json');

const sleepTick = 600;
const rules = Object.freeze({
  version: 'axm-global-state-proof-001',
  recurringEvery: 60,
  recurringRewardMilli: 7
});
const baseStateConfig = Object.freeze({
  tick: 0,
  stockMilli: 1000,
  ratePerTickMilli: 3,
  rulesVersion: rules.version,
  completions: Object.freeze([
    Object.freeze({ id: 'shared-build', atTick: 120, rewardMilli: 25 })
  ])
});
function makeBaseState() {
  return createState(structuredClone(baseStateConfig));
}
const checkpointHead = `state:${digestState(makeBaseState())}`;

const intervalContractId = 'proof-015:logical-seconds-interval-v0';
const trustScope = 'shared-authority';
function intervalCheckpoint(sourceId) {
  return {
    sourceId,
    trustScope,
    contractId: intervalContractId,
    checkpointSequence: 0,
    checkpointEarliestTick: 0,
    checkpointLatestTick: 0,
    checkpointHead: `interval-root:${sourceId}`
  };
}

async function persistEvidence(filePath, checkpoint, evidence) {
  await writeFile(filePath, JSON.stringify({ checkpoint, evidence }), 'utf8');
}

async function restoreEvidence(filePath) {
  const document = JSON.parse(await readFile(filePath, 'utf8'));
  const normalized = normalizeLogicalTimeIntervalEvidence(document.evidence, document.checkpoint);
  return {
    checkpoint: document.checkpoint,
    evidence: document.evidence,
    normalized,
    issuer: restoreLogicalTimeIntervalEvidenceIssuer({
      ...document.checkpoint,
      acceptedEvidence: document.evidence
    })
  };
}

try {
  // Accepted product mutation history is durable independently of world state.
  let history = await openFileReceiptHistory({
    filePath: receiptHistoryPath,
    checkpointRevision: 0,
    checkpointHead
  });
  let authority = history.restoreAuthority();

  const proposalA = {
    id: 'proposal-a',
    actorId: 'participant-a',
    basedOnRevision: 0,
    basedOnHead: checkpointHead,
    command: { atTick: 17, type: 'stock.add', payload: { amountMilli: 31 } }
  };
  const acceptedA = authority.submit(proposalA);
  await history.append(acceptedA.receipt);
  authority = history.restoreAuthority();

  // Before going cold, interval sources express uncertainty around tick 600.
  let issuerA = createLogicalTimeIntervalEvidenceIssuer(intervalCheckpoint('clock-a'));
  let issuerB = createLogicalTimeIntervalEvidenceIssuer(intervalCheckpoint('clock-b'));
  let issuerC = createLogicalTimeIntervalEvidenceIssuer(intervalCheckpoint('clock-c'));
  const a1 = issuerA.issue({ earliestTick: 590, latestTick: 610 });
  const b1 = issuerB.issue({ earliestTick: 595, latestTick: 615 });
  const c1 = issuerC.issue({ earliestTick: 580, latestTick: 620 });

  await persistEvidence(sourceAPath, intervalCheckpoint('clock-a'), [a1]);
  await persistEvidence(sourceBPath, intervalCheckpoint('clock-b'), [b1]);
  await persistEvidence(sourceCPath, intervalCheckpoint('clock-c'), [c1]);

  const sleepIntervals = [
    normalizeLogicalTimeIntervalEvidence([a1], intervalCheckpoint('clock-a')),
    normalizeLogicalTimeIntervalEvidence([b1], intervalCheckpoint('clock-b')),
    normalizeLogicalTimeIntervalEvidence([c1], intervalCheckpoint('clock-c'))
  ];
  const sleepDecision = evaluateLogicalTimeIntervalCorroboration(sleepIntervals, {
    lastAdmittedTick: 0,
    policy: {
      policyId: 'proof-016-sleep-corroboration',
      trustScope,
      contractId: intervalContractId,
      sourceIds: ['clock-a', 'clock-b', 'clock-c'],
      minSources: 2,
      maxSourceWidthTicks: 50,
      maxIntersectionWidthTicks: 20
    }
  });
  assert.equal(sleepDecision.status, 'accepted');
  assert.equal(sleepDecision.admittedTick, 595);
  // Product policy can already have admitted tick 600 from earlier exact evidence;
  // interval corroboration at sleep is recorded as uncertainty context, not used to
  // roll the already-admitted product time backward.
  const sleepState = advanceCatchupMeasured(makeBaseState(), sleepTick, {
    commands: history.normalized().commands,
    rules
  });
  assert.equal(sleepState.state.tick, sleepTick);

  // While the browser/runtime is absent but before the accepted-history service is
  // discarded, one later mutation is admitted and persisted.
  const afterA = authority.checkpoint();
  const proposalB = {
    id: 'proposal-b',
    actorId: 'participant-b',
    basedOnRevision: afterA.revision,
    basedOnHead: afterA.head,
    command: { atTick: 900, type: 'rate.set', payload: { ratePerTickMilli: 5 } }
  };
  const acceptedB = authority.submit(proposalB);
  await history.append(acceptedB.receipt);

  // FULLY COLD: drop every live issuer/authority/history object. Only serialized
  // accepted mutation receipts and serialized interval evidence remain.
  authority = null;
  history = null;
  issuerA = null;
  issuerB = null;
  issuerC = null;
  await new Promise((resolve) => setTimeout(resolve, 25));

  // Wake from compact evidence only.
  history = await openFileReceiptHistory({
    filePath: receiptHistoryPath,
    checkpointRevision: 0,
    checkpointHead
  });
  assert.equal(history.checkpoint().revision, 2);

  const restoredA = await restoreEvidence(sourceAPath);
  const restoredB = await restoreEvidence(sourceBPath);
  const restoredC = await restoreEvidence(sourceCPath);
  assert.equal(restoredA.normalized.toSequence, 1);
  assert.equal(restoredB.normalized.toSequence, 1);
  assert.equal(restoredC.normalized.toSequence, 1);

  // Restored sources emit later uncertainty intervals. C disagrees strongly.
  const a2 = restoredA.issuer.issue({ earliestTick: 86_390, latestTick: 86_410 });
  const b2 = restoredB.issuer.issue({ earliestTick: 86_400, latestTick: 86_430 });
  const c2 = restoredC.issuer.issue({ earliestTick: 199_990, latestTick: 200_010 });

  const wakeA = normalizeLogicalTimeIntervalEvidence(
    [...restoredA.evidence, a2],
    restoredA.checkpoint
  );
  const wakeB = normalizeLogicalTimeIntervalEvidence(
    [...restoredB.evidence, b2],
    restoredB.checkpoint
  );
  const wakeC = normalizeLogicalTimeIntervalEvidence(
    [...restoredC.evidence, c2],
    restoredC.checkpoint
  );

  const wakeDecision = evaluateLogicalTimeIntervalCorroboration(
    [wakeC, wakeB, wakeA],
    {
      lastAdmittedTick: sleepTick,
      policy: {
        policyId: 'proof-016-wake-corroboration',
        trustScope,
        contractId: intervalContractId,
        sourceIds: ['clock-a', 'clock-b', 'clock-c'],
        minSources: 2,
        maxSourceWidthTicks: 40,
        maxIntersectionWidthTicks: 20
      }
    }
  );

  assert.equal(wakeDecision.status, 'accepted');
  assert.equal(wakeDecision.intersectionEarliestTick, 86_400);
  assert.equal(wakeDecision.intersectionLatestTick, 86_410);
  assert.equal(wakeDecision.admittedTick, 86_400);
  assert.deepEqual(
    wakeDecision.supportingSources.map((source) => source.sourceId).sort(),
    ['clock-a', 'clock-b']
  );
  assert.deepEqual(wakeDecision.excludedConfiguredSourceIds, ['clock-c']);

  const measured = advanceCatchupMeasured(makeBaseState(), wakeDecision.admittedTick, {
    commands: history.normalized().commands,
    rules
  });
  assert.equal(measured.state.tick, 86_400);
  assert.equal(digestState(measured.state), 'fnv1a32:74f37cf0');
  assert.ok(measured.metrics.perTickTransitionsAvoided > 84_000);

  console.log('AXM Global State proof 016 cold interval source continuity: PASS');
  console.log({
    coldLiveObjectsDiscarded: ['mutation-authority', 'receipt-history-handle', 'clock-a-issuer', 'clock-b-issuer', 'clock-c-issuer'],
    restoredMutationRevision: history.checkpoint().revision,
    restoredIntervalSequences: [restoredA.normalized.toSequence, restoredB.normalized.toSequence, restoredC.normalized.toSequence],
    wakeOverlapInterval: [wakeDecision.intersectionEarliestTick, wakeDecision.intersectionLatestTick],
    admittedConservativeLowerBound: wakeDecision.admittedTick,
    excludedOutlierIds: wakeDecision.excludedConfiguredSourceIds,
    catchupJumps: measured.metrics.jumpCount,
    perTickTransitionsAvoided: measured.metrics.perTickTransitionsAvoided,
    finalStateDigest: digestState(measured.state),
    exactTimestampInvented: false
  });
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
