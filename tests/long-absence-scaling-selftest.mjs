import assert from "node:assert/strict";
import {
  advanceCatchup,
  advanceCatchupMeasured,
  digestState,
} from "../src/temporal-state-kernel.mjs";
import { commands, fixture, rules } from "./portable-fixture.mjs";

const intervals = [
  ["1 minute", 60],
  ["1 hour", 3_600],
  ["1 day", 86_400],
  ["30 days", 2_592_000],
  ["1 year", 31_536_000],
];

const results = intervals.map(([label, targetTick]) => {
  const measured = advanceCatchupMeasured(fixture(), targetTick, { commands, rules });
  const ordinary = advanceCatchup(fixture(), targetTick, { commands, rules });

  assert.deepEqual(measured.state, ordinary, `${label}: instrumentation must not change canonical state`);
  assert.equal(measured.metrics.elapsedTicks, targetTick, `${label}: elapsed ticks`);
  assert.equal(measured.metrics.ticksTraversed, targetTick, `${label}: traversed ticks`);
  assert.equal(
    measured.metrics.perTickTransitionsAvoided,
    targetTick - measured.metrics.jumpCount,
    `${label}: avoided transition accounting`,
  );
  assert.ok(measured.metrics.jumpCount <= targetTick, `${label}: catch-up must not exceed per-tick stepping`);

  return {
    label,
    targetTick,
    digest: digestState(measured.state),
    ...measured.metrics,
  };
});

const oneYear = results.at(-1);
assert.equal(oneYear.recurringEventsApplied, 525_600, "one year should cross every 60-tick recurring event");
assert.equal(oneYear.completionsApplied, 2);
assert.equal(oneYear.commandsApplied, 3);
assert.equal(oneYear.eventApplications, 525_605);
assert.equal(oneYear.jumpCount, 525_604);
assert.ok(oneYear.perTickTransitionsAvoided > 31_000_000);
assert.ok(oneYear.largestJumpTicks >= 60);

console.log("AXM Global State proof 003: PASS");
console.log(JSON.stringify(results, null, 2));
