import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Plus,
  Search,
  X,
  ReceiptText,
  Wallet,
  Clock,
  CheckCircle2,
  Clock3,
  CircleDashed,
  Eye,
  CreditCard,
} from 'lucide-react';
import { ACC } from '../lib/accounts';
import { ledger, type JournalEntry, type JournalLineInput } from '../lib/ledger';

const STORAGE_KEY = 'ista-fortis-expenses-v1';

const CATEGORIES = [
  { label: 'Administration', account: ACC.admin },
  { label: 'Rent & Utilities', account: ACC.rentUtilities },
  { label: 'Bank Charges', account: ACC.bankCharges },
  { label: 'Interest Expense', account: ACC.interest },
  { label: 'Depreciation', account: ACC.depreciation },
  { label: 'Travel & Accommodation', account: ACC.travel },
  { label: 'Other Operating Expenses', account: ACC.otherOperating },
];

type Payment = {
  id: string;
  amount: number;
  date: string;
  method: string;
  reference: string;
  notes: string;
};

type Expense = {
  id: string;
  expenseNumber: string;
  date: string;
  category: string;
  description: string;
  supplier: string;
  amount: number;
  amountPaid: number;
  paymentMethod: string;
  reference: string;
  notes: string;
  payments: Payment[];
  createdAt: string;
};

type ExpenseForm = {
  date: string;
  category: string;
  description: string;
  supplier: string;
  amount: number;
  amountPaid: number;
  paymentMethod: string;
  reference: string;
  notes: string;
};

type PaymentForm = {
  amount: number;
  date: string;
  method: string;
  reference: string;
  notes: string;
};

const money = (amount: number) =>
  new Intl.NumberFormat('en-RW', {
    style: 'currency',
    currency: 'RWF',
    maximumFractionDigits: 0,
  }).format(amount || 0);

const today = () => {
  const date = new Date();
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60000
  );
  return localDate.toISOString().slice(0, 10);
};

function makeId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readExpenses(): Expense[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];

    const parsed = JSON.parse(saved);

    if (!Array.isArray(parsed)) return [];

    return parsed.map((expense) => ({
      ...expense,
      payments: Array.isArray(expense.payments)
        ? expense.payments
        : [],
      amountPaid: Number(expense.amountPaid || 0),
    }));
  } catch {
    return [];
  }
}

function paidAmount(expense: Expense) {
  return Number(expense.amountPaid || 0);
}

function balance(expense: Expense) {
  return Math.max(expense.amount - paidAmount(expense), 0);
}

function expenseStatus(expense: Expense) {
  if (balance(expense) <= 0) return 'Paid';
  if (paidAmount(expense) > 0) return 'Partially Paid';
  return 'Unpaid';
}

function accountForMethod(method: string) {
  if (method === 'Bank transfer' || method === 'Cheque') {
    return ACC.bank;
  }

  if (method === 'Mobile money') {
    return ACC.mobileMoney;
  }

  return ACC.cash;
}

/** Reuses the status pill colours from the Projects page. */
const statusClass = (status: string) =>
  status === 'Paid'
    ? 'status-active'
    : status === 'Partially Paid'
      ? 'status-completed'
      : 'status-on-hold';

function statusIcon(status: string) {
  if (status === 'Paid') return <CheckCircle2 size={14} />;
  if (status === 'Partially Paid') return <Clock3 size={14} />;
  return <CircleDashed size={14} />;
}

const initialExpenseForm = (): ExpenseForm => ({
  date: today(),
  category: 'Administration',
  description: '',
  supplier: '',
  amount: 0,
  amountPaid: 0,
  paymentMethod: 'Cash',
  reference: '',
  notes: '',
});

/**
 * Page styles live here so this page is a single file. They mirror the Projects page and are
 * scoped under .projects-module, so they restyle this page (and its pop-ups) only.
 */
const EXPENSES_CSS = `
.projects-module{--lime:#d5f56b;--lime-ink:#1d2b12;--ink:#1c2b22;--muted:#7d8a83;--line:#edf0f1;display:flex;flex-direction:column;gap:22px;color:var(--ink)}
.projects-module button:focus-visible{outline:2px solid #2f8f6b;outline-offset:2px}

/* header */
.projects-module .welcome-row{margin-bottom:0;gap:20px;flex-wrap:wrap;align-items:flex-end}
.projects-module .welcome-row h2{font-size:28px;font-weight:700;letter-spacing:-.4px;margin:6px 0 4px;color:var(--ink)}
.projects-module .welcome-row p{font-size:13px;color:var(--muted)}
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
.projects-module .exp-filters{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.projects-module .exp-filters select{border-radius:12px;border:1px solid var(--line);height:38px;background:#fff;color:var(--ink);padding:0 10px;font:inherit;font-size:12px}

/* tables */
.projects-module .projects-table th{background:transparent;padding:10px 20px;font-size:11px;font-weight:500;letter-spacing:0;color:#8a968f;border-bottom:1px solid var(--line);white-space:nowrap}
.projects-module .projects-table td{padding:14px 20px;font-size:12px;color:#3b4a42;border-top:0;border-bottom:1px solid #f1f4f4}
.projects-module .projects-table tbody tr:last-child td{border-bottom:0}
.projects-module .projects-table tbody tr:hover{background:#f7faf9}
.projects-module .projects-table strong{font-size:12px;font-weight:600;color:var(--ink)}
.projects-module .money-cell{white-space:nowrap;font-variant-numeric:tabular-nums}
.projects-module .exp-sub{display:block;margin-top:3px;font-size:10.5px;color:var(--muted)}
.projects-module .received-cell .progress-track{background:#eef1f1;border-radius:6px}
.projects-module .received-cell .progress-track i{background:#6fd6a0;border-radius:6px}
.projects-module .project-status{padding:5px 10px;font-weight:600;display:inline-flex;align-items:center;gap:5px;border-radius:999px;font-size:11px;white-space:nowrap}
.projects-module .status-active{background:#bdeed6;color:#1f6b46}
.projects-module .status-completed{background:#c9defb;color:#3a66ad}
.projects-module .status-on-hold{background:#fde5c4;color:#a8691f}
.projects-module .project-row-actions{display:flex;gap:6px}
.projects-module .project-row-actions button,.projects-module .projects-close{border-radius:10px;border:1px solid var(--line)}
.projects-module .project-row-actions button:hover,.projects-module .projects-close:hover{background:#f1f5f4;color:var(--ink)}
.projects-module .projects-empty-icon{background:#ebe8fb;color:#6a5bc2;border-radius:14px}
.projects-module .exp-empty-inline{padding:22px 0;text-align:center;font-size:12px;color:var(--muted)}

/* note */
.projects-module .exp-note{padding:14px 16px;border-radius:14px;background:#eef8f2;color:#3f5a4c;font-size:11.5px;line-height:1.6}

/* pop-ups */
.projects-module .projects-modal{border-radius:18px}
.projects-module .projects-modal-header h3{color:var(--ink)}
.projects-module .projects-field input,.projects-module .projects-field select,.projects-module .projects-field textarea{border-radius:10px;border-color:#e5eaec}
.projects-module .projects-cancel{border-radius:12px;border-color:var(--line)}
.projects-module .project-detail-grid{border-radius:12px}
.projects-module .exp-summary{display:grid;gap:6px;padding:12px 14px;margin:14px 0 0;border-radius:12px;background:#fde5c4;color:#7a4c14;font-size:12.5px}
.projects-module .exp-summary.neutral{background:#eef8f2;color:#3f5a4c}
.projects-module .exp-section-title{font-size:13px;font-weight:600;margin:18px 0 8px;color:var(--ink)}

@media(max-width:1100px){.pj-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:420px){.pj-kpis{grid-template-columns:1fr}}
@media(max-width:600px){.projects-module .projects-table th,.projects-module .projects-table td{padding-left:14px;padding-right:14px}}
@media(prefers-reduced-motion:reduce){.pj-kpi{transition:none}.pj-kpi:hover{transform:none}}
`;

export default function Expenses() {
  const [expenses, setExpenses] = useState<Expense[]>(readExpenses);
  const [entries, setEntries] = useState<readonly JournalEntry[]>(() =>
    ledger.getEntries()
  );

  const [showForm, setShowForm] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [paymentExpense, setPaymentExpense] = useState<Expense | null>(null);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [form, setForm] = useState<ExpenseForm>(initialExpenseForm);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>({
    amount: 0,
    date: today(),
    method: 'Cash',
    reference: '',
    notes: '',
  });

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const persist = (updated: Expense[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    setExpenses(updated);
  };

  useEffect(() => {
    const unsubscribe = ledger.subscribe(() => {
      setEntries(ledger.getEntries());
    });

    return unsubscribe;
  }, []);

  const totalExpenses = expenses.reduce(
    (total, expense) => total + expense.amount,
    0
  );

  const totalPaid = expenses.reduce(
    (total, expense) => total + paidAmount(expense),
    0
  );

  const totalOutstanding = expenses.reduce(
    (total, expense) => total + balance(expense),
    0
  );

  const paidPct =
    totalExpenses > 0 ? Math.round((totalPaid / totalExpenses) * 100) : 0;
  const unsettled = expenses.filter((expense) => balance(expense) > 0).length;

  const filteredExpenses = useMemo(() => {
    const query = search.trim().toLowerCase();

    return expenses
      .filter((expense) => {
        const matchesSearch =
          !query ||
          expense.expenseNumber.toLowerCase().includes(query) ||
          expense.description.toLowerCase().includes(query) ||
          expense.supplier.toLowerCase().includes(query) ||
          expense.reference.toLowerCase().includes(query);

        const matchesCategory =
          categoryFilter === 'all' ||
          expense.category === categoryFilter;

        const matchesStatus =
          statusFilter === 'all' ||
          expenseStatus(expense) === statusFilter;

        return matchesSearch && matchesCategory && matchesStatus;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, search, categoryFilter, statusFilter]);

  const closeForm = () => {
    setShowForm(false);
    setError('');
  };

  const closePayment = () => {
    setPaymentExpense(null);
    setError('');
  };

  const saveExpense = () => {
    setError('');
    setSuccess('');

    if (!form.date) {
      setError('Please select the expense date.');
      return;
    }

    if (!form.description.trim()) {
      setError('Please enter an expense description.');
      return;
    }

    if (!form.category) {
      setError('Please select an expense category.');
      return;
    }

    if (!form.amount || form.amount <= 0) {
      setError('Enter an expense amount greater than zero.');
      return;
    }

    if (
      form.amountPaid < 0 ||
      form.amountPaid > form.amount
    ) {
      setError('The amount paid cannot exceed the total expense.');
      return;
    }

    const category = CATEGORIES.find(
      (item) => item.label === form.category
    );

    if (!category) {
      setError('Invalid expense category.');
      return;
    }

    const id = makeId();
    const expenseNumber = `EXP-${String(expenses.length + 1).padStart(4, '0')}`;

    const expense: Expense = {
      id,
      expenseNumber,
      date: form.date,
      category: form.category,
      description: form.description.trim(),
      supplier: form.supplier.trim(),
      amount: form.amount,
      amountPaid: form.amountPaid,
      paymentMethod: form.paymentMethod,
      reference: form.reference.trim(),
      notes: form.notes.trim(),
      payments: form.amountPaid > 0
        ? [
            {
              id: makeId(),
              amount: form.amountPaid,
              date: form.date,
              method: form.paymentMethod,
              reference: form.reference.trim(),
              notes: 'Initial payment recorded with expense.',
            },
          ]
        : [],
      createdAt: new Date().toISOString(),
    };

    try {
      const lines: JournalLineInput[] = [
        {
          account: category.account,
          debit: form.amount,
          party: form.supplier.trim() || undefined,
          memo: form.description.trim(),
        },
      ];

      if (form.amountPaid > 0) {
        lines.push({
          account: accountForMethod(form.paymentMethod),
          debit: 0,
          credit: form.amountPaid,
          party: form.supplier.trim() || undefined,
          memo: `Initial payment - ${form.description.trim()}`,
        });
      }

      const unpaid = form.amount - form.amountPaid;

      if (unpaid > 0) {
        lines.push({
          account: ACC.payables,
          debit: 0,
          credit: unpaid,
          party: form.supplier.trim() || undefined,
          memo: `Outstanding expense - ${form.description.trim()}`,
        });
      }

      ledger.post({
        date: form.date,
        description: `Expense: ${form.description.trim()}`,
        sourceType: 'expense',
        sourceId: id,
        idempotencyKey: `expense:${id}`,
        reference: form.reference.trim() || expenseNumber,
        lines,
      });

      persist([expense, ...expenses]);
      setEntries(ledger.getEntries());
      setShowForm(false);
      setForm(initialExpenseForm());
      setSuccess(`${expenseNumber} recorded successfully.`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to record the expense.'
      );
    }
  };

  const recordAdditionalPayment = () => {
    setError('');
    setSuccess('');

    if (!paymentExpense) return;

    if (!paymentForm.date) {
      setError('Please select the payment date.');
      return;
    }

    if (!paymentForm.amount || paymentForm.amount <= 0) {
      setError('Enter a payment amount greater than zero.');
      return;
    }

    const outstanding = balance(paymentExpense);

    if (paymentForm.amount > outstanding) {
      setError(
        `Payment cannot exceed the outstanding balance of ${money(outstanding)}.`
      );
      return;
    }

    const paymentNumber = paymentExpense.payments.length + 1;

    try {
      ledger.post({
        date: paymentForm.date,
        description: `Payment for ${paymentExpense.expenseNumber}`,
        sourceType: 'expense',
        sourceId: paymentExpense.id,
        idempotencyKey: `expense-payment:${paymentExpense.id}:${paymentNumber}`,
        reference: paymentForm.reference.trim() || undefined,
        lines: [
          {
            account: ACC.payables,
            debit: paymentForm.amount,
            party: paymentExpense.supplier || undefined,
            memo: `Payment for ${paymentExpense.description}`,
          },
          {
            account: accountForMethod(paymentForm.method),
            credit: paymentForm.amount,
            party: paymentExpense.supplier || undefined,
            memo: `Settlement of ${paymentExpense.expenseNumber}`,
          },
        ],
      });

      const payment: Payment = {
        id: makeId(),
        amount: paymentForm.amount,
        date: paymentForm.date,
        method: paymentForm.method,
        reference: paymentForm.reference.trim(),
        notes: paymentForm.notes.trim(),
      };

      const updated = expenses.map((expense) =>
        expense.id === paymentExpense.id
          ? {
              ...expense,
              amountPaid: expense.amountPaid + payment.amount,
              payments: [...expense.payments, payment],
            }
          : expense
      );

      persist(updated);
      setPaymentExpense(null);
      setPaymentForm({
        amount: 0,
        date: today(),
        method: 'Cash',
        reference: '',
        notes: '',
      });
      setEntries(ledger.getEntries());
      setSuccess('Expense payment recorded successfully.');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to record this payment.'
      );
    }
  };

  const openPayment = (expense: Expense) => {
    setError('');
    setPaymentForm({
      amount: balance(expense),
      date: today(),
      method: 'Cash',
      reference: '',
      notes: '',
    });
    setPaymentExpense(expense);
  };

  const expenseLedgerEntries = entries.filter(
    (entry) => entry.sourceType === 'expense'
  );

  return (
    <section className="projects-module">
      <style>{EXPENSES_CSS}</style>

      <div className="welcome-row">
        <div>
          <div className="eyebrow">FINANCIAL MANAGEMENT</div>
          <h2>Expenses</h2>
          <p>Manage operating expenses, payments and outstanding obligations.</p>
        </div>

        <div className="projects-header-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setError('');
              setSuccess('');
              setShowForm(true);
            }}
          >
            <Plus size={16} /> Record expense
          </button>
        </div>
      </div>

      {success && (
        <div className="projects-import-notice" role="status">
          <span>{success}</span>
          <button onClick={() => setSuccess('')} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}

      <div className="pj-kpis">
        <Metric
          icon={<ReceiptText size={13} />}
          label="Total expenses"
          value={money(totalExpenses)}
          note={`${expenses.length} expense record${expenses.length === 1 ? '' : 's'}`}
          tone="blue"
        />
        <Metric
          icon={<Wallet size={13} />}
          label="Total paid"
          value={money(totalPaid)}
          note={
            totalExpenses > 0
              ? `${paidPct}% of expenses settled`
              : 'No expenses recorded yet'
          }
          tone="green"
        />
        <Metric
          icon={<Clock size={13} />}
          label="Outstanding"
          value={money(totalOutstanding)}
          note={
            unsettled > 0
              ? `${unsettled} expense${unsettled === 1 ? '' : 's'} still to be paid`
              : 'Nothing left to pay'
          }
          tone="amber"
        />
        <Metric
          icon={<CheckCircle2 size={13} />}
          label="Expense records"
          value={String(expenses.length)}
          note={`${expenses.length - unsettled} fully paid`}
          tone="blue"
        />
      </div>

      <div className="panel projects-register">
        <div className="panel-heading projects-heading">
          <div>
            <h3>Expense register</h3>
            <p>
              {filteredExpenses.length} record
              {filteredExpenses.length === 1 ? '' : 's'} displayed
            </p>
          </div>

          <div className="exp-filters">
            <label className="projects-search">
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search expenses..."
              />
            </label>

            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              aria-label="Filter by category"
            >
              <option value="all">All categories</option>
              {CATEGORIES.map((category) => (
                <option key={category.label} value={category.label}>
                  {category.label}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              <option value="Paid">Paid</option>
              <option value="Partially Paid">Partially paid</option>
              <option value="Unpaid">Unpaid</option>
            </select>
          </div>
        </div>

        {filteredExpenses.length === 0 ? (
          <div className="projects-empty">
            <div className="projects-empty-icon">
              <ReceiptText size={24} />
            </div>
            <h3>
              {expenses.length ? 'No matching expenses' : 'No expenses recorded yet'}
            </h3>
            <p>
              {expenses.length
                ? 'Try another search term or filter.'
                : 'Record your first operating expense to start tracking payments and payables.'}
            </p>
            {!expenses.length && (
              <div
                className="projects-header-actions"
                style={{ justifyContent: 'center' }}
              >
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setShowForm(true)}
                >
                  <Plus size={16} /> Record first expense
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="projects-table-wrap">
            <table className="projects-table">
              <thead>
                <tr>
                  <th>Expense</th>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Supplier</th>
                  <th>Total amount</th>
                  <th>Paid</th>
                  <th>Outstanding</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {filteredExpenses.map((expense) => {
                  const status = expenseStatus(expense);
                  const progress =
                    expense.amount > 0
                      ? Math.min((paidAmount(expense) / expense.amount) * 100, 100)
                      : 0;

                  return (
                    <tr key={expense.id}>
                      <td style={{ minWidth: 180 }}>
                        <strong>{expense.description}</strong>
                        <span className="exp-sub">{expense.expenseNumber}</span>
                      </td>
                      <td className="money-cell">{expense.date}</td>
                      <td>{expense.category}</td>
                      <td>{expense.supplier || '—'}</td>
                      <td className="money-cell">{money(expense.amount)}</td>
                      <td>
                        <div className="received-cell">
                          <strong>{money(paidAmount(expense))}</strong>
                          <div className="progress-track">
                            <i style={{ width: `${progress}%` }} />
                          </div>
                          <small>{progress.toFixed(0)}% paid</small>
                        </div>
                      </td>
                      <td className="money-cell">
                        <strong>{money(balance(expense))}</strong>
                      </td>
                      <td>
                        <span className={`project-status ${statusClass(status)}`}>
                          {statusIcon(status)}
                          {status}
                        </span>
                      </td>
                      <td>
                        <div className="project-row-actions">
                          <button
                            type="button"
                            onClick={() => setSelectedExpense(expense)}
                            aria-label={`View ${expense.expenseNumber}`}
                            title="View expense"
                          >
                            <Eye size={15} />
                          </button>

                          {balance(expense) > 0 && (
                            <button
                              type="button"
                              onClick={() => openPayment(expense)}
                              aria-label={`Record payment for ${expense.expenseNumber}`}
                              title="Record payment"
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

      <div className="exp-note">
        <strong>Accounting integration:</strong> expense records and their
        payments are posted to the ledger from this module.{' '}
        <strong>{expenseLedgerEntries.length}</strong> ledger entr
        {expenseLedgerEntries.length === 1 ? 'y is' : 'ies are'} associated
        with expense transactions.
      </div>

      {showForm && (
        <Modal
          eyebrow="NEW EXPENSE"
          title="Record new expense"
          onClose={closeForm}
        >
          {error && (
            <p className="projects-validation" role="alert">
              {error}
            </p>
          )}

          <div className="projects-form-grid">
            <label className="projects-field">
              Expense date *
              <input
                type="date"
                value={form.date}
                onChange={(event) =>
                  setForm({ ...form, date: event.target.value })
                }
              />
            </label>

            <label className="projects-field">
              Expense category *
              <select
                value={form.category}
                onChange={(event) =>
                  setForm({ ...form, category: event.target.value })
                }
              >
                {CATEGORIES.map((category) => (
                  <option key={category.label} value={category.label}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="projects-field">
              Description *
              <input
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                placeholder="Describe the expense"
              />
            </label>

            <label className="projects-field">
              Supplier / recipient
              <input
                value={form.supplier}
                onChange={(event) =>
                  setForm({ ...form, supplier: event.target.value })
                }
                placeholder="Supplier or recipient name"
              />
            </label>

            <label className="projects-field">
              Total expense amount (RWF) *
              <input
                type="number"
                min="1"
                value={form.amount || ''}
                onChange={(event) =>
                  setForm({ ...form, amount: Number(event.target.value) })
                }
                placeholder="Total expense"
              />
            </label>

            <label className="projects-field">
              Amount paid now (RWF)
              <input
                type="number"
                min="0"
                value={form.amountPaid || ''}
                onChange={(event) =>
                  setForm({
                    ...form,
                    amountPaid: Number(event.target.value),
                  })
                }
                placeholder="Amount paid"
              />
            </label>

            <label className="projects-field">
              Payment method
              <select
                value={form.paymentMethod}
                onChange={(event) =>
                  setForm({ ...form, paymentMethod: event.target.value })
                }
              >
                <option>Cash</option>
                <option>Bank transfer</option>
                <option>Mobile money</option>
                <option>Cheque</option>
              </select>
            </label>

            <label className="projects-field">
              Payment reference
              <input
                value={form.reference}
                onChange={(event) =>
                  setForm({ ...form, reference: event.target.value })
                }
                placeholder="Receipt or transaction reference"
              />
            </label>

            <label className="projects-field field-wide">
              Notes
              <textarea
                value={form.notes}
                onChange={(event) =>
                  setForm({ ...form, notes: event.target.value })
                }
                placeholder="Additional information"
                rows={3}
              />
            </label>
          </div>

          {form.amount > 0 && (
            <div className="exp-summary neutral">
              <div>
                Total expense: <strong>{money(form.amount)}</strong>
              </div>
              <div>
                Paid now: <strong>{money(form.amountPaid)}</strong>
              </div>
              <div>
                Remaining payable:{' '}
                <strong>{money(Math.max(form.amount - form.amountPaid, 0))}</strong>
              </div>
            </div>
          )}

          <div className="projects-form-actions">
            <button type="button" className="projects-cancel" onClick={closeForm}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={saveExpense}>
              <Plus size={16} /> Save expense
            </button>
          </div>
        </Modal>
      )}

      {paymentExpense && (
        <Modal
          eyebrow={`${paymentExpense.expenseNumber} · ${paymentExpense.description}`}
          title="Record expense payment"
          onClose={closePayment}
        >
          {error && (
            <p className="projects-validation" role="alert">
              {error}
            </p>
          )}

          <div className="exp-summary" style={{ marginTop: 0, marginBottom: 14 }}>
            <div>
              Outstanding balance:{' '}
              <strong>{money(balance(paymentExpense))}</strong>
            </div>
          </div>

          <div className="projects-form-grid">
            <label className="projects-field">
              Payment date *
              <input
                type="date"
                value={paymentForm.date}
                onChange={(event) =>
                  setPaymentForm({
                    ...paymentForm,
                    date: event.target.value,
                  })
                }
              />
            </label>

            <label className="projects-field">
              Payment amount (RWF) *
              <input
                type="number"
                min="1"
                max={balance(paymentExpense)}
                value={paymentForm.amount || ''}
                onChange={(event) =>
                  setPaymentForm({
                    ...paymentForm,
                    amount: Number(event.target.value),
                  })
                }
              />
            </label>

            <label className="projects-field">
              Payment method
              <select
                value={paymentForm.method}
                onChange={(event) =>
                  setPaymentForm({
                    ...paymentForm,
                    method: event.target.value,
                  })
                }
              >
                <option>Cash</option>
                <option>Bank transfer</option>
                <option>Mobile money</option>
                <option>Cheque</option>
              </select>
            </label>

            <label className="projects-field">
              Reference
              <input
                value={paymentForm.reference}
                onChange={(event) =>
                  setPaymentForm({
                    ...paymentForm,
                    reference: event.target.value,
                  })
                }
                placeholder="Payment reference"
              />
            </label>

            <label className="projects-field field-wide">
              Notes
              <textarea
                value={paymentForm.notes}
                onChange={(event) =>
                  setPaymentForm({
                    ...paymentForm,
                    notes: event.target.value,
                  })
                }
                rows={3}
              />
            </label>
          </div>

          <div className="projects-form-actions">
            <button type="button" className="projects-cancel" onClick={closePayment}>
              Cancel
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={recordAdditionalPayment}
            >
              <CreditCard size={16} /> Record payment
            </button>
          </div>
        </Modal>
      )}

      {selectedExpense && (
        <Modal
          eyebrow={selectedExpense.expenseNumber}
          title={selectedExpense.description}
          onClose={() => setSelectedExpense(null)}
        >
          <span
            className={`project-status ${statusClass(expenseStatus(selectedExpense))}`}
          >
            {statusIcon(expenseStatus(selectedExpense))}
            {expenseStatus(selectedExpense)}
          </span>

          <div className="project-detail-grid">
            <Detail label="Date" value={selectedExpense.date} />
            <Detail label="Category" value={selectedExpense.category} />
            <Detail label="Supplier" value={selectedExpense.supplier || '—'} />
            <Detail label="Total amount" value={money(selectedExpense.amount)} />
            <Detail label="Amount paid" value={money(paidAmount(selectedExpense))} />
            <Detail label="Outstanding" value={money(balance(selectedExpense))} />
            <Detail label="Reference" value={selectedExpense.reference || '—'} />
            <Detail label="Payment method" value={selectedExpense.paymentMethod} />
          </div>

          {selectedExpense.notes && (
            <div className="project-detail-notes">
              <strong>Notes</strong>
              <p>{selectedExpense.notes}</p>
            </div>
          )}

          <h4 className="exp-section-title">
            Payment history ({selectedExpense.payments.length})
          </h4>

          {selectedExpense.payments.length === 0 ? (
            <p className="exp-empty-inline">No payments have been recorded.</p>
          ) : (
            <div className="projects-table-wrap">
              <table className="projects-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedExpense.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="money-cell">{payment.date}</td>
                      <td>{payment.method}</td>
                      <td>{payment.reference || '—'}</td>
                      <td className="money-cell">
                        <strong>{money(payment.amount)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="projects-form-actions">
            {balance(selectedExpense) > 0 && (
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  const expense = selectedExpense;
                  setSelectedExpense(null);
                  openPayment(expense);
                }}
              >
                <CreditCard size={15} /> Record payment
              </button>
            )}
            <button
              type="button"
              className="projects-cancel"
              onClick={() => setSelectedExpense(null)}
            >
              Close
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function Metric({
  icon,
  label,
  value,
  note,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
  tone: 'green' | 'blue' | 'amber' | 'rose';
}) {
  return (
    <article className={`pj-kpi tone-${tone}`}>
      <div className="pj-kpi-top">
        <span className="pj-kpi-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="pj-kpi-label">{label}</span>
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

function Modal({
  eyebrow,
  title,
  onClose,
  children,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="projects-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="projects-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="projects-modal-header">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h3>{title}</h3>
          </div>
          <button
            type="button"
            className="projects-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={19} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
