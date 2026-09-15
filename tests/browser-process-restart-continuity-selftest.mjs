import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { WebSocketServer } from "ws";
import {
  createSingleSequencerAuthority,
  normalizeAcceptedReceipts
} from "../src/mutation-agreement.mjs";
import {
  advanceCatchup,
  createState,
  digestState
} from "../src/temporal-state-kernel.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"]
]);

const rules = Object.freeze({
  version: "axm-global-state-proof-001",
  recurringEvery: 60,
  recurringRewardMilli: 7
});

const baseStateConfig = Object.freeze({
  tick: 0,
  stockMilli: 1000,
  ratePerTickMilli: 3,
  rulesVersion: rules.version,
  completions: Object.freeze([
    Object.freeze({ id: "shared-build", atTick: 120, rewardMilli: 25 })
  ])
});

function makeBaseState() {
  return createState(structuredClone(baseStateConfig));
}

function buildAcceptedReceipts() {
  const checkpointHead = `state:${digestState(makeBaseState())}`;
  const authority = createSingleSequencerAuthority({ checkpointRevision: 0, checkpointHead });

  const first = authority.submit({
    id: "proposal-a",
    actorId: "participant-a",
    basedOnRevision: 0,
    basedOnHead: checkpointHead,
    command: { atTick: 17, type: "stock.add", payload: { amountMilli: 31 } }
  }).receipt;

  const afterFirst = authority.checkpoint();
  const second = authority.submit({
    id: "proposal-b",
    actorId: "participant-b",
    basedOnRevision: afterFirst.revision,
    basedOnHead: afterFirst.head,
    command: { atTick: 90, type: "rate.set", payload: { ratePerTickMilli: 5 } }
  }).receipt;

  return {
    checkpointHead,
    authorityCheckpoint: authority.checkpoint(),
    receipts: [first, second]
  };
}

const fixture = buildAcceptedReceipts();
const nodeNormalized = normalizeAcceptedReceipts(fixture.receipts, {
  checkpointRevision: 0,
  checkpointHead: fixture.checkpointHead
});
const nodeState = advanceCatchup(makeBaseState(), 3600, {
  commands: nodeNormalized.commands,
  rules
});
const nodeDigest = digestState(nodeState);

const httpServer = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const requested = path.resolve(repoRoot, relative || "tests/browser-process-restart-proof.html");
    const withinRoot = requested === repoRoot || requested.startsWith(`${repoRoot}${path.sep}`);
    if (!withinRoot) {
      response.writeHead(403).end("forbidden");
      return;
    }
    const body = await readFile(requested);
    response.writeHead(200, {
      "content-type": mime.get(path.extname(requested)) || "application/octet-stream",
      "cache-control": "no-store"
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
});

const websocketServer = new WebSocketServer({ server: httpServer, path: "/receipts" });
const relaySyncRequests = [];
let relayFailure = null;
let connectionCount = 0;

websocketServer.on("connection", (socket) => {
  connectionCount += 1;
  const ordinal = connectionCount;

  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message?.type !== "sync.request" || !Number.isSafeInteger(message.afterRevision)) {
        throw new Error("invalid-sync-request");
      }
      relaySyncRequests.push(message.afterRevision);

      if (ordinal === 1) {
        assert.equal(message.afterRevision, 0, "first browser process must begin from checkpoint revision 0");
        socket.send(JSON.stringify({ type: "receipt", receipt: fixture.receipts[0] }));
        return;
      }

      if (ordinal === 2) {
        assert.equal(message.afterRevision, 1, "fresh browser process must restore verified revision 1 from durable local evidence");
        socket.send(JSON.stringify({ type: "receipt", receipt: fixture.receipts[1] }));
        return;
      }

      throw new Error(`unexpected-extra-connection:${ordinal}`);
    } catch (error) {
      relayFailure = error;
      socket.close(1011, "proof-relay-failure");
    }
  });
});

await new Promise((resolve, reject) => {
  httpServer.once("error", reject);
  httpServer.listen(0, "127.0.0.1", resolve);
});

const address = httpServer.address();
if (!address || typeof address === "string") throw new Error("invalid-test-server-address");
const pageUrl = `http://127.0.0.1:${address.port}/tests/browser-process-restart-proof.html`;
const websocketUrl = `ws://127.0.0.1:${address.port}/receipts`;
const userDataDir = await mkdtemp(path.join(os.tmpdir(), "axm-global-state-proof-008-"));

async function runBrowserPhase(expectedRevision) {
  const context = await chromium.launchPersistentContext(userDataDir, { headless: true });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(String(error)));

  await page.goto(pageUrl, { waitUntil: "load" });
  await page.evaluate((config) => window.__AXM_RESTART_PROOF__.configure(config), {
    websocketUrl,
    checkpointRevision: 0,
    checkpointHead: fixture.checkpointHead,
    expectedRevision,
    baseState: baseStateConfig,
    targetTick: 3600,
    rules
  });

  await page.locator("#status[data-status='pass']").waitFor({ timeout: 30_000 });
  const evidence = await page.evaluate(() => window.__AXM_RESTART_PROOF__.evidence());
  const storageSnapshot = await page.evaluate(() => window.__AXM_RESTART_PROOF__.storageSnapshot());
  await page.evaluate(() => window.__AXM_RESTART_PROOF__.close());
  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join(" | ")}`);
  await context.close();
  return { evidence, storageSnapshot };
}

try {
  const firstProcess = await runBrowserPhase(1);
  if (relayFailure) throw relayFailure;
  assert.equal(firstProcess.evidence.restoredReceiptCount, 0);
  assert.equal(firstProcess.evidence.receivedThisProcess, 1);
  assert.deepEqual(firstProcess.evidence.syncRequests, [0]);
  assert.equal(firstProcess.evidence.normalizedRevision, 1);
  assert.equal(firstProcess.evidence.normalizedHead, fixture.receipts[0].acceptedHead);
  assert.equal(firstProcess.evidence.storedReceiptCount, 1);
  assert.match(firstProcess.storageSnapshot, /proposal-a/);

  // runBrowserPhase closes the entire persistent Chromium context. The next call
  // starts a new Chromium process against the same durable profile directory.
  const secondProcess = await runBrowserPhase(2);
  if (relayFailure) throw relayFailure;
  assert.equal(connectionCount, 2, "proof requires two separate browser-process connections");
  assert.deepEqual(relaySyncRequests, [0, 1]);
  assert.equal(secondProcess.evidence.restoredReceiptCount, 1);
  assert.equal(secondProcess.evidence.receivedThisProcess, 1);
  assert.deepEqual(secondProcess.evidence.syncRequests, [1]);
  assert.equal(secondProcess.evidence.normalizedRevision, 2);
  assert.equal(secondProcess.evidence.normalizedHead, fixture.authorityCheckpoint.head);
  assert.deepEqual(secondProcess.evidence.proposalIds, ["proposal-a", "proposal-b"]);
  assert.equal(secondProcess.evidence.storedReceiptCount, 2);
  assert.match(secondProcess.storageSnapshot, /proposal-a/);
  assert.match(secondProcess.storageSnapshot, /proposal-b/);
  assert.deepEqual(secondProcess.evidence.state, nodeState);
  assert.equal(secondProcess.evidence.digest, nodeDigest);

  console.log("AXM Global State proof 008 browser process restart continuity: PASS");
  console.log({
    storage: "localStorage in persistent Chromium profile",
    browserProcesses: 2,
    syncRequests: relaySyncRequests,
    restoredReceiptCount: secondProcess.evidence.restoredReceiptCount,
    normalizedRevision: secondProcess.evidence.normalizedRevision,
    acceptedHead: secondProcess.evidence.normalizedHead,
    finalStateDigest: secondProcess.evidence.digest
  });
} finally {
  for (const client of websocketServer.clients) client.terminate();
  await new Promise((resolve) => websocketServer.close(resolve));
  await new Promise((resolve) => httpServer.close(resolve));
  await rm(userDataDir, { recursive: true, force: true });
}
