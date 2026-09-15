import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  normalizeAcceptedReceipts,
  restoreSingleSequencerAuthority
} from './mutation-agreement.mjs';

export const DURABLE_RECEIPT_HISTORY_SCHEMA = 'axm.global-state.receipt-history/file-json-v0';

function clone(value) {
  return structuredClone(value);
}

function requireFilePath(value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('receipt-history-file-path-required');
  return value;
}

function snapshotDocument({ checkpointRevision, checkpointHead, receipts }) {
  return {
    schema: DURABLE_RECEIPT_HISTORY_SCHEMA,
    checkpointRevision,
    checkpointHead,
    receipts: clone(receipts)
  };
}

async function persistAtomic(filePath, document) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(document)}\n`, 'utf8');
  await rename(temporary, filePath);
}

function verifyDocument(document, expected) {
  if (!document || typeof document !== 'object') throw new Error('receipt-history-invalid-document');
  if (document.schema !== DURABLE_RECEIPT_HISTORY_SCHEMA) throw new Error('receipt-history-schema-mismatch');
  if (document.checkpointRevision !== expected.checkpointRevision) {
    throw new Error('receipt-history-checkpoint-revision-mismatch');
  }
  if (document.checkpointHead !== expected.checkpointHead) {
    throw new Error('receipt-history-checkpoint-head-mismatch');
  }
  if (!Array.isArray(document.receipts)) throw new Error('receipt-history-receipts-required');

  return normalizeAcceptedReceipts(document.receipts, {
    checkpointRevision: expected.checkpointRevision,
    checkpointHead: expected.checkpointHead
  });
}

export class FileReceiptHistory {
  constructor({ filePath, checkpointRevision, checkpointHead, receipts }) {
    this.filePath = filePath;
    this.checkpointRevision = checkpointRevision;
    this.checkpointHead = checkpointHead;
    this.receipts = clone(receipts);
  }

  normalized() {
    return normalizeAcceptedReceipts(this.receipts, {
      checkpointRevision: this.checkpointRevision,
      checkpointHead: this.checkpointHead
    });
  }

  checkpoint() {
    const normalized = this.normalized();
    return Object.freeze({
      revision: normalized.toRevision,
      head: normalized.head
    });
  }

  allReceipts() {
    return Object.freeze(this.normalized().receipts.map((receipt) => Object.freeze(clone(receipt))));
  }

  receiptsAfter(revision) {
    if (!Number.isSafeInteger(revision) || revision < this.checkpointRevision) {
      throw new Error('invalid-receipts-after-revision');
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
    return restoreSingleSequencerAuthority({
      checkpointRevision: this.checkpointRevision,
      checkpointHead: this.checkpointHead,
      acceptedReceipts: this.receipts
    });
  }

  async append(receipt) {
    const before = this.normalized();
    const candidate = [...this.receipts, clone(receipt)];
    const normalized = normalizeAcceptedReceipts(candidate, {
      checkpointRevision: this.checkpointRevision,
      checkpointHead: this.checkpointHead
    });

    const duplicate = normalized.receipts.length === before.receipts.length;
    if (!duplicate) {
      if (normalized.toRevision !== before.toRevision + 1) {
        throw new Error('receipt-history-noncontiguous-append');
      }
      this.receipts = normalized.receipts.map((item) => clone(item));
      await persistAtomic(this.filePath, snapshotDocument({
        checkpointRevision: this.checkpointRevision,
        checkpointHead: this.checkpointHead,
        receipts: this.receipts
      }));
    }

    return Object.freeze({
      duplicate,
      revision: normalized.toRevision,
      head: normalized.head
    });
  }
}

export async function openFileReceiptHistory({
  filePath,
  checkpointRevision = 0,
  checkpointHead
} = {}) {
  const actualFilePath = requireFilePath(filePath);
  const expected = { checkpointRevision, checkpointHead };

  // normalizeAcceptedReceipts validates the checkpoint fields even when no
  // accepted history exists yet.
  normalizeAcceptedReceipts([], expected);

  let document;
  try {
    const text = await readFile(actualFilePath, 'utf8');
    try {
      document = JSON.parse(text);
    } catch {
      throw new Error('receipt-history-invalid-json');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    document = snapshotDocument({
      checkpointRevision,
      checkpointHead,
      receipts: []
    });
    await persistAtomic(actualFilePath, document);
  }

  const normalized = verifyDocument(document, expected);
  return new FileReceiptHistory({
    filePath: actualFilePath,
    checkpointRevision,
    checkpointHead,
    receipts: normalized.receipts
  });
}
