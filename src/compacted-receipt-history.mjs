import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  fingerprintMutationProposal,
  normalizeAcceptedReceipts,
  reconstructAcceptedReceiptFromProposal,
  restoreSingleSequencerAuthority
} from './mutation-agreement.mjs';

export const COMPACTED_RECEIPT_HISTORY_SCHEMA = 'axm.global-state.compacted-receipt-history/file-json-v0';
export const COMPACTED_PROPOSAL_EVIDENCE_SCHEMA = 'axm.global-state.compacted-proposal-evidence/v0';

function clone(value) {
  return structuredClone(value);
}

function requireText(value, code) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(code);
  return value;
}

function requireRevision(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}

function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

function digestValue(value) {
  const text = canonicalStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function proposalFromReceipt(receipt) {
  return {
    id: receipt.proposalId,
    actorId: receipt.actorId,
    basedOnRevision: receipt.basedOnRevision,
    basedOnHead: receipt.basedOnHead,
    command: clone(receipt.command)
  };
}

function evidenceDigest({ checkpointRevision, checkpointHead, evidenceFloorRevision, entries }) {
  return digestValue({
    schema: COMPACTED_PROPOSAL_EVIDENCE_SCHEMA,
    checkpointRevision,
    checkpointHead,
    evidenceFloorRevision,
    entries
  });
}

function normalizeCompactedEvidence(
  inputEntries,
  { checkpointRevision, checkpointHead, evidenceFloorRevision, expectedDigest }
) {
  if (!Array.isArray(inputEntries)) throw new Error('compacted-evidence-must-be-array');
  const checkpoint = requireRevision(checkpointRevision, 'invalid-compacted-checkpoint-revision');
  const floor = requireRevision(evidenceFloorRevision, 'invalid-compacted-evidence-floor');
  requireText(checkpointHead, 'compacted-checkpoint-head-required');
  requireText(expectedDigest, 'compacted-evidence-digest-required');
  if (floor === 0) throw new Error('invalid-compacted-evidence-floor');
  if (floor > checkpoint + 1) throw new Error('compacted-evidence-floor-after-checkpoint');

  const normalized = inputEntries.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('invalid-compacted-evidence-entry');
    const sequence = requireRevision(raw.sequence, 'invalid-compacted-evidence-sequence');
    if (sequence === 0) throw new Error('invalid-compacted-evidence-sequence');
    return Object.freeze({
      proposalId: requireText(raw.proposalId, 'compacted-evidence-proposal-id-required'),
      proposalFingerprint: requireText(raw.proposalFingerprint, 'compacted-evidence-fingerprint-required'),
      sequence,
      acceptedHead: requireText(raw.acceptedHead, 'compacted-evidence-accepted-head-required')
    });
  }).sort((a, b) => a.sequence - b.sequence);

  const ids = new Set();
  let expectedSequence = floor;
  for (const entry of normalized) {
    if (entry.sequence !== expectedSequence) {
      throw new Error(`compacted-evidence-sequence-gap:${expectedSequence}`);
    }
    if (entry.sequence > checkpoint) throw new Error('compacted-evidence-after-checkpoint');
    if (ids.has(entry.proposalId)) throw new Error(`compacted-evidence-proposal-conflict:${entry.proposalId}`);
    ids.add(entry.proposalId);
    expectedSequence += 1;
  }

  const expectedEntryCount = checkpoint >= floor ? checkpoint - floor + 1 : 0;
  if (normalized.length !== expectedEntryCount) throw new Error('compacted-evidence-count-mismatch');

  const digest = evidenceDigest({
    checkpointRevision: checkpoint,
    checkpointHead,
    evidenceFloorRevision: floor,
    entries: normalized
  });
  if (digest !== expectedDigest) throw new Error('compacted-evidence-digest-mismatch');

  return Object.freeze(normalized.map((entry) => Object.freeze(clone(entry))));
}

function snapshotDocument({
  checkpointRevision,
  checkpointHead,
  evidenceFloorRevision,
  evidenceDigest: proposalEvidenceDigest,
  compactedProposalEvidence,
  receipts
}) {
  return {
    schema: COMPACTED_RECEIPT_HISTORY_SCHEMA,
    checkpointRevision,
    checkpointHead,
    evidenceFloorRevision,
    proposalEvidenceDigest,
    compactedProposalEvidence: clone(compactedProposalEvidence),
    receipts: clone(receipts)
  };
}

async function persistAtomic(filePath, document) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(document)}\n`, 'utf8');
  await rename(temporary, filePath);
}

export function compactAcceptedReceiptWindow({
  checkpointRevision = 0,
  checkpointHead,
  acceptedReceipts = [],
  throughRevision
} = {}) {
  const sourceRevision = requireRevision(checkpointRevision, 'invalid-source-checkpoint-revision');
  requireText(checkpointHead, 'source-checkpoint-head-required');
  const through = requireRevision(throughRevision, 'invalid-compaction-through-revision');
  const normalized = normalizeAcceptedReceipts(acceptedReceipts, {
    checkpointRevision: sourceRevision,
    checkpointHead
  });

  if (through <= sourceRevision) throw new Error('compaction-must-advance-checkpoint');
  if (through > normalized.toRevision) throw new Error('compaction-through-future-revision');

  const prefix = normalized.receipts.filter((receipt) => receipt.sequence <= through);
  const tail = normalized.receipts.filter((receipt) => receipt.sequence > through);
  const throughReceipt = prefix.at(-1);
  if (!throughReceipt || throughReceipt.sequence !== through) throw new Error('compaction-prefix-incomplete');

  const compactedProposalEvidence = prefix.map((receipt) => Object.freeze({
    proposalId: receipt.proposalId,
    proposalFingerprint: fingerprintMutationProposal(proposalFromReceipt(receipt)),
    sequence: receipt.sequence,
    acceptedHead: receipt.acceptedHead
  }));
  const evidenceFloorRevision = sourceRevision + 1;
  const proposalEvidenceDigest = evidenceDigest({
    checkpointRevision: through,
    checkpointHead: throughReceipt.acceptedHead,
    evidenceFloorRevision,
    entries: compactedProposalEvidence
  });

  return Object.freeze({
    schema: COMPACTED_RECEIPT_HISTORY_SCHEMA,
    sourceCheckpoint: Object.freeze({ revision: sourceRevision, head: checkpointHead }),
    checkpoint: Object.freeze({
      revision: through,
      head: throughReceipt.acceptedHead,
      evidenceFloorRevision,
      proposalEvidenceDigest
    }),
    compactedProposalEvidence: Object.freeze(compactedProposalEvidence),
    retainedReceipts: Object.freeze(tail.map((receipt) => Object.freeze(clone(receipt))))
  });
}

class CompactedSequencerAuthority {
  constructor({ checkpointRevision, checkpointHead, compactedProposalEvidence, acceptedReceipts }) {
    this.compactedByProposalId = new Map(
      compactedProposalEvidence.map((entry) => [entry.proposalId, clone(entry)])
    );
    this.live = restoreSingleSequencerAuthority({
      checkpointRevision,
      checkpointHead,
      acceptedReceipts
    });
  }

  checkpoint() {
    return this.live.checkpoint();
  }

  receipts() {
    return this.live.receipts();
  }

  submit(inputProposal) {
    const proposalId = typeof inputProposal?.id === 'string' ? inputProposal.id : null;
    const compacted = proposalId ? this.compactedByProposalId.get(proposalId) : null;
    if (!compacted) return this.live.submit(inputProposal);

    const fingerprint = fingerprintMutationProposal(inputProposal);
    if (fingerprint !== compacted.proposalFingerprint) {
      throw new Error(`proposal-id-conflict:${compacted.proposalId}`);
    }
    const receipt = reconstructAcceptedReceiptFromProposal({
      proposal: inputProposal,
      sequence: compacted.sequence,
      acceptedHead: compacted.acceptedHead
    });
    return Object.freeze({
      accepted: true,
      duplicate: true,
      compacted: true,
      receipt
    });
  }
}

export class CompactedFileReceiptHistory {
  constructor({
    filePath,
    checkpointRevision,
    checkpointHead,
    evidenceFloorRevision,
    proposalEvidenceDigest,
    compactedProposalEvidence,
    receipts
  }) {
    this.filePath = filePath;
    this.checkpointRevision = checkpointRevision;
    this.checkpointHead = checkpointHead;
    this.evidenceFloorRevision = evidenceFloorRevision;
    this.proposalEvidenceDigest = proposalEvidenceDigest;
    this.compactedProposalEvidence = clone(compactedProposalEvidence);
    this.receipts = clone(receipts);
  }

  compactionCheckpoint() {
    return Object.freeze({
      revision: this.checkpointRevision,
      head: this.checkpointHead,
      evidenceFloorRevision: this.evidenceFloorRevision,
      proposalEvidenceDigest: this.proposalEvidenceDigest
    });
  }

  normalized() {
    return normalizeAcceptedReceipts(this.receipts, {
      checkpointRevision: this.checkpointRevision,
      checkpointHead: this.checkpointHead
    });
  }

  checkpoint() {
    const normalized = this.normalized();
    return Object.freeze({ revision: normalized.toRevision, head: normalized.head });
  }

  compactedEvidence() {
    return Object.freeze(this.compactedProposalEvidence.map((entry) => Object.freeze(clone(entry))));
  }

  allReceipts() {
    return Object.freeze(this.normalized().receipts.map((receipt) => Object.freeze(clone(receipt))));
  }

  receiptsAfter(revision) {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('invalid-receipts-after-revision');
    if (revision < this.checkpointRevision) {
      throw new Error(`receipts-before-compaction-floor:${this.checkpointRevision}`);
    }
    const current = this.checkpoint();
    if (revision > current.revision) throw new Error('receipts-after-future-revision');
    return Object.freeze(
      this.allReceipts()
        .filter((receipt) => receipt.sequence > revision)
        .map((receipt) => Object.freeze(clone(receipt)))
    );
  }

  restoreAuthority() {
    return new CompactedSequencerAuthority({
      checkpointRevision: this.checkpointRevision,
      checkpointHead: this.checkpointHead,
      compactedProposalEvidence: this.compactedProposalEvidence,
      acceptedReceipts: this.receipts
    });
  }

  async append(receipt) {
    if (!receipt || typeof receipt !== 'object') throw new Error('receipt-required');
    if (Number.isSafeInteger(receipt.sequence) && receipt.sequence <= this.checkpointRevision) {
      const compacted = this.compactedProposalEvidence.find((entry) => entry.proposalId === receipt.proposalId);
      if (!compacted || compacted.sequence !== receipt.sequence || compacted.acceptedHead !== receipt.acceptedHead) {
        throw new Error('compacted-receipt-append-conflict');
      }
      return Object.freeze({ duplicate: true, revision: this.checkpoint().revision, head: this.checkpoint().head });
    }

    const before = this.normalized();
    const normalized = normalizeAcceptedReceipts([...this.receipts, clone(receipt)], {
      checkpointRevision: this.checkpointRevision,
      checkpointHead: this.checkpointHead
    });
    const duplicate = normalized.receipts.length === before.receipts.length;
    if (!duplicate) {
      if (normalized.toRevision !== before.toRevision + 1) throw new Error('compacted-history-noncontiguous-append');
      this.receipts = normalized.receipts.map((item) => clone(item));
      await persistAtomic(this.filePath, snapshotDocument({
        checkpointRevision: this.checkpointRevision,
        checkpointHead: this.checkpointHead,
        evidenceFloorRevision: this.evidenceFloorRevision,
        evidenceDigest: this.proposalEvidenceDigest,
        compactedProposalEvidence: this.compactedProposalEvidence,
        receipts: this.receipts
      }));
    }
    return Object.freeze({ duplicate, revision: normalized.toRevision, head: normalized.head });
  }
}

function verifyDocument(document, expected) {
  if (!document || typeof document !== 'object') throw new Error('compacted-history-invalid-document');
  if (document.schema !== COMPACTED_RECEIPT_HISTORY_SCHEMA) throw new Error('compacted-history-schema-mismatch');
  if (document.checkpointRevision !== expected.checkpointRevision) throw new Error('compacted-history-checkpoint-revision-mismatch');
  if (document.checkpointHead !== expected.checkpointHead) throw new Error('compacted-history-checkpoint-head-mismatch');
  if (document.evidenceFloorRevision !== expected.evidenceFloorRevision) throw new Error('compacted-history-evidence-floor-mismatch');
  if (document.proposalEvidenceDigest !== expected.proposalEvidenceDigest) throw new Error('compacted-history-evidence-digest-mismatch');
  if (!Array.isArray(document.receipts)) throw new Error('compacted-history-receipts-required');

  const compactedProposalEvidence = normalizeCompactedEvidence(document.compactedProposalEvidence, {
    checkpointRevision: document.checkpointRevision,
    checkpointHead: document.checkpointHead,
    evidenceFloorRevision: document.evidenceFloorRevision,
    expectedDigest: document.proposalEvidenceDigest
  });
  const normalized = normalizeAcceptedReceipts(document.receipts, {
    checkpointRevision: document.checkpointRevision,
    checkpointHead: document.checkpointHead
  });
  const compactedIds = new Set(compactedProposalEvidence.map((entry) => entry.proposalId));
  for (const receipt of normalized.receipts) {
    if (compactedIds.has(receipt.proposalId)) throw new Error(`compacted-live-proposal-overlap:${receipt.proposalId}`);
  }
  return { compactedProposalEvidence, normalized };
}

export async function createCompactedFileReceiptHistory({
  filePath,
  checkpointRevision = 0,
  checkpointHead,
  acceptedReceipts = [],
  throughRevision
} = {}) {
  requireText(filePath, 'compacted-history-file-path-required');
  const compacted = compactAcceptedReceiptWindow({
    checkpointRevision,
    checkpointHead,
    acceptedReceipts,
    throughRevision
  });
  const document = snapshotDocument({
    checkpointRevision: compacted.checkpoint.revision,
    checkpointHead: compacted.checkpoint.head,
    evidenceFloorRevision: compacted.checkpoint.evidenceFloorRevision,
    evidenceDigest: compacted.checkpoint.proposalEvidenceDigest,
    compactedProposalEvidence: compacted.compactedProposalEvidence,
    receipts: compacted.retainedReceipts
  });
  await persistAtomic(filePath, document);
  return new CompactedFileReceiptHistory({
    filePath,
    checkpointRevision: document.checkpointRevision,
    checkpointHead: document.checkpointHead,
    evidenceFloorRevision: document.evidenceFloorRevision,
    proposalEvidenceDigest: document.proposalEvidenceDigest,
    compactedProposalEvidence: document.compactedProposalEvidence,
    receipts: document.receipts
  });
}

export async function openCompactedFileReceiptHistory({
  filePath,
  checkpointRevision,
  checkpointHead,
  evidenceFloorRevision,
  proposalEvidenceDigest
} = {}) {
  requireText(filePath, 'compacted-history-file-path-required');
  const expected = {
    checkpointRevision: requireRevision(checkpointRevision, 'invalid-compacted-checkpoint-revision'),
    checkpointHead: requireText(checkpointHead, 'compacted-checkpoint-head-required'),
    evidenceFloorRevision: requireRevision(evidenceFloorRevision, 'invalid-compacted-evidence-floor'),
    proposalEvidenceDigest: requireText(proposalEvidenceDigest, 'compacted-evidence-digest-required')
  };
  let document;
  try {
    document = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('compacted-history-invalid-json');
    throw error;
  }
  const verified = verifyDocument(document, expected);
  return new CompactedFileReceiptHistory({
    filePath,
    checkpointRevision: document.checkpointRevision,
    checkpointHead: document.checkpointHead,
    evidenceFloorRevision: document.evidenceFloorRevision,
    proposalEvidenceDigest: document.proposalEvidenceDigest,
    compactedProposalEvidence: verified.compactedProposalEvidence,
    receipts: verified.normalized.receipts
  });
}
