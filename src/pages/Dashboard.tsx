import { useEffect, useMemo } from 'react';
import {
  Building2, Wallet, ReceiptText, CircleDollarSign, ArrowUpRight, ArrowDownRight, Plus,
  CalendarDays, FileText, AlertTriangle, Info, CheckCircle2, ChevronRight, Briefcase,
  TrendingUp, TrendingDown, Landmark, Banknote,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import { ACC, getAccount, isDirectCost } from '../lib/accounts';
import { syncStoredInvoices, syncStoredProjectCosts } from '../lib/postings';
import { useLedgerEntries } from '../lib/useLedger';
import { projectReceiptTotals } from '../lib/projectReceipts';
import type { JournalEntry } from '../lib/ledger';

const PROJECTS_KEY = 'ista-fortis-projects-v1';
const INVOICES_KEY = 'ista-fortis-invoices-v1';
const CASH_CODES: string[] = [ACC.cash, ACC.bank, ACC.mobileMoney];

type ProjectRow = {
  id: string; projectName: string; client: string; contractValue: number;
  totalReceived: number; status: string; currentPhase?: string;
};
type InvoiceRow = {
  invoiceNumber: string; client: string; amount: number; dueDate: string; projectId?: string;
  voided?: boolean; payments?: { amount: number }[];
};
type Tone = 'green' | 'blue' | 'amber' | 'rose' | 'slate';
type Alert = { key: string; level: 'warn' | 'info'; title: string; detail: string; page: string };
type TxRow = { key: string; title: string; detail: string; amount: string; type: 'in' | 'out' };

function readList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data as T[] : [];
  } catch { return []; }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const money = (n: number) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0);

/** Short labels for the chart axis only, e.g. 12.5M. Tooltips show the full amount. */
const axisLabel = (v: number | string): string => {
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number) => String(n).padStart(2, '0');
const prettyDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Number.isFinite(y) && m >= 1 && m <= 12 ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const nameList = (list: ProjectRow[]) =>
  list.slice(0, 2).map(p => p.projectName).join(', ') + (list.length > 2 ? ` and ${list.length - 2} more` : '');

/** Money in/out is read from the cash, bank and mobile money accounts, so it is right for every module and for reversals. */
function toTxRow(e: JournalEntry, projectNames: Map<string, string>): TxRow {
  const cashNet = e.lines.filter(l => CASH_CODES.includes(l.account)).reduce((s, l) => s + l.debit - l.credit, 0);
  const totalDebit = e.lines.reduce((s, l) => s + l.debit, 0);
  let type: 'in' | 'out';
  let amount: string;
  if (cashNet !== 0) {
    type = cashNet > 0 ? 'in' : 'out';
    amount = `${cashNet > 0 ? '+ ' : '- '}${money(Math.abs(cashNet))}`;
  } else {
    const revenueNet = e.lines.reduce((s, l) => (getAccount(l.account)?.type === 'Revenue' ? s + l.credit - l.debit : s), 0);
    type = revenueNet > 0 ? 'in' : 'out';
    amount = money(totalDebit); // no cash moved, e.g. an invoice issued or a cost not yet paid
  }
  const projectId = e.lines.find(l => l.projectId)?.projectId;
  const where = (projectId && projectNames.get(projectId)) || e.lines.find(l => l.party)?.party || e.sourceType.replace(/_/g, ' ');
  return { key: e.id, title: e.description, detail: `${where} · ${prettyDate(e.date)}${cashNet === 0 ? ' · no cash movement' : ''}`, amount, type };
}

/**
 * Phone and tablet fix, scoped to this page. With one column, the columns could grow as wide as the
 * longest line of text (a long transaction name), making the page wider than the screen. The phone
 * then zoomed out and everything looked small. minmax(0, 1fr) keeps every column within the screen.
 */
const DASH_CSS = `
@media(max-width:1150px){.dash-page .dash-layout{grid-template-columns:minmax(0,1fr)}}
@media(max-width:700px){.dash-page .dash-rail{grid-template-columns:minmax(0,1fr)}}
.dash-page .dash-rail>*{min-width:0}
`;

function Kpi({ label, value, note, icon: Icon, tone, progress, negative }: {
  label: string; value: string; note: string; icon: LucideIcon; tone: Tone; progress?: number; negative?: boolean;
}) {
  return (
    <article className={`dash-kpi tone-${tone}`}>
      <div className="dash-kpi-top">
        <span className="dash-kpi-icon" aria-hidden="true"><Icon size={13} /></span>
        <span className="dash-kpi-label">{label}</span>
      </div>
      <div className={`dash-kpi-value${negative ? ' negative' : ''}`}>{value}</div>
      {progress !== undefined && (
        <div className="dash-kpi-bar" role="img" aria-label={`${progress}% collected`}><i style={{ width: `${progress}%` }} /></div>
      )}
      <div className="dash-kpi-note">{note}</div>
    </article>
  );
}

function Dashboard({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const go = (page: string) => onNavigate?.(page);

  // Make sure costs and invoices recorded before the ledger existed are in the ledger.
  useEffect(() => { syncStoredProjectCosts(); syncStoredInvoices(); }, []);

  const entries = useLedgerEntries();
  const projects = useMemo(() => readList<ProjectRow>(PROJECTS_KEY), []);
  const invoices = useMemo(() => readList<InvoiceRow>(INVOICES_KEY), []);

  // Cash received per project = money received before this system (Projects register)
  // + client payments recorded on its invoices. Same rule as the Projects page.
  const invoiceReceipts = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const inv of invoices) {
      if (inv.voided || !inv.projectId) continue;
      totals[inv.projectId] = (totals[inv.projectId] ?? 0) + (inv.payments ?? []).reduce((s, p) => s + num(p.amount), 0);
    }
    return totals;
  }, [invoices]);
  // + client payments recorded on the Income page against a project.
  const directReceipts = useMemo(() => projectReceiptTotals(entries), [entries]);
  const receivedOf = (p: ProjectRow) => num(p.totalReceived) + (invoiceReceipts[p.id] ?? 0) + (directReceipts[p.id] ?? 0);

  // Portfolio figures come from the Projects register plus invoice payments.
  const counted = projects.filter(p => p.status !== 'Cancelled');
  const totalValue = counted.reduce((s, p) => s + num(p.contractValue), 0);
  const received = counted.reduce((s, p) => s + receivedOf(p), 0);
  const outstanding = counted.reduce((s, p) => s + Math.max(num(p.contractValue) - receivedOf(p), 0), 0);
  const activeAll = projects.filter(p => p.status === 'Active');
  const activeProjects = [...activeAll].sort((a, b) => num(b.contractValue) - num(a.contractValue)).slice(0, 5);
  const receivedPct = totalValue > 0 ? Math.min(Math.round((received / totalValue) * 100), 100) : 0;

  const now = new Date();
  const year = now.getFullYear();
  const todayStr = `${year}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const dateLabel = `${WEEKDAYS[now.getDay()]}, ${pad(now.getDate())} ${MONTH_NAMES[now.getMonth()]} ${year}`.toUpperCase();

  // Everything below is read from the ledger by account type.
  const summary = useMemo(() => {
    let revenue = 0, expenses = 0, cash = 0, receivables = 0, payables = 0;
    const inc: number[] = Array(12).fill(0);
    const exp: number[] = Array(12).fill(0);
    const costs: Record<string, number> = {};
    for (const e of entries) {
      const inYear = e.date.startsWith(`${year}-`);
      const mi = Number(e.date.slice(5, 7)) - 1;
      const monthOk = inYear && mi >= 0 && mi < 12;
      for (const l of e.lines) {
        const type = getAccount(l.account)?.type;
        if (type === 'Revenue') { const v = l.credit - l.debit; revenue += v; if (monthOk) inc[mi] += v; }
        else if (type === 'Expense') { const v = l.debit - l.credit; expenses += v; if (monthOk) exp[mi] += v; }
        if (CASH_CODES.includes(l.account)) cash += l.debit - l.credit;
        if (l.account === ACC.receivables) receivables += l.debit - l.credit;
        if (l.account === ACC.payables) payables += l.credit - l.debit;
        if (isDirectCost(l.account) && l.projectId) costs[l.projectId] = (costs[l.projectId] ?? 0) + l.debit - l.credit;
      }
    }
    return { revenue, expenses, cash, receivables, payables, inc, exp, costs };
  }, [entries, year]);

  const net = summary.revenue - summary.expenses;
  const incomeYear = summary.inc.reduce((s, v) => s + v, 0);
  const expensesYear = summary.exp.reduce((s, v) => s + v, 0);
  const netYear = incomeYear - expensesYear;

  const chartData = MONTHS.map((month, i) => ({ month, income: summary.inc[i], expenses: summary.exp[i] }));
  const hasChartData = summary.inc.some(v => v !== 0) || summary.exp.some(v => v !== 0);

  // Items that need a decision or follow-up, most urgent first.
  const alerts: Alert[] = [];
  const overdue = invoices
    .filter(i => !i.voided)
    .map(i => ({ i, balance: num(i.amount) - (i.payments ?? []).reduce((s, p) => s + num(p.amount), 0) }))
    .filter(x => x.balance > 0 && !!x.i.dueDate && x.i.dueDate < todayStr);
  if (overdue.length) {
    alerts.push({ key: 'overdue', level: 'warn', title: `${plural(overdue.length, 'overdue invoice')}`, detail: `${money(overdue.reduce((s, x) => s + x.balance, 0))} is past its due date`, page: 'Client Invoices' });
  }
  const noReceipts = activeAll.filter(p => num(p.contractValue) > 0 && receivedOf(p) === 0);
  if (noReceipts.length) {
    alerts.push({ key: 'noreceipts', level: 'warn', title: `${plural(noReceipts.length, 'active project')} with no payment received`, detail: nameList(noReceipts), page: 'Projects' });
  }
  const overspent = counted.filter(p => (summary.costs[p.id] ?? 0) > receivedOf(p));
  if (overspent.length) {
    alerts.push({ key: 'overspent', level: 'warn', title: `Recorded costs exceed cash received on ${plural(overspent.length, 'project')}`, detail: nameList(overspent), page: 'Project Costs' });
  }
  if (summary.payables > 0) {
    alerts.push({ key: 'payables', level: 'info', title: 'Supplier balances to pay', detail: `${money(summary.payables)} recorded but not yet paid`, page: 'Project Costs' });
  }
  if (summary.cash < 0) {
    alerts.push({ key: 'cash', level: 'info', title: 'Cash balance is negative', detail: 'Opening balances are not recorded yet', page: 'Cash & Bank' });
  }
  const shownAlerts = alerts.slice(0, 4);

  const projectNames = useMemo(() => new Map(projects.map(p => [p.id, p.projectName])), [projects]);
  const recent = useMemo(
    () => [...entries]
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5)
      .map(e => toTxRow(e, projectNames)),
    [entries, projectNames],
  );

  return (
    <div className="dash-page">
      <style>{DASH_CSS}</style>
      <header className="dash-header">
        <div>
          <div className="eyebrow">{dateLabel}</div>
          <h2>{greeting}</h2>
        </div>
        <div className="dash-header-actions">
          <span className="dash-period"><CalendarDays size={15} /> Financial year {year}</span>
          <button type="button" className="dash-btn-secondary" onClick={() => go('Client Invoices')}><FileText size={15} /> Create invoice</button>
          <button type="button" className="primary-button" onClick={() => go('Project Costs')}><Plus size={16} /> Record cost</button>
        </div>
      </header>

      <div className="dash-layout">
        <div className="dash-primary">
          <section aria-labelledby="dash-portfolio">
            <div className="dash-section-head"><h3 id="dash-portfolio">Portfolio</h3><span>Projects register and invoice payments</span></div>
            <div className="dash-kpis cols-4">
              <Kpi label="Total contract value" value={money(totalValue)} note={`${activeAll.length} active of ${plural(projects.length, 'project')}`} icon={Building2} tone="blue" />
              <Kpi label="Cash received" value={money(received)} note={`${receivedPct}% of contract value collected`} icon={Wallet} tone="green" progress={receivedPct} />
              <Kpi label="Outstanding receivables" value={money(outstanding)} note={totalValue > 0 ? `${100 - receivedPct}% of contract value still to collect` : 'No contracts registered yet'} icon={CircleDollarSign} tone="amber" />
              <Kpi label="Active projects" value={String(activeAll.length)} note={`${projects.length - activeAll.length} completed, on hold or cancelled`} icon={Briefcase} tone="slate" />
            </div>
          </section>

          <section aria-labelledby="dash-ledger">
            <div className="dash-section-head"><h3 id="dash-ledger">Cash &amp; accounts</h3><span>From the general ledger</span></div>
            <div className="dash-kpis cols-3">
              <Kpi label="Cash & bank" value={money(summary.cash)} note={summary.cash < 0 ? 'Opening balances not recorded yet' : 'Cash, bank and mobile money'} icon={Landmark} tone={summary.cash < 0 ? 'rose' : 'green'} negative={summary.cash < 0} />
              <Kpi label="Revenue to date" value={money(summary.revenue)} note="Invoices issued and other income" icon={TrendingUp} tone="green" />
              <Kpi label="Unpaid invoices" value={money(summary.receivables)} note="Invoiced, awaiting payment" icon={CircleDollarSign} tone="amber" />
              <Kpi label="Recorded expenses" value={money(summary.expenses)} note="Project costs, payroll and other" icon={TrendingDown} tone="blue" />
              <Kpi label="Supplier payables" value={money(summary.payables)} note="Costs recorded, not yet paid" icon={ReceiptText} tone="amber" />
              <Kpi label="Net result" value={money(net)} note="Revenue minus expenses to date" icon={Banknote} tone={net < 0 ? 'rose' : 'green'} negative={net < 0} />
            </div>
          </section>

          <section className="dash-chart-row">
            <div className="panel dash-chart-panel">
              <div className="panel-heading">
                <div><h3>Financial performance</h3><p>Income and expenses by month</p></div>
                <span className="dash-year-chip">{year}</span>
              </div>
              <div className="dash-legend">
                <span><i className="legend-dot income-dot" /> Income</span>
                <span><i className="legend-dot expense-dot" /> Expenses</span>
              </div>
              {hasChartData ? (
                <div className="chart-wrap dash-chart-wrap">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 6, bottom: 0 }} barGap={4} barCategoryGap="26%">
                      <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e9edef" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#89938d' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#89938d' }} tickFormatter={axisLabel} />
                      <Tooltip cursor={{ fill: '#f3f5f7' }} formatter={(value, name) => [money(Number(value)), String(name)]} contentStyle={{ border: '1px solid #e8ece8', borderRadius: 12, fontSize: 12 }} />
                      <Bar dataKey="income" name="Income" fill="#6fd6a0" radius={[6, 6, 6, 6]} maxBarSize={16} />
                      <Bar dataKey="expenses" name="Expenses" fill="#b3a6f2" radius={[6, 6, 6, 6]} maxBarSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="dash-empty">No income or expenses recorded for {year} yet.<br />Issue an invoice or record a cost and it will appear here.</div>
              )}
            </div>

            <div className="dash-analysis">
              <div className="dash-analysis-head"><h3>More analysis</h3><p>Year to date, {year}</p></div>
              <div className="dash-analysis-row"><span><i className="legend-dot income-dot" /> Income {year}</span><strong>{money(incomeYear)}</strong></div>
              <div className="dash-analysis-row"><span><i className="legend-dot expense-dot" /> Expenses {year}</span><strong>{money(expensesYear)}</strong></div>
              <div className="dash-analysis-row"><span>Net {year}</span><strong className={netYear < 0 ? 'negative' : ''}>{money(netYear)}</strong></div>
            </div>
          </section>

          <div className="panel dash-table-panel">
            <div className="panel-heading">
              <div><h3>Active projects</h3><p>Largest contracts and cash collected</p></div>
              <button type="button" className="text-button" onClick={() => go('Projects')}>View all <ArrowUpRight size={14} /></button>
            </div>
            {activeProjects.length === 0 ? (
              <div className="dash-empty">No active projects yet.<br /><button type="button" className="text-button" style={{ margin: '10px auto 0' }} onClick={() => go('Projects')}>Add or import projects <ArrowUpRight size={14} /></button></div>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead><tr><th>Project</th><th>Client</th><th>Cash collected</th><th className="num">Contract value</th><th className="num">Outstanding</th></tr></thead>
                  <tbody>
                    {activeProjects.map(p => {
                      const contract = num(p.contractValue);
                      const pct = contract > 0 ? Math.min(Math.round((receivedOf(p) / contract) * 100), 100) : 0;
                      const left = Math.max(contract - receivedOf(p), 0);
                      return (
                        <tr key={p.id} onClick={() => go('Projects')}>
                          <td>
                            <div className="dash-proj-cell">
                              <span className="dash-proj-icon"><Building2 size={16} /></span>
                              <button type="button" className="dash-proj-btn" onClick={e => { e.stopPropagation(); go('Projects'); }}>
                                <strong>{p.projectName}</strong>
                                {p.currentPhase && <small>{p.currentPhase}</small>}
                              </button>
                            </div>
                          </td>
                          <td>{p.client || '—'}</td>
                          <td><div className="dash-collect"><span className="dash-track"><i style={{ width: `${pct}%` }} /></span><strong>{pct}%</strong></div></td>
                          <td className="num"><strong>{money(contract)}</strong></td>
                          <td className="num">{money(left)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <aside className="dash-rail" aria-label="Shortcuts and activity">
          <div className="dash-qa-card">
            <h3>Quick actions</h3>
            <div className="dash-qa-list">
              <button type="button" className="dash-qa" onClick={() => go('Client Invoices')}><span className="dash-qa-icon"><Plus size={16} /></span><span className="dash-qa-text"><strong>Record income</strong><small>Add a client payment</small></span><ArrowUpRight size={16} /></button>
              <button type="button" className="dash-qa" onClick={() => go('Project Costs')}><span className="dash-qa-icon"><ReceiptText size={16} /></span><span className="dash-qa-text"><strong>Record expense</strong><small>Capture a business cost</small></span><ArrowUpRight size={16} /></button>
              <button type="button" className="dash-qa" onClick={() => go('Projects')}><span className="dash-qa-icon"><Building2 size={16} /></span><span className="dash-qa-text"><strong>Add project</strong><small>Register a new contract</small></span><ArrowUpRight size={16} /></button>
              <button type="button" className="dash-qa" onClick={() => go('Financial Reports')}><span className="dash-qa-icon"><FileText size={16} /></span><span className="dash-qa-text"><strong>View reports</strong><small>Review financial reports</small></span><ArrowUpRight size={16} /></button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-heading"><div><h3>Needs attention</h3></div></div>
            {shownAlerts.length === 0 ? (
              <div className="dash-attn-ok"><CheckCircle2 size={18} /> All clear. Nothing needs attention right now.</div>
            ) : (
              <ul className="dash-attn-list">
                {shownAlerts.map(a => (
                  <li key={a.key}>
                    <button type="button" className={`dash-attn ${a.level}`} onClick={() => go(a.page)}>
                      <span className="dash-attn-icon" aria-hidden="true">{a.level === 'warn' ? <AlertTriangle size={16} /> : <Info size={16} />}</span>
                      <span className="dash-attn-text"><strong>{a.title}</strong><small>{a.detail}</small></span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel">
            <div className="panel-heading">
              <div><h3>Recent transactions</h3></div>
              <button type="button" className="text-button" onClick={() => go('Transactions')}>See all <ArrowUpRight size={14} /></button>
            </div>
            {recent.length === 0 ? (
              <div className="dash-empty">No transactions yet.<br />Issue an invoice or record a cost to see activity here.</div>
            ) : (
              <div className="transaction-list">
                {recent.map(t => (
                  <div className="transaction-row" key={t.key}>
                    <div className={`transaction-icon ${t.type}`}>{t.type === 'in' ? <ArrowDownRight size={17} /> : <ArrowUpRight size={17} />}</div>
                    <div className="transaction-info"><strong>{t.title}</strong><span>{t.detail}</span></div>
                    <div className={`transaction-amount ${t.type}`}>{t.amount}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

    </div>
  );
}
export default Dashboard;
