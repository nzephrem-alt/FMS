import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Plus,
  Search,
  Eye,
  CreditCard,
  X,
  FileText,
  Ban,
  Receipt,
  Wallet,
  Hourglass,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CircleDashed,
} from 'lucide-react';

import { ACC } from '../lib/accounts';
import { ledger } from '../lib/ledger';

type Project = {
  id: string;
  projectName: string;
  client: string;
};

type Payment = {
  id: string;
  amount: number;
  date: string;
  method: string;
  reference: string;
  notes: string;
};

type Invoice = {
  id: string;
  invoiceNumber: string;
  projectId: string;
  projectName: string;
  client: string;
  description: string;
  issueDate: string;
  dueDate: string;
  amount: number;
  payments: Payment[];
  notes: string;
  voided: boolean;
  createdAt: string;
};

type Status =
  | 'Unpaid'
  | 'Partially paid'
  | 'Paid'
  | 'Overdue'
  | 'Void';

const STORAGE_KEY = 'ista-fortis-invoices-v1';
const PROJECTS_KEY = 'ista-fortis-projects-v1';

const today = () => {
  const date = new Date();

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
};

const money = (amount: number) =>
  new Intl.NumberFormat('en-RW', {
    style: 'currency',
    currency: 'RWF',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);

const makeId = () =>
  `INV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

const readList = <T,>(key: string): T[] => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
};

const received = (invoice: Invoice) =>
  (invoice.payments ?? []).reduce(
    (sum, payment) => sum + Number(payment.amount || 0),
    0
  );

const statusOf = (invoice: Invoice): Status => {
  if (invoice.voided) return 'Void';

  const paid = received(invoice);

  if (paid >= invoice.amount) return 'Paid';
  if (paid > 0) return 'Partially paid';

  return invoice.dueDate < today() ? 'Overdue' : 'Unpaid';
};

/**
 * Selects the asset account based on how the client paid.
 */
function cashAccountFor(method: string): string {
  const value = method.toLowerCase();

  if (value.includes('mobile')) {
    return ACC.mobileMoney;
  }

  if (
    value.includes('bank') ||
    value.includes('transfer') ||
    value.includes('cheque')
  ) {
    return ACC.bank;
  }

  return ACC.cash;
}

/**
 * Posts an issued client invoice:
 * Dr Accounts Receivable
 * Cr Contract Revenue
 *
 * The idempotency key prevents duplicate postings.
 */
function postInvoiceToLedger(invoice: Invoice) {
  if (invoice.voided) return;

  ledger.post({
    date: invoice.issueDate,
    description: `Client invoice ${invoice.invoiceNumber} - ${invoice.client}`,
    sourceType: 'client_invoice',
    sourceId: invoice.id,
    idempotencyKey: `client_invoice:${invoice.id}`,
    reference: invoice.invoiceNumber,

    lines: [
      {
        account: ACC.receivables,
        debit: invoice.amount,
        party: invoice.client,
        projectId: invoice.projectId || undefined,
        memo: invoice.invoiceNumber,
      },
      {
        account: ACC.contractRevenue,
        credit: invoice.amount,
        party: invoice.client,
        projectId: invoice.projectId || undefined,
        memo: invoice.description || invoice.invoiceNumber,
      },
    ],
  });
}

/**
 * Posts a client payment:
 * Dr Cash / Bank / Mobile Money
 * Cr Accounts Receivable
 *
 * Each payment has its own idempotency key.
 */
function postClientPaymentToLedger(
  invoice: Invoice,
  payment: Payment
) {
  ledger.post({
    date: payment.date,
    description: `Payment received for ${invoice.invoiceNumber} - ${invoice.client}`,
    sourceType: 'client_payment',
    sourceId: `${invoice.id}:${payment.id}`,
    idempotencyKey: `client_payment:${invoice.id}:${payment.id}`,
    reference: payment.reference || invoice.invoiceNumber,

    lines: [
      {
        account: cashAccountFor(payment.method),
        debit: payment.amount,
        party: invoice.client,
        projectId: invoice.projectId || undefined,
        memo: payment.method,
      },
      {
        account: ACC.receivables,
        credit: payment.amount,
        party: invoice.client,
        projectId: invoice.projectId || undefined,
        memo: invoice.invoiceNumber,
      },
    ],
  });
}

const statusClass: Record<Status, string> = {
  Paid: 'status-active',
  'Partially paid': 'status-completed',
  Unpaid: 'status-on-hold',
  Overdue: 'status-cancelled',
  Void: 'status-void',
};

function statusIcon(status: Status) {
  if (status === 'Paid') return <CheckCircle2 size={14} />;
  if (status === 'Partially paid') return <Clock3 size={14} />;
  if (status === 'Overdue') return <AlertTriangle size={14} />;
  if (status === 'Void') return <Ban size={14} />;
  return <CircleDashed size={14} />;
}

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
.projects-module .projects-secondary-button{height:39px;border-radius:12px;border:1px solid var(--line);background:#fff;color:var(--ink);font-weight:600}
.projects-module .projects-secondary-button:hover{background:#f4f7f6}
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

/* tables */
.projects-module .projects-table th{background:transparent;padding:10px 20px;font-size:11px;font-weight:500;letter-spacing:0;color:#8a968f;border-bottom:1px solid var(--line);white-space:nowrap}
.projects-module .projects-table td{padding:14px 20px;font-size:12px;color:#3b4a42;border-top:0;border-bottom:1px solid #f1f4f4}
.projects-module .projects-table tbody tr:last-child td{border-bottom:0}
.projects-module .projects-table tbody tr:hover{background:#f7faf9}
.projects-module .projects-table strong{font-size:12px;font-weight:600;color:var(--ink)}
.projects-module .money-cell{white-space:nowrap;font-variant-numeric:tabular-nums}
.projects-module .inv-sub{display:block;margin-top:3px;font-size:10.5px;color:var(--muted)}
.projects-module .inv-overdue{color:#b04a58;font-weight:600}
.projects-module .received-cell .progress-track{background:#eef1f1;border-radius:6px}
.projects-module .received-cell .progress-track i{background:#6fd6a0;border-radius:6px}
.projects-module .project-status{padding:5px 10px;font-weight:600;display:inline-flex;align-items:center;gap:5px;border-radius:999px;font-size:11px;white-space:nowrap}
.projects-module .status-active{background:#bdeed6;color:#1f6b46}
.projects-module .status-completed{background:#c9defb;color:#3a66ad}
.projects-module .status-on-hold{background:#fde5c4;color:#a8691f}
.projects-module .status-cancelled{background:#fbd6db;color:#b04a58}
.projects-module .status-void{background:#eceff0;color:#6b776f}
.projects-module .project-row-actions{display:flex;gap:6px}
.projects-module .project-row-actions button,.projects-module .projects-close{border-radius:10px;border:1px solid var(--line)}
.projects-module .project-row-actions button:hover,.projects-module .projects-close:hover{background:#f1f5f4;color:var(--ink)}
.projects-module .projects-empty-icon{background:#ebe8fb;color:#6a5bc2;border-radius:14px}

/* note */
.projects-module .inv-note{padding:14px 16px;border-radius:14px;background:#eef8f2;color:#3f5a4c;font-size:11.5px;line-height:1.6}

/* pop-ups */
.projects-module .projects-modal{border-radius:18px}
.projects-module .projects-modal-header h3{color:var(--ink)}
.projects-module .projects-field input,.projects-module .projects-field select,.projects-module .projects-field textarea{border-radius:10px;border-color:#e5eaec}
.projects-module .projects-cancel{border-radius:12px;border-color:var(--line)}
.projects-module .project-detail-grid{border-radius:12px}
.projects-module .inv-outstanding{background:#fde5c4;color:#8a5517;border-radius:12px;padding:12px 14px;font-size:13px;font-weight:600;margin:0 0 14px}
.projects-module .inv-section-title{font-size:13px;font-weight:600;margin:18px 0 8px;color:var(--ink)}
.projects-module .inv-payment{display:flex;justify-content:space-between;gap:12px;padding:11px 14px;border:1px solid var(--line);border-radius:12px;margin-bottom:8px;font-size:12px;color:#3b4a42}
.projects-module .inv-muted{font-size:12px;color:var(--muted);margin:0}

@media(max-width:1100px){.pj-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:420px){.pj-kpis{grid-template-columns:1fr}}
@media(max-width:600px){.projects-module .projects-table th,.projects-module .projects-table td{padding-left:14px;padding-right:14px}}
@media(prefers-reduced-motion:reduce){.pj-kpi{transition:none}.pj-kpi:hover{transform:none}}
`;

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>(() =>
    readList<Invoice>(STORAGE_KEY)
  );

  const [projects] = useState<Project[]>(() =>
    readList<Project>(PROJECTS_KEY)
  );

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [formOpen, setFormOpen] = useState(false);
  const [paymentFor, setPaymentFor] = useState<Invoice | null>(null);
  const [view, setView] = useState<Invoice | null>(null);

  const [form, setForm] = useState({
    invoiceNumber: '',
    projectId: '',
    client: '',
    description: '',
    issueDate: today(),
    dueDate: '',
    amount: '',
    notes: '',
  });

  const [payment, setPayment] = useState({
    amount: '',
    date: today(),
    method: 'Bank transfer',
    reference: '',
    notes: '',
  });

  /**
   * Save invoice register to browser storage.
   */
  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(invoices)
    );
  }, [invoices]);

  /**
   * Synchronise existing invoices and payments with the ledger.
   *
   * This also backfills older records that were saved before
   * ledger integration was implemented.
   *
   * The ledger idempotency keys prevent duplicate journal entries.
   */
  useEffect(() => {
    try {
      invoices.forEach(invoice => {
        if (invoice.voided) return;

        postInvoiceToLedger(invoice);

        (invoice.payments ?? []).forEach(payment => {
          postClientPaymentToLedger(invoice, payment);
        });
      });
    } catch (error) {
      console.error(
        'Invoice ledger synchronisation failed:',
        error
      );

      alert(
        error instanceof Error
          ? error.message
          : 'Could not synchronise invoices with the accounting ledger.'
      );
    }
  }, [invoices]);

  const active = useMemo(
    () => invoices.filter(invoice => !invoice.voided),
    [invoices]
  );

  const totals = useMemo(() => {
    const invoiced = active.reduce(
      (sum, invoice) => sum + invoice.amount,
      0
    );

    const paid = active.reduce(
      (sum, invoice) => sum + received(invoice),
      0
    );

    const overdueInvoices = active.filter(
      invoice => statusOf(invoice) === 'Overdue'
    );

    const overdue = overdueInvoices.reduce(
      (sum, invoice) =>
        sum + invoice.amount - received(invoice),
      0
    );

    return {
      invoiced,
      paid,
      balance: invoiced - paid,
      overdue,
      overdueCount: overdueInvoices.length,
    };
  }, [active]);

  const collectedPct =
    totals.invoiced > 0
      ? Math.round((totals.paid / totals.invoiced) * 100)
      : 0;

  const filtered = invoices.filter(invoice => {
    const query = search.toLowerCase().trim();

    return (
      (filter === 'All' || statusOf(invoice) === filter) &&
      [
        invoice.invoiceNumber,
        invoice.client,
        invoice.projectName,
        invoice.description,
      ].some(value =>
        (value ?? '').toLowerCase().includes(query)
      )
    );
  });

  const updateForm = (
    key: keyof typeof form,
    value: string
  ) => {
    setForm(current => ({
      ...current,
      [key]: value,
    }));
  };

  const updatePayment = (
    key: keyof typeof payment,
    value: string
  ) => {
    setPayment(current => ({
      ...current,
      [key]: value,
    }));
  };

  function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amount = Number(form.amount);

    if (
      !form.invoiceNumber.trim() ||
      !form.client.trim() ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !form.issueDate ||
      !form.dueDate ||
      form.dueDate < form.issueDate
    ) {
      alert(
        'Check the invoice number, client, amount and dates. The due date must be on or after the issue date.'
      );
      return;
    }

    if (
      invoices.some(
        invoice =>
          invoice.invoiceNumber.toLowerCase() ===
          form.invoiceNumber.trim().toLowerCase()
      )
    ) {
      alert('That invoice number already exists.');
      return;
    }

    const project = projects.find(
      item => item.id === form.projectId
    );

    const invoice: Invoice = {
      id: makeId(),
      invoiceNumber: form.invoiceNumber.trim(),
      projectId: form.projectId,
      projectName:
        project?.projectName || 'General / Unassigned',
      client: form.client.trim(),
      description: form.description.trim(),
      issueDate: form.issueDate,
      dueDate: form.dueDate,
      amount,
      payments: [],
      notes: form.notes.trim(),
      voided: false,
      createdAt: new Date().toISOString(),
    };

    try {
      postInvoiceToLedger(invoice);

      setInvoices(current => [invoice, ...current]);
      setFormOpen(false);

      setForm({
        invoiceNumber: '',
        projectId: '',
        client: '',
        description: '',
        issueDate: today(),
        dueDate: '',
        amount: '',
        notes: '',
      });
    } catch (error) {
      console.error('Invoice posting failed:', error);

      alert(
        error instanceof Error
          ? error.message
          : 'Could not post the invoice to the accounting ledger.'
      );
    }
  }

  function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!paymentFor) return;

    const amount = Number(payment.amount);
    const balance =
      paymentFor.amount - received(paymentFor);

    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > balance ||
      !payment.date
    ) {
      alert(
        `Enter a valid payment greater than zero and no more than ${money(balance)}.`
      );
      return;
    }

    const newPayment: Payment = {
      id: makeId(),
      amount,
      date: payment.date,
      method: payment.method,
      reference: payment.reference.trim(),
      notes: payment.notes.trim(),
    };

    try {
      postClientPaymentToLedger(
        paymentFor,
        newPayment
      );

      setInvoices(current =>
        current.map(invoice =>
          invoice.id === paymentFor.id
            ? {
                ...invoice,
                payments: [
                  ...(invoice.payments ?? []),
                  newPayment,
                ],
              }
            : invoice
        )
      );

      setPaymentFor(null);

      setPayment({
        amount: '',
        date: today(),
        method: 'Bank transfer',
        reference: '',
        notes: '',
      });
    } catch (error) {
      console.error('Client payment posting failed:', error);

      alert(
        error instanceof Error
          ? error.message
          : 'Could not post the payment to the accounting ledger.'
      );
    }
  }

  /**
   * Only unpaid invoices can be voided.
   * Reverse the original revenue/receivable journal first.
   */
  function voidInvoice(invoice: Invoice) {
    if (received(invoice) > 0) {
      alert(
        'This invoice has receipts recorded. Reverse or resolve those receipts before voiding it.'
      );
      return;
    }

    if (
      !window.confirm(
        `Void invoice ${invoice.invoiceNumber}? It will remain in the records but be excluded from totals.`
      )
    ) {
      return;
    }

    try {
      const originalEntries = ledger.activeBySource(
        'client_invoice',
        invoice.id
      );

      originalEntries.forEach(entry => {
        ledger.reverse(
          entry.id,
          `Invoice ${invoice.invoiceNumber} voided`
        );
      });

      setInvoices(current =>
        current.map(item =>
          item.id === invoice.id
            ? { ...item, voided: true }
            : item
        )
      );

      setView(null);
    } catch (error) {
      console.error('Invoice reversal failed:', error);

      alert(
        error instanceof Error
          ? error.message
          : 'Could not reverse the invoice accounting entry.'
      );
    }
  }

  const field = (
    label: string,
    key: keyof typeof form,
    type = 'text',
    required = false
  ) => (
    <label className="projects-field">
      {label}
      {required ? ' *' : ''}
      <input
        type={type}
        required={required}
        value={form[key]}
        onChange={event =>
          updateForm(key, event.target.value)
        }
      />
    </label>
  );

  return (
    <section className="projects-module">
      <style>{INVOICES_CSS}</style>

      <div className="welcome-row">
        <div>
          <div className="eyebrow">FINANCE / RECEIVABLES</div>
          <h2>Client Invoices</h2>
          <p>
            Issue invoices and track client payments and
            outstanding balances.
          </p>
        </div>

        <div className="projects-header-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => setFormOpen(true)}
          >
            <Plus size={16} /> Create invoice
          </button>
        </div>
      </div>

      <div className="pj-kpis">
        <Metric
          title="Total invoiced"
          value={money(totals.invoiced)}
          note={`${active.length} active invoice${active.length === 1 ? '' : 's'}`}
          icon={<Receipt size={13} />}
          tone="blue"
        />
        <Metric
          title="Payments received"
          value={money(totals.paid)}
          note={
            totals.invoiced > 0
              ? `${collectedPct}% of invoiced amount collected`
              : 'No invoices issued yet'
          }
          icon={<Wallet size={13} />}
          tone="green"
        />
        <Metric
          title="Outstanding balance"
          value={money(totals.balance)}
          note="Invoiced but not yet received"
          icon={<Hourglass size={13} />}
          tone="amber"
        />
        <Metric
          title="Overdue balance"
          value={money(totals.overdue)}
          note={
            totals.overdueCount > 0
              ? `${totals.overdueCount} invoice${totals.overdueCount === 1 ? '' : 's'} past the due date`
              : 'Nothing is overdue'
          }
          icon={<AlertTriangle size={13} />}
          tone="rose"
        />
      </div>

      <div className="panel projects-register">
        <div className="panel-heading projects-heading">
          <div>
            <h3>Invoice register</h3>
            <p>
              {filtered.length} record
              {filtered.length === 1 ? '' : 's'} displayed
            </p>
          </div>

          <div className="projects-filters">
            <label className="projects-search">
              <Search size={15} />
              <input
                placeholder="Search invoices..."
                value={search}
                onChange={event =>
                  setSearch(event.target.value)
                }
              />
            </label>

            <select
              value={filter}
              onChange={event =>
                setFilter(event.target.value)
              }
              aria-label="Filter by status"
            >
              {[
                'All',
                'Unpaid',
                'Partially paid',
                'Paid',
                'Overdue',
                'Void',
              ].map(status => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="projects-empty">
            <div className="projects-empty-icon">
              <FileText size={24} />
            </div>
            <h3>
              {invoices.length
                ? 'No matching invoices'
                : 'No invoices yet'}
            </h3>
            <p>
              {invoices.length
                ? 'Try another search term or status filter.'
                : 'Create an invoice to begin tracking receivables.'}
            </p>
            {!invoices.length && (
              <div
                className="projects-header-actions"
                style={{ justifyContent: 'center' }}
              >
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setFormOpen(true)}
                >
                  <Plus size={16} /> Create first invoice
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="projects-table-wrap">
            <table className="projects-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Client / project</th>
                  <th>Issue date</th>
                  <th>Due date</th>
                  <th>Amount</th>
                  <th>Received</th>
                  <th>Balance due</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {filtered.map(invoice => {
                  const status = statusOf(invoice);
                  const paid = received(invoice);
                  const progress =
                    invoice.amount > 0
                      ? Math.min(
                          (paid / invoice.amount) * 100,
                          100
                        )
                      : 0;

                  return (
                    <tr key={invoice.id}>
                      <td>
                        <strong>{invoice.invoiceNumber}</strong>
                      </td>

                      <td>
                        <strong>{invoice.client}</strong>
                        <span className="inv-sub">
                          {invoice.projectName}
                        </span>
                      </td>

                      <td className="money-cell">
                        {invoice.issueDate}
                      </td>

                      <td
                        className={`money-cell${status === 'Overdue' ? ' inv-overdue' : ''}`}
                      >
                        {invoice.dueDate}
                      </td>

                      <td className="money-cell">
                        {money(invoice.amount)}
                      </td>

                      <td>
                        <div className="received-cell">
                          <strong>{money(paid)}</strong>
                          <div className="progress-track">
                            <i style={{ width: `${progress}%` }} />
                          </div>
                          <small>
                            {progress.toFixed(0)}% received
                          </small>
                        </div>
                      </td>

                      <td className="money-cell">
                        <strong>
                          {money(
                            invoice.voided
                              ? 0
                              : invoice.amount - paid
                          )}
                        </strong>
                      </td>

                      <td>
                        <span
                          className={`project-status ${statusClass[status]}`}
                        >
                          {statusIcon(status)}
                          {status}
                        </span>
                      </td>

                      <td>
                        <div className="project-row-actions">
                          <button
                            title="View invoice"
                            aria-label={`View ${invoice.invoiceNumber}`}
                            type="button"
                            onClick={() => setView(invoice)}
                          >
                            <Eye size={15} />
                          </button>

                          {!invoice.voided &&
                            invoice.amount > paid && (
                              <button
                                title="Record payment"
                                aria-label={`Record payment for ${invoice.invoiceNumber}`}
                                type="button"
                                onClick={() =>
                                  setPaymentFor(invoice)
                                }
                              >
                                <CreditCard size={15} />
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="inv-note">
        Invoices and payments are connected to the General
        Ledger. Issued invoices recognise contract revenue,
        while client receipts update Cash &amp; Bank and reduce
        Accounts Receivable. Records are currently stored in
        this browser.
      </div>

      {/* Create invoice modal */}
      {formOpen && (
        <div
          className="projects-modal-backdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget)
              setFormOpen(false);
          }}
        >
          <section
            className="projects-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-form-title"
          >
            <div className="projects-modal-header">
              <div>
                <div className="eyebrow">NEW INVOICE</div>
                <h3 id="invoice-form-title">
                  Create client invoice
                </h3>
              </div>

              <button
                type="button"
                className="projects-close"
                onClick={() => setFormOpen(false)}
                aria-label="Close"
              >
                <X size={19} />
              </button>
            </div>

            <form onSubmit={createInvoice}>
              <div className="projects-form-grid">
                {field(
                  'Invoice number',
                  'invoiceNumber',
                  'text',
                  true
                )}

                <label className="projects-field">
                  Project
                  <select
                    value={form.projectId}
                    onChange={event => {
                      const id = event.target.value;
                      const project = projects.find(
                        item => item.id === id
                      );

                      setForm(current => ({
                        ...current,
                        projectId: id,
                        client:
                          project?.client || current.client,
                      }));
                    }}
                  >
                    <option value="">
                      General / Unassigned
                    </option>

                    {projects.map(project => (
                      <option
                        key={project.id}
                        value={project.id}
                      >
                        {project.projectName}
                      </option>
                    ))}
                  </select>
                </label>

                {field('Client name', 'client', 'text', true)}

                {field(
                  'Invoice amount (RWF)',
                  'amount',
                  'number',
                  true
                )}

                {field(
                  'Issue date',
                  'issueDate',
                  'date',
                  true
                )}

                {field('Due date', 'dueDate', 'date', true)}

                <label className="projects-field field-wide">
                  Description / work billed
                  <textarea
                    rows={3}
                    value={form.description}
                    onChange={event =>
                      updateForm(
                        'description',
                        event.target.value
                      )
                    }
                  />
                </label>

                <label className="projects-field field-wide">
                  Notes
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={event =>
                      updateForm('notes', event.target.value)
                    }
                  />
                </label>
              </div>

              <div className="projects-form-actions">
                <button
                  type="button"
                  className="projects-cancel"
                  onClick={() => setFormOpen(false)}
                >
                  Cancel
                </button>

                <button type="submit" className="primary-button">
                  <Plus size={15} /> Save invoice
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Record client payment modal */}
      {paymentFor && (
        <div
          className="projects-modal-backdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget)
              setPaymentFor(null);
          }}
        >
          <section
            className="projects-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-form-title"
          >
            <div className="projects-modal-header">
              <div>
                <div className="eyebrow">
                  {paymentFor.invoiceNumber} ·{' '}
                  {paymentFor.client}
                </div>
                <h3 id="payment-form-title">
                  Record client payment
                </h3>
              </div>

              <button
                type="button"
                className="projects-close"
                onClick={() => setPaymentFor(null)}
                aria-label="Close"
              >
                <X size={19} />
              </button>
            </div>

            <p className="inv-outstanding">
              Outstanding:{' '}
              {money(
                paymentFor.amount - received(paymentFor)
              )}
            </p>

            <form onSubmit={recordPayment}>
              <div className="projects-form-grid">
                <label className="projects-field">
                  Payment amount (RWF) *
                  <input
                    type="number"
                    min="1"
                    max={
                      paymentFor.amount -
                      received(paymentFor)
                    }
                    required
                    value={payment.amount}
                    onChange={event =>
                      updatePayment(
                        'amount',
                        event.target.value
                      )
                    }
                  />
                </label>

                <label className="projects-field">
                  Payment date *
                  <input
                    type="date"
                    required
                    value={payment.date}
                    onChange={event =>
                      updatePayment('date', event.target.value)
                    }
                  />
                </label>

                <label className="projects-field">
                  Payment method
                  <select
                    value={payment.method}
                    onChange={event =>
                      updatePayment(
                        'method',
                        event.target.value
                      )
                    }
                  >
                    {[
                      'Bank transfer',
                      'Cash',
                      'Mobile money',
                      'Cheque',
                      'Other',
                    ].map(method => (
                      <option key={method}>{method}</option>
                    ))}
                  </select>
                </label>

                <label className="projects-field">
                  Reference
                  <input
                    value={payment.reference}
                    onChange={event =>
                      updatePayment(
                        'reference',
                        event.target.value
                      )
                    }
                  />
                </label>

                <label className="projects-field field-wide">
                  Notes
                  <textarea
                    rows={3}
                    value={payment.notes}
                    onChange={event =>
                      updatePayment('notes', event.target.value)
                    }
                  />
                </label>
              </div>

              <div className="projects-form-actions">
                <button
                  type="button"
                  className="projects-cancel"
                  onClick={() => setPaymentFor(null)}
                >
                  Cancel
                </button>

                <button type="submit" className="primary-button">
                  <CreditCard size={15} /> Save payment
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Invoice details modal */}
      {view && (
        <div
          className="projects-modal-backdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget)
              setView(null);
          }}
        >
          <section
            className="projects-modal project-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invoice-detail-title"
          >
            <div className="projects-modal-header">
              <div>
                <div className="eyebrow">INVOICE DETAILS</div>
                <h3 id="invoice-detail-title">
                  {view.invoiceNumber}
                </h3>
              </div>

              <button
                type="button"
                className="projects-close"
                onClick={() => setView(null)}
                aria-label="Close"
              >
                <X size={19} />
              </button>
            </div>

            <span
              className={`project-status ${statusClass[statusOf(view)]}`}
            >
              {statusIcon(statusOf(view))}
              {statusOf(view)}
            </span>

            <div className="project-detail-grid">
              <Detail label="Client" value={view.client} />
              <Detail label="Project" value={view.projectName} />
              <Detail label="Issue date" value={view.issueDate} />
              <Detail label="Due date" value={view.dueDate} />
              <Detail
                label="Invoice amount"
                value={money(view.amount)}
              />
              <Detail
                label="Received"
                value={money(received(view))}
              />
              <Detail
                label="Outstanding"
                value={money(
                  view.voided
                    ? 0
                    : view.amount - received(view)
                )}
              />
            </div>

            <h4 className="inv-section-title">Description</h4>
            <p className="inv-muted">
              {view.description || 'No description provided.'}
            </p>

            {view.notes && (
              <div className="project-detail-notes">
                <strong>Notes</strong>
                <p>{view.notes}</p>
              </div>
            )}

            <h4 className="inv-section-title">
              Payment history ({(view.payments ?? []).length})
            </h4>

            {(view.payments ?? []).length === 0 ? (
              <p className="inv-muted">No payments recorded.</p>
            ) : (
              view.payments.map(item => (
                <div key={item.id} className="inv-payment">
                  <span>
                    {item.date} · {item.method}
                    {item.reference
                      ? ` · ${item.reference}`
                      : ''}
                  </span>

                  <strong>{money(item.amount)}</strong>
                </div>
              ))
            )}

            <div className="projects-form-actions">
              {!view.voided && received(view) === 0 && (
                <button
                  type="button"
                  className="projects-cancel"
                  onClick={() => voidInvoice(view)}
                >
                  <Ban size={14} /> Void invoice
                </button>
              )}

              {!view.voided && view.amount > received(view) && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    setPaymentFor(view);
                    setView(null);
                  }}
                >
                  <CreditCard size={14} /> Record payment
                </button>
              )}

              <button
                type="button"
                className="projects-cancel"
                onClick={() => setView(null)}
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function Metric({
  title,
  value,
  note,
  icon,
  tone,
}: {
  title: string;
  value: string;
  note: string;
  icon: ReactNode;
  tone: 'green' | 'blue' | 'amber' | 'rose';
}) {
  return (
    <article className={`pj-kpi tone-${tone}`}>
      <div className="pj-kpi-top">
        <span className="pj-kpi-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="pj-kpi-label">{title}</span>
      </div>
      <div className="pj-kpi-value">{value}</div>
      <div className="pj-kpi-note">{note}</div>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="project-detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}