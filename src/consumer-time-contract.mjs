export const CONSUMER_TIME_CONTRACT_SCHEMA = 'axm.global-state.consumer-time-contract/v0';

export const CONSUMER_TIME_MODES = Object.freeze([
  'closed-form',
  'fixed-quantum',
  'event-boundary'
]);

function requireText(value, code) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(code);
  return value;
}

function requireTick(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}

function compareNumber(a, b) {
  return a - b;
}

export function createConsumerTimeContract({
  id,
  version,
  mode,
  timeUnit = 'tick',
  ruleVersion,
  quantumTicks = null,
  phaseTick = 0,
  remainderPolicy = null
} = {}) {
  requireText(id, 'consumer-id-required');
  requireText(version, 'consumer-contract-version-required');
  requireText(timeUnit, 'consumer-time-unit-required');
  requireText(ruleVersion, 'consumer-rule-version-required');
  if (!CONSUMER_TIME_MODES.includes(mode)) throw new Error('invalid-consumer-time-mode');

  if (mode === 'fixed-quantum') {
    if (!Number.isSafeInteger(quantumTicks) || quantumTicks <= 0) {
      throw new Error('fixed-quantum-requires-positive-quantum');
    }
    requireTick(phaseTick, 'invalid-fixed-quantum-phase');
    if (remainderPolicy !== 'hold') {
      throw new Error('fixed-quantum-v0-remainder-policy-must-hold');
    }
  } else if (quantumTicks !== null || remainderPolicy !== null || phaseTick !== 0) {
    throw new Error('quantum-fields-only-valid-for-fixed-quantum');
  }

  return Object.freeze({
    schema: CONSUMER_TIME_CONTRACT_SCHEMA,
    id,
    version,
    mode,
    timeUnit,
    ruleVersion,
    quantumTicks,
    phaseTick,
    remainderPolicy
  });
}

function validateRange(checkpointTick, targetTick) {
  requireTick(checkpointTick, 'invalid-checkpoint-tick');
  requireTick(targetTick, 'invalid-target-tick');
  if (targetTick < checkpointTick) throw new Error('time-cannot-move-backward');
}

function fixedQuantumPlan(contract, checkpointTick, targetTick) {
  const { quantumTicks, phaseTick } = contract;
  const relativeCheckpoint = checkpointTick - phaseTick;
  if (relativeCheckpoint < 0 || relativeCheckpoint % quantumTicks !== 0) {
    throw new Error('checkpoint-not-on-fixed-quantum-boundary');
  }

  const elapsedTicks = targetTick - checkpointTick;
  const fullStepCount = Math.floor(elapsedTicks / quantumTicks);
  const appliedThroughTick = checkpointTick + fullStepCount * quantumTicks;
  if (!Number.isSafeInteger(appliedThroughTick)) throw new Error('fixed-quantum-plan-overflow');
  const pendingTicks = targetTick - appliedThroughTick;

  return Object.freeze({
    schema: CONSUMER_TIME_CONTRACT_SCHEMA,
    consumerId: contract.id,
    contractVersion: contract.version,
    ruleVersion: contract.ruleVersion,
    mode: contract.mode,
    checkpointTick,
    targetTick,
    quantumTicks,
    fullStepCount,
    appliedThroughTick,
    pendingTicks,
    remainderPolicy: contract.remainderPolicy
  });
}

function eventBoundaryPlan(contract, checkpointTick, targetTick, boundaryTicks) {
  if (!Array.isArray(boundaryTicks)) throw new Error('event-boundary-ticks-required');
  const orderedBoundaryTicks = [...new Set(boundaryTicks.map((tick) => requireTick(tick, 'invalid-event-boundary-tick')))]
    .filter((tick) => tick > checkpointTick && tick <= targetTick)
    .sort(compareNumber);

  return Object.freeze({
    schema: CONSUMER_TIME_CONTRACT_SCHEMA,
    consumerId: contract.id,
    contractVersion: contract.version,
    ruleVersion: contract.ruleVersion,
    mode: contract.mode,
    checkpointTick,
    targetTick,
    orderedBoundaryTicks: Object.freeze(orderedBoundaryTicks),
    boundaryCount: orderedBoundaryTicks.length
  });
}

export function planConsumerCatchup(
  contract,
  { checkpointTick, targetTick, boundaryTicks = [] } = {}
) {
  if (!contract || contract.schema !== CONSUMER_TIME_CONTRACT_SCHEMA) {
    throw new Error('invalid-consumer-time-contract');
  }
  validateRange(checkpointTick, targetTick);

  if (contract.mode === 'closed-form') {
    return Object.freeze({
      schema: CONSUMER_TIME_CONTRACT_SCHEMA,
      consumerId: contract.id,
      contractVersion: contract.version,
      ruleVersion: contract.ruleVersion,
      mode: contract.mode,
      checkpointTick,
      targetTick,
      elapsedTicks: targetTick - checkpointTick
    });
  }

  if (contract.mode === 'fixed-quantum') {
    return fixedQuantumPlan(contract, checkpointTick, targetTick);
  }

  if (contract.mode === 'event-boundary') {
    return eventBoundaryPlan(contract, checkpointTick, targetTick, boundaryTicks);
  }

  throw new Error('unsupported-consumer-time-mode');
}
