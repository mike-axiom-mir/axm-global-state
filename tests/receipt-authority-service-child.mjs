import { openFileReceiptHistory } from '../src/durable-receipt-history.mjs';

const filePath = process.env.AXM_RECEIPT_HISTORY_FILE;
const checkpointRevision = Number(process.env.AXM_CHECKPOINT_REVISION ?? '0');
const checkpointHead = process.env.AXM_CHECKPOINT_HEAD;

if (!process.send) throw new Error('receipt-authority-service-requires-ipc');

const history = await openFileReceiptHistory({
  filePath,
  checkpointRevision,
  checkpointHead
});
let authority = history.restoreAuthority();

function send(message) {
  process.send(message);
}

send({
  type: 'ready',
  checkpoint: authority.checkpoint(),
  retainedReceipts: history.allReceipts().length
});

process.on('message', async (message) => {
  const requestId = message?.requestId;
  try {
    if (!message || typeof message !== 'object' || typeof requestId !== 'string') {
      throw new Error('invalid-service-request');
    }

    if (message.type === 'meta') {
      send({
        type: 'response',
        requestId,
        ok: true,
        result: {
          checkpoint: authority.checkpoint(),
          retainedReceipts: history.allReceipts().length
        }
      });
      return;
    }

    if (message.type === 'receipts.after') {
      send({
        type: 'response',
        requestId,
        ok: true,
        result: {
          receipts: history.receiptsAfter(message.revision)
        }
      });
      return;
    }

    if (message.type === 'proposal.submit') {
      const result = authority.submit(message.proposal);
      const persisted = await history.append(result.receipt);
      // Rebuild from durable truth after every admitted mutation. This keeps the
      // in-process authority aligned with exactly what the durable layer can
      // restore after a crash/restart rather than trusting only RAM state.
      authority = history.restoreAuthority();
      send({
        type: 'response',
        requestId,
        ok: true,
        result: {
          accepted: result.accepted,
          duplicate: result.duplicate,
          receipt: result.receipt,
          persisted,
          checkpoint: authority.checkpoint()
        }
      });
      return;
    }

    if (message.type === 'shutdown') {
      send({ type: 'response', requestId, ok: true, result: { shuttingDown: true } });
      process.disconnect();
      return;
    }

    throw new Error(`unknown-service-request:${message.type}`);
  } catch (error) {
    send({
      type: 'response',
      requestId,
      ok: false,
      error: String(error?.message || error)
    });
  }
});
