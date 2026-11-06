import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Plus, Search, X, RotateCcw, Receipt, Wallet, TrendingDown, Eye, Ban,
  Upload, Download, FileSpreadsheet, FolderKanban, CheckCircle2, Clock3, CircleDashed, CreditCard, Undo2,
} from 'lucide-react';
import { postCostPayment, postProjectCost, reverseProjectCost } from '../lib/postings'; // LEDGER
import { auditLog, ledger } from '../lib/ledger';
import type { JournalEntry } from '../lib/ledger';
import { LABOUR_TYPES, buildCostPreview, downloadCostTemplate, readCostFile } from '../lib/costImport';
import type { ImportOptions, ImportSheet, PaymentMethod as ImportMethod } from '../lib/costImport';
import { useAccess } from '../lib/access';

type CostCategory = 'Labour' | 'Materials' | 'Equipment' | 'Transport' | 'Site expenses' | 'Other';
type PaymentStatus = 'Paid' | 'Unpaid' | 'Partially paid';
type PaymentMethod = 'Cash' | 'Bank transfer' | 'Mobile money' | 'Cheque' | 'Other';
type ProjectCost = {
  id: string; projectId: string; projectName: string; date: string; category: CostCategory; labourType?: string;
  description: string; supplier: string; amount: number; amountPaid: number;
  paymentMethod: PaymentMethod; reference: string; notes: string; reversed: boolean;
  reversedAt?: string; createdAt: string;
};
type ProjectOption = { id: string; projectName: string; client?: string; location?: string };
type CostForm = Omit<ProjectCost, 'id' | 'reversed' | 'reversedAt' | 'createdAt'>;

const COSTS_KEY = 'ista-fortis-project-costs-v1';
const PROJECTS_KEY = 'ista-fortis-projects-v1';
const SITE_LABOUR_KEY = 'ista-fortis-site-labour-v1';
const categories: CostCategory[] = ['Labour', 'Materials', 'Equipment', 'Transport', 'Site expenses', 'Other'];
const methods: PaymentMethod[] = ['Cash', 'Bank transfer', 'Mobile money', 'Cheque', 'Other'];
const blankForm: CostForm = { projectId: '', projectName: '', date: new Date().toISOString().slice(0, 10), category: 'Materials', labourType: '', description: '', supplier: '', amount: 0, amountPaid: 0, paymentMethod: 'Bank transfer', reference: '', notes: '' };
const defaultImportOptions: ImportOptions = { paidDefault: 'paid', defaultMethod: 'Cash', fallbackProjectId: '', fallbackDate: '' };
const importActionLabel = { new: 'New', skip: 'Already recorded, skipped', error: 'Error' } as const;
const PREVIEW_LIMIT = 200;
const money = (n: number) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0);

function loadCosts(): ProjectCost[] { try { const raw = localStorage.getItem(COSTS_KEY); return raw ? JSON.parse(raw) as ProjectCost[] : []; } catch { return []; } }
/** Worker-days recorded on the Site Labour page (read only here; that page posts them to the ledger when paid). */
type SiteLabourDay = { id: string; projectId: string; date: string; worker: string; category: string; rate: number; paid?: { method?: string; date?: string }; createdAt?: string };
type SiteLabourStore = { entries: SiteLabourDay[]; activities: Record<string, string> };
function loadSiteLabour(): SiteLabourStore {
  try {
    const raw = localStorage.getItem(SITE_LABOUR_KEY); const v = raw ? JSON.parse(raw) : null;
    return { entries: Array.isArray(v?.entries) ? v.entries as SiteLabourDay[] : [], activities: v?.activities && typeof v.activities === 'object' ? v.activities : {} };
  } catch { return { entries: [], activities: {} }; }
}
/** One project's site labour for one day, shown as a single read-only row in the cost register. */
type LabourDayRow = { key: string; projectId: string; projectName: string; date: string; activity: string; workers: SiteLabourDay[]; types: string[]; amount: number; paid: number; createdAt: string };
type RegisterRow = { kind: 'cost'; cost: ProjectCost } | { kind: 'labour'; day: LabourDayRow };
const labourStatusOf = (d: LabourDayRow): PaymentStatus => (d.paid >= d.amount ? 'Paid' : d.paid === 0 ? 'Unpaid' : 'Partially paid');
const labourStatusClass = (d: LabourDayRow) => { const s = labourStatusOf(d); return s === 'Paid' ? 'status-active' : s === 'Unpaid' ? 'status-on-hold' : 'status-completed'; };
const labourStatusIcon = (d: LabourDayRow) => { const s = labourStatusOf(d); return s === 'Paid' ? <CheckCircle2 size={14} /> : s === 'Unpaid' ? <CircleDashed size={14} /> : <Clock3 size={14} />; };
function loadProjects(): ProjectOption[] { try { const raw = localStorage.getItem(PROJECTS_KEY); return raw ? JSON.parse(raw) as ProjectOption[] : []; } catch { return []; } }

function paymentStatusOf(cost: ProjectCost): PaymentStatus {
  const due = cost.amount - cost.amountPaid;
  return due <= 0 ? 'Paid' : cost.amountPaid === 0 ? 'Unpaid' : 'Partially paid';
}

/** Reuses the status pill colours from the Projects page. */
const statusClass = (cost: ProjectCost) => {
  if (cost.reversed) return 'status-cancelled';
  const s = paymentStatusOf(cost);
  return s === 'Paid' ? 'status-active' : s === 'Unpaid' ? 'status-on-hold' : 'status-completed';
};

function statusIcon(cost: ProjectCost) {
  if (cost.reversed) return <Ban size={14} />;
  const s = paymentStatusOf(cost);
  if (s === 'Paid') return <CheckCircle2 size={14} />;
  if (s === 'Unpaid') return <CircleDashed size={14} />;
  return <Clock3 size={14} />;
}

/**
 * Page styles live here so this page is a single file. They mirror the Projects page and are
 * scoped under .projects-module, so they restyle this page (and its pop-ups) only.
 */
/* ---------- later payments of a cost (read from the ledger) ---------- */
type CostPayment = { entryId: string; date: string; amount: number; method: string; reference: string };
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const payMethods: PaymentMethod[] = ['Cash', 'Bank transfer', 'Mobile money', 'Cheque'];
const blankPay = () => ({ amount: '', date: localToday(), method: 'Bank transfer' as PaymentMethod, reference: '' });

/** Payments made after a cost was recorded. Undone payments are left out. */
function laterPayments(costId: string): CostPayment[] {
  const entries: readonly JournalEntry[] = ledger.getEntries();
  const undone = new Set(entries.filter(e => e.reversalOf).map(e => e.reversalOf as string));
  return entries
    .filter(e => e.sourceType === 'cost_payment' && e.sourceId === costId && !e.reversalOf && !undone.has(e.id))
    .map(e => ({
      entryId: e.id,
      date: e.date,
      amount: e.lines.reduce((s, l) => s + l.debit, 0),
      method: e.lines.find(l => l.credit > 0)?.memo || '—',
      reference: e.reference || '',
    }));
}
/** Next payment number for a cost, counting undone payments too, so every posting stays unique. */
const nextPaymentNo = (costId: string) =>
  ledger.getEntries().filter(e => e.sourceType === 'cost_payment' && e.sourceId === costId && !e.reversalOf).length + 1;

const COSTS_CSS = `
.projects-module{--lime:#d5f56b;--lime-ink:#1d2b12;--ink:#1c2b22;--muted:#7d8a83;--line:#edf0f1;display:flex;flex-direction:column;gap:22px;color:var(--ink)}
.projects-module button:focus-visible{outline:2px solid #2f8f6b;outline-offset:2px}
.projects-module button:disabled{opacity:.5;cursor:not-allowed}

/* header */
.projects-module .welcome-row{margin-bottom:0;gap:20px;flex-wrap:wrap;align-items:flex-end}
.projects-module .welcome-row h2{font-size:28px;font-weight:700;letter-spacing:-.4px;margin:6px 0 4px;color:var(--ink)}
.projects-module .welcome-row p{font-size:13px;color:var(--muted)}
.projects-module .projects-secondary-button{height:39px;border-radius:12px;border:1px solid var(--line);background:#fff;color:var(--ink);font-weight:600}
.projects-module .projects-secondary-button:hover:not(:disabled){background:#f4f7f6}
.projects-module .primary-button{height:39px;border-radius:12px;background:var(--lime);color:var(--lime-ink);font-size:12px;font-weight:600;box-shadow:none}
.projects-module .primary-button:hover:not(:disabled){background:#c8ea52}
.projects-module .projects-import-notice{margin-bottom:0;background:#bdeed6;border:0;color:#1f6b46;border-radius:12px}

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

/* register cards */
.projects-module .projects-register{padding:20px 0 6px;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 2px #1c2b2208;overflow:hidden}
.projects-module .projects-heading{padding:0 20px 14px}
.projects-module .projects-heading h3{font-size:16px;font-weight:600;color:var(--ink)}
.projects-module .projects-heading p{color:var(--muted)}
.projects-module .projects-search{border-radius:12px;border:1px solid var(--line);background:#fff;height:38px}
.projects-module .projects-filters select{border-radius:12px;border:1px solid var(--line);height:38px}
.projects-module .cost-filters{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:flex-end}
.projects-module .cost-filters select{border-radius:12px;border:1px solid var(--line);height:38px;background:#fff;color:var(--ink);padding:0 10px;font:inherit;font-size:12px}
.projects-module .cost-by-project-foot{padding:6px 20px 16px}
.projects-module .cost-by-project tbody tr{cursor:pointer}
.projects-module .cost-by-project tbody tr.is-selected{background:#eef8f2}
.projects-module .cost-sub{display:block;margin-top:3px;font-size:10.5px;color:var(--muted)}
.projects-module .cost-pay-title{font-size:13px;font-weight:600;margin:18px 0 8px;color:var(--ink)}
.projects-module .cost-pay{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px;border-radius:12px;background:#f7faf9;margin-bottom:8px;font-size:12px}
.projects-module .cost-pay-info{min-width:0}
.projects-module .cost-pay-info span{display:block;font-size:10.5px;color:var(--muted);margin-top:2px}
.projects-module .cost-pay-end{display:flex;align-items:center;gap:10px;flex-shrink:0}
.projects-module .cost-pay-end strong{white-space:nowrap;font-variant-numeric:tabular-nums}
.projects-module .cost-undo{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:#fff;border-radius:9px;padding:5px 9px;font:inherit;font-size:11.5px;font-weight:600;color:#a63a49;cursor:pointer}
.projects-module .cost-undo:hover{background:#fdf0f2}
.projects-module .cost-pay-due{margin:0 0 14px;padding:12px 14px;border-radius:12px;background:#fde5c4;color:#8a5517;font-size:13px;font-weight:600}
.projects-module .projects-table tr.is-labour-day td:first-child{box-shadow:inset 3px 0 0 #6fd6a0}
.projects-module .labour-day-table{margin-top:14px;border:1px solid var(--line);border-radius:12px;overflow-x:auto}
.projects-module .labour-day-note{margin:10px 0 0}
.projects-module .labour-day-table .projects-table{min-width:0;width:100%}
.projects-module .labour-day-table .projects-table th,.projects-module .labour-day-table .projects-table td{padding:10px 12px}

/* tables (registers and import preview) */
.projects-module .projects-table th{background:transparent;padding:10px 20px;font-size:11px;font-weight:500;letter-spacing:0;color:#8a968f;border-bottom:1px solid var(--line);white-space:nowrap}
.projects-module .projects-table td{padding:14px 20px;font-size:12px;color:#3b4a42;border-top:0;border-bottom:1px solid #f1f4f4}
.projects-module .projects-table tbody tr:last-child td{border-bottom:0}
.projects-module .projects-table tbody tr:hover{background:#f7faf9}
.projects-module .projects-table tr.is-reversed td{opacity:.65}
.projects-module .projects-table strong{font-size:12px;font-weight:600;color:var(--ink)}
.projects-module .money-cell{white-space:nowrap;font-variant-numeric:tabular-nums}
.projects-module .received-cell .progress-track{background:#eef1f1;border-radius:6px}
.projects-module .received-cell .progress-track i{background:#6fd6a0;border-radius:6px}
.projects-module .project-status{padding:5px 10px;font-weight:600;display:inline-flex;align-items:center;gap:5px;border-radius:999px;font-size:11px;white-space:nowrap}
.projects-module .status-active{background:#bdeed6;color:#1f6b46}
.projects-module .status-completed{background:#c9defb;color:#3a66ad}
.projects-module .status-on-hold{background:#fde5c4;color:#a8691f}
.projects-module .status-cancelled{background:#fbd6db;color:#b04a58}
.projects-module .project-row-actions button,.projects-module .projects-close{border-radius:10px;border:1px solid var(--line)}
.projects-module .project-row-actions button:hover,.projects-module .projects-close:hover{background:#f1f5f4;color:var(--ink)}
.projects-module .projects-empty-icon{background:#ebe8fb;color:#6a5bc2;border-radius:14px}

/* pop-ups */
.projects-module .projects-modal{border-radius:18px}
.projects-module .projects-modal-header h3{color:var(--ink)}
.projects-module .projects-field input,.projects-module .projects-field select,.projects-module .projects-field textarea{border-radius:10px;border-color:#e5eaec}
.projects-module .projects-cancel{border-radius:12px;border-color:var(--line)}
.projects-module .projects-dropzone{border-radius:14px}
.projects-module .project-detail-grid{border-radius:12px}
.projects-module .import-badge.new{background:#bdeed6;color:#1f6b46}
.projects-module .import-badge.update{background:#c9defb;color:#3a66ad}
.projects-module .import-badge.error{background:#fbd6db;color:#b04a58}
.projects-module .cost-import-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:12px 0}
.projects-module .cost-sheet-select{border-radius:10px;border:1px solid #e5eaec;padding:5px 8px;font:inherit;font-size:12px;background:#fff}

@media(max-width:1100px){.pj-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:420px){.pj-kpis{grid-template-columns:1fr}}
@media(max-width:600px){.projects-module .projects-table th,.projects-module .projects-table td{padding-left:14px;padding-right:14px}.projects-module .cost-filters{justify-content:flex-start}}
@media(prefers-reduced-motion:reduce){.pj-kpi{transition:none}.pj-kpi:hover{transform:none}}
`;

export default function ProjectCosts() {
  const { isAdmin } = useAccess(); // Viewers see the records but no buttons that change them
  const [costs, setCosts] = useState<ProjectCost[]>(loadCosts);
  const [projects] = useState<ProjectOption[]>(loadProjects);
  const [siteStore] = useState<SiteLabourStore>(loadSiteLabour);
  const siteLabour = siteStore.entries;
  const [viewLabour, setViewLabour] = useState<LabourDayRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CostForm>(blankForm);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [labourFilter, setLabourFilter] = useState('All');
  const [period, setPeriod] = useState('All');
  const [showReversed, setShowReversed] = useState(false);
  const [viewCost, setViewCost] = useState<ProjectCost | null>(null);
  const [payFor, setPayFor] = useState<ProjectCost | null>(null);
  const [pay, setPay] = useState(blankPay);
  const [payError, setPayError] = useState('');
  const [error, setError] = useState('');

  // Excel import
  const [showImport, setShowImport] = useState(false);
  const [importSheets, setImportSheets] = useState<ImportSheet[] | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [importFileName, setImportFileName] = useState('');
  const [importOptions, setImportOptions] = useState<ImportOptions>(defaultImportOptions);
  const [importError, setImportError] = useState('');
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => { localStorage.setItem(COSTS_KEY, JSON.stringify(costs)); }, [costs]);

  // LEDGER: post any existing cost that has no ledger entry yet. Safe to run repeatedly.
  useEffect(() => {
    costs.forEach(c => {
      if (c.reversed) return; // a reversed cost nets to zero, so there is nothing to post
      try { postProjectCost(c); }
      catch (e) { console.error(`Could not post ${c.id} to the ledger:`, e); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCosts = costs.filter(c => !c.reversed);

  // Site labour per project: everything recorded on the Site Labour page, paid or awaiting payment.
  const siteByProject = useMemo(() => {
    const map = new Map<string, { days: number; total: number; paid: number }>();
    siteLabour.forEach(d => {
      const rate = Number(d.rate) || 0;
      const row = map.get(d.projectId) ?? { days: 0, total: 0, paid: 0 };
      row.days += 1; row.total += rate; if (d.paid) row.paid += rate;
      map.set(d.projectId, row);
    });
    return map;
  }, [siteLabour]);
  const site = useMemo(() => [...siteByProject.values()].reduce((s, r) => ({ days: s.days + r.days, total: s.total + r.total, paid: s.paid + r.paid }), { days: 0, total: 0, paid: 0 }), [siteByProject]);
  const labourDays = useMemo(() => {
    const names = new Map(projects.map(p => [p.id, p.projectName]));
    const map = new Map<string, LabourDayRow>();
    siteLabour.forEach(d => {
      const key = `${d.projectId}|${d.date}`;
      const row = map.get(key) ?? { key, projectId: d.projectId, projectName: names.get(d.projectId) ?? d.projectId, date: d.date, activity: siteStore.activities[key] ?? '', workers: [], types: [], amount: 0, paid: 0, createdAt: d.createdAt ?? `${d.date}T00:00:00.000Z` };
      const rate = Number(d.rate) || 0;
      row.workers.push(d); row.amount += rate; if (d.paid) row.paid += rate;
      if (d.category && !row.types.includes(d.category)) row.types.push(d.category);
      if (d.createdAt && d.createdAt < row.createdAt) row.createdAt = d.createdAt;
      map.set(key, row);
    });
    return [...map.values()];
  }, [siteLabour, siteStore.activities, projects]);
  const usedLabourTypes = useMemo(() => [...new Set([...costs.map(c => c.labourType ?? ''), ...labourDays.flatMap(d => d.types)].filter(Boolean))].sort(), [costs, labourDays]);
  const labourOptions = useMemo(() => [...new Set([...LABOUR_TYPES, ...usedLabourTypes])], [usedLabourTypes]);
  const totals = useMemo(() => ({
    total: activeCosts.reduce((s, c) => s + c.amount, 0) + site.total,
    paid: activeCosts.reduce((s, c) => s + c.amountPaid, 0) + site.paid,
    payable: activeCosts.reduce((s, c) => s + Math.max(c.amount - c.amountPaid, 0), 0) + (site.total - site.paid),
    count: activeCosts.length,
    projectsWithCosts: new Set([...activeCosts.map(c => c.projectId), ...siteByProject.keys()]).size,
  }), [costs, site, siteByProject]);

  const paidPct = totals.total > 0 ? Math.round((totals.paid / totals.total) * 100) : 0;

  // Total cost per project (active costs only). Registered projects with no costs show as zero.
  const byProject = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number; total: number; paid: number; siteDays: number; site: number }>();
    projects.forEach(p => map.set(p.id, { id: p.id, name: p.projectName, count: 0, total: 0, paid: 0, siteDays: 0, site: 0 }));
    costs.filter(c => !c.reversed).forEach(c => {
      const row = map.get(c.projectId) ?? { id: c.projectId, name: c.projectName, count: 0, total: 0, paid: 0, siteDays: 0, site: 0 };
      row.count += 1; row.total += c.amount; row.paid += c.amountPaid;
      map.set(c.projectId, row);
    });
    siteByProject.forEach((s, projectId) => {
      const row = map.get(projectId) ?? { id: projectId, name: projectId, count: 0, total: 0, paid: 0, siteDays: 0, site: 0 };
      row.siteDays = s.days; row.site = s.total; row.total += s.total; row.paid += s.paid;
      map.set(projectId, row);
    });
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [costs, projects, siteByProject]);

  const visibleRows = useMemo((): RegisterRow[] => {
    const q = search.trim().toLowerCase();
    const now = new Date();
    const inPeriod = (date: string) => {
      const d = new Date(`${date}T00:00:00`);
      return period === 'All' || (period === 'This month' && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) || (period === 'This year' && d.getFullYear() === now.getFullYear());
    };
    const costRows = costs.filter(c => {
      if (c.reversed !== showReversed) return false;
      const matchesText = !q || [c.id, c.projectName, c.description, c.supplier, c.reference, c.category, c.labourType ?? ''].some(v => v.toLowerCase().includes(q));
      const matchesProject = projectFilter === 'All' || c.projectId === projectFilter;
      const matchesCategory = categoryFilter === 'All' || c.category === categoryFilter;
      const matchesLabour = labourFilter === 'All' || c.labourType === labourFilter;
      return matchesText && matchesProject && matchesCategory && matchesLabour && inPeriod(c.date);
    }).map((cost): RegisterRow => ({ kind: 'cost', cost }));
    // Site labour days are never reversed here (payments are undone on the Site Labour page), so they only show with active costs.
    const labourRows = showReversed ? [] : labourDays.filter(d => {
      const matchesText = !q || ['site labour', 'labour', d.projectName, d.projectId, d.activity, ...d.types, ...d.workers.map(w => w.worker)].some(v => v.toLowerCase().includes(q));
      const matchesProject = projectFilter === 'All' || d.projectId === projectFilter;
      const matchesCategory = categoryFilter === 'All' || categoryFilter === 'Labour';
      const matchesLabour = labourFilter === 'All' || d.types.includes(labourFilter);
      return matchesText && matchesProject && matchesCategory && matchesLabour && inPeriod(d.date);
    }).map((day): RegisterRow => ({ kind: 'labour', day }));
    const dateOf = (r: RegisterRow) => (r.kind === 'cost' ? r.cost.date : r.day.date);
    const createdOf = (r: RegisterRow) => (r.kind === 'cost' ? r.cost.createdAt : r.day.createdAt);
    return [...costRows, ...labourRows].sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || createdOf(b).localeCompare(createdOf(a)));
  }, [costs, labourDays, search, projectFilter, categoryFilter, labourFilter, period, showReversed]);

  // Total of whatever the register is currently showing (follows every filter).
  const filteredTotal = useMemo(() => visibleRows.reduce((s, r) => s + (r.kind === 'cost' ? r.cost.amount : r.day.amount), 0), [visibleRows]);
  const hasAnyRecords = costs.length > 0 || labourDays.length > 0;

  const preview = useMemo(
    () => (importSheets ? buildCostPreview(importSheets[sheetIndex].table, projects, costs, importOptions) : null),
    [importSheets, sheetIndex, projects, costs, importOptions],
  );
  const importable = preview ? preview.counts.new : 0;

  const setField = (key: keyof CostForm, value: string | number) => setForm(old => ({ ...old, [key]: value }));
  const openForm = () => { setForm({ ...blankForm, projectId: projects[0]?.id ?? '', projectName: projects[0]?.projectName ?? '' }); setError(''); setFormOpen(true); };
  const saveCost = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    const project = projects.find(p => p.id === form.projectId);
    if (!project) { setError('Please select a registered project before recording this cost.'); return; }
    if (!form.description.trim()) { setError('Enter a description for this cost.'); return; }
    // LEDGER: whole RWF only
    if (!Number.isInteger(form.amount) || !Number.isInteger(form.amountPaid) || form.amount <= 0 || form.amountPaid < 0 || form.amountPaid > form.amount) {
      setError('Enter whole RWF amounts. Amount paid cannot exceed the total cost.'); return;
    }
    const nextNo = costs.reduce((max, c) => { const m = c.id.match(/^CST-(\d+)$/); return m ? Math.max(max, Number(m[1])) : max; }, 0) + 1;
    const record: ProjectCost = { ...form, labourType: form.category === 'Labour' ? (form.labourType ?? '').trim() : '', projectName: project.projectName, id: `CST-${String(nextNo).padStart(4, '0')}`, reversed: false, createdAt: new Date().toISOString() };
    // LEDGER: post first, so a cost is never saved without its journal entry
    try { postProjectCost(record); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not post to the ledger.'); return; }
    setCosts(old => [record, ...old]); setFormOpen(false); setForm(blankForm);
  };
  const reverseCost = (cost: ProjectCost) => {
    if (cost.reversed) return;
    if (!window.confirm(`Reverse ${cost.id} — ${cost.description}? The record will remain in the audit history.`)) return;
    // LEDGER: post the reversing entry first
    try { reverseProjectCost(cost.id); }
    catch (e) { window.alert(e instanceof Error ? e.message : 'Could not reverse in the ledger.'); return; }
    setCosts(old => old.map(c => c.id === cost.id ? { ...c, reversed: true, reversedAt: new Date().toISOString() } : c));
    setViewCost(null);
  };

  /* ---------- paying a balance later, and undoing a payment ---------- */
  const openPay = (cost: ProjectCost) => { setPay({ ...blankPay(), amount: String(cost.amount - cost.amountPaid) }); setPayError(''); setPayFor(cost); };
  const closePay = () => { setPayFor(null); setPayError(''); };
  const applyPaid = (costId: string, change: number) => {
    setCosts(old => old.map(c => c.id === costId ? { ...c, amountPaid: c.amountPaid + change } : c));
    setViewCost(v => (v && v.id === costId ? { ...v, amountPaid: v.amountPaid + change } : v));
  };
  const savePayment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!payFor) return; setPayError('');
    const amount = Number(pay.amount); const balance = payFor.amount - payFor.amountPaid;
    if (!Number.isInteger(amount) || amount <= 0 || amount > balance) { setPayError(`Enter a whole RWF amount greater than zero and no more than ${money(balance)}.`); return; }
    if (!pay.date) { setPayError('Choose the date the payment was made.'); return; }
    // LEDGER: post first, so the cost is never marked paid without its journal entry
    try {
      postCostPayment({ costId: payFor.id, paymentNo: nextPaymentNo(payFor.id), date: pay.date, supplier: payFor.supplier, amount, method: pay.method, reference: pay.reference.trim() || undefined });
    } catch (e) { setPayError(e instanceof Error ? e.message : 'Could not post the payment to the ledger.'); return; }
    applyPaid(payFor.id, amount);
    setNotice(`Payment of ${money(amount)} recorded for ${payFor.id}.`);
    closePay();
  };
  const undoPayment = (cost: ProjectCost, p: CostPayment) => {
    if (!window.confirm(`Undo the payment of ${money(p.amount)} made on ${p.date}? A reversing entry is posted and the amount becomes due again.`)) return;
    // LEDGER: reverse on the payment's own date, so each period stays correct
    try { ledger.reverse(p.entryId, `Payment for ${cost.id} undone`, p.date); }
    catch (e) { window.alert(e instanceof Error ? e.message : 'Could not undo the payment in the ledger.'); return; }
    applyPaid(cost.id, -p.amount);
    setNotice(`Payment of ${money(p.amount)} for ${cost.id} undone.`);
  };

  /* ---------- Excel import ---------- */
  const resetImport = () => {
    setImportSheets(null); setSheetIndex(0); setImportFileName(''); setImportError('');
    setImportOptions(defaultImportOptions); setReading(false); setDragging(false);
  };
  const openImport = () => { resetImport(); setShowImport(true); };
  const closeImport = () => { setShowImport(false); resetImport(); };
  const setOption = <K extends keyof ImportOptions>(key: K, value: ImportOptions[K]) => setImportOptions(old => ({ ...old, [key]: value }));

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    setImportError(''); setReading(true);
    try {
      const { sheets, best } = await readCostFile(file);
      setImportSheets(sheets); setSheetIndex(best); setImportFileName(file.name);
    } catch (e) {
      setImportSheets(null);
      setImportError(e instanceof Error ? e.message : 'Could not read this file.');
    } finally { setReading(false); }
  };

  const confirmImport = () => {
    if (!preview || importable === 0) return;
    let nextNo = costs.reduce((max, c) => { const m = c.id.match(/^CST-(\d+)$/); return m ? Math.max(max, Number(m[1])) : max; }, 0) + 1;
    const base = Date.now();
    const added: ProjectCost[] = [];
    const failedRows: number[] = [];
    let firstError = '';
    let stopped = false;
    for (const row of preview.rows) {
      if (row.action !== 'new') continue;
      const record: ProjectCost = { ...row.cost, id: `CST-${String(nextNo).padStart(4, '0')}`, reversed: false, createdAt: new Date(base + added.length).toISOString() };
      // LEDGER: post first, so a cost is never saved without its journal entry
      try { postProjectCost(record); added.push(record); nextNo += 1; }
      catch (e) {
        failedRows.push(row.rowNumber);
        if (!firstError) { firstError = e instanceof Error ? e.message : String(e); console.error(`Could not post import row ${row.rowNumber} to the ledger:`, e); }
        // If the first rows all fail, the cause is almost certainly the same for every row: stop instead of trying them all.
        if (added.length === 0 && failedRows.length >= 5) { stopped = true; break; }
      }
    }
    if (added.length) setCosts(old => [...added, ...old]);
    const message = `Imported ${added.length} cost${added.length === 1 ? '' : 's'} from ${importFileName || 'file'}.`
      + (failedRows.length ? ` ${stopped ? `Stopped after ${failedRows.length} rows were rejected by the ledger, so nothing was imported` : `${failedRows.length} could not be posted to the ledger`} (rows ${failedRows.slice(0, 10).join(', ')}${failedRows.length > 10 ? '…' : ''}). Ledger message: "${firstError}"` : '');
    try {
      auditLog.log({
        action: 'costs.imported', entityType: 'project_cost', entityId: importFileName || 'file', summary: message,
        details: { imported: added.length, failed: failedRows.length, skipped: preview.counts.skip, errors: preview.counts.error, ids: added.map(c => c.id) },
      });
    } catch (e) { console.error('Could not write the audit log:', e); }
    setNotice(message);
    closeImport();
  };

  return <section className="projects-module">
    <style>{COSTS_CSS}</style>

    <div className="welcome-row">
      <div>
        <div className="eyebrow">PROJECT FINANCIAL CONTROL</div>
        <h2>Project Cost Tracking</h2>
        <p>Costs and payments for every project.</p>
      </div>
      <div className="projects-header-actions">
        {isAdmin && <button className="projects-secondary-button" onClick={openImport} disabled={projects.length === 0} title={projects.length === 0 ? 'Register a project first' : undefined}><Upload size={16} /> <span>Import from Excel</span></button>}
        {isAdmin && <button className="primary-button" onClick={openForm}><Plus size={16} /> Record cost</button>}
      </div>
    </div>

    {notice && <div className="projects-import-notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}

    <div className="pj-kpis">
      <Metric title="Total recorded costs" value={money(totals.total)} note={`${totals.count} cost record${totals.count === 1 ? '' : 's'}${site.days ? ` + ${site.days} site labour day${site.days === 1 ? '' : 's'}` : ''}`} icon={<TrendingDown size={13} />} tone="blue" />
      <Metric title="Amount paid" value={money(totals.paid)} note={totals.total > 0 ? `${paidPct}% of recorded costs disbursed` : 'Cash already disbursed'} icon={<Wallet size={13} />} tone="green" />
      <Metric title="Outstanding payables" value={money(totals.payable)} note={site.total - site.paid > 0 ? `${money(site.total - site.paid)} is site labour` : 'Recorded costs not yet paid'} icon={<Receipt size={13} />} tone="amber" />
      <Metric title="Projects with costs" value={String(totals.projectsWithCosts)} note={`Out of ${projects.length} registered project${projects.length === 1 ? '' : 's'}`} icon={<FolderKanban size={13} />} tone="blue" />
    </div>

    {byProject.length > 0 && <div className="panel projects-register">
      <div className="panel-heading projects-heading">
        <div><h3>Cost by project</h3></div>
      </div>
      <div className="projects-table-wrap">
        <table className="projects-table cost-by-project">
          <thead><tr><th>Project</th><th>Records</th><th>Total cost</th><th>Paid</th><th>Outstanding</th></tr></thead>
          <tbody>{byProject.map(p => <tr key={p.id} className={projectFilter === p.id ? 'is-selected' : undefined} onClick={() => { setProjectFilter(p.id); setShowReversed(false); }}>
            <td><strong>{p.name}</strong><span className="cost-sub">{p.id}</span></td>
            <td>{p.count}{p.siteDays > 0 && <span className="cost-sub">+ {p.siteDays} labour day{p.siteDays === 1 ? '' : 's'}</span>}</td>
            <td className="money-cell"><strong>{money(p.total)}</strong>{p.site > 0 && <span className="cost-sub">incl. {money(p.site)} site labour</span>}</td>
            <td className="money-cell">{money(p.paid)}</td>
            <td className="money-cell">{money(p.total - p.paid)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {projectFilter !== 'All' && <div className="cost-by-project-foot"><button className="projects-secondary-button" onClick={() => setProjectFilter('All')}>Show all projects</button></div>}
    </div>}

    <div className="panel projects-register">
      <div className="panel-heading projects-heading">
        <div><h3>Cost register</h3><p>{visibleRows.length} record{visibleRows.length === 1 ? '' : 's'} {showReversed ? 'reversed' : 'shown'} · Total {money(filteredTotal)}</p></div>
        <div className="cost-filters">
          <label className="projects-search"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search costs..." /></label>
          <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} aria-label="Filter by project"><option value="All">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.projectName}</option>)}</select>
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} aria-label="Filter by category"><option value="All">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</select>
          {usedLabourTypes.length > 0 && <select value={labourFilter} onChange={e => setLabourFilter(e.target.value)} aria-label="Filter by labour type"><option value="All">All labour types</option>{usedLabourTypes.map(t => <option key={t}>{t}</option>)}</select>}
          <select value={period} onChange={e => setPeriod(e.target.value)} aria-label="Filter by period"><option value="All">All time</option><option>This month</option><option>This year</option></select>
          <button className="projects-secondary-button" onClick={() => setShowReversed(v => !v)}>{showReversed ? <Receipt size={15} /> : <RotateCcw size={15} />} <span>{showReversed ? 'View active costs' : 'View reversed records'}</span></button>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="projects-empty"><div className="projects-empty-icon"><Receipt size={24} /></div><h3>{showReversed ? 'No reversed costs' : hasAnyRecords ? 'No matching costs' : 'No project costs recorded yet'}</h3><p>{showReversed ? 'Reversed records will appear here.' : hasAnyRecords ? 'Try another search term or filter.' : !isAdmin ? 'Costs will appear here once the Admin records them.' : projects.length ? 'No costs yet.' : 'Register a project first. Costs must be assigned to a project.'}</p>{!showReversed && !costs.length && projects.length > 0 && isAdmin && <div className="projects-header-actions" style={{ justifyContent: 'center' }}><button className="projects-secondary-button" onClick={openImport}><Upload size={16} /> <span>Import from Excel</span></button><button className="primary-button" onClick={openForm}><Plus size={16} /> Record first cost</button></div>}</div>
      ) : (
        <div className="projects-table-wrap">
          <table className="projects-table">
            <thead><tr><th>Date / ID</th><th>Project / description</th><th>Category</th><th>Supplier / recipient</th><th>Total cost</th><th>Paid</th><th>Balance</th><th>Status</th><th /></tr></thead>
            <tbody>{visibleRows.map(row => {
              if (row.kind === 'labour') {
                const d = row.day;
                const progress = d.amount > 0 ? Math.min(d.paid / d.amount * 100, 100) : 0;
                return <tr key={`labour-${d.key}`} className="is-labour-day">
                  <td className="money-cell"><strong>{d.date}</strong><span className="cost-sub">Site labour</span></td>
                  <td style={{ minWidth: 180 }}><strong>{d.projectName}</strong><span className="cost-sub">Site labour · {d.workers.length} worker{d.workers.length === 1 ? '' : 's'}{d.activity ? ` · ${d.activity}` : ''}</span></td>
                  <td>Labour{d.types.length > 0 && <span className="cost-sub">{d.types.join(', ')}</span>}</td>
                  <td>{d.workers.length} worker{d.workers.length === 1 ? '' : 's'}</td>
                  <td className="money-cell"><strong>{money(d.amount)}</strong></td>
                  <td><div className="received-cell"><strong>{money(d.paid)}</strong><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><small>{progress.toFixed(0)}% paid</small></div></td>
                  <td className="money-cell">{money(d.amount - d.paid)}</td>
                  <td><span className={`project-status ${labourStatusClass(d)}`}>{labourStatusIcon(d)}{labourStatusOf(d)}</span></td>
                  <td><div className="project-row-actions"><button aria-label={`View site labour for ${d.projectName} on ${d.date}`} title="View workers" onClick={() => setViewLabour(d)}><Eye size={15} /></button></div></td>
                </tr>;
              }
              const c = row.cost;
              const due = c.amount - c.amountPaid;
              const progress = c.amount > 0 ? Math.min(c.amountPaid / c.amount * 100, 100) : 0;
              return <tr key={c.id} className={c.reversed ? 'is-reversed' : undefined}>
                <td className="money-cell"><strong>{c.date}</strong><span className="cost-sub">{c.id}</span></td>
                <td style={{ minWidth: 180 }}><strong>{c.projectName}</strong><span className="cost-sub">{c.description}</span></td>
                <td>{c.category}{c.category === 'Labour' && c.labourType && <span className="cost-sub">{c.labourType}</span>}</td>
                <td>{c.supplier || '—'}</td>
                <td className="money-cell"><strong>{money(c.amount)}</strong></td>
                <td><div className="received-cell"><strong>{money(c.amountPaid)}</strong><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><small>{progress.toFixed(0)}% paid</small></div></td>
                <td className="money-cell">{money(due)}</td>
                <td><span className={`project-status ${statusClass(c)}`}>{statusIcon(c)}{c.reversed ? 'Reversed' : paymentStatusOf(c)}</span></td>
                <td><div className="project-row-actions"><button aria-label={`View ${c.id}`} title="View details" onClick={() => setViewCost(c)}><Eye size={15} /></button>{isAdmin && !c.reversed && due > 0 && <button aria-label={`Record payment for ${c.id}`} title="Record payment" onClick={() => openPay(c)}><CreditCard size={15} /></button>}</div></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </div>

    {formOpen && isAdmin && <div className="projects-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setFormOpen(false); }}>
      <section className="projects-modal" role="dialog" aria-modal="true" aria-labelledby="cost-form-title">
        <div className="projects-modal-header"><div><div className="eyebrow">SITE EXPENDITURE</div><h3 id="cost-form-title">Record project cost</h3></div><button className="projects-close" onClick={() => setFormOpen(false)} aria-label="Close"><X size={19} /></button></div>
        <form onSubmit={saveCost}>
          <div className="projects-form-grid">
            <label className="projects-field field-wide">Project *<select required value={form.projectId} onChange={e => { const p = projects.find(x => x.id === e.target.value); setField('projectId', e.target.value); setField('projectName', p?.projectName ?? ''); }}><option value="">Select project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.projectName} ({p.id})</option>)}</select></label>
            <label className="projects-field">Date *<input required type="date" value={form.date} onChange={e => setField('date', e.target.value)} /></label>
            <label className="projects-field">Cost category *<select value={form.category} onChange={e => setField('category', e.target.value as CostCategory)}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
            {form.category === 'Labour' && <label className="projects-field field-wide">Labour type<input list="labour-types" value={form.labourType ?? ''} onChange={e => setField('labourType', e.target.value)} placeholder="e.g. Masons, Helpers, Foreman, or type your own" /><datalist id="labour-types">{labourOptions.map(t => <option key={t} value={t} />)}</datalist></label>}
            <label className="projects-field field-wide">Description *<input required value={form.description} onChange={e => setField('description', e.target.value)} placeholder="e.g. Cement purchase for foundation works" /></label>
            <label className="projects-field">Supplier / recipient<input value={form.supplier} onChange={e => setField('supplier', e.target.value)} placeholder="Name of supplier or worker" /></label>
            <label className="projects-field">Total cost (RWF) *<input required type="number" min="1" step="1" value={form.amount || ''} onChange={e => setField('amount', Number(e.target.value))} /></label>
            <label className="projects-field">Amount paid (RWF)<input type="number" min="0" step="1" value={form.amountPaid || ''} onChange={e => setField('amountPaid', Number(e.target.value))} /></label>
            <label className="projects-field">Payment method<select value={form.paymentMethod} onChange={e => setField('paymentMethod', e.target.value as PaymentMethod)}>{methods.map(m => <option key={m}>{m}</option>)}</select></label>
            <label className="projects-field field-wide">Payment / invoice reference<input value={form.reference} onChange={e => setField('reference', e.target.value)} placeholder="Receipt, invoice or transfer ref." /></label>
            <label className="projects-field field-wide">Notes<textarea rows={3} value={form.notes} onChange={e => setField('notes', e.target.value)} placeholder="Additional details..." /></label>
          </div>
          {error && <p className="projects-validation" role="alert">{error}</p>}
          <div className="projects-form-actions"><button type="button" className="projects-cancel" onClick={() => setFormOpen(false)}>Cancel</button><button type="submit" className="primary-button"><Plus size={15} /> Save cost record</button></div>
        </form>
      </section>
    </div>}

    {viewCost && <div className="projects-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setViewCost(null); }}>
      <section className="projects-modal project-detail-modal" role="dialog" aria-modal="true" aria-labelledby="cost-detail-title">
        <div className="projects-modal-header"><div><div className="eyebrow">COST RECORD · {viewCost.id}</div><h3 id="cost-detail-title">{viewCost.description}</h3></div><button className="projects-close" onClick={() => setViewCost(null)} aria-label="Close"><X size={19} /></button></div>
        <span className={`project-status ${statusClass(viewCost)}`}>{statusIcon(viewCost)}{viewCost.reversed ? 'Reversed' : paymentStatusOf(viewCost)}</span>
        <div className="project-detail-grid">
          <Detail label="Project" value={viewCost.projectName} /><Detail label="Date" value={viewCost.date} />
          <Detail label="Category" value={viewCost.category} />
          {viewCost.category === 'Labour' && <Detail label="Labour type" value={viewCost.labourType || '—'} />}
          <Detail label="Supplier / recipient" value={viewCost.supplier || '—'} />
          <Detail label="Total cost" value={money(viewCost.amount)} /><Detail label="Amount paid" value={money(viewCost.amountPaid)} />
          <Detail label="Outstanding" value={money(viewCost.amount - viewCost.amountPaid)} />
          <Detail label="Payment method" value={viewCost.paymentMethod} /><Detail label="Reference" value={viewCost.reference || '—'} />
        </div>
        {viewCost.notes && <div className="project-detail-notes"><strong>Notes</strong><p>{viewCost.notes}</p></div>}
        {(() => {
          const later = laterPayments(viewCost.id);
          const atRecording = viewCost.amountPaid - later.reduce((s, p) => s + p.amount, 0);
          if (!later.length && atRecording <= 0) return null;
          return <>
            <h4 className="cost-pay-title">Payments</h4>
            {atRecording > 0 && <div className="cost-pay"><div className="cost-pay-info"><strong>Paid when recorded</strong><span>{viewCost.date} · {viewCost.paymentMethod}</span></div><div className="cost-pay-end"><strong>{money(atRecording)}</strong></div></div>}
            {later.map(p => <div className="cost-pay" key={p.entryId}>
              <div className="cost-pay-info"><strong>Payment</strong><span>{p.date} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</span></div>
              <div className="cost-pay-end"><strong>{money(p.amount)}</strong>{isAdmin && !viewCost.reversed && <button type="button" className="cost-undo" onClick={() => undoPayment(viewCost, p)} aria-label={`Undo payment of ${money(p.amount)} on ${p.date}`}><Undo2 size={13} /> Undo</button>}</div>
            </div>)}
          </>;
        })()}
        {viewCost.reversed && <p className="projects-validation">Reversed on {viewCost.reversedAt ? new Date(viewCost.reversedAt).toLocaleString() : '—'}</p>}
        <div className="projects-form-actions">
          {!viewCost.reversed && isAdmin && <button className="projects-cancel" onClick={() => reverseCost(viewCost)}><Ban size={14} /> Reverse record</button>}
          {!viewCost.reversed && isAdmin && viewCost.amount > viewCost.amountPaid && <button className="projects-cancel" onClick={() => { openPay(viewCost); setViewCost(null); }}><CreditCard size={14} /> Record payment</button>}
          <button className="primary-button" onClick={() => setViewCost(null)}>Close</button>
        </div>
      </section>
    </div>}

    {payFor && isAdmin && <div className="projects-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) closePay(); }}>
      <section className="projects-modal" role="dialog" aria-modal="true" aria-labelledby="cost-pay-title">
        <div className="projects-modal-header"><div><div className="eyebrow">{payFor.id} · {payFor.supplier || payFor.projectName}</div><h3 id="cost-pay-title">Record payment</h3></div><button className="projects-close" onClick={closePay} aria-label="Close"><X size={19} /></button></div>
        <p className="cost-pay-due">Balance due: {money(payFor.amount - payFor.amountPaid)} of {money(payFor.amount)}</p>
        {payError && <p className="projects-validation" role="alert">{payError}</p>}
        <form onSubmit={savePayment} noValidate>
          <div className="projects-form-grid">
            <label className="projects-field">Amount paid (RWF) *<input type="number" min="1" step="1" value={pay.amount} onChange={e => setPay(p => ({ ...p, amount: e.target.value }))} /></label>
            <label className="projects-field">Payment date *<input type="date" value={pay.date} onChange={e => setPay(p => ({ ...p, date: e.target.value }))} /></label>
            <label className="projects-field">Paid through<select value={pay.method} onChange={e => setPay(p => ({ ...p, method: e.target.value as PaymentMethod }))}>{payMethods.map(m => <option key={m}>{m}</option>)}</select></label>
            <label className="projects-field">Reference<input value={pay.reference} onChange={e => setPay(p => ({ ...p, reference: e.target.value }))} placeholder="Receipt or transaction reference" /></label>
          </div>
          <div className="projects-form-actions">
            <button type="button" className="projects-cancel" onClick={closePay}>Cancel</button>
            <button type="submit" className="primary-button"><CreditCard size={15} /> Save payment</button>
          </div>
        </form>
      </section>
    </div>}

    {viewLabour && <div className="projects-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setViewLabour(null); }}>
      <section className="projects-modal project-detail-modal" role="dialog" aria-modal="true" aria-labelledby="labour-detail-title">
        <div className="projects-modal-header"><div><div className="eyebrow">SITE LABOUR · {viewLabour.date}</div><h3 id="labour-detail-title">{viewLabour.projectName}</h3></div><button className="projects-close" onClick={() => setViewLabour(null)} aria-label="Close"><X size={19} /></button></div>
        <span className={`project-status ${labourStatusClass(viewLabour)}`}>{labourStatusIcon(viewLabour)}{labourStatusOf(viewLabour)}</span>
        <div className="project-detail-grid">
          <Detail label="Project" value={viewLabour.projectName} /><Detail label="Date" value={viewLabour.date} />
          <Detail label="Activity" value={viewLabour.activity || '—'} /><Detail label="Workers" value={String(viewLabour.workers.length)} />
          <Detail label="Day total" value={money(viewLabour.amount)} /><Detail label="Paid" value={money(viewLabour.paid)} />
          <Detail label="Awaiting payment" value={money(viewLabour.amount - viewLabour.paid)} />
        </div>
        <div className="projects-table-wrap labour-day-table">
          <table className="projects-table">
            <thead><tr><th>Worker</th><th>Category</th><th>Pay for the day</th><th>Payment</th></tr></thead>
            <tbody>{[...viewLabour.workers].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')).map(w => <tr key={w.id}>
              <td><strong>{w.worker}</strong></td>
              <td>{w.category}</td>
              <td className="money-cell">{money(Number(w.rate) || 0)}</td>
              <td>{w.paid ? <><span className="project-status status-active"><CheckCircle2 size={14} />Paid</span>{(w.paid.method || w.paid.date) && <span className="cost-sub">{[w.paid.method, w.paid.date].filter(Boolean).join(' · ')}</span>}</> : <span className="project-status status-on-hold"><CircleDashed size={14} />Not paid</span>}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="projects-form-actions"><button className="primary-button" onClick={() => setViewLabour(null)}>Close</button></div>
      </section>
    </div>}

    {showImport && isAdmin && <div className="projects-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) closeImport(); }}>
      <section className="projects-modal projects-import-modal" role="dialog" aria-modal="true" aria-labelledby="cost-import-title">
        <div className="projects-modal-header"><div><div className="eyebrow">BULK IMPORT</div><h3 id="cost-import-title">Import costs from Excel</h3></div><button className="projects-close" onClick={closeImport} aria-label="Close"><X size={19} /></button></div>

        {!preview && <>
          <label
            className={`projects-dropzone${dragging ? ' is-dragging' : ''}`}
            htmlFor="cost-import-file"
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); void handleImportFile(e.dataTransfer.files[0]); }}
          >
            <FileSpreadsheet size={30} />
            <strong>{reading ? 'Reading file...' : 'Choose an Excel file or drop it here'}</strong>
            <span>.xlsx or .csv. Each row is one cost. Headers such as Date, Project ID, Category, Description, Supplier, Total Cost, Amount Paid and Payment Method are recognised. Files with separate Labour Cost, Material Cost, Equipment Cost and Other Cost columns also work.</span>
            <input id="cost-import-file" type="file" accept=".xlsx,.csv" hidden onChange={e => { void handleImportFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {importError && <p className="projects-validation" role="alert">{importError}</p>}
          <div className="projects-import-help">
            <button type="button" className="text-button" onClick={downloadCostTemplate}><Download size={14} /> Download a template</button>
            <span>Nothing is saved until you confirm on the next screen.</span>
          </div>
        </>}

        {preview && importSheets && <>
          <div className="projects-import-file"><FileSpreadsheet size={16} /><strong>{importFileName}</strong>
            {importSheets.length > 1 && <select className="cost-sheet-select" value={sheetIndex} onChange={e => setSheetIndex(Number(e.target.value))} aria-label="Sheet">{importSheets.map((s, i) => <option key={s.name} value={i}>Sheet: {s.name}</option>)}</select>}
            <button type="button" className="text-button" onClick={resetImport}>Choose another file</button></div>

          {preview.fatal ? <p className="projects-validation" role="alert">{preview.fatal}</p> : <>
            <div className="projects-import-columns"><span>Columns found:</span>{preview.columns.map(c => <i key={c}>{c}</i>)}</div>

            <div className="cost-import-options">
              <label className="projects-field">When no amount paid is given
                <select value={importOptions.paidDefault} onChange={e => setOption('paidDefault', e.target.value as ImportOptions['paidDefault'])}>
                  <option value="paid">Treat as fully paid</option><option value="unpaid">Treat as unpaid (adds to payables)</option>
                </select></label>
              <label className="projects-field">When no payment method is given
                <select value={importOptions.defaultMethod} onChange={e => setOption('defaultMethod', e.target.value as ImportMethod)}>{methods.map(m => <option key={m}>{m}</option>)}</select></label>
              <label className="projects-field">Rows with no project go to
                <select value={importOptions.fallbackProjectId} onChange={e => setOption('fallbackProjectId', e.target.value)}>
                  <option value="">Report an error</option>{projects.map(p => <option key={p.id} value={p.id}>{p.projectName} ({p.id})</option>)}</select></label>
              <label className="projects-field">Rows with no valid date use
                <input type="date" value={importOptions.fallbackDate} onChange={e => setOption('fallbackDate', e.target.value)} /></label>
            </div>

            <div className="projects-import-summary">
              <span className="import-badge new">{preview.counts.new} new</span>
              <span className="import-badge skip">{preview.counts.skip} already recorded</span>
              <span className="import-badge error">{preview.counts.error} with errors</span>
            </div>

            <div className="projects-import-table-wrap">
              <table className="projects-table projects-import-table">
                <thead><tr><th>Row</th><th>Action</th><th>Date</th><th>Project</th><th>Category</th><th>Description</th><th>Total</th><th>Paid</th><th>Checks</th></tr></thead>
                <tbody>{preview.rows.slice(0, PREVIEW_LIMIT).map(row => <tr key={row.key} className={`import-row-${row.action}`}>
                  <td>{row.rowNumber}</td>
                  <td><span className={`import-badge ${row.action}`}>{importActionLabel[row.action]}</span></td>
                  <td>{row.cost.date || '—'}</td>
                  <td><strong>{row.cost.projectName || '—'}</strong><div className="import-sub">{row.cost.projectId}</div></td>
                  <td>{row.cost.category}{row.cost.labourType && <div className="import-sub">{row.cost.labourType}</div>}</td>
                  <td>{row.cost.description}</td>
                  <td className="money-cell">{money(row.cost.amount)}</td>
                  <td className="money-cell">{money(row.cost.amountPaid)}</td>
                  <td>{row.messages.length === 0 ? <span className="import-ok">OK</span> : row.messages.map((m, i) => <div key={i} className={`import-msg ${m.level}`}>{m.text}</div>)}</td>
                </tr>)}</tbody>
              </table>
            </div>
            {preview.rows.length > PREVIEW_LIMIT && <p className="import-sub">Showing the first {PREVIEW_LIMIT} of {preview.rows.length} rows. All rows are checked and imported.</p>}
            {preview.counts.error > 0 && <p className="projects-validation">Rows with errors will not be imported. Fix them in Excel and upload the file again (already recorded rows are skipped), or import the good rows now and add the others with "Record cost".</p>}
          </>}

          <div className="projects-form-actions">
            <button type="button" className="projects-cancel" onClick={closeImport}>Cancel</button>
            {!preview.fatal && <button type="button" className="primary-button" disabled={importable === 0} onClick={confirmImport}>Import {importable} cost{importable === 1 ? '' : 's'}</button>}
          </div>
        </>}
      </section>
    </div>}
  </section>;
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

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="project-detail-item"><span>{label}</span><strong>{value}</strong></div>;
}
