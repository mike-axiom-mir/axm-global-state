import {
  mkdir,
  readFile,
  rename,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createEpochBoundSequencerAuthority,
  normalizeEpochAcceptedReceipts,
  validateCheckpointEpoch
} from './checkpoint-epoch.mjs';

export const DURABLE_CHECKPOINT_PACKAGE_SCHEMA = 'axm.global-state.checkpoint-package/v0';
export const DURABLE_CHECKPOINT_POINTER_SCHEMA = 'axm.global-state.checkpoint-pointer/v0';
export const DURABLE_CHECKPOINT_PREPARED_SCHEMA = 'axm.global-state.checkpoint-prepared/v0';

function clone(value) {
  return structuredClone(value);
}

function requireText(value, code) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(code);
  return value;
}

function requireDirectory(value) {
  return requireText(value, 'checkpoint-store-directory-required');
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

function currentPointerPath(directory) {
  return path.join(directory, 'CURRENT.json');
}

function generationsDirectory(directory) {
  return path.join(directory, 'generations');
}

function generationPath(directory, generationId) {
  return path.join(generationsDirectory(directory), `${requireText(generationId, 'checkpoint-generation-id-required')}.json`);
}

async function writeAtomic(filePath, document) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(document)}\n`, 'utf8');
  await rename(temporary, filePath);
}

async function writeImmutable(filePath, document) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(filePath, `${JSON.stringify(document)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = JSON.parse(await readFile(filePath, 'utf8'));
    if (canonicalStringify(existing) !== canonicalStringify(document)) {
      throw new Error('checkpoint-generation-id-collision');
    }
  }
}

function packageCore({ generationId, parentGenerationId, epoch, normalized }) {
  return {
    schema: DURABLE_CHECKPOINT_PACKAGE_SCHEMA,
    generationId: requireText(generationId, 'checkpoint-generation-id-required'),
    parentGenerationId,
    epoch,
    receipts: normalized.receipts,
    currentRevision: normalized.toRevision,
    currentHead: normalized.head
  };
}

function buildPackage({ generationId, parentGenerationId, epoch: inputEpoch, receipts = [] }) {
  const epoch = validateCheckpointEpoch(inputEpoch);
  if (!Array.isArray(receipts)) throw new Error('checkpoint-package-receipts-required');
  if (parentGenerationId !== null) requireText(parentGenerationId, 'checkpoint-parent-generation-id-invalid');

  const normalized = normalizeEpochAcceptedReceipts(receipts, {
    checkpointRevision: epoch.checkpointRevision,
    checkpointHead: epoch.checkpointHead,
    epochId: epoch.epochId
  });
  const core = packageCore({ generationId, parentGenerationId, epoch, normalized });
  const packageDigest = digestValue(core);

  return Object.freeze({
    ...core,
    packageDigest
  });
}

function validatePackage(inputDocument) {
  if (!inputDocument || typeof inputDocument !== 'object') throw new Error('checkpoint-package-required');
  if (inputDocument.schema !== DURABLE_CHECKPOINT_PACKAGE_SCHEMA) throw new Error('checkpoint-package-schema-mismatch');

  const document = clone(inputDocument);
  requireText(document.generationId, 'checkpoint-generation-id-required');
  if (document.parentGenerationId !== null) {
    requireText(document.parentGenerationId, 'checkpoint-parent-generation-id-invalid');
  }
  requireText(document.packageDigest, 'checkpoint-package-digest-required');

  const rebuilt = buildPackage({
    generationId: document.generationId,
    parentGenerationId: document.parentGenerationId,
    epoch: document.epoch,
    receipts: document.receipts
  });
  if (rebuilt.packageDigest !== document.packageDigest) {
    throw new Error('checkpoint-package-digest-mismatch');
  }
  if (rebuilt.currentRevision !== document.currentRevision) {
    throw new Error('checkpoint-package-revision-mismatch');
  }
  if (rebuilt.currentHead !== document.currentHead) {
    throw new Error('checkpoint-package-head-mismatch');
  }

  return rebuilt;
}

function buildPointer(document) {
  return Object.freeze({
    schema: DURABLE_CHECKPOINT_POINTER_SCHEMA,
    generationId: document.generationId,
    packageDigest: document.packageDigest
  });
}

function validatePointer(pointer) {
  if (!pointer || typeof pointer !== 'object') throw new Error('checkpoint-pointer-required');
  if (pointer.schema !== DURABLE_CHECKPOINT_POINTER_SCHEMA) throw new Error('checkpoint-pointer-schema-mismatch');
  return Object.freeze({
    schema: DURABLE_CHECKPOINT_POINTER_SCHEMA,
    generationId: requireText(pointer.generationId, 'checkpoint-pointer-generation-required'),
    packageDigest: requireText(pointer.packageDigest, 'checkpoint-pointer-digest-required')
  });
}

async function readCurrentPackage(directory) {
  let pointer;
  try {
    pointer = validatePointer(JSON.parse(await readFile(currentPointerPath(directory), 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('checkpoint-store-not-initialized');
    if (error instanceof SyntaxError) throw new Error('checkpoint-pointer-invalid-json');
    throw error;
  }

  let document;
  try {
    document = validatePackage(JSON.parse(await readFile(generationPath(directory, pointer.generationId), 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('checkpoint-pointer-generation-missing');
    if (error instanceof SyntaxError) throw new Error('checkpoint-generation-invalid-json');
    throw error;
  }
  if (document.generationId !== pointer.generationId) {
    throw new Error('checkpoint-pointer-generation-id-mismatch');
  }
  if (document.packageDigest !== pointer.packageDigest) {
    throw new Error('checkpoint-pointer-package-digest-mismatch');
  }
  return { pointer, document };
}

export class DurableCheckpointStore {
  constructor({ directory, document }) {
    this.directory = directory;
    this.document = validatePackage(document);
  }

  snapshot() {
    return Object.freeze(clone(this.document));
  }

  generationId() {
    return this.document.generationId;
  }

  checkpoint() {
    return Object.freeze({
      generationId: this.document.generationId,
      epochId: this.document.epoch.epochId,
      checkpointRevision: this.document.epoch.checkpointRevision,
      checkpointHead: this.document.epoch.checkpointHead,
      currentRevision: this.document.currentRevision,
      currentHead: this.document.currentHead
    });
  }

  receiptsAfter(revision) {
    if (!Number.isSafeInteger(revision) || revision < this.document.epoch.checkpointRevision) {
      throw new Error('checkpoint-receipts-after-revision-invalid');
    }
    if (revision > this.document.currentRevision) throw new Error('checkpoint-receipts-after-future-revision');
    return Object.freeze(
      this.document.receipts
        .filter((receipt) => receipt.sequence > revision)
        .map((receipt) => Object.freeze(clone(receipt)))
    );
  }

  restoreAuthority() {
    return createEpochBoundSequencerAuthority({
      checkpointRevision: this.document.epoch.checkpointRevision,
      checkpointHead: this.document.epoch.checkpointHead,
      epochId: this.document.epoch.epochId,
      acceptedReceipts: this.document.receipts
    });
  }

  async prepareRotation({ epoch, receipts = [] } = {}) {
    const generationId = randomUUID();
    const document = buildPackage({
      generationId,
      parentGenerationId: this.document.generationId,
      epoch,
      receipts
    });
    await writeImmutable(generationPath(this.directory, generationId), document);
    return Object.freeze({
      schema: DURABLE_CHECKPOINT_PREPARED_SCHEMA,
      basedOnGenerationId: this.document.generationId,
      generationId,
      packageDigest: document.packageDigest
    });
  }

  async commitPreparedRotation(inputPrepared) {
    if (!inputPrepared || typeof inputPrepared !== 'object') throw new Error('checkpoint-prepared-required');
    if (inputPrepared.schema !== DURABLE_CHECKPOINT_PREPARED_SCHEMA) throw new Error('checkpoint-prepared-schema-mismatch');
    const basedOnGenerationId = requireText(inputPrepared.basedOnGenerationId, 'checkpoint-prepared-base-required');
    const generationId = requireText(inputPrepared.generationId, 'checkpoint-prepared-generation-required');
    const packageDigest = requireText(inputPrepared.packageDigest, 'checkpoint-prepared-digest-required');

    if (basedOnGenerationId !== this.document.generationId) {
      throw new Error('checkpoint-prepared-stale-base');
    }

    let document;
    try {
      document = validatePackage(JSON.parse(await readFile(generationPath(this.directory, generationId), 'utf8')));
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error('checkpoint-prepared-generation-missing');
      if (error instanceof SyntaxError) throw new Error('checkpoint-generation-invalid-json');
      throw error;
    }
    if (document.generationId !== generationId) throw new Error('checkpoint-prepared-generation-id-mismatch');
    if (document.packageDigest !== packageDigest) throw new Error('checkpoint-prepared-digest-mismatch');
    if (document.parentGenerationId !== basedOnGenerationId) throw new Error('checkpoint-prepared-parent-mismatch');

    await writeAtomic(currentPointerPath(this.directory), buildPointer(document));
    this.document = document;
    return this.snapshot();
  }

  async appendReceipt(receipt) {
    const prepared = await this.prepareRotation({
      epoch: this.document.epoch,
      receipts: [...this.document.receipts, clone(receipt)]
    });
    return this.commitPreparedRotation(prepared);
  }
}

export async function initializeDurableCheckpointStore({
  directory,
  epoch,
  receipts = []
} = {}) {
  const actualDirectory = requireDirectory(directory);
  await mkdir(generationsDirectory(actualDirectory), { recursive: true });

  try {
    await readFile(currentPointerPath(actualDirectory), 'utf8');
    throw new Error('checkpoint-store-already-initialized');
  } catch (error) {
    if (error?.message === 'checkpoint-store-already-initialized') throw error;
    if (error?.code !== 'ENOENT') throw error;
  }

  const generationId = randomUUID();
  const document = buildPackage({
    generationId,
    parentGenerationId: null,
    epoch,
    receipts
  });
  await writeImmutable(generationPath(actualDirectory, generationId), document);
  await writeAtomic(currentPointerPath(actualDirectory), buildPointer(document));
  return new DurableCheckpointStore({ directory: actualDirectory, document });
}

export async function openDurableCheckpointStore({ directory } = {}) {
  const actualDirectory = requireDirectory(directory);
  const { document } = await readCurrentPackage(actualDirectory);
  return new DurableCheckpointStore({ directory: actualDirectory, document });
}
