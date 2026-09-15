import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  compactAcceptedReceiptWindow,
  createCompactedFileReceiptHistory,
  openCompactedFileReceiptHistory
} from '../src/compacted-receipt-history.mjs';
import { createSingleSequencerAuthority } from '../src/mutation-agreement.mjs';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'axm-global-state-proof-018-'));
const compactedPath = path.join(tempDir, 'compacted-history.json');
const corruptPath = path.join(tempDir, 'corrupt-compacted-history.json');
const checkpointHead = 'proof-018:mutation-root';

function buildHistory(count = 40) {
  const authority = createSingleSequencerAuthority({ checkpointRevision: 0, checkpointHead });
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
        type: 'proof.large-payload',
        payload: Object.freeze({
          index,
          marker: `payload-${index}`,
          padding: `${String(index).padStart(3, '0')}:${'x'.repeat(2048)}`
        })
      })
    });
    proposals.push(proposal);
    receipts.push(authority.submit(proposal).receipt);
  }
  return { proposals, receipts, checkpoint: authority.checkpoint() };
}

try {
  const full = buildHistory();
  assert.equal(full.checkpoint.revision, 40);

  assert.throws(
    () => compactAcceptedReceiptWindow({
      checkpointRevision: 0,
      checkpointHead,
      acceptedReceipts: full.receipts,
      throughRevision: 0
    }),
    /compaction-must-advance-checkpoint/
  );
  assert.throws(
    () => compactAcceptedReceiptWindow({
      checkpointRevision: 0,
      checkpointHead,
      acceptedReceipts: full.receipts,
      throughRevision: 41
    }),
    /compaction-through-future-revision/
  );

  const history = await createCompactedFileReceiptHistory({
    filePath: compactedPath,
    checkpointRevision: 0,
    checkpointHead,
    acceptedReceipts: full.receipts,
    throughRevision: 32
  });

  const compactCheckpoint = history.compactionCheckpoint();
  assert.equal(compactCheckpoint.revision, 32);
  assert.equal(compactCheckpoint.head, full.receipts[31].acceptedHead);
  assert.equal(compactCheckpoint.evidenceFloorRevision, 1);
  assert.equal(history.compactedEvidence().length, 32);
  assert.equal(history.allReceipts().length, 8);
  assert.equal(history.checkpoint().revision, 40);
  assert.equal(history.checkpoint().head, full.receipts[39].acceptedHead);

  const fullReceiptBytes = Buffer.byteLength(JSON.stringify(full.receipts), 'utf8');
  const compactedBytes = Buffer.byteLength(await readFile(compactedPath, 'utf8'), 'utf8');
  assert.ok(
    compactedBytes < fullReceiptBytes * 0.5,
    `fixture should demonstrate payload compaction (${compactedBytes} vs ${fullReceiptBytes})`
  );

  let restoredAuthority = history.restoreAuthority();

  const oldDuplicate = restoredAuthority.submit(full.proposals[5]);
  assert.equal(oldDuplicate.accepted, true);
  assert.equal(oldDuplicate.duplicate, true);
  assert.equal(oldDuplicate.compacted, true);
  assert.deepEqual(oldDuplicate.receipt, full.receipts[5]);
  const oldDuplicatePersist = await history.append(oldDuplicate.receipt);
  assert.equal(oldDuplicatePersist.duplicate, true);
  assert.equal(history.checkpoint().revision, 40);

  const forgedOldReceipt = structuredClone(full.receipts[5]);
  forgedOldReceipt.command.payload.marker = 'forged-direct-append';
  await assert.rejects(
    () => history.append(forgedOldReceipt),
    /compacted-receipt-append-conflict/
  );

  await assert.rejects(
    async () => restoredAuthority.submit({
      ...structuredClone(full.proposals[5]),
      command: {
        ...structuredClone(full.proposals[5].command),
        payload: { index: 6, marker: 'conflict', padding: 'different' }
      }
    }),
    /proposal-id-conflict:proposal-006/
  );

  const tailDuplicate = restoredAuthority.submit(full.proposals[35]);
  assert.equal(tailDuplicate.duplicate, true);
  assert.equal(tailDuplicate.compacted, undefined);
  assert.deepEqual(tailDuplicate.receipt, full.receipts[35]);

  const beforeNew = restoredAuthority.checkpoint();
  const proposal41 = {
    id: 'proposal-041',
    actorId: 'actor-new',
    basedOnRevision: beforeNew.revision,
    basedOnHead: beforeNew.head,
    command: {
      atTick: 410,
      type: 'proof.large-payload',
      payload: { index: 41, marker: 'new-after-compaction', padding: 'z'.repeat(256) }
    }
  };
  const accepted41 = restoredAuthority.submit(proposal41);
  assert.equal(accepted41.receipt.sequence, 41);
  const persisted41 = await history.append(accepted41.receipt);
  assert.equal(persisted41.duplicate, false);
  assert.equal(persisted41.revision, 41);

  assert.throws(() => history.receiptsAfter(31), /receipts-before-compaction-floor:32/);
  const suffixAfterCheckpoint = history.receiptsAfter(32);
  assert.equal(suffixAfterCheckpoint.length, 9);
  assert.equal(suffixAfterCheckpoint[0].sequence, 33);
  assert.equal(suffixAfterCheckpoint.at(-1).sequence, 41);

  const reopened = await openCompactedFileReceiptHistory({
    filePath: compactedPath,
    checkpointRevision: compactCheckpoint.revision,
    checkpointHead: compactCheckpoint.head,
    evidenceFloorRevision: compactCheckpoint.evidenceFloorRevision,
    proposalEvidenceDigest: compactCheckpoint.proposalEvidenceDigest
  });
  assert.equal(reopened.checkpoint().revision, 41);
  assert.equal(reopened.compactedEvidence().length, 32);
  assert.equal(reopened.allReceipts().length, 9);

  restoredAuthority = reopened.restoreAuthority();
  const oldDuplicateAfterRestart = restoredAuthority.submit(full.proposals[5]);
  assert.equal(oldDuplicateAfterRestart.duplicate, true);
  assert.equal(oldDuplicateAfterRestart.compacted, true);
  assert.deepEqual(oldDuplicateAfterRestart.receipt, full.receipts[5]);
  const newDuplicateAfterRestart = restoredAuthority.submit(proposal41);
  assert.equal(newDuplicateAfterRestart.duplicate, true);
  assert.equal(newDuplicateAfterRestart.receipt.sequence, 41);

  assert.throws(
    () => restoredAuthority.submit({
      ...structuredClone(full.proposals[5]),
      actorId: 'different-actor'
    }),
    /proposal-id-conflict:proposal-006/
  );

  const corrupt = JSON.parse(await readFile(compactedPath, 'utf8'));
  corrupt.compactedProposalEvidence[0].proposalFingerprint = 'fnv1a32:00000000';
  await writeFile(corruptPath, JSON.stringify(corrupt), 'utf8');
  await assert.rejects(
    () => openCompactedFileReceiptHistory({
      filePath: corruptPath,
      checkpointRevision: compactCheckpoint.revision,
      checkpointHead: compactCheckpoint.head,
      evidenceFloorRevision: compactCheckpoint.evidenceFloorRevision,
      proposalEvidenceDigest: compactCheckpoint.proposalEvidenceDigest
    }),
    /compacted-evidence-digest-mismatch/
  );

  console.log('AXM Global State proof 018 partial receipt payload compaction: PASS');
  console.log({
    sourceReceipts: full.receipts.length,
    compactedThroughRevision: compactCheckpoint.revision,
    compactedProposalEvidenceEntries: reopened.compactedEvidence().length,
    retainedReceiptPayloads: reopened.allReceipts().length,
    currentRevision: reopened.checkpoint().revision,
    oldExactRetryReconstructed: true,
    oldConflictRejected: true,
    forgedDirectAppendRejected: true,
    preCheckpointSuffixRequestRejected: true,
    fullReceiptBytes,
    compactedBytes,
    byteRatio: Number((compactedBytes / fullReceiptBytes).toFixed(3))
  });
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
