import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Download, Printer, CheckCircle2, AlertTriangle, TrendingUp, TrendingDown, Wallet, Activity, FileDown } from 'lucide-react';
import { ACC, ACCOUNTS, getAccount, isDebitNormal, isDirectCost } from '../lib/accounts';
import type { Account, AccountType } from '../lib/accounts';
import { syncStoredInvoices, syncStoredProjectCosts } from '../lib/postings';
import { useLedgerEntries } from '../lib/useLedger';
import type { JournalEntry } from '../lib/ledger';
import { useAccess } from '../lib/access';
import { buildReport, rwf, shortDay } from '../lib/weeklyReport';
import type { WRCost, WRLabour } from '../lib/weeklyReport';

const PROJECTS_KEY = 'ista-fortis-projects-v1';
const INVOICES_KEY = 'ista-fortis-invoices-v1';
const COSTS_KEY = 'ista-fortis-project-costs-v1';
const LABOUR_KEY = 'ista-fortis-site-labour-v1';
const CASH_CODES: string[] = [ACC.cash, ACC.bank, ACC.mobileMoney];

type TabId = 'income' | 'balance' | 'cashflow' | 'projects' | 'receivables' | 'trial' | 'weekly';
type PresetId = 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'quarter' | 'year' | 'lastYear' | 'all' | 'custom';
type CsvRow = (string | number)[];
type Line = { code: string; name: string; amount: number };
type Totals = Map<string, { debit: number; credit: number }>;
type ProjectRow = { id: string; projectName: string; client: string; contractValue: number; totalReceived: number; status: string };
type InvoiceRow = { invoiceNumber: string; client: string; amount: number; dueDate: string; projectId?: string; voided?: boolean; payments?: { amount: number; date?: string }[] };

const TABS: { id: TabId; label: string }[] = [
  { id: 'income', label: 'Income statement' },
  { id: 'balance', label: 'Balance sheet' },
  { id: 'cashflow', label: 'Cash flow' },
  { id: 'projects', label: 'Project profitability' },
  { id: 'receivables', label: 'Receivables & payables' },
  { id: 'trial', label: 'Trial balance' },
  { id: 'weekly', label: 'Weekly report' },
];

const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'lastWeek', label: 'Last week' },
  { id: 'month', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'year', label: 'This year' },
  { id: 'lastYear', label: 'Last year' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom dates' },
];

const SOURCE_LABELS: Record<string, string> = {
  client_payment: 'Client payments received',
  client_invoice: 'Client invoices paid in cash',
  cost_payment: 'Supplier payments',
  project_cost: 'Project costs paid at purchase',
  expense: 'Expenses paid',
  payroll: 'Salaries paid',
  opening_balance: 'Opening balances',
  manual: 'Other entries',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const prettyDate = (value: string) => {
  const [y, m, d] = value.split('-').map(Number);
  return Number.isFinite(y) && m >= 1 && m <= 12 ? `${pad(d)} ${MONTHS[m - 1]} ${y}` : value;
};
const money = (n: number) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number.isFinite(n) ? Math.round(n) : 0);
/** Accounting style: negatives in brackets. */
const fmt = (n: number) => (n < 0 ? `(${money(-n)})` : money(n));
const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—');
const sumOf = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);
const daysBetween = (a: string, b: string) => Math.floor((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

function rangeFor(preset: PresetId, now: Date): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const monday = now.getDate() - ((now.getDay() + 6) % 7); // weeks run Monday to Sunday
  switch (preset) {
    case 'week': return { from: iso(new Date(y, m, monday)), to: iso(new Date(y, m, monday + 6)) };
    case 'lastWeek': return { from: iso(new Date(y, m, monday - 7)), to: iso(new Date(y, m, monday - 1)) };
    case 'month': return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'lastMonth': return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'quarter': { const q = Math.floor(m / 3) * 3; return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) }; }
    case 'year': return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'lastYear': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default: return { from: '', to: '' };
  }
}

function readList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data as T[] : [];
  } catch { return []; }
}

function readLabour(): { entries: WRLabour[]; activities: Record<string, string> } {
  try {
    const raw = localStorage.getItem(LABOUR_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return {
      entries: Array.isArray(v?.entries) ? v.entries as WRLabour[] : [],
      activities: v?.activities && typeof v.activities === 'object' ? v.activities as Record<string, string> : {},
    };
  } catch { return { entries: [], activities: {} }; }
}

function sumAccounts(entries: readonly JournalEntry[], from: string, to: string): Totals {
  const map: Totals = new Map();
  for (const e of entries) {
    if ((from && e.date < from) || (to && e.date > to)) continue;
    for (const l of e.lines) {
      const t = map.get(l.account) ?? { debit: 0, credit: 0 };
      t.debit += l.debit;
      t.credit += l.credit;
      map.set(l.account, t);
    }
  }
  return map;
}

function balanceOf(totals: Totals, code: string): number {
  const account = getAccount(code);
  const t = totals.get(code);
  if (!account || !t) return 0;
  return isDebitNormal(account.type) ? t.debit - t.credit : t.credit - t.debit;
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function downloadCSV(name: string, rows: CsvRow[]) {
  const blob = new Blob(['\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Page styles live here so this page is a single file. They mirror the Project Costs page and are
 * scoped under .projects-module, so they restyle this page only. Existing rep-* class names are kept
 * so print rules in index.css still apply.
 */
const REPORTS_CSS = `
.projects-module{--lime:#d5f56b;--lime-ink:#1d2b12;--ink:#1c2b22;--muted:#7d8a83;--line:#edf0f1;display:flex;flex-direction:column;gap:22px;color:var(--ink)}
.projects-module button:focus-visible{outline:2px solid #2f8f6b;outline-offset:2px}

/* header */
.projects-module .welcome-row{margin-bottom:0;gap:20px;flex-wrap:wrap;align-items:flex-end}
.projects-module .welcome-row h2{font-size:28px;font-weight:700;letter-spacing:-.4px;margin:6px 0 4px;color:var(--ink)}
.projects-module .welcome-row p{font-size:13px;color:var(--muted)}
.projects-module .rep-actions{display:flex;flex-wrap:wrap;gap:10px}
.projects-module .projects-secondary-button{height:39px;padding:0 14px;display:inline-flex;align-items:center;gap:6px;border-radius:12px;border:1px solid var(--line);background:#fff;color:var(--ink);font:inherit;font-size:12px;font-weight:600;cursor:pointer}
.projects-module .projects-secondary-button:hover{background:#f4f7f6}
.projects-module .primary-button{height:39px;border-radius:12px;background:var(--lime);color:var(--lime-ink);font-size:12px;font-weight:600;box-shadow:none}
.projects-module .primary-button:hover{background:#c8ea52}

/* pastel KPI cards */
.pj-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
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
.pj-kpi.neg .pj-kpi-value{color:#b04a58}
.pj-kpi-note{font-size:10.5px;color:#4f5d55;margin-top:auto;line-height:1.45}

/* period controls */
.projects-module .rep-controls{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;padding:16px 20px;margin:0;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 2px #1c2b2208}
.projects-module .rep-field{display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:500;color:#8a968f}
.projects-module .rep-field select,.projects-module .rep-field input{height:38px;min-width:150px;border-radius:12px;border:1px solid var(--line);background:#fff;color:var(--ink);padding:0 10px;font:inherit;font-size:12px}
.projects-module .rep-field input:disabled{opacity:.5;cursor:not-allowed}
.projects-module .rep-hint{flex:1 1 220px;margin:0 0 10px;font-size:11.5px;color:var(--muted)}
.projects-module .rep-warning{display:flex;align-items:center;gap:8px;margin:0;padding:12px 14px;border-radius:12px;background:#fbd6db;color:#b04a58;font-size:12px}

/* report tabs */
.projects-module .rep-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:5px;width:fit-content;max-width:100%;background:#fff;border:1px solid var(--line);border-radius:14px;margin:0}
.projects-module .rep-tab{border:0;background:transparent;border-radius:10px;padding:8px 14px;font:inherit;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer;white-space:nowrap}
.projects-module .rep-tab:hover{background:#f4f7f6;color:var(--ink)}
.projects-module .rep-tab.active{background:var(--lime);color:var(--lime-ink)}

/* report card */
.projects-module .rep-card{padding:20px 0 6px;margin:0;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 2px #1c2b2208;overflow:hidden}
.projects-module .rep-card-head{padding:0 20px 14px}
.projects-module .rep-card-head h3{font-size:16px;font-weight:600;color:var(--ink);margin:4px 0 2px}
.projects-module .rep-card-head p{font-size:12px;color:var(--muted);margin:0}

/* report tables */
.projects-module .rep-table{width:100%;border-collapse:collapse}
.projects-module .rep-table th,.projects-module .rep-table td{padding:12px 20px;font-size:12px;color:#3b4a42;text-align:left;border:0;border-bottom:1px solid #f1f4f4}
.projects-module .rep-table thead th{background:transparent;font-size:11px;font-weight:500;color:#8a968f;border-bottom:1px solid var(--line);white-space:nowrap}
.projects-module .rep-table tbody tr:hover{background:#f7faf9}
.projects-module .rep-table tbody tr:last-child td{border-bottom:0}
.projects-module .rep-table .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.projects-module .rep-table .code{width:72px;color:var(--muted);font-variant-numeric:tabular-nums}
.projects-module .rep-table td.indent{padding-left:32px}
.projects-module .rep-table strong{font-size:12px;font-weight:600;color:var(--ink)}
.projects-module .rep-section th{padding-top:18px;background:transparent;font-size:11px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:#1f7a4f;border-bottom:1px solid var(--line)}
.projects-module .rep-group td{font-weight:600;color:var(--ink);background:#fafcfb}
.projects-module .rep-none td{color:var(--muted);font-style:italic}
.projects-module .rep-total td{font-weight:600;color:var(--ink);background:#f7faf9}
.projects-module .rep-grand td{font-size:12.5px;font-weight:700;color:var(--ink);background:#eef8f2}
.projects-module .rep-grand.final td{background:#bdeed6;color:#1f6b46}
.projects-module .rep-grand em{font-style:normal;font-weight:500;color:#4f5d55}
.projects-module .rep-flag td{background:#fdf1f3}
.projects-module .rep-sub{display:block;margin-top:3px;font-size:10.5px;color:var(--muted)}
.projects-module .rep-scroll{overflow-x:auto}
.projects-module .rep-wide{min-width:720px}
.projects-module .rep-subhead{font-size:13px;font-weight:600;color:var(--ink);margin:18px 20px 6px}

/* notes and checks */
.projects-module .rep-check{display:flex;align-items:center;gap:8px;margin:14px 20px;padding:12px 14px;border-radius:12px;font-size:12px}
.projects-module .rep-check.ok{background:#bdeed6;color:#1f6b46}
.projects-module .rep-check.bad{background:#fbd6db;color:#b04a58}
.projects-module .rep-note{margin:12px 20px;padding:12px 14px;border-radius:12px;background:#eef8f2;color:#3f5a4c;font-size:11.5px;line-height:1.6}
.projects-module .rep-empty{padding:40px 20px;text-align:center;color:var(--muted);font-size:12.5px;line-height:1.7}
.projects-module .rep-source{margin:0;font-size:11.5px;color:var(--muted)}

/* keep text left-aligned even where older global rep-* rules say otherwise */
.projects-module .welcome-row>div:first-child,.projects-module .rep-card-head,.projects-module .rep-hint,.projects-module .rep-note,.projects-module .rep-source,.projects-module .rep-empty-left{text-align:left}

@media(max-width:1100px){.pj-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}

/* phones */
@media(max-width:640px){
.projects-module{gap:16px}
.projects-module .welcome-row{display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:14px;text-align:left}
.projects-module .welcome-row>div:first-child{width:100%;margin:0}
.projects-module .welcome-row h2{font-size:24px}
.projects-module .rep-actions{width:100%;margin:0;justify-content:stretch}
.projects-module .rep-actions>button{flex:1 1 0;justify-content:center}
.projects-module .rep-controls{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:14px}
.projects-module .rep-field{min-width:0;width:auto;margin:0}
.projects-module .rep-field:first-child,.projects-module .rep-hint{grid-column:1/-1}
.projects-module .rep-field select,.projects-module .rep-field input{min-width:0;width:100%}
.projects-module .rep-hint{margin:0}
.pj-kpis{gap:10px}
.pj-kpi{padding:12px 12px 14px}
.pj-kpi-value{font-size:clamp(14px,11cqw,20px);margin:12px 0 4px}
.projects-module .rep-tabs{flex-wrap:nowrap;width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.projects-module .rep-tabs::-webkit-scrollbar{display:none}
.projects-module .rep-tab{flex:0 0 auto}
.projects-module .rep-card{padding-top:16px}
.projects-module .rep-card-head{display:block;padding:0 14px 12px}
.projects-module .rep-table th,.projects-module .rep-table td{padding:10px 14px}
.projects-module .rep-table .code{width:auto;padding-right:4px;font-size:11px}
.projects-module .rep-table td.indent{padding-left:20px}
.projects-module .rep-subhead{margin:16px 14px 6px}
.projects-module .rep-check,.projects-module .rep-note{margin:12px 14px}
}
.projects-module .wr-summary{margin:0 20px 14px;font-size:12.5px;line-height:1.7;color:#3b4a42}
.projects-module .wr-day td:first-child{white-space:nowrap;font-weight:600;color:var(--ink)}
.projects-module .wr-issues{margin:0 20px 14px;padding-left:18px;font-size:12px;line-height:1.7;color:#3b4a42}
.projects-module .wr-priorities{display:block;margin:0 20px 18px;font-size:11.5px;color:var(--muted)}
.projects-module .wr-priorities textarea{display:block;width:100%;box-sizing:border-box;margin-top:6px;min-height:96px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;font:inherit;font-size:12.5px;color:var(--ink);resize:vertical}
.projects-module .wr-priorities textarea:focus{outline:none;border-color:#1a9e6f;box-shadow:0 0 0 3px #1a9e6f22}
.projects-module .rep-card-head.wr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
@media(max-width:600px){.projects-module .wr-summary,.projects-module .wr-issues{margin-left:14px;margin-right:14px}.projects-module .wr-priorities{margin:0 14px 16px}.projects-module .rep-card-head.wr-head .primary-button{width:100%;justify-content:center}}
@media(prefers-reduced-motion:reduce){.pj-kpi{transition:none}.pj-kpi:hover{transform:none}}
@media print{.projects-module{gap:12px}.pj-kpi,.projects-module .rep-card{box-shadow:none;transform:none}.projects-module .rep-card{border:0;border-radius:0}.pj-kpi,.projects-module .rep-grand td,.projects-module .rep-total td,.projects-module .rep-check{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

export default function FinancialReports() {
  // Make sure project costs and invoices saved before the ledger existed are in the ledger.
  useEffect(() => { syncStoredProjectCosts(); syncStoredInvoices(); }, []);

  const entries = useLedgerEntries();
  const projects = useMemo(() => readList<ProjectRow>(PROJECTS_KEY), []);
  const invoices = useMemo(() => readList<InvoiceRow>(INVOICES_KEY), []);
  const costs = useMemo(() => readList<WRCost>(COSTS_KEY), []);
  const labour = useMemo(() => readLabour(), []);
  const { name: preparedBy } = useAccess();
  const [priorities, setPriorities] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);

  const [tab, setTab] = useState<TabId>('income');
  const [preset, setPreset] = useState<PresetId>('year');
  const [range, setRange] = useState(() => rangeFor('year', new Date()));

  const todayStr = iso(new Date());
  const asAt = range.to || todayStr;
  const rangeInvalid = !!range.from && !!range.to && range.from > range.to;

  const choosePreset = (p: PresetId) => {
    setPreset(p);
    if (p !== 'custom') setRange(rangeFor(p, new Date()));
  };
  const editDate = (key: 'from' | 'to', value: string) => {
    setPreset('custom');
    setRange(r => ({ ...r, [key]: value }));
  };

  const openTab = (t: TabId) => {
    setTab(t);
    // The weekly report needs both dates; start it on the current week.
    if (t === 'weekly' && (!range.from || !range.to)) choosePreset('week');
  };

  const periodLabel = range.from && range.to ? `${prettyDate(range.from)} to ${prettyDate(range.to)}`
    : range.from ? `From ${prettyDate(range.from)}`
    : range.to ? `Up to ${prettyDate(range.to)}`
    : 'All time';

  const data = useMemo(() => {
    const period = sumAccounts(entries, range.from, range.to);
    const upTo = sumAccounts(entries, '', range.to);
    const line = (a: Account, totals: Totals): Line => ({ code: a.code, name: a.name, amount: balanceOf(totals, a.code) });
    const nonZero = (rows: Line[]) => rows.filter(r => r.amount !== 0);

    // Income statement
    const revenue = nonZero(ACCOUNTS.filter(a => a.type === 'Revenue').map(a => line(a, period)));
    const direct = nonZero(ACCOUNTS.filter(a => a.type === 'Expense' && a.code.startsWith('5')).map(a => line(a, period)));
    const opex = nonZero(ACCOUNTS.filter(a => a.type === 'Expense' && !a.code.startsWith('5')).map(a => line(a, period)));
    const totalRevenue = sumOf(revenue);
    const totalDirect = sumOf(direct);
    const totalOpex = sumOf(opex);
    const grossProfit = totalRevenue - totalDirect;
    const netProfit = grossProfit - totalOpex;

    // Balance sheet (as at the end date)
    const section = (type: AccountType) => {
      const groups = new Map<string, Line[]>();
      for (const a of ACCOUNTS.filter(x => x.type === type)) {
        const l = line(a, upTo);
        if (l.amount !== 0) groups.set(a.group, [...(groups.get(a.group) ?? []), l]);
      }
      const list = [...groups.entries()].map(([name, rows]) => ({ name, rows, total: sumOf(rows) }));
      return { groups: list, total: list.reduce((s, g) => s + g.total, 0) };
    };
    const assets = section('Asset');
    const liabilities = section('Liability');
    const equity = section('Equity');
    const profitToDate =
      ACCOUNTS.filter(a => a.type === 'Revenue').reduce((s, a) => s + balanceOf(upTo, a.code), 0) -
      ACCOUNTS.filter(a => a.type === 'Expense').reduce((s, a) => s + balanceOf(upTo, a.code), 0);
    const equityTotal = equity.total + profitToDate;
    const balanceDiff = assets.total - (liabilities.total + equityTotal);

    // Cash flow
    const cashNetOf = (e: JournalEntry) => e.lines.filter(l => CASH_CODES.includes(l.account)).reduce((s, l) => s + l.debit - l.credit, 0);
    let opening = 0;
    const bySource = new Map<string, number>();
    for (const e of entries) {
      if (range.from && e.date < range.from) { opening += cashNetOf(e); continue; }
      if (range.to && e.date > range.to) continue;
      const n = cashNetOf(e);
      if (n !== 0) bySource.set(e.sourceType, (bySource.get(e.sourceType) ?? 0) + n);
    }
    const flows = [...bySource.entries()]
      .map(([source, amount]) => ({ code: source, name: SOURCE_LABELS[source] ?? source.replace(/_/g, ' '), amount }))
      .filter(r => r.amount !== 0);
    const inflows = flows.filter(r => r.amount > 0).sort((a, b) => b.amount - a.amount);
    const outflows = flows.filter(r => r.amount < 0).sort((a, b) => a.amount - b.amount);
    const netCash = sumOf(flows);
    const closing = opening + netCash;

    // Project profitability: costs from the ledger up to the end date; cash received from the Projects register
    const costsByProject: Record<string, number> = {};
    for (const e of entries) {
      if (range.to && e.date > range.to) continue;
      for (const l of e.lines) {
        if (isDirectCost(l.account) && l.projectId) costsByProject[l.projectId] = (costsByProject[l.projectId] ?? 0) + l.debit - l.credit;
      }
    }
    // Cash received per project = amount received before the system (Projects register)
    // + client payments recorded on its invoices up to the end date (same rule as the Projects page).
    const invoiceReceipts: Record<string, number> = {};
    for (const inv of invoices) {
      if (inv.voided || !inv.projectId) continue;
      for (const pay of inv.payments ?? []) {
        if (range.to && pay.date && pay.date > range.to) continue;
        invoiceReceipts[inv.projectId] = (invoiceReceipts[inv.projectId] ?? 0) + (Number(pay.amount) || 0);
      }
    }
    const projectRows = projects.map(p => {
      const contract = Number(p.contractValue) || 0;
      const received = (Number(p.totalReceived) || 0) + (invoiceReceipts[p.id] ?? 0);
      const costs = costsByProject[p.id] ?? 0;
      return { id: p.id, name: p.projectName, client: p.client, status: p.status, contract, received, costs, margin: received - costs };
    });

    // Receivables and payables by party (ledger balances as at the end date)
    const partyBalances = (code: string, creditNormal: boolean) => {
      const map = new Map<string, number>();
      for (const e of entries) {
        if (range.to && e.date > range.to) continue;
        for (const l of e.lines) {
          if (l.account !== code) continue;
          const key = l.party || 'Unspecified';
          map.set(key, (map.get(key) ?? 0) + (creditNormal ? l.credit - l.debit : l.debit - l.credit));
        }
      }
      return [...map.entries()].map(([party, amount]) => ({ code: party, name: party, amount })).filter(r => r.amount !== 0).sort((a, b) => b.amount - a.amount);
    };
    const clientBalances = partyBalances(ACC.receivables, false);
    const supplierBalances = partyBalances(ACC.payables, true);

    // Trial balance (as at the end date)
    const trialRows = ACCOUNTS.map(a => {
      const t = upTo.get(a.code);
      const net = t ? t.debit - t.credit : 0;
      return { code: a.code, name: a.name, type: a.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0, active: !!t && (t.debit !== 0 || t.credit !== 0) };
    }).filter(r => r.active);
    const trialDebit = trialRows.reduce((s, r) => s + r.debit, 0);
    const trialCredit = trialRows.reduce((s, r) => s + r.credit, 0);

    return {
      revenue, direct, opex, totalRevenue, totalDirect, totalOpex, grossProfit, netProfit,
      assets, liabilities, equity, profitToDate, equityTotal, balanceDiff,
      opening, inflows, outflows, netCash, closing,
      projectRows, clientBalances, supplierBalances,
      trialRows, trialDebit, trialCredit,
    };
  }, [entries, projects, invoices, range.from, range.to]);

  // Invoice ageing as at today, from the invoice register
  const ageing = useMemo(() => {
    const open = invoices
      .filter(i => !i.voided)
      .map(i => {
        const paid = (i.payments ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
        const balance = (Number(i.amount) || 0) - paid;
        const days = i.dueDate ? daysBetween(todayStr, i.dueDate) : 0;
        return { number: i.invoiceNumber, client: i.client, due: i.dueDate, balance, days };
      })
      .filter(i => i.balance > 0)
      .sort((a, b) => b.days - a.days);
    const buckets = [
      { label: 'Not yet due', test: (d: number) => d <= 0 },
      { label: '1–30 days overdue', test: (d: number) => d >= 1 && d <= 30 },
      { label: '31–60 days overdue', test: (d: number) => d >= 31 && d <= 60 },
      { label: '61–90 days overdue', test: (d: number) => d >= 61 && d <= 90 },
      { label: 'Over 90 days overdue', test: (d: number) => d > 90 },
    ].map(b => {
      const rows = open.filter(i => b.test(i.days));
      return { label: b.label, count: rows.length, amount: rows.reduce((s, i) => s + i.balance, 0) };
    });
    return { open, buckets, total: open.reduce((s, i) => s + i.balance, 0) };
  }, [invoices, todayStr]);

  const projectTotals = useMemo(() => {
    const rows = data.projectRows;
    return {
      contract: rows.reduce((s, r) => s + r.contract, 0),
      received: rows.reduce((s, r) => s + r.received, 0),
      costs: rows.reduce((s, r) => s + r.costs, 0),
      margin: rows.reduce((s, r) => s + r.margin, 0),
    };
  }, [data.projectRows]);

  const weekly = useMemo(() => (range.from && range.to && range.from <= range.to
    ? buildReport({ from: range.from, to: range.to, projects, costs, labour: labour.entries, activities: labour.activities, invoices, entries })
    : null), [range.from, range.to, projects, costs, labour, invoices, entries]);

  const downloadWeekly = async () => {
    if (!weekly) return;
    setPdfBusy(true);
    try {
      const { downloadWeeklyReportPdf } = await import('../lib/weeklyReportPdf');
      await downloadWeeklyReportPdf(weekly, range.from, range.to, preparedBy, priorities);
    } finally { setPdfBusy(false); }
  };

  const totalExpenses = data.totalDirect + data.totalOpex;
  const noEntries = entries.length === 0;
  const tabLabel = TABS.find(t => t.id === tab)?.label ?? '';
  const asAtTabs = tab === 'balance' || tab === 'trial' || tab === 'receivables';
  const subtitle = tab === 'weekly' && weekly ? weekly.periodLabel : asAtTabs ? `As at ${prettyDate(asAt)}` : tab === 'projects' ? `Costs to ${prettyDate(asAt)}` : periodLabel;

  const exportCSV = () => {
    let rows: CsvRow[] = [];
    const head: CsvRow[] = [['ISTA FORTIS Group Ltd'], [tabLabel], [subtitle], ['Amounts in RWF'], []];
    if (tab === 'income') {
      rows = [['Code', 'Account', 'Amount']];
      const block = (title: string, list: Line[], totalLabel: string, total: number) => {
        rows.push([title]);
        list.forEach(r => rows.push([r.code, r.name, r.amount]));
        rows.push(['', totalLabel, total]);
      };
      block('Revenue', data.revenue, 'Total revenue', data.totalRevenue);
      block('Direct costs', data.direct, 'Total direct costs', data.totalDirect);
      rows.push(['', 'Gross profit', data.grossProfit]);
      block('Operating expenses', data.opex, 'Total operating expenses', data.totalOpex);
      rows.push(['', 'Net profit', data.netProfit]);
    } else if (tab === 'balance') {
      rows = [['Code', 'Account', 'Amount']];
      const block = (title: string, groups: { name: string; rows: Line[]; total: number }[], total: number) => {
        rows.push([title]);
        groups.forEach(g => { rows.push([g.name]); g.rows.forEach(r => rows.push([r.code, r.name, r.amount])); });
        rows.push(['', `Total ${title.toLowerCase()}`, total]);
      };
      block('Assets', data.assets.groups, data.assets.total);
      block('Liabilities', data.liabilities.groups, data.liabilities.total);
      block('Equity', data.equity.groups, data.equity.total);
      rows.push(['', 'Net profit to date (not yet closed)', data.profitToDate]);
      rows.push(['', 'Total equity', data.equityTotal]);
      rows.push(['', 'Total liabilities and equity', data.liabilities.total + data.equityTotal]);
    } else if (tab === 'cashflow') {
      rows = [['Item', 'Amount'], ['Opening cash and bank', data.opening], ['Money in'],
        ...data.inflows.map((r): CsvRow => [r.name, r.amount]), ['Money out'],
        ...data.outflows.map((r): CsvRow => [r.name, r.amount]),
        ['Net cash movement', data.netCash], ['Closing cash and bank', data.closing]];
    } else if (tab === 'projects') {
      rows = [['Project ID', 'Project', 'Client', 'Status', 'Contract value', 'Cash received', 'Direct costs', 'Cash margin'],
        ...data.projectRows.map((r): CsvRow => [r.id, r.name, r.client, r.status, r.contract, r.received, r.costs, r.margin]),
        ['', 'Total', '', '', projectTotals.contract, projectTotals.received, projectTotals.costs, projectTotals.margin]];
    } else if (tab === 'receivables') {
      rows = [['Client balances (ledger)'], ['Client', 'Balance'], ...data.clientBalances.map((r): CsvRow => [r.name, r.amount]), [],
        ['Invoice ageing (today)'], ['Bucket', 'Invoices', 'Amount'], ...ageing.buckets.map((b): CsvRow => [b.label, b.count, b.amount]), [],
        ['Supplier balances (ledger)'], ['Supplier', 'Balance'], ...data.supplierBalances.map((r): CsvRow => [r.name, r.amount])];
    } else if (tab === 'weekly') {
      if (!weekly) return;
      rows = [['Summary'], [weekly.summary], [], ['Project ID', 'Project', 'Work', 'Cost'],
        ...weekly.projects.map((p): CsvRow => [p.id, p.name, p.work, p.cost]), ['', 'Total', '', weekly.total], [],
        ['Daily activities'], ['Date', 'Project', 'Activity', 'Description / notes', 'Cost'],
        ...weekly.days.flatMap(d => d.rows.map((r): CsvRow => [d.date, r.project, r.activity, r.description, r.amount])), [],
        ['Issues to follow up'], ...weekly.issues.map((i): CsvRow => [i])];
    } else {
      rows = [['Code', 'Account', 'Type', 'Debit', 'Credit'],
        ...data.trialRows.map((r): CsvRow => [r.code, r.name, r.type, r.debit, r.credit]),
        ['', 'Total', '', data.trialDebit, data.trialCredit]];
    }
    downloadCSV(`${tab}-${asAtTabs ? asAt : `${range.from || 'start'}_to_${range.to || 'today'}`}.csv`, [...head, ...rows]);
  };

  const Section = ({ title, rows, totalLabel, total }: { title: string; rows: Line[]; totalLabel: string; total: number }) => (
    <>
      <tr className="rep-section"><th colSpan={3}>{title}</th></tr>
      {rows.length === 0 && <tr className="rep-none"><td colSpan={3}>No activity in this period</td></tr>}
      {rows.map(r => <tr key={r.code}><td className="code">{r.code}</td><td>{r.name}</td><td className="num">{fmt(r.amount)}</td></tr>)}
      <tr className="rep-total"><td colSpan={2}>{totalLabel}</td><td className="num">{fmt(total)}</td></tr>
    </>
  );

  const BalanceSection = ({ title, groups, total }: { title: string; groups: { name: string; rows: Line[]; total: number }[]; total: number }) => (
    <>
      <tr className="rep-section"><th colSpan={3}>{title}</th></tr>
      {groups.length === 0 && <tr className="rep-none"><td colSpan={3}>Nothing recorded</td></tr>}
      {groups.map(g => (
        <FragmentGroup key={g.name} group={g} />
      ))}
      <tr className="rep-total"><td colSpan={2}>Total {title.toLowerCase()}</td><td className="num">{fmt(total)}</td></tr>
    </>
  );

  return (
    <section className="projects-module rep-page financial-reports-page">
      <style>{REPORTS_CSS}</style>
      <div className="rep-print-head print-only">
        <strong>ISTA FORTIS Group Ltd</strong>
        <span>{tabLabel} · {subtitle} · Amounts in RWF</span>
      </div>

      <div className="welcome-row no-print">
        <div>
          <div className="eyebrow">FINANCIAL MANAGEMENT</div>
          <h2>Financial Reports</h2>
          <p>Clear visibility into performance, position and cash flow. All amounts are in RWF.</p>
        </div>
        <div className="rep-actions">
          <button type="button" className="projects-secondary-button rep-btn" onClick={exportCSV}><Download size={15} /> Export CSV</button>
          <button type="button" className="primary-button" onClick={() => window.print()}><Printer size={16} /> Print report</button>
        </div>
      </div>

      <div className="panel rep-controls no-print">
        <label className="rep-field">Period
          <select value={preset} onChange={e => choosePreset(e.target.value as PresetId)}>
            {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="rep-field">From
          <input type="date" value={range.from} onChange={e => editDate('from', e.target.value)} disabled={asAtTabs || tab === 'projects'} />
        </label>
        <label className="rep-field">To
          <input type="date" value={range.to} onChange={e => editDate('to', e.target.value)} />
        </label>
        <p className="rep-hint">{tab === 'weekly' ? 'Pick a week, or choose any From and To dates.' : asAtTabs ? 'This report is as at the "To" date (today if empty).' : tab === 'projects' ? 'Costs are counted up to the "To" date.' : 'Shows activity between the two dates.'}</p>
      </div>
      {rangeInvalid && <p className="rep-warning no-print" role="alert"><AlertTriangle size={15} /> The start date is after the end date, so no figures can be shown.</p>}

      <div className="pj-kpis rep-kpis">
        <Metric title="Income" value={fmt(data.totalRevenue)} note="Revenue earned in the period" icon={<TrendingUp size={13} />} tone="green" />
        <Metric title="Expenses" value={fmt(totalExpenses)} note="Direct costs and operating expenses" icon={<TrendingDown size={13} />} tone="rose" />
        <Metric title="Net profit" value={fmt(data.netProfit)} note="Income minus expenses" icon={<Activity size={13} />} tone="blue" negative={data.netProfit < 0} />
        <Metric title="Net cash movement" value={fmt(data.netCash)} note="Cash, bank and mobile money" icon={<Wallet size={13} />} tone="amber" negative={data.netCash < 0} />
      </div>

      <div className="rep-tabs no-print" role="tablist" aria-label="Reports">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`rep-tab${tab === t.id ? ' active' : ''}`} onClick={() => openTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'weekly' && (
        <div className="panel rep-card" role="tabpanel">
          <div className="rep-card-head wr-head">
            <div><div className="eyebrow">REPORT VIEW</div><h3>{weekly ? (weekly.title === 'WEEKLY REPORT' ? 'Weekly report' : 'Activity report') : 'Weekly report'}</h3><p>{weekly ? `${weekly.periodLabel} | Prepared by ${preparedBy}` : 'Choose a From and a To date.'}</p></div>
            {weekly && <button type="button" className="primary-button no-print" onClick={downloadWeekly} disabled={pdfBusy}><FileDown size={16} /> {pdfBusy ? 'Preparing…' : 'Download PDF'}</button>}
          </div>
          {!weekly && <div className="rep-empty">Choose both a From and a To date to see the report.</div>}
          {weekly && (
            <>
              <h4 className="rep-subhead">1. Summary</h4>
              <p className="wr-summary">{weekly.summary}</p>
              {weekly.projects.length > 0 && (
                <div className="rep-scroll">
                  <table className="rep-table">
                    <thead><tr><th>Project</th><th>{weekly.periodWord === 'this week' ? 'Work this week' : 'Work in this period'}</th><th className="num">Cost</th></tr></thead>
                    <tbody>
                      {weekly.projects.map(p => <tr key={p.id}><td><strong>{p.name}</strong><span className="rep-sub">{p.id}</span></td><td>{p.work}</td><td className="num">{rwf(p.cost)}</td></tr>)}
                      <tr className="rep-grand final"><td colSpan={2}>Total</td><td className="num">{rwf(weekly.total)}</td></tr>
                    </tbody>
                  </table>
                </div>
              )}

              <h4 className="rep-subhead">2. Daily activities</h4>
              {weekly.days.length === 0 ? <div className="rep-empty">No site entries recorded.</div> : (
                <div className="rep-scroll">
                  <table className="rep-table rep-wide">
                    <thead><tr><th>Date</th><th>Project</th><th>Activity</th><th>Description / notes</th><th className="num">Cost</th></tr></thead>
                    <tbody>
                      {weekly.days.map(d => d.rows.length === 0
                        ? <tr key={d.date} className="wr-day rep-none"><td>{shortDay(d.date)}</td><td colSpan={4}>No site entries recorded</td></tr>
                        : d.rows.map((r, i) => (
                          <tr key={`${d.date}-${i}`} className="wr-day"><td>{i === 0 ? shortDay(d.date) : ''}</td><td>{r.project}</td><td>{r.activity}</td><td>{r.description}</td><td className="num">{rwf(r.amount)}</td></tr>
                        )))}
                      <tr className="rep-grand final"><td colSpan={4}>Total</td><td className="num">{rwf(weekly.total)}</td></tr>
                    </tbody>
                  </table>
                </div>
              )}

              <h4 className="rep-subhead">3. Issues to follow up</h4>
              {weekly.issues.length === 0 ? <p className="wr-summary">Nothing to follow up.</p> : (
                <ul className="wr-issues">{weekly.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
              )}

              <h4 className="rep-subhead">4. {weekly.periodWord === 'this week' ? 'Next week priorities' : 'Next priorities'}</h4>
              <label className="wr-priorities">One priority per line. These are added to the PDF.
                <textarea value={priorities} onChange={e => setPriorities(e.target.value)} placeholder={'Complete foundation works\nCollect payment from client'} />
              </label>
            </>
          )}
        </div>
      )}

      {tab !== 'weekly' && <div className="panel rep-card" role="tabpanel">
        <div className="rep-card-head">
          <div><div className="eyebrow">REPORT VIEW</div><h3>{tabLabel}</h3><p>{subtitle}</p></div>
        </div>

        {noEntries && tab !== 'projects' && (
          <div className="rep-empty">No ledger records yet.<br />Record a project cost, issue an invoice or pay a salary and this report will fill in.</div>
        )}

        {!(noEntries && tab !== 'projects') && tab === 'income' && (
          <table className="rep-table">
            <tbody>
              <Section title="Revenue" rows={data.revenue} totalLabel="Total revenue" total={data.totalRevenue} />
              <Section title="Direct costs" rows={data.direct} totalLabel="Total direct costs" total={data.totalDirect} />
              <tr className="rep-grand"><td colSpan={2}>Gross profit <em>({pct(data.grossProfit, data.totalRevenue)} margin)</em></td><td className="num">{fmt(data.grossProfit)}</td></tr>
              <Section title="Operating expenses" rows={data.opex} totalLabel="Total operating expenses" total={data.totalOpex} />
              <tr className="rep-grand final"><td colSpan={2}>Net profit before tax <em>({pct(data.netProfit, data.totalRevenue)} of revenue)</em></td><td className="num">{fmt(data.netProfit)}</td></tr>
            </tbody>
          </table>
        )}

        {!(noEntries && tab !== 'projects') && tab === 'balance' && (
          <>
            <table className="rep-table">
              <tbody>
                <BalanceSection title="Assets" groups={data.assets.groups} total={data.assets.total} />
                <BalanceSection title="Liabilities" groups={data.liabilities.groups} total={data.liabilities.total} />
                <BalanceSection title="Equity" groups={data.equity.groups} total={data.equity.total} />
                <tr><td className="code" /><td>Net profit to date (not yet closed)</td><td className="num">{fmt(data.profitToDate)}</td></tr>
                <tr className="rep-total"><td colSpan={2}>Total equity</td><td className="num">{fmt(data.equityTotal)}</td></tr>
                <tr className="rep-grand final"><td colSpan={2}>Total liabilities and equity</td><td className="num">{fmt(data.liabilities.total + data.equityTotal)}</td></tr>
              </tbody>
            </table>
            <p className={`rep-check ${data.balanceDiff === 0 ? 'ok' : 'bad'}`}>
              {data.balanceDiff === 0 ? <><CheckCircle2 size={15} /> The balance sheet balances: assets equal liabilities plus equity.</> : <><AlertTriangle size={15} /> Assets and liabilities plus equity differ by {fmt(data.balanceDiff)}. Please review the ledger.</>}
            </p>
            {data.assets.groups.some(g => g.rows.some(r => r.amount < 0)) && <p className="rep-note">A negative asset balance usually means opening balances for cash, bank or mobile money have not been recorded yet.</p>}
          </>
        )}

        {!(noEntries && tab !== 'projects') && tab === 'cashflow' && (
          <>
            <table className="rep-table">
              <tbody>
                <tr className="rep-grand"><td colSpan={2}>Opening cash and bank</td><td className="num">{fmt(data.opening)}</td></tr>
                <tr className="rep-section"><th colSpan={3}>Money in</th></tr>
                {data.inflows.length === 0 && <tr className="rep-none"><td colSpan={3}>No money received in this period</td></tr>}
                {data.inflows.map(r => <tr key={r.code}><td className="code" /><td>{r.name}</td><td className="num">{fmt(r.amount)}</td></tr>)}
                <tr className="rep-section"><th colSpan={3}>Money out</th></tr>
                {data.outflows.length === 0 && <tr className="rep-none"><td colSpan={3}>No money paid out in this period</td></tr>}
                {data.outflows.map(r => <tr key={r.code}><td className="code" /><td>{r.name}</td><td className="num">{fmt(r.amount)}</td></tr>)}
                <tr className="rep-total"><td colSpan={2}>Net cash movement</td><td className="num">{fmt(data.netCash)}</td></tr>
                <tr className="rep-grand final"><td colSpan={2}>Closing cash and bank</td><td className="num">{fmt(data.closing)}</td></tr>
              </tbody>
            </table>
            {data.closing < 0 && <p className="rep-note">Closing cash is negative because opening balances have not been recorded yet. Money received before this system started is not in the ledger.</p>}
          </>
        )}

        {tab === 'projects' && (
          data.projectRows.length === 0 ? (
            <div className="rep-empty">No projects registered yet.<br />Add or import projects to see profitability.</div>
          ) : (
            <>
              <div className="rep-scroll">
                <table className="rep-table rep-wide">
                  <thead><tr><th>Project</th><th className="num">Contract value</th><th className="num">Cash received</th><th className="num">Direct costs</th><th className="num">Cash margin</th><th className="num">Margin %</th></tr></thead>
                  <tbody>
                    {data.projectRows.map(r => (
                      <tr key={r.id} className={r.costs > r.received ? 'rep-flag' : ''}>
                        <td><strong>{r.name}</strong><div className="rep-sub">{r.id} · {r.client || 'No client'} · {r.status}</div></td>
                        <td className="num">{fmt(r.contract)}</td>
                        <td className="num">{fmt(r.received)}</td>
                        <td className="num">{fmt(r.costs)}</td>
                        <td className="num"><strong>{fmt(r.margin)}</strong></td>
                        <td className="num">{pct(r.margin, r.received)}</td>
                      </tr>
                    ))}
                    <tr className="rep-grand final">
                      <td>Total</td><td className="num">{fmt(projectTotals.contract)}</td><td className="num">{fmt(projectTotals.received)}</td>
                      <td className="num">{fmt(projectTotals.costs)}</td><td className="num">{fmt(projectTotals.margin)}</td><td className="num">{pct(projectTotals.margin, projectTotals.received)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="rep-note">Cash received is the amount received before this system (Projects register) plus client payments on invoices up to the end date. Direct costs come from the ledger, so they only include costs recorded in this system. Cash margin is cash received minus direct costs. Rows shaded red have recorded costs above the cash received.</p>
            </>
          )
        )}

        {!(noEntries && tab !== 'projects') && tab === 'receivables' && (
          <>
            <h4 className="rep-subhead">Client balances (ledger)</h4>
            <table className="rep-table">
              <tbody>
                {data.clientBalances.length === 0 && <tr className="rep-none"><td colSpan={2}>No client balances. Issued invoices appear here until they are paid.</td></tr>}
                {data.clientBalances.map(r => <tr key={r.code}><td>{r.name}</td><td className="num">{fmt(r.amount)}</td></tr>)}
                <tr className="rep-total"><td>Total receivable</td><td className="num">{fmt(sumOf(data.clientBalances))}</td></tr>
              </tbody>
            </table>

            <h4 className="rep-subhead">Invoice ageing (as at today)</h4>
            <table className="rep-table">
              <thead><tr><th>Bucket</th><th className="num">Invoices</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {ageing.buckets.map(b => <tr key={b.label}><td>{b.label}</td><td className="num">{b.count}</td><td className="num">{fmt(b.amount)}</td></tr>)}
                <tr className="rep-total"><td>Total open invoices</td><td className="num">{ageing.open.length}</td><td className="num">{fmt(ageing.total)}</td></tr>
              </tbody>
            </table>
            {ageing.open.length > 0 && (
              <div className="rep-scroll">
                <table className="rep-table rep-wide">
                  <thead><tr><th>Invoice</th><th>Client</th><th>Due date</th><th className="num">Days overdue</th><th className="num">Balance</th></tr></thead>
                  <tbody>{ageing.open.map(i => (
                    <tr key={`${i.number}-${i.client}`} className={i.days > 0 ? 'rep-flag' : ''}>
                      <td>{i.number}</td><td>{i.client}</td><td>{i.due ? prettyDate(i.due) : '—'}</td>
                      <td className="num">{i.days > 0 ? i.days : '—'}</td><td className="num">{fmt(i.balance)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}

            <h4 className="rep-subhead">Supplier balances (ledger)</h4>
            <table className="rep-table">
              <tbody>
                {data.supplierBalances.length === 0 && <tr className="rep-none"><td colSpan={2}>No unpaid supplier balances.</td></tr>}
                {data.supplierBalances.map(r => <tr key={r.code}><td>{r.name}</td><td className="num">{fmt(r.amount)}</td></tr>)}
                <tr className="rep-total"><td>Total payable</td><td className="num">{fmt(sumOf(data.supplierBalances))}</td></tr>
              </tbody>
            </table>
            <p className="rep-note">Client balances come from invoices and payments posted to the ledger as at the end date. Invoice ageing is worked out as at today from the invoice register.</p>
          </>
        )}

        {!(noEntries && tab !== 'projects') && tab === 'trial' && (
          <>
            <div className="rep-scroll">
              <table className="rep-table rep-wide">
                <thead><tr><th>Code</th><th>Account</th><th>Type</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
                <tbody>
                  {data.trialRows.map(r => (
                    <tr key={r.code}><td className="code">{r.code}</td><td>{r.name}</td><td>{r.type}</td><td className="num">{r.debit ? money(r.debit) : '—'}</td><td className="num">{r.credit ? money(r.credit) : '—'}</td></tr>
                  ))}
                  <tr className="rep-grand final"><td colSpan={3}>Total</td><td className="num">{money(data.trialDebit)}</td><td className="num">{money(data.trialCredit)}</td></tr>
                </tbody>
              </table>
            </div>
            <p className={`rep-check ${data.trialDebit === data.trialCredit ? 'ok' : 'bad'}`}>
              {data.trialDebit === data.trialCredit ? <><CheckCircle2 size={15} /> Debits equal credits.</> : <><AlertTriangle size={15} /> Debits and credits differ by {money(Math.abs(data.trialDebit - data.trialCredit))}.</>}
            </p>
          </>
        )}
      </div>}

      <p className="rep-source no-print">Reports are generated from the general ledger as it stands now. Corrections are made by reversing entries, so earlier figures are never overwritten.</p>
    </section>
  );
}

function FragmentGroup({ group }: { group: { name: string; rows: Line[]; total: number } }) {
  return (
    <>
      <tr className="rep-group"><td className="code" /><td colSpan={2}>{group.name}</td></tr>
      {group.rows.map(r => <tr key={r.code}><td className="code">{r.code}</td><td className="indent">{r.name}</td><td className="num">{fmt(r.amount)}</td></tr>)}
    </>
  );
}

function Metric({ title, value, note, icon, tone, negative = false }: { title: string; value: string; note: string; icon: ReactNode; tone: 'green' | 'blue' | 'amber' | 'rose'; negative?: boolean }) {
  return (
    <article className={`pj-kpi tone-${tone}${negative ? ' neg' : ''}`}>
      <div className="pj-kpi-top"><span className="pj-kpi-icon" aria-hidden="true">{icon}</span><span className="pj-kpi-label">{title}</span></div>
      <div className="pj-kpi-value">{value}</div>
      <div className="pj-kpi-note">{note}</div>
    </article>
  );
}
