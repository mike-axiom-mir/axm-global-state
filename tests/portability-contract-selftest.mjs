import assert from "node:assert/strict";
import { advanceCatchup, createState } from "../src/temporal-state-kernel.mjs";
import { commands, fixture, rules } from "./portable-fixture.mjs";

assert.throws(
  () =>
    advanceCatchup(
      createState({
        stockMilli: Number.MAX_SAFE_INTEGER,
        ratePerTickMilli: 1,
        rulesVersion: rules.version,
      }),
      1,
      { rules },
    ),
  /stock-overflow/,
  "canonical integer overflow must fail closed",
);

const missingHistory = advanceCatchup(fixture(), 20, { commands, rules });
delete missingHistory.appliedCommands["cmd-001"];
assert.throws(
  () => advanceCatchup(missingHistory, 21, { commands, rules }),
  /unapplied-command-before-current-tick/,
  "a checkpoint missing an earlier accepted command must fail closed",
);

const sameTickCommands = [
  { id: "z-last", atTick: 0, type: "stock.add", payload: { amountMilli: 1 } },
  { id: "a-first", atTick: 0, type: "stock.add", payload: { amountMilli: 2 } },
];
const canonicalOrderState = advanceCatchup(
  createState({ rulesVersion: rules.version }),
  0,
  { commands: sameTickCommands, rules },
);
assert.deepEqual(
  Object.keys(canonicalOrderState.appliedCommands),
  ["a-first", "z-last"],
  "same-tick command ordering must use deterministic code-unit order",
);

console.log("AXM Global State portability contract: PASS");
