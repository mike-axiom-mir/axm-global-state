export const LOGICAL_TIME_INTERVAL_EVIDENCE_SCHEMA = 'axm.global-state.logical-time-interval-evidence/single-source-chain-v0';

const TRUST_SCOPES = new Set(['local-owner', 'shared-authority']);

function clone(value) {
  return structuredClone(value);
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function digestValue(value) {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function requireText(value, code) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(code);
  return value;
}

function requireNonNegativeSafeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}

function requireTrustScope(value) {
  if (!TRUST_SCOPES.has(value)) throw new Error('invalid-time-interval-trust-scope');
  return value;
}

function requireInterval(earliestTick, latestTick, prefix = 'time-interval') {
  const earliest = requireNonNegativeSafeInteger(earliestTick, `invalid-${prefix}-earliest-tick`);
  const latest = requireNonNegativeSafeInteger(latestTick, `invalid-${prefix}-latest-tick`);
  if (latest < earliest) throw new Error(`${prefix}-latest-before-earliest`);
  return { earliestTick: earliest, latestTick: latest };
}

function validateCheckpoint({
  sourceId,
  trustScope,
  contractId,
  checkpointSequence = 0,
  checkpointEarliestTick = 0,
  checkpointLatestTick = checkpointEarliestTick,
  checkpointHead
} = {}) {
  const interval = requireInterval(
    checkpointEarliestTick,
    checkpointLatestTick,
    'time-interval-checkpoint'
  );
  return {
    sourceId: requireText(sourceId, 'time-interval-source-id-required'),
    trustScope: requireTrustScope(trustScope),
    contractId: requireText(contractId, 'time-interval-contract-id-required'),
    checkpointSequence: requireNonNegativeSafeInteger(
      checkpointSequence,
      'invalid-time-interval-checkpoint-sequence'
    ),
    ...interval,
    checkpointHead: requireText(checkpointHead, 'time-interval-checkpoint-head-required')
  };
}

function evidenceCore({
  sourceId,
  trustScope,
  contractId,
  sequence,
  earliestTick,
  latestTick,
  previousHead
}) {
  return {
    schema: LOGICAL_TIME_INTERVAL_EVIDENCE_SCHEMA,
    sourceId,
    trustScope,
    contractId,
    sequence,
    earliestTick,
    latestTick,
    previousHead
  };
}

function validateEvidenceShape(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('invalid-time-interval-evidence');
  }
  if (evidence.schema !== LOGICAL_TIME_INTERVAL_EVIDENCE_SCHEMA) {
    throw new Error('invalid-time-interval-evidence-schema');
  }
  requireText(evidence.sourceId, 'time-interval-evidence-source-id-required');
  requireTrustScope(evidence.trustScope);
  requireText(evidence.contractId, 'time-interval-evidence-contract-id-required');
  requireNonNegativeSafeInteger(evidence.sequence, 'invalid-time-interval-evidence-sequence');
  if (evidence.sequence === 0) throw new Error('invalid-time-interval-evidence-sequence');
  requireInterval(evidence.earliestTick, evidence.latestTick, 'time-interval-evidence');
  requireText(evidence.previousHead, 'time-interval-evidence-previous-head-required');
  requireText(evidence.head, 'time-interval-evidence-head-required');
}

function evidenceFingerprint(evidence) {
  return digestValue(evidence);
}

function recomputeEvidenceHead(evidence) {
  return digestValue(evidenceCore(evidence));
}

export class LogicalTimeIntervalEvidenceIssuer {
  constructor(options = {}) {
    const checkpoint = validateCheckpoint(options);
    this.schema = LOGICAL_TIME_INTERVAL_EVIDENCE_SCHEMA;
    this.sourceId = checkpoint.sourceId;
    this.trustScope = checkpoint.trustScope;
    this.contractId = checkpoint.contractId;
    this.sequence = checkpoint.checkpointSequence;
    this.earliestTick = checkpoint.earliestTick;
    this.latestTick = checkpoint.latestTick;
    this.head = checkpoint.checkpointHead;
  }

  checkpoint() {
    return Object.freeze({
      schema: LOGICAL_TIME_INTERVAL_EVIDENCE_SCHEMA,
      sourceId: this.sourceId,
      trustScope: this.trustScope,
      contractId: this.contractId,
      sequence: this.sequence,
      earliestTick: this.earliestTick,
      latestTick: this.latestTick,
      head: this.head
    });
  }

  issue({ earliestTick, latestTick } = {}) {
    const interval = requireInterval(earliestTick, latestTick, 'time-interval-evidence');
    if (interval.earliestTick < this.earliestTick) {
      throw new Error('time-interval-evidence-guaranteed-lower-bound-rollback');
    }

    const sequence = this.sequence + 1;
    if (!Number.isSafeInteger(sequence)) throw new Error('time-interval-evidence-sequence-overflow');

    const core = evidenceCore({
      sourceId: this.sourceId,
      trustScope: this.trustScope,
      contractId: this.contractId,
      sequence,
      earliestTick: interval.earliestTick,
      latestTick: interval.latestTick,
      previousHead: this.head
    });
    const evidence = Object.freeze({ ...core, head: digestValue(core) });

    this.sequence = sequence;
    this.earliestTick = interval.earliestTick;
    this.latestTick = interval.latestTick;
    this.head = evidence.head;
    return evidence;
  }
}

export function createLogicalTimeIntervalEvidenceIssuer(options = {}) {
  return new LogicalTimeIntervalEvidenceIssuer(options);
}

export function normalizeLogicalTimeIntervalEvidence(inputEvidence, options = {}) {
  if (!Array.isArray(inputEvidence)) throw new Error('time-interval-evidence-must-be-array');
  const checkpoint = validateCheckpoint(options);

  const bySequence = new Map();
  for (const rawEvidence of inputEvidence) {
    validateEvidenceShape(rawEvidence);
    const evidence = clone(rawEvidence);
    const fingerprint = evidenceFingerprint(evidence);
    const prior = bySequence.get(evidence.sequence);
    if (prior && prior.fingerprint !== fingerprint) {
      throw new Error(`time-interval-evidence-sequence-conflict:${evidence.sequence}`);
    }
    bySequence.set(evidence.sequence, { fingerprint, evidence });
  }

  const ordered = [...bySequence.values()]
    .map((entry) => entry.evidence)
    .filter((evidence) => evidence.sequence > checkpoint.checkpointSequence)
    .sort((a, b) => a.sequence - b.sequence);

  let expectedSequence = checkpoint.checkpointSequence + 1;
  let currentEarliestTick = checkpoint.earliestTick;
  let currentLatestTick = checkpoint.latestTick;
  let currentHead = checkpoint.checkpointHead;

  for (const evidence of ordered) {
    if (evidence.sourceId !== checkpoint.sourceId) {
      throw new Error(`time-interval-evidence-source-mismatch:${evidence.sequence}`);
    }
    if (evidence.trustScope !== checkpoint.trustScope) {
      throw new Error(`time-interval-evidence-trust-scope-mismatch:${evidence.sequence}`);
    }
    if (evidence.contractId !== checkpoint.contractId) {
      throw new Error(`time-interval-evidence-contract-mismatch:${evidence.sequence}`);
    }
    if (evidence.sequence !== expectedSequence) {
      throw new Error(`time-interval-evidence-sequence-gap:${expectedSequence}`);
    }
    if (evidence.earliestTick < currentEarliestTick) {
      throw new Error(`time-interval-evidence-guaranteed-lower-bound-rollback:${evidence.sequence}`);
    }
    if (evidence.previousHead !== currentHead) {
      throw new Error(`time-interval-evidence-head-chain-mismatch:${evidence.sequence}`);
    }
    const expectedHead = recomputeEvidenceHead(evidence);
    if (evidence.head !== expectedHead) {
      throw new Error(`time-interval-evidence-digest-mismatch:${evidence.sequence}`);
    }

    currentEarliestTick = evidence.earliestTick;
    currentLatestTick = evidence.latestTick;
    currentHead = evidence.head;
    expectedSequence += 1;
  }

  const widthTicks = currentLatestTick - currentEarliestTick;
  if (!Number.isSafeInteger(widthTicks) || widthTicks < 0) {
    throw new Error('time-interval-evidence-width-invalid');
  }

  return Object.freeze({
    schema: LOGICAL_TIME_INTERVAL_EVIDENCE_SCHEMA,
    sourceId: checkpoint.sourceId,
    trustScope: checkpoint.trustScope,
    contractId: checkpoint.contractId,
    fromSequence: checkpoint.checkpointSequence,
    toSequence: expectedSequence - 1,
    earliestTick: currentEarliestTick,
    latestTick: currentLatestTick,
    widthTicks,
    head: currentHead,
    evidence: Object.freeze(ordered.map((item) => Object.freeze(clone(item))))
  });
}

export function restoreLogicalTimeIntervalEvidenceIssuer({ acceptedEvidence = [], ...options } = {}) {
  const normalized = normalizeLogicalTimeIntervalEvidence(acceptedEvidence, options);
  return new LogicalTimeIntervalEvidenceIssuer({
    sourceId: normalized.sourceId,
    trustScope: normalized.trustScope,
    contractId: normalized.contractId,
    checkpointSequence: normalized.toSequence,
    checkpointEarliestTick: normalized.earliestTick,
    checkpointLatestTick: normalized.latestTick,
    checkpointHead: normalized.head
  });
}
