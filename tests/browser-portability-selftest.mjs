import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildPortableProof } from "./portable-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const requested = path.resolve(repoRoot, relative || "tests/browser-proof.html");
    const withinRoot = requested === repoRoot || requested.startsWith(`${repoRoot}${path.sep}`);
    if (!withinRoot) {
      response.writeHead(403).end("forbidden");
      return;
    }
    const body = await readFile(requested);
    response.writeHead(200, {
      "content-type": mime.get(path.extname(requested)) || "application/octet-stream",
      "cache-control": "no-store",
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

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await page.goto(`http://127.0.0.1:${address.port}/tests/browser-proof.html`, {
    waitUntil: "load",
  });
  await page.locator("#result[data-status='pass']").waitFor({ timeout: 30_000 });

  assert.deepEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join(" | ")}`);

  const browserProof = JSON.parse(await page.locator("#result").textContent());
  const nodeProof = buildPortableProof();
  assert.deepEqual(
    browserProof,
    nodeProof,
    "Node and Chromium canonical proof output must match exactly",
  );

  console.log("AXM Global State proof 002: PASS");
  console.log({
    comparedTargets: nodeProof.matrix.length,
    largestTargetTick: nodeProof.matrix.at(-1).targetTick,
    restartDigest: nodeProof.restart.receipt.digest,
  });
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
