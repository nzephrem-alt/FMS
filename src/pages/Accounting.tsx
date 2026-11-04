import { useEffect, useMemo, useState } from "react";
import {
  Scale,
  Landmark,
  TrendingUp,
  TrendingDown,
  Search,
  Eye,
  X,
  BookOpen,
} from "lucide-react";
import { ACCOUNTS, getAccount, isDebitNormal } from "../lib/accounts";
import { ledger, type JournalEntry } from "../lib/ledger";
import { syncInvoicesToLedger } from "../lib/invoiceSync";
import type { ReactNode } from "react";

type Tab =
  | "Overview"
  | "Chart of Accounts"
  | "Journal Entries"
  | "Trial Balance";

const formatRWF = (amount: number) =>
  new Intl.NumberFormat("en-RW", {
    style: "currency",
    currency: "RWF",
    maximumFractionDigits: 0,
  }).format(amount);

const formatDate = (date: string) =>
  date
    ? new Date(`${date}T00:00:00`).toLocaleDateString("en-GB")
    : "—";

const sourceLabels: Record<string, string> = {
  project_cost: "Project Cost",
  cost_payment: "Cost Payment",
  client_invoice: "Client Invoice",
  client_payment: "Client Payment",
  expense: "General Expense",
  payroll: "Payroll",
  manual: "Manual Journal",
  opening_balance: "Opening Balance",
};

/** Reuses the status pill colours from the Projects page. */
const statusClass = (status: string) =>
  status === "Posted"
    ? "status-active"
    : status === "Reversed"
      ? "status-on-hold"
      : "status-completed";

/**
 * Page styles live here so this page is a single file. They mirror the Projects page and are
 * scoped under .projects-module, so they restyle this page (and its pop-up) only.
 */
const ACCOUNTING_CSS = `
.projects-module{--lime:#d5f56b;--lime-ink:#1d2b12;--ink:#1c2b22;--muted:#7d8a83;--line:#edf0f1;display:flex;flex-direction:column;gap:22px;color:var(--ink)}
.projects-module button:focus-visible{outline:2px solid #2f8f6b;outline-offset:2px}

/* header */
.projects-module .welcome-row{margin-bottom:0;gap:20px;flex-wrap:wrap;align-items:flex-end}
.projects-module .welcome-row h2{font-size:28px;font-weight:700;letter-spacing:-.4px;margin:6px 0 4px;color:var(--ink)}
.projects-module .welcome-row p{font-size:13px;color:var(--muted)}
.projects-module .primary-button{height:39px;border-radius:12px;background:var(--lime);color:var(--lime-ink);font-size:12px;font-weight:600;box-shadow:none}
.projects-module .primary-button:hover{background:#c8ea52}

/* tabs */
.projects-module .acc-tabs{display:inline-flex;flex-wrap:wrap;gap:4px;padding:4px;border-radius:14px;background:#f1f5f4;align-self:flex-start}
.projects-module .acc-tab{border:0;background:transparent;height:34px;padding:0 16px;border-radius:10px;font:inherit;font-size:12px;font-weight:600;color:#6b776f;cursor:pointer;transition:background .15s ease,color .15s ease}
.projects-module .acc-tab:hover{color:var(--ink)}
.projects-module .acc-tab.is-active{background:var(--lime);color:var(--lime-ink)}

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

/* cards */
.projects-module .projects-register{padding:20px 0 6px;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 2px #1c2b2208;overflow:hidden}
.projects-module .projects-heading{padding:0 20px 14px}
.projects-module .projects-heading h3{font-size:16px;font-weight:600;color:var(--ink)}
.projects-module .projects-heading p{color:var(--muted)}
.projects-module .projects-search{border-radius:12px;border:1px solid var(--line);background:#fff;height:38px}
.projects-module .projects-filters select{border-radius:12px;border:1px solid var(--line);height:38px}
.projects-module .acc-card{padding:20px;background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 1px 2px #1c2b2208}
.projects-module .acc-card h3{margin:0;font-size:16px;font-weight:600;color:var(--ink)}
.projects-module .acc-card > p{margin:6px 0 0;font-size:12px;color:var(--muted)}

/* position */
.projects-module .acc-position{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-top:16px}
.projects-module .acc-stat{padding:14px 16px;border-radius:14px;background:#f7faf9}
.projects-module .acc-stat span{display:block;font-size:11px;color:var(--muted);margin-bottom:6px}
.projects-module .acc-stat strong{font-size:15px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
.projects-module .acc-banner{margin-top:16px;padding:12px 14px;border-radius:12px;font-size:12.5px;font-weight:600;background:#bdeed6;color:#1f6b46}
.projects-module .acc-banner.warn{background:#fde5c4;color:#8a5517}
.projects-module .acc-banner.top{margin-top:0;font-weight:500}
.projects-module .acc-banner ul{margin:6px 0 0;padding-left:18px;font-weight:500}

/* recent entries */
.projects-module .acc-recent{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f1f4f4}
.projects-module .acc-recent:last-of-type{border-bottom:0}
.projects-module .acc-recent strong{font-size:12.5px;font-weight:600;color:var(--ink)}
.projects-module .acc-recent .amt{font-size:12.5px;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
.projects-module .acc-link{margin-top:8px;border:0;background:transparent;padding:0;font:inherit;font-size:12px;font-weight:600;color:#1f6b46;cursor:pointer}
.projects-module .acc-link:hover{text-decoration:underline}

/* filters */
.projects-module .acc-filters{display:flex;flex-wrap:wrap;gap:10px;padding:0 20px 16px}
.projects-module .acc-filters .projects-search{flex:1;min-width:200px;box-sizing:border-box}
.projects-module .acc-filters select{height:38px;border-radius:12px;border:1px solid var(--line);background:#fff;color:var(--ink);padding:0 10px;font:inherit;font-size:12px;min-width:180px}

/* tables */
.projects-module .projects-table th{background:transparent;padding:10px 20px;font-size:11px;font-weight:500;letter-spacing:0;color:#8a968f;border-bottom:1px solid var(--line);white-space:nowrap}
.projects-module .projects-table td{padding:14px 20px;font-size:12px;color:#3b4a42;border-top:0;border-bottom:1px solid #f1f4f4;vertical-align:middle}
.projects-module .projects-table tbody tr:last-child td{border-bottom:0}
.projects-module .projects-table tbody tr:hover{background:#f7faf9}
.projects-module .projects-table strong{font-size:12px;font-weight:600;color:var(--ink)}
.projects-module .projects-table .num{text-align:right}
.projects-module .projects-table tfoot td{background:#eef8f2;font-weight:700;color:var(--ink);border-bottom:0;padding-top:13px;padding-bottom:13px}
.projects-module .money-cell{white-space:nowrap;font-variant-numeric:tabular-nums}
.projects-module .acc-sub{display:block;margin-top:3px;font-size:10.5px;color:var(--muted)}
.projects-module .acc-pill{display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap;background:#eceff0;color:#6b776f}
.projects-module .acc-pill.asset{background:#c9defb;color:#3a66ad}
.projects-module .acc-pill.liability{background:#fde5c4;color:#a8691f}
.projects-module .acc-pill.equity{background:#ebe8fb;color:#6a5bc2}
.projects-module .acc-pill.revenue{background:#bdeed6;color:#1f6b46}
.projects-module .acc-pill.expense{background:#fbd6db;color:#b04a58}
.projects-module .acc-pill.source{background:#eef8f2;color:#1f6b46}
.projects-module .project-status{padding:5px 10px;font-weight:600;display:inline-flex;align-items:center;gap:5px;border-radius:999px;font-size:11px;white-space:nowrap}
.projects-module .status-active{background:#bdeed6;color:#1f6b46}
.projects-module .status-completed{background:#c9defb;color:#3a66ad}
.projects-module .status-on-hold{background:#fde5c4;color:#a8691f}
.projects-module .project-row-actions{display:flex;gap:6px}
.projects-module .project-row-actions button,.projects-module .projects-close{border-radius:10px;border:1px solid var(--line)}
.projects-module .project-row-actions button:hover,.projects-module .projects-close:hover{background:#f1f5f4;color:var(--ink)}
.projects-module .projects-empty-icon{background:#ebe8fb;color:#6a5bc2;border-radius:14px}
.projects-module .acc-empty-row{padding:28px 20px;text-align:center;font-size:12px;color:var(--muted)}
.projects-module .acc-foot{padding:0 20px 16px}

/* pop-up */
.projects-module .projects-modal{border-radius:18px;max-width:760px}
.projects-module .projects-modal-header h3{color:var(--ink)}
.projects-module .acc-modal-meta{margin:0 0 14px;font-size:12px;color:var(--muted)}

@media(max-width:1280px){.pj-kpis.five{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:1100px){.pj-kpis,.pj-kpis.five{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:420px){.pj-kpis,.pj-kpis.five{grid-template-columns:1fr}}
@media(max-width:600px){.projects-module .projects-table th,.projects-module .projects-table td{padding-left:14px;padding-right:14px}}
@media(prefers-reduced-motion:reduce){.pj-kpi,.acc-tab{transition:none}.pj-kpi:hover{transform:none}}
`;

export default function Accounting() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [search, setSearch] = useState("");
  const [accountType, setAccountType] = useState("All");
  const [selectedEntry, setSelectedEntry] =
    useState<JournalEntry | null>(null);
  const [syncErrors, setSyncErrors] = useState<string[]>([]);

  useEffect(() => {
    // Bring client invoices and receipts into the ledger before reading it.
    // Safe to repeat: the ledger ignores entries it already has.
    try {
      const result = syncInvoicesToLedger();
      setSyncErrors(result.errors);
    } catch (error) {
      console.error("Invoice sync failed:", error);
      setSyncErrors([
        error instanceof Error ? error.message : "Invoice sync failed.",
      ]);
    }

    const refresh = () => setEntries([...ledger.getEntries()]);
    refresh();
    return ledger.subscribe(refresh);
  }, []);

  const reversedIds = useMemo(
    () =>
      new Set(
        entries
          .filter((entry) => entry.reversalOf)
          .map((entry) => entry.reversalOf as string)
      ),
    [entries]
  );

  // Calculate actual net debit/credit movement for every account.
  const accountBalances = useMemo(() => {
    const balances: Record<string, number> = {};

    for (const entry of entries) {
      for (const line of entry.lines) {
        balances[line.account] =
          (balances[line.account] ?? 0) +
          line.debit -
          line.credit;
      }
    }

    return balances;
  }, [entries]);

  // Actual debit and credit sides are used for the Trial Balance.
  // Normal balances are used for financial statement categories.
  const accountRows = useMemo(
    () =>
      ACCOUNTS.map((account) => {
        const net = accountBalances[account.code] ?? 0;
        const normalBalance = isDebitNormal(account.type) ? net : -net;

        return {
          ...account,
          net,
          normalBalance,
          debit: Math.max(net, 0),
          credit: Math.max(-net, 0),
          balance: normalBalance,
        };
      }),
    [accountBalances]
  );

  const totals = useMemo(() => {
    const sumType = (type: string) =>
      accountRows
        .filter((account) => account.type === type)
        .reduce((sum, account) => sum + account.balance, 0);

    const totalDebits = accountRows.reduce(
      (sum, account) => sum + account.debit,
      0
    );

    const totalCredits = accountRows.reduce(
      (sum, account) => sum + account.credit,
      0
    );

    const assets = sumType("Asset");
    const liabilities = sumType("Liability");
    const equity = sumType("Equity");
    const revenue = sumType("Revenue");
    const expenses = sumType("Expense");

    // Current-period profit/loss is not yet closed into retained earnings.
    const netIncome = revenue - expenses;

    // Assets = Liabilities + Equity + Current-period net income.
    const accountingDifference =
      assets - liabilities - equity - netIncome;

    return {
      assets,
      liabilities,
      equity,
      revenue,
      expenses,
      netIncome,
      totalDebits,
      totalCredits,
      trialBalanceDifference: totalDebits - totalCredits,
      accountingDifference,
    };
  }, [accountRows]);

  const activeEntries = entries.filter(
    (entry) => !entry.reversalOf && !reversedIds.has(entry.id)
  );

  const filteredAccounts = accountRows.filter((account) => {
    const matchesType =
      accountType === "All" || account.type === accountType;

    const matchesSearch =
      `${account.code} ${account.name} ${account.type}`
        .toLowerCase()
        .includes(search.toLowerCase().trim());

    return matchesType && matchesSearch;
  });

  const filteredEntries = [...entries]
    .filter((entry) => {
      const query = search.toLowerCase().trim();

      return (
        !query ||
        [
          entry.id,
          entry.description,
          entry.reference ?? "",
          entry.sourceType,
          entry.sourceId,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query)
      );
    })
    .sort((a, b) => {
      const dateComparison = b.date.localeCompare(a.date);
      return dateComparison || b.createdAt.localeCompare(a.createdAt);
    });

  const tabs: Tab[] = [
    "Overview",
    "Chart of Accounts",
    "Journal Entries",
    "Trial Balance",
  ];

  const entryStatus = (entry: JournalEntry) =>
    entry.reversalOf
      ? "Reversal"
      : reversedIds.has(entry.id)
        ? "Reversed"
        : "Posted";

  const balanced = Math.abs(totals.accountingDifference) < 1;
  const tbBalanced = Math.abs(totals.trialBalanceDifference) < 1;
  const trialRows = accountRows.filter(
    (account) => account.debit > 0 || account.credit > 0
  );

  return (
    <section className="projects-module">
      <style>{ACCOUNTING_CSS}</style>

      <div className="welcome-row">
        <div>
          <div className="eyebrow">FINANCIAL MANAGEMENT</div>
          <h2>Accounting</h2>
          <p>
            Manage and review ISTA FORTIS accounting records and financial
            balances.
          </p>
        </div>
      </div>

      {syncErrors.length > 0 && (
        <div className="acc-banner warn top" role="alert">
          <strong>
            {syncErrors.length} invoice record(s) could not be posted to the
            ledger:
          </strong>
          <ul>
            {syncErrors.slice(0, 5).map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Navigation tabs */}
      <div className="acc-tabs" role="tablist" aria-label="Accounting sections">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={`acc-tab${activeTab === tab ? " is-active" : ""}`}
            onClick={() => {
              setActiveTab(tab);
              setSearch("");
              setAccountType("All");
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Overview */}
      {activeTab === "Overview" && (
        <>
          <div className="pj-kpis five">
            <Metric title="Total assets" value={formatRWF(totals.assets)} note="What the business owns" icon={<Landmark size={13} />} tone="blue" />
            <Metric title="Total liabilities" value={formatRWF(totals.liabilities)} note="What the business owes" icon={<TrendingDown size={13} />} tone="amber" />
            <Metric title="Total equity" value={formatRWF(totals.equity)} note="Owners' interest" icon={<Scale size={13} />} tone="violet" />
            <Metric title="Total revenue" value={formatRWF(totals.revenue)} note="Income recognised" icon={<TrendingUp size={13} />} tone="green" />
            <Metric title="Total expenses" value={formatRWF(totals.expenses)} note="Costs recognised" icon={<TrendingDown size={13} />} tone="rose" />
          </div>

          <div className="acc-card">
            <h3>Accounting position</h3>
            <p>
              Based on balances recorded in the shared ledger, including
              current-period profit or loss.
            </p>

            <div className="acc-position">
              <div className="acc-stat">
                <span>Assets</span>
                <strong>{formatRWF(totals.assets)}</strong>
              </div>
              <div className="acc-stat">
                <span>Liabilities + equity</span>
                <strong>{formatRWF(totals.liabilities + totals.equity)}</strong>
              </div>
              <div className="acc-stat">
                <span>Current period net income</span>
                <strong>{formatRWF(totals.netIncome)}</strong>
              </div>
              <div className="acc-stat">
                <span>Active journal entries</span>
                <strong>{activeEntries.length}</strong>
              </div>
            </div>

            <div className={`acc-banner${balanced ? "" : " warn"}`}>
              Accounting equation difference:{" "}
              {formatRWF(totals.accountingDifference)}
              {balanced ? " — Balanced" : " — Difference requires review"}
            </div>
          </div>

          <div className="acc-card">
            <h3>Recent journal entries</h3>
            {entries.length === 0 ? (
              <p>No journal entries have been recorded yet.</p>
            ) : (
              <div style={{ marginTop: 8 }}>
                {[...entries]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .slice(0, 5)
                  .map((entry) => (
                    <div key={entry.id} className="acc-recent">
                      <div>
                        <strong>{entry.description}</strong>
                        <span className="acc-sub">
                          {entry.id} · {formatDate(entry.date)}
                        </span>
                      </div>
                      <span className="amt">
                        {formatRWF(
                          entry.lines.reduce(
                            (sum, line) => sum + line.debit,
                            0
                          )
                        )}
                      </span>
                    </div>
                  ))}
              </div>
            )}
            <button
              type="button"
              className="acc-link"
              onClick={() => setActiveTab("Journal Entries")}
            >
              View all journal entries
            </button>
          </div>
        </>
      )}

      {/* Chart of Accounts */}
      {activeTab === "Chart of Accounts" && (
        <div className="panel projects-register">
          <div className="panel-heading projects-heading">
            <div>
              <h3>Chart of accounts</h3>
              <p>
                The accounts configured in the ISTA FORTIS accounting structure.
                {" "}{filteredAccounts.length} account
                {filteredAccounts.length === 1 ? "" : "s"} displayed.
              </p>
            </div>
          </div>

          <div className="acc-filters">
            <label className="projects-search">
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search account..."
              />
            </label>
            <select
              value={accountType}
              onChange={(event) => setAccountType(event.target.value)}
              aria-label="Filter by account type"
            >
              <option value="All">All account types</option>
              {["Asset", "Liability", "Equity", "Revenue", "Expense"].map(
                (type) => (
                  <option key={type}>{type}</option>
                )
              )}
            </select>
          </div>

          <div className="projects-table-wrap">
            <table className="projects-table">
              <thead>
                <tr>
                  <th>Account code</th>
                  <th>Account name</th>
                  <th>Account type</th>
                  <th className="num">Debit balance</th>
                  <th className="num">Credit balance</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((account) => (
                  <tr key={account.code}>
                    <td className="money-cell">{account.code}</td>
                    <td>
                      <strong>{account.name}</strong>
                    </td>
                    <td>
                      <span className={`acc-pill ${String(account.type).toLowerCase()}`}>
                        {account.type}
                      </span>
                    </td>
                    <td className="money-cell num">
                      {account.debit ? formatRWF(account.debit) : "—"}
                    </td>
                    <td className="money-cell num">
                      {account.credit ? formatRWF(account.credit) : "—"}
                    </td>
                  </tr>
                ))}
                {filteredAccounts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="acc-empty-row">
                      No accounts found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Journal Entries */}
      {activeTab === "Journal Entries" && (
        <div className="panel projects-register">
          <div className="panel-heading projects-heading">
            <div>
              <h3>Journal entries</h3>
              <p>
                All journal entries posted by connected financial modules.
                {" "}{filteredEntries.length} entr
                {filteredEntries.length === 1 ? "y" : "ies"} displayed.
              </p>
            </div>
          </div>

          <div className="acc-filters">
            <label className="projects-search">
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search description, ID, reference or source..."
              />
            </label>
          </div>

          {filteredEntries.length === 0 ? (
            <div className="projects-empty">
              <div className="projects-empty-icon">
                <BookOpen size={24} />
              </div>
              <h3>
                {entries.length ? "No matching entries" : "No journal entries yet"}
              </h3>
              <p>
                {entries.length
                  ? "Try another search term."
                  : "Entries posted by connected modules will appear here."}
              </p>
            </div>
          ) : (
            <div className="projects-table-wrap">
              <table className="projects-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Source</th>
                    <th className="num">Debit total</th>
                    <th className="num">Credit total</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => {
                    const debit = entry.lines.reduce(
                      (sum, line) => sum + line.debit,
                      0
                    );
                    const credit = entry.lines.reduce(
                      (sum, line) => sum + line.credit,
                      0
                    );
                    const status = entryStatus(entry);

                    return (
                      <tr key={entry.id}>
                        <td className="money-cell">{formatDate(entry.date)}</td>
                        <td style={{ minWidth: 200 }}>
                          <strong>{entry.description}</strong>
                          <span className="acc-sub">{entry.id}</span>
                        </td>
                        <td>
                          <span className="acc-pill source">
                            {sourceLabels[entry.sourceType] ?? entry.sourceType}
                          </span>
                        </td>
                        <td className="money-cell num">{formatRWF(debit)}</td>
                        <td className="money-cell num">{formatRWF(credit)}</td>
                        <td>
                          <span className={`project-status ${statusClass(status)}`}>
                            {status}
                          </span>
                        </td>
                        <td>
                          <div className="project-row-actions">
                            <button
                              type="button"
                              onClick={() => setSelectedEntry(entry)}
                              aria-label={`View journal entry ${entry.id}`}
                              title="View journal entry"
                            >
                              <Eye size={15} />
                            </button>
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
      )}

      {/* Trial Balance */}
      {activeTab === "Trial Balance" && (
        <div className="panel projects-register">
          <div className="panel-heading projects-heading">
            <div>
              <h3>Trial balance</h3>
              <p>
                Actual net debit and credit balances calculated from all posted
                journal entries, including reversals.
              </p>
            </div>
          </div>

          {trialRows.length === 0 ? (
            <div className="projects-empty">
              <div className="projects-empty-icon">
                <Scale size={24} />
              </div>
              <h3>No balances yet</h3>
              <p>Balances will appear here once journal entries are posted.</p>
            </div>
          ) : (
            <div className="projects-table-wrap">
              <table className="projects-table">
                <thead>
                  <tr>
                    <th>Account code</th>
                    <th>Account name</th>
                    <th className="num">Debit</th>
                    <th className="num">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {trialRows.map((account) => (
                    <tr key={account.code}>
                      <td className="money-cell">{account.code}</td>
                      <td>{account.name}</td>
                      <td className="money-cell num">
                        {account.debit ? formatRWF(account.debit) : "—"}
                      </td>
                      <td className="money-cell num">
                        {account.credit ? formatRWF(account.credit) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Total</td>
                    <td className="money-cell num">{formatRWF(totals.totalDebits)}</td>
                    <td className="money-cell num">{formatRWF(totals.totalCredits)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="acc-foot">
            <div className={`acc-banner${tbBalanced ? "" : " warn"}`} style={{ marginTop: 14 }}>
              {tbBalanced
                ? "Trial Balance is balanced."
                : `Trial Balance difference: ${formatRWF(
                    totals.trialBalanceDifference
                  )}. Review the ledger entries.`}
            </div>
          </div>
        </div>
      )}

      {/* Journal Entry Details */}
      {selectedEntry && (
        <div
          className="projects-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedEntry(null);
          }}
        >
          <section
            className="projects-modal project-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="journal-detail-title"
          >
            <div className="projects-modal-header">
              <div>
                <div className="eyebrow">JOURNAL ENTRY</div>
                <h3 id="journal-detail-title">{selectedEntry.description}</h3>
              </div>
              <button
                type="button"
                className="projects-close"
                onClick={() => setSelectedEntry(null)}
                aria-label="Close"
              >
                <X size={19} />
              </button>
            </div>

            <p className="acc-modal-meta">
              {selectedEntry.id} · {formatDate(selectedEntry.date)} ·{" "}
              {sourceLabels[selectedEntry.sourceType] ??
                selectedEntry.sourceType}
            </p>

            <span
              className={`project-status ${statusClass(entryStatus(selectedEntry))}`}
            >
              {entryStatus(selectedEntry)}
            </span>

            <div className="projects-table-wrap" style={{ marginTop: 14 }}>
              <table className="projects-table" style={{ minWidth: 450 }}>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="num">Debit</th>
                    <th className="num">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedEntry.lines.map((line, index) => (
                    <tr key={`${line.account}-${index}`}>
                      <td>
                        <strong>
                          {getAccount(line.account)?.name ?? line.account}
                        </strong>
                        <span className="acc-sub">{line.account}</span>
                        {line.projectId && (
                          <span className="acc-sub">Project: {line.projectId}</span>
                        )}
                        {line.party && (
                          <span className="acc-sub">Party: {line.party}</span>
                        )}
                        {line.memo && <span className="acc-sub">{line.memo}</span>}
                      </td>
                      <td className="money-cell num">
                        {line.debit ? formatRWF(line.debit) : "—"}
                      </td>
                      <td className="money-cell num">
                        {line.credit ? formatRWF(line.credit) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedEntry.reversalOf && (
              <p className="projects-validation">
                This entry reverses journal {selectedEntry.reversalOf}.
              </p>
            )}

            <div className="projects-form-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => setSelectedEntry(null)}
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
  tone: "green" | "blue" | "amber" | "rose" | "violet";
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