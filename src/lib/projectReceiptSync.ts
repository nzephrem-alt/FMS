import { ACC } from './accounts';
import { ledger } from './ledger';

const PROJECTS_KEY = 'ista-fortis-projects-v1';

/** Account the money recorded on the Projects page was paid into. Change if needed. */
const RECEIPT_ACCOUNT = ACC.bank;

type StoredProject = {
  id: string;
  projectName: string;
  client: string;
  totalReceived: number; // money received before the system was used (outside invoices)
  startDate?: string;
};

const isDate = (s?: string): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

const todayStr = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Posts the amount typed as "Received" on the Projects page (money received
 * before the system was used, with no invoice) to the ledger:
 *   Dr Bank, Cr Contract Revenue
 *
 * It is posted independently of invoices. Payments recorded on invoices are
 * posted by the Client Invoices sync, so the two never overlap.
 *
 * If the typed amount is edited later, only the difference is posted.
 * Repeated runs never create duplicates. Entries posted by an earlier version
 * (which netted against invoice balances) are corrected automatically.
 * Returns a list of error messages (empty when everything posted).
 */
export function syncProjectReceiptsToLedger(): string[] {
  const errors: string[] = [];

  let projects: StoredProject[] = [];
  try {
    const raw = window.localStorage.getItem(PROJECTS_KEY);
    projects = raw ? (JSON.parse(raw) as StoredProject[]) : [];
  } catch {
    return ['Stored projects could not be read.'];
  }
  if (!Array.isArray(projects)) return errors;

  for (const p of projects) {
    try {
      const sourceId = `project:${p.id}`;

      let postedRevenue = 0; // already posted from this page, as revenue
      let postedReceivables = 0; // posted against invoices by an earlier version
      let postedCount = 0;

      for (const e of ledger.getEntries()) {
        if (e.sourceId !== sourceId) continue;
        postedCount++;
        for (const l of e.lines) {
          if (l.projectId !== p.id) continue;
          if (l.account === ACC.contractRevenue) postedRevenue += l.credit - l.debit;
          if (l.account === ACC.receivables) postedReceivables += l.credit - l.debit;
        }
      }

      const target = Math.max(0, Math.round(Number(p.totalReceived) || 0));
      const delta = target - (postedRevenue + postedReceivables); // change in cash
      if (Math.abs(delta) < 1 && Math.abs(postedReceivables) < 1) continue;

      // Net debit for each account. Positive = debit, negative = credit.
      // Goal: revenue posted = target, receivables posted = 0.
      const net: [string, number][] = [
        [RECEIPT_ACCOUNT, delta],
        [ACC.receivables, postedReceivables],
        [ACC.contractRevenue, -(target - postedRevenue)],
      ];

      const lines = net
        .filter(([, v]) => Math.abs(v) >= 1)
        .map(([account, v]) => ({
          account,
          ...(v > 0 ? { debit: v } : { credit: -v }),
          party: p.client,
          projectId: p.id,
          memo: 'Received before system start, per project register',
        }));

      ledger.post({
        date: postedCount === 0 && isDate(p.startDate) ? p.startDate : todayStr(),
        description: `Receipts recorded on project ${p.projectName} (${p.id})`,
        sourceType: 'client_payment',
        sourceId,
        idempotencyKey: `project_receipt:${p.id}:${postedCount}`,
        reference: p.id,
        lines,
      });
    } catch (e) {
      errors.push(`Project ${p.projectName || p.id}: ${e instanceof Error ? e.message : 'receipts could not be posted'}`);
    }
  }

  return errors;
}