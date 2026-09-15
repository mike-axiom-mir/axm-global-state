import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';
import { createCompactedFileReceiptHistory } from '../src/compacted-receipt-history.mjs';
import {
  createSingleSequencerAuthority,
  normalizeAcceptedReceipts
} from '../src/mutation-agreement.mjs';
import { createReplayCheckpoint } from '../src/replay-checkpoint.mjs';
import { advanceCatchup, createState, digestState } from '../src/temporal-state-kernel.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'axm-global-state-proof-022-'));
const compactedPath = path.join(tempDir, 'compacted-history.json');
const userDataDir = path.join(tempDir, 'browser-profile');
const mutationRoot = 'proof-022:mutation-root';
const targetTick = 600;

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
    receipts.push(authority.submit(proposal).receipt);
  }
  return { authority, receipts };
}

async function startRelay({ port = 0, mode, initialReceipts = [], checkpoint = null, suffixReceipts = [] } = {}) {
  const syncRequests = [];
  let relayFailure = null;
  const httpServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const requested = path.resolve(repoRoot, relative || 'tests/browser-partial-replay-checkpoint-proof.html');
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

        if (mode === 'initial') {
          assert.equal(message.afterRevision, 0);
          for (const receipt of initialReceipts) {
            socket.send(JSON.stringify({ type: 'receipt', receipt }));
          }
          return;
        }

        if (mode === 'checkpoint') {
          assert.equal(message.afterRevision, 10, 'lagging browser must report its last verified pre-floor revision');
          socket.send(JSON.stringify({
            type: 'replay.checkpoint',
            checkpoint,
            suffixReceipts
          }));
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
    pageUrl: `http://127.0.0.1:${address.port}/tests/browser-partial-replay-checkpoint-proof.html`,
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

async function runBrowser({
  pageUrl,
  websocketUrl,
  expectedRevision,
  trustedReplayCheckpointDigest,
  expectedReplayMutationRevision,
  expectedReplayMutationHead,
  expectStatus = 'pass'
}) {
  const context = await chromium.launchPersistentContext(userDataDir, { headless: true });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(String(error)));

  await page.goto(pageUrl, { waitUntil: 'load' });
  await page.evaluate((config) => window.__AXM_PARTIAL_REPLAY_PROOF__.configure(config), {
    websocketUrl,
    sourceCheckpointRevision: 0,
    sourceCheckpointHead: mutationRoot,
    expectedRevision,
    baseState: baseStateConfig,
    targetTick,
    rules,
    trustedReplayCheckpointDigest,
    expectedReplayMutationRevision,
    expectedReplayMutationHead
  });
  await page.locator(`#status[data-status='${expectStatus}']`).waitFor({ timeout: 30_000 });
  const evidence = await page.evaluate(() => window.__AXM_PARTIAL_REPLAY_PROOF__.evidence());
  const storageSnapshot = await page.evaluate(() => window.__AXM_PARTIAL_REPLAY_PROOF__.storageSnapshot());
  await page.evaluate(() => window.__AXM_PARTIAL_REPLAY_PROOF__.close());
  if (expectStatus === 'pass') assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join(' | ')}`);
  await context.close();
  return { evidence, storageSnapshot };
}

let firstRelay = null;
let secondRelay = null;

try {
  const built = buildHistory();

  // Browser process 1 learns only revisions 1-10 and then disappears.
  firstRelay = await startRelay({
    mode: 'initial',
    initialReceipts: built.receipts.slice(0, 10)
  });
  const stablePort = firstRelay.port;
  const first = await runBrowser({
    pageUrl: firstRelay.pageUrl,
    websocketUrl: firstRelay.websocketUrl,
    expectedRevision: 10,
    trustedReplayCheckpointDigest: 'not-used-before-checkpoint',
    expectedReplayMutationRevision: 32,
    expectedReplayMutationHead: built.receipts[31].acceptedHead
  });
  if (firstRelay.failure()) throw firstRelay.failure();
  assert.equal(first.evidence.activeKind, 'old-history');
  assert.equal(first.evidence.normalizedRevision, 10);
  assert.equal(first.evidence.restoredReplayCheckpoint, false);
  assert.equal(first.evidence.receiptsReceivedThisProcess, 10);
  assert.match(first.storageSnapshot, /old-receipts/);
  await firstRelay.close();
  firstRelay = null;

  // While the browser is absent, accepted payloads 1-32 are compacted and one
  // additional receipt (41) is accepted after the original 40-receipt fixture.
  const history = await createCompactedFileReceiptHistory({
    filePath: compactedPath,
    checkpointRevision: 0,
    checkpointHead: mutationRoot,
    acceptedReceipts: built.receipts,
    throughRevision: 32
  });
  assert.throws(() => history.receiptsAfter(10), /receipts-before-compaction-floor:32/);

  let authority = history.restoreAuthority();
  const before41 = authority.checkpoint();
  const accepted41 = authority.submit({
    id: 'proposal-041',
    actorId: 'actor-new',
    basedOnRevision: before41.revision,
    basedOnHead: before41.head,
    command: {
      atTick: 410,
      type: 'stock.add',
      payload: { amountMilli: 41, padding: 'new-after-compaction' }
    }
  });
  await history.append(accepted41.receipt);
  assert.equal(history.checkpoint().revision, 41);

  const allReceipts = [...built.receipts, accepted41.receipt];
  const normalizedFull = normalizeAcceptedReceipts(allReceipts, {
    checkpointRevision: 0,
    checkpointHead: mutationRoot
  });
  const replay = createReplayCheckpoint({
    baseState: makeBaseState(),
    sourceCheckpointRevision: 0,
    sourceCheckpointHead: mutationRoot,
    acceptedReceipts: allReceipts,
    throughRevision: 32,
    checkpointTick: 320,
    rules
  });
  const retainedSuffix = history.receiptsAfter(32);
  assert.deepEqual(replay.retainedReceipts, retainedSuffix);
  assert.equal(replay.checkpoint.mutationRevision, 32);
  assert.equal(replay.checkpoint.checkpointTick, 320);
  assert.equal(Object.keys(replay.checkpoint.state.appliedCommands).length, 32);

  const uninterrupted = advanceCatchup(makeBaseState(), targetTick, {
    commands: normalizedFull.commands,
    rules
  });
  const expectedDigest = digestState(uninterrupted);
  assert.equal(expectedDigest, 'fnv1a32:1dfc90e1');

  // Prefix payload bytes are absent from the replay handoff, while historical
  // command identity remains explicit in checkpoint state as required by partial
  // compaction semantics.
  const handoffText = JSON.stringify({ checkpoint: replay.checkpoint, retainedSuffix });
  assert.ok(!handoffText.includes(`001:${'x'.repeat(256)}`));
  assert.ok(handoffText.includes('proposal-001'));

  secondRelay = await startRelay({
    port: stablePort,
    mode: 'checkpoint',
    checkpoint: replay.checkpoint,
    suffixReceipts: retainedSuffix
  });

  // Browser process 2 is below the compaction floor, receives the trusted replay
  // checkpoint, and reconstructs exactly through revision 41 / tick 600.
  const second = await runBrowser({
    pageUrl: secondRelay.pageUrl,
    websocketUrl: secondRelay.websocketUrl,
    expectedRevision: 41,
    trustedReplayCheckpointDigest: replay.checkpoint.checkpointDigest,
    expectedReplayMutationRevision: 32,
    expectedReplayMutationHead: built.receipts[31].acceptedHead
  });
  if (secondRelay.failure()) throw secondRelay.failure();
  assert.equal(second.evidence.restoredOldReceiptCount, 10);
  assert.equal(second.evidence.replayCheckpointReceivedThisProcess, true);
  assert.equal(second.evidence.restoredReplayCheckpoint, false);
  assert.deepEqual(second.evidence.syncRequests, [{ type: 'sync.request', afterRevision: 10 }]);
  assert.equal(second.evidence.activeKind, 'replay-checkpoint');
  assert.equal(second.evidence.checkpointRevision, 32);
  assert.equal(second.evidence.checkpointTick, 320);
  assert.equal(second.evidence.checkpointDigest, replay.checkpoint.checkpointDigest);
  assert.equal(second.evidence.normalizedRevision, 41);
  assert.equal(second.evidence.retainedSuffixReceipts, 9);
  assert.deepEqual(second.evidence.state, uninterrupted);
  assert.equal(second.evidence.digest, expectedDigest);
  assert.match(second.storageSnapshot, /replay-checkpoint/);

  // Browser process 3 re-verifies the persisted trusted checkpoint/suffix and
  // needs no network request at the same target revision.
  const requestCountBeforeThird = secondRelay.syncRequests.length;
  const third = await runBrowser({
    pageUrl: secondRelay.pageUrl,
    websocketUrl: secondRelay.websocketUrl,
    expectedRevision: 41,
    trustedReplayCheckpointDigest: replay.checkpoint.checkpointDigest,
    expectedReplayMutationRevision: 32,
    expectedReplayMutationHead: built.receipts[31].acceptedHead
  });
  assert.equal(secondRelay.syncRequests.length, requestCountBeforeThird);
  assert.equal(third.evidence.restoredReplayCheckpoint, true);
  assert.equal(third.evidence.replayCheckpointReceivedThisProcess, false);
  assert.deepEqual(third.evidence.syncRequests, []);
  assert.equal(third.evidence.normalizedRevision, 41);
  assert.deepEqual(third.evidence.state, uninterrupted);
  assert.equal(third.evidence.digest, expectedDigest);

  // Tamper browser-local checkpoint state. A fourth process must re-verify and
  // fail instead of trusting persistent storage.
  const tamperContext = await chromium.launchPersistentContext(userDataDir, { headless: true });
  const tamperPage = await tamperContext.newPage();
  await tamperPage.goto(secondRelay.pageUrl, { waitUntil: 'load' });
  await tamperPage.evaluate(() => {
    const key = window.__AXM_PARTIAL_REPLAY_PROOF__.storageKey;
    const stored = JSON.parse(localStorage.getItem(key));
    stored.checkpoint.state.stockMilli += 1;
    localStorage.setItem(key, JSON.stringify(stored));
  });
  await tamperContext.close();

  const fourth = await runBrowser({
    pageUrl: secondRelay.pageUrl,
    websocketUrl: secondRelay.websocketUrl,
    expectedRevision: 41,
    trustedReplayCheckpointDigest: replay.checkpoint.checkpointDigest,
    expectedReplayMutationRevision: 32,
    expectedReplayMutationHead: built.receipts[31].acceptedHead,
    expectStatus: 'fail'
  });
  assert.match(fourth.evidence.error, /replay-checkpoint-state-digest-mismatch/);

  console.log('AXM Global State proof 022 Chromium partial replay checkpoint: PASS');
  console.log({
    browserProcesses: 4,
    laggingRevisionBeforeCheckpoint: 10,
    partialCompactionFloorRevision: 32,
    replayCheckpointTick: 320,
    checkpointHistoricalCommandIds: Object.keys(replay.checkpoint.state.appliedCommands).length,
    retainedSuffixReceipts: retainedSuffix.length,
    resumedRevision: second.evidence.normalizedRevision,
    targetTick,
    prefixPayloadBytesTransferred: false,
    historicalIdentityPreserved: true,
    persistedCheckpointReverifiedAfterRestart: true,
    persistedCheckpointTamperRejected: true,
    exactStatePreserved: true,
    finalStateDigest: expectedDigest
  });
} finally {
  if (firstRelay) await firstRelay.close().catch(() => {});
  if (secondRelay) await secondRelay.close().catch(() => {});
  await rm(tempDir, { recursive: true, force: true });
}
