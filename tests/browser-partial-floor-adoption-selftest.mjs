import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { WebSocketServer } from "ws";
import { createCompactedFileReceiptHistory } from "../src/compacted-receipt-history.mjs";
import { createReplayCheckpoint } from "../src/replay-checkpoint.mjs";
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

const mutationRoot = "proof-021:mutation-root";
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
    Object.freeze({ id: "browser-partial-floor-build", atTick: 120, rewardMilli: 25 })
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
      id: `proposal-${String(index).padStart(3, "0")}`,
      actorId: `actor-${index % 4}`,
      basedOnRevision: checkpoint.revision,
      basedOnHead: checkpoint.head,
      command: Object.freeze({
        atTick: index * 10,
        type: "stock.add",
        payload: Object.freeze({
          amountMilli: index,
          padding: `${String(index).padStart(3, "0")}:${"x".repeat(128)}`
        })
      })
    });
    proposals.push(proposal);
    receipts.push(authority.submit(proposal).receipt);
  }
  return { authority, proposals, receipts };
}

const built = buildHistory();
const firstTenNormalized = normalizeAcceptedReceipts(built.receipts.slice(0, 10), {
  checkpointRevision: 0,
  checkpointHead: mutationRoot
});
const firstTenState = advanceCatchup(makeBaseState(), 100, {
  commands: firstTenNormalized.commands,
  rules
});
const firstTenDigest = digestState(firstTenState);

let wakePackage = null;
let finalNodeState = null;
let finalNodeDigest = null;
let expectedCheckpointDigest = null;

const httpServer = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const requested = path.resolve(repoRoot, relative || "tests/browser-partial-floor-adoption-proof.html");
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

const websocketServer = new WebSocketServer({ server: httpServer, path: "/sync" });
let websocketClosed = false;
let connectionCount = 0;
let relayFailure = null;
const relaySyncRequests = [];
const relayMessagesSent = [];

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
        assert.equal(wakePackage, null, "authority must not compact until the first browser process is gone");
        assert.equal(message.afterRevision, 0, "first browser process must begin from genesis revision 0");
        for (const receipt of built.receipts.slice(0, 10)) {
          const outbound = { type: "receipt", receipt };
          relayMessagesSent.push(outbound);
          socket.send(JSON.stringify(outbound));
        }
        return;
      }

      if (ordinal === 2) {
        assert.ok(wakePackage, "checkpoint package must exist before returning browser sync");
        assert.equal(message.afterRevision, 10, "returning browser must restore revision 10 before requesting sync");
        const outbound = {
          type: "checkpoint.package",
          checkpoint: wakePackage.checkpoint,
          receipts: wakePackage.receipts,
          targetRevision: wakePackage.targetRevision,
          targetHead: wakePackage.targetHead
        };
        assert.equal(Object.hasOwn(outbound, "expectedCheckpointDigest"), false);
        assert.equal(Object.hasOwn(outbound, "trustedCheckpointDigest"), false);
        relayMessagesSent.push(outbound);
        socket.send(JSON.stringify(outbound));
        return;
      }

      throw new Error(`unexpected-browser-connection:${ordinal}`);
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
const pageUrl = `http://127.0.0.1:${address.port}/tests/browser-partial-floor-adoption-proof.html`;
const websocketUrl = `ws://127.0.0.1:${address.port}/sync`;
const userDataDir = await mkdtemp(path.join(os.tmpdir(), "axm-global-state-proof-021-browser-"));
const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "axm-global-state-proof-021-authority-"));
const compactedPath = path.join(fixtureDir, "compacted-history.json");

async function runBrowserPhase({ expectedRevision, targetTick, expectedHead = null, trustedDigest = null }) {
  const context = await chromium.launchPersistentContext(userDataDir, { headless: true });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(String(error)));

  await page.goto(pageUrl, { waitUntil: "load" });
  await page.evaluate((config) => window.__AXM_PARTIAL_FLOOR_ADOPTION__.configure(config), {
    websocketUrl,
    genesisRevision: 0,
    genesisHead: mutationRoot,
    expectedRevision,
    expectedHead,
    expectedCheckpointDigest: trustedDigest,
    baseState: baseStateConfig,
    targetTick,
    rules
  });

  await page.locator("#status[data-status='pass']").waitFor({ timeout: 30_000 });
  const evidence = await page.evaluate(() => window.__AXM_PARTIAL_FLOOR_ADOPTION__.evidence());
  const storageSnapshot = await page.evaluate(() => window.__AXM_PARTIAL_FLOOR_ADOPTION__.storageSnapshot());
  await page.evaluate(() => window.__AXM_PARTIAL_FLOOR_ADOPTION__.close());
  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join(" | ")}`);
  await context.close();
  return { evidence, storageSnapshot };
}

async function closeWebSocketRelay() {
  if (websocketClosed) return;
  for (const client of websocketServer.clients) client.terminate();
  await new Promise((resolve) => websocketServer.close(resolve));
  websocketClosed = true;
}

try {
  // Browser process #1 exists before compaction and persists only revisions 1..10.
  const firstProcess = await runBrowserPhase({ expectedRevision: 10, targetTick: 100 });
  if (relayFailure) throw relayFailure;
  assert.equal(connectionCount, 1);
  assert.deepEqual(relaySyncRequests, [0]);
  assert.equal(firstProcess.evidence.restoredMode, "receipts");
  assert.equal(firstProcess.evidence.adoptedCheckpoint, false);
  assert.equal(firstProcess.evidence.receivedThisProcess, 10);
  assert.equal(firstProcess.evidence.finalRevision, 10);
  assert.equal(firstProcess.evidence.digest, firstTenDigest);
  assert.deepEqual(firstProcess.evidence.state, firstTenState);
  assert.match(firstProcess.storageSnapshot, /"mode":"receipts"/);
  assert.match(firstProcess.storageSnapshot, /proposal-010/);

  // WHILE BROWSER IS ABSENT: authority partially compacts through revision 32,
  // then admits revision 41 and prepares a replay checkpoint at the compaction floor.
  const history = await createCompactedFileReceiptHistory({
    filePath: compactedPath,
    checkpointRevision: 0,
    checkpointHead: mutationRoot,
    acceptedReceipts: built.receipts,
    throughRevision: 32
  });
  let authority = history.restoreAuthority();
  const before41 = authority.checkpoint();
  const proposal41 = Object.freeze({
    id: "proposal-041",
    actorId: "actor-new",
    basedOnRevision: before41.revision,
    basedOnHead: before41.head,
    command: Object.freeze({
      atTick: 410,
      type: "stock.add",
      payload: Object.freeze({ amountMilli: 41, padding: "new-after-compaction" })
    })
  });
  const accepted41 = authority.submit(proposal41);
  await history.append(accepted41.receipt);
  const allReceipts = [...built.receipts, accepted41.receipt];
  const replay = createReplayCheckpoint({
    baseState: makeBaseState(),
    sourceCheckpointRevision: 0,
    sourceCheckpointHead: mutationRoot,
    acceptedReceipts: allReceipts,
    throughRevision: 32,
    checkpointTick: 320,
    rules
  });
  assert.deepEqual(replay.retainedReceipts, history.receiptsAfter(32));
  expectedCheckpointDigest = replay.checkpoint.checkpointDigest;
  wakePackage = Object.freeze({
    checkpoint: replay.checkpoint,
    receipts: history.receiptsAfter(32),
    targetRevision: history.checkpoint().revision,
    targetHead: history.checkpoint().head
  });

  const fullNormalized = normalizeAcceptedReceipts(allReceipts, {
    checkpointRevision: 0,
    checkpointHead: mutationRoot
  });
  finalNodeState = advanceCatchup(makeBaseState(), 600, {
    commands: fullNormalized.commands,
    rules
  });
  finalNodeDigest = digestState(finalNodeState);

  // Browser process #2 restores old revision 10, cannot receive removed 11..32,
  // receives one checkpoint package plus only retained receipts 33..41, and adopts it.
  const secondProcess = await runBrowserPhase({
    expectedRevision: 41,
    targetTick: 600,
    expectedHead: history.checkpoint().head,
    trustedDigest: expectedCheckpointDigest
  });
  if (relayFailure) throw relayFailure;
  assert.equal(connectionCount, 2);
  assert.deepEqual(relaySyncRequests, [0, 10]);
  assert.equal(secondProcess.evidence.restoredMode, "receipts");
  assert.equal(secondProcess.evidence.adoptedCheckpoint, true);
  assert.equal(secondProcess.evidence.offlineRestore, false);
  assert.equal(secondProcess.evidence.priorLocalRevision, 10);
  assert.equal(secondProcess.evidence.checkpointRevision, 32);
  assert.equal(secondProcess.evidence.checkpointTick, 320);
  assert.equal(secondProcess.evidence.suffixReceiptCount, 9);
  assert.equal(secondProcess.evidence.finalRevision, 41);
  assert.equal(secondProcess.evidence.transportSuppliedTrustAnchor, false);
  assert.equal(secondProcess.evidence.digest, finalNodeDigest);
  assert.deepEqual(secondProcess.evidence.state, finalNodeState);
  assert.match(secondProcess.storageSnapshot, /"mode":"checkpoint"/);
  assert.equal(secondProcess.storageSnapshot.includes(built.receipts[0].command.payload.padding), false,
    "adopted browser storage must not retain compacted prefix receipt payloads");
  assert.match(secondProcess.storageSnapshot, /proposal-033/);
  assert.match(secondProcess.storageSnapshot, /proposal-041/);

  // Kill the relay completely. Browser process #3 must restore the adopted checkpoint
  // from the same persistent profile and reconstruct without attempting a connection.
  await closeWebSocketRelay();
  const thirdProcess = await runBrowserPhase({
    expectedRevision: 41,
    targetTick: 600,
    expectedHead: history.checkpoint().head,
    trustedDigest: expectedCheckpointDigest
  });
  assert.equal(connectionCount, 2, "offline third process must not create another WebSocket connection");
  assert.equal(thirdProcess.evidence.restoredMode, "checkpoint");
  assert.equal(thirdProcess.evidence.adoptedCheckpoint, true);
  assert.equal(thirdProcess.evidence.offlineRestore, true);
  assert.equal(thirdProcess.evidence.connectionAttempted, false);
  assert.equal(thirdProcess.evidence.receivedThisProcess, 0);
  assert.deepEqual(thirdProcess.evidence.syncRequests, []);
  assert.equal(thirdProcess.evidence.checkpointRevision, 32);
  assert.equal(thirdProcess.evidence.suffixReceiptCount, 9);
  assert.equal(thirdProcess.evidence.finalRevision, 41);
  assert.equal(thirdProcess.evidence.digest, finalNodeDigest);
  assert.deepEqual(thirdProcess.evidence.state, finalNodeState);
  assert.equal(thirdProcess.storageSnapshot, secondProcess.storageSnapshot,
    "offline restart must not rewrite trusted checkpoint evidence merely to reconstruct");

  const checkpointMessages = relayMessagesSent.filter((message) => message.type === "checkpoint.package");
  assert.equal(checkpointMessages.length, 1);
  assert.equal(checkpointMessages[0].receipts.length, 9);
  assert.ok(checkpointMessages[0].receipts.every((receipt) => receipt.sequence >= 33 && receipt.sequence <= 41));

  console.log("AXM Global State proof 021 browser partial-floor checkpoint adoption: PASS");
  console.log({
    browserProcesses: 3,
    relayConnections: connectionCount,
    syncRequests: relaySyncRequests,
    preCompactionLocalRevision: firstProcess.evidence.finalRevision,
    adoptedCheckpointRevision: secondProcess.evidence.checkpointRevision,
    retainedSuffixReceiptsTransferred: secondProcess.evidence.suffixReceiptCount,
    adoptedRevision: secondProcess.evidence.finalRevision,
    relaySuppliedTrustAnchor: secondProcess.evidence.transportSuppliedTrustAnchor,
    offlineThirdProcess: thirdProcess.evidence.offlineRestore,
    offlineThirdProcessConnectionAttempted: thirdProcess.evidence.connectionAttempted,
    finalStateDigest: thirdProcess.evidence.digest
  });
} finally {
  if (!websocketClosed) await closeWebSocketRelay();
  await new Promise((resolve) => httpServer.close(resolve));
  await rm(userDataDir, { recursive: true, force: true });
  await rm(fixtureDir, { recursive: true, force: true });
}
