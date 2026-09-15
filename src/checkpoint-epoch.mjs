import {
  normalizeAcceptedReceipts,
  restoreSingleSequencerAuthority
} from './mutation-agreement.mjs';
import { digestState } from './temporal-state-kernel.mjs';

export const CHECKPOINT_EPOCH_SCHEMA = 'axm.global-state.checkpoint-epoch/v0';

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

function epochPrefix(epochId) {
  return `${requireText(epochId, 'checkpoint-epoch-id-required')}::`;
}

export function qualifyEpochProposalId(epochId, localProposalId) {
  return `${epochPrefix(epochId)}${requireText(localProposalId, 'local-proposal-id-required')}`;
}

export function createCheckpointEpoch({
  checkpointRevision,
  checkpointHead,
  state,
  priorEpochId = 'genesis'
} = {}) {
  requireRevision(checkpointRevision, 'invalid-checkpoint-epoch-revision');
  requireText(checkpointHead, 'checkpoint-epoch-head-required');
  requireText(priorEpochId, 'prior-checkpoint-epoch-id-required');
  if (!state || typeof state !== 'object') throw new Error('checkpoint-epoch-state-required');
  if (!state.appliedCommands || typeof state.appliedCommands !== 'object' || Array.isArray(state.appliedCommands)) {
    throw new Error('checkpoint-epoch-applied-commands-required');
  }
  if (!Number.isSafeInteger(state.tick) || state.tick < 0) throw new Error('checkpoint-epoch-state-tick-invalid');

  const sourceState = clone(state);
  const sourceStateDigest = digestState(sourceState);
  const retiredCommandCount = Object.keys(sourceState.appliedCommands).length;
  const compactedState = clone(sourceState);
  compactedState.appliedCommands = {};
  const compactedStateDigest = digestState(compactedState);

  const epochCore = {
    schema: CHECKPOINT_EPOCH_SCHEMA,
    priorEpochId,
    checkpointRevision,
    checkpointHead,
    checkpointTick: sourceState.tick,
    sourceStateDigest,
    compactedStateDigest
  };
  const epochId = digestValue(epochCore);

  return Object.freeze({
    ...epochCore,
    epochId,
    retiredCommandCount,
    compactedState
  });
}

export function normalizeEpochAcceptedReceipts(
  inputReceipts,
  { checkpointRevision, checkpointHead, epochId } = {}
) {
  const prefix = epochPrefix(epochId);
  const normalized = normalizeAcceptedReceipts(inputReceipts, {
    checkpointRevision,
    checkpointHead
  });

  for (const receipt of normalized.receipts) {
    if (!receipt.proposalId.startsWith(prefix)) {
      throw new Error(`checkpoint-epoch-receipt-mismatch:${receipt.sequence}`);
    }
  }
  for (const command of normalized.commands) {
    if (!command.id.startsWith(prefix)) {
      throw new Error(`checkpoint-epoch-command-mismatch:${command.id}`);
    }
  }

  return normalized;
}

export class EpochBoundSequencerAuthority {
  constructor({
    checkpointRevision,
    checkpointHead,
    epochId,
    acceptedReceipts = []
  } = {}) {
    this.schema = CHECKPOINT_EPOCH_SCHEMA;
    this.epochId = requireText(epochId, 'checkpoint-epoch-id-required');
    this.checkpointRevision = requireRevision(checkpointRevision, 'invalid-checkpoint-epoch-revision');
    this.checkpointHead = requireText(checkpointHead, 'checkpoint-epoch-head-required');

    normalizeEpochAcceptedReceipts(acceptedReceipts, {
      checkpointRevision: this.checkpointRevision,
      checkpointHead: this.checkpointHead,
      epochId: this.epochId
    });
    this.authority = restoreSingleSequencerAuthority({
      checkpointRevision: this.checkpointRevision,
      checkpointHead: this.checkpointHead,
      acceptedReceipts
    });
  }

  checkpoint() {
    const checkpoint = this.authority.checkpoint();
    return Object.freeze({
      schema: CHECKPOINT_EPOCH_SCHEMA,
      epochId: this.epochId,
      revision: checkpoint.revision,
      head: checkpoint.head
    });
  }

  submit(inputProposal) {
    if (!inputProposal || typeof inputProposal !== 'object') throw new Error('epoch-proposal-required');
    if (inputProposal.epochId !== this.epochId) {
      throw new Error(`proposal-epoch-mismatch:${String(inputProposal.epochId)}`);
    }
    const localProposalId = requireText(inputProposal.id, 'local-proposal-id-required');
    const result = this.authority.submit({
      id: qualifyEpochProposalId(this.epochId, localProposalId),
      actorId: inputProposal.actorId,
      basedOnRevision: inputProposal.basedOnRevision,
      basedOnHead: inputProposal.basedOnHead,
      command: inputProposal.command
    });
    return Object.freeze({
      ...result,
      epochId: this.epochId,
      localProposalId
    });
  }

  receipts() {
    return this.authority.receipts();
  }
}

export function createEpochBoundSequencerAuthority(options = {}) {
  return new EpochBoundSequencerAuthority(options);
}
