import { ledger } from './ledger';
import { ACC } from './accounts';

type Method = 'cash' | 'bank' | 'mobile_money';
const cashAccount = (m: Method) =>
  m === 'cash' ? ACC.cash : m === 'mobile_money' ? ACC.mobileMoney : ACC.bank;

/** Invoice issued: Dr Receivables, Cr Contract Revenue (+ Cr Taxes Payable if VAT) */
export function postClientInvoice(inv: {
  id: string; number: string; date: string; clientName: string;
  projectId?: string; netAmount: number; vatAmount?: number;
}) {
  const vat = inv.vatAmount ?? 0;
  return ledger.post({
    date: inv.date,
    description: `Invoice ${inv.number} – ${inv.clientName}`,
    sourceType: 'client_invoice',
    sourceId: inv.id,
    idempotencyKey: `client_invoice:${inv.id}`,
    reference: inv.number,
    lines: [
      { account: ACC.receivables, debit: inv.netAmount + vat, party: inv.clientName, projectId: inv.projectId },
      { account: ACC.contractRevenue, credit: inv.netAmount, projectId: inv.projectId },
      ...(vat > 0 ? [{ account: ACC.taxPayable, credit: vat, memo: 'VAT on invoice' }] : []),
    ],
  });
}

/** Client pays an invoice: Dr Cash/Bank/MoMo, Cr Receivables */
export function postClientPayment(p: {
  id: string; invoiceNumber: string; date: string; clientName: string;
  projectId?: string; amount: number; method: Method;
}) {
  return ledger.post({
    date: p.date,
    description: `Payment – ${p.invoiceNumber} – ${p.clientName}`,
    sourceType: 'client_payment',
    sourceId: p.id,
    idempotencyKey: `client_payment:${p.id}`,
    reference: p.invoiceNumber,
    lines: [
      { account: cashAccount(p.method), debit: p.amount, projectId: p.projectId },
      { account: ACC.receivables, credit: p.amount, party: p.clientName, projectId: p.projectId },
    ],
  });
}

/** Money received with no invoice (e.g. interest, sundry): Dr Cash/Bank, Cr Other Income */
export function postOtherIncome(i: {
  id: string; date: string; description: string; amount: number; method: Method;
}) {
  return ledger.post({
    date: i.date,
    description: i.description,
    sourceType: 'manual', // or add 'income' to SourceType and sourceLabels
    sourceId: i.id,
    idempotencyKey: `income:${i.id}`,
    lines: [
      { account: cashAccount(i.method), debit: i.amount },
      { account: ACC.otherIncome, credit: i.amount },
    ],
  });
}