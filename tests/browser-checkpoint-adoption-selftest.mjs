import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';
import {
  createSingleSequencerAuthority,
  normalizeAcceptedReceipts
} from '../src/mutation-agreement.mjs';
import {
  createCheckpointEpoch,
  createEpochBoundSequencerAuthority
} from '../src/checkpoint-epoch.mjs';
import { createCheckpointAdoptionPackage } from '../src/checkpoint-adoption.mjs';
import { advanceCatchup, createState, digestState } from '../src/temporal-state-kernel.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'axm-global-state-proof-020-'));
const userDataDir = path.join(tempDir, 'browser-profile');
const targetTick = 7200;

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8']
]);

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
  completions: Object.freeze([{ id: 'shared-build', atTick: 120, rewardMilli: 25 }])
});

function makeBaseState() {
  return createState(structuredClone(baseStateConfig));
}

const genesisHead = `state:${digestState(makeBaseState())}`;
const genesisEpochId = 'genesis';
const authority = createSingleSequencerAuthority({ checkpointRevision: 0, checkpointHead: genesisHead });

const acceptedA = authority.submit({
  id: 'proposal-a',
  actorId: 'participant-a',
  basedOnRevision: 0,
  basedOnHead: genesisHead,
  command: { atTick: 17, type: 'stock.add', payload: { amountMilli: 31 } }
});

async function startRelay({ port = 0, mode, adoptionPackage = null } = {}) {
  const syncRequests = [];
  let relayFailure = null;

  const httpServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const requested = path.resolve(repoRoot, relative || 'tests/browser-checkpoint-adoption-proof.html');
      if (!(requested === repoRoot || requested.startsWith(`${repoRoot}${path.sep}`))) {
        response.writeHead(403).end('forbidden');
        return;
      }
      const body = await readFile(requested);
      response.writeHead(200, {
        'content-type': mime.get(path.extname(requested)) || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });

  const websocketServer = new WebSocketServer({ server: httpServer, path: '/sync' });
  websocketServer.on('connection', (socket) => {
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message?.type !== 'sync.request' || !Number.isSafeInteger(message.afterRevision)) {
          throw new Error('invalid-sync-request');
        }
        syncRequests.push(structuredClone(message));

        if (mode === 'genesis') {
          assert.equal(message.epochId, genesisEpochId);
          assert.equal(message.afterRevision, 0);
          socket.send(JSON.stringify({ type: 'receipt', receipt: acceptedA.receipt }));
          return;
        }

        if (mode === 'adoption') {
          assert.equal(message.epochId, genesisEpochId, 'lagging browser must identify its retired epoch');
          assert.equal(message.afterRevision, 1, 'lagging browser must report its last verified retired-epoch revision');
          socket.send(JSON.stringify({ type: 'checkpoint.adoption', package: adoptionPackage }));
          return;
        }

        throw new Error(`unexpected-relay-mode:${mode}`);
      } catch (error) {
        relayFailure = error;
        socket.close(1011, 'proof-relay-failure');
      }
    });
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('invalid-relay-address');

  return {
    port: address.port,
    pageUrl: `http://127.0.0.1:${address.port}/tests/browser-checkpoint-adoption-proof.html`,
    websocketUrl: `ws://127.0.0.1:${address.port}/sync`,
    syncRequests,
    failure: () => relayFailure,
    async close() {
      for (const client of websocketServer.clients) client.terminate();
      await new Promise((resolve) => websocketServer.close(resolve));
      await new Promise((resolve) => httpServer.close(resolve));
    }
  };
}

async function runBrowser({ pageUrl, websocketUrl, expectedRevision, expectStatus = 'pass' }) {
  const context = await chromium.launchPersistentContext(userDataDir, { headless: true });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(String(error)));

  await page.goto(pageUrl, { waitUntil: 'load' });
  await page.evaluate((config) => window.__AXM_CHECKPOINT_ADOPTION_PROOF__.configure(config), {
    websocketUrl,
    genesisEpochId,
    genesisCheckpointRevision: 0,
    genesisCheckpointHead: genesisHead,
    expectedRevision,
    baseState: baseStateConfig,
    targetTick,
    rules
  });
  await page.locator(`#status[data-status='${expectStatus}']`).waitFor({ timeout: 30_000 });
  const evidence = await page.evaluate(() => window.__AXM_CHECKPOINT_ADOPTION_PROOF__.evidence());
  const storageSnapshot = await page.evaluate(() => window.__AXM_CHECKPOINT_ADOPTION_PROOF__.storageSnapshot());
  await page.evaluate(() => window.__AXM_CHECKPOINT_ADOPTION_PROOF__.close());
  if (expectStatus === 'pass') assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join(' | ')}`);
  await context.close();
  return { evidence, storageSnapshot };
}

let firstRelay = null;
let secondRelay = null;

try {
  // Process 1: the browser verifies only R1 in the old genesis epoch and exits.
  firstRelay = await startRelay({ mode: 'genesis' });
  const stablePort = firstRelay.port;
  const first = await runBrowser({
    pageUrl: firstRelay.pageUrl,
    websocketUrl: firstRelay.websocketUrl,
    expectedRevision: 1
  });
  if (firstRelay.failure()) throw firstRelay.failure();
  assert.equal(first.evidence.activeKind, 'genesis');
  assert.equal(first.evidence.normalizedRevision, 1);
  assert.equal(first.evidence.restoredAdoptionPackage, false);
  assert.equal(first.evidence.receiptsReceivedThisProcess, 1);
  assert.match(first.storageSnapshot, /genesis-receipts/);
  await firstRelay.close();
  firstRelay = null;

  // While the browser is absent, genesis advances through R3 and then compacts.
  const checkpointA = authority.checkpoint();
  const acceptedB = authority.submit({
    id: 'proposal-b',
    actorId: 'participant-b',
    basedOnRevision: checkpointA.revision,
    basedOnHead: checkpointA.head,
    command: { atTick: 90, type: 'rate.set', payload: { ratePerTickMilli: 5 } }
  });
  const checkpointB = authority.checkpoint();
  const acceptedC = authority.submit({
    id: 'proposal-c',
    actorId: 'participant-c',
    basedOnRevision: checkpointB.revision,
    basedOnHead: checkpointB.head,
    command: { atTick: 3600, type: 'stock.add', payload: { amountMilli: 11 } }
  });
  const checkpointC = authority.checkpoint();
  assert.equal(checkpointC.revision, 3);

  const genesisHistory = normalizeAcceptedReceipts(authority.receipts(), {
    checkpointRevision: 0,
    checkpointHead: genesisHead
  });
  const stateAtCheckpoint = advanceCatchup(makeBaseState(), 3600, {
    commands: genesisHistory.commands,
    rules
  });
  const epoch = createCheckpointEpoch({
    checkpointRevision: checkpointC.revision,
    checkpointHead: checkpointC.head,
    state: stateAtCheckpoint,
    priorEpochId: genesisEpochId
  });

  const epochAuthority = createEpochBoundSequencerAuthority({
    checkpointRevision: epoch.checkpointRevision,
    checkpointHead: epoch.checkpointHead,
    epochId: epoch.epochId
  });
  const acceptedD = epochAuthority.submit({
    epochId: epoch.epochId,
    id: 'proposal-a',
    actorId: 'participant-a',
    basedOnRevision: epoch.checkpointRevision,
    basedOnHead: epoch.checkpointHead,
    command: { atTick: 4000, type: 'stock.add', payload: { amountMilli: 7 } }
  });
  assert.equal(acceptedD.receipt.sequence, 4);

  const adoptionPackage = createCheckpointAdoptionPackage({
    epoch,
    acceptedReceipts: epochAuthority.receipts()
  });
  assert.equal(adoptionPackage.targetRevision, 4);
  const packageText = JSON.stringify(adoptionPackage);
  assert.ok(!packageText.includes('proposal-b'));
  assert.ok(!packageText.includes('proposal-c'));

  const uninterrupted = advanceCatchup(makeBaseState(), targetTick, {
    commands: [...genesisHistory.commands, {
      id: acceptedD.receipt.proposalId,
      ...structuredClone(acceptedD.receipt.command)
    }],
    rules
  });
  const expectedDigest = digestState(uninterrupted);
  assert.equal(expectedDigest, 'fnv1a32:ba4ed3fc');

  // Process 2: same browser profile wakes on retired genesis revision 1. The
  // relay sends a checkpoint-adoption package instead of pretending R4 alone can
  // bridge the missing compacted revisions 2-3.
  secondRelay = await startRelay({ port: stablePort, mode: 'adoption', adoptionPackage });
  const second = await runBrowser({
    pageUrl: secondRelay.pageUrl,
    websocketUrl: secondRelay.websocketUrl,
    expectedRevision: 4
  });
  if (secondRelay.failure()) throw secondRelay.failure();
  assert.equal(second.evidence.restoredReceiptCount, 1);
  assert.equal(second.evidence.adoptionReceivedThisProcess, true);
  assert.equal(second.evidence.restoredAdoptionPackage, false);
  assert.deepEqual(second.evidence.syncRequests, [{
    type: 'sync.request',
    epochId: genesisEpochId,
    afterRevision: 1
  }]);
  assert.equal(second.evidence.activeKind, 'adopted-epoch');
  assert.equal(second.evidence.activeEpochId, epoch.epochId);
  assert.equal(second.evidence.activeCheckpointRevision, 3);
  assert.equal(second.evidence.activeCheckpointTick, 3600);
  assert.equal(second.evidence.normalizedRevision, 4);
  assert.equal(second.evidence.retainedReceiptCount, 1);
  assert.deepEqual(second.evidence.state, uninterrupted);
  assert.equal(second.evidence.digest, expectedDigest);
  assert.match(second.storageSnapshot, /checkpoint-adoption/);
  assert.ok(!second.storageSnapshot.includes('proposal-b'));
  assert.ok(!second.storageSnapshot.includes('proposal-c'));

  // Process 3: another completely fresh Chromium process re-verifies the stored
  // adoption package and reconstructs without needing any network request.
  const requestCountBeforeThird = secondRelay.syncRequests.length;
  const third = await runBrowser({
    pageUrl: secondRelay.pageUrl,
    websocketUrl: secondRelay.websocketUrl,
    expectedRevision: 4
  });
  assert.equal(secondRelay.syncRequests.length, requestCountBeforeThird, 'restored adopted state should not require another sync at the same target revision');
  assert.equal(third.evidence.restoredAdoptionPackage, true);
  assert.equal(third.evidence.adoptionReceivedThisProcess, false);
  assert.deepEqual(third.evidence.syncRequests, []);
  assert.equal(third.evidence.activeEpochId, epoch.epochId);
  assert.equal(third.evidence.normalizedRevision, 4);
  assert.equal(third.evidence.digest, expectedDigest);

  // Tamper persistent browser storage, then start a fourth Chromium process. It
  // must re-verify and fail rather than trusting its own disk.
  const tamperContext = await chromium.launchPersistentContext(userDataDir, { headless: true });
  const tamperPage = await tamperContext.newPage();
  await tamperPage.goto(secondRelay.pageUrl, { waitUntil: 'load' });
  await tamperPage.evaluate(() => {
    const key = window.__AXM_CHECKPOINT_ADOPTION_PROOF__.storageKey;
    const stored = JSON.parse(localStorage.getItem(key));
    stored.package.epoch.compactedState.stockMilli += 1;
    localStorage.setItem(key, JSON.stringify(stored));
  });
  await tamperContext.close();

  const fourth = await runBrowser({
    pageUrl: secondRelay.pageUrl,
    websocketUrl: secondRelay.websocketUrl,
    expectedRevision: 4,
    expectStatus: 'fail'
  });
  assert.match(fourth.evidence.error, /checkpoint-epoch-compacted-state-digest-mismatch/);

  console.log('AXM Global State proof 020 Chromium checkpoint adoption: PASS');
  console.log({
    browserProcesses: 4,
    retiredEpochId: genesisEpochId,
    laggingRevisionBeforeAdoption: 1,
    adoptedCheckpointRevision: 3,
    adoptedCheckpointTick: 3600,
    adoptedEpochId: epoch.epochId,
    adoptedRevision: 4,
    retainedSuffixReceipts: second.evidence.retainedReceiptCount,
    oldCompactedReceiptPayloadsTransferred: false,
    persistedAdoptionReverifiedAfterRestart: true,
    persistedCheckpointTamperRejected: true,
    finalStateDigest: expectedDigest
  });
} finally {
  if (firstRelay) await firstRelay.close().catch(() => {});
  if (secondRelay) await secondRelay.close().catch(() => {});
  await rm(tempDir, { recursive: true, force: true });
}
