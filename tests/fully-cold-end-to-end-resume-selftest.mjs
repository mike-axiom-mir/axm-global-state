import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';
import { normalizeAcceptedReceipts } from '../src/mutation-agreement.mjs';
import { advanceCatchup, createState, digestState } from '../src/temporal-state-kernel.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const authorityChild = fileURLToPath(new URL('./receipt-authority-service-child.mjs', import.meta.url));
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'axm-global-state-proof-010-'));
const historyPath = path.join(tempDir, 'accepted-history.json');
const userDataDir = path.join(tempDir, 'browser-profile');

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

function startAuthorityService() {
  const child = fork(authorityChild, [], {
    env: {
      ...process.env,
      AXM_RECEIPT_HISTORY_FILE: historyPath,
      AXM_CHECKPOINT_REVISION: '0',
      AXM_CHECKPOINT_HEAD: checkpointHead
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });

  let requestCounter = 0;
  let capturedStderr = '';
  const pending = new Map();
  child.stderr.on('data', (chunk) => { capturedStderr += chunk.toString(); });

  const ready = new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (message?.type !== 'ready') return;
      child.off('message', onMessage);
      resolve(message);
    };
    child.on('message', onMessage);
    child.once('exit', (code, signal) => {
      reject(new Error(`authority-exited-before-ready:${code}:${signal}:${capturedStderr}`));
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
        reject(new Error(`authority-request-timeout:${type}`));
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

  return {
    child,
    ready,
    request,
    killHard,
    shutdown,
    stderr: () => capturedStderr
  };
}

async function startRelay(authority, requestedPort = 0) {
  let relayFailure = null;
  const syncRequests = [];

  const httpServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const requested = path.resolve(repoRoot, relative || 'tests/browser-process-restart-proof.html');
      const withinRoot = requested === repoRoot || requested.startsWith(`${repoRoot}${path.sep}`);
      if (!withinRoot) {
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

  const websocketServer = new WebSocketServer({ server: httpServer, path: '/receipts' });
  websocketServer.on('connection', (socket) => {
    socket.on('message', async (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message?.type !== 'sync.request' || !Number.isSafeInteger(message.afterRevision)) {
          throw new Error('invalid-sync-request');
        }
        syncRequests.push(message.afterRevision);
        const response = await authority.request('receipts.after', { revision: message.afterRevision });
        if (!response.ok) throw new Error(response.error || 'authority-receipt-request-failed');
        for (const receipt of response.result.receipts) {
          socket.send(JSON.stringify({ type: 'receipt', receipt }));
        }
      } catch (error) {
        relayFailure = error;
        socket.close(1011, 'proof-relay-failure');
      }
    });
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(requestedPort, '127.0.0.1', resolve);
  });

  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('invalid-relay-address');
  const port = address.port;

  async function close() {
    for (const client of websocketServer.clients) client.terminate();
    await new Promise((resolve) => websocketServer.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  }

  return {
    port,
    pageUrl: `http://127.0.0.1:${port}/tests/browser-process-restart-proof.html`,
    websocketUrl: `ws://127.0.0.1:${port}/receipts`,
    syncRequests,
    failure: () => relayFailure,
    close
  };
}

async function runBrowserProcess({ pageUrl, websocketUrl, expectedRevision }) {
  const context = await chromium.launchPersistentContext(userDataDir, { headless: true });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(String(error)));

  await page.goto(pageUrl, { waitUntil: 'load' });
  await page.evaluate((config) => window.__AXM_RESTART_PROOF__.configure(config), {
    websocketUrl,
    checkpointRevision: 0,
    checkpointHead,
    expectedRevision,
    baseState: baseStateConfig,
    targetTick: 3600,
    rules
  });
  await page.locator("#status[data-status='pass']").waitFor({ timeout: 30_000 });

  const evidence = await page.evaluate(() => window.__AXM_RESTART_PROOF__.evidence());
  const storageSnapshot = await page.evaluate(() => window.__AXM_RESTART_PROOF__.storageSnapshot());
  await page.evaluate(() => window.__AXM_RESTART_PROOF__.close());
  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join(' | ')}`);
  await context.close();
  return { evidence, storageSnapshot };
}

let firstAuthority = null;
let secondAuthority = null;
let firstRelay = null;
let secondRelay = null;

try {
  // Phase A: browser and authority are both alive long enough to agree through R1.
  firstAuthority = startAuthorityService();
  const firstReady = await firstAuthority.ready;
  assert.equal(firstReady.checkpoint.revision, 0);
  assert.equal(firstReady.retainedReceipts, 0);

  const acceptedA = await firstAuthority.request('proposal.submit', { proposal: proposalA });
  assert.equal(acceptedA.ok, true, acceptedA.error);
  assert.equal(acceptedA.result.checkpoint.revision, 1);
  const receiptA = acceptedA.result.receipt;

  firstRelay = await startRelay(firstAuthority, 0);
  const stablePort = firstRelay.port;
  const firstBrowser = await runBrowserProcess({
    pageUrl: firstRelay.pageUrl,
    websocketUrl: firstRelay.websocketUrl,
    expectedRevision: 1
  });
  if (firstRelay.failure()) throw firstRelay.failure();
  assert.equal(firstBrowser.evidence.restoredReceiptCount, 0);
  assert.equal(firstBrowser.evidence.receivedThisProcess, 1);
  assert.deepEqual(firstBrowser.evidence.syncRequests, [0]);
  assert.equal(firstBrowser.evidence.normalizedRevision, 1);
  assert.equal(firstBrowser.evidence.normalizedHead, receiptA.acceptedHead);
  assert.deepEqual(firstRelay.syncRequests, [0]);
  assert.match(firstBrowser.storageSnapshot, /proposal-a/);

  // The browser and its relay disappear. While the browser is absent, one more
  // accepted mutation is durably recorded by the authority.
  await firstRelay.close();
  firstRelay = null;

  const checkpointAfterA = acceptedA.result.checkpoint;
  const proposalB = {
    id: 'proposal-b',
    actorId: 'participant-b',
    basedOnRevision: checkpointAfterA.revision,
    basedOnHead: checkpointAfterA.head,
    command: { atTick: 90, type: 'rate.set', payload: { ratePerTickMilli: 5 } }
  };
  const acceptedB = await firstAuthority.request('proposal.submit', { proposal: proposalB });
  assert.equal(acceptedB.ok, true, acceptedB.error);
  assert.equal(acceptedB.result.checkpoint.revision, 2);
  const receiptB = acceptedB.result.receipt;

  // The authority now disappears too. At this point there is no browser process,
  // no relay listener and no authority process. Only durable browser profile data
  // and durable accepted receipt history remain.
  await firstAuthority.killHard();
  firstAuthority = null;
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Phase B: authority and relay are freshly constructed from durable evidence;
  // a fresh Chromium process wakes from the same profile/origin.
  secondAuthority = startAuthorityService();
  const secondReady = await secondAuthority.ready;
  assert.equal(secondReady.checkpoint.revision, 2);
  assert.equal(secondReady.checkpoint.head, receiptB.acceptedHead);
  assert.equal(secondReady.retainedReceipts, 2);

  secondRelay = await startRelay(secondAuthority, stablePort);
  const secondBrowser = await runBrowserProcess({
    pageUrl: secondRelay.pageUrl,
    websocketUrl: secondRelay.websocketUrl,
    expectedRevision: 2
  });
  if (secondRelay.failure()) throw secondRelay.failure();

  assert.equal(secondBrowser.evidence.restoredReceiptCount, 1);
  assert.equal(secondBrowser.evidence.receivedThisProcess, 1);
  assert.deepEqual(secondBrowser.evidence.syncRequests, [1]);
  assert.deepEqual(secondRelay.syncRequests, [1]);
  assert.equal(secondBrowser.evidence.normalizedRevision, 2);
  assert.equal(secondBrowser.evidence.normalizedHead, receiptB.acceptedHead);
  assert.deepEqual(secondBrowser.evidence.proposalIds, ['proposal-a', 'proposal-b']);
  assert.match(secondBrowser.storageSnapshot, /proposal-a/);
  assert.match(secondBrowser.storageSnapshot, /proposal-b/);

  // Independent reference reconstruction comes from the freshly recovered
  // authority history, not from any retained pre-cold receipt array.
  const recoveredHistory = await secondAuthority.request('receipts.after', { revision: 0 });
  assert.equal(recoveredHistory.ok, true, recoveredHistory.error);
  assert.deepEqual(
    recoveredHistory.result.receipts.map((receipt) => receipt.proposalId),
    ['proposal-a', 'proposal-b']
  );
  const normalized = normalizeAcceptedReceipts(recoveredHistory.result.receipts, {
    checkpointRevision: 0,
    checkpointHead
  });
  const referenceState = advanceCatchup(makeBaseState(), 3600, {
    commands: normalized.commands,
    rules
  });
  const referenceDigest = digestState(referenceState);

  assert.deepEqual(secondBrowser.evidence.state, referenceState);
  assert.equal(secondBrowser.evidence.digest, referenceDigest);
  assert.equal(referenceDigest, 'fnv1a32:bab65c1b');

  console.log('AXM Global State proof 010 fully cold end-to-end resume: PASS');
  console.log({
    coldParticipants: ['browser', 'relay', 'authority'],
    browserRestoredRevision: 1,
    authorityRestoredRevision: secondReady.checkpoint.revision,
    requestedMissingAfterRevision: secondRelay.syncRequests[0],
    receivedAfterWake: secondBrowser.evidence.receivedThisProcess,
    finalRevision: secondBrowser.evidence.normalizedRevision,
    acceptedHead: secondBrowser.evidence.normalizedHead,
    finalStateDigest: secondBrowser.evidence.digest
  });
} finally {
  if (firstRelay) await firstRelay.close().catch(() => {});
  if (secondRelay) await secondRelay.close().catch(() => {});
  if (firstAuthority) await firstAuthority.killHard().catch(() => {});
  if (secondAuthority) await secondAuthority.shutdown().catch(() => secondAuthority.killHard().catch(() => {}));
  await rm(tempDir, { recursive: true, force: true });
}
