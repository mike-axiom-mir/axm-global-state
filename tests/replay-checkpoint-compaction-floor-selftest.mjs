import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCompactedFileReceiptHistory } from '../src/compacted-receipt-history.mjs';
import {
  createReplayCheckpoint,
  resumeFromReplayCheckpoint,
  verifyReplayCheckpoint
} from '../src/replay-checkpoint.mjs';
import {
  createSingleSequencerAuthority,
  normalizeAcceptedReceipts
} from '../src/mutation-agreement.mjs';
import {
  advanceCatchup,
  createState,
  digestState
} from '../src/temporal-state-kernel.mjs';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'axm-global-state-proof-020-'));
const compactedPath = path.join(tempDir, 'compacted-history.json');
const mutationRoot = 'proof-020:mutation-root';
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
    Object.freeze({ id: 'checkpoint-fixture-build', atTick: 120, rewardMilli: 25 })
  ])
});
function makeBaseState() {
  return createState(structuredClone(baseStateConfig));
}

function buildHistory(count = 40) {
  const authority = createSingleSequencerAuthority({
    checkpointRevision: 0,
    checkpointHead: mutationRoot
  });
  const proposals = [];
  const receipts = [];
  for (let index = 1; index <= count; index += 1) {
    const checkpoint = authority.checkpoint();
    const proposal = Object.freeze({
      id: `proposal-${String(index).padStart(3, '0')}`,
      actorId: `actor-${index % 4}`,
      basedOnRevision: checkpoint.revision,
      basedOnHead: checkpoint.head,
      command: Object.freeze({
        atTick: index * 10,
        type: 'stock.add',
        payload: Object.freeze({
          amountMilli: index,
          padding: `${String(index).padStart(3, '0')}:${'x'.repeat(256)}`
        })
      })
    });
    proposals.push(proposal);
    receipts.push(authority.submit(proposal).receipt);
  }
  return { authority, proposals, receipts };
}

try {
  const built = buildHistory();
  const history = await createCompactedFileReceiptHistory({
    filePath: compactedPath,
    checkpointRevision: 0,
    checkpointHead: mutationRoot,
    acceptedReceipts: built.receipts,
    throughRevision: 32
  });
  assert.equal(history.compactionCheckpoint().revision, 32);
  assert.throws(() => history.receiptsAfter(10), /receipts-before-compaction-floor:32/);

  // Extend the live suffix once after partial compaction.
  let authority = history.restoreAuthority();
  const before41 = authority.checkpoint();
  const proposal41 = Object.freeze({
    id: 'proposal-041',
    actorId: 'actor-new',
    basedOnRevision: before41.revision,
    basedOnHead: before41.head,
    command: Object.freeze({
      atTick: 410,
      type: 'stock.add',
      payload: Object.freeze({ amountMilli: 41, padding: 'new-after-compaction' })
    })
  });
  const accepted41 = authority.submit(proposal41);
  await history.append(accepted41.receipt);
  assert.equal(history.checkpoint().revision, 41);

  const allReceipts = [...built.receipts, accepted41.receipt];
  const normalizedFull = normalizeAcceptedReceipts(allReceipts, {
    checkpointRevision: 0,
    checkpointHead: mutationRoot
  });

  // A client stuck below the partial-compaction floor cannot ask the authority for
  // the missing receipt prefix. Build a replay checkpoint exactly at the floor.
  const replay = createReplayCheckpoint({
    baseState: makeBaseState(),
    sourceCheckpointRevision: 0,
    sourceCheckpointHead: mutationRoot,
    acceptedReceipts: allReceipts,
    throughRevision: 32,
    checkpointTick: 320,
    rules
  });
  assert.equal(replay.checkpoint.mutationRevision, 32);
  assert.equal(replay.checkpoint.mutationHead, built.receipts[31].acceptedHead);
  assert.equal(replay.checkpoint.checkpointTick, 320);
  assert.equal(Object.keys(replay.checkpoint.state.appliedCommands).length, 32);
  assert.equal(replay.retainedReceipts.length, 9);
  assert.deepEqual(replay.retainedReceipts, history.receiptsAfter(32));

  const serializedCheckpoint = JSON.parse(JSON.stringify(replay.checkpoint));
  const verified = verifyReplayCheckpoint(serializedCheckpoint, {
    expectedCheckpointDigest: replay.checkpoint.checkpointDigest,
    expectedMutationRevision: 32,
    expectedMutationHead: built.receipts[31].acceptedHead,
    expectedRulesVersion: rules.version
  });
  assert.equal(verified.checkpointTick, 320);

  // The lagging client adopts the verified checkpoint, then needs only the retained
  // suffix. Its final state must equal uninterrupted replay from genesis.
  const targetTick = 600;
  const resumed = resumeFromReplayCheckpoint({
    checkpoint: serializedCheckpoint,
    expectedCheckpointDigest: replay.checkpoint.checkpointDigest,
    acceptedReceipts: history.receiptsAfter(32),
    targetTick,
    rules
  });
  const uninterrupted = advanceCatchup(makeBaseState(), targetTick, {
    commands: normalizedFull.commands,
    rules
  });
  assert.deepEqual(resumed.state, uninterrupted);
  assert.equal(resumed.digest, digestState(uninterrupted));
  assert.equal(resumed.normalizedSuffix.fromRevision, 32);
  assert.equal(resumed.normalizedSuffix.toRevision, 41);
  assert.equal(resumed.normalizedSuffix.receipts.length, 9);

  // Unsafe checkpoint boundaries fail closed. A compacted-prefix command cannot be
  // scheduled after the checkpoint tick, and a retained-suffix command cannot be
  // scheduled at/before it.
  assert.throws(
    () => createReplayCheckpoint({
      baseState: makeBaseState(),
      sourceCheckpointRevision: 0,
      sourceCheckpointHead: mutationRoot,
      acceptedReceipts: allReceipts,
      throughRevision: 32,
      checkpointTick: 319,
      rules
    }),
    /replay-checkpoint-prefix-command-after-tick:proposal-032/
  );
  assert.throws(
    () => createReplayCheckpoint({
      baseState: makeBaseState(),
      sourceCheckpointRevision: 0,
      sourceCheckpointHead: mutationRoot,
      acceptedReceipts: allReceipts,
      throughRevision: 32,
      checkpointTick: 330,
      rules
    }),
    /replay-checkpoint-suffix-command-at-or-before-tick:proposal-033/
  );

  // The checkpoint digest is an explicit trust input; self-consistency alone is not
  // enough. Tampering state or presenting a different expected digest fails closed.
  const tamperedCheckpoint = structuredClone(serializedCheckpoint);
  tamperedCheckpoint.state.stockMilli += 1;
  assert.throws(
    () => verifyReplayCheckpoint(tamperedCheckpoint, {
      expectedCheckpointDigest: replay.checkpoint.checkpointDigest
    }),
    /replay-checkpoint-state-digest-mismatch/
  );
  assert.throws(
    () => verifyReplayCheckpoint(serializedCheckpoint, {
      expectedCheckpointDigest: 'fnv1a32:00000000'
    }),
    /replay-checkpoint-trust-mismatch/
  );
  assert.throws(
    () => verifyReplayCheckpoint(serializedCheckpoint, {
      expectedCheckpointDigest: replay.checkpoint.checkpointDigest,
      expectedMutationHead: 'wrong-head'
    }),
    /replay-checkpoint-expected-head-mismatch/
  );

  // Missing the first retained receipt cannot be masked by checkpoint adoption.
  assert.throws(
    () => resumeFromReplayCheckpoint({
      checkpoint: serializedCheckpoint,
      expectedCheckpointDigest: replay.checkpoint.checkpointDigest,
      acceptedReceipts: history.receiptsAfter(32).slice(1),
      targetTick,
      rules
    }),
    /receipt-sequence-gap:33/
  );

  console.log('AXM Global State proof 020 replay checkpoint across partial-compaction floor: PASS');
  console.log({
    laggingClientRevision: 10,
    compactionFloorRevision: 32,
    checkpointTick: replay.checkpoint.checkpointTick,
    checkpointAppliedCommandFingerprints: Object.keys(replay.checkpoint.state.appliedCommands).length,
    retainedSuffixReceipts: replay.retainedReceipts.length,
    resumedRevision: resumed.normalizedSuffix.toRevision,
    targetTick,
    finalStateDigest: resumed.digest,
    unsafeEarlyCheckpointRejected: true,
    unsafeLateCheckpointRejected: true,
    tamperedCheckpointRejected: true,
    suffixGapRejected: true
  });
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
