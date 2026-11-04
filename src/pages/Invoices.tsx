import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { Plus, Search, Eye, CreditCard, X, FileText, Ban } from 'lucide-react';
import { postClientInvoice, postClientPayment, reverseClientInvoice, syncStoredInvoices } from '../lib/postings'; // LEDGER

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

const styles: Record<string, CSSProperties> = {
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #dce3df', borderRadius: 8, fontSize: 13, background: '#fff', color: '#24332b' },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#526158', marginBottom: 6 },
  button: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 14px', border: 0, borderRadius: 8, background: '#176b45', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  secondary: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 12px', border: '1px solid #dce3df', borderRadius: 8, background: '#fff', color: '#526158', fontSize: 12, cursor: 'pointer' },
  overlay: { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(18,29,23,.48)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: { width: '100%', maxWidth: 650, maxHeight: '90vh', overflowY: 'auto', background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,.18)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 },
};

function StatusBadge({ status }: { status: Status }) {
  const colors: Record<Status, [string, string]> = {
    Unpaid: ['#f1f5f2', '#526158'], 'Partially paid': ['#fff4dc', '#956300'],
    Paid: ['#e5f5eb', '#176b45'], Overdue: ['#fdebea', '#b42318'], Void: ['#eee', '#777'],
  };
  return <span style={{ background: colors[status][0], color: colors[status][1], padding: '5px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{status}</span>;
}

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>(() => readList<Invoice>(STORAGE_KEY));
  const [projects] = useState<Project[]>(() => readList<Project>(PROJECTS_KEY));
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [formOpen, setFormOpen] = useState(false);
  const [paymentFor, setPaymentFor] = useState<Invoice | null>(null);
  const [view, setView] = useState<Invoice | null>(null);
  const [form, setForm] = useState({ invoiceNumber: '', projectId: '', client: '', description: '', issueDate: today(), dueDate: '', amount: '', notes: '' });
  const [payment, setPayment] = useState({ amount: '', date: today(), method: 'Bank transfer', reference: '', notes: '' });

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
    const overdue = active.filter(i => statusOf(i) === 'Overdue').reduce((s, i) => s + i.amount - received(i), 0);
    return { invoiced, paid, balance: invoiced - paid, overdue };
  }, [active]);
  const filtered = invoices.filter(i => {
    const q = search.toLowerCase();
    return (filter === 'All' || statusOf(i) === filter) &&
      [i.invoiceNumber, i.client, i.projectName, i.description].some(v => v.toLowerCase().includes(q));
  });
  const updateForm = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));
  const updatePayment = (key: keyof typeof payment, value: string) => setPayment(current => ({ ...current, [key]: value }));

  function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(form.amount);
    if (!form.invoiceNumber.trim() || !form.client.trim() || !Number.isInteger(amount) || amount <= 0 || !form.dueDate || form.dueDate < form.issueDate) {
      alert('Check the invoice number, client, amount (whole RWF) and dates. The due date must be on or after the issue date.'); return;
    }
    if (invoices.some(i => i.invoiceNumber.toLowerCase() === form.invoiceNumber.trim().toLowerCase())) {
      alert('That invoice number already exists.'); return;
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
    catch (e) { alert(errText(e, 'Could not post the invoice to the ledger.')); return; }
    setInvoices(current => [invoice, ...current]); setFormOpen(false);
    setForm({ invoiceNumber: '', projectId: '', client: '', description: '', issueDate: today(), dueDate: '', amount: '', notes: '' });
  }

  function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!paymentFor) return;
    const amount = Number(payment.amount); const balance = paymentFor.amount - received(paymentFor);
    if (!Number.isInteger(amount) || amount <= 0 || amount > balance) { alert(`Enter a whole RWF payment greater than zero and no more than ${money(balance)}.`); return; }
    const newPayment: Payment = { id: makeId(), amount, date: payment.date, method: payment.method, reference: payment.reference.trim(), notes: payment.notes.trim() };
    // LEDGER: post first, so a payment is never saved without its journal entry
    try { postClientInvoice(paymentFor); postClientPayment(paymentFor, newPayment); }
    catch (e) { alert(errText(e, 'Could not post the payment to the ledger.')); return; }
    setInvoices(current => current.map(i => i.id === paymentFor.id ? { ...i, payments: [...i.payments, newPayment] } : i));
    setPaymentFor(null); setPayment({ amount: '', date: today(), method: 'Bank transfer', reference: '', notes: '' });
  }

  function voidInvoice(invoice: Invoice) {
    if (received(invoice) > 0) { alert('This invoice has receipts recorded. Reverse or resolve those receipts before voiding it.'); return; }
    if (!window.confirm(`Void invoice ${invoice.invoiceNumber}? It will remain in the records but be excluded from totals.`)) return;
    // LEDGER: post the reversing entry first
    try { reverseClientInvoice(invoice.id, `Invoice ${invoice.invoiceNumber} voided`); }
    catch (e) { alert(errText(e, 'Could not void the invoice in the ledger.')); return; }
    setInvoices(current => current.map(i => i.id === invoice.id ? { ...i, voided: true } : i)); setView(null);
  }

  const field = (label: string, key: keyof typeof form, type = 'text', required = false) => (
    <div><label style={styles.label}>{label}</label><input style={styles.input} type={type} required={required} value={form[key]} onChange={e => updateForm(key, e.target.value)} /></div>
  );
  const card: CSSProperties = { background: '#fff', border: '1px solid #e8ede9', borderRadius: 12, padding: 17 };

  return <div style={{ display: 'grid', gap: 20, color: '#24332b' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
      <div><div style={{ fontSize: 12, color: '#718078', fontWeight: 600 }}>FINANCE / RECEIVABLES</div><h1 style={{ fontSize: 24, margin: '5px 0' }}>Client Invoices</h1><p style={{ fontSize: 13, color: '#718078', margin: 0 }}>Issue invoices and track client payments and outstanding balances.</p></div>
      <button type="button" style={styles.button} onClick={() => setFormOpen(true)}><Plus size={16} /> Create invoice</button>
    </header>

    <div style={styles.grid}>
      {([['Total invoiced', totals.invoiced], ['Payments received', totals.paid], ['Outstanding balance', totals.balance], ['Overdue balance', totals.overdue]] as [string, number][]).map(([label, value]) => <div key={label} style={card}><div style={{ color: '#718078', fontSize: 12 }}>{label}</div><div style={{ fontSize: 21, fontWeight: 700, marginTop: 8 }}>{money(value)}</div></div>)}
    </div>

    <section style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, borderBottom: '1px solid #edf0ed' }}>
        <div><h3 style={{ fontSize: 15, margin: 0 }}>Invoice register</h3><p style={{ fontSize: 11, color: '#89958e', margin: '4px 0 0' }}>{filtered.length} record(s)</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: '#89958e' }} /><input style={{ ...styles.input, width: 210, paddingLeft: 32 }} placeholder="Search invoices..." value={search} onChange={e => setSearch(e.target.value)} /></div><select style={{ ...styles.input, width: 'auto' }} value={filter} onChange={e => setFilter(e.target.value)}>{['All', 'Unpaid', 'Partially paid', 'Paid', 'Overdue', 'Void'].map(s => <option key={s}>{s}</option>)}</select></div>
      </div>
      {filtered.length === 0 ? <div style={{ textAlign: 'center', padding: 45, color: '#89958e' }}><FileText size={30} /><p>No invoices found. Create an invoice to begin tracking receivables.</p></div> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 850, borderCollapse: 'collapse', fontSize: 12 }}><thead><tr style={{ background: '#f7f9f7', color: '#718078' }}>{['INVOICE', 'CLIENT / PROJECT', 'ISSUE DATE', 'DUE DATE', 'AMOUNT', 'BALANCE DUE', 'STATUS', 'ACTIONS'].map(h => <th key={h} style={{ textAlign: 'left', padding: 12, fontSize: 10, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead><tbody>{filtered.map(i => <tr key={i.id} style={{ borderTop: '1px solid #edf0ed' }}><td style={{ padding: 13, fontWeight: 700 }}>{i.invoiceNumber}</td><td style={{ padding: 13 }}><strong>{i.client}</strong><div style={{ color: '#89958e', marginTop: 3 }}>{i.projectName}</div></td><td style={{ padding: 13 }}>{i.issueDate}</td><td style={{ padding: 13 }}>{i.dueDate}</td><td style={{ padding: 13 }}>{money(i.amount)}</td><td style={{ padding: 13, fontWeight: 700 }}>{money(i.voided ? 0 : i.amount - received(i))}</td><td style={{ padding: 13 }}><StatusBadge status={statusOf(i)} /></td><td style={{ padding: 13, whiteSpace: 'nowrap' }}><button title="View invoice" type="button" style={styles.secondary} onClick={() => setView(i)}><Eye size={14} /></button>{!i.voided && i.amount > received(i) && <button title="Record payment" type="button" style={{ ...styles.secondary, marginLeft: 5 }} onClick={() => setPaymentFor(i)}><CreditCard size={14} /></button>}</td></tr>)}</tbody></table></div>}
    </section>
    <div style={{ padding: 13, borderRadius: 9, background: '#f2f7f3', color: '#526158', fontSize: 11, lineHeight: 1.6 }}>Each invoice is posted to the ledger as debit Accounts Receivable and credit Contract Revenue. Each payment is posted as debit Cash, Bank or Mobile Money and credit Accounts Receivable. Voiding an invoice posts a reversing entry.</div>

    {formOpen && <div style={styles.overlay}><section style={styles.modal}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}><div><h2 style={{ fontSize: 18, margin: 0 }}>Create client invoice</h2><p style={{ fontSize: 12, color: '#89958e' }}>Enter the invoice details.</p></div><button type="button" style={styles.secondary} onClick={() => setFormOpen(false)}><X size={17} /></button></div><form onSubmit={createInvoice}><div style={styles.grid}>
      {field('Invoice number', 'invoiceNumber', 'text', true)}
      <div><label style={styles.label}>Project</label><select style={styles.input} value={form.projectId} onChange={e => { const id = e.target.value; const p = projects.find(x => x.id === id); setForm(current => ({ ...current, projectId: id, client: p?.client || current.client })); }}><option value="">General / Unassigned</option>{projects.map(p => <option key={p.id} value={p.id}>{p.projectName}</option>)}</select></div>
      {field('Client name', 'client', 'text', true)}{field('Invoice amount (RWF)', 'amount', 'number', true)}{field('Issue date', 'issueDate', 'date', true)}{field('Due date', 'dueDate', 'date', true)}
      <div style={{ gridColumn: '1 / -1' }}><label style={styles.label}>Description / work billed</label><textarea style={{ ...styles.input, minHeight: 70 }} value={form.description} onChange={e => updateForm('description', e.target.value)} /></div>
      <div style={{ gridColumn: '1 / -1' }}><label style={styles.label}>Notes</label><textarea style={{ ...styles.input, minHeight: 55 }} value={form.notes} onChange={e => updateForm('notes', e.target.value)} /></div>
      </div><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}><button type="button" style={styles.secondary} onClick={() => setFormOpen(false)}>Cancel</button><button type="submit" style={styles.button}><Plus size={15} /> Save invoice</button></div></form></section></div>}

    {paymentFor && <div style={styles.overlay}><section style={styles.modal}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}><div><h2 style={{ fontSize: 18, margin: 0 }}>Record client payment</h2><p style={{ color: '#89958e', fontSize: 12 }}>{paymentFor.invoiceNumber} · {paymentFor.client}</p></div><button type="button" style={styles.secondary} onClick={() => setPaymentFor(null)}><X size={17} /></button></div><p style={{ background: '#f7f9f7', padding: 12, borderRadius: 8, fontWeight: 700 }}>Outstanding: {money(paymentFor.amount - received(paymentFor))}</p><form onSubmit={recordPayment}><div style={styles.grid}><div><label style={styles.label}>Payment amount (RWF)</label><input style={styles.input} type="number" required value={payment.amount} onChange={e => updatePayment('amount', e.target.value)} /></div><div><label style={styles.label}>Payment date</label><input style={styles.input} type="date" required value={payment.date} onChange={e => updatePayment('date', e.target.value)} /></div><div><label style={styles.label}>Payment method</label><select style={styles.input} value={payment.method} onChange={e => updatePayment('method', e.target.value)}>{['Bank transfer', 'Cash', 'Mobile money', 'Cheque', 'Other'].map(m => <option key={m}>{m}</option>)}</select></div><div><label style={styles.label}>Reference</label><input style={styles.input} value={payment.reference} onChange={e => updatePayment('reference', e.target.value)} /></div><div style={{ gridColumn: '1 / -1' }}><label style={styles.label}>Notes</label><textarea style={styles.input} value={payment.notes} onChange={e => updatePayment('notes', e.target.value)} /></div></div><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}><button type="button" style={styles.secondary} onClick={() => setPaymentFor(null)}>Cancel</button><button type="submit" style={styles.button}><CreditCard size={15} /> Save payment</button></div></form></section></div>}

    {view && <div style={styles.overlay}><section style={styles.modal}><div style={{ display: 'flex', justifyContent: 'space-between' }}><div><small style={{ color: '#718078' }}>INVOICE DETAILS</small><h2 style={{ margin: '5px 0 10px' }}>{view.invoiceNumber}</h2><StatusBadge status={statusOf(view)} /></div><button type="button" style={styles.secondary} onClick={() => setView(null)}><X size={17} /></button></div><div style={{ ...styles.grid, marginTop: 18 }}>{[['Client', view.client], ['Project', view.projectName], ['Issue date', view.issueDate], ['Due date', view.dueDate], ['Invoice amount', money(view.amount)], ['Received', money(received(view))], ['Outstanding', money(view.voided ? 0 : view.amount - received(view))]].map(([k, v]) => <div key={k} style={{ background: '#f7f9f7', padding: 10, borderRadius: 8 }}><small style={{ color: '#89958e' }}>{k}</small><div style={{ fontSize: 12, fontWeight: 600, marginTop: 5 }}>{v}</div></div>)}</div><h3 style={{ fontSize: 14, marginTop: 20 }}>Description</h3><p style={{ fontSize: 12, color: '#526158' }}>{view.description || 'No description provided.'}</p><h3 style={{ fontSize: 14 }}>Payment history ({view.payments.length})</h3>{view.payments.length === 0 ? <p style={{ fontSize: 12, color: '#89958e' }}>No payments recorded.</p> : view.payments.map(p => <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 10, border: '1px solid #edf0ed', borderRadius: 8, marginBottom: 7 }}><span style={{ fontSize: 12 }}>{p.date} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</span><strong style={{ fontSize: 12 }}>{money(p.amount)}</strong></div>)}<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>{!view.voided && received(view) === 0 && <button type="button" style={{ ...styles.secondary, color: '#b42318' }} onClick={() => voidInvoice(view)}><Ban size={14} /> Void invoice</button>}{!view.voided && view.amount > received(view) && <button type="button" style={styles.button} onClick={() => { setPaymentFor(view); setView(null); }}><CreditCard size={14} /> Record payment</button>}<button type="button" style={styles.secondary} onClick={() => setView(null)}>Close</button></div></section></div>}
  </div>;
}
