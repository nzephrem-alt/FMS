/**
 * Salaries owed (accrual accounting).
 *
 * When a month is over, any part of a staff member's salary that has not been paid is recorded as:
 *   debit Staff Salaries (6010) / credit Accrued Wages (2020), dated the last day of that month.
 * When the balance is paid later, the payment is recorded as usual (debit Staff Salaries / credit cash),
 * and a matching entry clears the debt on the payment date:
 *   debit Accrued Wages / credit Staff Salaries.
 * So each month carries its full salary, the balance sheet shows what is still owed, and a late payment
 * is never counted as an expense twice.
 *
 * The entries are worked out from the staff list and the payments, and kept in step by syncPayrollAccruals:
 * anything that no longer matches (a payment removed, a salary changed) is reversed on its own date and
 * posted again. Safe to run as often as needed.
 */
import { ACC } from './accounts';
import { ledger as defaultLedger } from './ledger';
import type { Ledger, JournalEntry } from './ledger';

export type AccrualStaff = { id: string; name: string; startMonth: string; endMonth: string; salaryHistory: { from: string; amount: number }[] };
export type AccrualPayment = { id: string; staffId: string; year: number; month: number; amount: number; paidAt: string };
export type OwedMonth = { staffId: string; name: string; month: string; salary: number; paid: number; owed: number };

const STAFF_KEY = 'ista-fortis-staff-v1';
const PAYMENTS_KEY = 'ista-fortis-payroll-payments-v1';
const SOURCE_PREFIX = 'accrual:';
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number) => String(n).padStart(2, '0');
const ym = (year: number, month: number) => `${year}-${pad(month)}`;
const monthName = (value: string) => { const [y, m] = value.split('-'); return `${MONTH_NAMES[Number(m) - 1]} ${y}`; };
const lastDay = (value: string) => { const [y, m] = value.split('-').map(Number); return `${value}-${pad(new Date(y, m, 0).getDate())}`; };
const nextMonth = (value: string) => { const [y, m] = value.split('-').map(Number); return m === 12 ? ym(y + 1, 1) : ym(y, m + 1); };
const localDate = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export const salaryFor = (s: AccrualStaff, month: string): number => {
  let amount = 0;
  for (const entry of [...s.salaryHistory].sort((a, b) => a.from.localeCompare(b.from))) if (entry.from <= month) amount = entry.amount;
  return amount;
};

/**
 * Months to check for one person: from their first month (but not before the first month any salary
 * was recorded in the system, since earlier months were settled before it) to the last finished month.
 */
function monthsToCheck(s: AccrualStaff, firstTracked: string, lastFinished: string): string[] {
  const from = s.startMonth && s.startMonth > firstTracked ? s.startMonth : firstTracked;
  const to = s.endMonth && s.endMonth < lastFinished ? s.endMonth : lastFinished;
  const list: string[] = [];
  for (let m = from; m <= to; m = nextMonth(m)) list.push(m);
  return list;
}

function setup(staff: AccrualStaff[], payments: AccrualPayment[], today: Date) {
  const current = ym(today.getFullYear(), today.getMonth() + 1);
  const lastFinished = today.getMonth() === 0 ? ym(today.getFullYear() - 1, 12) : ym(today.getFullYear(), today.getMonth());
  const firstTracked = payments.map((p) => ym(p.year, p.month)).sort()[0] ?? current;
  const byMonth = new Map<string, AccrualPayment[]>();
  payments.forEach((p) => {
    const key = `${p.staffId}|${ym(p.year, p.month)}`;
    byMonth.set(key, [...(byMonth.get(key) ?? []), p]);
  });
  return { lastFinished, firstTracked, paymentsOf: (staffId: string, month: string) => byMonth.get(`${staffId}|${month}`) ?? [], staff };
}

/** Finished months whose salary is not fully paid: part-paid months and unpaid months. */
export function owedSalaries(staff: AccrualStaff[], payments: AccrualPayment[], today = new Date()): OwedMonth[] {
  const { lastFinished, firstTracked, paymentsOf } = setup(staff, payments, today);
  const list: OwedMonth[] = [];
  for (const s of staff) {
    for (const month of monthsToCheck(s, firstTracked, lastFinished)) {
      const salary = salaryFor(s, month);
      const paid = paymentsOf(s.id, month).reduce((t, p) => t + p.amount, 0);
      if (salary - paid > 0) list.push({ staffId: s.id, name: s.name, month, salary, paid, owed: salary - paid });
    }
  }
  return list.sort((a, b) => a.month.localeCompare(b.month) || a.name.localeCompare(b.name));
}

type Wanted = { sourceId: string; date: string; amount: number; party: string; description: string; settle: boolean; month: string };

/** The accrual entries the ledger should contain. */
export function wantedAccruals(staff: AccrualStaff[], payments: AccrualPayment[], today = new Date()): Wanted[] {
  const { lastFinished, firstTracked, paymentsOf } = setup(staff, payments, today);
  const wanted: Wanted[] = [];
  for (const s of staff) {
    for (const month of monthsToCheck(s, firstTracked, lastFinished)) {
      const salary = salaryFor(s, month);
      const end = lastDay(month);
      const mine = paymentsOf(s.id, month).map((p) => ({ p, date: localDate(p.paidAt) })).sort((a, b) => a.date.localeCompare(b.date) || a.p.id.localeCompare(b.p.id));
      const paidByEnd = mine.filter((x) => x.date <= end).reduce((t, x) => t + x.p.amount, 0);
      let owed = Math.max(salary - paidByEnd, 0);
      if (owed <= 0) continue;
      wanted.push({ sourceId: `${SOURCE_PREFIX}${s.id}:${month}`, date: end, amount: owed, party: s.name, settle: false, month, description: `Salary owed – ${s.name} – ${monthName(month)}` });
      // Later payments clear the debt, on the day they were paid.
      for (const x of mine.filter((y) => y.date > end)) {
        const cleared = Math.min(x.p.amount, owed);
        if (cleared <= 0) break;
        owed -= cleared;
        wanted.push({ sourceId: `${SOURCE_PREFIX}settle:${x.p.id}`, date: x.date, amount: cleared, party: s.name, settle: true, month, description: `Salary owed paid – ${s.name} – ${monthName(month)}` });
      }
    }
  }
  return wanted;
}

const entryMatches = (e: JournalEntry, w: Wanted) => {
  const owedLine = e.lines.find((l) => l.account === ACC.accruedWages);
  if (!owedLine || e.date !== w.date || owedLine.party !== w.party) return false;
  return w.settle ? owedLine.debit === w.amount : owedLine.credit === w.amount;
};

/** Brings the ledger's salary-owed entries in line with the staff list and payments. Returns the number of changes. */
export function syncPayrollAccruals(staff: AccrualStaff[], payments: AccrualPayment[], ledger: Ledger = defaultLedger, today = new Date()): number {
  const wanted = new Map(wantedAccruals(staff, payments, today).map((w) => [w.sourceId, w]));
  const entries = ledger.getEntries();
  const reversed = new Set(entries.filter((e) => e.reversalOf).map((e) => e.reversalOf as string));
  const active = entries.filter((e) => e.sourceType === 'payroll' && e.sourceId.startsWith(SOURCE_PREFIX) && !e.reversalOf && !reversed.has(e.id));
  let changes = 0;
  const kept = new Set<string>();
  for (const e of active) {
    const w = wanted.get(e.sourceId);
    if (w && !kept.has(w.sourceId) && entryMatches(e, w)) { kept.add(w.sourceId); continue; }
    ledger.reverse(e.id, 'Salary owed updated', e.date); // corrected on its own date
    changes += 1;
  }
  for (const w of wanted.values()) {
    if (kept.has(w.sourceId)) continue;
    const posted = ledger.getEntries().filter((e) => e.idempotencyKey?.startsWith(`${w.sourceId}#`)).length;
    const memo = `${monthName(w.month)} salary`;
    ledger.post({
      date: w.date,
      description: w.description,
      sourceType: 'payroll',
      sourceId: w.sourceId,
      idempotencyKey: `${w.sourceId}#${posted + 1}`,
      lines: w.settle
        ? [{ account: ACC.accruedWages, debit: w.amount, party: w.party, memo }, { account: ACC.salaries, credit: w.amount, memo }]
        : [{ account: ACC.salaries, debit: w.amount, memo }, { account: ACC.accruedWages, credit: w.amount, party: w.party, memo }],
    });
    changes += 1;
  }
  return changes;
}

type StoredStaff = Partial<AccrualStaff> & { id?: string; name?: string; monthlySalary?: number };
const readArray = <T,>(key: string): T[] => {
  try { const raw = localStorage.getItem(key); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v as T[] : []; } catch { return []; }
};

/** Runs the sync from the saved staff and payments, for pages other than Staff & Payroll. */
export function syncStoredPayrollAccruals(ledger: Ledger = defaultLedger): void {
  try {
    const staff = readArray<StoredStaff>(STAFF_KEY)
      .filter((s): s is StoredStaff & { id: string; name: string } => typeof s.id === 'string' && typeof s.name === 'string')
      .map((s): AccrualStaff => ({
        id: s.id, name: s.name, startMonth: s.startMonth ?? '', endMonth: s.endMonth ?? '',
        salaryHistory: Array.isArray(s.salaryHistory) && s.salaryHistory.length ? s.salaryHistory : [{ from: '', amount: s.monthlySalary ?? 0 }],
      }));
    syncPayrollAccruals(staff, readArray<AccrualPayment>(PAYMENTS_KEY), ledger);
  } catch (e) {
    console.error('Could not update salaries owed in the ledger:', e);
  }
}

/** Salaries owed by person as at a date, from the ledger (Accrued Wages balance). */
export function owedByPerson(entries: readonly JournalEntry[], to = ''): { name: string; amount: number }[] {
  const totals = new Map<string, number>();
  entries.forEach((e) => {
    if (to && e.date > to) return;
    e.lines.forEach((l) => { if (l.account === ACC.accruedWages) totals.set(l.party || 'Staff', (totals.get(l.party || 'Staff') ?? 0) + l.credit - l.debit); });
  });
  return [...totals].filter(([, amount]) => amount > 0).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
}
