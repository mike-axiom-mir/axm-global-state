export const LOGICAL_TIME_ADMISSION_SCHEMA = 'axm.global-state.logical-time-admission/v0';

const MODES = new Set(['unbounded-monotonic', 'max-forward-delta']);
const TRUST_SCOPES = new Set(['local-owner', 'shared-authority']);

function requireText(value, code) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(code);
  return value;
}

function requireNonNegativeSafeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}

function requireTrustScope(value) {
  if (!TRUST_SCOPES.has(value)) throw new Error('invalid-time-admission-trust-scope');
  return value;
}

export function normalizeLogicalTimeAdmissionPolicy(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('time-admission-policy-required');
  }

  const mode = requireText(input.mode, 'time-admission-mode-required');
  if (!MODES.has(mode)) throw new Error('invalid-time-admission-mode');

  const policy = {
    schema: LOGICAL_TIME_ADMISSION_SCHEMA,
    policyId: requireText(input.policyId, 'time-admission-policy-id-required'),
    sourceId: requireText(input.sourceId, 'time-admission-source-id-required'),
    trustScope: requireTrustScope(input.trustScope),
    contractId: requireText(input.contractId, 'time-admission-contract-id-required'),
    mode
  };

  if (mode === 'max-forward-delta') {
    policy.maxForwardTicks = requireNonNegativeSafeInteger(
      input.maxForwardTicks,
      'invalid-time-admission-max-forward-ticks'
    );
  } else if (input.maxForwardTicks !== undefined) {
    throw new Error('time-admission-max-forward-ticks-not-allowed');
  }

  return Object.freeze(policy);
}

function validateNormalizedEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('normalized-time-evidence-required');
  }
  requireText(evidence.sourceId, 'normalized-time-source-id-required');
  requireTrustScope(evidence.trustScope);
  requireText(evidence.contractId, 'normalized-time-contract-id-required');
  requireNonNegativeSafeInteger(evidence.tick, 'invalid-normalized-time-tick');
  requireNonNegativeSafeInteger(evidence.toSequence, 'invalid-normalized-time-sequence');
}

export function evaluateLogicalTimeAdmission(
  normalizedEvidence,
  { lastAdmittedTick, policy: inputPolicy } = {}
) {
  validateNormalizedEvidence(normalizedEvidence);
  const policy = normalizeLogicalTimeAdmissionPolicy(inputPolicy);
  const previousTick = requireNonNegativeSafeInteger(
    lastAdmittedTick,
    'invalid-last-admitted-time-tick'
  );

  if (normalizedEvidence.sourceId !== policy.sourceId) {
    throw new Error('time-admission-source-mismatch');
  }
  if (normalizedEvidence.trustScope !== policy.trustScope) {
    throw new Error('time-admission-trust-scope-mismatch');
  }
  if (normalizedEvidence.contractId !== policy.contractId) {
    throw new Error('time-admission-contract-mismatch');
  }
  if (normalizedEvidence.tick < previousTick) {
    throw new Error('time-admission-rollback');
  }

  const deltaTicks = normalizedEvidence.tick - previousTick;
  if (!Number.isSafeInteger(deltaTicks)) throw new Error('time-admission-delta-overflow');

  if (policy.mode === 'max-forward-delta' && deltaTicks > policy.maxForwardTicks) {
    return Object.freeze({
      schema: LOGICAL_TIME_ADMISSION_SCHEMA,
      policyId: policy.policyId,
      mode: policy.mode,
      status: 'hold',
      reason: 'forward-delta-exceeds-policy',
      evidenceSequence: normalizedEvidence.toSequence,
      previousTick,
      candidateTick: normalizedEvidence.tick,
      deltaTicks,
      maxForwardTicks: policy.maxForwardTicks,
      admittedTick: previousTick,
      requiredAction: 'explicit-policy-change-or-corroboration'
    });
  }

  return Object.freeze({
    schema: LOGICAL_TIME_ADMISSION_SCHEMA,
    policyId: policy.policyId,
    mode: policy.mode,
    status: 'accepted',
    reason: deltaTicks === 0 ? 'same-tick' : 'within-policy',
    evidenceSequence: normalizedEvidence.toSequence,
    previousTick,
    candidateTick: normalizedEvidence.tick,
    deltaTicks,
    ...(policy.mode === 'max-forward-delta'
      ? { maxForwardTicks: policy.maxForwardTicks }
      : {}),
    admittedTick: normalizedEvidence.tick
  });
}
