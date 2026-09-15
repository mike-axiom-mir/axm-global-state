import {
  advanceCatchup,
  createState,
  digestState,
  makeReceipt,
} from "../src/temporal-state-kernel.mjs";

export const rules = Object.freeze({
  version: "axm-global-state-proof-001",
  recurringEvery: 60,
  recurringRewardMilli: 7,
});

export const commands = Object.freeze([
  Object.freeze({
    id: "cmd-001",
    atTick: 17,
    type: "stock.add",
    payload: Object.freeze({ amountMilli: 31 }),
  }),
  Object.freeze({
    id: "cmd-002",
    atTick: 90,
    type: "rate.set",
    payload: Object.freeze({ ratePerTickMilli: 5 }),
  }),
  Object.freeze({
    id: "cmd-003",
    atTick: 120,
    type: "stock.add",
    payload: Object.freeze({ amountMilli: -11 }),
  }),
]);

export const portableTargets = Object.freeze([
  0,
  1,
  17,
  45,
  60,
  90,
  120,
  121,
  3600,
  86400,
  2_592_000,
]);

export function fixture() {
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

export function buildPortableProof() {
  const matrix = portableTargets.map((targetTick) => {
    const state = advanceCatchup(fixture(), targetTick, { commands, rules });
    return {
      targetTick,
      state,
      digest: digestState(state),
    };
  });

  const checkpoint = advanceCatchup(fixture(), 121, { commands, rules });
  const restored = JSON.parse(JSON.stringify(checkpoint));
  const restartState = advanceCatchup(restored, 3600, { commands, rules });

  return {
    proof: "AXM Global State Proof 002",
    rulesVersion: rules.version,
    matrix,
    restart: {
      state: restartState,
      receipt: makeReceipt(restartState),
    },
  };
}
