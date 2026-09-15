export const LOGICAL_TIME_ANCHOR_SCHEMA = 'axm.global-state.logical-time-anchor/v0';

function requireSafeInteger(value, code) {
  if (!Number.isSafeInteger(value)) throw new Error(code);
  return value;
}

function requireNonEmptyText(value, code) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(code);
  return value;
}

function safeSubtract(a, b, code) {
  requireSafeInteger(a, code);
  requireSafeInteger(b, code);
  const result = a - b;
  if (!Number.isSafeInteger(result)) throw new Error(code);
  return result;
}

function safeAdd(a, b, code) {
  requireSafeInteger(a, code);
  requireSafeInteger(b, code);
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new Error(code);
  return result;
}

export function createLogicalTimeAnchor({
  anchorUnixMs,
  anchorTick = 0,
  tickDurationMs = 1000,
  clockSourceId = 'explicit-external-clock'
} = {}) {
  requireSafeInteger(anchorUnixMs, 'invalid-anchor-unix-ms');
  requireSafeInteger(anchorTick, 'invalid-anchor-tick');
  requireSafeInteger(tickDurationMs, 'invalid-tick-duration-ms');
  requireNonEmptyText(clockSourceId, 'clock-source-id-required');

  if (anchorUnixMs < 0) throw new Error('invalid-anchor-unix-ms');
  if (anchorTick < 0) throw new Error('invalid-anchor-tick');
  if (tickDurationMs <= 0) throw new Error('invalid-tick-duration-ms');

  return Object.freeze({
    schema: LOGICAL_TIME_ANCHOR_SCHEMA,
    anchorUnixMs,
    anchorTick,
    tickDurationMs,
    clockSourceId
  });
}

export function observeLogicalTime(inputAnchor, observedUnixMs) {
  if (!inputAnchor || typeof inputAnchor !== 'object') throw new Error('logical-time-anchor-required');
  if (inputAnchor.schema !== LOGICAL_TIME_ANCHOR_SCHEMA) throw new Error('logical-time-anchor-schema-mismatch');

  const anchor = createLogicalTimeAnchor(inputAnchor);
  requireSafeInteger(observedUnixMs, 'invalid-observed-unix-ms');
  if (observedUnixMs < 0) throw new Error('invalid-observed-unix-ms');

  const elapsedMs = safeSubtract(observedUnixMs, anchor.anchorUnixMs, 'logical-time-elapsed-overflow');
  if (elapsedMs < 0) throw new Error('clock-observation-before-anchor');

  const elapsedWholeTicks = Math.floor(elapsedMs / anchor.tickDurationMs);
  if (!Number.isSafeInteger(elapsedWholeTicks)) throw new Error('logical-time-tick-overflow');

  const targetTick = safeAdd(anchor.anchorTick, elapsedWholeTicks, 'logical-time-tick-overflow');
  const remainderMs = elapsedMs % anchor.tickDurationMs;

  return Object.freeze({
    schema: LOGICAL_TIME_ANCHOR_SCHEMA,
    clockSourceId: anchor.clockSourceId,
    observedUnixMs,
    elapsedMs,
    elapsedWholeTicks,
    remainderMs,
    targetTick
  });
}
