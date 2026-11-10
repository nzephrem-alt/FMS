/**
 * Money received on a project directly from the Income page (not through a client invoice).
 * It counts as received on that project, like invoice payments do.
 */
import { ACC } from './accounts';
import type { JournalEntry } from './ledger';

/** sourceId prefix of client payments on a project recorded on the Income page. */
export const PROJECT_RECEIPT_PREFIX = 'project-receipt-';
/** sourceId prefix of income recorded on the Income page before project payments were split out. */
export const OTHER_INCOME_PREFIX = 'other-income-';

export type ProjectReceipt = { entry: JournalEntry; projectId: string; date: string; amount: number; party: string; onOtherIncome: boolean };

const INCOME_ACCOUNTS = new Set<string>([ACC.contractRevenue, ACC.otherIncome]);

/** Income-page receipts that name a project and have not been reversed. */
export function projectReceiptList(entries: readonly JournalEntry[]): ProjectReceipt[] {
  const reversed = new Set(entries.filter((e) => e.reversalOf).map((e) => e.reversalOf as string));
  const list: ProjectReceipt[] = [];
  for (const e of entries) {
    if (e.sourceType !== 'manual' || e.reversalOf || reversed.has(e.id)) continue;
    if (!e.sourceId.startsWith(PROJECT_RECEIPT_PREFIX) && !e.sourceId.startsWith(OTHER_INCOME_PREFIX)) continue;
    const income = e.lines.filter((l) => INCOME_ACCOUNTS.has(l.account) && l.projectId);
    if (!income.length) continue;
    list.push({
      entry: e,
      projectId: income[0].projectId as string,
      date: e.date,
      amount: income.reduce((s, l) => s + l.credit - l.debit, 0),
      party: e.lines.find((l) => l.party)?.party ?? '',
      onOtherIncome: income.some((l) => l.account === ACC.otherIncome),
    });
  }
  return list;
}

/** Totals by project id, optionally only up to a date (YYYY-MM-DD). */
export function projectReceiptTotals(entries: readonly JournalEntry[], to = ''): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const r of projectReceiptList(entries)) {
    if (to && r.date > to) continue;
    totals[r.projectId] = (totals[r.projectId] ?? 0) + r.amount;
  }
  return totals;
}
