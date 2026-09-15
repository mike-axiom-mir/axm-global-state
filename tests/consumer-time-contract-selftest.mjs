import assert from 'node:assert/strict';
import {
  CONSUMER_TIME_CONTRACT_SCHEMA,
  createConsumerTimeContract,
  planConsumerCatchup
} from '../src/consumer-time-contract.mjs';

const closedForm = createConsumerTimeContract({
  id: 'example.linear-economy',
  version: 'v0',
  mode: 'closed-form',
  timeUnit: 'second',
  ruleVersion: 'linear-economy/v1'
});
assert.equal(closedForm.schema, CONSUMER_TIME_CONTRACT_SCHEMA);
assert.deepEqual(
  planConsumerCatchup(closedForm, { checkpointTick: 100, targetTick: 3700 }),
  {
    schema: CONSUMER_TIME_CONTRACT_SCHEMA,
    consumerId: 'example.linear-economy',
    contractVersion: 'v0',
    ruleVersion: 'linear-economy/v1',
    mode: 'closed-form',
    checkpointTick: 100,
    targetTick: 3700,
    elapsedTicks: 3600
  }
);

const fixedQuantum = createConsumerTimeContract({
  id: 'example.hourly-economy',
  version: 'v0',
  mode: 'fixed-quantum',
  timeUnit: 'second',
  ruleVersion: 'hourly-economy/v1',
  quantumTicks: 60,
  phaseTick: 0,
  remainderPolicy: 'hold'
});
const fixedPlan = planConsumerCatchup(fixedQuantum, {
  checkpointTick: 0,
  targetTick: 3661
});
assert.equal(fixedPlan.fullStepCount, 61);
assert.equal(fixedPlan.appliedThroughTick, 3660);
assert.equal(fixedPlan.pendingTicks, 1);
assert.equal(fixedPlan.remainderPolicy, 'hold');
assert.throws(
  () => planConsumerCatchup(fixedQuantum, { checkpointTick: 17, targetTick: 100 }),
  /checkpoint-not-on-fixed-quantum-boundary/,
  'fixed-quantum checkpoints must preserve the declared phase'
);

const eventBoundary = createConsumerTimeContract({
  id: 'example.event-world',
  version: 'v0',
  mode: 'event-boundary',
  timeUnit: 'second',
  ruleVersion: 'event-world/v1'
});
const eventPlan = planConsumerCatchup(eventBoundary, {
  checkpointTick: 50,
  targetTick: 300,
  boundaryTicks: [4000, 120, 60, 120, 300, 50, 1]
});
assert.deepEqual(eventPlan.orderedBoundaryTicks, [60, 120, 300]);
assert.equal(eventPlan.boundaryCount, 3);

assert.throws(
  () => createConsumerTimeContract({ id: 'x', version: 'v0', mode: 'fixed-quantum', ruleVersion: 'v1' }),
  /fixed-quantum-requires-positive-quantum/
);
assert.throws(
  () => createConsumerTimeContract({ id: 'x', version: 'v0', mode: 'closed-form', ruleVersion: 'v1', quantumTicks: 60 }),
  /quantum-fields-only-valid-for-fixed-quantum/
);
assert.throws(
  () => createConsumerTimeContract({ id: 'x', version: 'v0', mode: 'unknown', ruleVersion: 'v1' }),
  /invalid-consumer-time-mode/
);
assert.throws(
  () => planConsumerCatchup(eventBoundary, { checkpointTick: 300, targetTick: 299, boundaryTicks: [] }),
  /time-cannot-move-backward/
);

console.log('AXM Global State consumer time contract v0: PASS');
