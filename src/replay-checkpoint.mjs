import { normalizeAcceptedReceipts } from './mutation-agreement.mjs';
import { advanceCatchup, digestState } from './temporal-state-kernel.mjs';

export const REPLAY_CHECKPOINT_SCHEMA = 'axm.global-state.replay-checkpoint/v0';

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

function commandFromReceipt(receipt) {
  return Object.freeze({
    id: receipt.proposalId,
    ...clone(receipt.command)
  });
}

function checkpointCore({ mutationRevision, mutationHead, state }) {
  return {
    schema: REPLAY_CHECKPOINT_SCHEMA,
    mutationRevision,
    mutationHead,
    checkpointTick: state.tick,
    rulesVersion: state.rulesVersion,
    stateDigest: digestState(state),
    state: clone(state)
  };
}

function checkpointDigest(core) {
  return digestValue(core);
}

function validateBoundary(prefixReceipts, suffixReceipts, checkpointTick) {
  for (const receipt of prefixReceipts) {
    if (receipt.command.atTick > checkpointTick) {
      throw new Error(`replay-checkpoint-prefix-command-after-tick:${receipt.proposalId}`);
    }
  }
  for (const receipt of suffixReceipts) {
    if (receipt.command.atTick <= checkpointTick) {
      throw new Error(`replay-checkpoint-suffix-command-at-or-before-tick:${receipt.proposalId}`);
    }
  }
}

export function createReplayCheckpoint({
  baseState,
  sourceCheckpointRevision = 0,
  sourceCheckpointHead,
  acceptedReceipts = [],
  throughRevision,
  checkpointTick,
  rules = {}
} = {}) {
  const sourceRevision = requireRevision(sourceCheckpointRevision, 'invalid-replay-source-revision');
  requireText(sourceCheckpointHead, 'replay-source-head-required');
  const through = requireRevision(throughRevision, 'invalid-replay-through-revision');
  if (through <= sourceRevision) throw new Error('replay-checkpoint-must-advance-revision');
  if (!Number.isSafeInteger(checkpointTick) || checkpointTick < 0) {
    throw new Error('invalid-replay-checkpoint-tick');
  }

  const normalized = normalizeAcceptedReceipts(acceptedReceipts, {
    checkpointRevision: sourceRevision,
    checkpointHead: sourceCheckpointHead
  });
  if (through > normalized.toRevision) throw new Error('replay-checkpoint-through-future-revision');

  const prefixReceipts = normalized.receipts.filter((receipt) => receipt.sequence <= through);
  const suffixReceipts = normalized.receipts.filter((receipt) => receipt.sequence > through);
  const throughReceipt = prefixReceipts.at(-1);
  if (!throughReceipt || throughReceipt.sequence !== through) {
    throw new Error('replay-checkpoint-prefix-incomplete');
  }

  validateBoundary(prefixReceipts, suffixReceipts, checkpointTick);
  const prefixCommands = prefixReceipts.map(commandFromReceipt);
  const state = advanceCatchup(baseState, checkpointTick, {
    commands: prefixCommands,
    rules
  });
  const core = checkpointCore({
    mutationRevision: through,
    mutationHead: throughReceipt.acceptedHead,
    state
  });
  const digest = checkpointDigest(core);

  return Object.freeze({
    checkpoint: Object.freeze({ ...core, checkpointDigest: digest }),
    retainedReceipts: Object.freeze(suffixReceipts.map((receipt) => Object.freeze(clone(receipt))))
  });
}

export function verifyReplayCheckpoint(
  inputCheckpoint,
  {
    expectedCheckpointDigest,
    expectedMutationRevision,
    expectedMutationHead,
    expectedRulesVersion
  } = {}
) {
  if (!inputCheckpoint || typeof inputCheckpoint !== 'object') {
    throw new Error('replay-checkpoint-required');
  }
  const checkpoint = clone(inputCheckpoint);
  if (checkpoint.schema !== REPLAY_CHECKPOINT_SCHEMA) throw new Error('replay-checkpoint-schema-mismatch');
  const mutationRevision = requireRevision(checkpoint.mutationRevision, 'invalid-replay-checkpoint-revision');
  const mutationHead = requireText(checkpoint.mutationHead, 'replay-checkpoint-head-required');
  if (!Number.isSafeInteger(checkpoint.checkpointTick) || checkpoint.checkpointTick < 0) {
    throw new Error('invalid-replay-checkpoint-tick');
  }
  const rulesVersion = requireText(checkpoint.rulesVersion, 'replay-checkpoint-rules-version-required');
  requireText(checkpoint.stateDigest, 'replay-checkpoint-state-digest-required');
  const claimedDigest = requireText(checkpoint.checkpointDigest, 'replay-checkpoint-digest-required');
  const trustedDigest = requireText(expectedCheckpointDigest, 'expected-replay-checkpoint-digest-required');
  if (!checkpoint.state || typeof checkpoint.state !== 'object') throw new Error('replay-checkpoint-state-required');
  if (checkpoint.state.tick !== checkpoint.checkpointTick) throw new Error('replay-checkpoint-state-tick-mismatch');
  if (checkpoint.state.rulesVersion !== rulesVersion) throw new Error('replay-checkpoint-state-rules-mismatch');

  const actualStateDigest = digestState(checkpoint.state);
  if (actualStateDigest !== checkpoint.stateDigest) throw new Error('replay-checkpoint-state-digest-mismatch');

  const core = checkpointCore({
    mutationRevision,
    mutationHead,
    state: checkpoint.state
  });
  const actualDigest = checkpointDigest(core);
  if (actualDigest !== claimedDigest) throw new Error('replay-checkpoint-digest-mismatch');
  if (actualDigest !== trustedDigest) throw new Error('replay-checkpoint-trust-mismatch');

  if (expectedMutationRevision !== undefined && mutationRevision !== expectedMutationRevision) {
    throw new Error('replay-checkpoint-expected-revision-mismatch');
  }
  if (expectedMutationHead !== undefined && mutationHead !== expectedMutationHead) {
    throw new Error('replay-checkpoint-expected-head-mismatch');
  }
  if (expectedRulesVersion !== undefined && rulesVersion !== expectedRulesVersion) {
    throw new Error('replay-checkpoint-expected-rules-mismatch');
  }

  return Object.freeze({
    schema: REPLAY_CHECKPOINT_SCHEMA,
    mutationRevision,
    mutationHead,
    checkpointTick: checkpoint.checkpointTick,
    rulesVersion,
    stateDigest: checkpoint.stateDigest,
    checkpointDigest: actualDigest,
    state: clone(checkpoint.state)
  });
}

export function resumeFromReplayCheckpoint({
  checkpoint,
  expectedCheckpointDigest,
  acceptedReceipts = [],
  targetTick,
  rules = {}
} = {}) {
  const verified = verifyReplayCheckpoint(checkpoint, { expectedCheckpointDigest });
  const normalized = normalizeAcceptedReceipts(acceptedReceipts, {
    checkpointRevision: verified.mutationRevision,
    checkpointHead: verified.mutationHead
  });
  for (const command of normalized.commands) {
    if (command.atTick <= verified.checkpointTick) {
      throw new Error(`replay-checkpoint-suffix-command-at-or-before-tick:${command.id}`);
    }
  }

  const state = advanceCatchup(verified.state, targetTick, {
    commands: normalized.commands,
    rules
  });
  return Object.freeze({
    checkpoint: verified,
    normalizedSuffix: normalized,
    state,
    digest: digestState(state)
  });
}
