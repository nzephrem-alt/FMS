import { ACC } from './accounts';
import { ledger as defaultLedger } from './ledger';
import type { Ledger } from './ledger';

/** The fields of a Project Costs / Expenses record that the ledger needs. */
export type CostLike = {
  id: string;
  projectId: string;
  projectName: string;
  date: string;
  category: string;
  description: string;
  supplier: string;
  amount: number;
  amountPaid: number;
  paymentMethod: string;
  reference: string;
};

const COSTS_KEY = 'ista-fortis-project-costs-v1';

const CATEGORY_ACCOUNT: Record<string, string> = {
  Labour: ACC.labour,
  Materials: ACC.materials,
  Equipment: ACC.equipmentHire,
  Transport: ACC.transport,
  'Site expenses': ACC.siteExpenses,
  Other: ACC.otherDirect,
};

export const expenseAccountFor = (category: string): string => CATEGORY_ACCOUNT[category] ?? ACC.otherDirect;

export const cashAccountFor = (method: string): string => {
  if (method === 'Mobile money') return ACC.mobileMoney;
  if (method === 'Bank transfer' || method === 'Cheque') return ACC.bank;
  return ACC.cash;
};

/**
 * Debit the project cost; credit cash/bank/mobile money for the part paid and
 * accounts payable (supplier) for the part not yet paid.
 */
export function postProjectCost(cost: CostLike, ledger: Ledger = defaultLedger) {
  const paid = Math.round(cost.amountPaid);
  const total = Math.round(cost.amount);
  const due = total - paid;
  return ledger.post({
    date: cost.date,
    description: `${cost.id} · ${cost.description}`,
    sourceType: 'project_cost',
    sourceId: cost.id,
    idempotencyKey: `project_cost:${cost.id}`,
    reference: cost.reference,
    lines: [
      { account: expenseAccountFor(cost.category), debit: total, projectId: cost.projectId, memo: cost.description },
      ...(paid > 0 ? [{ account: cashAccountFor(cost.paymentMethod), credit: paid, memo: cost.paymentMethod }] : []),
      ...(due > 0 ? [{ account: ACC.payables, credit: due, party: cost.supplier || 'Unspecified supplier' }] : []),
    ],
  });
}

/** Later payment of an unpaid balance: debit payables, credit cash/bank/mobile money. */
export function postCostPayment(
  p: { costId: string; paymentNo: number; date: string; supplier: string; amount: number; method: string; reference?: string },
  ledger: Ledger = defaultLedger,
) {
  return ledger.post({
    date: p.date,
    description: `Payment for ${p.costId}`,
    sourceType: 'cost_payment',
    sourceId: p.costId,
    idempotencyKey: `cost_payment:${p.costId}:${p.paymentNo}`,
    reference: p.reference,
    lines: [
      { account: ACC.payables, debit: Math.round(p.amount), party: p.supplier || 'Unspecified supplier' },
      { account: cashAccountFor(p.method), credit: Math.round(p.amount), memo: p.method },
    ],
  });
}

/** Reverses a cost's posting. Blocked while later payments are still active. */
export function reverseProjectCost(costId: string, reason = 'Reversed from Project Costs', ledger: Ledger = defaultLedger) {
  if (ledger.activeBySource('cost_payment', costId).length > 0) {
    throw new Error('This cost has payments recorded against it. Reverse those payments first.');
  }
  ledger.activeBySource('project_cost', costId).forEach((e) => ledger.reverse(e.id, reason));
}

/**
 * Posts existing cost records that have no ledger entry yet. Safe to run repeatedly.
 * Each record is posted on its own, so one bad record cannot block the others.
 */
export function backfillProjectCosts(costs: (CostLike & { reversed?: boolean })[], ledger: Ledger = defaultLedger) {
  let posted = 0;
  let failed = 0;
  for (const cost of costs) {
    if (cost.reversed) continue; // nothing to post: it nets to zero
    try {
      const before = ledger.getEntries().length;
      postProjectCost(cost, ledger);
      if (ledger.getEntries().length > before) posted += 1;
    } catch (e) {
      failed += 1;
      console.error(`Could not post ${cost.id} to the ledger:`, e);
    }
  }
  return { posted, failed };
}

/**
 * Reads the saved Project Costs and posts any that are not in the ledger yet.
 * Each record is posted on its own, so one bad record cannot block the others.
 * Safe to run repeatedly, e.g. when the Dashboard opens.
 */
export function syncStoredProjectCosts(ledger: Ledger = defaultLedger): { posted: number; failed: number } {
  let costs: (CostLike & { reversed?: boolean })[] = [];
  try {
    const raw = localStorage.getItem(COSTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    costs = Array.isArray(parsed) ? parsed : [];
  } catch {
    return { posted: 0, failed: 0 };
  }
  return backfillProjectCosts(costs, ledger);
}

/* ---------- Staff payroll ---------- */

export type PayrollMethod = 'Cash' | 'Bank transfer' | 'Mobile money';

export type PayrollPosting = {
  id: string;        // payment id, used as the ledger source id
  staffName: string;
  year: number;
  month: number;     // 1-12
  amount: number;    // whole RWF
  method: PayrollMethod;
  paidAt: string;    // ISO timestamp of when it was marked paid
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** YYYY-MM-DD in the computer's local time (the day the payment was marked). */
const localDate = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Salary paid: debit Staff Salaries (6010); credit cash/bank/mobile money.
 * Safe to call twice for the same payment (idempotency key), so it can also back-fill.
 */
export function postPayrollPayment(p: PayrollPosting, ledger: Ledger = defaultLedger) {
  const memo = `${MONTH_NAMES[p.month - 1]} ${p.year} salary`;
  return ledger.post({
    date: localDate(p.paidAt),
    description: `Salary – ${p.staffName} – ${memo}`,
    sourceType: 'payroll',
    sourceId: p.id,
    idempotencyKey: `payroll:${p.id}`,
    lines: [
      { account: ACC.salaries, debit: Math.round(p.amount), memo },
      { account: cashAccountFor(p.method), credit: Math.round(p.amount), memo: p.method },
    ],
  });
}

/** Posts the reversing entry for a payroll payment. Does nothing if it was never posted or is already reversed. */
export function reversePayrollPayment(paymentId: string, reason = 'Payment removed', ledger: Ledger = defaultLedger) {
  ledger.activeBySource('payroll', paymentId).forEach((e) => ledger.reverse(e.id, reason));
}