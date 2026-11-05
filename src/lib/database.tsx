import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Database, Eye, HardDrive, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { supabase } from './supabase';
import { useAccess } from './access';

/*
 * Company records live in Supabase tables, one row per record.
 * The pages keep reading and writing the browser's storage exactly as before. This file
 *   1. fills the browser's storage from the tables before the app opens, and
 *   2. for an Admin, notices each record a page adds, changes or deletes and saves that row.
 * Viewers only read; the database refuses their changes anyway.
 * Sections are added to TABLES one at a time; the rest stay in the browser until moved.
 */

type Row = Record<string, unknown>;

type TableSpec = {
  table: string; // table in Supabase
  key: string; // browser storage key the pages use
  label: string; // shown in Settings
  /** App record → table row. Null for a record that cannot be saved (no id). */
  toRow: (item: unknown) => Row | null;
  /** Table row → app record, with the same fields the pages expect. */
  fromRow: (row: Row) => unknown;
  /** When the stored value is not a plain list: the records for this table inside it. */
  pick?: (stored: unknown) => unknown[];
  /** …and how to put them back. Tables sharing a key are loaded, moved and shown together. */
  put?: (stored: unknown, items: unknown[]) => unknown;
};

/* ---------- field helpers ---------- */

const isObj = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const whole = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; };
const isoDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const PROJECT_STATUSES = ['Active', 'Completed', 'On hold', 'Cancelled'];
const COST_CATEGORIES = ['Labour', 'Materials', 'Equipment', 'Transport', 'Site expenses', 'Other'];
const amount = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
/** A date and time the database accepts, or null. */
const stamp = (v: unknown) => (typeof v === 'string' && v && !Number.isNaN(Date.parse(v)) ? v : null);
/** Database date and time → the same ISO text the app writes (2026-11-05T07:00:00.000Z). */
const isoStamp = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : '');

/* ---------- the sections kept in the database ---------- */

export const TABLES: TableSpec[] = [
  {
    table: 'projects',
    key: 'ista-fortis-projects-v1',
    label: 'Projects',
    toRow: (p) => {
      if (!isObj(p) || typeof p.id !== 'string' || !p.id) return null;
      return {
        id: p.id,
        project_name: text(p.projectName),
        location: text(p.location),
        client: text(p.client),
        contract_value: whole(p.contractValue),
        total_received: whole(p.totalReceived),
        start_date: isoDate(p.startDate),
        expected_completion: isoDate(p.expectedCompletion),
        status: PROJECT_STATUSES.includes(text(p.status)) ? text(p.status) : 'Active',
        current_phase: text(p.currentPhase),
        notes: text(p.notes),
      };
    },
    fromRow: (r) => ({
      id: text(r.id),
      projectName: text(r.project_name),
      location: text(r.location),
      client: text(r.client),
      contractValue: whole(r.contract_value),
      totalReceived: whole(r.total_received),
      startDate: text(r.start_date),
      expectedCompletion: text(r.expected_completion),
      status: text(r.status) || 'Active',
      currentPhase: text(r.current_phase),
      notes: text(r.notes),
    }),
  },
  {
    table: 'project_costs',
    key: 'ista-fortis-project-costs-v1',
    label: 'Project costs',
    toRow: (c) => {
      if (!isObj(c) || typeof c.id !== 'string' || !c.id) return null;
      return {
        id: c.id,
        project_id: text(c.projectId),
        project_name: text(c.projectName),
        cost_date: isoDate(c.date),
        category: COST_CATEGORIES.includes(text(c.category)) ? text(c.category) : 'Other',
        labour_type: text(c.labourType),
        description: text(c.description),
        supplier: text(c.supplier),
        amount: amount(c.amount),
        amount_paid: amount(c.amountPaid),
        payment_method: text(c.paymentMethod) || 'Bank transfer',
        reference: text(c.reference),
        notes: text(c.notes),
        reversed: c.reversed === true,
        reversed_at: stamp(c.reversedAt),
        recorded_at: stamp(c.createdAt) ?? new Date().toISOString(),
      };
    },
    fromRow: (r) => ({
      id: text(r.id),
      projectId: text(r.project_id),
      projectName: text(r.project_name),
      date: text(r.cost_date),
      category: text(r.category) || 'Other',
      labourType: text(r.labour_type),
      description: text(r.description),
      supplier: text(r.supplier),
      amount: amount(r.amount),
      amountPaid: amount(r.amount_paid),
      paymentMethod: text(r.payment_method),
      reference: text(r.reference),
      notes: text(r.notes),
      reversed: r.reversed === true,
      ...(r.reversed_at ? { reversedAt: isoStamp(r.reversed_at) } : {}),
      createdAt: isoStamp(r.recorded_at),
    }),
  },
  {
    // Site labour: one row per worker per day.
    table: 'site_labour',
    key: 'ista-fortis-site-labour-v1',
    label: 'Site labour worker-days',
    pick: (stored) => (isObj(stored) && Array.isArray(stored.entries) ? stored.entries : []),
    put: (stored, items) => ({ entries: items, activities: isObj(stored) && isObj(stored.activities) ? stored.activities : {} }),
    toRow: (e) => {
      if (!isObj(e) || typeof e.id !== 'string' || !e.id) return null;
      const paid = isObj(e.paid) ? e.paid : null;
      return {
        id: e.id,
        project_id: text(e.projectId),
        work_date: isoDate(e.date),
        worker: text(e.worker),
        category: text(e.category),
        rate: amount(e.rate),
        paid_payment_id: paid ? text(paid.paymentId) || null : null,
        paid_method: paid ? text(paid.method) || null : null,
        paid_date: paid ? isoDate(paid.date) : null,
        recorded_at: stamp(e.createdAt) ?? new Date().toISOString(),
      };
    },
    fromRow: (r) => ({
      id: text(r.id),
      projectId: text(r.project_id),
      date: text(r.work_date),
      worker: text(r.worker),
      category: text(r.category),
      rate: amount(r.rate),
      ...(r.paid_payment_id ? { paid: { paymentId: text(r.paid_payment_id), method: text(r.paid_method), date: text(r.paid_date) } } : {}),
      createdAt: isoStamp(r.recorded_at),
    }),
  },
  {
    // Site labour: what was done on site each day, per project (the day's activity note).
    table: 'site_labour_activities',
    key: 'ista-fortis-site-labour-v1',
    label: 'Site labour activities',
    pick: (stored) => (isObj(stored) && isObj(stored.activities)
      ? Object.entries(stored.activities).map(([id, activity]) => ({ id, activity: text(activity) }))
      : []),
    put: (stored, items) => ({
      entries: isObj(stored) && Array.isArray(stored.entries) ? stored.entries : [],
      activities: Object.fromEntries(items.filter(isObj).map((i) => [text(i.id), text(i.activity)])),
    }),
    toRow: (a) => {
      if (!isObj(a) || typeof a.id !== 'string' || !a.id) return null;
      const cut = a.id.lastIndexOf('|'); // id is "<project id>|<date>"
      return { id: a.id, project_id: a.id.slice(0, cut), work_date: isoDate(a.id.slice(cut + 1)), activity: text(a.activity) };
    },
    fromRow: (r) => ({ id: text(r.id), activity: text(r.activity) }),
  },
  {
    // Client invoices: one row per invoice. Its payments are in the next table.
    table: 'client_invoices',
    key: 'ista-fortis-invoices-v1',
    label: 'Client invoices',
    toRow: (i) => {
      if (!isObj(i) || typeof i.id !== 'string' || !i.id) return null;
      return {
        id: i.id,
        invoice_number: text(i.invoiceNumber),
        project_id: text(i.projectId),
        project_name: text(i.projectName),
        client: text(i.client),
        description: text(i.description),
        issue_date: isoDate(i.issueDate),
        due_date: isoDate(i.dueDate),
        amount: amount(i.amount),
        notes: text(i.notes),
        voided: i.voided === true,
        recorded_at: stamp(i.createdAt) ?? new Date().toISOString(),
      };
    },
    fromRow: (r) => ({
      id: text(r.id),
      invoiceNumber: text(r.invoice_number),
      projectId: text(r.project_id),
      projectName: text(r.project_name),
      client: text(r.client),
      description: text(r.description),
      issueDate: text(r.issue_date),
      dueDate: text(r.due_date),
      amount: amount(r.amount),
      payments: [],
      notes: text(r.notes),
      voided: r.voided === true,
      createdAt: isoStamp(r.recorded_at),
    }),
    // The page lists the newest invoice first.
    put: (_stored, items) => [...items].sort((a, b) => text(isObj(b) ? b.createdAt : '').localeCompare(text(isObj(a) ? a.createdAt : ''))),
  },
  {
    // Client invoice payments: one row per payment received against an invoice.
    table: 'client_invoice_payments',
    key: 'ista-fortis-invoices-v1',
    label: 'Client invoice payments',
    pick: (stored) => (Array.isArray(stored) ? stored : []).filter(isObj).flatMap((inv) =>
      (Array.isArray(inv.payments) ? inv.payments : []).filter(isObj).map((p) => ({ id: `${text(inv.id)}:${text(p.id)}`, invoiceId: text(inv.id), payment: p }))),
    put: (stored, items) => {
      const byInvoice = new Map<string, unknown[]>();
      items.filter(isObj).forEach((i) => byInvoice.set(text(i.invoiceId), [...(byInvoice.get(text(i.invoiceId)) ?? []), i.payment]));
      return (Array.isArray(stored) ? stored : []).map((inv) => (isObj(inv) ? { ...inv, payments: byInvoice.get(text(inv.id)) ?? [] } : inv));
    },
    toRow: (i) => {
      if (!isObj(i) || !isObj(i.payment) || typeof i.id !== 'string') return null;
      const p = i.payment;
      return {
        id: i.id,
        invoice_id: text(i.invoiceId),
        payment_id: text(p.id),
        amount: amount(p.amount),
        payment_date: isoDate(p.date),
        method: text(p.method),
        reference: text(p.reference),
        notes: text(p.notes),
      };
    },
    fromRow: (r) => ({
      id: text(r.id),
      invoiceId: text(r.invoice_id),
      payment: { id: text(r.payment_id), amount: amount(r.amount), date: text(r.payment_date), method: text(r.method), reference: text(r.reference), notes: text(r.notes) },
    }),
  },
  {
    // Operating expenses: one row per expense. Its payments are in the next table.
    table: 'expenses',
    key: 'ista-fortis-expenses-v1',
    label: 'Expenses',
    toRow: (e) => {
      if (!isObj(e) || typeof e.id !== 'string' || !e.id) return null;
      return {
        id: e.id,
        expense_number: text(e.expenseNumber),
        expense_date: isoDate(e.date),
        category: text(e.category),
        description: text(e.description),
        supplier: text(e.supplier),
        amount: amount(e.amount),
        amount_paid: amount(e.amountPaid),
        payment_method: text(e.paymentMethod),
        reference: text(e.reference),
        notes: text(e.notes),
        recorded_at: stamp(e.createdAt) ?? new Date().toISOString(),
      };
    },
    fromRow: (r) => ({
      id: text(r.id),
      expenseNumber: text(r.expense_number),
      date: text(r.expense_date),
      category: text(r.category),
      description: text(r.description),
      supplier: text(r.supplier),
      amount: amount(r.amount),
      amountPaid: amount(r.amount_paid),
      paymentMethod: text(r.payment_method),
      reference: text(r.reference),
      notes: text(r.notes),
      payments: [],
      createdAt: isoStamp(r.recorded_at),
    }),
    // The page lists the newest expense first.
    put: (_stored, items) => [...items].sort((a, b) => text(isObj(b) ? b.createdAt : '').localeCompare(text(isObj(a) ? a.createdAt : ''))),
  },
  {
    // Expense payments: one row per payment made against an expense, kept in the order they were made.
    table: 'expense_payments',
    key: 'ista-fortis-expenses-v1',
    label: 'Expense payments',
    pick: (stored) => (Array.isArray(stored) ? stored : []).filter(isObj).flatMap((exp) =>
      (Array.isArray(exp.payments) ? exp.payments : []).filter(isObj).map((p, position) => ({ id: `${text(exp.id)}:${text(p.id)}`, expenseId: text(exp.id), position, payment: p }))),
    put: (stored, items) => {
      const byExpense = new Map<string, Row[]>();
      items.filter(isObj).forEach((i) => byExpense.set(text(i.expenseId), [...(byExpense.get(text(i.expenseId)) ?? []), i]));
      return (Array.isArray(stored) ? stored : []).map((exp) => {
        if (!isObj(exp)) return exp;
        const list = [...(byExpense.get(text(exp.id)) ?? [])].sort((a, b) => whole(a.position) - whole(b.position));
        return { ...exp, payments: list.map((i) => i.payment) };
      });
    },
    toRow: (i) => {
      if (!isObj(i) || !isObj(i.payment) || typeof i.id !== 'string') return null;
      const p = i.payment;
      return {
        id: i.id,
        expense_id: text(i.expenseId),
        payment_id: text(p.id),
        position: whole(i.position),
        amount: amount(p.amount),
        payment_date: isoDate(p.date),
        method: text(p.method),
        reference: text(p.reference),
        notes: text(p.notes),
      };
    },
    fromRow: (r) => ({
      id: text(r.id),
      expenseId: text(r.expense_id),
      position: whole(r.position),
      payment: { id: text(r.payment_id), amount: amount(r.amount), date: text(r.payment_date), method: text(r.method), reference: text(r.reference), notes: text(r.notes) },
    }),
  },  {
    // Staff: one row per person. Salary history is kept as a list in one column.
    table: 'staff',
    key: 'ista-fortis-staff-v1',
    label: 'Staff',
    toRow: (st) => {
      if (!isObj(st) || typeof st.id !== 'string' || !st.id) return null;
      const history = Array.isArray(st.salaryHistory) ? st.salaryHistory.filter(isObj).map((c) => ({ from: text(c.from), amount: amount(c.amount) })) : [];
      return {
        id: st.id,
        name: text(st.name),
        position: text(st.position),
        start_month: text(st.startMonth),
        end_month: text(st.endMonth),
        salary_history: history,
        recorded_at: stamp(st.createdAt) ?? new Date().toISOString(),
      };
    },
    fromRow: (r) => ({
      id: text(r.id),
      name: text(r.name),
      position: text(r.position),
      startMonth: text(r.start_month),
      endMonth: text(r.end_month),
      salaryHistory: Array.isArray(r.salary_history) ? r.salary_history.filter(isObj).map((c) => ({ from: text(c.from), amount: amount(c.amount) })) : [],
      createdAt: isoStamp(r.recorded_at),
    }),
  },
  {
    // Salary payments: one row per staff member per paid month.
    table: 'payroll_payments',
    key: 'ista-fortis-payroll-payments-v1',
    label: 'Salary payments',
    toRow: (p) => {
      if (!isObj(p) || typeof p.id !== 'string' || !p.id) return null;
      return {
        id: p.id,
        staff_id: text(p.staffId),
        pay_year: whole(p.year),
        pay_month: whole(p.month),
        amount: amount(p.amount),
        method: p.method == null ? null : text(p.method),
        paid_at: stamp(p.paidAt) ?? new Date().toISOString(),
      };
    },
    fromRow: (r) => ({
      id: text(r.id),
      staffId: text(r.staff_id),
      year: whole(r.pay_year),
      month: whole(r.pay_month),
      amount: amount(r.amount),
      ...(r.method == null ? {} : { method: text(r.method) }),
      paidAt: isoStamp(r.paid_at),
    }),
  },  {
    // The ledger: one row per journal entry. Posted entries are never changed; mistakes are reversed.
    table: 'journal_entries',
    key: 'ista-fortis-ledger-v1',
    label: 'Ledger entries',
    toRow: (e) => {
      if (!isObj(e) || typeof e.id !== 'string' || !e.id) return null;
      return {
        id: e.id,
        entry_date: isoDate(e.date),
        description: text(e.description),
        source_type: text(e.sourceType),
        source_id: text(e.sourceId),
        idempotency_key: e.idempotencyKey ? text(e.idempotencyKey) : null,
        reference: e.reference ? text(e.reference) : null,
        reversal_of: e.reversalOf ? text(e.reversalOf) : null,
        posted_at: stamp(e.createdAt) ?? new Date().toISOString(),
        posted_by: text(e.createdBy),
      };
    },
    fromRow: (r) => ({
      id: text(r.id),
      date: text(r.entry_date),
      description: text(r.description),
      sourceType: text(r.source_type),
      sourceId: text(r.source_id),
      ...(r.idempotency_key ? { idempotencyKey: text(r.idempotency_key) } : {}),
      ...(r.reference ? { reference: text(r.reference) } : {}),
      ...(r.reversal_of ? { reversalOf: text(r.reversal_of) } : {}),
      lines: [],
      createdAt: isoStamp(r.posted_at),
      createdBy: text(r.posted_by),
    }),
    // Entries stay in the order they were posted (JE-000001, JE-000002, …).
    put: (_stored, items) => [...items].sort((a, b) => text(isObj(a) ? a.id : '').localeCompare(text(isObj(b) ? b.id : ''))),
  },
  {
    // The ledger: one row per debit or credit line of a journal entry, in their original order.
    table: 'journal_lines',
    key: 'ista-fortis-ledger-v1',
    label: 'Ledger lines',
    pick: (stored) => (Array.isArray(stored) ? stored : []).filter(isObj).flatMap((entry) =>
      (Array.isArray(entry.lines) ? entry.lines : []).filter(isObj).map((line, position) => ({ id: `${text(entry.id)}:${position}`, entryId: text(entry.id), position, line }))),
    put: (stored, items) => {
      const byEntry = new Map<string, Row[]>();
      items.filter(isObj).forEach((i) => byEntry.set(text(i.entryId), [...(byEntry.get(text(i.entryId)) ?? []), i]));
      return (Array.isArray(stored) ? stored : []).map((entry) => {
        if (!isObj(entry)) return entry;
        const list = [...(byEntry.get(text(entry.id)) ?? [])].sort((a, b) => whole(a.position) - whole(b.position));
        return { ...entry, lines: list.map((i) => i.line) };
      });
    },
    toRow: (i) => {
      if (!isObj(i) || !isObj(i.line) || typeof i.id !== 'string') return null;
      const l = i.line;
      return {
        id: i.id,
        entry_id: text(i.entryId),
        line_no: whole(i.position),
        account: text(l.account),
        debit: amount(l.debit),
        credit: amount(l.credit),
        project_id: l.projectId ? text(l.projectId) : null,
        party: l.party ? text(l.party) : null,
        memo: l.memo ? text(l.memo) : null,
      };
    },
    fromRow: (r) => ({
      id: text(r.id),
      entryId: text(r.entry_id),
      position: whole(r.line_no),
      line: {
        account: text(r.account),
        debit: amount(r.debit),
        credit: amount(r.credit),
        ...(r.project_id ? { projectId: text(r.project_id) } : {}),
        ...(r.party ? { party: text(r.party) } : {}),
        ...(r.memo ? { memo: text(r.memo) } : {}),
      },
    }),
  },
];

const byKey = new Map<string, TableSpec[]>();
TABLES.forEach((t) => byKey.set(t.key, [...(byKey.get(t.key) ?? []), t]));
const byTable = new Map(TABLES.map((t) => [t.table, t]));

/* ---------- browser storage helpers ---------- */

const QUEUE_KEY = 'fms-db-queue'; // records changed here and not yet saved
const SAVE_DELAY = 1000;
const RETRY_DELAY = 8000;
const CHECK_EVERY = 60000;
const PAGE = 1000;

type Pending = { table: string; id: string };

function readJSON<T>(key: string, fallback: T): T {
  try { const raw = window.localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function parseStored(raw: string | null): unknown {
  try { return raw ? (JSON.parse(raw) as unknown) : null; } catch { return null; }
}
/** The records for one table in a stored value. */
function itemsOf(spec: TableSpec, raw: string | null): unknown[] {
  const v = parseStored(raw);
  if (spec.pick) return spec.pick(v);
  return Array.isArray(v) ? v : [];
}
const readQueue = () => readJSON<Pending[]>(QUEUE_KEY, []);
const writeQueue = (q: Pending[]) => { try { window.localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* storage full */ } };
const idOf = (item: unknown) => (isObj(item) && typeof item.id === 'string' ? item.id : '');

/** id → record text, for spotting which records changed. */
function index(list: unknown[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const item of list) { const id = idOf(item); if (id) m.set(id, JSON.stringify(item)); }
  return m;
}

/* ---------- status shared with the top bar and Settings ---------- */

export type SaveState = 'saved' | 'saving' | 'retrying' | 'readonly';
type Status = { save: SaveState; message: string; newer: boolean };
let status: Status = { save: 'saved', message: '', newer: false };
const statusListeners = new Set<() => void>();
function setStatus(next: Partial<Status>) { status = { ...status, ...next }; statusListeners.forEach((fn) => fn()); }
const subscribeStatus = (fn: () => void) => { statusListeners.add(fn); return () => { statusListeners.delete(fn); }; };
const useStatus = () => useSyncExternalStore(subscribeStatus, () => status);

function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('failed to fetch') || m.includes('network')) return 'No internet connection.';
  if (m.includes('does not exist') || m.includes('could not find the table')) return 'A database table is missing. Run the latest Supabase script.';
  if (m.includes('row-level security')) return 'Only an Admin can change records.';
  return message;
}

/* ---------- reading the tables ---------- */

async function fetchAll(table: string): Promise<Row[]> {
  if (!supabase) return [];
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*')
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** A short fingerprint of a table (row count and latest change), to notice newer data. */
async function fingerprint(table: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, count, error } = await supabase.from(table).select('updated_at', { count: 'exact' })
    .order('updated_at', { ascending: false }).limit(1);
  if (error) return null;
  const latest = (data ?? []) as { updated_at?: string }[];
  return `${count ?? 0}|${latest[0]?.updated_at ?? ''}`;
}

/* ---------- saving an Admin's changes ---------- */

let applying = false; // true while this file itself writes to storage
let syncing = false; // true for an Admin once the data is loaded
const live = new Set<string>(); // tables whose records are kept in sync
const seen = new Map<string, string>(); // table → fingerprint last seen
let flushTimer: number | undefined;
let flushing = false;

function enqueue(items: Pending[]) {
  if (!items.length) return;
  const q = readQueue();
  const has = new Set(q.map((p) => `${p.table}\u0000${p.id}`));
  for (const p of items) if (!has.has(`${p.table}\u0000${p.id}`)) { q.push(p); has.add(`${p.table}\u0000${p.id}`); }
  writeQueue(q);
  setStatus({ save: 'saving', message: '' });
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => { void flush(); }, SAVE_DELAY);
}

async function flush(): Promise<void> {
  if (!supabase || flushing) return;
  flushing = true;
  try {
    for (;;) {
      const batch = readQueue();
      if (!batch.length) break;
      // Taken off the queue before saving; anything changed meanwhile is queued again.
      writeQueue([]);
      try {
        for (const table of new Set(batch.map((p) => p.table))) {
          const spec = byTable.get(table);
          if (!spec) continue;
          const ids = new Set(batch.filter((p) => p.table === table).map((p) => p.id));
          const current = new Map(itemsOf(spec, window.localStorage.getItem(spec.key)).map((item) => [idOf(item), item]));
          const rows: Row[] = [];
          const gone: string[] = [];
          ids.forEach((id) => {
            const item = current.get(id);
            if (item === undefined) { gone.push(id); return; }
            const row = spec.toRow(item);
            if (row) rows.push(row);
          });
          for (let i = 0; i < rows.length; i += 500) {
            const { error } = await supabase.from(table).upsert(rows.slice(i, i + 500), { onConflict: 'id' });
            if (error) throw new Error(error.message);
          }
          if (gone.length) {
            const { error } = await supabase.from(table).delete().in('id', gone);
            if (error) throw new Error(error.message);
          }
          const fp = await fingerprint(table);
          if (fp) seen.set(table, fp);
        }
      } catch (e) {
        // Put the batch back in front of anything queued meanwhile, and try again shortly.
        writeQueue([...batch, ...readQueue()]);
        const message = e instanceof Error ? friendly(e.message) : 'Unknown error.';
        setStatus({ save: 'retrying', message: `Not saved to the database yet: ${message} Retrying…` });
        window.clearTimeout(flushTimer);
        flushTimer = window.setTimeout(() => { void flush(); }, RETRY_DELAY);
        return;
      }
    }
    setStatus({ save: 'saved', message: '' });
  } finally {
    flushing = false;
  }
}

/** Save waiting changes now (used before reloading). True when nothing is left to save. */
export async function saveNow(): Promise<boolean> {
  window.clearTimeout(flushTimer);
  if (syncing) await flush();
  return readQueue().length === 0;
}

/** Notice what each page writes to storage, without changing the pages. */
let watching = false;
function watchStorage() {
  if (watching) return;
  watching = true;
  const proto = Storage.prototype;
  const setItem = proto.setItem;
  const removeItem = proto.removeItem;
  const track = (store: Storage, key: string, before: string | null, after: string | null) => {
    if (applying || !syncing || store !== window.localStorage || before === after) return;
    const changed: Pending[] = [];
    for (const spec of byKey.get(key) ?? []) {
      if (!live.has(spec.table)) continue;
      const was = index(itemsOf(spec, before));
      const now = index(itemsOf(spec, after));
      now.forEach((json, id) => { if (was.get(id) !== json) changed.push({ table: spec.table, id }); });
      was.forEach((_json, id) => { if (!now.has(id)) changed.push({ table: spec.table, id }); });
    }
    enqueue(changed);
  };
  proto.setItem = function (this: Storage, key: string, value: string) {
    const before = byKey.has(key) ? this.getItem(key) : null;
    setItem.call(this, key, value);
    if (byKey.has(key)) track(this, key, before, value);
  };
  proto.removeItem = function (this: Storage, key: string) {
    const before = byKey.has(key) ? this.getItem(key) : null;
    removeItem.call(this, key);
    if (byKey.has(key)) track(this, key, before, null);
  };
}

/* ---------- the gate around the app ---------- */

export type SectionState = { table: string; label: string; inDatabase: boolean; onThisComputer: number };
type Db = { ready: boolean; sections: SectionState[]; moveToDatabase: (table: string) => Promise<string | null> };
const DbContext = createContext<Db>({ ready: false, sections: [], moveToDatabase: async () => null });
export const useDatabase = () => useContext(DbContext);

/**
 * Loads the records from the database before showing the app.
 * Sits inside AccessProvider, so it knows whether this person is an Admin.
 */
export function DatabaseGate({ children }: { children: ReactNode }) {
  const access = useAccess();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [sections, setSections] = useState<SectionState[]>([]);

  useEffect(() => {
    if (access.loading) return;
    let alive = true;
    (async () => {
      setReady(false); setError('');
      syncing = false;
      live.clear();
      if (!supabase) { setReady(true); return; }
      try {
        // An Admin's unsaved changes from last time are saved before anything is loaded.
        if (access.isAdmin && readQueue().length) {
          syncing = true;
          TABLES.forEach((t) => live.add(t.table));
          await flush();
          syncing = false;
          live.clear();
          if (readQueue().length) throw new Error('Some changes made on this computer are not saved to the database yet. Check the internet connection and try again.');
        }
        const states: SectionState[] = [];
        for (const [key, specs] of byKey) {
          const main = specs[0];
          const raw = window.localStorage.getItem(key);
          const loaded = await Promise.all(specs.map((spec) => fetchAll(spec.table)));
          const localCount = itemsOf(main, raw).length;
          if (access.isAdmin && !loaded[0].length && localCount) {
            // Not moved yet: keep using this computer's records until the Admin moves them.
            states.push({ table: main.table, label: main.label, inDatabase: false, onThisComputer: localCount });
            continue;
          }
          let stored: unknown = parseStored(raw);
          specs.forEach((spec, i) => {
            const items = loaded[i].map(spec.fromRow);
            stored = spec.put ? spec.put(stored, items) : items;
          });
          applying = true;
          try { window.localStorage.setItem(key, JSON.stringify(stored)); } finally { applying = false; }
          for (const spec of specs) {
            live.add(spec.table);
            const fp = await fingerprint(spec.table);
            if (fp) seen.set(spec.table, fp);
          }
          states.push({ table: main.table, label: main.label, inDatabase: true, onThisComputer: loaded[0].length });
        }
        if (!alive) return;
        watchStorage();
        syncing = access.isAdmin;
        setStatus({ save: access.isAdmin ? 'saved' : 'readonly', message: '', newer: false });
        setSections(states);
        setReady(true);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? friendly(e.message) : 'The records could not be loaded.');
      }
    })();
    return () => { alive = false; };
  }, [access.loading, access.isAdmin, attempt]);

  // Warn before closing the tab while changes are still being saved.
  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (syncing && readQueue().length) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  // When the app comes back into view, check whether someone saved newer records.
  useEffect(() => {
    if (!ready) return;
    let last = Date.now();
    const check = async () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < CHECK_EVERY || readQueue().length) return;
      last = Date.now();
      for (const table of live) {
        const fp = await fingerprint(table);
        if (fp && seen.get(table) !== fp) { setStatus({ newer: true }); return; }
      }
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); };
  }, [ready]);

  /** One-time move of this computer's records into an empty table. Returns an error message, or null (and reloads). */
  const moveToDatabase = useCallback(async (table: string): Promise<string | null> => {
    const main = byTable.get(table);
    if (!supabase || !main) return 'The database is not set up.';
    const client = supabase;
    const specs = byKey.get(main.key) ?? [main]; // tables sharing one storage key move together
    const { count, error: countError } = await client.from(main.table).select('id', { count: 'exact', head: true });
    if (countError) return friendly(countError.message);
    if ((count ?? 0) > 0) return `${main.label} are already in the database. Reload the page to use them.`;
    const raw = window.localStorage.getItem(main.key);
    if (!itemsOf(main, raw).length) return 'There is nothing on this computer to move.';
    // The main records go last, so an interrupted move simply shows the move button again.
    for (const spec of [...specs.slice(1), main]) {
      const rows = itemsOf(spec, raw).map(spec.toRow).filter((r): r is Row => r !== null);
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await client.from(spec.table).upsert(rows.slice(i, i + 500), { onConflict: 'id' });
        if (error) return friendly(error.message);
      }
    }
    window.location.reload();
    return null;
  }, []);

  if (error) {
    return (
      <div className="auth-gate">
        <div className="auth-gate-card" role="alert">
          <h1>Couldn't load the records</h1>
          <p>{error}</p>
          <button type="button" style={btn} onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      </div>
    );
  }
  if (!ready) return <div className="auth-gate" aria-busy="true" aria-label="Loading records"><div className="auth-spinner" /></div>;
  return <DbContext.Provider value={{ ready, sections, moveToDatabase }}>{children}</DbContext.Provider>;
}

const btn = { height: 40, padding: '0 16px', border: 0, borderRadius: 12, background: '#d5f56b', color: '#1d2b12', font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' } as const;

/* ---------- status shown in the top bar ---------- */

const STATUS_CSS = `
.db-pill{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 11px;border-radius:999px;font-size:12.5px;font-weight:600;white-space:nowrap;border:1px solid transparent;background:none;font-family:inherit}
.db-pill.ok{background:#e7f6ee;color:#1f6b46}
.db-pill.busy{background:#eef3f0;color:#3b4a42}
.db-pill.warn{background:#fdf0dc;color:#8a5516;border-color:#f3d9b0}
.db-pill.view{background:#e6effc;color:#2f5a9c}
.db-pill.local{background:#f1f5f3;color:#5f6e66}
button.db-pill{cursor:pointer}
button.db-pill:hover{filter:brightness(.97)}
.db-spin{animation:db-spin 1s linear infinite}
@keyframes db-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.db-spin{animation:none}}
@media(max-width:760px){.db-pill .db-text{display:none}.db-pill{width:32px;padding:0;justify-content:center}}
`;

export function DatabaseStatus() {
  const { sections } = useDatabase();
  const s = useStatus();
  const notMoved = sections.filter((x) => !x.inDatabase);

  let pill: ReactNode;
  if (s.newer) {
    pill = <button type="button" className="db-pill warn" title="Newer records were saved. Reload to see them." onClick={() => window.location.reload()}><RefreshCw size={15} /><span className="db-text">New data · Reload</span></button>;
  } else if (s.save === 'retrying') {
    pill = <span className="db-pill warn" title={s.message} role="status"><TriangleAlert size={15} /><span className="db-text">Not saved yet</span></span>;
  } else if (s.save === 'saving') {
    pill = <span className="db-pill busy" role="status"><Loader2 size={15} className="db-spin" /><span className="db-text">Saving…</span></span>;
  } else if (s.save === 'readonly') {
    pill = <span className="db-pill view" title="You can view the records but not change them."><Eye size={15} /><span className="db-text">View only</span></span>;
  } else if (notMoved.length) {
    pill = <span className="db-pill local" title={`${notMoved.map((x) => x.label).join(', ')}: still only on this computer. Move them from Settings.`}><HardDrive size={15} /><span className="db-text">Not in database yet</span></span>;
  } else {
    pill = <span className="db-pill ok" title="All changes are saved to the database."><Database size={15} /><span className="db-text">Saved</span></span>;
  }
  return <><style>{STATUS_CSS}</style>{pill}</>;
}
