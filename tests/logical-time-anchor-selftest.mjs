import assert from 'node:assert/strict';
import {
  createLogicalTimeAnchor,
  observeLogicalTime
} from '../src/logical-time-anchor.mjs';

const anchor = createLogicalTimeAnchor({
  anchorUnixMs: 1_800_000_000_000,
  anchorTick: 0,
  tickDurationMs: 1000,
  clockSourceId: 'proof-explicit-clock'
});

assert.deepEqual(observeLogicalTime(anchor, 1_800_000_000_000), {
  schema: 'axm.global-state.logical-time-anchor/v0',
  clockSourceId: 'proof-explicit-clock',
  observedUnixMs: 1_800_000_000_000,
  elapsedMs: 0,
  elapsedWholeTicks: 0,
  remainderMs: 0,
  targetTick: 0
});

assert.equal(
  observeLogicalTime(anchor, 1_800_003_600_000).targetTick,
  3600,
  'one hour of wall time maps to one hour of logical seconds'
);
assert.equal(
  observeLogicalTime(anchor, 1_800_086_400_000).targetTick,
  86_400,
  'one cold day maps directly to the corresponding logical tick without live ticking'
);

const fractional = observeLogicalTime(anchor, 1_800_000_001_999);
assert.equal(fractional.targetTick, 1);
assert.equal(fractional.remainderMs, 999, 'sub-tick wall time remains explicit rather than silently rounded forward');

const offsetAnchor = createLogicalTimeAnchor({
  anchorUnixMs: 2_000_000,
  anchorTick: 500,
  tickDurationMs: 250,
  clockSourceId: 'offset-proof-clock'
});
assert.equal(observeLogicalTime(offsetAnchor, 2_002_500).targetTick, 510);

assert.throws(
  () => observeLogicalTime(anchor, 1_799_999_999_999),
  /clock-observation-before-anchor/
);
assert.throws(
  () => createLogicalTimeAnchor({ anchorUnixMs: 0, tickDurationMs: 0 }),
  /invalid-tick-duration-ms/
);
assert.throws(
  () => createLogicalTimeAnchor({ anchorUnixMs: 0, clockSourceId: '' }),
  /clock-source-id-required/
);
assert.throws(
  () => observeLogicalTime({ ...anchor, schema: 'wrong' }, 1_800_000_000_000),
  /logical-time-anchor-schema-mismatch/
);

console.log('AXM Global State logical time anchor v0: PASS');
console.log({
  anchorUnixMs: anchor.anchorUnixMs,
  tickDurationMs: anchor.tickDurationMs,
  oneDayTargetTick: observeLogicalTime(anchor, 1_800_086_400_000).targetTick
});
