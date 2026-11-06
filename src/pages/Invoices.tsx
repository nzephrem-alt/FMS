import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Plus, Search, Eye, CreditCard, X, FileText, Ban, HandCoins, Wallet, AlertTriangle } from 'lucide-react';
import { postClientInvoice, postClientPayment, reverseClientInvoice, syncStoredInvoices } from '../lib/postings'; // LEDGER
import { useAccess } from '../lib/access';

type Project = { id: string; projectName: string; client: string };
type Payment = { id: string; amount: number; date: string; method: string; reference: string; notes: string };
type Invoice = {
  id: string; invoiceNumber: string; projectId: string; projectName: string; client: string;
  description: string; issueDate: string; dueDate: string; amount: number;
  payments: Payment[]; notes: string; voided: boolean; createdAt: string;
};
type Status = 'Unpaid' | 'Partially paid' | 'Paid' | 'Overdue' | 'Void';

const STORAGE_KEY = 'ista-fortis-invoices-v1';
const PROJECTS_KEY = 'ista-fortis-projects-v1';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const money = (amount: number) => new Intl.NumberFormat('en-RW', { style: 'currency', currency: 'RWF', maximumFractionDigits: 0 }).format(amount);
const makeId = () => `INV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const readList = <T,>(key: string): T[] => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T[] : []; }
  catch { return []; }
};
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const received = (invoice: Invoice) => invoice.payments.reduce((sum, p) => sum + p.amount, 0);
const statusOf = (invoice: Invoice): Status => {
  if (invoice.voided) return 'Void';
  const paid = received(invoice);
  if (paid >= invoice.amount) return 'Paid';
  if (paid > 0) return 'Partially paid';
  return invoice.dueDate < today() ? 'Overdue' : 'Unpaid';
};

const STATUS_CLASS: Record<Status, string> = {
  Paid: 'inv-paid', 'Partially paid': 'inv-partial', Unpaid: 'inv-unpaid', Overdue: 'inv-overdue', Void: 'inv-void',
};
const blankForm = () => ({ invoiceNumber: '', projectId: '', client: '', description: '', issueDate: today(), dueDate: '', amount: '', notes: '' });
const blankPayment = () => ({ amount: '', date: today(), method: 'Bank transfer', reference: '', notes: '' });

/**
 * Page styles live here so this page is a single file. They mirror the Projects page and are
 * scoped under .projects-module, so they restyle this page (and its pop-ups) only.
 */
const INVOICES_CSS = `
.projects-module{--lime:#d5f56b;--lime-ink:#1d2b12;--ink:#1c2b22;--muted:#7d8a83;--line:#edf0f1;display:flex;flex-direction:column;gap:22px;color:var(--ink)}
.projects-module button:focus-visible{outline:2px solid #2f8f6b;outline-offset:2px}

/* header */
.projects-module .welcome-row{margin-bottom:0;gap:20px;flex-wrap:wrap;align-items:flex-end}
.projects-module .welcome-row h2{font-size:28px;font-weight:700;letter-spacing:-.4px;margin:6px 0 4px;color:var(--ink)}
.projects-module .welcome-row p{font-size:13px;color:var(--muted)}
.projects-module .primary-button{height:39px;border-radius:12px;background:var(--lime);color:var(--lime-ink);font-size:12px;font-weight:600;box-shadow:none}
.projects-module .primary-button:hover{background:#c8ea52}

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

/* table */
.projects-module .projects-table th{background:transparent;padding:10px 20px;font-size:11px;font-weight:500;letter-spacing:0;color:#8a968f;border-bottom:1px solid var(--line);white-space:nowrap}
.projects-module .projects-table td{padding:14px 20px;font-size:12px;color:#3b4a42;border-top:0;border-bottom:1px solid #f1f4f4;vertical-align:middle}
.projects-module .projects-table tbody tr:last-child td{border-bottom:0}
.projects-module .projects-table tbody tr:hover{background:#f7faf9}
.projects-module .projects-table strong{font-size:12px;font-weight:600;color:var(--ink)}
.projects-module .projects-table .num{text-align:right}
.projects-module .money-cell{white-space:nowrap;font-variant-numeric:tabular-nums}
.projects-module .inv-sub{display:block;margin-top:3px;font-size:10.5px;color:var(--muted)}
.projects-module .project-row-actions{display:flex;gap:6px}
.projects-module .project-row-actions button,.projects-module .projects-close{border-radius:10px;border:1px solid var(--line)}
.projects-module .project-row-actions button:hover,.projects-module .projects-close:hover{background:#f1f5f4;color:var(--ink)}
.projects-module .projects-empty-icon{background:#ebe8fb;color:#6a5bc2;border-radius:14px}

/* status pills */
.projects-module .inv-status{display:inline-flex;align-items:center;padding:5px 10px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}
.projects-module .inv-paid{background:#bdeed6;color:#1f6b46}
.projects-module .inv-partial{background:#fde5c4;color:#a8691f}
.projects-module .inv-unpaid{background:#c9defb;color:#3a66ad}
.projects-module .inv-overdue{background:#fbd6db;color:#b04a58}
.projects-module .inv-void{background:#eceff0;color:#6b776f}

/* pop-ups */
.projects-module .projects-modal{border-radius:18px;max-width:680px}
.projects-module .projects-modal-header h3{color:var(--ink)}
.projects-module .projects-field input,.projects-module .projects-field select,.projects-module .projects-field textarea{border-radius:10px;border-color:#e5eaec}
.projects-module .projects-cancel{border-radius:12px;border-color:var(--line)}
.projects-module .project-detail-grid{border-radius:12px}
.projects-module .inv-outstanding{margin:0 0 14px;padding:12px 14px;border-radius:12px;background:#fde5c4;color:#8a5517;font-size:13px;font-weight:600}
.projects-module .inv-section-title{font-size:13px;font-weight:600;margin:18px 0 8px;color:var(--ink)}
.projects-module .inv-text{margin:0;font-size:12.5px;color:#4f5d55;line-height:1.6}
.projects-module .inv-pay{display:flex;justify-content:space-between;gap:12px;padding:11px 14px;border-radius:12px;background:#f7faf9;margin-bottom:8px;font-size:12px}
.projects-module .inv-pay strong{white-space:nowrap;font-variant-numeric:tabular-nums}
.projects-module .inv-danger{color:#b04a58}

@media(max-width:1100px){.pj-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:420px){.pj-kpis{grid-template-columns:1fr}}
@media(max-width:600px){.projects-module .projects-table th,.projects-module .projects-table td{padding-left:14px;padding-right:14px}}
@media(prefers-reduced-motion:reduce){.pj-kpi{transition:none}.pj-kpi:hover{transform:none}}
`;

export default function Invoices() {
  const { isAdmin } = useAccess(); // Viewers see invoices and payments but no buttons that change them
  const [invoices, setInvoices] = useState<Invoice[]>(() => readList<Invoice>(STORAGE_KEY));
  const [projects] = useState<Project[]>(() => readList<Project>(PROJECTS_KEY));
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [formOpen, setFormOpen] = useState(false);
  const [paymentFor, setPaymentFor] = useState<Invoice | null>(null);
  const [view, setView] = useState<Invoice | null>(null);
  const [form, setForm] = useState(blankForm);
  const [payment, setPayment] = useState(blankPayment);
  const [formError, setFormError] = useState('');
  const [payError, setPayError] = useState('');

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(invoices)); }, [invoices]);

  // LEDGER: post any saved invoice or payment that has no ledger entry yet. Safe to run repeatedly.
  useEffect(() => {
    const { failed } = syncStoredInvoices();
    if (failed) console.error(`${failed} invoice(s) could not be posted to the ledger.`);
  }, []);

  const active = invoices.filter(i => !i.voided);
  const totals = useMemo(() => {
    const invoiced = active.reduce((s, i) => s + i.amount, 0);
    const paid = active.reduce((s, i) => s + received(i), 0);
    const overdueList = active.filter(i => statusOf(i) === 'Overdue');
    const overdue = overdueList.reduce((s, i) => s + i.amount - received(i), 0);
    return { invoiced, paid, balance: invoiced - paid, overdue, overdueCount: overdueList.length };
  }, [active]);
  const collectedPct = totals.invoiced > 0 ? Math.round((totals.paid / totals.invoiced) * 100) : 0;
  const filtered = invoices.filter(i => {
    const q = search.toLowerCase();
    return (filter === 'All' || statusOf(i) === filter) &&
      [i.invoiceNumber, i.client, i.projectName, i.description].some(v => v.toLowerCase().includes(q));
  });
  const updateForm = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));
  const updatePayment = (key: keyof typeof payment, value: string) => setPayment(current => ({ ...current, [key]: value }));

  const openForm = () => { setFormError(''); setFormOpen(true); };
  const closeForm = () => { setFormOpen(false); setFormError(''); };
  const openPayment = (invoice: Invoice) => { setPayError(''); setPaymentFor(invoice); };
  const closePayment = () => { setPaymentFor(null); setPayError(''); };

  function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    const amount = Number(form.amount);
    if (!form.invoiceNumber.trim() || !form.client.trim() || !Number.isInteger(amount) || amount <= 0 || !form.dueDate || form.dueDate < form.issueDate) {
      setFormError('Check the invoice number, client, amount (whole RWF) and dates. The due date must be on or after the issue date.'); return;
    }
    if (invoices.some(i => i.invoiceNumber.toLowerCase() === form.invoiceNumber.trim().toLowerCase())) {
      setFormError('That invoice number already exists.'); return;
    }
    const project = projects.find(p => p.id === form.projectId);
    const invoice: Invoice = {
      id: makeId(), invoiceNumber: form.invoiceNumber.trim(), projectId: form.projectId,
      projectName: project?.projectName || 'General / Unassigned', client: form.client.trim(),
      description: form.description.trim(), issueDate: form.issueDate, dueDate: form.dueDate,
      amount, payments: [], notes: form.notes.trim(), voided: false, createdAt: new Date().toISOString(),
    };
    // LEDGER: post first, so an invoice is never saved without its journal entry
    try { postClientInvoice(invoice); }
    catch (e) { setFormError(errText(e, 'Could not post the invoice to the ledger.')); return; }
    setInvoices(current => [invoice, ...current]); setFormOpen(false);
    setForm(blankForm());
  }

  function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!paymentFor) return;
    setPayError('');
    const amount = Number(payment.amount); const balance = paymentFor.amount - received(paymentFor);
    if (!Number.isInteger(amount) || amount <= 0 || amount > balance) { setPayError(`Enter a whole RWF payment greater than zero and no more than ${money(balance)}.`); return; }
    const newPayment: Payment = { id: makeId(), amount, date: payment.date, method: payment.method, reference: payment.reference.trim(), notes: payment.notes.trim() };
    // LEDGER: post first, so a payment is never saved without its journal entry
    try { postClientInvoice(paymentFor); postClientPayment(paymentFor, newPayment); }
    catch (e) { setPayError(errText(e, 'Could not post the payment to the ledger.')); return; }
    setInvoices(current => current.map(i => i.id === paymentFor.id ? { ...i, payments: [...i.payments, newPayment] } : i));
    setPaymentFor(null); setPayment(blankPayment());
  }

  function voidInvoice(invoice: Invoice) {
    if (received(invoice) > 0) { window.alert('This invoice has receipts recorded. Reverse or resolve those receipts before voiding it.'); return; }
    if (!window.confirm(`Void invoice ${invoice.invoiceNumber}? It will remain in the records but be excluded from totals.`)) return;
    // LEDGER: post the reversing entry first
    try { reverseClientInvoice(invoice.id, `Invoice ${invoice.invoiceNumber} voided`); }
    catch (e) { window.alert(errText(e, 'Could not void the invoice in the ledger.')); return; }
    setInvoices(current => current.map(i => i.id === invoice.id ? { ...i, voided: true } : i)); setView(null);
  }

  const field = (label: string, key: keyof typeof form, type = 'text', required = false) => (
    <label className="projects-field">{label}{required ? ' *' : ''}
      <input type={type} required={required} value={form[key]} onChange={e => updateForm(key, e.target.value)} />
    </label>
  );

  return (
    <section className="projects-module">
      <style>{INVOICES_CSS}</style>

      <div className="welcome-row">
        <div>
          <div className="eyebrow">FINANCIAL MANAGEMENT</div>
          <h2>Client Invoices</h2>
          <p>Issue invoices and track client payments and outstanding balances.</p>
        </div>
        {isAdmin && <div className="projects-header-actions"><button type="button" className="primary-button" onClick={openForm}><Plus size={16} /> Create invoice</button></div>}
      </div>

      <div className="pj-kpis">
        <Metric icon={<FileText size={13} />} label="Total invoiced" value={money(totals.invoiced)} note={`${active.length} active invoice${active.length === 1 ? '' : 's'}`} tone="blue" />
        <Metric icon={<HandCoins size={13} />} label="Payments received" value={money(totals.paid)} note={totals.invoiced > 0 ? `${collectedPct}% of invoiced amount collected` : 'No invoices issued yet'} tone="green" />
        <Metric icon={<Wallet size={13} />} label="Outstanding balance" value={money(totals.balance)} note="Invoiced but not yet received" tone="amber" />
        <Metric icon={<AlertTriangle size={13} />} label="Overdue balance" value={money(totals.overdue)} note={`${totals.overdueCount} overdue invoice${totals.overdueCount === 1 ? '' : 's'}`} tone="rose" />
      </div>

      <div className="panel projects-register">
        <div className="panel-heading projects-heading">
          <div>
            <h3>Invoice register</h3>
            <p>{filtered.length} invoice{filtered.length === 1 ? '' : 's'} displayed</p>
          </div>
          <div className="projects-filters">
            <label className="projects-search"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoices..." /></label>
            <select value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter by status">
              {['All', 'Unpaid', 'Partially paid', 'Paid', 'Overdue', 'Void'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="projects-empty">
            <div className="projects-empty-icon"><FileText size={24} /></div>
            <h3>{invoices.length ? 'No matching invoices' : 'No invoices yet'}</h3>
            <p>{invoices.length ? 'Try another search term or status filter.' : isAdmin ? 'Create an invoice to begin tracking receivables.' : 'Invoices will appear here once the Admin creates them.'}</p>
          </div>
        ) : (
          <div className="projects-table-wrap">
            <table className="projects-table">
              <thead>
                <tr><th>Invoice</th><th>Client / project</th><th>Issue date</th><th>Due date</th><th className="num">Amount</th><th className="num">Balance due</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {filtered.map(i => (
                  <tr key={i.id}>
                    <td><strong>{i.invoiceNumber}</strong></td>
                    <td><strong>{i.client}</strong><span className="inv-sub">{i.projectName}</span></td>
                    <td className="money-cell">{i.issueDate}</td>
                    <td className="money-cell">{i.dueDate}</td>
                    <td className="money-cell num">{money(i.amount)}</td>
                    <td className="money-cell num"><strong>{money(i.voided ? 0 : i.amount - received(i))}</strong></td>
                    <td><span className={`inv-status ${STATUS_CLASS[statusOf(i)]}`}>{statusOf(i)}</span></td>
                    <td>
                      <div className="project-row-actions">
                        <button type="button" title="View invoice" aria-label={`View invoice ${i.invoiceNumber}`} onClick={() => setView(i)}><Eye size={15} /></button>
                        {isAdmin && !i.voided && i.amount > received(i) && <button type="button" title="Record payment" aria-label={`Record payment for ${i.invoiceNumber}`} onClick={() => openPayment(i)}><CreditCard size={15} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create invoice */}
      {formOpen && isAdmin && (
        <div className="projects-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) closeForm(); }}>
          <section className="projects-modal" role="dialog" aria-modal="true" aria-labelledby="inv-form-title">
            <div className="projects-modal-header">
              <div><div className="eyebrow">NEW INVOICE</div><h3 id="inv-form-title">Create client invoice</h3></div>
              <button type="button" className="projects-close" onClick={closeForm} aria-label="Close"><X size={19} /></button>
            </div>
            {formError && <p className="projects-validation" role="alert">{formError}</p>}
            <form onSubmit={createInvoice} noValidate>
              <div className="projects-form-grid">
                {field('Invoice number', 'invoiceNumber', 'text', true)}
                <label className="projects-field">Project
                  <select value={form.projectId} onChange={e => { const id = e.target.value; const p = projects.find(x => x.id === id); setForm(current => ({ ...current, projectId: id, client: p?.client || current.client })); }}>
                    <option value="">General / Unassigned</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.projectName}</option>)}
                  </select>
                </label>
                {field('Client name', 'client', 'text', true)}
                {field('Invoice amount (RWF)', 'amount', 'number', true)}
                {field('Issue date', 'issueDate', 'date', true)}
                {field('Due date', 'dueDate', 'date', true)}
                <label className="projects-field field-wide">Description / work billed
                  <textarea rows={3} value={form.description} onChange={e => updateForm('description', e.target.value)} />
                </label>
                <label className="projects-field field-wide">Notes
                  <textarea rows={2} value={form.notes} onChange={e => updateForm('notes', e.target.value)} />
                </label>
              </div>
              <div className="projects-form-actions">
                <button type="button" className="projects-cancel" onClick={closeForm}>Cancel</button>
                <button type="submit" className="primary-button"><Plus size={16} /> Save invoice</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Record payment */}
      {paymentFor && isAdmin && (
        <div className="projects-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) closePayment(); }}>
          <section className="projects-modal" role="dialog" aria-modal="true" aria-labelledby="inv-pay-title">
            <div className="projects-modal-header">
              <div><div className="eyebrow">{paymentFor.invoiceNumber} · {paymentFor.client}</div><h3 id="inv-pay-title">Record client payment</h3></div>
              <button type="button" className="projects-close" onClick={closePayment} aria-label="Close"><X size={19} /></button>
            </div>
            <p className="inv-outstanding">Outstanding: {money(paymentFor.amount - received(paymentFor))}</p>
            {payError && <p className="projects-validation" role="alert">{payError}</p>}
            <form onSubmit={recordPayment} noValidate>
              <div className="projects-form-grid">
                <label className="projects-field">Payment amount (RWF) *<input type="number" required value={payment.amount} onChange={e => updatePayment('amount', e.target.value)} /></label>
                <label className="projects-field">Payment date *<input type="date" required value={payment.date} onChange={e => updatePayment('date', e.target.value)} /></label>
                <label className="projects-field">Payment method
                  <select value={payment.method} onChange={e => updatePayment('method', e.target.value)}>
                    {['Bank transfer', 'Cash', 'Mobile money', 'Cheque', 'Other'].map(m => <option key={m}>{m}</option>)}
                  </select>
                </label>
                <label className="projects-field">Reference<input value={payment.reference} onChange={e => updatePayment('reference', e.target.value)} /></label>
                <label className="projects-field field-wide">Notes<textarea rows={2} value={payment.notes} onChange={e => updatePayment('notes', e.target.value)} /></label>
              </div>
              <div className="projects-form-actions">
                <button type="button" className="projects-cancel" onClick={closePayment}>Cancel</button>
                <button type="submit" className="primary-button"><CreditCard size={16} /> Save payment</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Invoice details */}
      {view && (
        <div className="projects-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setView(null); }}>
          <section className="projects-modal project-detail-modal" role="dialog" aria-modal="true" aria-labelledby="inv-view-title">
            <div className="projects-modal-header">
              <div><div className="eyebrow">INVOICE DETAILS</div><h3 id="inv-view-title">{view.invoiceNumber}</h3></div>
              <button type="button" className="projects-close" onClick={() => setView(null)} aria-label="Close"><X size={19} /></button>
            </div>
            <span className={`inv-status ${STATUS_CLASS[statusOf(view)]}`}>{statusOf(view)}</span>
            <div className="project-detail-grid">
              <Detail label="Client" value={view.client} />
              <Detail label="Project" value={view.projectName} />
              <Detail label="Issue date" value={view.issueDate} />
              <Detail label="Due date" value={view.dueDate} />
              <Detail label="Invoice amount" value={money(view.amount)} />
              <Detail label="Received" value={money(received(view))} />
              <Detail label="Outstanding" value={money(view.voided ? 0 : view.amount - received(view))} />
            </div>
            <h4 className="inv-section-title">Description</h4>
            <p className="inv-text">{view.description || 'No description provided.'}</p>
            <h4 className="inv-section-title">Payment history ({view.payments.length})</h4>
            {view.payments.length === 0
              ? <p className="inv-text">No payments recorded.</p>
              : view.payments.map(p => (
                <div key={p.id} className="inv-pay">
                  <span>{p.date} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
                  <strong>{money(p.amount)}</strong>
                </div>
              ))}
            <div className="projects-form-actions">
              {isAdmin && !view.voided && received(view) === 0 && <button type="button" className="projects-cancel inv-danger" onClick={() => voidInvoice(view)}><Ban size={15} /> Void invoice</button>}
              {isAdmin && !view.voided && view.amount > received(view) && <button type="button" className="primary-button" onClick={() => { openPayment(view); setView(null); }}><CreditCard size={15} /> Record payment</button>}
              <button type="button" className="projects-cancel" onClick={() => setView(null)}>Close</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function Metric({ icon, label, value, note, tone }: { icon: ReactNode; label: string; value: string; note: string; tone: 'green' | 'blue' | 'amber' | 'rose' }) {
  return (
    <article className={`pj-kpi tone-${tone}`}>
      <div className="pj-kpi-top"><span className="pj-kpi-icon" aria-hidden="true">{icon}</span><span className="pj-kpi-label">{label}</span></div>
      <div className="pj-kpi-value">{value}</div>
      <div className="pj-kpi-note">{note}</div>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="project-detail-item"><span>{label}</span><strong>{value}</strong></div>;
}
