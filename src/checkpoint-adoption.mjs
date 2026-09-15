import {
  normalizeCheckpointEpoch,
  normalizeEpochAcceptedReceipts
} from './checkpoint-epoch.mjs';

export const CHECKPOINT_ADOPTION_SCHEMA = 'axm.global-state.checkpoint-adoption/v0';

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

export function createCheckpointAdoptionPackage({
  epoch,
  acceptedReceipts = []
} = {}) {
  const normalizedEpoch = normalizeCheckpointEpoch(epoch);
  const normalizedHistory = normalizeEpochAcceptedReceipts(acceptedReceipts, {
    checkpointRevision: normalizedEpoch.checkpointRevision,
    checkpointHead: normalizedEpoch.checkpointHead,
    epochId: normalizedEpoch.epochId
  });

  return Object.freeze({
    schema: CHECKPOINT_ADOPTION_SCHEMA,
    epoch: normalizedEpoch,
    targetRevision: normalizedHistory.toRevision,
    targetHead: normalizedHistory.head,
    acceptedReceipts: Object.freeze(
      normalizedHistory.receipts.map((receipt) => Object.freeze(clone(receipt)))
    )
  });
}

export function normalizeCheckpointAdoptionPackage(
  inputPackage,
  {
    expectedPriorEpochId,
    clientRevision = 0
  } = {}
) {
  if (!inputPackage || typeof inputPackage !== 'object') throw new Error('checkpoint-adoption-package-required');
  if (inputPackage.schema !== CHECKPOINT_ADOPTION_SCHEMA) throw new Error('checkpoint-adoption-schema-mismatch');

  const normalizedEpoch = normalizeCheckpointEpoch(inputPackage.epoch);
  const priorEpochId = requireText(expectedPriorEpochId, 'checkpoint-adoption-expected-prior-epoch-required');
  if (normalizedEpoch.priorEpochId !== priorEpochId) {
    throw new Error(`checkpoint-adoption-prior-epoch-mismatch:${normalizedEpoch.priorEpochId}`);
  }

  const actualClientRevision = requireRevision(clientRevision, 'invalid-checkpoint-adoption-client-revision');
  if (actualClientRevision > normalizedEpoch.checkpointRevision) {
    throw new Error('checkpoint-adoption-would-drop-client-revision');
  }

  const targetRevision = requireRevision(inputPackage.targetRevision, 'invalid-checkpoint-adoption-target-revision');
  const targetHead = requireText(inputPackage.targetHead, 'checkpoint-adoption-target-head-required');
  if (!Array.isArray(inputPackage.acceptedReceipts)) throw new Error('checkpoint-adoption-receipts-required');

  const normalizedHistory = normalizeEpochAcceptedReceipts(inputPackage.acceptedReceipts, {
    checkpointRevision: normalizedEpoch.checkpointRevision,
    checkpointHead: normalizedEpoch.checkpointHead,
    epochId: normalizedEpoch.epochId
  });

  if (normalizedHistory.toRevision !== targetRevision) {
    throw new Error('checkpoint-adoption-target-revision-mismatch');
  }
  if (normalizedHistory.head !== targetHead) {
    throw new Error('checkpoint-adoption-target-head-mismatch');
  }

  return Object.freeze({
    schema: CHECKPOINT_ADOPTION_SCHEMA,
    epoch: normalizedEpoch,
    fromRevision: normalizedEpoch.checkpointRevision,
    toRevision: normalizedHistory.toRevision,
    head: normalizedHistory.head,
    compactedState: Object.freeze(clone(normalizedEpoch.compactedState)),
    receipts: Object.freeze(
      normalizedHistory.receipts.map((receipt) => Object.freeze(clone(receipt)))
    ),
    commands: Object.freeze(
      normalizedHistory.commands.map((command) => Object.freeze(clone(command)))
    )
  });
}
