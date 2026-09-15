import { openFileReceiptHistory } from '../src/durable-receipt-history.mjs';

const filePath = process.env.AXM_RECEIPT_HISTORY_FILE;
const checkpointRevision = Number(process.env.AXM_CHECKPOINT_REVISION ?? '0');
const checkpointHead = process.env.AXM_CHECKPOINT_HEAD;
const testFirstProposalPersistDelayMs = Number(process.env.AXM_TEST_FIRST_PROPOSAL_PERSIST_DELAY_MS ?? '0');

if (!process.send) throw new Error('receipt-authority-service-requires-ipc');
if (!Number.isFinite(testFirstProposalPersistDelayMs) || testFirstProposalPersistDelayMs < 0) {
  throw new Error('invalid-test-first-proposal-persist-delay');
}

const history = await openFileReceiptHistory({
  filePath,
  checkpointRevision,
  checkpointHead
});
let authority = history.restoreAuthority();

function send(message) {
  process.send(message);
}

function delay(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

send({
  type: 'ready',
  checkpoint: authority.checkpoint(),
  retainedReceipts: history.allReceipts().length
});

async function handleMessage(message) {
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
      // Test-only fault shaping: when enabled, hold the first newly accepted
      // proposal before persistence. With an unserialized async IPC handler this
      // allows the next dependent proposal to race ahead of durable R1. The
      // request queue below must prevent that interleaving.
      if (!result.duplicate && result.receipt.sequence === 1) {
        await delay(testFirstProposalPersistDelayMs);
      }
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
}

// The authority is a *single sequencer*, so its request boundary must be single
// file too. Async filesystem persistence yields back to the event loop; without
// this queue two proposal handlers can overlap and durable rename order can
// diverge from acknowledged authority order. Queue every IPC request so proposal
// admission, durable acknowledgement, reads and shutdown observe one order.
let requestTail = Promise.resolve();
process.on('message', (message) => {
  const run = requestTail.then(() => handleMessage(message));
  requestTail = run.catch(() => undefined);
});
