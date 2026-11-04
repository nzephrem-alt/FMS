import { parseCSV } from './projectImport';

export type CostCategory = 'Labour' | 'Materials' | 'Equipment' | 'Transport' | 'Site expenses' | 'Other';
export type PaymentMethod = 'Cash' | 'Bank transfer' | 'Mobile money' | 'Cheque' | 'Other';

/** A cost ready to become a ProjectCost record (id and timestamps are added on confirm). */
export type CostDraft = {
  projectId: string; projectName: string; date: string; category: CostCategory;
  /** Only for Labour: Helpers, Masons, Foreman, ... (free text, these are suggestions). */
  labourType: string;
  description: string; supplier: string; amount: number; amountPaid: number;
  paymentMethod: PaymentMethod; reference: string; notes: string;
};

export type ImportAction = 'new' | 'skip' | 'error';
export type ImportMessage = { level: 'error' | 'warning'; text: string };
export type PreviewRow = { key: string; rowNumber: number; action: ImportAction; cost: CostDraft; messages: ImportMessage[] };
export type CostPreview = {
  fatal?: string;
  columns: string[];
  rows: PreviewRow[];
  counts: { new: number; skip: number; error: number };
};
export type ImportOptions = {
  /** What to assume when the file has no "amount paid" value. */
  paidDefault: 'paid' | 'unpaid';
  defaultMethod: PaymentMethod;
  /** Used for rows that name no project (e.g. a file for a single project). '' = none. */
  fallbackProjectId: string;
  /** Used for rows whose date is missing or not a real date (YYYY-MM-DD). '' = report an error. */
  fallbackDate: string;
};
export type ImportSheet = { name: string; table: unknown[][] };

type ProjectLite = { id: string; projectName: string; location?: string };
type ExistingCost = { projectId: string; date: string; category: string; description: string; amount: number; reversed: boolean };

/* ---------- reading the file ---------- */

/** Reads a .csv, or every sheet of an .xlsx (the sheet with a cost header row is picked first). */
export async function readCostFile(file: File): Promise<{ sheets: ImportSheet[]; best: number }> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    const table = parseCSV(await file.text());
    return { sheets: [{ name: 'CSV', table }], best: 0 };
  }
  if (!name.endsWith('.xlsx')) {
    throw new Error('Please choose an .xlsx or .csv file. For an older .xls file, open it in Excel and use Save As .xlsx.');
  }
  const { default: readXlsxFile } = await import('read-excel-file');
  let names: string[] = [];
  try {
    const info = (await (readXlsxFile as unknown as (f: File, o: object) => Promise<{ name: string }[]>)(file, { getSheets: true }));
    names = info.map(s => s.name);
  } catch { /* sheet names are optional */ }
  const sheets: ImportSheet[] = [];
  for (let n = 1; n <= (names.length || 15); n++) {
    try { sheets.push({ name: names[n - 1] ?? `Sheet ${n}`, table: (await readXlsxFile(file, { sheet: n })) as unknown[][] }); }
    catch { break; }
  }
  if (!sheets.length) throw new Error('This file could not be read. Check that it is a valid Excel file.');
  return { sheets, best: Math.max(0, sheets.findIndex(s => findHeader(s.table))) };
}

export function downloadCostTemplate(): void {
  const lines = [
    'Date,Project ID,Category,Labour Type,Description,Supplier,Total Cost (RWF),Amount Paid (RWF),Payment Method,Reference,Notes',
    '2026-04-22,PRJ-001,Materials,,Cement for foundation,Local dealer,340000,340000,Cash,INV-102,',
    '2026-04-23,PRJ-001,Labour,Masons,"3 masons, one day",,45000,0,Cash,,Pay on Friday',
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ista-fortis-project-costs-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- labour types ---------- */

export const LABOUR_TYPES = ['Helpers', 'Masons', 'Foreman', 'Carpenters', 'Steel fixers', 'Skilled labour', 'Operators', 'Trainees', 'Site keeper', 'Subcontractor', 'Plumber', 'Electrician', 'Painter', 'Welder', 'Surveyor'];

const LABOUR_PATTERNS: [string, RegExp][] = [
  ['Helpers', /h\w?l\w?pers?/i], // also catches typos such as "helkpers"
  ['Masons', /mason/i],
  ['Foreman', /foremen|foreman|supervisor/i],
  ['Carpenters', /carpent/i], // carpenter, carpentor, carpentry
  ['Steel fixers', /steel\s*-?\s*fixer|bar\s*bender/i],
  ['Skilled labour', /skilled/i],
  ['Operators', /operator/i],
  ['Trainees', /trainee|apprentice/i],
  ['Site keeper', /site\s*keeper|watchman|night\s*guard/i],
  ['Subcontractor', /sub\s*-?\s*contract/i],
  ['Plumber', /plumb/i],
  ['Electrician', /electric/i],
  ['Painter', /painter/i],
  ['Welder', /weld/i],
  ['Surveyor', /survey/i],
];

/** First text that names a labour type wins; within a text the earliest mention wins ("mason & helpers" is Masons). */
export function detectLabourType(...texts: string[]): string {
  for (const t of texts) {
    let best: [number, string] | null = null;
    for (const [label, re] of LABOUR_PATTERNS) {
      const m = t.match(re);
      if (m && m.index !== undefined && (!best || m.index < best[0])) best = [m.index, label];
    }
    if (best) return best[1];
  }
  return '';
}

/* ---------- helpers ---------- */

const text = (v: unknown) => (v == null || v instanceof Date ? '' : String(v).trim());
const norm = (v: unknown) => text(v).toLowerCase().replace(/rwf/g, '').replace(/[^a-z0-9]/g, '');

/** null = blank, NaN = not a number, otherwise the number. */
function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = text(v).replace(/rwf/gi, '').replace(/[,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function validIso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function fromDate(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  const utcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  return utcMidnight ? validIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) : validIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function toIso(v: unknown): string | null {
  if (v instanceof Date) return fromDate(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) return fromDate(new Date(Math.floor(v - 25569) * 86400000));
  const s = text(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validIso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/); // day first, as used in Rwanda
  if (m) return validIso(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}

function normalizeCategory(raw: string): CostCategory | null {
  const s = raw.toLowerCase();
  if (/labou?r|helper|wage|worker|mason|casual/.test(s)) return 'Labour';
  if (/material/.test(s)) return 'Materials';
  if (/equip|machine|excavat|hire|compactor/.test(s)) return 'Equipment';
  if (/transport/.test(s)) return 'Transport';
  if (/site/.test(s)) return 'Site expenses';
  if (/other|misc/.test(s)) return 'Other';
  return null;
}

function normalizeMethod(raw: string): PaymentMethod | null {
  const s = raw.toLowerCase();
  if (/bank|transfer|wire/.test(s)) return 'Bank transfer';
  if (/mobile|momo|mtn|airtel/.test(s)) return 'Mobile money';
  if (/cheque|check/.test(s)) return 'Cheque';
  if (/cash/.test(s)) return 'Cash';
  return null;
}

/* ---------- header detection ---------- */

type ColumnMap = {
  date?: number; projects: number[]; category?: number; labourType?: number; description: number[]; supplier?: number;
  amount?: number; paid?: number; method?: number; reference?: number; notes: number[];
  /** Wide layout: one column per cost type (Labour Cost, Material Cost, ...). */
  cats: { category: CostCategory; col: number }[];
};

const CAT_HEADERS: Record<string, CostCategory> = {
  labourcost: 'Labour', laborcost: 'Labour', labour: 'Labour', labor: 'Labour',
  materialcost: 'Materials', materialscost: 'Materials', material: 'Materials', materials: 'Materials',
  equipmentcost: 'Equipment', equipment: 'Equipment', equipmenthire: 'Equipment',
  transportcost: 'Transport', transport: 'Transport',
  siteexpenses: 'Site expenses', siteexpense: 'Site expenses',
  othercost: 'Other', othercosts: 'Other', other: 'Other',
};

function mapHeaders(table: unknown[][], rowIndex: number): { map: ColumnMap; columns: string[] } | null {
  const row = table[rowIndex] ?? [];
  const map: ColumnMap = { projects: [], description: [], notes: [], cats: [] };
  const columns: string[] = [];
  row.forEach((cell, col) => {
    const h = norm(cell);
    if (!h) return;
    let used = true;
    if (['date', 'transactiondate', 'costdate'].includes(h)) map.date ??= col;
    else if (['projectid', 'project', 'projectname', 'site', 'projectsite', 'prjid'].includes(h)) map.projects.push(col);
    else if (['labourtype', 'labortype', 'workertype', 'worktype', 'trade', 'role', 'skill'].includes(h)) map.labourType ??= col;
    else if (['category', 'costcategory', 'costtype', 'expensecategory', 'type'].includes(h)) map.category ??= col;
    else if (['description', 'descriptionparticulars', 'particulars', 'details', 'item', 'activity', 'activityworkdone', 'workdone'].includes(h)) map.description.push(col);
    else if (['supplier', 'recipient', 'supplierrecipient', 'payee', 'paidto', 'vendor'].includes(h)) map.supplier ??= col;
    else if (['amountpaid', 'paid', 'paidamount'].includes(h)) map.paid ??= col;
    else if (['paymentmethod', 'method', 'paymentmode'].includes(h)) map.method ??= col;
    else if (['reference', 'ref', 'invoice', 'receipt', 'paymentreference', 'paymentinvoicereference', 'invoicenumber'].includes(h)) map.reference ??= col;
    else if (['notes', 'note', 'comments', 'comment', 'remarks'].includes(h)) map.notes.push(col);
    else if (['amount', 'totalcost', 'totalcosts', 'totalamount'].includes(h)) map.amount ??= col;
    else if (h === 'cost') {
      // "Cost" is a number column in some files and a description in others: look at the data.
      const sample = table.slice(rowIndex + 1, rowIndex + 16).map(r => (r as unknown[])[col]).filter(v => text(v) !== '');
      const numeric = sample.filter(v => { const n = toNum(v); return n !== null && !Number.isNaN(n); }).length;
      if (sample.length && numeric / sample.length > 0.5) map.amount ??= col; else map.description.push(col);
    } else if (CAT_HEADERS[h]) map.cats.push({ category: CAT_HEADERS[h], col });
    else used = false;
    if (used) columns.push(text(cell));
  });
  const hasAmount = map.amount != null || map.paid != null || map.cats.length > 0;
  return map.date != null && hasAmount ? { map, columns } : null;
}

function findHeader(table: unknown[][]) {
  for (let i = 0; i < Math.min(table.length, 100); i++) {
    const found = mapHeaders(table, i);
    if (found) return { rowIndex: i, ...found };
  }
  return null;
}

/* ---------- project matching ---------- */

function matchProject(values: string[], projects: ProjectLite[]): { project?: ProjectLite; error?: string } {
  const wanted = values.map(v => v.trim()).filter(Boolean);
  if (!wanted.length) return {};
  for (const w of wanted) {
    const lw = w.toLowerCase();
    const exact = projects.find(p => p.id.toLowerCase() === lw) ?? projects.find(p => p.projectName.trim().toLowerCase() === lw);
    if (exact) return { project: exact };
  }
  for (const w of wanted) {
    const lw = w.toLowerCase();
    const partial = projects.filter(p => p.projectName.toLowerCase().includes(lw) || lw.includes(p.projectName.toLowerCase()) || (p.location ?? '').toLowerCase().includes(lw));
    if (partial.length === 1) return { project: partial[0] };
    if (partial.length > 1) return { error: `"${w}" matches several projects (${partial.map(p => p.id).join(', ')}). Use the Project ID.` };
  }
  return { error: `Project "${wanted[0]}" is not registered. Add it on the Projects page first.` };
}

/* ---------- preview ---------- */

const keyOf = (projectId: string, date: string, category: string, description: string, amount: number) =>
  `${projectId}|${date}|${category}|${description.trim().toLowerCase()}|${amount}`;

export function buildCostPreview(table: unknown[][], projects: ProjectLite[], existing: ExistingCost[], opts: ImportOptions): CostPreview {
  const counts = { new: 0, skip: 0, error: 0 };
  const found = findHeader(table);
  if (!found) {
    return { fatal: 'Could not find the column headers. The file needs at least a Date column and a cost amount column (for example Total Cost, or Labour Cost / Material Cost). Download the template to see the layout.', columns: [], rows: [], counts };
  }
  const { rowIndex, map, columns } = found;
  const split = map.cats.length > 0;
  const fallback = projects.find(p => p.id === opts.fallbackProjectId);

  // Costs already recorded, so re-importing the same file does not create duplicates.
  const seen = new Map<string, number>();
  for (const c of existing) {
    if (c.reversed) continue;
    const k = keyOf(c.projectId, c.date, c.category, c.description, c.amount);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }

  const rows: PreviewRow[] = [];
  let lastCategory: CostCategory | null = null;

  for (let i = rowIndex + 1; i < table.length; i++) {
    const r = (table[i] ?? []) as unknown[];
    if (r.every(v => text(v) === '')) continue;
    if (/^total\b/i.test(r.map(text).find(Boolean) ?? '')) continue;
    const cell = (c?: number) => (c == null ? '' : r[c]);
    const rowNumber = i + 1;

    // Work out the cost lines this spreadsheet row holds.
    type Line = { category: CostCategory | null; amount: number; paid: number | null };
    const lines: Line[] = [];
    const rowErrors: string[] = [];
    if (split) {
      for (const { category, col } of map.cats) {
        const n = toNum(r[col]);
        if (n === null || n === 0) continue;
        if (Number.isNaN(n)) { rowErrors.push(`"${text(r[col])}" is not a valid amount.`); continue; }
        lines.push({ category, amount: n, paid: null });
      }
    } else {
      const a = toNum(cell(map.amount));
      const p = map.paid != null ? toNum(cell(map.paid)) : null;
      if (a !== null && Number.isNaN(a)) rowErrors.push(`"${text(cell(map.amount))}" is not a valid amount.`);
      else if (p !== null && Number.isNaN(p)) rowErrors.push(`"${text(cell(map.paid))}" is not a valid amount paid.`);
      else if (a !== null && a !== 0) lines.push({ category: null, amount: a, paid: p });
      else if (a === null && p !== null && p !== 0) lines.push({ category: null, amount: p, paid: p }); // only "paid" given
      else if (text(cell(map.date)) !== '' || map.description.some(c => text(r[c]) !== '')) {
        if (a === null && p === null) rowErrors.push('No cost amount on this row.');
      }
    }
    if (!lines.length && !rowErrors.length) continue; // blank or zero row, nothing to import

    // Fields shared by every line of this row.
    const shared: ImportMessage[] = rowErrors.map(text => ({ level: 'error' as const, text }));
    let date = toIso(cell(map.date));
    if (!date) {
      const raw = text(cell(map.date));
      if (opts.fallbackDate) {
        date = opts.fallbackDate;
        shared.push({ level: 'warning', text: `${raw ? `Date "${raw}" is not a real date` : 'No date'}; used ${opts.fallbackDate}.` });
      } else shared.push({ level: 'error', text: `${raw ? `"${raw}" is not a real date` : 'Missing date'}. Use a date such as 2026-04-22 or 22/04/2026, or choose a fallback date above.` });
    }

    let project: ProjectLite | undefined;
    const pm = matchProject(map.projects.map(c => text(r[c])), projects);
    if (pm.project) project = pm.project;
    else if (pm.error) shared.push({ level: 'error', text: pm.error });
    else if (fallback) project = fallback;
    else shared.push({ level: 'error', text: 'No project on this row. Add a Project ID column or choose a project above.' });

    const descParts = [...new Set(map.description.map(c => text(r[c])).filter(Boolean))];
    const rawMethod = text(cell(map.method));
    let method: PaymentMethod = opts.defaultMethod;
    if (rawMethod) {
      const m = normalizeMethod(rawMethod);
      if (m) method = m; else { method = 'Other'; shared.push({ level: 'warning', text: `Payment method "${rawMethod}" not recognised; set to Other.` }); }
    }
    const base = {
      supplier: text(cell(map.supplier)), reference: text(cell(map.reference)),
      notes: map.notes.map(c => text(r[c])).filter(Boolean).join(' · '),
    };

    const emit = (line: Line | null) => {
      const messages = shared.map(m => ({ ...m }));
      let category: CostCategory = line?.category ?? 'Other';
      if (line && !line.category) {
        const rawCat = text(cell(map.category));
        if (rawCat) {
          const c = normalizeCategory(rawCat);
          if (c) category = c; else messages.push({ level: 'warning', text: `Category "${rawCat}" not recognised; set to Other.` });
          lastCategory = c ?? 'Other';
        } else if (lastCategory) { category = lastCategory; messages.push({ level: 'warning', text: `No category; used "${lastCategory}" from the row above.` }); }
        else messages.push({ level: 'warning', text: 'No category; set to Other.' });
      }
      let amount = line?.amount ?? 0;
      let paid = line ? (line.paid ?? (opts.paidDefault === 'paid' ? amount : 0)) : 0;
      if (line) {
        if (amount < 0 || paid < 0) messages.push({ level: 'error', text: 'Amounts cannot be negative.' });
        if (!Number.isInteger(amount) || !Number.isInteger(paid)) { amount = Math.round(amount); paid = Math.round(paid); messages.push({ level: 'warning', text: 'Amount rounded to whole RWF.' }); }
        if (amount <= 0 && !messages.some(m => m.level === 'error')) messages.push({ level: 'error', text: 'Amount must be more than zero.' });
        if (paid > amount) messages.push({ level: 'error', text: 'Amount paid is more than the total cost.' });
      }
      const description = descParts.join(' – ') || `${category} cost`;
      let labourType = '';
      if (category === 'Labour') {
        const rawLabour = text(cell(map.labourType));
        // Prefer an explicit column, then the category cell, then the description (most specific part first).
        labourType = rawLabour ? (detectLabourType(rawLabour) || rawLabour) : detectLabourType(text(cell(map.category)), ...[...descParts].reverse());
      }
      const cost: CostDraft = {
        projectId: project?.id ?? '', projectName: project?.projectName ?? '', date: date ?? '',
        category, labourType, description, amount, amountPaid: paid, paymentMethod: method, ...base,
      };
      let action: ImportAction = messages.some(m => m.level === 'error') ? 'error' : 'new';
      if (action === 'new') {
        const k = keyOf(cost.projectId, cost.date, cost.category, cost.description, cost.amount);
        const left = seen.get(k) ?? 0;
        if (left > 0) { seen.set(k, left - 1); action = 'skip'; }
      }
      counts[action] += 1;
      rows.push({ key: `${rowNumber}-${rows.length}`, rowNumber, action, cost, messages });
    };

    if (lines.length) lines.forEach(emit); else emit(null);
  }

  if (!rows.length) return { fatal: 'No cost rows were found below the headers.', columns, rows, counts };
  return { columns, rows, counts };
}