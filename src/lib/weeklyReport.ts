/**
 * Builds the weekly (or any period) site report from the records already in the system:
 * project costs, site labour, client invoices and the ledger. Nothing here is saved.
 */
import { isDirectCost } from './accounts';
import type { JournalEntry } from './ledger';
import { projectReceiptList } from './projectReceipts';
import { owedByPerson } from './payrollAccruals';

export type WRProject = { id: string; projectName: string; client?: string; contractValue: number; totalReceived: number; status: string };
export type WRCost = {
  id: string; projectId: string; projectName: string; date: string; category: string; activity?: string; description: string;
  supplier: string; amount: number; amountPaid: number; notes?: string; reversed?: boolean; momoFee?: number;
};
export type WRLabour = { id: string; projectId: string; date: string; worker: string; category: string; rate: number; paid?: unknown };
export type WRInvoice = {
  invoiceNumber: string; client: string; amount: number; dueDate: string; projectId?: string; voided?: boolean;
  payments?: { amount: number; date?: string }[];
};
export type WRInput = {
  from: string; to: string;
  projects: WRProject[]; costs: WRCost[]; labour: WRLabour[]; activities: Record<string, string>;
  invoices: WRInvoice[]; entries: readonly JournalEntry[];
};

export type WRRow = { date: string; projectId: string; project: string; activity: string; description: string; amount: number };
export type WReport = {
  title: string;
  periodLabel: string;
  periodWord: string;
  summary: string;
  projects: { id: string; name: string; work: string; cost: number }[];
  total: number;
  days: { date: string; rows: WRRow[] }[];
  issues: string[];
  clientReceipts: number;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const pad = (n: number) => String(n).padStart(2, '0');
const parse = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const rwf = (n: number) => `RWF ${Math.round(n).toLocaleString('en-US')}`;
const count = (n: number) => (n <= 10 ? WORDS[n] : String(n));
/** "Wed 07 Oct" */
export const shortDay = (date: string) => { const d = parse(date); return `${WEEKDAYS[d.getDay()].slice(0, 3)} ${pad(d.getDate())} ${MONTHS[d.getMonth()].slice(0, 3)}`; };

/** "Monday 05 – Saturday 10 October 2026", or with both months / years when they differ. */
export function periodLabelOf(from: string, to: string): string {
  const a = parse(from); const b = parse(to);
  const day = (d: Date) => `${WEEKDAYS[d.getDay()]} ${pad(d.getDate())}`;
  if (from === to) return `${day(a)} ${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  if (a.getFullYear() !== b.getFullYear()) return `${day(a)} ${MONTHS[a.getMonth()]} ${a.getFullYear()} – ${day(b)} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
  if (a.getMonth() !== b.getMonth()) return `${day(a)} ${MONTHS[a.getMonth()]} – ${day(b)} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
  return `${day(a)} – ${day(b)} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
}

const daysBetween = (from: string, to: string) => Math.round((parse(to).getTime() - parse(from).getTime()) / 86400000) + 1;

export function buildReport(input: WRInput): WReport {
  const { from, to } = input;
  const span = daysBetween(from, to);
  const periodWord = span <= 7 ? 'this week' : 'in this period';
  const inRange = (d: string) => d >= from && d <= to;
  const nameOf = new Map(input.projects.map((p) => [p.id, p.projectName]));
  const projectName = (id: string, fallback = '') => nameOf.get(id) || fallback || id;

  /* ---------- daily rows ---------- */
  const rows: WRRow[] = [];
  input.costs.filter((c) => !c.reversed && inRange(c.date)).forEach((c) => {
    rows.push({
      date: c.date, projectId: c.projectId, project: projectName(c.projectId, c.projectName),
      activity: c.activity?.trim() || c.category,
      description: [c.description, c.notes?.trim()].filter(Boolean).join(' - '),
      amount: Math.round(c.amount + (c.momoFee ?? 0)),
    });
  });
  // Site labour: one row per day, project and labour type.
  const labourGroups = new Map<string, { date: string; projectId: string; category: string; workers: number; amount: number }>();
  input.labour.filter((e) => inRange(e.date)).forEach((e) => {
    const key = `${e.date}|${e.projectId}|${e.category}`;
    const g = labourGroups.get(key) ?? { date: e.date, projectId: e.projectId, category: e.category, workers: 0, amount: 0 };
    g.workers += 1; g.amount += Number(e.rate) || 0;
    labourGroups.set(key, g);
  });
  labourGroups.forEach((g) => {
    rows.push({
      date: g.date, projectId: g.projectId, project: projectName(g.projectId),
      activity: input.activities[`${g.projectId}|${g.date}`]?.trim() || 'Site labour',
      description: `${g.category}${g.workers > 1 ? ` (${g.workers} workers)` : ''}`,
      amount: Math.round(g.amount),
    });
  });
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.project.localeCompare(b.project));

  // Every date of short periods is listed, so days without entries show too.
  const dates: string[] = [];
  if (span <= 31) for (let d = parse(from); iso(d) <= to; d.setDate(d.getDate() + 1)) dates.push(iso(d));
  else dates.push(...new Set(rows.map((r) => r.date)));
  const days = dates.map((date) => ({ date, rows: rows.filter((r) => r.date === date) }));

  /* ---------- summary by project ---------- */
  const byProject = new Map<string, { id: string; name: string; works: string[]; cost: number }>();
  rows.forEach((r) => {
    const p = byProject.get(r.projectId) ?? { id: r.projectId, name: r.project, works: [], cost: 0 };
    p.cost += r.amount;
    const work = r.activity;
    if (work && !p.works.some((w) => w.toLowerCase() === work.toLowerCase())) p.works.push(work);
    byProject.set(r.projectId, p);
  });
  const projects = [...byProject.values()]
    .map((p) => ({ id: p.id, name: p.name, work: p.works.join(', '), cost: p.cost }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const total = projects.reduce((s, p) => s + p.cost, 0);

  // Client payments received in the period.
  const direct = projectReceiptList(input.entries);
  const clientOf = new Map(input.projects.map((p) => [p.id, p.client ?? '']));
  const receipts = [
    ...input.invoices.filter((i) => !i.voided).flatMap((i) => (i.payments ?? []).filter((p) => p.date && inRange(p.date)).map((p) => ({ client: i.client, amount: Number(p.amount) || 0 }))),
    // Client payments recorded on the Income page against a project.
    ...direct.filter((r) => inRange(r.date)).map((r) => ({ client: r.party || clientOf.get(r.projectId) || projectName(r.projectId), amount: r.amount })),
  ];
  const clientReceipts = receipts.reduce((s, r) => s + r.amount, 0);

  const sentences: string[] = [];
  if (!projects.length) sentences.push(`No site costs were recorded ${periodWord}.`);
  else {
    sentences.push(`Site costs recorded ${periodWord} total ${rwf(total)} across ${count(projects.length)} active site${projects.length === 1 ? '' : 's'}.`);
    if (projects.length > 1) {
      const top = [...projects].sort((a, b) => b.cost - a.cost)[0];
      sentences.push(`${top.name} accounted for ${top.cost > total / 2 ? 'most' : 'the largest share'} of the spend (${rwf(top.cost)})${top.work ? `, driven by ${top.work.toLowerCase()}` : ''}.`);
    }
  }
  if (clientReceipts > 0) {
    const clients = [...new Set(receipts.map((r) => r.client))];
    sentences.push(`Client payments of ${rwf(clientReceipts)} were received ${periodWord} (${clients.slice(0, 3).join(', ')}${clients.length > 3 ? ' and others' : ''}).`);
  } else sentences.push(`No client payments were recorded ${periodWord}.`);

  /* ---------- issues to follow up (as at the end date) ---------- */
  const issues: string[] = [];
  // Unpaid balances on project costs, by supplier or worker.
  const owed = input.costs
    .filter((c) => !c.reversed && c.date <= to && c.amount - c.amountPaid > 0)
    .map((c) => ({ who: c.supplier?.trim() || c.description, where: projectName(c.projectId, c.projectName), what: c.activity?.trim() || c.category, amount: c.amount - c.amountPaid }))
    .sort((a, b) => b.amount - a.amount);
  if (owed.length) {
    const list = owed.slice(0, 5).map((o) => `${o.who} ${rwf(o.amount)} (${o.where} ${o.what.toLowerCase()})`).join(', ');
    issues.push(`Unpaid balances: ${list}${owed.length > 5 ? `, and ${owed.length - 5} more` : ''}.`);
  }
  // Site labour not yet paid.
  const labourOwed = new Map<string, { days: number; amount: number }>();
  input.labour.filter((e) => !e.paid && e.date <= to).forEach((e) => {
    const x = labourOwed.get(e.projectId) ?? { days: 0, amount: 0 };
    x.days += 1; x.amount += Number(e.rate) || 0;
    labourOwed.set(e.projectId, x);
  });
  labourOwed.forEach((x, id) => issues.push(`Site labour awaiting payment on ${projectName(id)}: ${rwf(x.amount)} (${x.days} worker-day${x.days === 1 ? '' : 's'}).`));
  // Salaries owed (Accrued Wages) as at the end date.
  const salariesOwed = owedByPerson(input.entries, to);
  if (salariesOwed.length) {
    const list = salariesOwed.slice(0, 5).map((o) => `${o.name} ${rwf(o.amount)}`).join(', ');
    issues.push(`Salaries owed: ${list}${salariesOwed.length > 5 ? `, and ${salariesOwed.length - 5} more` : ''} (total ${rwf(salariesOwed.reduce((s, o) => s + o.amount, 0))}).`);
  }
  // Costs above cash received, and active projects with no payment yet.
  const directCosts: Record<string, number> = {};
  input.entries.filter((e) => e.date <= to).forEach((e) => e.lines.forEach((l) => {
    if (isDirectCost(l.account) && l.projectId) directCosts[l.projectId] = (directCosts[l.projectId] ?? 0) + l.debit - l.credit;
  }));
  const invoicePaid: Record<string, number> = {};
  input.invoices.filter((i) => !i.voided && i.projectId).forEach((i) => (i.payments ?? []).forEach((p) => {
    if (!p.date || p.date <= to) invoicePaid[i.projectId as string] = (invoicePaid[i.projectId as string] ?? 0) + (Number(p.amount) || 0);
  }));
  direct.filter((r) => r.date <= to).forEach((r) => { invoicePaid[r.projectId] = (invoicePaid[r.projectId] ?? 0) + r.amount; });
  input.projects.filter((p) => p.status !== 'Cancelled').forEach((p) => {
    const received = (Number(p.totalReceived) || 0) + (invoicePaid[p.id] ?? 0);
    const costs = directCosts[p.id] ?? 0;
    if (received > 0 && costs > received) issues.push(`${p.projectName} costs (${rwf(costs)}) now exceed cash received (${rwf(received)}).`);
    if (p.status === 'Active' && received === 0 && p.contractValue > 0) issues.push(`${p.projectName}: no payment recorded yet (${rwf(p.contractValue)} outstanding).`);
  });
  // Overdue invoices.
  input.invoices.filter((i) => !i.voided && i.dueDate && i.dueDate < to).forEach((i) => {
    const balance = i.amount - (i.payments ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    if (balance > 0) issues.push(`Invoice ${i.invoiceNumber} (${i.client}) is overdue: ${rwf(balance)} still to collect.`);
  });

  return {
    title: span <= 7 ? 'WEEKLY REPORT' : 'ACTIVITY REPORT',
    periodLabel: periodLabelOf(from, to),
    periodWord,
    summary: sentences.join(' '),
    projects, total, days, issues, clientReceipts,
  };
}
