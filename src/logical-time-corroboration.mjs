export const LOGICAL_TIME_CORROBORATION_SCHEMA = 'axm.global-state.logical-time-corroboration/v0';

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
  if (!TRUST_SCOPES.has(value)) throw new Error('invalid-time-corroboration-trust-scope');
  return value;
}

function compareCanonicalText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function canonicalSourceIds(sourceIds) {
  if (!Array.isArray(sourceIds) || sourceIds.length < 2) {
    throw new Error('time-corroboration-source-ids-required');
  }
  const normalized = sourceIds.map((sourceId) => requireText(sourceId, 'invalid-time-corroboration-source-id'));
  const unique = [...new Set(normalized)];
  if (unique.length !== normalized.length) throw new Error('duplicate-time-corroboration-source-id');
  return Object.freeze([...unique].sort(compareCanonicalText));
}

export function normalizeLogicalTimeCorroborationPolicy(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('time-corroboration-policy-required');
  }

  const sourceIds = canonicalSourceIds(input.sourceIds);
  const minSources = requireNonNegativeSafeInteger(input.minSources, 'invalid-time-corroboration-min-sources');
  if (minSources < 2 || minSources > sourceIds.length) {
    throw new Error('invalid-time-corroboration-min-sources');
  }

  return Object.freeze({
    schema: LOGICAL_TIME_CORROBORATION_SCHEMA,
    policyId: requireText(input.policyId, 'time-corroboration-policy-id-required'),
    trustScope: requireTrustScope(input.trustScope),
    contractId: requireText(input.contractId, 'time-corroboration-contract-id-required'),
    sourceIds,
    minSources,
    maxSpreadTicks: requireNonNegativeSafeInteger(
      input.maxSpreadTicks,
      'invalid-time-corroboration-max-spread-ticks'
    ),
    selection: 'largest-unique-cluster',
    admittedTickRule: 'conservative-min'
  });
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
  requireText(evidence.head, 'normalized-time-head-required');
}

function evidenceSummary(evidence) {
  return Object.freeze({
    sourceId: evidence.sourceId,
    tick: evidence.tick,
    sequence: evidence.toSequence,
    head: evidence.head
  });
}

function sourceSetKey(group) {
  return group.map((item) => item.sourceId).sort(compareCanonicalText).join('|');
}

function findAgreementGroups(evidence, policy) {
  const sorted = [...evidence].sort((a, b) => a.tick - b.tick || compareCanonicalText(a.sourceId, b.sourceId));
  const candidates = [];

  for (let left = 0; left < sorted.length; left += 1) {
    for (let right = left + policy.minSources - 1; right < sorted.length; right += 1) {
      const spread = sorted[right].tick - sorted[left].tick;
      if (spread > policy.maxSpreadTicks) break;
      const group = sorted.slice(left, right + 1);
      candidates.push({
        group,
        count: group.length,
        spreadTicks: spread,
        key: sourceSetKey(group)
      });
    }
  }

  if (candidates.length === 0) return [];
  const maxCount = Math.max(...candidates.map((candidate) => candidate.count));
  const byCount = candidates.filter((candidate) => candidate.count === maxCount);
  const minSpread = Math.min(...byCount.map((candidate) => candidate.spreadTicks));
  const best = byCount.filter((candidate) => candidate.spreadTicks === minSpread);

  const unique = new Map();
  for (const candidate of best) unique.set(candidate.key, candidate);
  return [...unique.values()];
}

export function evaluateLogicalTimeCorroboration(
  normalizedEvidence,
  { lastAdmittedTick, policy: inputPolicy } = {}
) {
  if (!Array.isArray(normalizedEvidence)) throw new Error('time-corroboration-evidence-must-be-array');
  const policy = normalizeLogicalTimeCorroborationPolicy(inputPolicy);
  const previousTick = requireNonNegativeSafeInteger(
    lastAdmittedTick,
    'invalid-last-admitted-time-tick'
  );

  const configured = new Set(policy.sourceIds);
  const seen = new Set();
  const eligible = [];
  const behind = [];

  for (const evidence of normalizedEvidence) {
    validateNormalizedEvidence(evidence);
    if (!configured.has(evidence.sourceId)) {
      throw new Error(`time-corroboration-source-not-configured:${evidence.sourceId}`);
    }
    if (seen.has(evidence.sourceId)) {
      throw new Error(`duplicate-time-corroboration-evidence-source:${evidence.sourceId}`);
    }
    seen.add(evidence.sourceId);

    if (evidence.trustScope !== policy.trustScope) {
      throw new Error(`time-corroboration-trust-scope-mismatch:${evidence.sourceId}`);
    }
    if (evidence.contractId !== policy.contractId) {
      throw new Error(`time-corroboration-contract-mismatch:${evidence.sourceId}`);
    }

    if (evidence.tick < previousTick) {
      behind.push(evidenceSummary(evidence));
    } else {
      eligible.push(evidence);
    }
  }

  const groups = findAgreementGroups(eligible, policy);
  if (groups.length === 0) {
    return Object.freeze({
      schema: LOGICAL_TIME_CORROBORATION_SCHEMA,
      policyId: policy.policyId,
      status: 'hold',
      reason: 'insufficient-corroboration',
      previousTick,
      admittedTick: previousTick,
      requiredSources: policy.minSources,
      configuredSourceIds: policy.sourceIds,
      observedSources: Object.freeze(eligible.map(evidenceSummary)),
      behindSources: Object.freeze(behind),
      requiredAction: 'more-corroborating-evidence-or-explicit-policy-change'
    });
  }

  if (groups.length > 1) {
    return Object.freeze({
      schema: LOGICAL_TIME_CORROBORATION_SCHEMA,
      policyId: policy.policyId,
      status: 'hold',
      reason: 'ambiguous-corroboration',
      previousTick,
      admittedTick: previousTick,
      candidateGroups: Object.freeze(groups.map((candidate) => Object.freeze({
        sourceIds: Object.freeze(candidate.group.map((item) => item.sourceId).sort(compareCanonicalText)),
        ticks: Object.freeze(candidate.group.map((item) => item.tick).sort((a, b) => a - b)),
        spreadTicks: candidate.spreadTicks
      }))),
      requiredAction: 'resolve-source-disagreement-or-change-corroboration-policy'
    });
  }

  const selected = groups[0];
  const admittedTick = Math.min(...selected.group.map((item) => item.tick));
  const deltaTicks = admittedTick - previousTick;
  if (!Number.isSafeInteger(deltaTicks) || deltaTicks < 0) throw new Error('time-corroboration-delta-invalid');

  const selectedIds = new Set(selected.group.map((item) => item.sourceId));
  const excludedConfiguredSourceIds = policy.sourceIds.filter((sourceId) => !selectedIds.has(sourceId));

  return Object.freeze({
    schema: LOGICAL_TIME_CORROBORATION_SCHEMA,
    policyId: policy.policyId,
    status: 'accepted',
    reason: deltaTicks === 0 ? 'same-tick-corroborated' : 'corroborated-forward-advance',
    previousTick,
    admittedTick,
    deltaTicks,
    spreadTicks: selected.spreadTicks,
    supportingSources: Object.freeze(selected.group.map(evidenceSummary)),
    excludedConfiguredSourceIds: Object.freeze(excludedConfiguredSourceIds),
    behindSources: Object.freeze(behind)
  });
}
