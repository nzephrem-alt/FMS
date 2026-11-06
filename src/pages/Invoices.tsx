import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Plus, Search, Eye, CreditCard, X, FileText, Ban, HandCoins, Wallet, AlertTriangle, Download, Trash2 } from 'lucide-react';
import { postClientInvoice, postClientPayment, reverseClientInvoice, syncStoredInvoices } from '../lib/postings'; // LEDGER
import { useAccess } from '../lib/access';
import { downloadInvoicePdf } from '../lib/invoicePdf';

type Project = { id: string; projectName: string; client: string };
type Payment = { id: string; amount: number; date: string; method: string; reference: string; notes: string };
type VatMode = 'exclusive' | 'inclusive' | 'none';
type Item = { description: string; quantity: number; unitPrice: number };
type Invoice = {
  id: string; invoiceNumber: string; projectId: string; projectName: string; client: string; clientAddress?: string; clientTin?: string; clientPhone?: string;
  description: string; issueDate: string; dueDate: string;
  amount: number;
  items?: Item[];
  /** Only a note on the invoice: whether the prices include VAT. No VAT is calculated. */
  vatMode?: VatMode;
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
type ItemRow = { description: string; quantity: string; unitPrice: string };
const blankItem = (): ItemRow => ({ description: '', quantity: '1', unitPrice: '' });
const blankForm = () => ({ invoiceNumber: '', projectId: '', client: '', clientAddress: '', clientTin: '', clientPhone: '', issueDate: today(), dueDate: '', notes: '', vatMode: 'exclusive' as VatMode, items: [blankItem()] });

/* ---------- items and the VAT note ---------- */
const VAT_LABEL: Record<VatMode, string> = { exclusive: 'VAT exclusive', inclusive: 'VAT inclusive', none: 'Not stated' };
const lineTotal = (quantity: number, unitPrice: number) => Math.round(quantity * unitPrice);
/** Older invoices had one amount and one description: they show as a single item without VAT. */
const itemsOf = (inv: Invoice): Item[] =>
  inv.items?.length ? inv.items : [{ description: inv.description || 'Works as agreed', quantity: 1, unitPrice: inv.amount }];
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));
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
.projects-module .inv-items{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:14px;background:#f7faf9}
.projects-module .inv-items-head{font-size:12.5px;font-weight:600;color:#3b4a42}
.projects-module .inv-item{display:grid;grid-template-columns:minmax(0,1fr) 80px 140px 120px 36px;gap:10px;align-items:end;padding-bottom:10px;border-bottom:1px solid var(--line)}
.projects-module .inv-item .projects-field input{background:#fff}
.projects-module .inv-item-total{display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--muted);padding-bottom:11px}
.projects-module .inv-item-total strong{font-size:13px;color:var(--ink);white-space:nowrap;font-variant-numeric:tabular-nums}
.projects-module .inv-item-remove{height:40px;width:36px;display:grid;place-items:center;border:1px solid var(--line);border-radius:10px;background:#fff;color:#a63a49;cursor:pointer}
.projects-module .inv-item-remove:disabled{opacity:.35;cursor:default}
.projects-module .inv-add-item{align-self:flex-start;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border:1px dashed #b9d8c6;border-radius:10px;background:#fff;color:#1f6b46;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}
.projects-module .inv-add-item:hover{background:#eef8f2}
.projects-module .inv-sums{display:flex;flex-direction:column;gap:6px;margin-left:auto;min-width:260px;font-size:12.5px}
.projects-module .inv-sums div{display:flex;justify-content:space-between;gap:16px;color:var(--muted)}
.projects-module .inv-sums strong{color:var(--ink);font-variant-numeric:tabular-nums}
.projects-module .inv-sums .inv-sum-total{padding:9px 12px;border-radius:10px;background:var(--lime);color:var(--lime-ink);font-weight:700;font-size:13.5px}
.projects-module .inv-sums .inv-sum-total strong{color:var(--lime-ink)}
@media(max-width:640px){
  .projects-module .inv-item{grid-template-columns:minmax(0,1fr) minmax(0,1fr) 36px}
  .projects-module .inv-item-desc{grid-column:1/-1}
  .projects-module .inv-item-total{grid-column:1/3;flex-direction:row;justify-content:space-between;padding-bottom:0}
  .projects-module .inv-sums{min-width:0;width:100%}
}

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
  const [pdfBusy, setPdfBusy] = useState('');

  /** Saves the invoice as a PDF file, ready to send to the client. */
  const downloadPdf = async (invoice: Invoice) => {
    setPdfBusy(invoice.id);
    try { await downloadInvoicePdf({ ...invoice, items: itemsOf(invoice), vatMode: invoice.vatMode ?? 'none' }); }
    catch (e) { window.alert(errText(e, 'Could not create the PDF. Check the internet connection and try again.')); }
    finally { setPdfBusy(''); }
  };

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
      [i.invoiceNumber, i.client, i.clientAddress ?? '', i.clientTin ?? '', i.clientPhone ?? '', i.projectName, i.description].some(v => v.toLowerCase().includes(q));
  });
  const updateForm = (key: 'invoiceNumber' | 'client' | 'clientAddress' | 'clientTin' | 'clientPhone' | 'issueDate' | 'dueDate' | 'notes', value: string) => setForm(current => ({ ...current, [key]: value }));
  const setItem = (n: number, key: keyof ItemRow, value: string) => setForm(current => ({ ...current, items: current.items.map((r, i) => (i === n ? { ...r, [key]: value } : r)) }));
  const addItem = () => setForm(current => ({ ...current, items: [...current.items, blankItem()] }));
  const removeItem = (n: number) => setForm(current => ({ ...current, items: current.items.length > 1 ? current.items.filter((_, i) => i !== n) : current.items }));
  const formTotal = form.items.reduce((s, r) => s + lineTotal(Number(r.quantity) || 0, Number(r.unitPrice) || 0), 0);
  const updatePayment = (key: keyof typeof payment, value: string) => setPayment(current => ({ ...current, [key]: value }));

  const openForm = () => { setFormError(''); setFormOpen(true); };
  const closeForm = () => { setFormOpen(false); setFormError(''); };
  const openPayment = (invoice: Invoice) => { setPayError(''); setPaymentFor(invoice); };
  const closePayment = () => { setPaymentFor(null); setPayError(''); };

  function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    if (!form.invoiceNumber.trim() || !form.client.trim() || !form.dueDate || form.dueDate < form.issueDate) {
      setFormError('Check the invoice number, client and dates. The due date must be on or after the issue date.'); return;
    }
    const rows = form.items.filter(r => r.description.trim() || r.unitPrice);
    if (!rows.length) { setFormError('Add at least one item with a description and a price.'); return; }
    const items: Item[] = [];
    for (const [n, r] of rows.entries()) {
      const quantity = Number(r.quantity); const unitPrice = Number(r.unitPrice);
      if (!r.description.trim()) { setFormError(`Item ${n + 1}: enter a description.`); return; }
      if (!(quantity > 0)) { setFormError(`Item ${n + 1}: the quantity must be more than zero.`); return; }
      if (!Number.isInteger(unitPrice) || unitPrice <= 0) { setFormError(`Item ${n + 1}: enter the unit price in whole RWF.`); return; }
      items.push({ description: r.description.trim(), quantity, unitPrice });
    }
    const amount = items.reduce((s, it) => s + lineTotal(it.quantity, it.unitPrice), 0);
    const tin = form.clientTin.replace(/\s+/g, '');
    if (tin && !/^\d{9}$/.test(tin)) { setFormError('A TIN has 9 digits. Correct it, or leave it empty if the client has no TIN.'); return; }
    const phone = form.clientPhone.trim();
    if (phone.replace(/\D/g, '').length < 10 || !/^\+?[\d\s-]+$/.test(phone)) { setFormError("Enter the client's contact phone, e.g. 0788 123 456 or +250 788 123 456."); return; }
    if (invoices.some(i => i.invoiceNumber.toLowerCase() === form.invoiceNumber.trim().toLowerCase())) {
      setFormError('That invoice number already exists.'); return;
    }
    const project = projects.find(p => p.id === form.projectId);
    const invoice: Invoice = {
      id: makeId(), invoiceNumber: form.invoiceNumber.trim(), projectId: form.projectId,
      projectName: project?.projectName || 'General / Unassigned', client: form.client.trim(), clientAddress: form.clientAddress.trim(), clientTin: tin, clientPhone: phone,
      description: items.map(it => it.description).join('; '), issueDate: form.issueDate, dueDate: form.dueDate,
      amount, items, vatMode: form.vatMode, payments: [], notes: form.notes.trim(), voided: false, createdAt: new Date().toISOString(),
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

  const field = (label: string, key: 'invoiceNumber' | 'client' | 'issueDate' | 'dueDate', type = 'text', required = false) => (
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
                        <button type="button" title="Download PDF" aria-label={`Download invoice ${i.invoiceNumber} as PDF`} onClick={() => { void downloadPdf(i); }} disabled={pdfBusy === i.id}><Download size={15} /></button>
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
                <label className="projects-field">VAT
                  <select value={form.vatMode} onChange={e => setForm(current => ({ ...current, vatMode: e.target.value as VatMode }))}>
                    {(['exclusive', 'inclusive'] as VatMode[]).map(m => <option key={m} value={m}>{VAT_LABEL[m]}</option>)}
                  </select>
                </label>
                <label className="projects-field">Client TIN
                  <input inputMode="numeric" maxLength={11} value={form.clientTin} onChange={e => updateForm('clientTin', e.target.value)} placeholder="9 digits, if the client has one" />
                </label>
                <label className="projects-field">Contact phone *
                  <input type="tel" required value={form.clientPhone} onChange={e => updateForm('clientPhone', e.target.value)} placeholder="e.g. 0788 123 456" />
                </label>
                <label className="projects-field field-wide">Client address
                  <input value={form.clientAddress} onChange={e => updateForm('clientAddress', e.target.value)} placeholder="e.g. KG 11 Ave, Gasabo, Kigali" />
                </label>
                {field('Issue date', 'issueDate', 'date', true)}
                {field('Due date', 'dueDate', 'date', true)}
                <div className="field-wide inv-items">
                  <div className="inv-items-head"><span>Items *</span></div>
                  {form.items.map((r, n) => (
                    <div className="inv-item" key={n}>
                      <label className="projects-field inv-item-desc">Description
                        <input value={r.description} onChange={e => setItem(n, 'description', e.target.value)} placeholder="e.g. Excavation works" />
                      </label>
                      <label className="projects-field inv-item-qty">Qty
                        <input type="number" min="0" step="any" value={r.quantity} onChange={e => setItem(n, 'quantity', e.target.value)} />
                      </label>
                      <label className="projects-field inv-item-price">Unit price (RWF)
                        <input type="number" min="0" step="1" value={r.unitPrice} onChange={e => setItem(n, 'unitPrice', e.target.value)} />
                      </label>
                      <div className="inv-item-total"><span>Amount</span><strong>{money(lineTotal(Number(r.quantity) || 0, Number(r.unitPrice) || 0))}</strong></div>
                      <button type="button" className="inv-item-remove" onClick={() => removeItem(n)} disabled={form.items.length === 1} aria-label={`Remove item ${n + 1}`} title="Remove item"><Trash2 size={15} /></button>
                    </div>
                  ))}
                  <button type="button" className="inv-add-item" onClick={addItem}><Plus size={15} /> Add item</button>
                  <div className="inv-sums">
                    <div className="inv-sum-total"><span>Total</span><strong>{money(formTotal)}</strong></div>
                    <div><span>Prices are {form.vatMode === 'inclusive' ? 'VAT inclusive' : 'VAT exclusive'}</span></div>
                  </div>
                </div>
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
              <Detail label="Client TIN" value={view.clientTin || '—'} />
              <Detail label="Contact phone" value={view.clientPhone || '—'} />
              <Detail label="Client address" value={view.clientAddress || '—'} />
              <Detail label="Project" value={view.projectName} />
              <Detail label="Issue date" value={view.issueDate} />
              <Detail label="Due date" value={view.dueDate} />
              <Detail label="Invoice amount" value={money(view.amount)} />
              <Detail label="VAT" value={VAT_LABEL[view.vatMode ?? 'none']} />
              <Detail label="Received" value={money(received(view))} />
              <Detail label="Outstanding" value={money(view.voided ? 0 : view.amount - received(view))} />
            </div>
            <h4 className="inv-section-title">Items</h4>
            {itemsOf(view).map((it, n) => (
              <div key={n} className="inv-pay">
                <span>{it.description}{it.quantity !== 1 ? ` · ${qtyText(it.quantity)} × ${money(it.unitPrice)}` : ''}</span>
                <strong>{money(lineTotal(it.quantity, it.unitPrice))}</strong>
              </div>
            ))}
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
              <button type="button" className="projects-cancel" onClick={() => { void downloadPdf(view); }} disabled={pdfBusy === view.id}><Download size={15} /> {pdfBusy === view.id ? 'Preparing…' : 'Download PDF'}</button>
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
