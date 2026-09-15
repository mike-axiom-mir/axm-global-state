import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
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
    const requested = path.resolve(repoRoot, relative || "tests/websocket-reconnect-proof.html");
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
      if (message?.type !== "sync.request" || !Number.isSafeInteger(message.afterRevision)) {
        throw new Error("invalid-sync-request");
      }
      relaySyncRequests.push(message.afterRevision);

      if (connectionOrdinal === 1) {
        assert.equal(message.afterRevision, 0, "first connection should request after checkpoint revision 0");
        socket.send(JSON.stringify({ type: "receipt", receipt: fixture.receipts[0] }), (error) => {
          if (error) {
            relayFailure = error;
            return;
          }
          socket.close(1012, "proof-disconnect");
        });
        return;
      }

      if (connectionOrdinal === 2) {
        assert.equal(message.afterRevision, 1, "reconnect should resume after verified revision 1");
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

let browser;
try {
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("invalid-test-server-address");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(String(error)));

  await page.goto(`http://127.0.0.1:${address.port}/tests/websocket-reconnect-proof.html`, {
    waitUntil: "load"
  });

  await page.evaluate((config) => window.__AXM_WS_PROOF__.configure(config), {
    websocketUrl: `ws://127.0.0.1:${address.port}/receipts`,
    checkpointRevision: 0,
    checkpointHead: fixture.checkpointHead,
    expectedRevision: 2,
    expectedMessages: 3,
    reconnectDelayMs: 20,
    maxConnectionAttempts: 3,
    baseState: baseStateConfig,
    targetTick: 3600,
    rules
  });

  await page.locator("#status[data-status='pass']").waitFor({ timeout: 30_000 });
  const browserEvidence = await page.evaluate(() => window.__AXM_WS_PROOF__.evidence());

  if (relayFailure) throw relayFailure;
  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join(" | ")}`);
  assert.equal(connectionCount, 2, "proof should require one reconnect");
  assert.deepEqual(relaySyncRequests, [0, 1], "client should resume from its last verified revision");
  assert.equal(browserEvidence.receivedMessages, 3);
  assert.equal(browserEvidence.connectionAttempts, 2);
  assert.deepEqual(browserEvidence.syncRequests, [0, 1]);
  assert.equal(browserEvidence.normalizedRevision, 2);
  assert.equal(browserEvidence.normalizedHead, fixture.authorityCheckpoint.head);
  assert.deepEqual(browserEvidence.proposalIds, ["proposal-a", "proposal-b"]);
  assert.deepEqual(browserEvidence.state, nodeState);
  assert.equal(browserEvidence.digest, nodeDigest);

  await page.evaluate(() => window.__AXM_WS_PROOF__.close());

  console.log("AXM Global State proof 007 WebSocket reconnect receipt sync: PASS");
  console.log({
    transport: "WebSocket",
    connectionCount,
    syncRequests: relaySyncRequests,
    receivedMessages: browserEvidence.receivedMessages,
    normalizedRevision: browserEvidence.normalizedRevision,
    acceptedHead: browserEvidence.normalizedHead,
    finalStateDigest: browserEvidence.digest
  });
} finally {
  if (browser) await browser.close();
  for (const client of websocketServer.clients) client.terminate();
  await new Promise((resolve) => websocketServer.close(resolve));
  await new Promise((resolve) => httpServer.close(resolve));
}
