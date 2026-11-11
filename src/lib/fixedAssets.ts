/**
 * Fixed assets (equipment the company owns) and their depreciation.
 *
 * - Buying an asset:      debit Equipment & Assets (1500) / credit cash, bank or mobile money.
 *                         Owned before the system: credit Opening Balance Equity instead (no money moves).
 *                         A mobile money fee is a bank charge, not part of the asset.
 * - Depreciation:         straight line over the useful life, recorded once a year on 31 December
 *                         (the accounting year end): debit Depreciation / credit Accumulated Depreciation (1510).
 *                         The first year counts only the months owned (bought in October = 3 of 12 months).
 * - Selling / writing off: the year's depreciation up to that month is recorded on the disposal date, then
 *                         the asset and its depreciation are taken off the books; the difference between the
 *                         price received and the book value is a gain (Other Income) or a loss (Other Operating Expenses).
 *
 * The ledger entries are worked out from the asset list and kept in step by syncFixedAssets: anything that no
 * longer matches (an edited cost, a deleted asset, an undone sale) is reversed on its own date and posted again.
 */
import { ACC } from './accounts';
import { ledger as defaultLedger } from './ledger';
import type { Ledger, JournalEntry, JournalLineInput } from './ledger';

export const ASSETS_KEY = 'ista-fortis-fixed-assets-v1';

export const ASSET_CATEGORIES = ['Machinery & equipment', 'Vehicles', 'Tools', 'IT equipment', 'Furniture & fittings', 'Other'] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export type AssetStatus = 'In use' | 'Under repair' | 'Sold' | 'Written off';
export type MoneyMethod = 'Cash' | 'Bank transfer' | 'Mobile money';
export type PaidWith = MoneyMethod | 'Owned before the system';
export const PAID_WITH: PaidWith[] = ['Bank transfer', 'Cash', 'Mobile money', 'Owned before the system'];

export type FixedAsset = {
  id: string;                 // FA-001
  name: string;
  category: AssetCategory;
  purchaseDate: string;       // YYYY-MM-DD
  cost: number;               // whole RWF
  supplier: string;
  serialNumber: string;
  location: string;           // site, project or office
  usefulLifeYears: number;
  residualValue: number;      // expected value at the end of its life (often 0)
  paidWith: PaidWith;
  momoFee?: number;
  status: AssetStatus;
  disposalDate?: string;
  disposalAmount?: number;    // price received when sold (0 when written off)
  disposalMethod?: MoneyMethod;
  notes: string;
  createdAt: string;
};

export type YearDepreciation = { year: number; months: number; amount: number; date: string; posted: boolean; bookValueAfter: number };

const SOURCE = 'fixed_asset';
const PREFIX = 'asset:';
const cashAccount = (m: MoneyMethod) => (m === 'Bank transfer' ? ACC.bank : m === 'Mobile money' ? ACC.mobileMoney : ACC.cash);
const pad = (n: number) => String(n).padStart(2, '0');
const todayIso = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthIndex = (date: string) => { const [y, m] = date.split('-').map(Number); return y * 12 + (m - 1); };

export const isDisposed = (a: FixedAsset) => (a.status === 'Sold' || a.status === 'Written off') && !!a.disposalDate;

/**
 * Depreciation year by year, from the year of purchase to the end of the asset's life (or its disposal).
 * "posted" = its date has been reached, so it is in the books.
 */
export function depreciationSchedule(a: FixedAsset, today = todayIso()): YearDepreciation[] {
  const base = Math.max(a.cost - (a.residualValue || 0), 0);
  const life = Math.max(Math.round(a.usefulLifeYears * 12), 1);
  if (!a.purchaseDate || base <= 0) return [];
  const start = monthIndex(a.purchaseDate);
  const lifeEnd = start + life;
  const end = isDisposed(a) ? Math.min(monthIndex(a.disposalDate as string), lifeEnd) : lifeEnd; // the disposal month is not depreciated
  const upTo = (n: number) => Math.round((base * Math.min(Math.max(n, 0), life)) / life); // depreciation after n months
  const list: YearDepreciation[] = [];
  for (let year = Math.floor(start / 12); year * 12 < end; year += 1) {
    const from = Math.max(start, year * 12);
    const to = Math.min(end, year * 12 + 12);
    if (to <= from) continue;
    const amount = upTo(to - start) - upTo(from - start);
    const date = isDisposed(a) && monthIndex(a.disposalDate as string) < year * 12 + 12 ? (a.disposalDate as string) : `${year}-12-31`;
    list.push({ year, months: to - from, amount, date, posted: date <= today, bookValueAfter: a.cost - upTo(to - start) });
  }
  return list.filter((y) => y.amount > 0);
}

/** Depreciation recorded so far, and the value left in the books. */
export function assetValues(a: FixedAsset, today = todayIso()) {
  const schedule = depreciationSchedule(a, today);
  const depreciated = schedule.filter((y) => y.posted).reduce((s, y) => s + y.amount, 0);
  const thisYear = schedule.find((y) => y.year === Number(today.slice(0, 4)) && !y.posted);
  const disposed = isDisposed(a) && (a.disposalDate as string) <= today;
  return {
    depreciated: disposed ? 0 : depreciated,
    bookValue: disposed ? 0 : a.cost - depreciated,
    /** Depreciation to be recorded on 31 December this year. */
    dueThisYear: thisYear?.amount ?? 0,
    /** Depreciation up to the disposal, for a sold or written-off asset. */
    depreciatedAtDisposal: depreciated,
    gainOrLoss: disposed ? (a.disposalAmount ?? 0) - (a.cost - depreciated) : 0,
  };
}

type Wanted = { sourceId: string; date: string; description: string; lines: JournalLineInput[] };

/** The ledger entries the asset list calls for (only those whose date has been reached). */
export function wantedAssetEntries(assets: FixedAsset[], today = todayIso()): Wanted[] {
  const wanted: Wanted[] = [];
  for (const a of assets) {
    if (!a.purchaseDate || !(a.cost > 0) || a.purchaseDate > today) continue;
    const memo = a.name;
    // Purchase
    const purchase: JournalLineInput[] = [
      { account: ACC.equipment, debit: a.cost, party: a.supplier || undefined, memo },
      a.paidWith === 'Owned before the system'
        ? { account: ACC.openingBalance, credit: a.cost, memo: `${memo} (owned before the system)` }
        : { account: cashAccount(a.paidWith), credit: a.cost, party: a.supplier || undefined, memo },
    ];
    if (a.paidWith === 'Mobile money' && (a.momoFee ?? 0) > 0) {
      purchase.push({ account: ACC.bankCharges, debit: a.momoFee, memo: `Mobile money fee · ${memo}` }, { account: ACC.mobileMoney, credit: a.momoFee, memo: `Mobile money fee · ${memo}` });
    }
    wanted.push({ sourceId: `${PREFIX}${a.id}:purchase`, date: a.purchaseDate, description: `Asset bought – ${a.name}`, lines: purchase });

    // Depreciation, once a year
    const schedule = depreciationSchedule(a, today);
    for (const y of schedule.filter((s) => s.posted)) {
      wanted.push({
        sourceId: `${PREFIX}${a.id}:dep:${y.year}`, date: y.date,
        description: `Depreciation ${y.year} – ${a.name} (${y.months} month${y.months === 1 ? '' : 's'})`,
        lines: [{ account: ACC.depreciation, debit: y.amount, memo }, { account: ACC.accumulatedDepreciation, credit: y.amount, memo }],
      });
    }

    // Sale or write-off
    if (isDisposed(a) && (a.disposalDate as string) <= today) {
      const depreciated = schedule.filter((s) => s.posted).reduce((s, y) => s + y.amount, 0);
      const received = a.status === 'Sold' ? Math.max(a.disposalAmount ?? 0, 0) : 0;
      const result = received - (a.cost - depreciated); // gain (+) or loss (-)
      const lines: JournalLineInput[] = [];
      if (depreciated > 0) lines.push({ account: ACC.accumulatedDepreciation, debit: depreciated, memo });
      if (received > 0) lines.push({ account: cashAccount(a.disposalMethod ?? 'Bank transfer'), debit: received, memo: `${memo} sold` });
      if (result < 0) lines.push({ account: ACC.otherOperating, debit: -result, memo: `Loss on ${a.status === 'Sold' ? 'sale' : 'write-off'} · ${memo}` });
      lines.push({ account: ACC.equipment, credit: a.cost, memo });
      if (result > 0) lines.push({ account: ACC.otherIncome, credit: result, memo: `Gain on sale · ${memo}` });
      wanted.push({ sourceId: `${PREFIX}${a.id}:disposal`, date: a.disposalDate as string, description: `Asset ${a.status === 'Sold' ? 'sold' : 'written off'} – ${a.name}`, lines });
    }
  }
  return wanted;
}

const signature = (lines: readonly { account: string; debit?: number; credit?: number }[]) =>
  lines.map((l) => `${l.account}:${l.debit ?? 0}:${l.credit ?? 0}`).sort().join('|');

/** Brings the ledger in line with the asset list. Returns the number of changes. */
export function syncFixedAssets(assets: FixedAsset[], ledger: Ledger = defaultLedger, today = todayIso()): number {
  const wanted = new Map(wantedAssetEntries(assets, today).map((w) => [w.sourceId, w]));
  const entries = ledger.getEntries();
  const reversed = new Set(entries.filter((e) => e.reversalOf).map((e) => e.reversalOf as string));
  const active = entries.filter((e: JournalEntry) => e.sourceType === SOURCE && e.sourceId.startsWith(PREFIX) && !e.reversalOf && !reversed.has(e.id));
  let changes = 0;
  const kept = new Set<string>();
  for (const e of active) {
    const w = wanted.get(e.sourceId);
    if (w && !kept.has(w.sourceId) && w.date === e.date && w.description === e.description && signature(w.lines) === signature(e.lines)) { kept.add(w.sourceId); continue; }
    ledger.reverse(e.id, 'Fixed asset updated', e.date);
    changes += 1;
  }
  for (const w of wanted.values()) {
    if (kept.has(w.sourceId)) continue;
    const posted = ledger.getEntries().filter((e) => e.idempotencyKey?.startsWith(`${w.sourceId}#`)).length;
    ledger.post({ date: w.date, description: w.description, sourceType: SOURCE, sourceId: w.sourceId, idempotencyKey: `${w.sourceId}#${posted + 1}`, lines: w.lines });
    changes += 1;
  }
  return changes;
}

export function readAssets(): FixedAsset[] {
  try {
    const raw = localStorage.getItem(ASSETS_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as FixedAsset[]) : [];
  } catch {
    return [];
  }
}

/** Runs the sync from the saved asset list, for pages other than Fixed Assets (records year-end depreciation). */
export function syncStoredFixedAssets(ledger: Ledger = defaultLedger): void {
  try {
    if (localStorage.getItem(ASSETS_KEY) === null) return; // nothing loaded yet: never clear the ledger by mistake
    syncFixedAssets(readAssets(), ledger);
  } catch (e) {
    console.error('Could not update fixed assets in the ledger:', e);
  }
}
