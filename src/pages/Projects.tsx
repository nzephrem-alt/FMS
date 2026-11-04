import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Building2, Plus, Search, Pencil, Trash2, X, MapPin,
  Banknote, FolderKanban, CheckCircle2, Clock3, PauseCircle, Ban,
  Upload, Download, FileSpreadsheet,
} from 'lucide-react';
import { auditLog } from '../lib/ledger';
import { buildPreview, downloadProjectTemplate, readProjectFile } from '../lib/projectImport';
import type { ImportMode, ProjectRecord, ProjectStatus } from '../lib/projectImport';

type Project = ProjectRecord;
type ProjectForm = Omit<Project, 'id'>;

const STORAGE_KEY = 'ista-fortis-projects-v1';
const INVOICES_KEY = 'ista-fortis-invoices-v1';

const emptyForm: ProjectForm = {
  projectName: '', location: '', client: '', contractValue: 0, totalReceived: 0,
  startDate: '', expectedCompletion: '', status: 'Active', currentPhase: '', notes: '',
};

const money = (amount: number) => new Intl.NumberFormat('en-RW', {
  style: 'currency', currency: 'RWF', maximumFractionDigits: 0,
}).format(Number.isFinite(amount) ? amount : 0);

function readProjects(): Project[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) as Project[] : [];
  } catch {
    return [];
  }
}

type InvoiceLite = { projectId?: string; voided?: boolean; payments?: { amount: number }[] };

/** Total client payments recorded on invoices, grouped by project id. */
function readInvoiceReceipts(): Record<string, number> {
  const totals: Record<string, number> = {};
  try {
    const raw = localStorage.getItem(INVOICES_KEY);
    const invoices = raw ? (JSON.parse(raw) as InvoiceLite[]) : [];
    if (!Array.isArray(invoices)) return totals;
    for (const invoice of invoices) {
      if (invoice.voided || !invoice.projectId) continue;
      const paid = (invoice.payments ?? []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
      totals[invoice.projectId] = (totals[invoice.projectId] ?? 0) + paid;
    }
  } catch {
    /* ignore unreadable invoice data */
  }
  return totals;
}

function statusIcon(status: ProjectStatus) {
  if (status === 'Completed') return <CheckCircle2 size={14} />;
  if (status === 'On hold') return <PauseCircle size={14} />;
  if (status === 'Cancelled') return <Ban size={14} />;
  return <Clock3 size={14} />;
}

const actionLabel = { new: 'New', update: 'Update', skip: 'Already exists, skipped', error: 'Error' } as const;

/**
 * Page styles live here so this page is a single file. Everything is scoped under
 * .projects-module, so it restyles this page (and its pop-ups) without touching other pages.
 */
const PROJECTS_CSS = `
.projects-module{--lime:#d5f56b;--lime-ink:#1d2b12;--ink:#1c2b22;--muted:#7d8a83;--line:#edf0f1;display:flex;flex-direction:column;gap:22px;color:var(--ink)}
.projects-module button:focus-visible{outline:2px solid #2f8f6b;outline-offset:2px}

/* header */
.projects-module .welcome-row{margin-bottom:0;gap:20px;flex-wrap:wrap;align-items:flex-end}
.projects-module .welcome-row h2{font-size:28px;font-weight:700;letter-spacing:-.4px;margin:6px 0 4px;color:var(--ink)}
.projects-module .welcome-row p{font-size:13px;color:var(--muted)}
.projects-module .projects-secondary-button{height:39px;border-radius:12px;border:1px solid var(--line);background:#fff;color:var(--ink);font-weight:600}
.projects-module .projects-secondary-button:hover{background:#f4f7f6}
.projects-module .primary-button{height:39px;border-radius:12px;background:var(--lime);color:var(--lime-ink);font-size:12px;font-weight:600;box-shadow:none}
.projects-module .primary-button:hover{background:#c8ea52}
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

/* register card */
.projects-module .projects-register{padding:20px 0 6px;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 2px #1c2b2208;overflow:hidden}
.projects-module .projects-heading{padding:0 20px 14px}
.projects-module .projects-heading h3{font-size:16px;font-weight:600;color:var(--ink)}
.projects-module .projects-heading p{color:var(--muted)}
.projects-module .projects-search{border-radius:12px;border:1px solid var(--line);background:#fff;height:38px}
.projects-module .projects-filters select{border-radius:12px;border:1px solid var(--line);height:38px}

/* tables (register and import preview) */
.projects-module .projects-table th{background:transparent;padding:10px 20px;font-size:11px;font-weight:500;letter-spacing:0;color:#8a968f;border-bottom:1px solid var(--line)}
.projects-module .projects-table td{padding:14px 20px;font-size:12px;color:#3b4a42;border-top:0;border-bottom:1px solid #f1f4f4}
.projects-module .projects-table tbody tr:last-child td{border-bottom:0}
.projects-module .projects-table tbody tr:hover{background:#f7faf9}
.projects-module .project-name-button strong{font-size:12px;font-weight:600;color:var(--ink)}
.projects-module .project-client strong{font-size:12px;color:#3b4a42}
.projects-module .received-cell .progress-track{background:#eef1f1;border-radius:6px}
.projects-module .received-cell .progress-track i{background:#6fd6a0;border-radius:6px}
.projects-module .project-status{padding:5px 10px;font-weight:600}
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

@media(max-width:1100px){.pj-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:420px){.pj-kpis{grid-template-columns:1fr}}
@media(max-width:600px){.projects-module .projects-table th,.projects-module .projects-table td{padding-left:14px;padding-right:14px}}
@media(prefers-reduced-motion:reduce){.pj-kpi{transition:none}.pj-kpi:hover{transform:none}}
`;

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>(readProjects);
  const [invoiceReceipts, setInvoiceReceipts] = useState<Record<string, number>>(readInvoiceReceipts);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProjectForm>(emptyForm);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  // Excel import
  const [showImport, setShowImport] = useState(false);
  const [importTable, setImportTable] = useState<unknown[][] | null>(null);
  const [importMeta, setImportMeta] = useState<{ name: string; sheet: number } | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('skip');
  const [importError, setImportError] = useState('');
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }, [projects]);

  // Keep invoice payments up to date when returning to this page or tab.
  useEffect(() => {
    const refresh = () => setInvoiceReceipts(readInvoiceReceipts());
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  /** Total received = money received before the system + payments recorded on invoices. */
  const receivedOf = (project: Project) => project.totalReceived + (invoiceReceipts[project.id] ?? 0);

  const filteredProjects = useMemo(() => projects.filter(project => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [project.projectName, project.client, project.location, project.id]
      .some(value => value.toLowerCase().includes(query));
    return matchesSearch && (statusFilter === 'All' || project.status === statusFilter);
  }), [projects, search, statusFilter]);

  const totals = useMemo(() => ({
    contract: projects.reduce((sum, project) => sum + project.contractValue, 0),
    received: projects.reduce((sum, project) => sum + project.totalReceived + (invoiceReceipts[project.id] ?? 0), 0),
    outstanding: projects.reduce((sum, project) => sum + Math.max(project.contractValue - (project.totalReceived + (invoiceReceipts[project.id] ?? 0)), 0), 0),
    active: projects.filter(project => project.status === 'Active').length,
  }), [projects, invoiceReceipts]);

  const outstandingPct = totals.contract > 0 ? Math.round((totals.outstanding / totals.contract) * 100) : 0;

  const preview = useMemo(
    () => (importTable ? buildPreview(importTable, projects, importMode) : null),
    [importTable, projects, importMode],
  );
  const importable = preview ? preview.counts.new + preview.counts.update : 0;

  const openNewForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEditForm = (project: Project) => {
    setEditingId(project.id);
    const { id: _id, ...details } = project;
    setForm(details);
    setShowForm(true);
    setSelectedProject(null);
  };

  const updateField = (field: keyof ProjectForm, value: string | number) => {
    setForm(current => ({ ...current, [field]: value }));
  };

  const saveProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.projectName.trim() || !form.client.trim()) return;
    if (form.contractValue < 0 || form.totalReceived < 0) return;

    if (editingId) {
      setProjects(current => current.map(project => project.id === editingId ? { ...form, id: editingId } : project));
    } else {
      const nextNumber = projects.reduce((max, project) => {
        const match = project.id.match(/^PRJ-(\d+)$/);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0) + 1;
      setProjects(current => [...current, { ...form, id: `PRJ-${String(nextNumber).padStart(3, '0')}` }]);
    }
    setShowForm(false);
    setForm(emptyForm);
  };

  const deleteProject = (project: Project) => {
    if (!window.confirm(`Delete ${project.projectName}? This removes it from this browser's project register.`)) return;
    setProjects(current => current.filter(item => item.id !== project.id));
    setSelectedProject(null);
  };

  /* ---------- Excel import ---------- */
  const resetImport = () => {
    setImportTable(null);
    setImportMeta(null);
    setImportError('');
    setImportMode('skip');
    setReading(false);
    setDragging(false);
  };
  const openImport = () => { resetImport(); setShowImport(true); };
  const closeImport = () => { setShowImport(false); resetImport(); };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    setImportError('');
    setReading(true);
    try {
      const { table, sheet } = await readProjectFile(file);
      setImportTable(table);
      setImportMeta({ name: file.name, sheet });
    } catch (e) {
      setImportTable(null);
      setImportError(e instanceof Error ? e.message : 'Could not read this file.');
    } finally {
      setReading(false);
    }
  };

  const confirmImport = () => {
    if (!preview || importable === 0) return;
    const toAdd = preview.rows.filter(r => r.action === 'new').map(r => r.project);
    const updates = new Map(preview.rows.filter(r => r.action === 'update').map(r => [r.project.id, r.project]));
    setProjects(current => [...current.map(p => updates.get(p.id) ?? p), ...toAdd]);
    const message = `Imported ${preview.counts.new} new and updated ${preview.counts.update} existing project${preview.counts.update === 1 ? '' : 's'} from ${importMeta?.name ?? 'file'}.`;
    try {
      auditLog.log({
        action: 'projects.imported',
        entityType: 'project',
        entityId: importMeta?.name ?? 'file',
        summary: message,
        details: { ...preview.counts, ids: preview.rows.filter(r => r.action === 'new' || r.action === 'update').map(r => r.project.id) },
      });
    } catch (e) {
      console.error('Could not write the audit log:', e);
    }
    setNotice(message);
    closeImport();
  };

  return (
    <section className="projects-module">
      <style>{PROJECTS_CSS}</style>

      <div className="welcome-row">
        <div>
          <div className="eyebrow">PROJECT MANAGEMENT</div>
          <h2>Projects</h2>
          <p>Register projects and monitor contract values and client receipts.</p>
        </div>
        <div className="projects-header-actions">
          <button className="projects-secondary-button" onClick={openImport}><Upload size={16} /> <span>Import from Excel</span></button>
          <button className="primary-button" onClick={openNewForm}><Plus size={16} /> New project</button>
        </div>
      </div>

      {notice && <div className="projects-import-notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}

      <div className="pj-kpis">
        <Metric title="Total projects" value={String(projects.length)} note={`${projects.length - totals.active} completed, on hold or cancelled`} icon={<FolderKanban size={13} />} tone="green" />
        <Metric title="Active projects" value={String(totals.active)} note="Currently under way" icon={<Building2 size={13} />} tone="blue" />
        <Metric title="Total contract value" value={money(totals.contract)} note={`${money(totals.received)} received so far`} icon={<Banknote size={13} />} tone="amber" />
        <Metric title="Outstanding receivables" value={money(totals.outstanding)} note={totals.contract > 0 ? `${outstandingPct}% of contract value still to collect` : 'No contracts registered yet'} icon={<Banknote size={13} />} tone="rose" />
      </div>

      <div className="panel projects-register">
        <div className="panel-heading projects-heading">
          <div><h3>Project register</h3><p>{filteredProjects.length} project{filteredProjects.length === 1 ? '' : 's'} displayed</p></div>
          <div className="projects-filters">
            <label className="projects-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search projects..." /></label>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="Filter by status">
              <option>All</option><option>Active</option><option>Completed</option><option>On hold</option><option>Cancelled</option>
            </select>
          </div>
        </div>

        {filteredProjects.length === 0 ? (
          <div className="projects-empty"><div className="projects-empty-icon"><FolderKanban size={24} /></div><h3>{projects.length ? 'No matching projects' : 'No projects registered yet'}</h3><p>{projects.length ? 'Try another search term or status filter.' : 'Add your first project, or import your existing projects from an Excel file.'}</p>{!projects.length && <div className="projects-header-actions" style={{ justifyContent: 'center' }}><button className="projects-secondary-button" onClick={openImport}><Upload size={16} /> <span>Import from Excel</span></button><button className="primary-button" onClick={openNewForm}><Plus size={16} /> Add first project</button></div>}</div>
        ) : (
          <div className="projects-table-wrap">
            <table className="projects-table">
              <thead><tr><th>Project</th><th>Client / location</th><th>Contract value</th><th>Received</th><th>Outstanding</th><th>Status</th><th /></tr></thead>
              <tbody>{filteredProjects.map(project => {
                const received = receivedOf(project);
                const outstanding = Math.max(project.contractValue - received, 0);
                const progress = project.contractValue > 0 ? Math.min(received / project.contractValue * 100, 100) : 0;
                return <tr key={project.id}>
                  <td><button className="project-name-button" onClick={() => setSelectedProject(project)}><strong>{project.projectName}</strong><span>{project.id}</span></button></td>
                  <td><div className="project-client"><strong>{project.client}</strong><span><MapPin size={12} /> {project.location || 'Location not set'}</span></div></td>
                  <td className="money-cell">{money(project.contractValue)}</td>
                  <td><div className="received-cell"><strong>{money(received)}</strong><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><small>{progress.toFixed(0)}% received</small></div></td>
                  <td className="money-cell">{money(outstanding)}</td>
                  <td><span className={`project-status status-${project.status.toLowerCase().replace(' ', '-')}`}>{statusIcon(project.status)}{project.status}</span></td>
                  <td><div className="project-row-actions"><button aria-label={`Edit ${project.projectName}`} title="Edit" onClick={() => openEditForm(project)}><Pencil size={15} /></button><button aria-label={`Delete ${project.projectName}`} title="Delete" onClick={() => deleteProject(project)}><Trash2 size={15} /></button></div></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && <div className="projects-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowForm(false); }}>
        <section className="projects-modal" role="dialog" aria-modal="true" aria-labelledby="project-form-title">
          <div className="projects-modal-header"><div><div className="eyebrow">PROJECT RECORD</div><h3 id="project-form-title">{editingId ? 'Edit project' : 'Register new project'}</h3></div><button className="projects-close" onClick={() => setShowForm(false)} aria-label="Close"><X size={19} /></button></div>
          <form onSubmit={saveProject}>
            <div className="projects-form-grid">
              <label className="projects-field field-wide">Project name *<input required value={form.projectName} onChange={event => updateField('projectName', event.target.value)} placeholder="e.g. Gahanga Construction Project" /></label>
              <label className="projects-field">Client name *<input required value={form.client} onChange={event => updateField('client', event.target.value)} placeholder="Client / company" /></label>
              <label className="projects-field">Location<input value={form.location} onChange={event => updateField('location', event.target.value)} placeholder="District, sector or site" /></label>
              <label className="projects-field">Contract value (RWF)<input type="number" min="0" step="1" value={form.contractValue || ''} onChange={event => updateField('contractValue', Number(event.target.value))} /></label>
              <label className="projects-field">Received before using the system (RWF)<input type="number" min="0" step="1" value={form.totalReceived || ''} onChange={event => updateField('totalReceived', Number(event.target.value))} placeholder="Opening amount, without invoices" /></label>
              <label className="projects-field">Start date<input type="date" value={form.startDate} onChange={event => updateField('startDate', event.target.value)} /></label>
              <label className="projects-field">Expected completion<input type="date" value={form.expectedCompletion} onChange={event => updateField('expectedCompletion', event.target.value)} /></label>
              <label className="projects-field">Project status<select value={form.status} onChange={event => updateField('status', event.target.value as ProjectStatus)}><option>Active</option><option>Completed</option><option>On hold</option><option>Cancelled</option></select></label>
              <label className="projects-field">Current phase<input value={form.currentPhase} onChange={event => updateField('currentPhase', event.target.value)} placeholder="e.g. Phase 1" /></label>
              <label className="projects-field field-wide">Notes<textarea rows={3} value={form.notes} onChange={event => updateField('notes', event.target.value)} placeholder="Additional project information..." /></label>
            </div>
            <p className="projects-validation" style={{ background: 'transparent', color: '#64748b' }}>Enter only money received before you started using this system. Payments recorded on client invoices are added automatically.</p>
            {form.totalReceived > form.contractValue && <p className="projects-validation">Note: receipts exceed the contract value. Please verify the amounts before saving.</p>}
            <div className="projects-form-actions"><button type="button" className="projects-cancel" onClick={() => setShowForm(false)}>Cancel</button><button type="submit" className="primary-button">{editingId ? 'Save changes' : 'Create project'}</button></div>
          </form>
        </section>
      </div>}

      {selectedProject && <div className="projects-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedProject(null); }}>
        <section className="projects-modal project-detail-modal" role="dialog" aria-modal="true" aria-labelledby="project-detail-title">
          <div className="projects-modal-header"><div><div className="eyebrow">{selectedProject.id}</div><h3 id="project-detail-title">{selectedProject.projectName}</h3></div><button className="projects-close" onClick={() => setSelectedProject(null)} aria-label="Close"><X size={19} /></button></div>
          <span className={`project-status status-${selectedProject.status.toLowerCase().replace(' ', '-')}`}>{statusIcon(selectedProject.status)}{selectedProject.status}</span>
          <div className="project-detail-grid">
            <Detail label="Client" value={selectedProject.client} /><Detail label="Location" value={selectedProject.location || 'Not specified'} />
            <Detail label="Contract value" value={money(selectedProject.contractValue)} /><Detail label="Total received" value={money(receivedOf(selectedProject))} />
            <Detail label="Received before system" value={money(selectedProject.totalReceived)} /><Detail label="Invoice payments" value={money(invoiceReceipts[selectedProject.id] ?? 0)} />
            <Detail label="Outstanding" value={money(Math.max(selectedProject.contractValue - receivedOf(selectedProject), 0))} />
            <Detail label="Current phase" value={selectedProject.currentPhase || 'Not specified'} />
            <Detail label="Start date" value={selectedProject.startDate || 'Not specified'} /><Detail label="Expected completion" value={selectedProject.expectedCompletion || 'Not specified'} />
          </div>
          {selectedProject.notes && <div className="project-detail-notes"><strong>Notes</strong><p>{selectedProject.notes}</p></div>}
          <div className="projects-form-actions"><button className="projects-cancel" onClick={() => deleteProject(selectedProject)}>Delete project</button><button className="primary-button" onClick={() => openEditForm(selectedProject)}><Pencil size={15} /> Edit project</button></div>
        </section>
      </div>}

      {showImport && <div className="projects-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeImport(); }}>
        <section className="projects-modal projects-import-modal" role="dialog" aria-modal="true" aria-labelledby="project-import-title">
          <div className="projects-modal-header"><div><div className="eyebrow">BULK IMPORT</div><h3 id="project-import-title">Import projects from Excel</h3></div><button className="projects-close" onClick={closeImport} aria-label="Close"><X size={19} /></button></div>

          {!preview && <>
            <label
              className={`projects-dropzone${dragging ? ' is-dragging' : ''}`}
              htmlFor="project-import-file"
              onDragOver={event => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={event => { event.preventDefault(); setDragging(false); void handleImportFile(event.dataTransfer.files[0]); }}
            >
              <FileSpreadsheet size={30} />
              <strong>{reading ? 'Reading file...' : 'Choose an Excel file or drop it here'}</strong>
              <span>.xlsx or .csv. The first row of your project list should have headers such as Project ID, Project Name, Location, Client, Contract Value, Total Received, Start Date, Expected Completion and Status.</span>
              <input id="project-import-file" type="file" accept=".xlsx,.csv" hidden onChange={event => { void handleImportFile(event.target.files?.[0]); event.target.value = ''; }} />
            </label>
            {importError && <p className="projects-validation" role="alert">{importError}</p>}
            <div className="projects-import-help">
              <button type="button" className="text-button" onClick={downloadProjectTemplate}><Download size={14} /> Download a template</button>
              <span>Nothing is saved until you confirm on the next screen.</span>
            </div>
          </>}

          {preview && <>
            <div className="projects-import-file"><FileSpreadsheet size={16} /><strong>{importMeta?.name}</strong>{importMeta && importMeta.sheet > 1 && <span>(sheet {importMeta.sheet})</span>}<button type="button" className="text-button" onClick={resetImport}>Choose another file</button></div>

            {preview.fatal ? <p className="projects-validation" role="alert">{preview.fatal}</p> : <>
              <div className="projects-import-columns"><span>Columns found:</span>{preview.columns.map(c => <i key={c}>{c}</i>)}</div>

              <div className="projects-import-modes" role="radiogroup" aria-label="If a project already exists">
                <span>If a project already exists:</span>
                <label><input type="radio" name="import-mode" checked={importMode === 'skip'} onChange={() => setImportMode('skip')} /> Skip it</label>
                <label><input type="radio" name="import-mode" checked={importMode === 'update'} onChange={() => setImportMode('update')} /> Update it with the file values</label>
              </div>

              <div className="projects-import-summary">
                <span className="import-badge new">{preview.counts.new} new</span>
                <span className="import-badge update">{preview.counts.update} to update</span>
                <span className="import-badge skip">{preview.counts.skip} skipped</span>
                <span className="import-badge error">{preview.counts.error} with errors</span>
              </div>

              <div className="projects-import-table-wrap">
                <table className="projects-table projects-import-table">
                  <thead><tr><th>Row</th><th>Action</th><th>ID</th><th>Project</th><th>Client</th><th>Contract</th><th>Received</th><th>Status</th><th>Checks</th></tr></thead>
                  <tbody>{preview.rows.map(row => <tr key={row.rowNumber} className={`import-row-${row.action}`}>
                    <td>{row.rowNumber}</td>
                    <td><span className={`import-badge ${row.action}`}>{actionLabel[row.action]}</span></td>
                    <td>{row.project.id || '—'}</td>
                    <td><strong>{row.project.projectName || '—'}</strong><div className="import-sub">{row.project.location || 'No location'}</div></td>
                    <td>{row.project.client || '—'}</td>
                    <td className="money-cell">{money(row.project.contractValue)}</td>
                    <td className="money-cell">{money(row.project.totalReceived)}</td>
                    <td>{row.project.status}</td>
                    <td>{row.messages.length === 0 ? <span className="import-ok">OK</span> : row.messages.map((m, i) => <div key={i} className={`import-msg ${m.level}`}>{m.text}</div>)}</td>
                  </tr>)}</tbody>
                </table>
              </div>
              {preview.counts.error > 0 && <p className="projects-validation">Rows with errors will not be imported. Fix them in Excel and upload the file again, or import the good rows now and add the others with "New project".</p>}
            </>}

            <div className="projects-form-actions">
              <button type="button" className="projects-cancel" onClick={closeImport}>Cancel</button>
              {!preview.fatal && <button type="button" className="primary-button" disabled={importable === 0} onClick={confirmImport}>Import {importable} project{importable === 1 ? '' : 's'}</button>}
            </div>
          </>}
        </section>
      </div>}
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

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="project-detail-item"><span>{label}</span><strong>{value}</strong></div>;
}