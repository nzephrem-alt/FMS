import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Plus, X, Check, Users, Wallet, CalendarCheck, Banknote, ChevronLeft, ChevronRight, Trash2, Pencil, AlertCircle } from 'lucide-react';
import { auditLog } from '../lib/ledger';
import { postPayrollPayment, reversePayrollPayment } from '../lib/postings'; // LEDGER
import type { PayrollMethod } from '../lib/postings';
import { useAccess } from '../lib/access';
import { owedSalaries, syncPayrollAccruals } from '../lib/payrollAccruals';

/** A salary that applies from a month onward ("" = from the very beginning). */
type SalaryChange = { from: string; amount: number };
type Staff = {
  id: string; name: string; position: string;
  startMonth: string;   // YYYY-MM, first month of employment ('' = no limit)
  endMonth: string;     // YYYY-MM, last month of employment ('' = still employed)
  salaryHistory: SalaryChange[]; // first entry has from '' (the starting salary)
  createdAt: string;
};
/** One salary payment. A month can have several (a part payment, then the balance). The amount is stored at the time of payment, so later salary changes never rewrite history. */
type Payment = { id: string; staffId: string; year: number; month: number; amount: number; method?: PayrollMethod; paidAt: string };
type StaffForm = { name: string; position: string; startMonth: string; endMonth: string; startingSalary: number; changes: SalaryChange[] };
type LegacyStaff = Partial<Staff> & { id: string; name: string; monthlySalary?: number; active?: boolean };

const STAFF_KEY = 'ista-fortis-staff-v1';
const PAYMENTS_KEY = 'ista-fortis-payroll-payments-v1';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const METHODS: PayrollMethod[] = ['Bank transfer', 'Cash', 'Mobile money'];

const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;
const monthLabel = (value: string) => { const [y, m] = value.split('-'); return m ? `${MONTHS[Number(m) - 1]} ${y}` : value; };
const money = (n: number) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0);

/** Salary that applies in a given month (YYYY-MM): the latest salary change that has started. */
const salaryFor = (s: Staff, month: string): number => {
  let amount = 0;
  for (const entry of [...s.salaryHistory].sort((a, b) => a.from.localeCompare(b.from))) if (entry.from <= month) amount = entry.amount;
  return amount;
};
const employedIn = (s: Staff, month: string) => (!s.startMonth || month >= s.startMonth) && (!s.endMonth || month <= s.endMonth);

function load<T>(key: string): T[] { try { const raw = localStorage.getItem(key); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v as T[] : []; } catch { return []; } }
const audit = (action: string, entityId: string, summary: string, details: Record<string, unknown> = {}) => {
  try { auditLog.log({ action, entityType: 'payroll', entityId, summary, details }); }
  catch (e) { console.error('Could not write the audit log:', e); }
};
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const toPosting = (p: Payment, staffName: string) => ({ id: p.id, staffName, year: p.year, month: p.month, amount: p.amount, method: p.method ?? 'Bank transfer', paidAt: p.paidAt });

/** Brings staff saved by the first version (one monthlySalary, an active flag) up to the current shape. */
function migrateStaff(raw: LegacyStaff, payments: Payment[], currentMonth: string): Staff {
  const history = Array.isArray(raw.salaryHistory) && raw.salaryHistory.length ? raw.salaryHistory : [{ from: '', amount: raw.monthlySalary ?? 0 }];
  let endMonth = raw.endMonth ?? '';
  if (raw.active === false && !endMonth) {
    endMonth = payments.filter(p => p.staffId === raw.id).map(p => ym(p.year, p.month)).sort().pop() ?? currentMonth;
  }
  return { id: raw.id, name: raw.name, position: raw.position ?? '', startMonth: raw.startMonth ?? '', endMonth, salaryHistory: history, createdAt: raw.createdAt ?? new Date().toISOString() };
}

/**
 * Page styles live here so this page is a single file. They mirror the Projects page and are
 * scoped under .projects-module, so they restyle this page (and its pop-ups) only.
 */
const PAYROLL_CSS = `
.projects-module{--lime:#d5f56b;--lime-ink:#1d2b12;--ink:#1c2b22;--muted:#7d8a83;--line:#edf0f1;display:flex;flex-direction:column;gap:22px;color:var(--ink)}
.projects-module button:focus-visible{outline:2px solid #2f8f6b;outline-offset:2px}
.projects-module button:disabled{cursor:not-allowed}

/* header */
.projects-module .welcome-row{margin-bottom:0;gap:20px;flex-wrap:wrap;align-items:flex-end}
.projects-module .welcome-row h2{font-size:28px;font-weight:700;letter-spacing:-.4px;margin:6px 0 4px;color:var(--ink)}
.projects-module .welcome-row p{font-size:13px;color:var(--muted)}
.projects-module .projects-secondary-button{height:39px;border-radius:12px;border:1px solid var(--line);background:#fff;color:var(--ink);font-weight:600}
.projects-module .projects-secondary-button:hover{background:#f4f7f6}
.projects-module .primary-button{height:39px;border-radius:12px;background:var(--lime);color:var(--lime-ink);font-size:12px;font-weight:600;box-shadow:none}
.projects-module .primary-button:hover{background:#c8ea52}
.projects-module .pr-controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.projects-module .pr-method{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:#4f5d55}
.projects-module .pr-method select{height:39px;border-radius:12px;border:1px solid var(--line);background:#fff;color:var(--ink);padding:0 10px;font:inherit;font-size:12px}
.projects-module .pr-year{display:inline-flex;align-items:center;gap:4px;height:39px;padding:0 4px;border:1px solid var(--line);border-radius:12px;background:#fff}
.projects-module .pr-year strong{min-width:46px;text-align:center;font-size:13px}
.projects-module .pr-year button{width:30px;height:30px;border:0;background:transparent;border-radius:8px;display:grid;place-items:center;color:var(--ink);cursor:pointer}
.projects-module .pr-year button:hover{background:#f1f5f4}

/* pastel KPI cards */
.pj-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.pj-kpis.five{grid-template-columns:repeat(5,minmax(0,1fr))}
.pj-kpi{--bg:#bdeed6;--fg:#1f7a4f;display:flex;flex-direction:column;background:var(--bg);border-radius:16px;padding:14px 16px 16px;text-align:center;container-type:inline-size;transition:transform .15s ease,box-shadow .15s ease}
.pj-kpi:hover{transform:translateY(-1px);box-shadow:0 8px 20px #1c2b2214}
.pj-kpi.tone-green{--bg:#bdeed6;--fg:#1f7a4f}
.pj-kpi.tone-blue{--bg:#c9defb;--fg:#3a66ad}
.pj-kpi.tone-amber{--bg:#fde5c4;--fg:#a8691f}
.pj-kpi.tone-rose{--bg:#fbd6db;--fg:#b04a58}
.pj-kpi-top{display:flex;align-items:center;gap:8px;min-height:24px}
.pj-kpi-icon{width:22px;height:22px;border-radius:50%;background:#ffffffb3;color:var(--fg);display:grid;place-items:center;flex-shrink:0}
.pj-kpi-label{font-size:11px;font-weight:600;color:#3d4a43;line-height:1.3;text-align:left}
.pj-kpi-value{font-weight:700;font-size:clamp(16px,10.5cqw,26px);letter-spacing:-.4px;color:var(--ink);margin:16px 0 6px;white-space:nowrap;font-variant-numeric:tabular-nums}
.pj-kpi-note{font-size:10.5px;color:#4f5d55;margin-top:auto;line-height:1.45}

/* register card */
.projects-module .projects-register{padding:20px 0 6px;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 2px #1c2b2208;overflow:hidden}
.projects-module .projects-heading{padding:0 20px 14px}
.projects-module .projects-heading h3{font-size:16px;font-weight:600;color:var(--ink)}
.projects-module .projects-heading p{color:var(--muted);max-width:760px}
.projects-module .pr-toggle{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:#4f5d55;white-space:nowrap}
.projects-module .projects-empty-icon{background:#ebe8fb;color:#6a5bc2;border-radius:14px}

/* payroll grid */
.projects-module .pr-table{min-width:1250px}
.projects-module .pr-table th{background:transparent;padding:10px 8px;font-size:11px;font-weight:500;letter-spacing:0;color:#8a968f;border-bottom:1px solid var(--line);white-space:nowrap;text-align:center}
.projects-module .pr-table td{padding:10px 8px;font-size:12px;color:#3b4a42;border-top:0;border-bottom:1px solid #f1f4f4}
.projects-module .pr-table th.left,.projects-module .pr-table td.left{text-align:left}
.projects-module .pr-table th.right,.projects-module .pr-table td.right{text-align:right}
.projects-module .pr-table td.nowrap{white-space:nowrap}
.projects-module .pr-table th:first-child,.projects-module .pr-table td:first-child{padding-left:20px}
.projects-module .pr-table th:last-child,.projects-module .pr-table td:last-child{padding-right:20px}
.projects-module .pr-table .sticky{position:sticky;left:0;background:#fff;z-index:1}
.projects-module .pr-table tbody tr:last-child td{border-bottom:0}
.projects-module .pr-table tbody tr:hover td{background:#f7faf9}
.projects-module .pr-table tr.former td{opacity:.65}
.projects-module .pr-table tfoot td{background:#eef8f2;font-weight:700;color:var(--ink);border-bottom:0;padding-top:13px;padding-bottom:13px}
.projects-module .pr-table tfoot td.sticky{background:#eef8f2}
.projects-module .pr-table tfoot td.small{font-size:10px;white-space:nowrap;padding-left:4px;padding-right:4px}
.projects-module .pr-month-btn{border:0;background:transparent;padding:4px 6px;border-radius:8px;cursor:pointer;text-transform:uppercase;font:inherit;font-size:10px;font-weight:600;letter-spacing:.4px;color:#8a968f}
.projects-module .pr-month-btn:hover{background:#eef8f2;color:#1f6b46}
.projects-module .pr-month-btn.readonly{display:inline-block;cursor:default}
.projects-module .pr-month-btn.readonly:hover{background:transparent;color:#8a968f}
.projects-module .pr-name-btn.readonly{cursor:default;font-weight:600}
.projects-module .pr-cell.readonly:disabled{cursor:default;opacity:1}
.projects-module .pr-cell.readonly.due:hover{border-color:#d3ddd6;background:#fff}
.projects-module .pr-edit-btn{width:26px;height:26px;margin-right:8px;border:1px solid var(--line);background:#fff;border-radius:8px;display:inline-grid;place-items:center;color:#4f5d55;cursor:pointer;vertical-align:middle}
.projects-module .pr-edit-btn:hover{background:#f1f5f4;color:var(--ink)}
.projects-module .pr-name-btn{border:0;background:transparent;padding:0;font:inherit;font-size:12px;font-weight:600;color:var(--ink);cursor:pointer;text-align:left}
.projects-module .pr-name-btn:hover{text-decoration:underline}
.projects-module .pr-chip{margin-left:8px;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:600}
.projects-module .pr-chip.left{background:#fbd6db;color:#b04a58}
.projects-module .pr-chip.soon{background:#c9defb;color:#3a66ad}
.projects-module .pr-cell{width:26px;height:26px;border-radius:8px;display:inline-grid;place-items:center;padding:0;cursor:pointer;transition:background .12s ease,border-color .12s ease}
.projects-module .pr-cell.due{background:#fff;border:1px solid #d3ddd6}
.projects-module .pr-cell.due:hover{border-color:#6fd6a0;background:#eef8f2}
.projects-module .pr-cell.paid{background:#6fd6a0;border:1px solid #6fd6a0;color:#14412c}
.projects-module .pr-cell.off{background:#f3f5f3;border:1px solid #eef1ee;cursor:not-allowed}
.projects-module .pr-cell.part{border:1px solid #f0b35a;background:linear-gradient(135deg,#f6c47d 50%,#fff 50%);color:#7a4c14}
.projects-module .pr-cell.late{border:1px solid #f0b35a;background:#fff8ec}
.projects-module .pr-cell.readonly.late:hover{border-color:#f0b35a;background:#fff8ec}
.projects-module .pr-legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;font-size:11px;color:var(--muted)}
.projects-module .pr-legend span{display:inline-flex;align-items:center;gap:6px}
.projects-module .pr-legend i{width:12px;height:12px;border-radius:4px;display:inline-block}

/* salaries owed */
.projects-module .pr-owed-table{width:100%;border-collapse:collapse}
.projects-module .pr-owed-table th{padding:10px 20px;font-size:11px;font-weight:500;color:#8a968f;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
.projects-module .pr-owed-table td{padding:12px 20px;font-size:12px;color:#3b4a42;border-bottom:1px solid #f1f4f4}
.projects-module .pr-owed-table .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.projects-module .pr-owed-table tbody tr:hover td{background:#f7faf9}
.projects-module .pr-owed-table tfoot td{background:#fff8ec;font-weight:700;color:var(--ink);border-bottom:0}
.projects-module .pr-owed-table .pr-link{border:0;background:transparent;padding:0;font:inherit;font-size:12px;font-weight:600;color:#1f6b46;cursor:pointer}
.projects-module .pr-owed-table .pr-link:hover{text-decoration:underline}
.projects-module .pr-paylist{display:grid;gap:6px;margin:0 0 14px}
.projects-module .pr-payrow{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;font-size:12px}
.projects-module .pr-payrow span{color:var(--muted);font-size:11px}
.projects-module .pr-payrow button{border:1px solid var(--line);background:#fff;border-radius:8px;height:28px;padding:0 10px;font:inherit;font-size:11px;font-weight:600;color:#b04a58;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.projects-module .pr-payrow button:hover{background:#fdf1f3}
.projects-module .pr-pay-info.done{background:#bdeed6;color:#1f6b46}
@media(max-width:600px){.projects-module .pr-owed-table th,.projects-module .pr-owed-table td{padding-left:14px;padding-right:14px}}

/* pop-ups */
.projects-module .projects-modal{border-radius:18px}
.projects-module .projects-modal-header h3{color:var(--ink)}
.projects-module .projects-field input,.projects-module .projects-field select,.projects-module .projects-field textarea{border-radius:10px;border-color:#e5eaec}
.projects-module .projects-cancel{border-radius:12px;border-color:var(--line)}
.projects-module .projects-close{border-radius:10px;border:1px solid var(--line)}
.projects-module .projects-close:hover{background:#f1f5f4;color:var(--ink)}
.projects-module .pr-pay-modal{width:min(440px,100%)}
.projects-module .pr-pay-info{margin:0 0 14px;padding:12px 14px;border-radius:12px;background:#fde5c4;color:#7a4c14;font-size:12.5px}
.projects-module .pr-help{margin:0;font-size:11px;color:var(--muted);line-height:1.5}
.projects-module .pr-stack{display:grid;gap:12px}
.projects-module .pr-changes{grid-column:1 / -1;display:grid;gap:10px;padding:14px;border-radius:14px;background:#f7faf9}
.projects-module .pr-changes-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
.projects-module .pr-changes-head strong{font-size:12px;color:var(--ink)}
.projects-module .pr-change-row{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end}
.projects-module .pr-remove{width:38px;height:38px;border:1px solid var(--line);background:#fff;border-radius:10px;display:grid;place-items:center;color:#b04a58;cursor:pointer}
.projects-module .pr-remove:hover{background:#fbd6db}
.projects-module .pr-split{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:18px;flex-wrap:wrap}
.projects-module .pr-split .group{display:flex;gap:10px;margin-left:auto}
.projects-module .pr-danger{color:#b04a58}

@media(max-width:1280px){.pj-kpis.five{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:1100px){.pj-kpis,.pj-kpis.five{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:420px){.pj-kpis,.pj-kpis.five{grid-template-columns:1fr}.projects-module .pr-change-row{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.pj-kpi,.pr-cell{transition:none}.pj-kpi:hover{transform:none}}
`;

export default function StaffPayroll() {
  const { isAdmin } = useAccess(); // Viewers see staff and payroll but cannot change them
  const now = new Date();
  const currentMonth = ym(now.getFullYear(), now.getMonth() + 1);
  const [payments, setPayments] = useState<Payment[]>(() => load<Payment>(PAYMENTS_KEY));
  const [staff, setStaff] = useState<Staff[]>(() => load<LegacyStaff>(STAFF_KEY).map(s => migrateStaff(s, load<Payment>(PAYMENTS_KEY), currentMonth)));
  const [year, setYear] = useState(now.getFullYear());
  const [payMethod, setPayMethod] = useState<PayrollMethod>('Bank transfer');
  const [showFormer, setShowFormer] = useState(true);

  // staff form
  const blankForm = (): StaffForm => ({ name: '', position: '', startMonth: currentMonth, endMonth: '', startingSalary: 0, changes: [] });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [form, setForm] = useState<StaffForm>(blankForm);
  const [error, setError] = useState('');

  // month payment window
  const [payCell, setPayCell] = useState<{ staffId: string; year: number; month: number } | null>(null);
  const [payForm, setPayForm] = useState<{ amount: number; method: PayrollMethod }>({ amount: 0, method: 'Bank transfer' });
  const [payError, setPayError] = useState('');

  useEffect(() => { localStorage.setItem(STAFF_KEY, JSON.stringify(staff)); }, [staff]);
  useEffect(() => { localStorage.setItem(PAYMENTS_KEY, JSON.stringify(payments)); }, [payments]);

  // LEDGER: post any existing payment that has no ledger entry yet. Safe to run repeatedly.
  useEffect(() => {
    payments.forEach(p => {
      const s = staff.find(x => x.id === p.staffId);
      try { postPayrollPayment(toPosting(p, s?.name ?? 'Staff')); }
      catch (e) { console.error(`Could not post payroll payment ${p.id} to the ledger:`, e); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // LEDGER: keep "salaries owed" (Accrued Wages) in step with the staff list and payments.
  useEffect(() => {
    if (!isAdmin) return;
    try { syncPayrollAccruals(staff, payments); }
    catch (e) { console.error('Could not update salaries owed in the ledger:', e); }
  }, [staff, payments, isAdmin]);

  const yearPayments = useMemo(() => payments.filter(p => p.year === year), [payments, year]);
  /** All payments for one staff member and month, oldest first. */
  const paymentsByMonth = useMemo(() => {
    const map = new Map<string, Payment[]>();
    [...payments].sort((a, b) => a.paidAt.localeCompare(b.paidAt)).forEach(p => {
      const key = `${p.staffId}|${ym(p.year, p.month)}`;
      map.set(key, [...(map.get(key) ?? []), p]);
    });
    return map;
  }, [payments]);
  const paymentsOf = (staffId: string, y: number, month: number) => paymentsByMonth.get(`${staffId}|${ym(y, month)}`) ?? [];
  const paidOf = (staffId: string, y: number, month: number) => paymentsOf(staffId, y, month).reduce((s, p) => s + p.amount, 0);

  // Salaries owed: part-paid months and unpaid months that are over.
  const owed = useMemo(() => owedSalaries(staff, payments), [staff, payments]);
  const owedTotal = owed.reduce((s, o) => s + o.owed, 0);
  const owedKeys = useMemo(() => new Set(owed.map(o => `${o.staffId}|${o.month}`)), [owed]);

  // Month used to show a salary in the table: this month, or December / January of another year.
  const refMonth = year === now.getFullYear() ? currentMonth : year < now.getFullYear() ? ym(year, 12) : ym(year, 1);

  const rows = useMemo(() => staff
    .filter(s => showFormer || !(s.endMonth && s.endMonth < currentMonth))
    .map(s => {
      const mine = yearPayments.filter(p => p.staffId === s.id);
      // Months paid in full
      const months = MONTHS.filter((_, i) => { const salary = salaryFor(s, ym(year, i + 1)); const paid = paidOf(s.id, year, i + 1); return paid > 0 && paid >= salary; }).length;
      return { staff: s, months, total: mine.reduce((sum, p) => sum + p.amount, 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [staff, yearPayments, showFormer, currentMonth, paymentsByMonth, year]);

  const monthTotals = useMemo(() => MONTHS.map((_, i) => yearPayments.filter(p => p.month === i + 1).reduce((s, p) => s + p.amount, 0)), [yearPayments]);
  const yearTotal = monthTotals.reduce((s, n) => s + n, 0);
  const activeStaff = staff.filter(s => employedIn(s, currentMonth));
  const monthlyPayroll = activeStaff.reduce((s, x) => s + salaryFor(x, currentMonth), 0);
  const paidThisMonth = payments.filter(p => p.year === now.getFullYear() && p.month === now.getMonth() + 1).reduce((s, p) => s + p.amount, 0);

  /* ---------- paying a month ---------- */
  const openPay = (s: Staff, y: number, month: number) => {
    // Suggest what is still owed for the month (the full salary if nothing was paid yet).
    const left = Math.max(salaryFor(s, ym(y, month)) - paidOf(s.id, y, month), 0);
    setPayForm({ amount: left, method: payMethod });
    setPayError(''); setPayCell({ staffId: s.id, year: y, month });
  };
  const closePay = () => { setPayCell(null); setPayError(''); };

  const submitPay = () => {
    if (!payCell) return;
    const s = staff.find(x => x.id === payCell.staffId); if (!s) return;
    const { year: y, month } = payCell;
    const label = `${MONTHS[month - 1]} ${y}`;
    const left = salaryFor(s, ym(y, month)) - paidOf(s.id, y, month);
    if (!Number.isInteger(payForm.amount) || payForm.amount <= 0) { setPayError('Enter a whole RWF amount above zero.'); return; }
    if (payForm.amount > left) { setPayError(left > 0 ? `Only ${money(left)} is still owed for ${label}. To pay more, change the salary first.` : `${label} is already paid in full.`); return; }
    const earlier = paymentsOf(s.id, y, month).length;
    const record: Payment = { id: newId('PAY'), staffId: s.id, year: y, month, amount: payForm.amount, method: payForm.method, paidAt: new Date().toISOString() };
    // LEDGER: post first, so a payment is never saved without its journal entry
    try { postPayrollPayment(toPosting(record, s.name)); }
    catch (e) { setPayError(errText(e, 'Could not post to the ledger.')); return; }
    setPayments(old => [...old, record]);
    audit('payroll.paid', record.id, `Paid ${money(record.amount)} of ${label} salary for ${s.name}${earlier ? ' (balance)' : ''}`, { staffId: s.id, year: y, month, amount: record.amount, method: record.method, owedBefore: left });
    closePay();
  };

  const removePay = (existing: Payment) => {
    const s = staff.find(x => x.id === existing.staffId); if (!s) return;
    const label = `${MONTHS[existing.month - 1]} ${existing.year}`;
    if (!window.confirm(`Remove the ${label} payment of ${money(existing.amount)} for ${s.name}? A reversing entry will be posted to the ledger.`)) return;
    // LEDGER: post the reversing entry first
    try { reversePayrollPayment(existing.id, `${label} salary removed for ${s.name}`); }
    catch (e) { setPayError(errText(e, 'Could not reverse in the ledger.')); return; }
    setPayments(old => old.filter(p => p.id !== existing.id));
    audit('payroll.unpaid', existing.id, `Removed ${label} salary payment for ${s.name}`, { staffId: s.id, year: existing.year, month: existing.month, amount: existing.amount });
  };

  const payAll = (month: number) => {
    const label = `${MONTHS[month - 1]} ${year}`;
    // Everyone employed that month who is still owed something: the full salary, or the balance of a part payment.
    const leftOf = (s: Staff) => salaryFor(s, ym(year, month)) - paidOf(s.id, year, month);
    const due = staff.filter(s => employedIn(s, ym(year, month)) && leftOf(s) > 0);
    if (!due.length) { window.alert(`Everyone employed is already paid for ${label}.`); return; }
    const total = due.reduce((s, x) => s + leftOf(x), 0);
    if (!window.confirm(`Mark ${due.length} staff as paid for ${label} by ${payMethod}? Total ${money(total)}.`)) return;
    const base = Date.now();
    const added: Payment[] = [];
    let failure = '';
    for (const s of due) {
      const record: Payment = { id: newId('PAY'), staffId: s.id, year, month, amount: leftOf(s), method: payMethod, paidAt: new Date(base + added.length).toISOString() };
      // LEDGER: post first, so a payment is never saved without its journal entry
      try { postPayrollPayment(toPosting(record, s.name)); added.push(record); }
      catch (e) { failure = errText(e, 'Could not post to the ledger.'); break; }
    }
    if (added.length) {
      setPayments(old => [...old, ...added]);
      audit('payroll.paid_all', ym(year, month), `Paid ${label} salaries to ${added.length} staff`, { year, month, method: payMethod, total: added.reduce((s, p) => s + p.amount, 0), ids: added.map(p => p.id) });
    }
    if (failure) window.alert(`Paid ${added.length} of ${due.length}. Stopped because the ledger rejected a payment: ${failure}`);
  };

  /* ---------- staff form ---------- */
  const openAdd = () => { setEditing(null); setForm(blankForm()); setError(''); setFormOpen(true); };
  const openEdit = (s: Staff) => {
    const sorted = [...s.salaryHistory].sort((a, b) => a.from.localeCompare(b.from));
    setEditing(s);
    setForm({ name: s.name, position: s.position, startMonth: s.startMonth, endMonth: s.endMonth, startingSalary: sorted[0]?.amount ?? 0, changes: sorted.slice(1) });
    setError(''); setFormOpen(true);
  };
  const setField = <K extends keyof StaffForm>(key: K, value: StaffForm[K]) => setForm(old => ({ ...old, [key]: value }));
  const addChange = () => setForm(old => ({ ...old, changes: [...old.changes, { from: '', amount: 0 }] }));
  const updateChange = (i: number, patch: Partial<SalaryChange>) => setForm(old => ({ ...old, changes: old.changes.map((c, idx) => idx === i ? { ...c, ...patch } : c) }));
  const removeChange = (i: number) => setForm(old => ({ ...old, changes: old.changes.filter((_, idx) => idx !== i) }));

  const saveStaff = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    const name = form.name.trim();
    const okSalary = (n: number) => Number.isInteger(n) && n >= 0;
    if (!name) { setError('Enter the staff member\u2019s name.'); return; }
    if (form.startMonth && form.endMonth && form.endMonth < form.startMonth) { setError('The last month of employment cannot be before the first month.'); return; }
    if (!okSalary(form.startingSalary)) { setError('Enter the starting salary in whole RWF.'); return; }
    const seen = new Set<string>();
    for (const c of form.changes) {
      if (!c.from) { setError('Choose the month each salary change starts from.'); return; }
      if (!okSalary(c.amount)) { setError('Enter each changed salary in whole RWF.'); return; }
      if (seen.has(c.from)) { setError(`There are two salary changes for ${monthLabel(c.from)}. Keep one.`); return; }
      seen.add(c.from);
    }
    const salaryHistory: SalaryChange[] = [{ from: '', amount: form.startingSalary }, ...[...form.changes].sort((a, b) => a.from.localeCompare(b.from))];
    if (editing) {
      setStaff(old => old.map(s => s.id === editing.id ? { ...s, name, position: form.position.trim(), startMonth: form.startMonth, endMonth: form.endMonth, salaryHistory } : s));
      audit('staff.updated', editing.id, `Updated staff member ${name}`, { before: { start: editing.startMonth, end: editing.endMonth, salaryHistory: editing.salaryHistory }, after: { start: form.startMonth, end: form.endMonth, salaryHistory } });
    } else {
      const nextNo = staff.reduce((max, s) => { const m = s.id.match(/^STF-(\d+)$/); return m ? Math.max(max, Number(m[1])) : max; }, 0) + 1;
      const record: Staff = { id: `STF-${String(nextNo).padStart(3, '0')}`, name, position: form.position.trim(), startMonth: form.startMonth, endMonth: form.endMonth, salaryHistory, createdAt: new Date().toISOString() };
      setStaff(old => [...old, record]);
      audit('staff.added', record.id, `Added staff member ${name}`, { position: record.position, startMonth: record.startMonth, salaryHistory });
    }
    setFormOpen(false);
  };

  const deleteStaff = () => {
    if (!editing) return;
    if (payments.some(p => p.staffId === editing.id)) { setError('This person has salary payments on record, so they cannot be deleted. Set the last month of employment instead.'); return; }
    if (!window.confirm(`Delete ${editing.name}?`)) return;
    setStaff(old => old.filter(s => s.id !== editing.id));
    audit('staff.deleted', editing.id, `Deleted staff member ${editing.name}`);
    setFormOpen(false);
  };

  const payStaff = payCell ? staff.find(s => s.id === payCell.staffId) : undefined;
  const payList = payCell && payStaff ? paymentsOf(payStaff.id, payCell.year, payCell.month) : [];
  const paySalary = payCell && payStaff ? salaryFor(payStaff, ym(payCell.year, payCell.month)) : 0;
  const payPaid = payList.reduce((s, p) => s + p.amount, 0);
  const payLeft = Math.max(paySalary - payPaid, 0);
  const monthName = MONTHS[now.getMonth()];

  return <section className="projects-module">
    <style>{PAYROLL_CSS}</style>

    <div className="welcome-row">
      <div><div className="eyebrow">PEOPLE &amp; PAYROLL</div><h2>Staff &amp; Payroll</h2><p>Manage staff, their salaries by month, and which months have been paid.</p></div>
      <div className="pr-controls">
        <label className="pr-method">Pay from
          <select value={payMethod} onChange={e => setPayMethod(e.target.value as PayrollMethod)}>{METHODS.map(m => <option key={m}>{m}</option>)}</select>
        </label>
        <div className="pr-year">
          <button onClick={() => setYear(y => y - 1)} aria-label="Previous year"><ChevronLeft size={15} /></button>
          <strong>{year}</strong>
          <button onClick={() => setYear(y => y + 1)} aria-label="Next year"><ChevronRight size={15} /></button>
        </div>
        {isAdmin && <button className="primary-button" onClick={openAdd}><Plus size={16} /> Add staff</button>}
      </div>
    </div>

    <div className="pj-kpis five">
      <Metric title="Staff this month" value={String(activeStaff.length)} note={`${staff.length - activeStaff.length} not currently employed`} icon={<Users size={13} />} tone="blue" />
      <Metric title="Monthly payroll" value={money(monthlyPayroll)} note={`Salaries for ${monthName}`} icon={<Banknote size={13} />} tone="blue" />
      <Metric title={`Paid in ${year}`} value={money(yearTotal)} note={`${yearPayments.length} salary payment${yearPayments.length === 1 ? '' : 's'}`} icon={<Wallet size={13} />} tone="green" />
      <Metric title={`Paid in ${monthName}`} value={money(paidThisMonth)} note={`Current month, ${now.getFullYear()}`} icon={<CalendarCheck size={13} />} tone="green" />
      <Metric title="Salaries owed" value={money(owedTotal)} note={owed.length ? `${owed.length} month${owed.length === 1 ? '' : 's'} not fully paid` : 'All finished months are paid'} icon={<AlertCircle size={13} />} tone={owedTotal > 0 ? 'amber' : 'green'} />
    </div>

    <div className="panel projects-register">
      <div className="panel-heading projects-heading">
        <div>
          <h3>Payroll {year}</h3>
          <p>Click a month to pay it, pay a balance, or remove a payment. Click a month name to pay everyone still owed for that month. Use the pencil to edit a staff member.</p>
          <div className="pr-legend"><span><i style={{ background: '#6fd6a0' }} />Paid</span><span><i style={{ background: 'linear-gradient(135deg,#f6c47d 50%,#fff 50%)', border: '1px solid #f0b35a' }} />Part-paid</span><span><i style={{ background: '#fff8ec', border: '1px solid #f0b35a' }} />Month over, not paid</span></div>
        </div>
        <label className="pr-toggle"><input type="checkbox" checked={showFormer} onChange={e => setShowFormer(e.target.checked)} /> Show former staff</label>
      </div>

      {rows.length === 0 ? (
        <div className="projects-empty">
          <div className="projects-empty-icon"><Users size={24} /></div>
          <h3>No staff added yet</h3>
          <p>{isAdmin ? 'Add your staff with their start month and salary, then pay each month as it falls due.' : 'Staff will appear here once the Admin adds them.'}</p>
          {isAdmin && <div className="projects-header-actions" style={{ justifyContent: 'center' }}>
            <button className="primary-button" onClick={openAdd}><Plus size={16} /> Add first staff member</button>
          </div>}
        </div>
      ) : (
        <div className="projects-table-wrap">
          <table className="projects-table pr-table">
            <thead><tr>
              <th className="left sticky">Name</th>
              <th className="left">Position</th>
              <th className="right" title={`Salary for ${monthLabel(refMonth)}`}>Monthly salary</th>
              {MONTHS.map((m, i) => <th key={m}>{isAdmin ? <button type="button" className="pr-month-btn" onClick={() => payAll(i + 1)} title={`Pay everyone employed in ${m} ${year}`}>{m.slice(0, 3)}</button> : <span className="pr-month-btn readonly">{m.slice(0, 3)}</span>}</th>)}
              <th>Months paid</th>
              <th className="right">Total paid</th>
            </tr></thead>
            <tbody>{rows.map(({ staff: s, months, total }) => {
              const former = !!s.endMonth && s.endMonth < currentMonth;
              const notStarted = !!s.startMonth && s.startMonth > currentMonth;
              return <tr key={s.id} className={former ? 'former' : undefined}>
                <td className="left sticky nowrap">
                  {isAdmin && <button type="button" className="pr-edit-btn" onClick={() => openEdit(s)} title="Edit staff member" aria-label={`Edit ${s.name}`}><Pencil size={12} /></button>}
                  {isAdmin ? <button type="button" className="pr-name-btn" onClick={() => openEdit(s)}>{s.name}</button> : <strong className="pr-name-btn readonly">{s.name}</strong>}
                  {former && <span className="pr-chip left">Left {monthLabel(s.endMonth)}</span>}
                  {notStarted && <span className="pr-chip soon">Starts {monthLabel(s.startMonth)}</span>}
                </td>
                <td className="left nowrap">{s.position || '—'}</td>
                <td className="right nowrap money-cell">{money(salaryFor(s, refMonth))}</td>
                {MONTHS.map((m, i) => {
                  const month = ym(year, i + 1);
                  const list = paymentsOf(s.id, year, i + 1);
                  const paid = list.reduce((sum, x) => sum + x.amount, 0);
                  const salary = salaryFor(s, month);
                  const employed = employedIn(s, month);
                  const full = paid > 0 && paid >= salary;
                  const state = full ? 'paid' : paid > 0 ? 'part' : !employed ? 'off' : owedKeys.has(`${s.id}|${month}`) ? 'due late' : 'due';
                  const clickable = employed || paid > 0;
                  const tip = full ? `Paid ${money(paid)}${list.length > 1 ? ` in ${list.length} payments` : ` by ${list[0].method ?? 'Bank transfer'} on ${new Date(list[0].paidAt).toLocaleDateString()}`}`
                    : paid > 0 ? `Paid ${money(paid)} of ${money(salary)} · ${money(salary - paid)} owed`
                    : employed ? `Salary ${money(salary)}.${owedKeys.has(`${s.id}|${month}`) ? ' Owed.' : ''}${isAdmin ? ' Click to pay.' : ' Not paid yet.'}` : 'Not employed this month';
                  return <td key={m} style={{ padding: '8px 4px' }}>
                    <button type="button" disabled={!clickable || !isAdmin} onClick={() => openPay(s, year, i + 1)}
                      className={`pr-cell ${state}${isAdmin ? '' : ' readonly'}`}
                      aria-label={`${s.name}, ${m} ${year}: ${full ? 'paid' : paid > 0 ? 'part-paid' : employed ? 'not paid' : 'not employed'}`}
                      title={tip}>
                      {full && <Check size={15} strokeWidth={3} />}
                    </button>
                  </td>;
                })}
                <td>{months}</td>
                <td className="right nowrap money-cell"><strong>{money(total)}</strong></td>
              </tr>;
            })}</tbody>
            <tfoot><tr>
              <td className="left sticky">Total</td>
              <td />
              <td className="right nowrap money-cell">{money(rows.filter(r => employedIn(r.staff, refMonth)).reduce((s, r) => s + salaryFor(r.staff, refMonth), 0))}</td>
              {monthTotals.map((t, i) => <td key={i} className="small">{t ? money(t) : '—'}</td>)}
              <td>{yearPayments.length}</td>
              <td className="right nowrap money-cell">{money(yearTotal)}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
    </div>

    {owed.length > 0 && <div className="panel projects-register">
      <div className="panel-heading projects-heading">
        <div>
          <h3>Salaries owed</h3>
          <p>Months that are over but not fully paid. They show on the balance sheet as Accrued Wages until they are paid.</p>
        </div>
      </div>
      <div className="projects-table-wrap">
        <table className="pr-owed-table">
          <thead><tr><th>Staff</th><th>Month</th><th className="num">Salary</th><th className="num">Paid</th><th className="num">Owed</th></tr></thead>
          <tbody>{owed.map(o => {
            const s = staff.find(x => x.id === o.staffId);
            const [oy, om] = o.month.split('-').map(Number);
            return <tr key={`${o.staffId}|${o.month}`}>
              <td>{isAdmin && s ? <button type="button" className="pr-link" onClick={() => openPay(s, oy, om)} title="Pay this month">{o.name}</button> : <strong>{o.name}</strong>}</td>
              <td>{monthLabel(o.month)}</td>
              <td className="num">{money(o.salary)}</td>
              <td className="num">{money(o.paid)}</td>
              <td className="num"><strong>{money(o.owed)}</strong></td>
            </tr>;
          })}</tbody>
          <tfoot><tr><td colSpan={4}>Total owed</td><td className="num">{money(owedTotal)}</td></tr></tfoot>
        </table>
      </div>
    </div>}

    {payCell && payStaff && isAdmin && <div className="projects-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) closePay(); }}>
      <section className="projects-modal pr-pay-modal" role="dialog" aria-modal="true" aria-labelledby="pay-title">
        <div className="projects-modal-header">
          <div><div className="eyebrow">{payLeft > 0 ? 'PAY SALARY' : 'SALARY PAID'}</div><h3 id="pay-title">{payStaff.name} · {MONTHS[payCell.month - 1]} {payCell.year}</h3></div>
          <button className="projects-close" onClick={closePay} aria-label="Close"><X size={19} /></button>
        </div>
        <p className={`pr-pay-info${payLeft > 0 ? '' : ' done'}`}>
          Salary for this month: <strong>{money(paySalary)}</strong>
          {payPaid > 0 && <> · Paid: <strong>{money(payPaid)}</strong></>}
          {payPaid > 0 && (payLeft > 0 ? <> · Still owed: <strong>{money(payLeft)}</strong></> : <> · Paid in full</>)}
        </p>
        {payList.length > 0 && <div className="pr-paylist">
          {payList.map(p => <div key={p.id} className="pr-payrow">
            <div><strong>{money(p.amount)}</strong> <span>· {p.method ?? 'Bank transfer'} · {new Date(p.paidAt).toLocaleDateString()}</span></div>
            <button type="button" onClick={() => removePay(p)} aria-label={`Remove payment of ${money(p.amount)}`}><Trash2 size={12} /> Remove</button>
          </div>)}
        </div>}
        {payLeft > 0 && <div className="pr-stack">
          <label className="projects-field">{payPaid > 0 ? 'Pay the balance or part of it (RWF)' : 'Amount paid (RWF)'}<input type="number" min="1" step="1" max={payLeft} value={payForm.amount || ''} onChange={e => setPayForm(f => ({ ...f, amount: Number(e.target.value) }))} /></label>
          <label className="projects-field">Paid from<select value={payForm.method} onChange={e => setPayForm(f => ({ ...f, method: e.target.value as PayrollMethod }))}>{METHODS.map(m => <option key={m}>{m}</option>)}</select></label>
          <p className="pr-help">Paying less than the salary leaves the rest as owed. Once the month is over, it shows under Salaries owed until it is paid.</p>
        </div>}
        {payError && <p className="projects-validation" role="alert">{payError}</p>}
        <div className="pr-split">
          <div className="group">
            <button type="button" className="projects-cancel" onClick={closePay}>{payLeft > 0 ? 'Cancel' : 'Close'}</button>
            {payLeft > 0 && <button type="button" className="primary-button" onClick={submitPay}><Check size={15} /> {payPaid > 0 ? 'Record payment' : 'Mark as paid'}</button>}
          </div>
        </div>
      </section>
    </div>}

    {formOpen && isAdmin && <div className="projects-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setFormOpen(false); }}>
      <section className="projects-modal" role="dialog" aria-modal="true" aria-labelledby="staff-form-title">
        <div className="projects-modal-header">
          <div><div className="eyebrow">{editing ? editing.id : 'NEW STAFF MEMBER'}</div><h3 id="staff-form-title">{editing ? 'Edit staff member' : 'Add staff member'}</h3></div>
          <button className="projects-close" onClick={() => setFormOpen(false)} aria-label="Close"><X size={19} /></button>
        </div>
        <form onSubmit={saveStaff}>
          <div className="projects-form-grid">
            <label className="projects-field">Full name *<input required value={form.name} onChange={e => setField('name', e.target.value)} placeholder="e.g. Eugene TUYIZERE" /></label>
            <label className="projects-field">Position<input value={form.position} onChange={e => setField('position', e.target.value)} placeholder="e.g. Foreman" /></label>
            <label className="projects-field">First month of employment<input type="month" value={form.startMonth} onChange={e => setField('startMonth', e.target.value)} /></label>
            <label className="projects-field">Last month of employment<input type="month" value={form.endMonth} onChange={e => setField('endMonth', e.target.value)} /></label>
            <p className="pr-help field-wide">Months outside this period are greyed out and cannot be paid. Leave the last month empty while they are still employed.</p>

            <label className="projects-field field-wide">Starting salary per month (RWF) *<input required type="number" min="0" step="1" value={form.startingSalary || ''} onChange={e => setField('startingSalary', Number(e.target.value))} /></label>

            <div className="pr-changes">
              <div className="pr-changes-head"><strong>Salary changes</strong><button type="button" className="projects-secondary-button" onClick={addChange}><Plus size={14} /> Add salary change</button></div>
              {form.changes.length === 0 && <p className="pr-help">No changes. The starting salary applies to every month.</p>}
              {form.changes.map((c, i) => <div key={i} className="pr-change-row">
                <label className="projects-field">New salary from<input type="month" value={c.from} onChange={e => updateChange(i, { from: e.target.value })} /></label>
                <label className="projects-field">Salary (RWF)<input type="number" min="0" step="1" value={c.amount || ''} onChange={e => updateChange(i, { amount: Number(e.target.value) })} /></label>
                <button type="button" className="pr-remove" onClick={() => removeChange(i)} aria-label="Remove salary change"><Trash2 size={14} /></button>
              </div>)}
              <p className="pr-help">A change applies from that month onward. Months already paid keep the amount they were paid.</p>
            </div>
          </div>

          {error && <p className="projects-validation" role="alert">{error}</p>}
          <div className="pr-split">
            {editing && <button type="button" className="projects-cancel pr-danger" onClick={deleteStaff}><Trash2 size={14} /> Delete</button>}
            <div className="group">
              <button type="button" className="projects-cancel" onClick={() => setFormOpen(false)}>Cancel</button>
              <button type="submit" className="primary-button"><Plus size={15} /> {editing ? 'Save changes' : 'Add staff'}</button>
            </div>
          </div>
        </form>
      </section>
    </div>}
  </section>;
}

function Metric({ title, value, note, icon, tone }: { title: string; value: string; note: string; icon: ReactNode; tone: 'green' | 'blue' | 'amber' | 'rose' }) {
  return (
    <article className={`pj-kpi tone-${tone}`}>
      <div className="pj-kpi-top"><span className="pj-kpi-icon" aria-hidden="true">{icon}</span><span className="pj-kpi-label">{title}</span></div>
      <div className="pj-kpi-value">{value}</div>
      <div className="pj-kpi-note">{note}</div>
    </article>
  );
}
