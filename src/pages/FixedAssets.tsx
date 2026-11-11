import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Plus, X, Search, Pencil, Trash2, Forklift, Banknote, TrendingDown, Wallet, HandCoins, Undo2 } from 'lucide-react';
import { auditLog } from '../lib/ledger';
import { useAccess } from '../lib/access';
import {
  ASSETS_KEY, ASSET_CATEGORIES, PAID_WITH, assetValues, depreciationSchedule, isDisposed, readAssets, syncFixedAssets,
} from '../lib/fixedAssets';
import type { AssetCategory, AssetStatus, FixedAsset, MoneyMethod, PaidWith } from '../lib/fixedAssets';

type AssetForm = {
  name: string; category: AssetCategory; purchaseDate: string; cost: number; supplier: string; serialNumber: string;
  location: string; usefulLifeYears: number; residualValue: number; paidWith: PaidWith; momoFee: number; status: 'In use' | 'Under repair'; notes: string;
};
type DisposalForm = { kind: 'Sold' | 'Written off'; date: string; amount: number; method: MoneyMethod };

const METHODS: MoneyMethod[] = ['Bank transfer', 'Cash', 'Mobile money'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const prettyDate = (value?: string) => {
  if (!value) return '—';
  const [y, m, d] = value.split('-').map(Number);
  return m >= 1 && m <= 12 ? `${pad(d)} ${MONTHS[m - 1]} ${y}` : value;
};
const money = (n: number) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0);
const whole = (n: number) => Number.isInteger(n) && n >= 0;
const audit = (action: string, entityId: string, summary: string, details: Record<string, unknown> = {}) => {
  try { auditLog.log({ action, entityType: 'fixed_asset', entityId, summary, details }); }
  catch (e) { console.error('Could not write the audit log:', e); }
};
const statusClass = (s: AssetStatus) => s.toLowerCase().replace(/\s+/g, '-');

const blankForm = (): AssetForm => ({
  name: '', category: 'Machinery & equipment', purchaseDate: todayIso(), cost: 0, supplier: '', serialNumber: '',
  location: '', usefulLifeYears: 5, residualValue: 0, paidWith: 'Bank transfer', momoFee: 0, status: 'In use', notes: '',
});

/**
 * Page styles live here so this page is a single file. They mirror the Projects page and are
 * scoped under .projects-module, so they restyle this page (and its pop-ups) only.
 */
const ASSETS_CSS = `
.projects-module{--lime:#d5f56b;--lime-ink:#1d2b12;--ink:#1c2b22;--muted:#7d8a83;--line:#edf0f1;display:flex;flex-direction:column;gap:22px;color:var(--ink)}
.projects-module button:focus-visible{outline:2px solid #2f8f6b;outline-offset:2px}

/* header */
.projects-module .welcome-row{margin-bottom:0;gap:20px;flex-wrap:wrap;align-items:flex-end}
.projects-module .welcome-row h2{font-size:28px;font-weight:700;letter-spacing:-.4px;margin:6px 0 4px;color:var(--ink)}
.projects-module .welcome-row p{font-size:13px;color:var(--muted)}
.projects-module .primary-button{height:39px;border-radius:12px;background:var(--lime);color:var(--lime-ink);font-size:12px;font-weight:600;box-shadow:none}
.projects-module .primary-button:hover{background:#c8ea52}
.projects-module .projects-secondary-button{height:39px;border-radius:12px;border:1px solid var(--line);background:#fff;color:var(--ink);font-weight:600}
.projects-module .projects-secondary-button:hover{background:#f4f7f6}
.projects-module .projects-import-notice{margin-bottom:0;background:#bdeed6;border:0;color:#1f6b46;border-radius:12px}

/* pastel KPI cards */
.pj-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.pj-kpi{--bg:#bdeed6;--fg:#1f7a4f;display:flex;flex-direction:column;background:var(--bg);border-radius:16px;padding:14px 16px 16px;text-align:center;container-type:inline-size;transition:transform .15s ease,box-shadow .15s ease}
.pj-kpi:hover{transform:translateY(-1px);box-shadow:0 8px 20px #1c2b2214}
.pj-kpi.tone-green{--bg:#bdeed6;--fg:#1f7a4f}
.pj-kpi.tone-blue{--bg:#c9defb;--fg:#3a66ad}
.pj-kpi.tone-amber{--bg:#fde5c4;--fg:#a8691f}
.pj-kpi.tone-violet{--bg:#ebe8fb;--fg:#6a5bc2}
.pj-kpi-top{display:flex;align-items:center;gap:8px;min-height:24px}
.pj-kpi-icon{width:22px;height:22px;border-radius:50%;background:#ffffffb3;color:var(--fg);display:grid;place-items:center;flex-shrink:0}
.pj-kpi-label{font-size:11px;font-weight:600;color:#3d4a43;line-height:1.3;text-align:left}
.pj-kpi-value{font-weight:700;font-size:clamp(16px,10.5cqw,26px);letter-spacing:-.4px;color:var(--ink);margin:16px 0 6px;white-space:nowrap;font-variant-numeric:tabular-nums}
.pj-kpi-note{font-size:10.5px;color:#4f5d55;margin-top:auto;line-height:1.45}

/* register */
.projects-module .projects-register{padding:20px 0 6px;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 2px #1c2b2208;overflow:hidden}
.projects-module .projects-heading{padding:0 20px 14px}
.projects-module .projects-heading h3{font-size:16px;font-weight:600;color:var(--ink)}
.projects-module .projects-heading p{color:var(--muted)}
.projects-module .projects-search{border-radius:12px;border:1px solid var(--line);background:#fff;height:38px}
.projects-module .projects-filters select{border-radius:12px;border:1px solid var(--line);height:38px}
.projects-module .projects-table th{background:transparent;padding:10px 20px;font-size:11px;font-weight:500;letter-spacing:0;color:#8a968f;border-bottom:1px solid var(--line);white-space:nowrap}
.projects-module .projects-table td{padding:14px 20px;font-size:12px;color:#3b4a42;border-top:0;border-bottom:1px solid #f1f4f4}
.projects-module .projects-table tbody tr:last-child td{border-bottom:0}
.projects-module .projects-table tbody tr:hover{background:#f7faf9}
.projects-module .projects-table .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.projects-module .projects-table tfoot td{background:#eef8f2;font-weight:700;color:var(--ink);border-bottom:0}
.projects-module .fa-name{border:0;background:transparent;padding:0;text-align:left;cursor:pointer;font:inherit}
.projects-module .fa-name strong{display:block;font-size:12px;font-weight:600;color:var(--ink)}
.projects-module .fa-name:hover strong{text-decoration:underline}
.projects-module .fa-sub{display:block;margin-top:3px;font-size:10.5px;color:var(--muted)}
.projects-module .fa-status{display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}
.projects-module .fa-status.in-use{background:#bdeed6;color:#1f6b46}
.projects-module .fa-status.under-repair{background:#fde5c4;color:#a8691f}
.projects-module .fa-status.sold{background:#c9defb;color:#3a66ad}
.projects-module .fa-status.written-off{background:#eceff0;color:#6b776f}
.projects-module .fa-actions{display:inline-flex;gap:6px}
.projects-module .fa-actions button{width:30px;height:30px;border-radius:10px;border:1px solid var(--line);background:#fff;display:grid;place-items:center;color:#4f5d55;cursor:pointer}
.projects-module .fa-actions button:hover{background:#f1f5f4;color:var(--ink)}
.projects-module .projects-empty-icon{background:#ebe8fb;color:#6a5bc2;border-radius:14px}
.projects-module .fa-note{padding:14px 16px;border-radius:14px;background:#eef8f2;color:#3f5a4c;font-size:11.5px;line-height:1.6}

/* pop-ups */
.projects-module .projects-modal{border-radius:18px}
.projects-module .projects-modal-header h3{color:var(--ink)}
.projects-module .projects-field input,.projects-module .projects-field select,.projects-module .projects-field textarea{border-radius:10px;border-color:#e5eaec}
.projects-module .projects-cancel{border-radius:12px;border-color:var(--line)}
.projects-module .projects-close{border-radius:10px;border:1px solid var(--line)}
.projects-module .projects-close:hover{background:#f1f5f4;color:var(--ink)}
.projects-module .fa-help{margin:0;font-size:11px;color:var(--muted);line-height:1.5}
.projects-module .fa-info{margin:0 0 14px;padding:12px 14px;border-radius:12px;background:#eef8f2;color:#1f6b46;font-size:12px;line-height:1.6}
.projects-module .fa-split{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:18px;flex-wrap:wrap}
.projects-module .fa-split .group{display:flex;gap:10px;margin-left:auto;flex-wrap:wrap}
.projects-module .fa-danger{color:#b04a58}
.projects-module .fa-detail{width:min(720px,100%)}
.projects-module .fa-detail-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:14px 0}
.projects-module .fa-detail-grid div{padding:10px 12px;border-radius:12px;background:#f7faf9}
.projects-module .fa-detail-grid span{display:block;font-size:10.5px;color:var(--muted)}
.projects-module .fa-detail-grid strong{display:block;margin-top:3px;font-size:12.5px;color:var(--ink)}
.projects-module .fa-schedule{width:100%;border-collapse:collapse;margin-top:6px}
.projects-module .fa-schedule th{padding:8px 10px;font-size:11px;font-weight:500;color:#8a968f;text-align:left;border-bottom:1px solid var(--line)}
.projects-module .fa-schedule td{padding:9px 10px;font-size:12px;color:#3b4a42;border-bottom:1px solid #f1f4f4}
.projects-module .fa-schedule .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.projects-module .fa-schedule .pending td{color:var(--muted)}
.projects-module .fa-h4{margin:16px 0 4px;font-size:13px;font-weight:600;color:var(--ink)}

@media(max-width:1100px){.pj-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:420px){.pj-kpis{grid-template-columns:1fr}}
@media(max-width:640px){
.projects-module{gap:16px}
.projects-module .welcome-row{display:flex;flex-direction:column;align-items:stretch;gap:14px}
.projects-module .welcome-row h2{font-size:24px}
.projects-module .welcome-row .projects-header-actions>button{flex:1 1 0;justify-content:center}
.pj-kpis{gap:10px}
.pj-kpi{padding:12px 12px 14px}
.pj-kpi-value{font-size:clamp(14px,11cqw,20px);margin:12px 0 4px}
.projects-module .projects-heading{display:flex;flex-direction:column;align-items:stretch;gap:12px;padding:0 14px 12px}
.projects-module .projects-filters{display:flex;gap:8px;width:100%;flex-wrap:wrap}
.projects-module .projects-search{flex:1 1 100%;min-width:0;display:flex;align-items:center;gap:6px;padding:0 10px}
.projects-module .projects-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:12px}
.projects-module .projects-filters select{flex:1 1 0;min-width:0}
.projects-module .projects-table th,.projects-module .projects-table td{padding-left:14px;padding-right:14px}
.projects-module .projects-modal-backdrop{padding:10px}
.projects-module .projects-modal{width:100%;max-width:100%;max-height:calc(100vh - 20px);overflow-y:auto;padding:18px 16px}
.projects-module .projects-form-grid{grid-template-columns:1fr}
.projects-module .projects-form-grid .field-wide{grid-column:auto}
.projects-module .fa-detail-grid{grid-template-columns:1fr 1fr}
.projects-module .fa-split .group{width:100%}
.projects-module .fa-split .group>button,.projects-module .fa-split>button{flex:1 1 auto;justify-content:center}
}
@media(prefers-reduced-motion:reduce){.pj-kpi{transition:none}.pj-kpi:hover{transform:none}}
`;

export default function FixedAssets() {
  const { isAdmin } = useAccess(); // Viewers see the register but cannot change it
  const today = todayIso();
  const thisYear = Number(today.slice(0, 4));
  const [assets, setAssets] = useState<FixedAsset[]>(readAssets);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('Owned');
  const [notice, setNotice] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FixedAsset | null>(null);
  const [form, setForm] = useState<AssetForm>(blankForm);
  const [formError, setFormError] = useState('');

  const [selected, setSelected] = useState<FixedAsset | null>(null);
  const [disposing, setDisposing] = useState<FixedAsset | null>(null);
  const [disposal, setDisposal] = useState<DisposalForm>({ kind: 'Sold', date: today, amount: 0, method: 'Bank transfer' });
  const [disposalError, setDisposalError] = useState('');
  const [syncError, setSyncError] = useState('');

  useEffect(() => { localStorage.setItem(ASSETS_KEY, JSON.stringify(assets)); }, [assets]);

  // LEDGER: purchases, yearly depreciation and disposals follow the register. Admins only, as it writes to the ledger.
  useEffect(() => {
    if (!isAdmin) return;
    try { syncFixedAssets(assets); setSyncError(''); }
    catch (e) { setSyncError(e instanceof Error ? e.message : 'Could not update the ledger.'); }
  }, [assets, isAdmin]);

  const rows = useMemo(() => assets.map((a) => ({ asset: a, ...assetValues(a, today) })), [assets, today]);
  const owned = rows.filter((r) => !isDisposed(r.asset));
  const totals = {
    cost: owned.reduce((s, r) => s + r.asset.cost, 0),
    depreciated: owned.reduce((s, r) => s + r.depreciated, 0),
    bookValue: owned.reduce((s, r) => s + r.bookValue, 0),
    dueThisYear: owned.reduce((s, r) => s + r.dueThisYear, 0),
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(({ asset: a }) => {
      const matchesSearch = !q || [a.name, a.id, a.supplier, a.serialNumber, a.location, a.category].some((v) => v.toLowerCase().includes(q));
      const matchesCategory = categoryFilter === 'All' || a.category === categoryFilter;
      const matchesStatus = statusFilter === 'All' || (statusFilter === 'Owned' ? !isDisposed(a) : a.status === statusFilter);
      return matchesSearch && matchesCategory && matchesStatus;
    }).sort((x, y) => y.asset.purchaseDate.localeCompare(x.asset.purchaseDate));
  }, [rows, search, categoryFilter, statusFilter]);

  /* ---------- add / edit ---------- */
  const openAdd = () => { setEditing(null); setForm(blankForm()); setFormError(''); setFormOpen(true); };
  const openEdit = (a: FixedAsset) => {
    setEditing(a);
    setForm({
      name: a.name, category: a.category, purchaseDate: a.purchaseDate, cost: a.cost, supplier: a.supplier, serialNumber: a.serialNumber,
      location: a.location, usefulLifeYears: a.usefulLifeYears, residualValue: a.residualValue, paidWith: a.paidWith, momoFee: a.momoFee ?? 0,
      status: a.status === 'Under repair' ? 'Under repair' : 'In use', notes: a.notes,
    });
    setFormError(''); setSelected(null); setFormOpen(true);
  };
  const setField = <K extends keyof AssetForm>(key: K, value: AssetForm[K]) => setForm((old) => ({ ...old, [key]: value }));

  const saveAsset = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFormError('');
    const name = form.name.trim();
    if (!name) { setFormError('Enter the asset name.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.purchaseDate)) { setFormError('Choose the purchase date.'); return; }
    if (form.purchaseDate > today) { setFormError('The purchase date cannot be in the future.'); return; }
    if (!whole(form.cost) || form.cost <= 0) { setFormError('Enter the cost in whole RWF.'); return; }
    if (!(form.usefulLifeYears > 0 && form.usefulLifeYears <= 50)) { setFormError('Enter a useful life between 1 and 50 years.'); return; }
    if (!whole(form.residualValue) || form.residualValue >= form.cost) { setFormError('The value at the end of its life must be less than the cost.'); return; }
    if (form.paidWith === 'Mobile money' && !whole(form.momoFee)) { setFormError('Enter the mobile money fee in whole RWF, or leave it empty.'); return; }
    if (editing && isDisposed(editing) && editing.disposalDate && form.purchaseDate > editing.disposalDate) { setFormError('The purchase date cannot be after the date it was sold or written off.'); return; }
    const details = {
      name, category: form.category, purchaseDate: form.purchaseDate, cost: form.cost, supplier: form.supplier.trim(),
      serialNumber: form.serialNumber.trim(), location: form.location.trim(), usefulLifeYears: form.usefulLifeYears,
      residualValue: form.residualValue, paidWith: form.paidWith, notes: form.notes.trim(),
      ...(form.paidWith === 'Mobile money' && form.momoFee > 0 ? { momoFee: form.momoFee } : { momoFee: undefined }),
    };
    if (editing) {
      setAssets((old) => old.map((a) => (a.id === editing.id ? { ...a, ...details, status: isDisposed(a) ? a.status : form.status } : a)));
      audit('fixed_asset.updated', editing.id, `Updated fixed asset ${name}`, { before: editing, after: details });
      setNotice(`${name} updated. The books follow the change.`);
    } else {
      const next = assets.reduce((max, a) => { const m = a.id.match(/^FA-(\d+)$/); return m ? Math.max(max, Number(m[1])) : max; }, 0) + 1;
      const record: FixedAsset = { id: `FA-${String(next).padStart(3, '0')}`, ...details, status: form.status, createdAt: new Date().toISOString() };
      setAssets((old) => [...old, record]);
      audit('fixed_asset.added', record.id, `Added fixed asset ${name}`, { cost: record.cost, paidWith: record.paidWith, purchaseDate: record.purchaseDate });
      setNotice(`${name} added to the register.`);
    }
    setFormOpen(false);
  };

  const deleteAsset = () => {
    if (!editing) return;
    if (!window.confirm(`Delete ${editing.name}? Only do this for an asset recorded by mistake. Its purchase and depreciation are reversed in the books.`)) return;
    setAssets((old) => old.filter((a) => a.id !== editing.id));
    audit('fixed_asset.deleted', editing.id, `Deleted fixed asset ${editing.name}`, { cost: editing.cost });
    setNotice(`${editing.name} deleted.`);
    setFormOpen(false);
  };

  /* ---------- sell / write off ---------- */
  const openDisposal = (a: FixedAsset) => {
    setDisposing(a); setSelected(null); setDisposalError('');
    setDisposal({ kind: 'Sold', date: today, amount: 0, method: 'Bank transfer' });
  };
  const saveDisposal = () => {
    if (!disposing) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(disposal.date)) { setDisposalError('Choose the date.'); return; }
    if (disposal.date < disposing.purchaseDate) { setDisposalError('The date cannot be before the purchase date.'); return; }
    if (disposal.date > today) { setDisposalError('The date cannot be in the future.'); return; }
    if (disposal.kind === 'Sold' && (!whole(disposal.amount) || disposal.amount <= 0)) { setDisposalError('Enter the price received in whole RWF.'); return; }
    const sold = disposal.kind === 'Sold';
    setAssets((old) => old.map((a) => (a.id === disposing.id
      ? { ...a, status: disposal.kind, disposalDate: disposal.date, disposalAmount: sold ? disposal.amount : 0, disposalMethod: sold ? disposal.method : undefined }
      : a)));
    audit(sold ? 'fixed_asset.sold' : 'fixed_asset.written_off', disposing.id, `${sold ? 'Sold' : 'Wrote off'} ${disposing.name}`, { date: disposal.date, amount: sold ? disposal.amount : 0 });
    setNotice(`${disposing.name} ${sold ? 'sold' : 'written off'}.`);
    setDisposing(null);
  };
  const undoDisposal = (a: FixedAsset) => {
    if (!window.confirm(`Undo the ${a.status === 'Sold' ? 'sale' : 'write-off'} of ${a.name}? It goes back to "In use" and the entries are reversed.`)) return;
    setAssets((old) => old.map((x) => (x.id === a.id ? { ...x, status: 'In use', disposalDate: undefined, disposalAmount: undefined, disposalMethod: undefined } : x)));
    audit('fixed_asset.disposal_undone', a.id, `Undid the ${a.status === 'Sold' ? 'sale' : 'write-off'} of ${a.name}`);
    setSelected(null);
  };

  /* ---------- preview for the disposal window ---------- */
  const disposalPreview = useMemo(() => {
    if (!disposing || !/^\d{4}-\d{2}-\d{2}$/.test(disposal.date) || disposal.date < disposing.purchaseDate) return null;
    const test: FixedAsset = { ...disposing, status: disposal.kind, disposalDate: disposal.date, disposalAmount: disposal.kind === 'Sold' ? disposal.amount : 0 };
    const v = assetValues(test, disposal.date);
    return { depreciated: v.depreciatedAtDisposal, bookValue: disposing.cost - v.depreciatedAtDisposal, result: v.gainOrLoss };
  }, [disposing, disposal]);

  const detail = selected ? rows.find((r) => r.asset.id === selected.id) : undefined;
  const schedule = detail ? depreciationSchedule(detail.asset, today) : [];

  return (
    <section className="projects-module">
      <style>{ASSETS_CSS}</style>

      <div className="welcome-row">
        <div><div className="eyebrow">FINANCE</div><h2>Fixed Assets</h2><p>Equipment and other assets the company owns, and their value after depreciation.</p></div>
        {isAdmin && <div className="projects-header-actions"><button type="button" className="primary-button" onClick={openAdd}><Plus size={16} /> Add asset</button></div>}
      </div>

      {notice && <div className="projects-import-notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
      {syncError && <p className="projects-validation" role="alert">The books could not be updated: {syncError}</p>}

      <div className="pj-kpis">
        <Metric title="Assets owned" value={String(owned.length)} note={`${rows.length - owned.length} sold or written off`} icon={<Forklift size={13} />} tone="blue" />
        <Metric title="Total cost" value={money(totals.cost)} note="What the owned assets cost" icon={<Banknote size={13} />} tone="blue" />
        <Metric title="Depreciation to date" value={money(totals.depreciated)} note={`${money(totals.dueThisYear)} to be recorded on 31 Dec ${thisYear}`} icon={<TrendingDown size={13} />} tone="amber" />
        <Metric title="Book value" value={money(totals.bookValue)} note="Cost less depreciation to date" icon={<Wallet size={13} />} tone="green" />
      </div>

      <div className="panel projects-register">
        <div className="panel-heading projects-heading">
          <div><h3>Asset register</h3><p>{filtered.length} asset{filtered.length === 1 ? '' : 's'} displayed</p></div>
          <div className="projects-filters">
            <label className="projects-search"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assets..." /></label>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter by category">
              <option value="All">All categories</option>{ASSET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
              <option value="Owned">Owned</option><option>In use</option><option>Under repair</option><option>Sold</option><option>Written off</option><option value="All">All</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="projects-empty">
            <div className="projects-empty-icon"><Forklift size={24} /></div>
            <h3>{assets.length ? 'No matching assets' : 'No assets recorded yet'}</h3>
            <p>{assets.length ? 'Try another search term or filter.' : isAdmin ? 'Add the equipment the company owns, including what it owned before using this system.' : 'Assets will appear here once the Admin adds them.'}</p>
            {!assets.length && isAdmin && <div className="projects-header-actions" style={{ justifyContent: 'center' }}><button type="button" className="primary-button" onClick={openAdd}><Plus size={16} /> Add first asset</button></div>}
          </div>
        ) : (
          <div className="projects-table-wrap">
            <table className="projects-table">
              <thead><tr><th>Asset</th><th>Bought</th><th className="num">Cost</th><th className="num">Depreciation to date</th><th className="num">Book value</th><th>Status</th>{isAdmin && <th />}</tr></thead>
              <tbody>{filtered.map(({ asset: a, depreciated, bookValue }) => {
                const gone = isDisposed(a);
                return <tr key={a.id}>
                  <td><button type="button" className="fa-name" onClick={() => setSelected(a)}><strong>{a.name}</strong><span className="fa-sub">{a.id} · {a.category}{a.location ? ` · ${a.location}` : ''}</span></button></td>
                  <td>{prettyDate(a.purchaseDate)}{a.paidWith === 'Owned before the system' && <span className="fa-sub">Before the system</span>}</td>
                  <td className="num">{money(a.cost)}</td>
                  <td className="num">{gone ? '—' : money(depreciated)}</td>
                  <td className="num"><strong>{gone ? '—' : money(bookValue)}</strong></td>
                  <td><span className={`fa-status ${statusClass(a.status)}`}>{a.status}</span>{gone && <span className="fa-sub">{prettyDate(a.disposalDate)}</span>}</td>
                  {isAdmin && <td><div className="fa-actions">
                    <button type="button" onClick={() => openEdit(a)} title="Edit" aria-label={`Edit ${a.name}`}><Pencil size={14} /></button>
                    {!gone && <button type="button" onClick={() => openDisposal(a)} title="Sell or write off" aria-label={`Sell or write off ${a.name}`}><HandCoins size={14} /></button>}
                  </div></td>}
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </div>

      <div className="fa-note">
        <strong>How it is recorded:</strong> buying an asset adds it to Equipment &amp; Assets and takes the money from the account it was paid from
        (assets owned before the system take no money). Depreciation is recorded once a year on 31 December, spread evenly over the useful life;
        the first year counts only the months owned. Selling or writing off records the depreciation up to that month and any gain or loss.
      </div>

      {/* ---------- add / edit ---------- */}
      {formOpen && isAdmin && <div className="projects-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setFormOpen(false); }}>
        <section className="projects-modal" role="dialog" aria-modal="true" aria-labelledby="fa-form-title">
          <div className="projects-modal-header"><div><div className="eyebrow">{editing ? editing.id : 'NEW ASSET'}</div><h3 id="fa-form-title">{editing ? 'Edit asset' : 'Add asset'}</h3></div><button className="projects-close" onClick={() => setFormOpen(false)} aria-label="Close"><X size={19} /></button></div>
          <form onSubmit={saveAsset}>
            <div className="projects-form-grid">
              <label className="projects-field field-wide">Asset name *<input required value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="e.g. Concrete mixer 350L" /></label>
              <label className="projects-field">Category<select value={form.category} onChange={(e) => setField('category', e.target.value as AssetCategory)}>{ASSET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="projects-field">Purchase date *<input type="date" max={today} value={form.purchaseDate} onChange={(e) => setField('purchaseDate', e.target.value)} /></label>
              <label className="projects-field">Cost (RWF) *<input type="number" min="1" step="1" value={form.cost || ''} onChange={(e) => setField('cost', Number(e.target.value))} /></label>
              <label className="projects-field">Paid with<select value={form.paidWith} onChange={(e) => setField('paidWith', e.target.value as PaidWith)}>{PAID_WITH.map((m) => <option key={m}>{m}</option>)}</select></label>
              {form.paidWith === 'Mobile money' && <label className="projects-field">Mobile money fee (RWF)<input type="number" min="0" step="1" value={form.momoFee || ''} onChange={(e) => setField('momoFee', Number(e.target.value))} placeholder="Optional" /></label>}
              <label className="projects-field">Useful life (years) *<input type="number" min="1" max="50" step="1" value={form.usefulLifeYears || ''} onChange={(e) => setField('usefulLifeYears', Number(e.target.value))} /></label>
              <label className="projects-field">Value at the end of its life (RWF)<input type="number" min="0" step="1" value={form.residualValue || ''} onChange={(e) => setField('residualValue', Number(e.target.value))} placeholder="Usually 0" /></label>
              <label className="projects-field">Supplier<input value={form.supplier} onChange={(e) => setField('supplier', e.target.value)} placeholder="Who it was bought from" /></label>
              <label className="projects-field">Serial / plate number<input value={form.serialNumber} onChange={(e) => setField('serialNumber', e.target.value)} placeholder="Optional" /></label>
              <label className="projects-field">Location<input value={form.location} onChange={(e) => setField('location', e.target.value)} placeholder="Site, project or office" /></label>
              {!(editing && isDisposed(editing)) && <label className="projects-field">Status<select value={form.status} onChange={(e) => setField('status', e.target.value as 'In use' | 'Under repair')}><option>In use</option><option>Under repair</option></select></label>}
              <label className="projects-field field-wide">Notes<textarea rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)} /></label>
            </div>
            {form.cost > 0 && form.usefulLifeYears > 0 && form.residualValue < form.cost && <p className="fa-help" style={{ marginTop: 10 }}>Depreciation: {money(Math.round((form.cost - form.residualValue) / form.usefulLifeYears))} a year, recorded on 31 December.{form.paidWith === 'Owned before the system' ? ' No money is taken from cash or bank; past years’ depreciation is recorded on their own 31 December.' : ''}</p>}
            {formError && <p className="projects-validation" role="alert">{formError}</p>}
            <div className="fa-split">
              {editing && <button type="button" className="projects-cancel fa-danger" onClick={deleteAsset}><Trash2 size={14} /> Delete</button>}
              <div className="group">
                <button type="button" className="projects-cancel" onClick={() => setFormOpen(false)}>Cancel</button>
                <button type="submit" className="primary-button"><Plus size={15} /> {editing ? 'Save changes' : 'Add asset'}</button>
              </div>
            </div>
          </form>
        </section>
      </div>}

      {/* ---------- details ---------- */}
      {detail && <div className="projects-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
        <section className="projects-modal fa-detail" role="dialog" aria-modal="true" aria-labelledby="fa-detail-title">
          <div className="projects-modal-header"><div><div className="eyebrow">{detail.asset.id} · {detail.asset.category}</div><h3 id="fa-detail-title">{detail.asset.name}</h3></div><button className="projects-close" onClick={() => setSelected(null)} aria-label="Close"><X size={19} /></button></div>
          <span className={`fa-status ${statusClass(detail.asset.status)}`}>{detail.asset.status}</span>
          <div className="fa-detail-grid">
            <div><span>Bought</span><strong>{prettyDate(detail.asset.purchaseDate)}</strong></div>
            <div><span>Cost</span><strong>{money(detail.asset.cost)}</strong></div>
            <div><span>Paid with</span><strong>{detail.asset.paidWith}{detail.asset.momoFee ? ` (+ ${money(detail.asset.momoFee)} fee)` : ''}</strong></div>
            <div><span>Useful life</span><strong>{detail.asset.usefulLifeYears} year{detail.asset.usefulLifeYears === 1 ? '' : 's'}</strong></div>
            <div><span>Depreciation to date</span><strong>{isDisposed(detail.asset) ? money(detail.depreciatedAtDisposal) : money(detail.depreciated)}</strong></div>
            <div><span>Book value</span><strong>{isDisposed(detail.asset) ? '—' : money(detail.bookValue)}</strong></div>
            <div><span>Supplier</span><strong>{detail.asset.supplier || '—'}</strong></div>
            <div><span>Serial / plate</span><strong>{detail.asset.serialNumber || '—'}</strong></div>
            <div><span>Location</span><strong>{detail.asset.location || '—'}</strong></div>
            {isDisposed(detail.asset) && <>
              <div><span>{detail.asset.status === 'Sold' ? 'Sold on' : 'Written off on'}</span><strong>{prettyDate(detail.asset.disposalDate)}</strong></div>
              {detail.asset.status === 'Sold' && <div><span>Price received</span><strong>{money(detail.asset.disposalAmount ?? 0)}{detail.asset.disposalMethod ? ` · ${detail.asset.disposalMethod}` : ''}</strong></div>}
              <div><span>{detail.gainOrLoss >= 0 ? 'Gain' : 'Loss'}</span><strong>{money(Math.abs(detail.gainOrLoss))}</strong></div>
            </>}
          </div>
          {detail.asset.notes && <p className="fa-help">{detail.asset.notes}</p>}

          <h4 className="fa-h4">Depreciation by year</h4>
          {schedule.length === 0 ? <p className="fa-help">No depreciation (the cost equals the value at the end of its life).</p> : (
            <div className="projects-table-wrap">
              <table className="fa-schedule">
                <thead><tr><th>Year</th><th>Months</th><th className="num">Depreciation</th><th className="num">Book value after</th><th>Recorded</th></tr></thead>
                <tbody>{schedule.map((y) => <tr key={y.year} className={y.posted ? undefined : 'pending'}>
                  <td>{y.year}</td><td>{y.months}</td><td className="num">{money(y.amount)}</td><td className="num">{money(y.bookValueAfter)}</td><td>{y.posted ? prettyDate(y.date) : `On ${prettyDate(y.date)}`}</td>
                </tr>)}</tbody>
              </table>
            </div>
          )}

          {isAdmin && <div className="fa-split">
            {isDisposed(detail.asset)
              ? <button type="button" className="projects-cancel" onClick={() => undoDisposal(detail.asset)}><Undo2 size={14} /> Undo {detail.asset.status === 'Sold' ? 'sale' : 'write-off'}</button>
              : <button type="button" className="projects-cancel" onClick={() => openDisposal(detail.asset)}><HandCoins size={14} /> Sell or write off</button>}
            <div className="group"><button type="button" className="primary-button" onClick={() => openEdit(detail.asset)}><Pencil size={14} /> Edit asset</button></div>
          </div>}
        </section>
      </div>}

      {/* ---------- sell / write off ---------- */}
      {disposing && isAdmin && <div className="projects-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setDisposing(null); }}>
        <section className="projects-modal" role="dialog" aria-modal="true" aria-labelledby="fa-dispose-title" style={{ width: 'min(460px,100%)' }}>
          <div className="projects-modal-header"><div><div className="eyebrow">{disposing.id}</div><h3 id="fa-dispose-title">Sell or write off · {disposing.name}</h3></div><button className="projects-close" onClick={() => setDisposing(null)} aria-label="Close"><X size={19} /></button></div>
          <div className="projects-form-grid">
            <label className="projects-field">What happened<select value={disposal.kind} onChange={(e) => setDisposal((d) => ({ ...d, kind: e.target.value as DisposalForm['kind'] }))}><option>Sold</option><option>Written off</option></select></label>
            <label className="projects-field">Date<input type="date" min={disposing.purchaseDate} max={today} value={disposal.date} onChange={(e) => setDisposal((d) => ({ ...d, date: e.target.value }))} /></label>
            {disposal.kind === 'Sold' && <>
              <label className="projects-field">Price received (RWF)<input type="number" min="1" step="1" value={disposal.amount || ''} onChange={(e) => setDisposal((d) => ({ ...d, amount: Number(e.target.value) }))} /></label>
              <label className="projects-field">Received into<select value={disposal.method} onChange={(e) => setDisposal((d) => ({ ...d, method: e.target.value as MoneyMethod }))}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
            </>}
          </div>
          {disposal.kind === 'Written off' && <p className="fa-help" style={{ marginTop: 10 }}>Use this for an asset that is lost, stolen or broken beyond repair.</p>}
          {disposalPreview && <p className="fa-info" style={{ marginTop: 12 }}>
            Depreciation up to then: <strong>{money(disposalPreview.depreciated)}</strong> · Book value: <strong>{money(disposalPreview.bookValue)}</strong><br />
            {disposalPreview.result >= 0 ? 'Gain' : 'Loss'}: <strong>{money(Math.abs(disposalPreview.result))}</strong>
          </p>}
          {disposalError && <p className="projects-validation" role="alert">{disposalError}</p>}
          <div className="fa-split"><div className="group">
            <button type="button" className="projects-cancel" onClick={() => setDisposing(null)}>Cancel</button>
            <button type="button" className="primary-button" onClick={saveDisposal}>{disposal.kind === 'Sold' ? 'Record sale' : 'Write off'}</button>
          </div></div>
        </section>
      </div>}
    </section>
  );
}

function Metric({ title, value, note, icon, tone }: { title: string; value: string; note: string; icon: ReactNode; tone: 'green' | 'blue' | 'amber' | 'violet' }) {
  return (
    <article className={`pj-kpi tone-${tone}`}>
      <div className="pj-kpi-top"><span className="pj-kpi-icon" aria-hidden="true">{icon}</span><span className="pj-kpi-label">{title}</span></div>
      <div className="pj-kpi-value">{value}</div>
      <div className="pj-kpi-note">{note}</div>
    </article>
  );
}
