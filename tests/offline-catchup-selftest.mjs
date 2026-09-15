import assert from "node:assert/strict";
import {
  advanceCatchup,
  advanceReference,
  createState,
  digestState,
  makeReceipt,
} from "../src/temporal-state-kernel.mjs";

const rules = {
  version: "axm-global-state-proof-001",
  recurringEvery: 60,
  recurringRewardMilli: 7,
};

const commands = [
  {
    id: "cmd-001",
    atTick: 17,
    type: "stock.add",
    payload: { amountMilli: 31 },
  },
  {
    id: "cmd-002",
    atTick: 90,
    type: "rate.set",
    payload: { ratePerTickMilli: 5 },
  },
  {
    id: "cmd-003",
    atTick: 120,
    type: "stock.add",
    payload: { amountMilli: -11 },
  },
];

function fixture() {
  return createState({
    tick: 0,
    stockMilli: 1000,
    ratePerTickMilli: 3,
    rulesVersion: rules.version,
    completions: [
      { id: "build-a", atTick: 45, rewardMilli: 101 },
      { id: "build-b", atTick: 121, rewardMilli: 13 },
    ],
  });
}

for (const target of [0, 1, 17, 45, 60, 90, 120, 121, 3600, 86400]) {
  const reference = advanceReference(fixture(), target, { commands, rules });
  const catchup = advanceCatchup(fixture(), target, { commands, rules });

  assert.deepEqual(catchup, reference, `state mismatch at tick ${target}`);
  assert.equal(
    digestState(catchup),
    digestState(reference),
    `digest mismatch at tick ${target}`,
  );
}

const once = advanceCatchup(fixture(), 120, { commands, rules });
const replaySame = advanceCatchup(once, 120, { commands, rules });
assert.deepEqual(replaySame, once, "same command replay must be idempotent");

assert.throws(
  () =>
    advanceCatchup(once, 120, {
      commands: [
        {
          id: "cmd-003",
          atTick: 120,
          type: "stock.add",
          payload: { amountMilli: 999 },
        },
      ],
      rules,
    }),
  /command-id-conflict/,
  "conflicting command reuse must fail closed",
);

assert.throws(
  () => advanceCatchup(once, 119, { commands, rules }),
  /time-cannot-move-backward/,
);

assert.throws(
  () =>
    advanceCatchup(fixture(), 10, {
      commands,
      rules: { ...rules, version: "different-rules" },
    }),
  /rules-version-mismatch/,
);

const serialized = JSON.stringify(
  advanceCatchup(fixture(), 121, { commands, rules }),
);
const restored = JSON.parse(serialized);
const afterRestart = advanceCatchup(restored, 3600, { commands, rules });
const direct = advanceCatchup(fixture(), 3600, { commands, rules });

assert.deepEqual(
  afterRestart,
  direct,
  "serialized checkpoint must reconstruct the same future state",
);
assert.equal(makeReceipt(afterRestart).digest, makeReceipt(direct).digest);

const oneYear = advanceCatchup(fixture(), 31_536_000, { commands, rules });
assert.equal(oneYear.tick, 31_536_000);
assert.equal(oneYear.recurringCount, 31_536_000 / 60);

console.log("AXM Global State proof 001: PASS");
console.log(makeReceipt(direct));
console.log({
  oneYearTick: oneYear.tick,
  recurringCount: oneYear.recurringCount,
});
