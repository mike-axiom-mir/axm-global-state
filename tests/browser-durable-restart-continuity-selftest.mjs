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
    if (url.pathname === "/receipts") return;
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const requested = path.resolve(repoRoot, relative || "tests/browser-durable-restart-proof.html");
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
let connectionCount = 0;
const relaySyncRequests = [];
let relayFailure = null;

websocketServer.on("connection", (socket) => {
  connectionCount += 1;
  const connectionOrdinal = connectionCount;

  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (
        message?.type !== "sync.request" ||
        !Number.isSafeInteger(message.afterRevision) ||
        typeof message.afterHead !== "string"
      ) {
        throw new Error("invalid-sync-request");
      }
      relaySyncRequests.push({
        afterRevision: message.afterRevision,
        afterHead: message.afterHead
      });

      if (connectionOrdinal === 1) {
        assert.equal(message.afterRevision, 0);
        assert.equal(message.afterHead, fixture.checkpointHead);
        socket.send(JSON.stringify({ type: "receipt", receipt: fixture.receipts[0] }));
        return;
      }

      if (connectionOrdinal === 2) {
        assert.equal(message.afterRevision, 1, "fresh browser process should resume from durable verified revision 1");
        assert.equal(message.afterHead, fixture.receipts[0].acceptedHead, "fresh browser process should restore durable verified head");
        const payload = JSON.stringify({ type: "receipt", receipt: fixture.receipts[1] });
        socket.send(payload);
        socket.send(payload);
        return;
      }

      throw new Error(`unexpected-extra-connection:${connectionOrdinal}`);
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

const userDataDir = await mkdtemp(path.join(os.tmpdir(), "axm-global-state-proof-008-"));
let firstContext;
let secondContext;
try {
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("invalid-test-server-address");
  const proofUrl = `http://127.0.0.1:${address.port}/tests/browser-durable-restart-proof.html`;
  const websocketUrl = `ws://127.0.0.1:${address.port}/receipts`;

  firstContext = await chromium.launchPersistentContext(userDataDir, { headless: true });
  const firstPage = await firstContext.newPage();
  const firstErrors = [];
  firstPage.on("console", (message) => {
    if (message.type() === "error") firstErrors.push(message.text());
  });
  firstPage.on("pageerror", (error) => firstErrors.push(String(error)));

  await firstPage.goto(proofUrl, { waitUntil: "load" });
  await firstPage.evaluate((config) => window.__AXM_DURABLE_PROOF__.initialize(config), {
    websocketUrl,
    checkpointRevision: 0,
    checkpointHead: fixture.checkpointHead,
    checkpointAtRevision: 1,
    expectedRevision: 2,
    baseState: baseStateConfig,
    targetTick: 3600,
    rules
  });

  await firstPage.locator("#status[data-status='checkpointed']").waitFor({ timeout: 30_000 });
  const persistedBeforeRestart = await firstPage.evaluate(() => window.__AXM_DURABLE_PROOF__.durableRecord());
  assert.deepEqual(firstErrors, [], `first browser errors: ${firstErrors.join(" | ")}`);
  assert.equal(persistedBeforeRestart.verifiedRevision, 1);
  assert.equal(persistedBeforeRestart.verifiedHead, fixture.receipts[0].acceptedHead);
  assert.equal(persistedBeforeRestart.acceptedReceipts.length, 1);

  // Kill the entire persistent browser context. No page JS state survives this boundary.
  await firstContext.close();
  firstContext = null;

  secondContext = await chromium.launchPersistentContext(userDataDir, { headless: true });
  const secondPage = await secondContext.newPage();
  const secondErrors = [];
  secondPage.on("console", (message) => {
    if (message.type() === "error") secondErrors.push(message.text());
  });
  secondPage.on("pageerror", (error) => secondErrors.push(String(error)));

  await secondPage.goto(proofUrl, { waitUntil: "load" });
  await secondPage.evaluate((config) => window.__AXM_DURABLE_PROOF__.resume(config), {
    websocketUrl,
    expectedRevision: 2
  });

  await secondPage.locator("#status[data-status='pass']").waitFor({ timeout: 30_000 });
  const browserEvidence = await secondPage.evaluate(() => window.__AXM_DURABLE_PROOF__.evidence());
  const persistedAfterRestart = await secondPage.evaluate(() => window.__AXM_DURABLE_PROOF__.durableRecord());

  if (relayFailure) throw relayFailure;
  assert.deepEqual(secondErrors, [], `second browser errors: ${secondErrors.join(" | ")}`);
  assert.equal(connectionCount, 2, "proof should use one connection before and one after process restart");
  assert.deepEqual(
    relaySyncRequests.map((request) => request.afterRevision),
    [0, 1],
    "fresh browser process must resume from durable revision 1"
  );
  assert.equal(browserEvidence.restoredFromStorage, true);
  assert.equal(browserEvidence.restoredInitialRevision, 1);
  assert.equal(browserEvidence.sessionReceived, 2, "fresh process should receive only R2 plus duplicate R2");
  assert.equal(browserEvidence.verifiedRevision, 2);
  assert.equal(browserEvidence.verifiedHead, fixture.authorityCheckpoint.head);
  assert.equal(browserEvidence.acceptedReceiptCount, 2);
  assert.deepEqual(browserEvidence.proposalIds, ["proposal-a", "proposal-b"]);
  assert.deepEqual(browserEvidence.state, nodeState);
  assert.equal(browserEvidence.digest, nodeDigest);
  assert.equal(persistedAfterRestart.verifiedRevision, 2);
  assert.equal(persistedAfterRestart.verifiedHead, fixture.authorityCheckpoint.head);
  assert.equal(persistedAfterRestart.acceptedReceipts.length, 3, "raw durable delivery evidence may retain exact duplicate receipts");

  await secondPage.evaluate(() => window.__AXM_DURABLE_PROOF__.close());

  console.log("AXM Global State proof 008 durable browser restart continuity: PASS");
  console.log({
    storage: "IndexedDB",
    contexts: 2,
    connectionCount,
    syncRequests: relaySyncRequests.map((request) => request.afterRevision),
    restoredInitialRevision: browserEvidence.restoredInitialRevision,
    sessionReceived: browserEvidence.sessionReceived,
    verifiedRevision: browserEvidence.verifiedRevision,
    acceptedHead: browserEvidence.verifiedHead,
    finalStateDigest: browserEvidence.digest
  });
} finally {
  if (firstContext) await firstContext.close();
  if (secondContext) await secondContext.close();
  for (const client of websocketServer.clients) client.terminate();
  await new Promise((resolve) => websocketServer.close(resolve));
  await new Promise((resolve) => httpServer.close(resolve));
  await rm(userDataDir, { recursive: true, force: true });
}
