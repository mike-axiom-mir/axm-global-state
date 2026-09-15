import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
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

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const requested = path.resolve(repoRoot, relative || "tests/broadcast-channel-proof.html");
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

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

let browser;
try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("invalid-test-server-address");

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

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const receiver = await context.newPage();
  const sender = await context.newPage();
  const browserErrors = [];
  for (const page of [receiver, sender]) {
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(String(error)));
  }

  const channelName = `axm-global-state-proof-006-${Date.now()}`;
  const proofUrl = `http://127.0.0.1:${address.port}/tests/broadcast-channel-proof.html?channel=${encodeURIComponent(channelName)}`;
  await receiver.goto(proofUrl, { waitUntil: "load" });
  await sender.goto(proofUrl, { waitUntil: "load" });

  await receiver.evaluate((config) => {
    window.__AXM_BROADCAST_PROOF__.configure(config);
  }, {
    expectedMessages: 3,
    checkpointRevision: 0,
    checkpointHead: fixture.checkpointHead,
    baseState: baseStateConfig,
    targetTick: 3600,
    rules
  });

  // Deliberately send accepted receipts in the wrong order and duplicate one.
  await sender.evaluate((messages) => {
    window.__AXM_BROADCAST_PROOF__.send(messages);
  }, [fixture.receipts[1], fixture.receipts[0], fixture.receipts[0]]);

  await receiver.locator("#status[data-status='pass']").waitFor({ timeout: 30_000 });
  const browserEvidence = await receiver.evaluate(() => window.__AXM_BROADCAST_PROOF__.evidence());

  assert.deepEqual(browserErrors, [], `browser errors: ${browserErrors.join(" | ")}`);
  assert.equal(browserEvidence.receivedMessages, 3);
  assert.equal(browserEvidence.normalizedRevision, 2);
  assert.equal(browserEvidence.normalizedHead, fixture.authorityCheckpoint.head);
  assert.deepEqual(browserEvidence.proposalIds, ["proposal-a", "proposal-b"]);
  assert.deepEqual(browserEvidence.state, nodeState);
  assert.equal(browserEvidence.digest, nodeDigest);

  await receiver.evaluate(() => window.__AXM_BROADCAST_PROOF__.close());
  await sender.evaluate(() => window.__AXM_BROADCAST_PROOF__.close());

  console.log("AXM Global State proof 006 browser-local receipt transport: PASS");
  console.log({
    transport: "BroadcastChannel",
    receivedMessages: browserEvidence.receivedMessages,
    normalizedRevision: browserEvidence.normalizedRevision,
    acceptedHead: browserEvidence.normalizedHead,
    finalStateDigest: browserEvidence.digest
  });
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
