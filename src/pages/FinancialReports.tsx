import { useEffect, useMemo, useState } from 'react';
import { Download, Printer, CheckCircle2, AlertTriangle, TrendingUp, TrendingDown, Wallet, Activity } from 'lucide-react';
import { ACC, ACCOUNTS, getAccount, isDebitNormal, isDirectCost } from '../lib/accounts';
import type { Account, AccountType } from '../lib/accounts';
import { syncStoredProjectCosts } from '../lib/postings';
import { useLedgerEntries } from '../lib/useLedger';
import type { JournalEntry } from '../lib/ledger';

const PROJECTS_KEY = 'ista-fortis-projects-v1';
const INVOICES_KEY = 'ista-fortis-invoices-v1';
const CASH_CODES: string[] = [ACC.cash, ACC.bank, ACC.mobileMoney];

type TabId = 'income' | 'balance' | 'cashflow' | 'projects' | 'receivables' | 'trial';
type PresetId = 'month' | 'lastMonth' | 'quarter' | 'year' | 'lastYear' | 'all' | 'custom';
type CsvRow = (string | number)[];
type Line = { code: string; name: string; amount: number };
type Totals = Map<string, { debit: number; credit: number }>;
type ProjectRow = { id: string; projectName: string; client: string; contractValue: number; totalReceived: number; status: string };
type InvoiceRow = { invoiceNumber: string; client: string; amount: number; dueDate: string; voided?: boolean; payments?: { amount: number }[] };

const TABS: { id: TabId; label: string }[] = [
  { id: 'income', label: 'Income statement' },
  { id: 'balance', label: 'Balance sheet' },
  { id: 'cashflow', label: 'Cash flow' },
  { id: 'projects', label: 'Project profitability' },
  { id: 'receivables', label: 'Receivables & payables' },
  { id: 'trial', label: 'Trial balance' },
];

const PRESETS: { id: PresetId; label: string }[] = [
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
  switch (preset) {
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

export default function FinancialReports() {
  // Make sure project costs saved before the ledger existed are in the ledger.
  useEffect(() => { syncStoredProjectCosts(); }, []);

  const entries = useLedgerEntries();
  const projects = useMemo(() => readList<ProjectRow>(PROJECTS_KEY), []);
  const invoices = useMemo(() => readList<InvoiceRow>(INVOICES_KEY), []);

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
    const projectRows = projects.map(p => {
      const contract = Number(p.contractValue) || 0;
      const received = Number(p.totalReceived) || 0;
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
  }, [entries, projects, range.from, range.to]);

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

  const totalExpenses = data.totalDirect + data.totalOpex;
  const noEntries = entries.length === 0;
  const tabLabel = TABS.find(t => t.id === tab)?.label ?? '';
  const asAtTabs = tab === 'balance' || tab === 'trial' || tab === 'receivables';
  const subtitle = asAtTabs ? `As at ${prettyDate(asAt)}` : tab === 'projects' ? `Costs to ${prettyDate(asAt)}` : periodLabel;

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
    <section className="rep-page financial-reports-page">
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
          <button type="button" className="rep-btn" onClick={exportCSV}><Download size={15} /> Export CSV</button>
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
        <p className="rep-hint">{asAtTabs ? 'This report is as at the "To" date (today if empty).' : tab === 'projects' ? 'Costs are counted up to the "To" date.' : 'Shows activity between the two dates.'}</p>
      </div>
      {rangeInvalid && <p className="rep-warning no-print" role="alert"><AlertTriangle size={15} /> The start date is after the end date, so no figures can be shown.</p>}

      <div className="metrics-grid rep-kpis">
        <div className="metric-card rep-kpi">
          <div className="metric-top"><span>Income</span><span className="metric-icon green"><TrendingUp size={17} /></span></div>
          <div className="metric-value">{fmt(data.totalRevenue)}</div>
          <div className="metric-note"><span>Invoices issued in the period</span></div>
        </div>
        <div className="metric-card rep-kpi">
          <div className="metric-top"><span>Expenses</span><span className="metric-icon rose"><TrendingDown size={17} /></span></div>
          <div className="metric-value">{fmt(totalExpenses)}</div>
          <div className="metric-note"><span>Direct costs and operating expenses</span></div>
        </div>
        <div className={`metric-card rep-kpi ${data.netProfit < 0 ? 'neg' : ''}`}>
          <div className="metric-top"><span>Net profit</span><span className="metric-icon blue"><Activity size={17} /></span></div>
          <div className="metric-value">{fmt(data.netProfit)}</div>
          <div className="metric-note"><span>Income minus expenses</span></div>
        </div>
        <div className={`metric-card rep-kpi ${data.netCash < 0 ? 'neg' : ''}`}>
          <div className="metric-top"><span>Net cash movement</span><span className="metric-icon amber"><Wallet size={17} /></span></div>
          <div className="metric-value">{fmt(data.netCash)}</div>
          <div className="metric-note"><span>Cash, bank and mobile money</span></div>
        </div>
      </div>

      <div className="rep-tabs no-print" role="tablist" aria-label="Reports">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`rep-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      <div className="panel rep-card" role="tabpanel">
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
              <p className="rep-note">Cash received comes from the Projects register. Direct costs come from the ledger, so they only include costs recorded in this system. Cash margin is cash received minus direct costs. Rows shaded red have recorded costs above the cash received.</p>
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
            <p className="rep-note">Client balances and ageing include only invoices issued through Client Invoices. Open that page once so your invoices are posted to the ledger.</p>
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
      </div>

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