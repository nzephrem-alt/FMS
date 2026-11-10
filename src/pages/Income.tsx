import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Wallet,
  Plus,
  Search,
  X,
  TrendingUp,
  FileText,
  HandCoins,
  BriefcaseBusiness,
  ArrowRightLeft,
} from 'lucide-react';
import { ACC } from '../lib/accounts';
import { ledger, type JournalEntry } from '../lib/ledger';
import { useAccess } from '../lib/access';
import { PROJECT_RECEIPT_PREFIX, projectReceiptList } from '../lib/projectReceipts';

type ProjectStatus = 'Active' | 'Completed' | 'On hold' | 'Cancelled';

type Project = {
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

type InvoicePayment = {
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
  payments: InvoicePayment[];
  notes: string;
  voided: boolean;
  createdAt: string;
};

type OtherIncome = {
  date: string;
  description: string;
  payer: string;
  amount: number;
  method: string;
  reference: string;
  projectId: string;
};

const PROJECTS_KEY = 'ista-fortis-projects-v1';
const INVOICES_KEY = 'ista-fortis-invoices-v1';

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

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safePayments(invoice: Invoice): InvoicePayment[] {
  return Array.isArray(invoice.payments) ? invoice.payments : [];
}

function received(invoice: Invoice): number {
  return safePayments(invoice).reduce(
    (total, payment) => total + Number(payment.amount || 0),
    0
  );
}

function activeInvoices(invoices: Invoice[]): Invoice[] {
  return invoices.filter((invoice) => !invoice.voided);
}

function accountForMethod(method: string): string {
  if (method === 'Bank transfer' || method === 'Cheque') {
    return ACC.bank;
  }

  if (method === 'Mobile money') {
    return ACC.mobileMoney;
  }

  return ACC.cash;
}

/**
 * Page styles live here so this page is a single file. They mirror the Projects page and are
 * scoped under .projects-module, so they restyle this page (and its pop-up) only.
 */
const INCOME_CSS = `
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
.pj-kpis.five{grid-template-columns:repeat(5,minmax(0,1fr))}
.pj-kpi{--bg:#bdeed6;--fg:#1f7a4f;display:flex;flex-direction:column;background:var(--bg);border-radius:16px;padding:14px 16px 16px;text-align:center;container-type:inline-size;transition:transform .15s ease,box-shadow .15s ease}
.pj-kpi:hover{transform:translateY(-1px);box-shadow:0 8px 20px #1c2b2214}
.pj-kpi.tone-green{--bg:#bdeed6;--fg:#1f7a4f}
.pj-kpi.tone-blue{--bg:#c9defb;--fg:#3a66ad}
.pj-kpi.tone-amber{--bg:#fde5c4;--fg:#a8691f}
.pj-kpi.tone-rose{--bg:#fbd6db;--fg:#b04a58}
.pj-kpi.tone-violet{--bg:#ebe8fb;--fg:#6a5bc2}
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

/* tables */
.projects-module .projects-table th{background:transparent;padding:10px 20px;font-size:11px;font-weight:500;letter-spacing:0;color:#8a968f;border-bottom:1px solid var(--line);white-space:nowrap}
.projects-module .projects-table td{padding:14px 20px;font-size:12px;color:#3b4a42;border-top:0;border-bottom:1px solid #f1f4f4}
.projects-module .projects-table tbody tr:last-child td{border-bottom:0}
.projects-module .projects-table tbody tr:hover{background:#f7faf9}
.projects-module .projects-table strong{font-size:12px;font-weight:600;color:var(--ink)}
.projects-module .projects-table .num{text-align:right}
.projects-module .money-cell{white-space:nowrap;font-variant-numeric:tabular-nums}
.projects-module .inc-sub{display:block;margin-top:3px;font-size:10.5px;color:var(--muted)}
.projects-module .received-cell .progress-track{background:#eef1f1;border-radius:6px}
.projects-module .received-cell .progress-track i{background:#6fd6a0;border-radius:6px}
.projects-module .projects-empty-icon{background:#ebe8fb;color:#6a5bc2;border-radius:14px}
.projects-module .inc-pill{display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;background:#eef8f2;color:#1f6b46;white-space:nowrap}
.projects-module .inc-pill.none{background:#eceff0;color:#6b776f}
.projects-module .inc-move{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 10px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);font:inherit;font-size:11px;font-weight:600;white-space:nowrap;cursor:pointer}
.projects-module .inc-move:hover{background:#f1f5f4}
.projects-module .inc-hint{margin:12px 0 0;padding:10px 12px;border-radius:10px;background:#eef8f2;color:#1f6b46;font-size:11.5px;line-height:1.5}

/* note */
.projects-module .inc-note{padding:14px 16px;border-radius:14px;background:#eef8f2;color:#3f5a4c;font-size:11.5px;line-height:1.6}

/* pop-up */
.projects-module .projects-modal{border-radius:18px}
.projects-module .projects-modal-header h3{color:var(--ink)}
.projects-module .projects-field input,.projects-module .projects-field select,.projects-module .projects-field textarea{border-radius:10px;border-color:#e5eaec}
.projects-module .projects-cancel{border-radius:12px;border-color:var(--line)}
.projects-module .projects-close{border-radius:10px;border:1px solid var(--line)}
.projects-module .projects-close:hover{background:#f1f5f4;color:var(--ink)}

@media(max-width:1280px){.pj-kpis.five{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:1100px){.pj-kpis,.pj-kpis.five{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:420px){.pj-kpis,.pj-kpis.five{grid-template-columns:1fr}}
@media(max-width:600px){.projects-module .projects-table th,.projects-module .projects-table td{padding-left:14px;padding-right:14px}}
@media(prefers-reduced-motion:reduce){.pj-kpi{transition:none}.pj-kpi:hover{transform:none}}
`;

export default function Income() {
  const { isAdmin } = useAccess(); // Viewers see income but cannot record it
  const [projects, setProjects] = useState<Project[]>(() =>
    readStored<Project[]>(PROJECTS_KEY, [])
  );

  const [invoices, setInvoices] = useState<Invoice[]>(() =>
    readStored<Invoice[]>(INVOICES_KEY, [])
  );

  const [entries, setEntries] = useState<readonly JournalEntry[]>(() =>
    ledger.getEntries()
  );

  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedProject, setSelectedProject] = useState('all');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState<OtherIncome>({
    date: today(),
    description: '',
    payer: '',
    amount: 0,
    method: 'Cash',
    reference: '',
    projectId: '',
  });

  const refreshData = () => {
    setProjects(readStored<Project[]>(PROJECTS_KEY, []));
    setInvoices(readStored<Invoice[]>(INVOICES_KEY, []));
    setEntries(ledger.getEntries());
  };

  useEffect(() => {
    const unsubscribe = ledger.subscribe(() => {
      setEntries(ledger.getEntries());
    });

    const handleStorage = () => refreshData();

    window.addEventListener('storage', handleStorage);

    return () => {
      unsubscribe();
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  );

  const validInvoices = useMemo(
    () => activeInvoices(invoices),
    [invoices]
  );

  // Client payments recorded on this page against a project.
  const receipts = useMemo(() => projectReceiptList(entries), [entries]);
  const receiptIds = useMemo(() => new Set(receipts.map((r) => r.entry.id)), [receipts]);
  const directTotal = receipts.reduce((total, r) => total + r.amount, 0);

  const projectSummaries = useMemo(() => {
    return projects.map((project) => {
      const projectInvoices = validInvoices.filter(
        (invoice) => invoice.projectId === project.id
      );

      const invoiced = projectInvoices.reduce(
        (total, invoice) => total + Number(invoice.amount || 0),
        0
      );

      const collected = projectInvoices.reduce(
        (total, invoice) => total + received(invoice),
        0
      );

      // Received = before the system + invoice payments + payments recorded here (same as the Projects page).
      const direct = receipts
        .filter((r) => r.projectId === project.id)
        .reduce((total, r) => total + r.amount, 0);
      const totalReceived = Number(project.totalReceived || 0) + collected + direct;

      return {
        project,
        invoiced,
        collected: totalReceived,
        outstanding: Math.max(Number(project.contractValue || 0) - totalReceived, 0),
      };
    });
  }, [projects, validInvoices, receipts]);

  const totalContractValue = projects.reduce(
    (total, project) => total + Number(project.contractValue || 0),
    0
  );

  const totalInvoiced = validInvoices.reduce(
    (total, invoice) => total + Number(invoice.amount || 0),
    0
  );

  const totalCollected = validInvoices.reduce(
    (total, invoice) => total + received(invoice),
    0
  );

  const totalOutstanding = Math.max(totalInvoiced - totalCollected, 0);

  const otherIncomeEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (entry.reversalOf || receiptIds.has(entry.id)) return false;

      return (
        entry.lines.some(
          (line) => line.account === ACC.otherIncome && line.credit > 0
        ) &&
        !entries.some((reversal) => reversal.reversalOf === entry.id)
      );
    });
  }, [entries, receiptIds]);

  // Table: payments on projects and other income, newest first.
  const incomeEntries = useMemo(
    () => [...receipts.map((r) => r.entry), ...otherIncomeEntries].sort((a, b) => b.date.localeCompare(a.date)),
    [receipts, otherIncomeEntries]
  );

  const otherIncomeTotal = otherIncomeEntries.reduce((total, entry) => {
    const credit = entry.lines
      .filter((line) => line.account === ACC.otherIncome)
      .reduce((sum, line) => sum + line.credit, 0);

    const debit = entry.lines
      .filter((line) => line.account === ACC.otherIncome)
      .reduce((sum, line) => sum + line.debit, 0);

    return total + credit - debit;
  }, 0);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();

    return incomeEntries.filter((entry) => {
      const projectId = entry.lines.find((line) => line.projectId)?.projectId;
      const project = projectId ? projectMap.get(projectId) : undefined;

      const matchesProject =
        selectedProject === 'all' ||
        (selectedProject === 'none' && !projectId) ||
        projectId === selectedProject;

      const matchesSearch =
        !query ||
        entry.description.toLowerCase().includes(query) ||
        (entry.reference || '').toLowerCase().includes(query) ||
        (project?.projectName || '').toLowerCase().includes(query) ||
        entry.lines.some(
          (line) =>
            (line.party || '').toLowerCase().includes(query) ||
            (line.memo || '').toLowerCase().includes(query)
        );

      return matchesProject && matchesSearch;
    });
  }, [incomeEntries, search, selectedProject, projectMap]);

  const collectedPct =
    totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : 0;

  const resetForm = () => {
    setForm({
      date: today(),
      description: '',
      payer: '',
      amount: 0,
      method: 'Cash',
      reference: '',
      projectId: '',
    });
    setError('');
  };

  const closeForm = () => {
    setShowForm(false);
    resetForm();
  };

  const recordOtherIncome = () => {
    setError('');
    setSuccess('');

    if (!form.date) {
      setError('Please select the income date.');
      return;
    }

    if (!form.description.trim()) {
      setError('Please enter an income description.');
      return;
    }

    if (!form.amount || form.amount <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }

    if (
      form.projectId &&
      !projects.some((project) => project.id === form.projectId)
    ) {
      setError('The selected project could not be found. Refresh and try again.');
      return;
    }

    const project = projects.find(
      (item) => item.id === form.projectId
    );

    // With a project it is a client payment on that project (contract revenue); without one, other income.
    const sourceId = `${form.projectId ? PROJECT_RECEIPT_PREFIX : 'other-income-'}${Date.now()}`;

    try {
      ledger.post({
        date: form.date,
        description: form.description.trim(),
        sourceType: 'manual',
        sourceId,
        idempotencyKey: sourceId,
        reference: form.reference.trim() || undefined,
        lines: [
          {
            account: accountForMethod(form.method),
            debit: form.amount,
            party: form.payer.trim() || undefined,
            projectId: form.projectId || undefined,
            memo: form.description.trim(),
          },
          {
            account: form.projectId ? ACC.contractRevenue : ACC.otherIncome,
            credit: form.amount,
            party: form.payer.trim() || undefined,
            projectId: form.projectId || undefined,
            memo: project
              ? `${project.projectName} - ${form.description.trim()}`
              : form.description.trim(),
          },
        ],
      });

      setSuccess(project ? `Payment recorded on ${project.projectName}.` : 'Other income recorded successfully.');
      resetForm();
      setShowForm(false);
      setEntries(ledger.getEntries());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to record this income.'
      );
    }
  };

  /** Re-records an older project payment as contract revenue: reverses it and posts it again, same date. */
  const moveToContractRevenue = (entry: JournalEntry) => {
    if (!window.confirm('Move this payment to contract revenue? It is reversed and recorded again with the same date and amount. Profit does not change.')) return;
    setError('');
    setSuccess('');
    try {
      ledger.reverse(entry.id, 'Moved to contract revenue', entry.date);
      ledger.post({
        date: entry.date,
        description: entry.description,
        sourceType: 'manual',
        sourceId: `${PROJECT_RECEIPT_PREFIX}${Date.now()}`,
        idempotencyKey: `move-to-contract-revenue:${entry.id}`,
        reference: entry.reference,
        lines: entry.lines.map((line) =>
          line.account === ACC.otherIncome ? { ...line, account: ACC.contractRevenue } : line
        ),
      });
      setSuccess('Payment moved to contract revenue.');
      setEntries(ledger.getEntries());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to move this payment.');
    }
  };

  const entryAmount = (entry: JournalEntry) =>
    entry.lines
      .filter((line) => line.account === ACC.otherIncome || (line.account === ACC.contractRevenue && receiptIds.has(entry.id)))
      .reduce((total, line) => total + line.credit - line.debit, 0);

  const entryProject = (entry: JournalEntry) => {
    const projectId = entry.lines.find(
      (line) => line.projectId
    )?.projectId;

    return projectId ? projectMap.get(projectId) : undefined;
  };

  return (
    <section className="projects-module">
      <style>{INCOME_CSS}</style>

      <div className="welcome-row">
        <div>
          <div className="eyebrow">FINANCIAL MANAGEMENT</div>
          <h2>Income</h2>
          <p>Project revenue, client collections and other business income.</p>
        </div>

        {isAdmin && <div className="projects-header-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setError('');
              setSuccess('');
              setShowForm(true);
            }}
          >
            <Plus size={16} /> Record income
          </button>
        </div>}
      </div>

      {success && (
        <div className="projects-import-notice" role="status">
          <span>{success}</span>
          <button onClick={() => setSuccess('')} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}
      {error && !showForm && (
        <p className="projects-validation" role="alert">
          {error}
        </p>
      )}

      <div className="pj-kpis five">
        <Metric
          icon={<BriefcaseBusiness size={13} />}
          label="Project contract value"
          value={money(totalContractValue)}
          note={`${projects.length} registered project${projects.length === 1 ? '' : 's'}`}
          tone="blue"
        />
        <Metric
          icon={<FileText size={13} />}
          label="Client invoiced"
          value={money(totalInvoiced)}
          note={`${validInvoices.length} active invoice${validInvoices.length === 1 ? '' : 's'}`}
          tone="amber"
        />
        <Metric
          icon={<HandCoins size={13} />}
          label="Client receipts"
          value={money(totalCollected + directTotal)}
          note={
            directTotal > 0
              ? `${money(directTotal)} paid directly on projects`
              : totalInvoiced > 0
              ? `${collectedPct}% of invoiced amount collected`
              : 'No invoices issued yet'
          }
          tone="green"
        />
        <Metric
          icon={<TrendingUp size={13} />}
          label="Invoice outstanding"
          value={money(totalOutstanding)}
          note="Invoiced but not yet received"
          tone="rose"
        />
        <Metric
          icon={<Wallet size={13} />}
          label="Other income"
          value={money(otherIncomeTotal)}
          note={`${otherIncomeEntries.length} transaction${otherIncomeEntries.length === 1 ? '' : 's'} with no project`}
          tone="violet"
        />
      </div>

      <div className="panel projects-register">
        <div className="panel-heading projects-heading">
          <div>
            <h3>Project income overview</h3>
            <p>
              Received includes money received before the system, invoice
              payments and payments recorded on this page.
            </p>
          </div>
        </div>

        {projectSummaries.length === 0 ? (
          <Empty
            icon={<BriefcaseBusiness size={24} />}
            title="No projects found"
            message="Register a project first to see its income position here."
          />
        ) : (
          <div className="projects-table-wrap">
            <table className="projects-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Client</th>
                  <th>Contract value</th>
                  <th>Invoiced</th>
                  <th>Received</th>
                  <th>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {projectSummaries.map(({ project, invoiced, collected, outstanding }) => {
                  const progress =
                    project.contractValue > 0 ? Math.min((collected / project.contractValue) * 100, 100) : 0;

                  return (
                    <tr key={project.id}>
                      <td>
                        <strong>{project.projectName}</strong>
                        <span className="inc-sub">{project.id}</span>
                      </td>
                      <td>{project.client || '—'}</td>
                      <td className="money-cell">{money(project.contractValue)}</td>
                      <td className="money-cell">{money(invoiced)}</td>
                      <td>
                        <div className="received-cell">
                          <strong>{money(collected)}</strong>
                          <div className="progress-track">
                            <i style={{ width: `${progress}%` }} />
                          </div>
                          <small>{progress.toFixed(0)}% of contract</small>
                        </div>
                      </td>
                      <td className="money-cell">
                        <strong>{money(outstanding)}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel projects-register">
        <div className="panel-heading projects-heading">
          <div>
            <h3>Income transactions</h3>
            <p>
              Payments with a project count as received on that project.{' '}
              {filteredEntries.length} record
              {filteredEntries.length === 1 ? '' : 's'} displayed.
            </p>
          </div>

          <div className="projects-filters">
            <label className="projects-search">
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search income..."
              />
            </label>

            <select
              value={selectedProject}
              onChange={(event) => setSelectedProject(event.target.value)}
              aria-label="Filter by project"
            >
              <option value="all">All projects</option>
              <option value="none">Non-project income</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.projectName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredEntries.length === 0 ? (
          <Empty
            icon={<Wallet size={24} />}
            title={
              incomeEntries.length
                ? 'No matching income'
                : 'No income recorded yet'
            }
            message={
              incomeEntries.length
                ? 'Try another search term or project filter.'
                : isAdmin ? 'Record a client payment on a project, or income such as interest.' : 'Income will appear here once the Admin records it.'
            }
            action={
              !incomeEntries.length && isAdmin ? (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setShowForm(true)}
                >
                  <Plus size={16} /> Record first income
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="projects-table-wrap">
            <table className="projects-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Project</th>
                  <th>Payer</th>
                  <th>Reference</th>
                  <th className="num">Amount</th>
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => {
                  const project = entryProject(entry);
                  const canMove = isAdmin && receipts.some((r) => r.entry.id === entry.id && r.onOtherIncome);
                  const payer = entry.lines.find(
                    (line) => line.party
                  )?.party;

                  return (
                    <tr key={entry.id}>
                      <td className="money-cell">{entry.date}</td>
                      <td>
                        <strong>{entry.description}</strong>
                      </td>
                      <td>
                        <span className={`inc-pill${project ? '' : ' none'}`}>
                          {project?.projectName || 'Non-project'}
                        </span>
                      </td>
                      <td>{payer || '—'}</td>
                      <td>{entry.reference || '—'}</td>
                      <td className="money-cell num">
                        <strong>{money(entryAmount(entry))}</strong>
                      </td>
                      {isAdmin && (
                        <td className="num">
                          {canMove && (
                            <button type="button" className="inc-move" onClick={() => moveToContractRevenue(entry)} title="Recorded as other income. Move it to contract revenue.">
                              <ArrowRightLeft size={13} /> Move to contract revenue
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="inc-note">
        <strong>Accounting note:</strong> Client invoices and their payments
        are read from the Client Invoices register. This page does not post
        them again. A payment recorded here with a project is posted as
        contract revenue and counts as received on that project. Without a
        project it is posted as other income.
      </div>

      {showForm && isAdmin && (
        <div
          className="projects-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeForm();
          }}
        >
          <section
            className="projects-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="income-form-title"
          >
            <div className="projects-modal-header">
              <div>
                <div className="eyebrow">NEW INCOME</div>
                <h3 id="income-form-title">{form.projectId ? 'Client payment on project' : 'Record other income'}</h3>
              </div>

              <button
                type="button"
                className="projects-close"
                onClick={closeForm}
                aria-label="Close"
              >
                <X size={19} />
              </button>
            </div>

            <p className="inc-sub" style={{ marginTop: 0, marginBottom: 14 }}>
              Choose a project for a client payment made without an invoice.
              Leave it empty for other income, such as interest.
            </p>

            {error && (
              <p className="projects-validation" role="alert">
                {error}
              </p>
            )}

            <div className="projects-form-grid">
              <label className="projects-field">
                Income date *
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) =>
                    setForm({ ...form, date: event.target.value })
                  }
                />
              </label>

              <label className="projects-field">
                Income amount (RWF) *
                <input
                  type="number"
                  min="1"
                  value={form.amount || ''}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      amount: Number(event.target.value),
                    })
                  }
                  placeholder="Enter amount"
                />
              </label>

              <label className="projects-field">
                Project association
                <select
                  value={form.projectId}
                  onChange={(event) =>
                    setForm({ ...form, projectId: event.target.value })
                  }
                >
                  <option value="">Non-project income</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.projectName} — {project.client}
                    </option>
                  ))}
                </select>
              </label>

              <label className="projects-field">
                Received through
                <select
                  value={form.method}
                  onChange={(event) =>
                    setForm({ ...form, method: event.target.value })
                  }
                >
                  <option>Cash</option>
                  <option>Bank transfer</option>
                  <option>Mobile money</option>
                  <option>Cheque</option>
                </select>
              </label>

              <label className="projects-field field-wide">
                Income description *
                <input
                  value={form.description}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                  placeholder={form.projectId ? 'e.g. Second instalment' : 'e.g. Interest income'}
                />
              </label>

              <label className="projects-field">
                Payer / source
                <input
                  value={form.payer}
                  onChange={(event) =>
                    setForm({ ...form, payer: event.target.value })
                  }
                  placeholder="Name of payer or source"
                />
              </label>

              <label className="projects-field">
                Reference
                <input
                  value={form.reference}
                  onChange={(event) =>
                    setForm({ ...form, reference: event.target.value })
                  }
                  placeholder="Receipt or transaction reference"
                />
              </label>
            </div>

            {form.projectId && (
              <p className="inc-hint">
                This counts as received on the project and reduces its outstanding balance.
              </p>
            )}

            <div className="projects-form-actions">
              <button
                type="button"
                className="projects-cancel"
                onClick={closeForm}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={recordOtherIncome}
              >
                <Plus size={16} /> Save income
              </button>
            </div>
          </section>
        </div>
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
  tone: 'green' | 'blue' | 'amber' | 'rose' | 'violet';
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

function Empty({
  icon,
  title,
  message,
  action,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="projects-empty">
      <div className="projects-empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{message}</p>
      {action && (
        <div className="projects-header-actions" style={{ justifyContent: 'center' }}>
          {action}
        </div>
      )}
    </div>
  );
}
