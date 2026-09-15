import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFileReceiptHistory } from '../src/durable-receipt-history.mjs';
import {
  createSingleSequencerAuthority,
  normalizeAcceptedReceipts
} from '../src/mutation-agreement.mjs';
import { advanceCatchup, createState, digestState } from '../src/temporal-state-kernel.mjs';

const childScript = fileURLToPath(new URL('./receipt-authority-service-child.mjs', import.meta.url));
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'axm-global-state-proof-009-'));
const historyPath = path.join(tempDir, 'accepted-history.json');

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

const proposalA = Object.freeze({
  id: 'proposal-a',
  actorId: 'participant-a',
  basedOnRevision: 0,
  basedOnHead: checkpointHead,
  command: Object.freeze({
    atTick: 17,
    type: 'stock.add',
    payload: Object.freeze({ amountMilli: 31 })
  })
});

function startService({ serviceHistoryPath = historyPath, extraEnv = {} } = {}) {
  const child = fork(childScript, [], {
    env: {
      ...process.env,
      AXM_RECEIPT_HISTORY_FILE: serviceHistoryPath,
      AXM_CHECKPOINT_REVISION: '0',
      AXM_CHECKPOINT_HEAD: checkpointHead,
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let requestCounter = 0;
  const pending = new Map();
  let capturedStderr = '';
  child.stderr.on('data', (chunk) => { capturedStderr += chunk.toString(); });

  const ready = new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (message?.type === 'ready') {
        child.off('message', onMessage);
        resolve(message);
      }
    };
    child.on('message', onMessage);
    child.once('exit', (code, signal) => {
      reject(new Error(`service-exited-before-ready:${code}:${signal}:${capturedStderr}`));
    });
  });

  child.on('message', (message) => {
    if (message?.type !== 'response') return;
    const entry = pending.get(message.requestId);
    if (!entry) return;
    pending.delete(message.requestId);
    clearTimeout(entry.timer);
    entry.resolve(message);
  });

  function request(type, payload = {}) {
    requestCounter += 1;
    const requestId = `request-${requestCounter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`service-request-timeout:${type}`));
      }, 10_000);
      pending.set(requestId, { resolve, reject, timer });
      child.send({ type, requestId, ...payload });
    });
  }

  async function killHard() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGKILL');
    await exited;
  }

  async function shutdown() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    const response = await request('shutdown');
    assert.equal(response.ok, true);
    await exited;
  }

  return { child, ready, request, killHard, shutdown, stderr: () => capturedStderr };
}

try {
  const firstService = startService();
  const firstReady = await firstService.ready;
  assert.deepEqual(firstReady.checkpoint, { schema: 'axm.global-state.mutation-agreement/single-sequencer-v0', revision: 0, head: checkpointHead });
  assert.equal(firstReady.retainedReceipts, 0);

  const acceptedA = await firstService.request('proposal.submit', { proposal: proposalA });
  assert.equal(acceptedA.ok, true);
  assert.equal(acceptedA.result.duplicate, false);
  assert.equal(acceptedA.result.persisted.duplicate, false);
  assert.equal(acceptedA.result.checkpoint.revision, 1);
  const receiptA = acceptedA.result.receipt;

  // Abruptly remove the whole authority process after its durable acknowledgement.
  await firstService.killHard();

  const secondService = startService();
  const secondReady = await secondService.ready;
  assert.equal(secondReady.checkpoint.revision, 1);
  assert.equal(secondReady.checkpoint.head, receiptA.acceptedHead);
  assert.equal(secondReady.retainedReceipts, 1);

  // Exact retry after restart must remain idempotent even though the proposal is
  // based on revision 0. The restored proposal-ID evidence is checked before the
  // stale-head rule, just as it was before process loss.
  const duplicateA = await secondService.request('proposal.submit', { proposal: proposalA });
  assert.equal(duplicateA.ok, true);
  assert.equal(duplicateA.result.duplicate, true);
  assert.equal(duplicateA.result.persisted.duplicate, true);
  assert.deepEqual(duplicateA.result.receipt, receiptA);
  assert.equal(duplicateA.result.checkpoint.revision, 1);

  const conflictingA = await secondService.request('proposal.submit', {
    proposal: {
      ...structuredClone(proposalA),
      command: { atTick: 17, type: 'stock.add', payload: { amountMilli: 999 } }
    }
  });
  assert.equal(conflictingA.ok, false);
  assert.match(conflictingA.error, /proposal-id-conflict:proposal-a/);

  const checkpointAfterA = duplicateA.result.checkpoint;
  const proposalB = {
    id: 'proposal-b',
    actorId: 'participant-b',
    basedOnRevision: checkpointAfterA.revision,
    basedOnHead: checkpointAfterA.head,
    command: { atTick: 90, type: 'rate.set', payload: { ratePerTickMilli: 5 } }
  };
  const acceptedB = await secondService.request('proposal.submit', { proposal: proposalB });
  assert.equal(acceptedB.ok, true);
  assert.equal(acceptedB.result.duplicate, false);
  assert.equal(acceptedB.result.checkpoint.revision, 2);
  const receiptB = acceptedB.result.receipt;

  const onlyAfterOne = await secondService.request('receipts.after', { revision: 1 });
  assert.equal(onlyAfterOne.ok, true);
  assert.deepEqual(onlyAfterOne.result.receipts, [receiptB]);

  await secondService.killHard();

  const thirdService = startService();
  const thirdReady = await thirdService.ready;
  assert.equal(thirdReady.checkpoint.revision, 2);
  assert.equal(thirdReady.checkpoint.head, receiptB.acceptedHead);
  assert.equal(thirdReady.retainedReceipts, 2);

  const fullHistory = await thirdService.request('receipts.after', { revision: 0 });
  assert.equal(fullHistory.ok, true);
  assert.deepEqual(fullHistory.result.receipts, [receiptA, receiptB]);
  const afterOneAgain = await thirdService.request('receipts.after', { revision: 1 });
  assert.deepEqual(afterOneAgain.result.receipts, [receiptB]);
  const afterTwo = await thirdService.request('receipts.after', { revision: 2 });
  assert.deepEqual(afterTwo.result.receipts, []);

  const normalized = normalizeAcceptedReceipts(fullHistory.result.receipts, {
    checkpointRevision: 0,
    checkpointHead
  });
  const finalState = advanceCatchup(makeBaseState(), 3600, {
    commands: normalized.commands,
    rules
  });
  assert.equal(digestState(finalState), 'fnv1a32:bab65c1b');

  await thirdService.shutdown();

  // Persisted accepted history must fail closed if bytes are changed without a
  // matching accepted receipt head.
  const durableDocument = JSON.parse(await readFile(historyPath, 'utf8'));
  const corruptPath = path.join(tempDir, 'corrupt-history.json');
  const corruptDocument = structuredClone(durableDocument);
  corruptDocument.receipts[0].command.payload.amountMilli = 999;
  await writeFile(corruptPath, JSON.stringify(corruptDocument), 'utf8');
  await assert.rejects(
    () => openFileReceiptHistory({ filePath: corruptPath, checkpointRevision: 0, checkpointHead }),
    /receipt-digest-mismatch:1/
  );

  // Concurrency regression: construct the expected R1 head locally, then send
  // R1 and a correctly rebased R2 request without awaiting R1. The child proof
  // service deliberately delays first-proposal persistence. An async but
  // unserialized sequencer lets R2 race into a history that does not yet contain
  // R1; the explicit request queue must keep admission + persistence ordered.
  const previewAuthority = createSingleSequencerAuthority({ checkpointRevision: 0, checkpointHead });
  const previewReceiptA = previewAuthority.submit(proposalA).receipt;
  const concurrentProposalB = Object.freeze({
    id: 'proposal-concurrent-b',
    actorId: 'participant-b',
    basedOnRevision: 1,
    basedOnHead: previewReceiptA.acceptedHead,
    command: Object.freeze({
      atTick: 90,
      type: 'rate.set',
      payload: Object.freeze({ ratePerTickMilli: 5 })
    })
  });
  const concurrentHistoryPath = path.join(tempDir, 'concurrent-history.json');
  const concurrentService = startService({
    serviceHistoryPath: concurrentHistoryPath,
    extraEnv: { AXM_TEST_FIRST_PROPOSAL_PERSIST_DELAY_MS: '75' }
  });
  await concurrentService.ready;
  const concurrentARequest = concurrentService.request('proposal.submit', { proposal: proposalA });
  const concurrentBRequest = concurrentService.request('proposal.submit', { proposal: concurrentProposalB });
  const [concurrentA, concurrentB] = await Promise.all([concurrentARequest, concurrentBRequest]);
  assert.equal(concurrentA.ok, true, concurrentA.error);
  assert.equal(concurrentB.ok, true, concurrentB.error);
  assert.equal(concurrentA.result.checkpoint.revision, 1);
  assert.equal(concurrentB.result.checkpoint.revision, 2);
  assert.deepEqual(concurrentA.result.receipt, previewReceiptA);
  await concurrentService.killHard();

  const concurrentRecovered = startService({ serviceHistoryPath: concurrentHistoryPath });
  const concurrentReady = await concurrentRecovered.ready;
  assert.equal(concurrentReady.checkpoint.revision, 2, 'latest acknowledged concurrent revision must survive hard restart');
  assert.equal(concurrentReady.retainedReceipts, 2);
  const concurrentReceipts = await concurrentRecovered.request('receipts.after', { revision: 0 });
  assert.equal(concurrentReceipts.ok, true);
  assert.deepEqual(
    concurrentReceipts.result.receipts.map((receipt) => receipt.proposalId),
    ['proposal-a', 'proposal-concurrent-b']
  );
  await concurrentRecovered.shutdown();

  console.log('AXM Global State proof 009 durable receipt authority restart: PASS');
  console.log({
    authorityProcesses: 5,
    hardRestarts: 3,
    retainedReceipts: normalized.receipts.length,
    recoveredRevision: normalized.toRevision,
    recoveredHead: normalized.head,
    duplicateProposalAfterRestart: true,
    conflictAfterRestartRejected: true,
    concurrentSubmitSerialized: true,
    concurrentRecoveredRevision: concurrentReady.checkpoint.revision,
    finalStateDigest: digestState(finalState)
  });
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
