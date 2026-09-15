export const LOGICAL_TIME_EVIDENCE_SCHEMA = 'axm.global-state.logical-time-evidence/single-source-chain-v0';

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
  if (!TRUST_SCOPES.has(value)) throw new Error('invalid-time-trust-scope');
  return value;
}

function evidenceCore({ sourceId, trustScope, contractId, sequence, tick, previousHead }) {
  return {
    schema: LOGICAL_TIME_EVIDENCE_SCHEMA,
    sourceId,
    trustScope,
    contractId,
    sequence,
    tick,
    previousHead
  };
}

function evidenceFingerprint(evidence) {
  return digestValue(evidence);
}

function validateCheckpoint({
  checkpointSequence = 0,
  checkpointTick = 0,
  checkpointHead,
  sourceId,
  trustScope,
  contractId
} = {}) {
  return {
    checkpointSequence: requireNonNegativeSafeInteger(checkpointSequence, 'invalid-time-checkpoint-sequence'),
    checkpointTick: requireNonNegativeSafeInteger(checkpointTick, 'invalid-time-checkpoint-tick'),
    checkpointHead: requireText(checkpointHead, 'time-checkpoint-head-required'),
    sourceId: requireText(sourceId, 'time-source-id-required'),
    trustScope: requireTrustScope(trustScope),
    contractId: requireText(contractId, 'time-contract-id-required')
  };
}

function validateEvidenceShape(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('invalid-time-evidence');
  }
  if (evidence.schema !== LOGICAL_TIME_EVIDENCE_SCHEMA) {
    throw new Error('invalid-time-evidence-schema');
  }
  requireText(evidence.sourceId, 'time-evidence-source-id-required');
  requireTrustScope(evidence.trustScope);
  requireText(evidence.contractId, 'time-evidence-contract-id-required');
  requireNonNegativeSafeInteger(evidence.sequence, 'invalid-time-evidence-sequence');
  if (evidence.sequence === 0) throw new Error('invalid-time-evidence-sequence');
  requireNonNegativeSafeInteger(evidence.tick, 'invalid-time-evidence-tick');
  requireText(evidence.previousHead, 'time-evidence-previous-head-required');
  requireText(evidence.head, 'time-evidence-head-required');
}

function recomputeEvidenceHead(evidence) {
  return digestValue(evidenceCore(evidence));
}

export class LogicalTimeEvidenceIssuer {
  constructor(options = {}) {
    const checkpoint = validateCheckpoint(options);
    this.schema = LOGICAL_TIME_EVIDENCE_SCHEMA;
    this.sourceId = checkpoint.sourceId;
    this.trustScope = checkpoint.trustScope;
    this.contractId = checkpoint.contractId;
    this.sequence = checkpoint.checkpointSequence;
    this.tick = checkpoint.checkpointTick;
    this.head = checkpoint.checkpointHead;
  }

  checkpoint() {
    return Object.freeze({
      schema: LOGICAL_TIME_EVIDENCE_SCHEMA,
      sourceId: this.sourceId,
      trustScope: this.trustScope,
      contractId: this.contractId,
      sequence: this.sequence,
      tick: this.tick,
      head: this.head
    });
  }

  issue(nextTick) {
    const tick = requireNonNegativeSafeInteger(nextTick, 'invalid-time-evidence-tick');
    if (tick < this.tick) throw new Error('time-evidence-rollback');

    const sequence = this.sequence + 1;
    if (!Number.isSafeInteger(sequence)) throw new Error('time-evidence-sequence-overflow');

    const core = evidenceCore({
      sourceId: this.sourceId,
      trustScope: this.trustScope,
      contractId: this.contractId,
      sequence,
      tick,
      previousHead: this.head
    });
    const evidence = Object.freeze({ ...core, head: digestValue(core) });

    this.sequence = sequence;
    this.tick = tick;
    this.head = evidence.head;
    return evidence;
  }
}

export function createLogicalTimeEvidenceIssuer(options = {}) {
  return new LogicalTimeEvidenceIssuer(options);
}

export function normalizeLogicalTimeEvidence(inputEvidence, options = {}) {
  if (!Array.isArray(inputEvidence)) throw new Error('time-evidence-must-be-array');
  const checkpoint = validateCheckpoint(options);

  const bySequence = new Map();
  for (const rawEvidence of inputEvidence) {
    validateEvidenceShape(rawEvidence);
    const evidence = clone(rawEvidence);
    const fingerprint = evidenceFingerprint(evidence);
    const prior = bySequence.get(evidence.sequence);
    if (prior && prior.fingerprint !== fingerprint) {
      throw new Error(`time-evidence-sequence-conflict:${evidence.sequence}`);
    }
    bySequence.set(evidence.sequence, { fingerprint, evidence });
  }

  const ordered = [...bySequence.values()]
    .map((entry) => entry.evidence)
    .filter((evidence) => evidence.sequence > checkpoint.checkpointSequence)
    .sort((a, b) => a.sequence - b.sequence);

  let expectedSequence = checkpoint.checkpointSequence + 1;
  let currentTick = checkpoint.checkpointTick;
  let currentHead = checkpoint.checkpointHead;

  for (const evidence of ordered) {
    if (evidence.sourceId !== checkpoint.sourceId) {
      throw new Error(`time-evidence-source-mismatch:${evidence.sequence}`);
    }
    if (evidence.trustScope !== checkpoint.trustScope) {
      throw new Error(`time-evidence-trust-scope-mismatch:${evidence.sequence}`);
    }
    if (evidence.contractId !== checkpoint.contractId) {
      throw new Error(`time-evidence-contract-mismatch:${evidence.sequence}`);
    }
    if (evidence.sequence !== expectedSequence) {
      throw new Error(`time-evidence-sequence-gap:${expectedSequence}`);
    }
    if (evidence.tick < currentTick) {
      throw new Error(`time-evidence-rollback:${evidence.sequence}`);
    }
    if (evidence.previousHead !== currentHead) {
      throw new Error(`time-evidence-head-chain-mismatch:${evidence.sequence}`);
    }
    const expectedHead = recomputeEvidenceHead(evidence);
    if (evidence.head !== expectedHead) {
      throw new Error(`time-evidence-digest-mismatch:${evidence.sequence}`);
    }

    currentTick = evidence.tick;
    currentHead = evidence.head;
    expectedSequence += 1;
  }

  return Object.freeze({
    schema: LOGICAL_TIME_EVIDENCE_SCHEMA,
    sourceId: checkpoint.sourceId,
    trustScope: checkpoint.trustScope,
    contractId: checkpoint.contractId,
    fromSequence: checkpoint.checkpointSequence,
    toSequence: expectedSequence - 1,
    tick: currentTick,
    head: currentHead,
    evidence: Object.freeze(ordered.map((item) => Object.freeze(clone(item))))
  });
}

export function restoreLogicalTimeEvidenceIssuer({ acceptedEvidence = [], ...options } = {}) {
  const normalized = normalizeLogicalTimeEvidence(acceptedEvidence, options);
  return new LogicalTimeEvidenceIssuer({
    sourceId: normalized.sourceId,
    trustScope: normalized.trustScope,
    contractId: normalized.contractId,
    checkpointSequence: normalized.toSequence,
    checkpointTick: normalized.tick,
    checkpointHead: normalized.head
  });
}
