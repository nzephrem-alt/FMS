import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Plus, X, Check, ChevronLeft, ChevronRight, Printer, HardHat, Wallet, Clock3, Users,
  Pencil, Trash2, Copy, CalendarDays, Lock,
} from 'lucide-react';
import { ACC } from '../lib/accounts';
import { ledger, auditLog } from '../lib/ledger';
import { cashAccountFor, postProjectCost } from '../lib/postings';

const COSTS_KEY = 'ista-fortis-project-costs-v1';
import { LABOUR_TYPES, detectLabourType } from '../lib/costImport';
import { useAccess } from '../lib/access';

/* ---------- types and storage ---------- */

type Method = 'Cash' | 'Mobile money' | 'Bank transfer';
type PaidInfo = { paymentId: string; method: Method; date: string };
/** One worker on one day of one project. A rate means the worker was on site that day. */
type LabourEntry = {
  id: string; projectId: string; date: string; worker: string; category: string; rate: number;
  paid?: PaidInfo; createdAt: string;
};
type Store = { entries: LabourEntry[]; activities: Record<string, string> };
type ProjectOption = { id: string; projectName: string; client?: string };
type DayRow = { key: string; id?: string; worker: string; category: string; rate: number; paid?: PaidInfo; customType?: boolean };
type Editor = { date: string; activity: string; rows: DayRow[] };
type PayDialog = { ids: string[]; method: Method; date: string; fee: string };
type PrintMode = { kind: 'week' } | { kind: 'day'; date: string };

const STORE_KEY = 'ista-fortis-site-labour-v1';
const PROJECTS_KEY = 'ista-fortis-projects-v1';
const METHODS: Method[] = ['Cash', 'Mobile money', 'Bank transfer'];
/** Same labour types as Project Costs, so "Mason" and "Masons" never split the totals. */
const canonicalType = (raw: string) => detectLabourType(raw) || raw.trim().replace(/\s+/g, ' ');
const DEFAULT_TYPE = 'Helpers';
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (iso: string, n: number) => { const d = parse(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const todayIso = () => isoOf(new Date());
/** Monday of the week that contains the date. */
const weekStartOf = (iso: string) => { const d = parse(iso); const back = (d.getDay() + 6) % 7; d.setDate(d.getDate() - back); return isoOf(d); };
const shortDate = (iso: string) => { const d = parse(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const longDate = (iso: string) => { const d = parse(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const isValidIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && isoOf(parse(s)) === s;
const money = (n: number) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0);
const plain = (n: number) => new Intl.NumberFormat('en-RW', { maximumFractionDigits: 0 }).format(n);
const norm = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const dayKey = (projectId: string, date: string) => `${projectId}|${date}`;

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return {
      entries: Array.isArray(v?.entries) ? (v.entries as LabourEntry[]).map((e) => ({ ...e, category: canonicalType(e.category ?? '') })) : [],
      activities: v?.activities && typeof v.activities === 'object' ? v.activities : {},
    };
  } catch { return { entries: [], activities: {} }; }
}
function loadProjects(): ProjectOption[] {
  try { const raw = localStorage.getItem(PROJECTS_KEY); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; }
  catch { return []; }
}
const audit = (action: string, entityId: string, summary: string, details: Record<string, unknown> = {}) => {
  try { auditLog.log({ action, entityType: 'site_labour', entityId, summary, details }); }
  catch (e) { console.error('Could not write the audit log:', e); }
};

/* ---------- ledger ---------- */

/**
 * A paid worker-day posts two entries:
 * 1. on the work day: debit Direct Labour (project), credit Accounts Payable (worker)
 * 2. on the payment day: debit Accounts Payable (worker), credit cash / bank / mobile money
 * So the cost lands in the month the work was done and the cash leaves in the month it was paid.
 * Each payment has its own id, so a day can be un-ticked and paid again later.
 */
function postPaidDay(e: LabourEntry, paid: PaidInfo) {
  try {
    ledger.post({
      date: e.date,
      description: `Site labour · ${e.worker} (${e.category}) · ${e.date}`,
      sourceType: 'project_cost',
      sourceId: e.id,
      idempotencyKey: `site_labour:${e.id}:${paid.paymentId}`,
      reference: `Site labour ${e.date}`,
      lines: [
        { account: ACC.labour, debit: e.rate, projectId: e.projectId, memo: `${e.category} · ${e.worker}` },
        { account: ACC.payables, credit: e.rate, party: e.worker, memo: `Site labour ${e.date}` },
      ],
    });
    ledger.post({
      date: paid.date,
      description: `Site labour paid · ${e.worker} · work on ${e.date}`,
      sourceType: 'cost_payment',
      sourceId: e.id,
      idempotencyKey: `site_labour_payment:${e.id}:${paid.paymentId}`,
      reference: `Site labour ${e.date}`,
      lines: [
        { account: ACC.payables, debit: e.rate, party: e.worker, projectId: e.projectId, memo: `Site labour ${e.date}` },
        { account: cashAccountFor(paid.method), credit: e.rate, projectId: e.projectId, memo: paid.method },
      ],
    });
  } catch (err) {
    reversePaidDay(e.id); // never leave half a posting behind
    throw err;
  }
}

/** Reverses both entries of a paid worker-day, each on its own date. */
function reversePaidDay(entryId: string, reason = 'Site labour payment removed') {
  ledger.activeBySource('cost_payment', entryId).forEach((x) => ledger.reverse(x.id, reason, x.date));
  ledger.activeBySource('project_cost', entryId).forEach((x) => ledger.reverse(x.id, reason, x.date));
}

/* ---------- styles ---------- */

/**
 * Page styles live here so this page is a single file. They mirror the Project Costs page and are
 * scoped under .projects-module, so they restyle this page (and its pop-ups) only.
 */
const LABOUR_CSS = `
.projects-module{--lime:#d5f56b;--lime-ink:#1d2b12;--ink:#1c2b22;--muted:#7d8a83;--line:#edf0f1;display:flex;flex-direction:column;gap:22px;color:var(--ink)}
.projects-module button:focus-visible{outline:2px solid #2f8f6b;outline-offset:2px}
.projects-module button:disabled{opacity:.5;cursor:not-allowed}

/* header */
.projects-module .welcome-row{margin-bottom:0;gap:20px;flex-wrap:wrap;align-items:flex-end}
.projects-module .welcome-row>div:first-child{text-align:left}
.projects-module .welcome-row h2{font-size:28px;font-weight:700;letter-spacing:-.4px;margin:6px 0 4px;color:var(--ink)}
.projects-module .welcome-row p{font-size:13px;color:var(--muted)}
.projects-module .sl-actions{display:flex;flex-wrap:wrap;gap:10px}
.projects-module .projects-secondary-button{height:39px;padding:0 14px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:12px;border:1px solid var(--line);background:#fff;color:var(--ink);font:inherit;font-size:12px;font-weight:600;cursor:pointer}
.projects-module .projects-secondary-button:hover:not(:disabled){background:#f4f7f6}
.projects-module .primary-button{height:39px;border-radius:12px;background:var(--lime);color:var(--lime-ink);font-size:12px;font-weight:600;box-shadow:none}
.projects-module .primary-button:hover:not(:disabled){background:#c8ea52}
.projects-module .projects-import-notice{margin-bottom:0;background:#bdeed6;border:0;color:#1f6b46;border-radius:12px}

/* controls */
.projects-module .sl-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;padding:16px 20px;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 2px #1c2b2208}
.projects-module .sl-field{display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:500;color:#8a968f}
.projects-module .sl-field select{height:38px;min-width:180px;border-radius:12px;border:1px solid var(--line);background:#fff;color:var(--ink);padding:0 10px;font:inherit;font-size:12px}
.projects-module .sl-week{display:inline-flex;align-items:center;gap:4px;height:38px;padding:0 4px;border:1px solid var(--line);border-radius:12px;background:#fff}
.projects-module .sl-week strong{min-width:150px;text-align:center;font-size:12.5px;color:var(--ink)}
.projects-module .sl-week button{width:30px;height:30px;border:0;background:transparent;border-radius:8px;display:grid;place-items:center;color:var(--ink);cursor:pointer}
.projects-module .sl-week button:hover{background:#f1f5f4}
.projects-module .sl-link{border:0;background:transparent;padding:0 4px;height:38px;font:inherit;font-size:12px;font-weight:600;color:#2f8f6b;cursor:pointer}

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
.pj-kpi-note{font-size:10.5px;color:#4f5d55;margin-top:auto;line-height:1.45}

/* register card */
.projects-module .projects-register{padding:20px 0 6px;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 2px #1c2b2208;overflow:hidden}
.projects-module .projects-heading{padding:0 20px 14px;text-align:left}
.projects-module .projects-heading h3{font-size:16px;font-weight:600;color:var(--ink)}
.projects-module .projects-heading p{color:var(--muted);font-size:12px}
.projects-module .projects-empty-icon{background:#ebe8fb;color:#6a5bc2;border-radius:14px}

/* weekly grid */
.projects-module .sl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.projects-module .sl-table{width:100%;min-width:980px;border-collapse:collapse}
.projects-module .sl-table th,.projects-module .sl-table td{padding:10px 8px;font-size:12px;color:#3b4a42;border:0;border-bottom:1px solid #f1f4f4;text-align:center;vertical-align:middle}
.projects-module .sl-table thead th{background:transparent;font-size:11px;font-weight:500;color:#8a968f;border-bottom:1px solid var(--line);vertical-align:top}
.projects-module .sl-table th:first-child,.projects-module .sl-table td:first-child{padding-left:20px}
.projects-module .sl-table th:last-child,.projects-module .sl-table td:last-child{padding-right:20px}
.projects-module .sl-table .left{text-align:left}
.projects-module .sl-table .right{text-align:right}
.projects-module .sl-table .sticky{position:sticky;left:0;z-index:1;background:#fff}
.projects-module .sl-table tbody tr:hover td{background:#f7faf9}
.projects-module .sl-table tfoot td{background:#eef8f2;font-weight:700;color:var(--ink);border-bottom:0;padding-top:13px;padding-bottom:13px;font-variant-numeric:tabular-nums}
.projects-module .sl-table tfoot td.sticky{background:#eef8f2}
.projects-module .sl-day{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:96px}
.projects-module .sl-day b{font-size:11px;font-weight:600;color:var(--ink)}
.projects-module .sl-day.today b{color:#1f7a4f}
.projects-module .sl-day i{font-style:normal;font-size:10px;color:var(--muted);max-width:120px;line-height:1.35;white-space:normal}
.projects-module .sl-day-tools{display:flex;gap:4px;margin-top:3px}
.projects-module .sl-mini{height:24px;padding:0 7px;display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:8px;background:#fff;color:#4f5d55;font:inherit;font-size:10px;font-weight:600;cursor:pointer;white-space:nowrap}
.projects-module .sl-mini:hover{background:#eef8f2;color:#1f6b46}
.projects-module .sl-worker strong{display:block;font-size:12px;font-weight:600;color:var(--ink);white-space:nowrap}
.projects-module .sl-worker span{display:inline-block;margin-top:4px;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;background:#fde5c4;color:#a8691f}
.projects-module .sl-worker span.mason{background:#c9defb;color:#3a66ad}
.projects-module .sl-cell{display:inline-flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}
.projects-module .sl-rate{min-width:52px;text-align:right}
.projects-module .sl-tick{width:26px;height:26px;border-radius:8px;display:inline-grid;place-items:center;padding:0;cursor:pointer;background:#fff;border:1px solid #d3ddd6;color:#14412c;transition:background .12s ease,border-color .12s ease}
.projects-module .sl-tick:hover{border-color:#6fd6a0;background:#eef8f2}
.projects-module .sl-tick.paid{background:#6fd6a0;border-color:#6fd6a0}
.projects-module .sl-tick.readonly,.projects-module .sl-tick.readonly:disabled{cursor:default;opacity:1}
.projects-module .sl-tick.readonly:hover{border-color:#d3ddd6;background:#fff}
.projects-module .sl-tick.readonly.paid:hover{border-color:#6fd6a0;background:#6fd6a0}
.projects-module .sl-none{color:#c5ccc8}
.projects-module .sl-sub{display:block;margin-top:3px;font-size:10px;font-weight:500;color:var(--muted)}
.projects-module .sl-foot-note{padding:12px 20px 14px;font-size:11.5px;color:var(--muted);line-height:1.6}

/* pop-ups */
.projects-module .projects-modal{border-radius:18px}
.projects-module .projects-modal-header h3{color:var(--ink)}
.projects-module .projects-field input,.projects-module .projects-field select{border-radius:10px;border-color:#e5eaec}
.projects-module .projects-cancel{border-radius:12px;border-color:var(--line)}
.projects-module .projects-close{border-radius:10px;border:1px solid var(--line)}
.projects-module .projects-close:hover{background:#f1f5f4;color:var(--ink)}
.projects-module .sl-editor{width:min(760px,100%)}
.projects-module .sl-editor-top{display:grid;grid-template-columns:180px 1fr;gap:12px;margin-bottom:14px}
.projects-module .sl-rows{display:grid;gap:8px}
.projects-module .sl-row{display:grid;grid-template-columns:1fr 150px 130px 38px;gap:8px;align-items:center}
.projects-module .sl-row input{width:100%;box-sizing:border-box;height:38px;padding:0 10px;border:1px solid #e5eaec;border-radius:10px;background:#fff;color:var(--ink);font:inherit;font-size:12.5px}
.projects-module .sl-row input:disabled{background:#f4f7f5;color:#5a6a61}
.projects-module .sl-row select{width:100%;box-sizing:border-box;height:38px;padding:0 8px;border:1px solid #e5eaec;border-radius:10px;background:#fff;color:var(--ink);font:inherit;font-size:12.5px}
.projects-module .sl-row select:disabled{background:#f4f7f5;color:#5a6a61}
.projects-module .sl-type{display:flex;gap:4px;min-width:0}
.projects-module .sl-type input{flex:1;min-width:0}
.projects-module .sl-type button{flex:0 0 auto;width:30px;height:38px;border:1px solid #e5eaec;border-radius:10px;background:#fff;color:#4f5d55;display:grid;place-items:center;cursor:pointer}
.projects-module .sl-row-head{font-size:11px;font-weight:500;color:#8a968f}
.projects-module .sl-group-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:6px;padding:7px 12px;border-radius:10px;background:#eef8f2;font-size:11.5px;color:#1f6b46}
.projects-module .sl-group-head:first-of-type{margin-top:0}
.projects-module .sl-group-head b{font-weight:700}
.projects-module .sl-group-head span{font-weight:600;font-variant-numeric:tabular-nums}
.projects-module .sl-table tr.sl-group td{background:#eef8f2;font-size:11px;font-weight:700;color:#1f6b46;padding-top:8px;padding-bottom:8px;font-variant-numeric:tabular-nums}
.projects-module .sl-table tr.sl-group td.sticky{background:#eef8f2}
.projects-module .sl-table tr.sl-group td small{font-weight:500;color:#4f7a63;margin-left:6px}
.projects-module .sl-table tbody tr.sl-group:hover td{background:#eef8f2}
.projects-module .sl-remove{width:38px;height:38px;border:1px solid var(--line);background:#fff;border-radius:10px;display:grid;place-items:center;color:#b04a58;cursor:pointer}
.projects-module .sl-remove:hover:not(:disabled){background:#fbd6db}
.projects-module .sl-lock{width:38px;height:38px;display:grid;place-items:center;color:#1f7a4f}
.projects-module .sl-editor-tools{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.projects-module .sl-editor-total{margin-top:14px;padding:12px 14px;border-radius:12px;background:#eef8f2;color:#3f5a4c;font-size:12.5px;display:flex;flex-wrap:wrap;gap:6px 18px}
.projects-module .sl-help{margin:8px 0 0;font-size:11px;color:var(--muted);line-height:1.5}
.projects-module .sl-pay-many{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end}
@media(max-width:600px){.projects-module .sl-pay-many{width:100%}.projects-module .sl-pay-many>button{flex:1 1 100%;justify-content:center}}
.projects-module .sl-pay-info{margin:0 0 14px;padding:12px 14px;border-radius:12px;background:#fde5c4;color:#7a4c14;font-size:12.5px;line-height:1.6}
.projects-module .sl-stack{display:grid;gap:12px}

/* printable sheet (screen: hidden) */
.sl-print{display:none}

@media(max-width:1100px){.pj-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}

/* phones */
@media(max-width:640px){
.projects-module{gap:16px}
.projects-module .welcome-row{display:flex;flex-direction:column;align-items:stretch;gap:14px}
.projects-module .welcome-row h2{font-size:24px}
.projects-module .sl-actions{width:100%}
.projects-module .sl-actions>button{flex:1 1 0}
.projects-module .sl-controls{display:grid;grid-template-columns:1fr;padding:14px}
.projects-module .sl-field select{min-width:0;width:100%}
.projects-module .sl-week{justify-content:space-between}
.projects-module .sl-week strong{min-width:0}
.pj-kpis{gap:10px}
.pj-kpi{padding:12px 12px 14px}
.pj-kpi-value{font-size:clamp(14px,11cqw,20px);margin:12px 0 4px}
.projects-module .projects-heading{padding:0 14px 12px}
.projects-module .sl-table th:first-child,.projects-module .sl-table td:first-child{padding-left:14px}
.projects-module .projects-modal-backdrop{padding:10px}
.projects-module .projects-modal{width:100%;max-width:100%;max-height:calc(100vh - 20px);overflow-y:auto;padding:18px 16px}
.projects-module .sl-editor-top{grid-template-columns:1fr}
.projects-module .sl-row{grid-template-columns:1fr 1fr 38px;padding:10px;border:1px solid var(--line);border-radius:12px}
.projects-module .sl-row .sl-name{grid-column:1/-1}
.projects-module .sl-row-head{display:none}
.projects-module .projects-form-actions{flex-wrap:wrap}
.projects-module .projects-form-actions>button{flex:1 1 auto;justify-content:center}
}
@media(prefers-reduced-motion:reduce){.pj-kpi,.sl-tick{transition:none}.pj-kpi:hover{transform:none}}

/* print: only the labour sheet */
@media print{
  @page{size:A4 landscape;margin:12mm}
  body *{visibility:hidden}
  .sl-print,.sl-print *{visibility:visible}
  .sl-print{display:block;position:absolute;left:0;top:0;width:100%;color:#000;font-family:Arial,Helvetica,sans-serif}
  .sl-print h1{font-size:16px;margin:0 0 2px}
  .sl-print .sl-print-sub{font-size:11px;color:#333;margin:0 0 10px}
  .sl-print table{width:100%;border-collapse:collapse;font-size:10.5px}
  .sl-print th,.sl-print td{border:1px solid #7a8a80;padding:5px 6px;text-align:center}
  .sl-print thead th{background:#1f4e79;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sl-print td.left,.sl-print th.left{text-align:left}
  .sl-print td.right{text-align:right}
  .sl-print .ok{color:#1a7f37;font-weight:700}
  .sl-print .no{color:#c62828;font-weight:700}
  .sl-print tfoot td{background:#d8ecd0;font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sl-print .act td{font-style:italic;background:#f3f6f4;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sl-print .sl-print-sum{margin-top:10px;font-size:11px;display:flex;gap:24px}
  .sl-print .sl-sign{margin-top:36px;display:flex;gap:60px;font-size:11px}
  .sl-print .sl-sign div{flex:1;border-top:1px solid #000;padding-top:4px}
}
`;

/* ---------- page ---------- */

export default function SiteLabour() {
  const { isAdmin } = useAccess(); // Viewers see the sheets and can export them, but not change them
  const [store, setStore] = useState<Store>(loadStore);
  const [projects] = useState<ProjectOption[]>(loadProjects);
  const [projectId, setProjectId] = useState(() => loadProjects()[0]?.id ?? '');
  const [weekStart, setWeekStart] = useState(() => weekStartOf(todayIso()));
  const [payMethod, setPayMethod] = useState<Method>('Cash');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorError, setEditorError] = useState('');
  const [payDialog, setPayDialog] = useState<PayDialog | null>(null);
  const [payError, setPayError] = useState('');
  const [printMode, setPrintMode] = useState<PrintMode | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => { localStorage.setItem(STORE_KEY, JSON.stringify(store)); }, [store]);

  // LEDGER: make sure every paid worker-day is in the ledger. Safe to run repeatedly.
  useEffect(() => {
    store.entries.forEach((e) => {
      if (!e.paid) return;
      try { postPaidDay(e, e.paid); }
      catch (err) { console.error(`Could not post site labour ${e.id} to the ledger:`, err); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Print after the printable sheet has rendered, then clear it.
  useEffect(() => {
    if (!printMode) return;
    const done = () => setPrintMode(null);
    window.addEventListener('afterprint', done);
    const t = window.setTimeout(() => window.print(), 60);
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printMode]);

  const project = projects.find((p) => p.id === projectId);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const today = todayIso();
  const weekEnd = days[6];

  const projectEntries = useMemo(() => store.entries.filter((e) => e.projectId === projectId), [store.entries, projectId]);
  const weekEntries = useMemo(() => projectEntries.filter((e) => e.date >= weekStart && e.date <= weekEnd), [projectEntries, weekStart, weekEnd]);

  /** Workers seen this week, in the order they first appear; category from their latest day. */
  const workers = useMemo(() => {
    const map = new Map<string, { key: string; name: string; category: string; lastDate: string }>();
    [...weekEntries].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)).forEach((e) => {
      const key = norm(e.worker);
      const row = map.get(key);
      if (!row) map.set(key, { key, name: e.worker, category: e.category, lastDate: e.date });
      else if (e.date >= row.lastDate) { row.category = e.category; row.lastDate = e.date; }
    });
    return [...map.values()];
  }, [weekEntries]);

  const cellMap = useMemo(() => new Map(weekEntries.map((e) => [`${norm(e.worker)}|${e.date}`, e])), [weekEntries]);
  const sum = (list: LabourEntry[]) => list.reduce((s, e) => s + e.rate, 0);
  const weekTotal = sum(weekEntries);
  const weekPaid = sum(weekEntries.filter((e) => e.paid));
  const weekAwaiting = weekTotal - weekPaid;
  const allAwaiting = projectEntries.filter((e) => !e.paid);
  const weekUnpaid = weekEntries.filter((e) => !e.paid);
  const knownWorkers = useMemo(() => {
    const seen = new Map<string, string>();
    [...projectEntries].sort((a, b) => b.date.localeCompare(a.date)).forEach((e) => { if (!seen.has(norm(e.worker))) seen.set(norm(e.worker), e.worker); });
    return [...seen.values()];
  }, [projectEntries]);
  const categoryOptions = useMemo(() => [...new Set([...LABOUR_TYPES, ...store.entries.map((e) => e.category)])], [store.entries]);
  /** Display order of labour categories: the standard list first, then any others alphabetically. */
  const categoryRank = (c: string) => { const i = LABOUR_TYPES.indexOf(c); return i === -1 ? LABOUR_TYPES.length : i; };
  const byCategory = (a: string, b: string) => categoryRank(a) - categoryRank(b) || a.localeCompare(b);

  /** This week's workers, grouped by labour category. */
  const workerGroups = useMemo(() => {
    const groups = new Map<string, typeof workers>();
    workers.forEach((w) => groups.set(w.category, [...(groups.get(w.category) ?? []), w]));
    return [...groups].sort(([a], [b]) => byCategory(a, b)).map(([category, list]) => ({ category, list }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workers]);

  const dayEntries = (date: string) => weekEntries.filter((e) => e.date === date);
  const activityOf = (date: string) => store.activities[dayKey(projectId, date)] ?? '';

  /* ---------- day editor ---------- */
  const rowsFor = (date: string): DayRow[] =>
    projectEntries.filter((e) => e.date === date)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((e) => ({ key: e.id, id: e.id, worker: e.worker, category: e.category, rate: e.rate, paid: e.paid }));

  const openEditor = (date: string) => {
    const rows = rowsFor(date);
    setEditor({ date, activity: activityOf(date), rows: rows.length ? rows : [{ key: newId('row'), worker: '', category: DEFAULT_TYPE, rate: 0 }] });
    setEditorError('');
  };
  const changeEditorDate = (date: string) => {
    if (!editor || !isValidIso(date)) { setEditor((ed) => (ed ? { ...ed, date } : ed)); return; }
    const rows = rowsFor(date);
    setEditor({ date, activity: activityOf(date), rows: rows.length ? rows : [{ key: newId('row'), worker: '', category: DEFAULT_TYPE, rate: 0 }] });
  };
  const updateRow = (key: string, patch: Partial<DayRow>) =>
    setEditor((ed) => (ed ? { ...ed, rows: ed.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) } : ed));
  const addRow = () => setEditor((ed) => (ed ? { ...ed, rows: [...ed.rows, { key: newId('row'), worker: '', category: DEFAULT_TYPE, rate: 0 }] } : ed));
  const removeRow = (key: string) => setEditor((ed) => (ed ? { ...ed, rows: ed.rows.filter((r) => r.key !== key) } : ed));

  /** Copies workers, categories and rates from the most recent earlier day on this project. */
  const copyPreviousDay = () => {
    if (!editor) return;
    const previous = projectEntries.filter((e) => e.date < editor.date).map((e) => e.date).sort().pop();
    if (!previous) { setEditorError('There is no earlier day on this project to copy from.'); return; }
    const have = new Set(editor.rows.filter((r) => r.worker.trim()).map((r) => norm(r.worker)));
    const copied = rowsFor(previous)
      .filter((r) => !have.has(norm(r.worker)))
      .map((r) => ({ key: newId('row'), worker: r.worker, category: r.category, rate: r.rate }));
    setEditor({ ...editor, rows: [...editor.rows.filter((r) => r.id || r.worker.trim() || r.rate), ...copied] });
    setEditorError(copied.length ? '' : `Everyone from ${longDate(previous)} is already on this day.`);
  };

  const saveDay = () => {
    if (!editor) return;
    setEditorError('');
    if (!projectId) { setEditorError('Select a project first.'); return; }
    if (!isValidIso(editor.date)) { setEditorError('Choose a valid date.'); return; }
    const rows = editor.rows.filter((r) => r.paid || r.worker.trim() || r.rate);
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.paid) { seen.add(norm(r.worker)); continue; }
      if (!r.worker.trim()) { setEditorError('Enter a name for every worker, or remove the empty row.'); return; }
      if (!r.category.trim()) { setEditorError(`Enter a labour category for ${r.worker.trim()}.`); return; }
      if (!Number.isInteger(r.rate) || r.rate <= 0) { setEditorError(`Enter ${r.worker.trim()}'s pay for the day in whole RWF.`); return; }
      if (seen.has(norm(r.worker))) { setEditorError(`${r.worker.trim()} is listed twice on this day.`); return; }
      seen.add(norm(r.worker));
    }
    const keepIds = new Set(rows.filter((r) => r.id).map((r) => r.id as string));
    const now = new Date().toISOString();
    setStore((old) => {
      const others = old.entries.filter((e) => !(e.projectId === projectId && e.date === editor.date));
      const existing = old.entries.filter((e) => e.projectId === projectId && e.date === editor.date);
      const kept = existing
        .filter((e) => e.paid || keepIds.has(e.id)) // paid days can never be dropped here
        .map((e) => {
          if (e.paid) return e;
          const r = rows.find((x) => x.id === e.id);
          return r ? { ...e, worker: r.worker.trim().replace(/\s+/g, ' '), category: canonicalType(r.category), rate: r.rate } : e;
        });
      const added = rows.filter((r) => !r.id).map((r, i): LabourEntry => ({
        id: newId('SL'), projectId, date: editor.date, worker: r.worker.trim().replace(/\s+/g, ' '),
        category: canonicalType(r.category), rate: r.rate, createdAt: new Date(Date.parse(now) + i).toISOString(),
      }));
      const activities = { ...old.activities };
      if (editor.activity.trim()) activities[dayKey(projectId, editor.date)] = editor.activity.trim();
      else delete activities[dayKey(projectId, editor.date)];
      return { entries: [...others, ...kept, ...added], activities };
    });
    audit('site_labour.saved', dayKey(projectId, editor.date), `Saved site labour for ${project?.projectName ?? projectId} on ${editor.date}`, { workers: rows.length, total: rows.reduce((s, r) => s + r.rate, 0) });
    setWeekStart(weekStartOf(editor.date));
    setEditor(null);
  };

  /* ---------- paying ---------- */
  const openPay = (ids: string[]) => {
    if (!ids.length) return;
    setPayDialog({ ids, method: payMethod, date: today, fee: '' });
    setPayError('');
  };
  const payEntries = payDialog ? store.entries.filter((e) => payDialog.ids.includes(e.id) && !e.paid) : [];
  const payDays = [...new Set(payEntries.map((e) => e.date))].sort();

  const confirmPay = () => {
    if (!payDialog) return;
    if (!isValidIso(payDialog.date)) { setPayError('Choose a valid payment date.'); return; }
    const fee = payDialog.method === 'Mobile money' ? Number(payDialog.fee || 0) : 0;
    if (!Number.isInteger(fee) || fee < 0) { setPayError('Enter the MoMo fee in whole RWF, or leave it empty if there was none.'); return; }
    const done: Record<string, PaidInfo> = {};
    let failure = '';
    for (const e of payEntries) {
      const paid: PaidInfo = { paymentId: newId('P'), method: payDialog.method, date: payDialog.date };
      // LEDGER: post first, so a day is never marked paid without its journal entries
      try { postPaidDay(e, paid); done[e.id] = paid; }
      catch (err) { failure = errText(err, 'The ledger rejected this payment.'); break; }
    }
    const count = Object.keys(done).length;
    if (count) {
      setStore((old) => ({ ...old, entries: old.entries.map((e) => (done[e.id] ? { ...e, paid: done[e.id] } : e)) }));
      const total = payEntries.filter((e) => done[e.id]).reduce((s, e) => s + e.rate, 0);
      audit('site_labour.paid', projectId, `Paid ${count} site labour day${count === 1 ? '' : 's'} (${money(total)}) by ${payDialog.method}`, { ids: Object.keys(done), method: payDialog.method, date: payDialog.date, total });
      const feeNote = fee > 0 ? recordMomoFee(fee, count, payDialog.date) : '';
      setNotice(`Marked ${count} worker-day${count === 1 ? '' : 's'} as paid (${money(total)}) by ${payDialog.method}.${feeNote}`);
    }
    if (failure) { setPayError(`Paid ${count} of ${payEntries.length}. Stopped because: ${failure}`); return; }
    setPayDialog(null);
  };

  /**
   * The mobile money fee for one payment is a single amount. It is recorded once, as a Labour cost
   * of the project on Project Costs (paid by mobile money), so it counts in the project's labour cost.
   * Returns a sentence for the notice.
   */
  const recordMomoFee = (fee: number, workers: number, date: string): string => {
    try {
      const costs: { id: string }[] = JSON.parse(localStorage.getItem(COSTS_KEY) || '[]');
      const list = Array.isArray(costs) ? costs : [];
      const next = list.reduce((max, c) => { const m = /^CST-(\d+)$/.exec(c.id); return m ? Math.max(max, Number(m[1])) : max; }, 0) + 1;
      const record = {
        id: `CST-${String(next).padStart(4, '0')}`, projectId, projectName: project?.projectName ?? projectId, date,
        category: 'Labour', labourType: '', description: `MoMo fee · site labour payment (${workers} worker${workers === 1 ? '' : 's'})`,
        supplier: '', amount: fee, amountPaid: fee, paymentMethod: 'Mobile money', reference: '', notes: '',
        reversed: false, createdAt: new Date().toISOString(),
      };
      postProjectCost(record); // LEDGER: labour cost of the project, paid from mobile money
      localStorage.setItem(COSTS_KEY, JSON.stringify([record, ...list]));
      return ` The ${money(fee)} MoMo fee is recorded as ${record.id} on Project Costs.`;
    } catch (err) {
      return ` The MoMo fee could not be recorded (${errText(err, 'ledger error')}). Record it on Project Costs instead.`;
    }
  };

  const unpay = (e: LabourEntry) => {
    if (!e.paid) return;
    if (!window.confirm(`Remove the payment of ${money(e.rate)} to ${e.worker} for ${longDate(e.date)}? Reversing entries will be posted to the ledger.`)) return;
    // LEDGER: post the reversing entries first
    try { reversePaidDay(e.id); }
    catch (err) { window.alert(errText(err, 'Could not reverse in the ledger.')); return; }
    setStore((old) => ({ ...old, entries: old.entries.map((x) => (x.id === e.id ? { ...x, paid: undefined } : x)) }));
    audit('site_labour.unpaid', e.id, `Removed payment to ${e.worker} for ${e.date}`, { amount: e.rate });
  };

  /* ---------- printing ---------- */
  const printDays = printMode ? (printMode.kind === 'week' ? days.filter((d) => dayEntries(d).length > 0) : [printMode.date]) : [];
  const printEntries = weekEntries.filter((e) => printDays.includes(e.date));
  const printWorkers = workers.filter((w) => printEntries.some((e) => norm(e.worker) === w.key));

  const editorTotal = editor ? editor.rows.reduce((s, r) => s + (Number.isFinite(r.rate) ? r.rate : 0), 0) : 0;
  const editorPaid = editor ? editor.rows.filter((r) => r.paid).reduce((s, r) => s + r.rate, 0) : 0;
  const weekLabel = `${shortDate(weekStart)} – ${longDate(weekEnd)}`;

  return (
    <section className="projects-module">
      <style>{LABOUR_CSS}</style>

      <div className="welcome-row">
        <div>
          <div className="eyebrow">PROJECT FINANCIAL CONTROL</div>
          <h2>Site Labour</h2>
          <p>Daily labour sheets from site: who worked, their pay for the day, and who has been paid.</p>
        </div>
        <div className="sl-actions">
          <button type="button" className="projects-secondary-button" onClick={() => setPrintMode({ kind: 'week' })} disabled={!weekEntries.length}><Printer size={15} /> Export week PDF</button>
          {isAdmin && <button type="button" className="primary-button" onClick={() => openEditor(today >= weekStart && today <= weekEnd ? today : weekStart)} disabled={!projectId}><Plus size={16} /> Record day</button>}
        </div>
      </div>

      {notice && <div className="projects-import-notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}

      <div className="sl-controls">
        <label className="sl-field">Project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.length === 0 && <option value="">No projects registered</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.projectName} ({p.id})</option>)}
          </select>
        </label>
        <div className="sl-field">Week
          <div className="sl-week">
            <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week"><ChevronLeft size={15} /></button>
            <strong>{weekLabel}</strong>
            <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week"><ChevronRight size={15} /></button>
          </div>
        </div>
        {weekStart !== weekStartOf(today) && <button type="button" className="sl-link" onClick={() => setWeekStart(weekStartOf(today))}>This week</button>}
        <label className="sl-field">Pay from
          <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as Method)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
        </label>
      </div>

      <div className="pj-kpis">
        <Metric title="Labour this week" value={money(weekTotal)} note={`${weekEntries.length} worker-day${weekEntries.length === 1 ? '' : 's'} recorded`} icon={<HardHat size={13} />} tone="blue" />
        <Metric title="Paid this week" value={money(weekPaid)} note={weekTotal > 0 ? `${Math.round((weekPaid / weekTotal) * 100)}% of this week's labour` : 'Nothing recorded this week'} icon={<Wallet size={13} />} tone="green" />
        <Metric title="Awaiting payment this week" value={money(weekAwaiting)} note={`${weekEntries.filter((e) => !e.paid).length} worker-day${weekEntries.filter((e) => !e.paid).length === 1 ? '' : 's'} not yet paid`} icon={<Clock3 size={13} />} tone="amber" />
        <Metric title="Awaiting payment, all weeks" value={money(sum(allAwaiting))} note={`${workers.length} worker${workers.length === 1 ? '' : 's'} on site this week`} icon={<Users size={13} />} tone="amber" />
      </div>

      <div className="panel projects-register">
        <div className="panel-heading projects-heading">
          <div>
            <h3>{project ? project.projectName : 'Labour sheet'}</h3>
            <p>Tick a worker's day once it is approved and paid. Use "Pay all" to pay everyone still unpaid on a day, or pay a whole week or everything awaiting at once. Paid days are posted to the ledger as Direct Labour on this project.</p>
          </div>
          {isAdmin && (weekUnpaid.length > 0 || allAwaiting.length > 0) && (
            <div className="sl-pay-many">
              <button type="button" className="projects-secondary-button" onClick={() => openPay(weekUnpaid.map((e) => e.id))} disabled={!weekUnpaid.length}>
                <Wallet size={15} /> Pay this week{weekUnpaid.length ? ` (${money(sum(weekUnpaid))})` : ''}
              </button>
              <button type="button" className="primary-button" onClick={() => openPay(allAwaiting.map((e) => e.id))} disabled={!allAwaiting.length}>
                <Wallet size={15} /> Pay all awaiting{allAwaiting.length ? ` (${money(sum(allAwaiting))})` : ''}
              </button>
            </div>
          )}
        </div>

        {projects.length === 0 ? (
          <Empty icon={<HardHat size={24} />} title="No projects registered yet" message="Register a project first. Labour sheets are recorded per project." />
        ) : workers.length === 0 ? (
          <Empty icon={<CalendarDays size={24} />} title="No labour recorded this week" message={isAdmin ? "Record the list your site engineer or foreman shared for a day. You can copy the previous day's workers and change only what is different." : 'Labour sheets for this week will appear here once the Admin records them.'}
            action={isAdmin && <button type="button" className="primary-button" onClick={() => openEditor(today >= weekStart && today <= weekEnd ? today : weekStart)}><Plus size={16} /> Record day</button>} />
        ) : (
          <div className="sl-wrap">
            <table className="sl-table">
              <thead>
                <tr>
                  <th className="left sticky">Worker</th>
                  {days.map((d, i) => {
                    const list = dayEntries(d);
                    const unpaid = list.filter((e) => !e.paid);
                    return (
                      <th key={d}>
                        <div className={`sl-day${d === today ? ' today' : ''}`}>
                          <b>{WEEKDAYS[i]} {shortDate(d)}</b>
                          {activityOf(d) && <i>{activityOf(d)}</i>}
                          <div className="sl-day-tools">
                            {isAdmin && <button type="button" className="sl-mini" onClick={() => openEditor(d)} title={list.length ? 'Edit this day' : 'Record this day'}>{list.length ? <><Pencil size={11} /> Edit</> : <><Plus size={11} /> Add</>}</button>}
                            {isAdmin && unpaid.length > 0 && <button type="button" className="sl-mini" onClick={() => openPay(unpaid.map((e) => e.id))} title="Pay everyone still unpaid on this day"><Check size={11} /> Pay all</button>}
                            {list.length > 0 && <button type="button" className="sl-mini" onClick={() => setPrintMode({ kind: 'day', date: d })} title="Export this day as PDF" aria-label={`Export ${shortDate(d)} as PDF`}><Printer size={11} /></button>}
                          </div>
                        </div>
                      </th>
                    );
                  })}
                  <th className="right">Week total</th>
                </tr>
              </thead>
              <tbody>
                {workerGroups.map(({ category, list: groupWorkers }) => {
                  const keys = new Set(groupWorkers.map((w) => w.key));
                  const groupEntries = weekEntries.filter((e) => keys.has(norm(e.worker)));
                  return [
                    <tr key={`group-${category}`} className="sl-group">
                      <td className="left sticky">{category}<small>{groupWorkers.length} worker{groupWorkers.length === 1 ? '' : 's'}</small></td>
                      {days.map((d) => { const dayTotal = sum(groupEntries.filter((e) => e.date === d)); return <td key={d}>{dayTotal ? plain(dayTotal) : ''}</td>; })}
                      <td className="right">{money(sum(groupEntries))}</td>
                    </tr>,
                    ...groupWorkers.map((w) => {
                  const mine = weekEntries.filter((e) => norm(e.worker) === w.key);
                  const total = sum(mine);
                  const unpaid = sum(mine.filter((e) => !e.paid));
                  return (
                    <tr key={w.key}>
                      <td className="left sticky sl-worker"><strong>{w.name}</strong></td>
                      {days.map((d) => {
                        const e = cellMap.get(`${w.key}|${d}`);
                        if (!e) return <td key={d}><span className="sl-none">—</span></td>;
                        return (
                          <td key={d}>
                            <span className="sl-cell">
                              <span className="sl-rate">{plain(e.rate)}</span>
                              <button type="button" className={`sl-tick${e.paid ? ' paid' : ''}${isAdmin ? '' : ' readonly'}`}
                                disabled={!isAdmin}
                                onClick={() => (e.paid ? unpay(e) : openPay([e.id]))}
                                aria-label={`${e.worker}, ${longDate(d)}: ${e.paid ? 'paid' : 'not paid'}`}
                                title={e.paid ? `Paid ${money(e.rate)} by ${e.paid.method} on ${longDate(e.paid.date)}.${isAdmin ? ' Click to remove the payment.' : ''}` : `${e.category} · ${money(e.rate)}.${isAdmin ? ' Click to mark as paid.' : ' Not paid yet.'}`}>
                                {e.paid && <Check size={15} strokeWidth={3} />}
                              </button>
                            </span>
                          </td>
                        );
                      })}
                      <td className="right"><strong>{money(total)}</strong>{unpaid > 0 && <span className="sl-sub">{money(unpaid)} unpaid</span>}</td>
                    </tr>
                  );
                    }),
                  ];
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="left sticky">Total</td>
                  {days.map((d) => {
                    const list = dayEntries(d);
                    const unpaid = sum(list.filter((e) => !e.paid));
                    return <td key={d}>{list.length ? <>{plain(sum(list))}{unpaid > 0 && <span className="sl-sub">{plain(unpaid)} unpaid</span>}</> : '—'}</td>;
                  })}
                  <td className="right">{money(weekTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {workers.length > 0 && <p className="sl-foot-note">A paid day is recorded as a labour cost on the work date and as money paid on the payment date. Removing a payment posts reversing entries, so the history stays complete.</p>}
      </div>

      {/* ---------- day editor ---------- */}
      {editor && isAdmin && (
        <div className="projects-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditor(null); }}>
          <section className="projects-modal sl-editor" role="dialog" aria-modal="true" aria-labelledby="sl-editor-title">
            <div className="projects-modal-header">
              <div><div className="eyebrow">{project?.projectName ?? 'SITE LABOUR'}</div><h3 id="sl-editor-title">Labour for {isValidIso(editor.date) ? longDate(editor.date) : 'the day'}</h3></div>
              <button type="button" className="projects-close" onClick={() => setEditor(null)} aria-label="Close"><X size={19} /></button>
            </div>

            <div className="sl-editor-top">
              <label className="projects-field">Date<input type="date" value={editor.date} onChange={(e) => changeEditorDate(e.target.value)} /></label>
              <label className="projects-field">Activity / works done<input value={editor.activity} onChange={(e) => setEditor({ ...editor, activity: e.target.value })} placeholder="e.g. Front column casting" /></label>
            </div>

            <div className="sl-rows">
              <div className="sl-row sl-row-head"><span>Worker name</span><span>Labour category</span><span>Pay for the day (RWF)</span><span /></div>
              {(() => {
                // Rows grouped by labour category. A category being typed stays under "Other" until saved, so the row does not jump while typing.
                const groupOf = (r: DayRow) => (r.customType ? 'Other' : r.category || 'Other');
                const names = [...new Set(editor.rows.map(groupOf))].sort(byCategory);
                return names.map((name) => {
                  const list = editor.rows.filter((r) => groupOf(r) === name);
                  const total = list.reduce((s, r) => s + (Number.isFinite(r.rate) ? r.rate : 0), 0);
                  return [
                    <div className="sl-group-head" key={`group-${name}`}><b>{name} · {list.length} worker{list.length === 1 ? '' : 's'}</b><span>{money(total)}</span></div>,
                    ...list.map((r) => (
                <div className="sl-row" key={r.key}>
                  <input className="sl-name" list="sl-workers" value={r.worker} disabled={!!r.paid} onChange={(e) => updateRow(r.key, { worker: e.target.value })} placeholder="Worker name" aria-label="Worker name" />
                  {r.customType ? (
                    <span className="sl-type">
                      <input value={r.category} autoFocus onChange={(e) => updateRow(r.key, { category: e.target.value })} placeholder="Type the labour type" aria-label="Labour category" />
                      <button type="button" onClick={() => updateRow(r.key, { customType: false, category: DEFAULT_TYPE })} title="Back to the list" aria-label="Back to the list"><X size={13} /></button>
                    </span>
                  ) : (
                    <select value={r.category} disabled={!!r.paid} aria-label="Labour category"
                      onChange={(e) => (e.target.value === '__other' ? updateRow(r.key, { customType: true, category: '' }) : updateRow(r.key, { category: e.target.value }))}>
                      {[...new Set([...categoryOptions, r.category].filter(Boolean))].map((c) => <option key={c} value={c}>{c}</option>)}
                      <option value="__other">Other (type your own)…</option>
                    </select>
                  )}
                  <input type="number" min="1" step="1" value={r.rate || ''} disabled={!!r.paid} onChange={(e) => updateRow(r.key, { rate: Number(e.target.value) })} placeholder="Amount" aria-label="Pay for the day" />
                  {r.paid
                    ? <span className="sl-lock" title={`Paid by ${r.paid.method} on ${longDate(r.paid.date)}. Remove the payment from the sheet to change it.`}><Lock size={15} /></span>
                    : <button type="button" className="sl-remove" onClick={() => removeRow(r.key)} aria-label="Remove worker"><Trash2 size={14} /></button>}
                </div>
                    )),
                  ];
                });
              })()}
              <datalist id="sl-workers">{knownWorkers.map((n) => <option key={n} value={n} />)}</datalist>
            </div>

            <div className="sl-editor-tools">
              <button type="button" className="projects-secondary-button" onClick={addRow}><Plus size={14} /> Add worker</button>
              <button type="button" className="projects-secondary-button" onClick={copyPreviousDay}><Copy size={14} /> Copy previous day</button>
            </div>
            <p className="sl-help">Rates are entered for this day only. Copying the previous day brings its workers and rates in as a starting point; change whatever is different. Paid workers are locked.</p>

            <div className="sl-editor-total">
              <span>Day total: <strong>{money(editorTotal)}</strong></span>
              <span>Paid: <strong>{money(editorPaid)}</strong></span>
              <span>Awaiting payment: <strong>{money(editorTotal - editorPaid)}</strong></span>
            </div>

            {editorError && <p className="projects-validation" role="alert">{editorError}</p>}
            <div className="projects-form-actions">
              <button type="button" className="projects-cancel" onClick={() => setEditor(null)}>Cancel</button>
              <button type="button" className="primary-button" onClick={saveDay}><Check size={15} /> Save day</button>
            </div>
          </section>
        </div>
      )}

      {/* ---------- pay dialog ---------- */}
      {payDialog && isAdmin && (
        <div className="projects-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setPayDialog(null); }}>
          <section className="projects-modal" style={{ width: 'min(440px,100%)' }} role="dialog" aria-modal="true" aria-labelledby="sl-pay-title">
            <div className="projects-modal-header">
              <div><div className="eyebrow">MARK AS PAID</div><h3 id="sl-pay-title">{payEntries.length === 1 ? `${payEntries[0].worker} · ${longDate(payEntries[0].date)}` : payDays.length > 1 ? `${payEntries.length} worker-days · ${payDays.length} days` : `${payEntries.length} workers`}</h3></div>
              <button type="button" className="projects-close" onClick={() => setPayDialog(null)} aria-label="Close"><X size={19} /></button>
            </div>
            <p className="sl-pay-info">Amount to pay: <strong>{money(sum(payEntries))}</strong>{payEntries.length > 1 && <> for {payEntries.length} {payDays.length > 1 ? `worker-days, ${shortDate(payDays[0])} – ${longDate(payDays[payDays.length - 1])}` : 'workers'}</>}{payEntries.length === 1 && <> · {payEntries[0].category}</>}</p>
            <div className="sl-stack">
              <label className="projects-field">Paid from<select value={payDialog.method} onChange={(e) => setPayDialog({ ...payDialog, method: e.target.value as Method })}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label className="projects-field">Payment date<input type="date" value={payDialog.date} onChange={(e) => setPayDialog({ ...payDialog, date: e.target.value })} /></label>
              {payDialog.method === 'Mobile money' && <label className="projects-field">MoMo fee (RWF){payEntries.length > 1 ? ', one amount for this payment' : ''}<input type="number" min="0" step="1" value={payDialog.fee} onChange={(e) => setPayDialog({ ...payDialog, fee: e.target.value })} placeholder="0" /></label>}
              {payError && <p className="projects-validation" role="alert">{payError}</p>}
            </div>
            <div className="projects-form-actions">
              <button type="button" className="projects-cancel" onClick={() => setPayDialog(null)}>Cancel</button>
              <button type="button" className="primary-button" onClick={confirmPay} disabled={!payEntries.length}><Check size={15} /> Mark as paid</button>
            </div>
          </section>
        </div>
      )}

      {/* ---------- printable sheet ---------- */}
      {printMode && (
        <div className="sl-print" aria-hidden="true">
          <h1>ISTA FORTIS — {project?.id} {project?.projectName}</h1>
          <p className="sl-print-sub">Site labour · {printMode.kind === 'week' ? `Week of ${weekLabel}` : longDate(printMode.date)} · Amounts in RWF · ✓ paid, ✗ not yet paid</p>
          <table>
            <thead>
              <tr>
                <th className="left">Worker name</th>
                <th className="left">Labour category</th>
                {printDays.map((d) => <th key={d}>{WEEKDAYS[(parse(d).getDay() + 6) % 7]} {longDate(d)}</th>)}
                {printDays.length > 1 && <th>Total</th>}
              </tr>
            </thead>
            <tbody>
              {printWorkers.map((w) => {
                const mine = printEntries.filter((e) => norm(e.worker) === w.key);
                return (
                  <tr key={w.key}>
                    <td className="left">{w.name}</td>
                    <td className="left">{w.category}</td>
                    {printDays.map((d) => {
                      const e = mine.find((x) => x.date === d);
                      return <td key={d}>{e ? <>{plain(e.rate)} <span className={e.paid ? 'ok' : 'no'}>{e.paid ? '✓' : '✗'}</span></> : ''}</td>;
                    })}
                    {printDays.length > 1 && <td className="right">{plain(sum(mine))}</td>}
                  </tr>
                );
              })}
              <tr className="act">
                <td className="left" colSpan={2}>Activity</td>
                {printDays.map((d) => <td key={d}>{activityOf(d)}</td>)}
                {printDays.length > 1 && <td />}
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td className="left" colSpan={2}>TOTAL</td>
                {printDays.map((d) => <td key={d}>{plain(sum(printEntries.filter((e) => e.date === d)))}</td>)}
                {printDays.length > 1 && <td className="right">{plain(sum(printEntries))}</td>}
              </tr>
            </tfoot>
          </table>
          <div className="sl-print-sum">
            <span>Grand total: <b>RWF {plain(sum(printEntries))}</b></span>
            <span>Paid: <b>RWF {plain(sum(printEntries.filter((e) => e.paid)))}</b></span>
            <span>Awaiting payment: <b>RWF {plain(sum(printEntries.filter((e) => !e.paid)))}</b></span>
          </div>
          <div className="sl-sign"><div>Prepared by</div><div>Site engineer / foreman</div><div>Approved by</div></div>
        </div>
      )}
    </section>
  );
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

function Empty({ icon, title, message, action }: { icon: ReactNode; title: string; message: string; action?: ReactNode }) {
  return (
    <div className="projects-empty">
      <div className="projects-empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{message}</p>
      {action && <div className="projects-header-actions" style={{ justifyContent: 'center' }}>{action}</div>}
    </div>
  );
}
