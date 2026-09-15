import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createCheckpointEpoch,
  createEpochBoundSequencerAuthority,
  normalizeEpochAcceptedReceipts
} from '../src/checkpoint-epoch.mjs';
import {
  initializeDurableCheckpointStore,
  openDurableCheckpointStore
} from '../src/durable-checkpoint-store.mjs';
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

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'axm-global-state-proof-018-'));
const storeDirectory = path.join(tempDir, 'checkpoint-store');

try {
  const baseState = makeBaseState();
  const genesisHead = `state:${digestState(baseState)}`;
  const epoch0 = createCheckpointEpoch({
    checkpointRevision: 0,
    checkpointHead: genesisHead,
    state: baseState,
    priorEpochId: 'root'
  });
  const authority0 = createEpochBoundSequencerAuthority({
    checkpointRevision: 0,
    checkpointHead: genesisHead,
    epochId: epoch0.epochId
  });

  const acceptedA = authority0.submit({
    epochId: epoch0.epochId,
    id: 'proposal-a',
    actorId: 'participant-a',
    basedOnRevision: 0,
    basedOnHead: genesisHead,
    command: { atTick: 17, type: 'stock.add', payload: { amountMilli: 31 } }
  });
  const checkpointA = authority0.checkpoint();
  authority0.submit({
    epochId: epoch0.epochId,
    id: 'proposal-b',
    actorId: 'participant-b',
    basedOnRevision: checkpointA.revision,
    basedOnHead: checkpointA.head,
    command: { atTick: 90, type: 'rate.set', payload: { ratePerTickMilli: 5 } }
  });
  const checkpointB = authority0.checkpoint();
  authority0.submit({
    epochId: epoch0.epochId,
    id: 'proposal-c',
    actorId: 'participant-c',
    basedOnRevision: checkpointB.revision,
    basedOnHead: checkpointB.head,
    command: { atTick: 3600, type: 'stock.add', payload: { amountMilli: 11 } }
  });

  const oldCheckpoint = authority0.checkpoint();
  assert.equal(oldCheckpoint.revision, 3);
  const oldHistory = normalizeEpochAcceptedReceipts(authority0.receipts(), {
    checkpointRevision: 0,
    checkpointHead: genesisHead,
    epochId: epoch0.epochId
  });
  const stateAtRotation = advanceCatchup(structuredClone(epoch0.compactedState), 3600, {
    commands: oldHistory.commands,
    rules
  });
  const epoch1 = createCheckpointEpoch({
    checkpointRevision: oldCheckpoint.revision,
    checkpointHead: oldCheckpoint.head,
    state: stateAtRotation,
    priorEpochId: epoch0.epochId
  });
  assert.equal(epoch1.retiredCommandCount, 3);

  let store = await initializeDurableCheckpointStore({
    directory: storeDirectory,
    epoch: epoch0,
    receipts: authority0.receipts()
  });
  const oldGenerationId = store.generationId();
  assert.equal(store.checkpoint().currentRevision, 3);
  assert.equal(store.snapshot().receipts.length, 3);

  // Prepare two equivalent rotations while the old generation is current.
  // Neither staged generation is canonical until CURRENT.json changes.
  const preparedGood = await store.prepareRotation({ epoch: epoch1, receipts: [] });
  const preparedStale = await store.prepareRotation({ epoch: epoch1, receipts: [] });
  const pointerBeforeCommit = JSON.parse(await readFile(path.join(storeDirectory, 'CURRENT.json'), 'utf8'));
  assert.equal(pointerBeforeCommit.generationId, oldGenerationId);

  // Process-loss boundary before pointer switch: discard the store object and
  // reopen from disk. The complete old epoch must remain canonical even though
  // new immutable generation files already exist.
  store = await openDurableCheckpointStore({ directory: storeDirectory });
  assert.equal(store.generationId(), oldGenerationId);
  assert.equal(store.checkpoint().currentRevision, 3);
  assert.equal(store.snapshot().epoch.epochId, epoch0.epochId);
  assert.equal(store.snapshot().receipts.length, 3);

  // A tampered staged generation cannot become current.
  const preparedTampered = await store.prepareRotation({ epoch: epoch1, receipts: [] });
  const tamperedGenerationPath = path.join(
    storeDirectory,
    'generations',
    `${preparedTampered.generationId}.json`
  );
  const tamperedDocument = JSON.parse(await readFile(tamperedGenerationPath, 'utf8'));
  tamperedDocument.epoch.compactedState.stockMilli += 1;
  await writeFile(tamperedGenerationPath, `${JSON.stringify(tamperedDocument)}\n`, 'utf8');
  await assert.rejects(
    () => store.commitPreparedRotation(preparedTampered),
    /checkpoint-epoch-compacted-state-digest-mismatch/
  );
  assert.equal(store.generationId(), oldGenerationId);
  assert.equal(
    JSON.parse(await readFile(path.join(storeDirectory, 'CURRENT.json'), 'utf8')).generationId,
    oldGenerationId
  );

  // Commit the good generation. This one atomic pointer replacement is the
  // canonical transition boundary.
  await store.commitPreparedRotation(preparedGood);
  const newGenerationId = store.generationId();
  assert.equal(newGenerationId, preparedGood.generationId);
  assert.notEqual(newGenerationId, oldGenerationId);
  assert.equal(store.snapshot().epoch.epochId, epoch1.epochId);
  assert.equal(store.snapshot().receipts.length, 0);
  assert.equal(store.checkpoint().checkpointRevision, 3);
  assert.equal(store.checkpoint().currentRevision, 3);

  // Process-loss boundary immediately after pointer switch: a fresh opener must
  // see the complete new epoch without needing any RAM from the committer.
  store = await openDurableCheckpointStore({ directory: storeDirectory });
  assert.equal(store.generationId(), newGenerationId);
  assert.equal(store.snapshot().epoch.epochId, epoch1.epochId);
  assert.equal(store.snapshot().receipts.length, 0);
  assert.equal(store.snapshot().epoch.compactedState.tick, 3600);
  assert.equal(Object.keys(store.snapshot().epoch.compactedState.appliedCommands).length, 0);

  // Another generation prepared against the old pointer cannot later overwrite
  // the committed new current generation.
  await assert.rejects(
    () => store.commitPreparedRotation(preparedStale),
    /checkpoint-prepared-stale-base/
  );
  assert.equal(store.generationId(), newGenerationId);

  // Continue mutation history from the recovered compacted epoch and persist it
  // through the same generation-pointer mechanism.
  const authority1 = store.restoreAuthority();
  const currentCheckpoint = authority1.checkpoint();
  const acceptedNew = authority1.submit({
    epochId: epoch1.epochId,
    id: 'proposal-a',
    actorId: 'participant-a',
    basedOnRevision: currentCheckpoint.revision,
    basedOnHead: currentCheckpoint.head,
    command: { atTick: 4000, type: 'stock.add', payload: { amountMilli: 7 } }
  });
  assert.equal(acceptedNew.receipt.sequence, 4);
  await store.appendReceipt(acceptedNew.receipt);
  const receiptGenerationId = store.generationId();
  assert.notEqual(receiptGenerationId, newGenerationId);
  assert.equal(store.checkpoint().currentRevision, 4);
  assert.equal(store.snapshot().receipts.length, 1);

  // Restart after normal append and verify the current package remains enough to
  // restore authority and reconstruct the same future physical state.
  store = await openDurableCheckpointStore({ directory: storeDirectory });
  assert.equal(store.generationId(), receiptGenerationId);
  assert.equal(store.checkpoint().currentRevision, 4);
  const restoredReceipts = store.receiptsAfter(3);
  assert.equal(restoredReceipts.length, 1);
  assert.deepEqual(restoredReceipts[0], acceptedNew.receipt);

  const currentHistory = normalizeEpochAcceptedReceipts(store.snapshot().receipts, {
    checkpointRevision: epoch1.checkpointRevision,
    checkpointHead: epoch1.checkpointHead,
    epochId: epoch1.epochId
  });
  const compactedFuture = advanceCatchup(structuredClone(epoch1.compactedState), 7200, {
    commands: currentHistory.commands,
    rules
  });
  const uncompactedReference = advanceCatchup(structuredClone(epoch0.compactedState), 7200, {
    commands: [...oldHistory.commands, ...currentHistory.commands],
    rules
  });
  assert.deepEqual(physicalState(compactedFuture), physicalState(uncompactedReference));

  // Sanity: old identity really was different from the reused local ID in epoch1.
  assert.notEqual(acceptedA.receipt.proposalId, acceptedNew.receipt.proposalId);

  console.log('AXM Global State proof 018 durable checkpoint rotation: PASS');
  console.log({
    oldGenerationId,
    stagedBeforeCommitVisibleAsCurrent: false,
    preCommitRestartRecoveredEpoch: epoch0.epochId,
    newGenerationId,
    postCommitRestartRecoveredEpoch: epoch1.epochId,
    tamperedPreparedGenerationRejected: true,
    stalePreparedGenerationRejected: true,
    receiptGenerationId,
    recoveredRevision: store.checkpoint().currentRevision,
    retainedReceiptsAfterCompaction: store.snapshot().receipts.length,
    physicalStatePreserved: true
  });
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
