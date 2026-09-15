export const LOGICAL_TIME_INTERVAL_CORROBORATION_SCHEMA = 'axm.global-state.logical-time-interval-corroboration/v0';

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
  if (!TRUST_SCOPES.has(value)) throw new Error('invalid-time-interval-corroboration-trust-scope');
  return value;
}

function compareCanonicalText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function canonicalSourceIds(sourceIds) {
  if (!Array.isArray(sourceIds) || sourceIds.length < 2) {
    throw new Error('time-interval-corroboration-source-ids-required');
  }
  const normalized = sourceIds.map((sourceId) => requireText(
    sourceId,
    'invalid-time-interval-corroboration-source-id'
  ));
  const unique = [...new Set(normalized)];
  if (unique.length !== normalized.length) {
    throw new Error('duplicate-time-interval-corroboration-source-id');
  }
  return Object.freeze(unique.sort(compareCanonicalText));
}

export function normalizeLogicalTimeIntervalCorroborationPolicy(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('time-interval-corroboration-policy-required');
  }

  const sourceIds = canonicalSourceIds(input.sourceIds);
  const minSources = requireNonNegativeSafeInteger(
    input.minSources,
    'invalid-time-interval-corroboration-min-sources'
  );
  if (minSources < 2 || minSources > sourceIds.length) {
    throw new Error('invalid-time-interval-corroboration-min-sources');
  }

  return Object.freeze({
    schema: LOGICAL_TIME_INTERVAL_CORROBORATION_SCHEMA,
    policyId: requireText(input.policyId, 'time-interval-corroboration-policy-id-required'),
    trustScope: requireTrustScope(input.trustScope),
    contractId: requireText(input.contractId, 'time-interval-corroboration-contract-id-required'),
    sourceIds,
    minSources,
    maxSourceWidthTicks: requireNonNegativeSafeInteger(
      input.maxSourceWidthTicks,
      'invalid-time-interval-corroboration-max-source-width'
    ),
    maxIntersectionWidthTicks: requireNonNegativeSafeInteger(
      input.maxIntersectionWidthTicks,
      'invalid-time-interval-corroboration-max-intersection-width'
    ),
    selection: 'largest-unique-overlap-cluster',
    admittedTickRule: 'intersection-lower-bound'
  });
}

function validateNormalizedIntervalEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('normalized-time-interval-evidence-required');
  }
  requireText(evidence.sourceId, 'normalized-time-interval-source-id-required');
  requireTrustScope(evidence.trustScope);
  requireText(evidence.contractId, 'normalized-time-interval-contract-id-required');
  requireNonNegativeSafeInteger(evidence.toSequence, 'invalid-normalized-time-interval-sequence');
  const earliestTick = requireNonNegativeSafeInteger(
    evidence.earliestTick,
    'invalid-normalized-time-interval-earliest'
  );
  const latestTick = requireNonNegativeSafeInteger(
    evidence.latestTick,
    'invalid-normalized-time-interval-latest'
  );
  if (latestTick < earliestTick) throw new Error('normalized-time-interval-latest-before-earliest');
  requireText(evidence.head, 'normalized-time-interval-head-required');
}

function intervalWidth(evidence) {
  const width = evidence.latestTick - evidence.earliestTick;
  if (!Number.isSafeInteger(width) || width < 0) throw new Error('time-interval-width-invalid');
  return width;
}

function evidenceSummary(evidence) {
  return Object.freeze({
    sourceId: evidence.sourceId,
    earliestTick: evidence.earliestTick,
    latestTick: evidence.latestTick,
    widthTicks: intervalWidth(evidence),
    sequence: evidence.toSequence,
    head: evidence.head
  });
}

function groupKey(group) {
  return group.map((item) => item.sourceId).sort(compareCanonicalText).join('|');
}

function intersectionFor(group, lastAdmittedTick) {
  const earliestTick = Math.max(
    lastAdmittedTick,
    ...group.map((item) => item.earliestTick)
  );
  const latestTick = Math.min(...group.map((item) => item.latestTick));
  if (latestTick < earliestTick) return null;
  const widthTicks = latestTick - earliestTick;
  if (!Number.isSafeInteger(widthTicks) || widthTicks < 0) return null;
  return { earliestTick, latestTick, widthTicks };
}

function findAgreementGroups(evidence, policy, lastAdmittedTick) {
  const probeTicks = new Set([lastAdmittedTick]);
  for (const item of evidence) {
    probeTicks.add(Math.max(lastAdmittedTick, item.earliestTick));
  }

  const candidates = new Map();
  for (const probe of [...probeTicks].sort((a, b) => a - b)) {
    const group = evidence.filter((item) => item.earliestTick <= probe && item.latestTick >= probe);
    if (group.length < policy.minSources) continue;
    const intersection = intersectionFor(group, lastAdmittedTick);
    if (!intersection) continue;
    if (intersection.widthTicks > policy.maxIntersectionWidthTicks) continue;
    const key = groupKey(group);
    candidates.set(key, {
      group,
      count: group.length,
      ...intersection,
      key
    });
  }

  const all = [...candidates.values()];
  if (all.length === 0) return [];
  const maxCount = Math.max(...all.map((candidate) => candidate.count));
  const byCount = all.filter((candidate) => candidate.count === maxCount);
  const minWidth = Math.min(...byCount.map((candidate) => candidate.widthTicks));
  return byCount.filter((candidate) => candidate.widthTicks === minWidth);
}

export function evaluateLogicalTimeIntervalCorroboration(
  normalizedEvidence,
  { lastAdmittedTick, policy: inputPolicy } = {}
) {
  if (!Array.isArray(normalizedEvidence)) {
    throw new Error('time-interval-corroboration-evidence-must-be-array');
  }
  const policy = normalizeLogicalTimeIntervalCorroborationPolicy(inputPolicy);
  const previousTick = requireNonNegativeSafeInteger(
    lastAdmittedTick,
    'invalid-last-admitted-time-tick'
  );

  const configured = new Set(policy.sourceIds);
  const seen = new Set();
  const eligible = [];
  const behind = [];
  const tooUncertain = [];

  for (const evidence of normalizedEvidence) {
    validateNormalizedIntervalEvidence(evidence);
    if (!configured.has(evidence.sourceId)) {
      throw new Error(`time-interval-corroboration-source-not-configured:${evidence.sourceId}`);
    }
    if (seen.has(evidence.sourceId)) {
      throw new Error(`duplicate-time-interval-corroboration-evidence-source:${evidence.sourceId}`);
    }
    seen.add(evidence.sourceId);

    if (evidence.trustScope !== policy.trustScope) {
      throw new Error(`time-interval-corroboration-trust-scope-mismatch:${evidence.sourceId}`);
    }
    if (evidence.contractId !== policy.contractId) {
      throw new Error(`time-interval-corroboration-contract-mismatch:${evidence.sourceId}`);
    }

    if (evidence.latestTick < previousTick) {
      behind.push(evidenceSummary(evidence));
      continue;
    }

    if (intervalWidth(evidence) > policy.maxSourceWidthTicks) {
      tooUncertain.push(evidenceSummary(evidence));
      continue;
    }

    eligible.push(evidence);
  }

  const groups = findAgreementGroups(eligible, policy, previousTick);
  if (groups.length === 0) {
    return Object.freeze({
      schema: LOGICAL_TIME_INTERVAL_CORROBORATION_SCHEMA,
      policyId: policy.policyId,
      status: 'hold',
      reason: 'insufficient-interval-corroboration',
      previousTick,
      admittedTick: previousTick,
      requiredSources: policy.minSources,
      configuredSourceIds: policy.sourceIds,
      observedSources: Object.freeze(eligible.map(evidenceSummary)),
      behindSources: Object.freeze(behind),
      tooUncertainSources: Object.freeze(tooUncertain),
      requiredAction: 'more-overlapping-bounded-evidence-or-explicit-policy-change'
    });
  }

  if (groups.length > 1) {
    return Object.freeze({
      schema: LOGICAL_TIME_INTERVAL_CORROBORATION_SCHEMA,
      policyId: policy.policyId,
      status: 'hold',
      reason: 'ambiguous-interval-corroboration',
      previousTick,
      admittedTick: previousTick,
      candidateGroups: Object.freeze(groups.map((candidate) => Object.freeze({
        sourceIds: Object.freeze(candidate.group.map((item) => item.sourceId).sort(compareCanonicalText)),
        intersectionEarliestTick: candidate.earliestTick,
        intersectionLatestTick: candidate.latestTick,
        intersectionWidthTicks: candidate.widthTicks
      }))),
      requiredAction: 'resolve-interval-disagreement-or-change-corroboration-policy'
    });
  }

  const selected = groups[0];
  const admittedTick = selected.earliestTick;
  const deltaTicks = admittedTick - previousTick;
  if (!Number.isSafeInteger(deltaTicks) || deltaTicks < 0) {
    throw new Error('time-interval-corroboration-delta-invalid');
  }

  const selectedIds = new Set(selected.group.map((item) => item.sourceId));
  return Object.freeze({
    schema: LOGICAL_TIME_INTERVAL_CORROBORATION_SCHEMA,
    policyId: policy.policyId,
    status: 'accepted',
    reason: deltaTicks === 0 ? 'same-tick-interval-corroborated' : 'interval-corroborated-forward-advance',
    previousTick,
    admittedTick,
    deltaTicks,
    intersectionEarliestTick: selected.earliestTick,
    intersectionLatestTick: selected.latestTick,
    intersectionWidthTicks: selected.widthTicks,
    supportingSources: Object.freeze(selected.group.map(evidenceSummary)),
    excludedConfiguredSourceIds: Object.freeze(
      policy.sourceIds.filter((sourceId) => !selectedIds.has(sourceId))
    ),
    behindSources: Object.freeze(behind),
    tooUncertainSources: Object.freeze(tooUncertain)
  });
}
