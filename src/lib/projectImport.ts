export type ProjectStatus = 'Active' | 'Completed' | 'On hold' | 'Cancelled';

export type ProjectRecord = {
  id: string;
  projectName: string;
  location: string;
  client: string;
  contractValue: number;
  totalReceived: number;
  startDate: string;
  expectedCompletion: string;
  status: ProjectStatus;
  currentPhase: string;
  notes: string;
};

export type ImportMode = 'skip' | 'update';
export type RowAction = 'new' | 'update' | 'skip' | 'error';
export type RowMessage = { level: 'error' | 'warning'; text: string };
export type PreviewRow = { rowNumber: number; action: RowAction; project: ProjectRecord; messages: RowMessage[] };
export type ImportPreview = {
  rows: PreviewRow[];
  columns: string[];
  fatal?: string;
  counts: { new: number; update: number; skip: number; error: number };
};

type Field = keyof ProjectRecord;
const FIELDS: Field[] = ['id', 'projectName', 'location', 'client', 'contractValue', 'totalReceived', 'startDate', 'expectedCompletion', 'status', 'currentPhase', 'notes'];

const LABELS: Record<Field, string> = {
  id: 'Project ID', projectName: 'Project name', location: 'Location', client: 'Client',
  contractValue: 'Contract value', totalReceived: 'Total received', startDate: 'Start date',
  expectedCompletion: 'Expected completion', status: 'Status', currentPhase: 'Current phase', notes: 'Notes',
};

const ALIASES: Record<Field, string[]> = {
  id: ['projectid', 'id', 'projectno', 'projectnumber', 'projectcode', 'code'],
  projectName: ['projectname', 'project', 'name', 'projecttitle'],
  location: ['location', 'site', 'place'],
  client: ['client', 'clientname', 'customer'],
  contractValue: ['contractvalue', 'contractvaluerwf', 'contractamount', 'contractsum'],
  totalReceived: ['totalreceived', 'totalreceivedrwf', 'received', 'cashreceived', 'amountreceived'],
  startDate: ['startdate', 'start', 'datestarted'],
  expectedCompletion: ['expectedcompletion', 'expectedcompletiondate', 'completiondate', 'enddate', 'completion'],
  status: ['status', 'projectstatus'],
  currentPhase: ['currentphase', 'phase'],
  notes: ['notes', 'note', 'remarks', 'comments'],
};

const norm = (v: unknown): string => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const isEmpty = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const text = (v: unknown): string => (v === null || v === undefined || v instanceof Date ? '' : String(v).trim());
const pad2 = (n: number) => String(n).padStart(2, '0');

/* ---------- reading files ---------- */

export function parseCSV(raw: string): string[][] {
  const data = raw.replace(/^\uFEFF/, '');
  const firstLine = data.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].map(d => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    if (inQuotes) {
      if (ch === '"') { if (data[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && data[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export function findHeader(table: unknown[][]): { rowIndex: number; map: Partial<Record<Field, number>> } | null {
  const limit = Math.min(table.length, 25);
  for (let i = 0; i < limit; i++) {
    const map: Partial<Record<Field, number>> = {};
    (table[i] ?? []).forEach((cell, col) => {
      const key = norm(cell);
      if (!key) return;
      for (const field of FIELDS) {
        if (map[field] === undefined && ALIASES[field].includes(key)) { map[field] = col; break; }
      }
    });
    if (map.projectName !== undefined && map.client !== undefined && Object.keys(map).length >= 3) return { rowIndex: i, map };
  }
  return null;
}

/** Reads a .csv, or the first sheet of an .xlsx that has a project header row. */
export async function readProjectFile(file: File): Promise<{ table: unknown[][]; sheet: number }> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return { table: parseCSV(await file.text()), sheet: 1 };
  if (!name.endsWith('.xlsx')) {
    throw new Error('Please choose an .xlsx or .csv file. For an older .xls file, open it in Excel and use Save As .xlsx.');
  }
  const { default: readXlsxFile } = await import('read-excel-file');
  let first: unknown[][] | null = null;
  for (let sheet = 1; sheet <= 15; sheet++) {
    let table: unknown[][];
    try { table = (await readXlsxFile(file, { sheet })) as unknown[][]; } catch { break; }
    if (sheet === 1) first = table;
    if (findHeader(table)) return { table, sheet };
  }
  return { table: first ?? [], sheet: 1 };
}

/* ---------- cleaning values ---------- */

function toNumber(v: unknown): number | null | 'invalid' {
  if (isEmpty(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 'invalid';
  if (typeof v !== 'string') return 'invalid';
  const cleaned = v.replace(/rwf/gi, '').replace(/[,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : 'invalid';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y: number, m: number, d: number): string | null => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad2(m)}-${pad2(d)}` : null;
};
function fromDate(d: Date): string | null {
  const utcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  return utcMidnight ? iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) : iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Returns YYYY-MM-DD, null when empty, or 'invalid'. Day-first for numeric dates (Rwanda). */
function toISODate(v: unknown): string | null | 'invalid' {
  if (isEmpty(v)) return null;
  if (v instanceof Date) return fromDate(v) ?? 'invalid';
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return fromDate(new Date(Math.round((v - 25569) * 86400000))) ?? 'invalid';
    return 'invalid';
  }
  const t = String(v).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]) ?? 'invalid';
  m = t.match(/^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})[\s\-/.,]+(\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mi >= 0 ? iso(+m[3], mi + 1, +m[1]) ?? 'invalid' : 'invalid';
  }
  m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) return iso(+m[3], +m[2], +m[1]) ?? 'invalid';
  return 'invalid';
}

function toStatus(raw: string): ProjectStatus | null {
  const k = norm(raw);
  if (['active', 'inprogress', 'ongoing'].includes(k)) return 'Active';
  if (['completed', 'complete', 'done', 'finished'].includes(k)) return 'Completed';
  if (['onhold', 'hold', 'paused', 'suspended'].includes(k)) return 'On hold';
  if (['cancelled', 'canceled'].includes(k)) return 'Cancelled';
  return null;
}

function normalizeId(v: unknown): string {
  const t = text(v);
  if (!t) return '';
  const m = t.match(/^prj[\s_-]*(\d+)$/i);
  return m ? `PRJ-${String(Number(m[1])).padStart(3, '0')}` : t.toUpperCase();
}

/* ---------- building the preview ---------- */

export function buildPreview(table: unknown[][], existing: ProjectRecord[], mode: ImportMode): ImportPreview {
  const counts = { new: 0, update: 0, skip: 0, error: 0 };
  const header = findHeader(table);
  if (!header) {
    return { rows: [], columns: [], counts, fatal: 'Could not find a header row with at least "Project Name" and "Client" columns. Check the file, or download the template.' };
  }
  const { rowIndex, map } = header;
  const columns = FIELDS.filter(f => map[f] !== undefined).map(f => LABELS[f]);
  const cell = (row: unknown[], f: Field): unknown => (map[f] === undefined ? null : row[map[f] as number] ?? null);

  const dataRows: { rowNumber: number; cells: unknown[] }[] = [];
  for (let i = rowIndex + 1; i < table.length; i++) {
    const cells = table[i] ?? [];
    if (cells.every(isEmpty)) { if (dataRows.length > 0) break; continue; }
    const first = text(cells.find(c => text(c) !== '') ?? '');
    if (/^total/i.test(first)) break;
    dataRows.push({ rowNumber: i + 1, cells });
  }
  if (dataRows.length === 0) return { rows: [], columns, counts, fatal: 'No project rows were found under the header row.' };

  const byId = new Map(existing.map(p => [p.id.toUpperCase(), p]));
  const byName = new Map(existing.map(p => [p.projectName.trim().toLowerCase(), p]));
  let maxNo = 0;
  const bump = (id: string) => { const m = id.match(/^PRJ-(\d+)$/i); if (m) maxNo = Math.max(maxNo, Number(m[1])); };
  existing.forEach(p => bump(p.id));
  dataRows.forEach(r => bump(normalizeId(cell(r.cells, 'id'))));

  const seen = new Set<string>();
  const rows: PreviewRow[] = dataRows.map(({ rowNumber, cells }) => {
    const messages: RowMessage[] = [];
    const error = (t: string) => messages.push({ level: 'error', text: t });
    const warn = (t: string) => messages.push({ level: 'warning', text: t });

    const idText = normalizeId(cell(cells, 'id'));
    const name = text(cell(cells, 'projectName'));
    const client = text(cell(cells, 'client'));
    const match = idText ? byId.get(idText) : name ? byName.get(name.toLowerCase()) : undefined;
    if (!match && idText && name && byName.get(name.toLowerCase())) {
      warn(`A project with this name already exists (${byName.get(name.toLowerCase())!.id}).`);
    }
    if (!name) error('Project name is missing.');
    if (!client && !match) error('Client name is missing.');

    const num = (f: Field, label: string): number | null => {
      const r = toNumber(cell(cells, f));
      if (r === 'invalid') { error(`${label} is not a valid number.`); return null; }
      if (r !== null && r < 0) { error(`${label} cannot be negative.`); return null; }
      return r === null ? null : Math.round(r);
    };
    const contract = num('contractValue', 'Contract value');
    const received = num('totalReceived', 'Total received');
    if (!match) {
      if (contract === null) warn('Contract value is empty; set to 0.');
      if (received === null) warn('Total received is empty; set to 0.');
    }

    const date = (f: Field, label: string): string | null => {
      const r = toISODate(cell(cells, f));
      if (r === 'invalid') { warn(`${label} "${text(cell(cells, f)) || 'value'}" was not recognised and was left ${match ? 'unchanged' : 'blank'}.`); return null; }
      return r;
    };
    const start = date('startDate', 'Start date');
    const expected = date('expectedCompletion', 'Expected completion');

    const statusRaw = text(cell(cells, 'status'));
    const parsedStatus = statusRaw ? toStatus(statusRaw) : null;
    if (statusRaw && !parsedStatus) warn(`Status "${statusRaw}" was not recognised; ${match ? 'left unchanged' : 'set to Active'}.`);

    let id = idText || match?.id || '';
    if (id) {
      if (seen.has(id)) error(`Duplicate project ID ${id} in this file.`);
      seen.add(id);
    }
    const hasError = messages.some(m => m.level === 'error');
    if (!id && !hasError) { id = `PRJ-${String(++maxNo).padStart(3, '0')}`; seen.add(id); }

    const base: ProjectRecord = match
      ? { ...match }
      : { id: '', projectName: '', location: '', client: '', contractValue: 0, totalReceived: 0, startDate: '', expectedCompletion: '', status: 'Active', currentPhase: '', notes: '' };
    const project: ProjectRecord = {
      ...base,
      id,
      projectName: name || base.projectName,
      location: text(cell(cells, 'location')) || base.location,
      client: client || base.client,
      contractValue: contract ?? base.contractValue,
      totalReceived: received ?? base.totalReceived,
      startDate: start ?? base.startDate,
      expectedCompletion: expected ?? base.expectedCompletion,
      status: parsedStatus ?? base.status,
      currentPhase: text(cell(cells, 'currentPhase')) || base.currentPhase,
      notes: text(cell(cells, 'notes')) || base.notes,
    };
    if (project.contractValue > 0 && project.totalReceived > project.contractValue) warn('Total received is more than the contract value.');

    const action: RowAction = hasError ? 'error' : match ? (mode === 'update' ? 'update' : 'skip') : 'new';
    counts[action] += 1;
    return { rowNumber, action, project, messages };
  });

  return { rows, columns, counts };
}

export function downloadProjectTemplate(): void {
  const lines = [
    'Project ID,Project Name,Location,Client,Contract Value (RWF),Total Received (RWF),Start Date,Expected Completion,Status,Current Phase,Notes',
    'PRJ-007,Example Project,Kicukiro - Gahanga,Client Name,10000000,2500000,2026-11-02,2027-03-30,Active,Phase 1,',
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ista-fortis-projects-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}