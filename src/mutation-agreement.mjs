export const MUTATION_AGREEMENT_SCHEMA = 'axm.global-state.mutation-agreement/single-sequencer-v0';

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

function clone(value) {
  return structuredClone(value);
}

function requireText(value, code) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(code);
  return value;
}

function requireRevision(value, code = 'invalid-revision') {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}

function normalizeCommand(command) {
  if (!command || typeof command !== 'object') throw new Error('command-required');
  if (!Number.isSafeInteger(command.atTick) || command.atTick < 0) throw new Error('invalid-command-tick');
  requireText(command.type, 'command-type-required');
  const payload = command.payload === undefined ? {} : clone(command.payload);
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('command-payload-must-be-object');
  }
  return Object.freeze({
    atTick: command.atTick,
    type: command.type,
    payload: Object.freeze(payload)
  });
}

function normalizeProposal(proposal) {
  if (!proposal || typeof proposal !== 'object') throw new Error('proposal-required');
  return Object.freeze({
    id: requireText(proposal.id, 'proposal-id-required'),
    actorId: requireText(proposal.actorId, 'actor-id-required'),
    basedOnRevision: requireRevision(proposal.basedOnRevision, 'invalid-based-on-revision'),
    basedOnHead: requireText(proposal.basedOnHead, 'based-on-head-required'),
    command: normalizeCommand(proposal.command)
  });
}

function proposalFingerprint(proposal) {
  return digestValue({
    id: proposal.id,
    actorId: proposal.actorId,
    basedOnRevision: proposal.basedOnRevision,
    basedOnHead: proposal.basedOnHead,
    command: proposal.command
  });
}

export function fingerprintMutationProposal(inputProposal) {
  return proposalFingerprint(normalizeProposal(inputProposal));
}

function receiptCore({ sequence, proposal, previousHead }) {
  return {
    schema: MUTATION_AGREEMENT_SCHEMA,
    sequence,
    proposalId: proposal.id,
    actorId: proposal.actorId,
    basedOnRevision: proposal.basedOnRevision,
    basedOnHead: proposal.basedOnHead,
    command: proposal.command,
    previousHead
  };
}

function buildReceipt({ sequence, proposal, previousHead }) {
  const core = receiptCore({ sequence, proposal, previousHead });
  const acceptedHead = digestValue(core);
  return Object.freeze({ ...core, acceptedHead });
}

export function reconstructAcceptedReceiptFromProposal({
  proposal: inputProposal,
  sequence,
  acceptedHead
} = {}) {
  const proposal = normalizeProposal(inputProposal);
  const normalizedSequence = requireRevision(sequence, 'invalid-reconstructed-receipt-sequence');
  if (normalizedSequence === 0) throw new Error('invalid-reconstructed-receipt-sequence');
  const expectedAcceptedHead = requireText(acceptedHead, 'reconstructed-receipt-head-required');
  const receipt = buildReceipt({
    sequence: normalizedSequence,
    proposal,
    previousHead: proposal.basedOnHead
  });
  if (receipt.acceptedHead !== expectedAcceptedHead) {
    throw new Error(`reconstructed-receipt-head-mismatch:${proposal.id}`);
  }
  return receipt;
}

function receiptFingerprint(receipt) {
  return digestValue(receipt);
}

export class SingleSequencerAuthority {
  constructor({ checkpointRevision = 0, checkpointHead } = {}) {
    this.schema = MUTATION_AGREEMENT_SCHEMA;
    this.revision = requireRevision(checkpointRevision, 'invalid-checkpoint-revision');
    this.head = requireText(checkpointHead, 'checkpoint-head-required');
    this.accepted = [];
    this.acceptedByProposalId = new Map();
  }

  checkpoint() {
    return Object.freeze({
      schema: MUTATION_AGREEMENT_SCHEMA,
      revision: this.revision,
      head: this.head
    });
  }

  submit(inputProposal) {
    const proposal = normalizeProposal(inputProposal);
    const fingerprint = proposalFingerprint(proposal);
    const existing = this.acceptedByProposalId.get(proposal.id);

    if (existing) {
      if (existing.proposalFingerprint !== fingerprint) {
        throw new Error(`proposal-id-conflict:${proposal.id}`);
      }
      return Object.freeze({ accepted: true, duplicate: true, receipt: existing.receipt });
    }

    if (proposal.basedOnRevision !== this.revision || proposal.basedOnHead !== this.head) {
      throw new Error(`stale-proposal:${proposal.id}`);
    }

    const nextSequence = this.revision + 1;
    if (!Number.isSafeInteger(nextSequence)) throw new Error('revision-overflow');
    const receipt = buildReceipt({
      sequence: nextSequence,
      proposal,
      previousHead: this.head
    });

    this.revision = nextSequence;
    this.head = receipt.acceptedHead;
    this.accepted.push(receipt);
    this.acceptedByProposalId.set(proposal.id, { proposalFingerprint: fingerprint, receipt });

    return Object.freeze({ accepted: true, duplicate: false, receipt });
  }

  receipts() {
    return Object.freeze(this.accepted.map((receipt) => receipt));
  }
}

export function createSingleSequencerAuthority(options = {}) {
  return new SingleSequencerAuthority(options);
}

function validateReceiptShape(receipt) {
  if (!receipt || typeof receipt !== 'object') throw new Error('invalid-receipt');
  if (receipt.schema !== MUTATION_AGREEMENT_SCHEMA) throw new Error('invalid-receipt-schema');
  requireRevision(receipt.sequence, 'invalid-receipt-sequence');
  if (receipt.sequence === 0) throw new Error('invalid-receipt-sequence');
  requireText(receipt.proposalId, 'receipt-proposal-id-required');
  requireText(receipt.actorId, 'receipt-actor-id-required');
  requireRevision(receipt.basedOnRevision, 'invalid-receipt-based-on-revision');
  requireText(receipt.basedOnHead, 'receipt-based-on-head-required');
  normalizeCommand(receipt.command);
  requireText(receipt.previousHead, 'receipt-previous-head-required');
  requireText(receipt.acceptedHead, 'receipt-accepted-head-required');
}

function recomputeAcceptedHead(receipt) {
  return digestValue({
    schema: receipt.schema,
    sequence: receipt.sequence,
    proposalId: receipt.proposalId,
    actorId: receipt.actorId,
    basedOnRevision: receipt.basedOnRevision,
    basedOnHead: receipt.basedOnHead,
    command: receipt.command,
    previousHead: receipt.previousHead
  });
}

export function normalizeAcceptedReceipts(
  inputReceipts,
  { checkpointRevision = 0, checkpointHead } = {}
) {
  if (!Array.isArray(inputReceipts)) throw new Error('receipts-must-be-array');
  requireRevision(checkpointRevision, 'invalid-checkpoint-revision');
  requireText(checkpointHead, 'checkpoint-head-required');

  const bySequence = new Map();
  const byProposalId = new Map();

  for (const rawReceipt of inputReceipts) {
    validateReceiptShape(rawReceipt);
    const receipt = clone(rawReceipt);
    const fingerprint = receiptFingerprint(receipt);

    const priorSequence = bySequence.get(receipt.sequence);
    if (priorSequence && priorSequence.fingerprint !== fingerprint) {
      throw new Error(`receipt-sequence-conflict:${receipt.sequence}`);
    }

    const priorProposal = byProposalId.get(receipt.proposalId);
    if (priorProposal && priorProposal.fingerprint !== fingerprint) {
      throw new Error(`receipt-proposal-conflict:${receipt.proposalId}`);
    }

    bySequence.set(receipt.sequence, { fingerprint, receipt });
    byProposalId.set(receipt.proposalId, { fingerprint, receipt });
  }

  const ordered = [...bySequence.values()]
    .map((entry) => entry.receipt)
    .filter((receipt) => receipt.sequence > checkpointRevision)
    .sort((a, b) => a.sequence - b.sequence);

  let expectedSequence = checkpointRevision + 1;
  let currentHead = checkpointHead;

  for (const receipt of ordered) {
    if (receipt.sequence !== expectedSequence) {
      throw new Error(`receipt-sequence-gap:${expectedSequence}`);
    }
    if (receipt.basedOnRevision !== expectedSequence - 1) {
      throw new Error(`receipt-based-on-revision-mismatch:${receipt.sequence}`);
    }
    if (receipt.previousHead !== currentHead || receipt.basedOnHead !== currentHead) {
      throw new Error(`receipt-head-chain-mismatch:${receipt.sequence}`);
    }
    const expectedHead = recomputeAcceptedHead(receipt);
    if (receipt.acceptedHead !== expectedHead) {
      throw new Error(`receipt-digest-mismatch:${receipt.sequence}`);
    }
    currentHead = receipt.acceptedHead;
    expectedSequence += 1;
  }

  return Object.freeze({
    schema: MUTATION_AGREEMENT_SCHEMA,
    fromRevision: checkpointRevision,
    toRevision: expectedSequence - 1,
    head: currentHead,
    receipts: Object.freeze(ordered.map((receipt) => Object.freeze(receipt))),
    commands: Object.freeze(ordered.map((receipt) => Object.freeze({
      id: receipt.proposalId,
      ...clone(receipt.command)
    })))
  });
}

export function restoreSingleSequencerAuthority({
  checkpointRevision = 0,
  checkpointHead,
  acceptedReceipts = []
} = {}) {
  const normalized = normalizeAcceptedReceipts(acceptedReceipts, {
    checkpointRevision,
    checkpointHead
  });
  const authority = new SingleSequencerAuthority({ checkpointRevision, checkpointHead });

  for (const receipt of normalized.receipts) {
    const restoredReceipt = Object.freeze(clone(receipt));
    const proposal = normalizeProposal({
      id: receipt.proposalId,
      actorId: receipt.actorId,
      basedOnRevision: receipt.basedOnRevision,
      basedOnHead: receipt.basedOnHead,
      command: receipt.command
    });
    authority.revision = receipt.sequence;
    authority.head = receipt.acceptedHead;
    authority.accepted.push(restoredReceipt);
    authority.acceptedByProposalId.set(proposal.id, {
      proposalFingerprint: proposalFingerprint(proposal),
      receipt: restoredReceipt
    });
  }

  return authority;
}
