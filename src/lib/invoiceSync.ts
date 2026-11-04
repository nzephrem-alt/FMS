import { ACC } from './accounts';
import { ledger } from './ledger';
import { syncProjectReceiptsToLedger } from './projectReceiptSync';

const INVOICES_KEY = 'ista-fortis-invoices-v1';

type StoredPayment = {
  id: string;
  amount: number;
  date: string;
  method: string;
  reference?: string;
};

type StoredInvoice = {
  id: string;
  invoiceNumber: string;
  projectId?: string;
  client: string;
  description?: string;
  issueDate: string;
  amount: number;
  payments?: StoredPayment[];
  voided?: boolean;
};

export type SyncResult = {
  invoicesFound: number;
  entriesChecked: number;
  errors: string[];
};

const cashAccountFor = (method: string): string => {
  const m = (method || '').toLowerCase();
  if (m.includes('mobile')) return ACC.mobileMoney;
  if (m.includes('bank') || m.includes('transfer') || m.includes('cheque')) return ACC.bank;
  return ACC.cash;
};

/**
 * Posts every stored client invoice and payment to the ledger.
 * Uses the same idempotency keys as the Client Invoices page, so running
 * it any number of times never creates duplicate journal entries.
 * One bad record never blocks the others.
 */
export function syncInvoicesToLedger(): SyncResult {
  const result: SyncResult = { invoicesFound: 0, entriesChecked: 0, errors: [] };

  let invoices: StoredInvoice[] = [];
  try {
    const raw = window.localStorage.getItem(INVOICES_KEY);
    invoices = raw ? (JSON.parse(raw) as StoredInvoice[]) : [];
  } catch {
    result.errors.push('Stored invoices could not be read.');
    return result;
  }
  if (!Array.isArray(invoices)) {
    result.errors.push(...syncProjectReceiptsToLedger());
    return result;
  }
  result.invoicesFound = invoices.length;

  for (const inv of invoices) {
    if (inv.voided) continue;
    const projectId = inv.projectId || undefined;

    try {
      ledger.post({
        date: inv.issueDate,
        description: `Client invoice ${inv.invoiceNumber} - ${inv.client}`,
        sourceType: 'client_invoice',
        sourceId: inv.id,
        idempotencyKey: `client_invoice:${inv.id}`,
        reference: inv.invoiceNumber,
        lines: [
          { account: ACC.receivables, debit: inv.amount, party: inv.client, projectId, memo: inv.invoiceNumber },
          { account: ACC.contractRevenue, credit: inv.amount, party: inv.client, projectId, memo: inv.description || inv.invoiceNumber },
        ],
      });
      result.entriesChecked++;
    } catch (e) {
      result.errors.push(`Invoice ${inv.invoiceNumber}: ${e instanceof Error ? e.message : 'could not be posted'}`);
      continue; // do not post payments for an invoice that failed
    }

    for (const p of inv.payments ?? []) {
      try {
        ledger.post({
          date: p.date,
          description: `Payment received for ${inv.invoiceNumber} - ${inv.client}`,
          sourceType: 'client_payment',
          sourceId: `${inv.id}:${p.id}`,
          idempotencyKey: `client_payment:${inv.id}:${p.id}`,
          reference: p.reference || inv.invoiceNumber,
          lines: [
            { account: cashAccountFor(p.method), debit: p.amount, party: inv.client, projectId, memo: p.method },
            { account: ACC.receivables, credit: p.amount, party: inv.client, projectId, memo: inv.invoiceNumber },
          ],
        });
        result.entriesChecked++;
      } catch (e) {
        result.errors.push(`Payment on ${inv.invoiceNumber}: ${e instanceof Error ? e.message : 'could not be posted'}`);
      }
    }
  }

  // Invoices are posted first so project receipts can be netted against them.
  result.errors.push(...syncProjectReceiptsToLedger());

  return result;
}