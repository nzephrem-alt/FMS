import { ACCOUNTS, getAccount, isDebitNormal, isDirectCost } from './accounts';
import type { AccountType } from './accounts';
import { createAuditLog } from './audit';
import { sum, toRWF } from './money';
import { STORAGE_KEYS, localStorageAdapter, readJSON, writeJSON } from './storage';
import type { StorageAdapter } from './storage';

export type SourceType =
  | 'project_cost'
  | 'cost_payment'
  | 'client_invoice'
  | 'client_payment'
  | 'expense'
  | 'payroll'
  | 'fixed_asset'
  | 'manual'
  | 'opening_balance';

export type JournalLineInput = {
  account: string;
  debit?: number;
  credit?: number;
  projectId?: string;
  party?: string; // supplier or client name, used for payable / receivable balances
  memo?: string;
};

export type JournalLine = {
  account: string;
  debit: number;
  credit: number;
  projectId?: string;
  party?: string;
  memo?: string;
};

export type JournalEntry = {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  sourceType: SourceType;
  sourceId: string;
  idempotencyKey?: string;
  reference?: string;
  lines: JournalLine[];
  reversalOf?: string;
  createdAt: string;
  createdBy: string;
};

export type NewEntry = {
  date: string;
  description: string;
  sourceType: SourceType;
  sourceId: string;
  idempotencyKey?: string;
  reference?: string;
  lines: JournalLineInput[];
  reversalOf?: string;
};

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/**
 * Checks a YYYY-MM-DD string is a real calendar date.
 * Everything is compared in UTC so the result does not depend on the
 * computer's timezone (the old local-midnight + toISOString() version
 * rejected every date in timezones ahead of UTC, such as Rwanda).
 */
const isValidDate = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(y, mo - 1, day));
  return d.getUTCFullYear() === y && d.getUTCMonth() === mo - 1 && d.getUTCDate() === day;
};

const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const signed = (type: AccountType, debit: number, credit: number): number =>
  isDebitNormal(type) ? debit - credit : credit - debit;

function validateLines(lines: JournalLineInput[]): JournalLine[] {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new LedgerError('A journal entry needs at least two lines.');
  }
  const out = lines.map((l, i): JournalLine => {
    const n = i + 1;
    const account = getAccount(l.account);
    if (!account) throw new LedgerError(`Line ${n}: unknown account ${l.account}.`);
    if (!account.active) throw new LedgerError(`Line ${n}: account ${account.code} is inactive.`);
    const debit = toRWF(l.debit ?? 0);
    const credit = toRWF(l.credit ?? 0);
    if (debit < 0 || credit < 0) throw new LedgerError(`Line ${n}: amounts cannot be negative.`);
    if (debit > 0 === credit > 0) {
      throw new LedgerError(`Line ${n}: enter either a debit or a credit, not both and not neither.`);
    }
    if (isDirectCost(account.code) && !l.projectId) {
      throw new LedgerError(`Line ${n}: direct costs must be linked to a project.`);
    }
    return {
      account: account.code,
      debit,
      credit,
      ...(l.projectId ? { projectId: l.projectId } : {}),
      ...(l.party ? { party: l.party } : {}),
      ...(l.memo ? { memo: l.memo } : {}),
    };
  });
  const debits = sum(out.map((l) => l.debit));
  const credits = sum(out.map((l) => l.credit));
  if (debits !== credits) {
    throw new LedgerError(`Entry is not balanced: debits ${debits} and credits ${credits} differ.`);
  }
  return out;
}

export type BalanceFilter = { from?: string; to?: string; projectId?: string; party?: string };

/**
 * Double-entry ledger. Entries are never edited or deleted: a mistake is
 * corrected by posting a reversing entry. Pass a different adapter to test
 * or to move storage to a backend later.
 */
export function createLedger(adapter: StorageAdapter, actor = 'Managing Director') {
  const audit = createAuditLog(adapter, actor);
  const listeners = new Set<() => void>();
  let cache: JournalEntry[] | null = null;

  const load = (): JournalEntry[] => {
    if (cache === null) {
      const raw = readJSON<JournalEntry[]>(adapter, STORAGE_KEYS.ledger, []);
      cache = Array.isArray(raw) ? raw : [];
    }
    return cache;
  };
  const notify = () => listeners.forEach((fn) => fn());
  const commit = (next: JournalEntry[]) => {
    writeJSON(adapter, STORAGE_KEYS.ledger, next);
    cache = next;
    notify();
  };
  const nextId = (entries: JournalEntry[]): string => {
    const max = entries.reduce((m, e) => {
      const match = e.id.match(/^JE-(\d+)$/);
      return match ? Math.max(m, Number(match[1])) : m;
    }, 0);
    return `JE-${String(max + 1).padStart(6, '0')}`;
  };
  const inRange = (e: JournalEntry, f: BalanceFilter) =>
    (!f.from || e.date >= f.from) && (!f.to || e.date <= f.to);
  const reversedIds = (entries: readonly JournalEntry[]) =>
    new Set(entries.filter((e) => e.reversalOf).map((e) => e.reversalOf as string));

  function post(input: NewEntry): JournalEntry {
    const entries = load();
    if (input.idempotencyKey) {
      const existing = entries.find((e) => e.idempotencyKey === input.idempotencyKey);
      if (existing) return existing; // already posted, safe to call twice
    }
    if (!isValidDate(input.date)) throw new LedgerError('Enter a valid date (YYYY-MM-DD).');
    if (!input.description.trim()) throw new LedgerError('Enter a description.');
    const lines = validateLines(input.lines);
    const entry: JournalEntry = {
      id: nextId(entries),
      date: input.date,
      description: input.description.trim(),
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(input.reference ? { reference: input.reference } : {}),
      ...(input.reversalOf ? { reversalOf: input.reversalOf } : {}),
      lines,
      createdAt: new Date().toISOString(),
      createdBy: actor,
    };
    commit([...entries, entry]);
    audit.log({
      action: input.reversalOf ? 'journal.reversed' : 'journal.posted',
      entityType: 'journal_entry',
      entityId: entry.id,
      summary: entry.description,
      details: { sourceType: entry.sourceType, sourceId: entry.sourceId, total: sum(lines.map((l) => l.debit)) },
    });
    return entry;
  }

  function reverse(entryId: string, reason = '', date: string = today()): JournalEntry {
    const entries = load();
    const original = entries.find((e) => e.id === entryId);
    if (!original) throw new LedgerError(`Entry ${entryId} was not found.`);
    if (original.reversalOf) throw new LedgerError('A reversal cannot be reversed. Post a new entry instead.');
    if (reversedIds(entries).has(entryId)) throw new LedgerError(`${entryId} has already been reversed.`);
    return post({
      date,
      description: `Reversal of ${original.id}${reason ? ` — ${reason}` : ''}`,
      sourceType: original.sourceType,
      sourceId: original.sourceId,
      idempotencyKey: `reversal:${original.id}`,
      reference: original.reference,
      reversalOf: original.id,
      lines: original.lines.map((l) => ({
        account: l.account,
        debit: l.credit,
        credit: l.debit,
        projectId: l.projectId,
        party: l.party,
        memo: l.memo,
      })),
    });
  }

  /** Entries for a source record that have not been reversed. */
  function activeBySource(sourceType: SourceType, sourceId: string): JournalEntry[] {
    const entries = load();
    const reversed = reversedIds(entries);
    return entries.filter(
      (e) => e.sourceType === sourceType && e.sourceId === sourceId && !e.reversalOf && !reversed.has(e.id),
    );
  }

  function accountBalance(code: string, filter: BalanceFilter = {}): number {
    const account = getAccount(code);
    if (!account) throw new LedgerError(`Unknown account ${code}.`);
    let debit = 0;
    let credit = 0;
    for (const e of load()) {
      if (!inRange(e, filter)) continue;
      for (const l of e.lines) {
        if (l.account !== code) continue;
        if (filter.projectId && l.projectId !== filter.projectId) continue;
        if (filter.party && l.party !== filter.party) continue;
        debit += l.debit;
        credit += l.credit;
      }
    }
    return signed(account.type, debit, credit);
  }

  function trialBalance(filter: { to?: string } = {}) {
    const rows = ACCOUNTS.map((acc) => {
      let debit = 0;
      let credit = 0;
      for (const e of load()) {
        if (!inRange(e, filter)) continue;
        for (const l of e.lines) {
          if (l.account === acc.code) {
            debit += l.debit;
            credit += l.credit;
          }
        }
      }
      const net = debit - credit;
      return { code: acc.code, name: acc.name, type: acc.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0, active: debit + credit > 0 };
    }).filter((r) => r.active);
    const totalDebit = sum(rows.map((r) => r.debit));
    const totalCredit = sum(rows.map((r) => r.credit));
    return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
  }

  /** Balance per supplier or client for a control account, e.g. payables. */
  function balanceByParty(code: string): { party: string; balance: number }[] {
    const account = getAccount(code);
    if (!account) throw new LedgerError(`Unknown account ${code}.`);
    const totals = new Map<string, { d: number; c: number }>();
    for (const e of load()) {
      for (const l of e.lines) {
        if (l.account !== code) continue;
        const key = l.party || 'Unspecified';
        const t = totals.get(key) ?? { d: 0, c: 0 };
        t.d += l.debit;
        t.c += l.credit;
        totals.set(key, t);
      }
    }
    return [...totals.entries()]
      .map(([party, t]) => ({ party, balance: signed(account.type, t.d, t.c) }))
      .filter((x) => x.balance !== 0)
      .sort((x, y) => y.balance - x.balance);
  }

  /** Direct costs (5xxx) per project, net of reversals. */
  function projectCosts(projectId: string, filter: { from?: string; to?: string } = {}) {
    const byAccount: Record<string, number> = {};
    for (const e of load()) {
      if (!inRange(e, filter)) continue;
      for (const l of e.lines) {
        if (isDirectCost(l.account) && l.projectId === projectId) {
          byAccount[l.account] = (byAccount[l.account] ?? 0) + l.debit - l.credit;
        }
      }
    }
    return { total: sum(Object.values(byAccount)), byAccount };
  }

  function costsByProject(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of load()) {
      for (const l of e.lines) {
        if (isDirectCost(l.account) && l.projectId) out[l.projectId] = (out[l.projectId] ?? 0) + l.debit - l.credit;
      }
    }
    return out;
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.ledger) {
        cache = null; // another browser tab changed the data
        notify();
      }
    };
    if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
    };
  };

  return {
    post,
    reverse,
    activeBySource,
    accountBalance,
    trialBalance,
    balanceByParty,
    projectCosts,
    costsByProject,
    subscribe,
    getEntries: (): readonly JournalEntry[] => load(),
    audit,
  };
}

export type Ledger = ReturnType<typeof createLedger>;

/** The ledger used by the app. */
export const ledger: Ledger = createLedger(localStorageAdapter);
export const auditLog = ledger.audit;
