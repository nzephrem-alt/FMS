import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Search,
  X,
  Eye,
  RotateCcw,
  ArrowLeftRight,
  CheckCircle2,
  Banknote,
  Undo2,
} from "lucide-react";
import { ledger, type JournalEntry } from "../lib/ledger";
import { getAccount } from "../lib/accounts";

const formatRWF = (amount: number) =>
  new Intl.NumberFormat("en-RW", {
    style: "currency",
    currency: "RWF",
    maximumFractionDigits: 0,
  }).format(amount);

const formatDate = (date: string) => {
  if (!date) return "—";
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-GB");
};

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

const getEntryAmount = (entry: JournalEntry) =>
  entry.lines.reduce((total, line) => total + line.debit, 0);

const NO_PROJECT = "Not project-specific";

/** Project names from the Projects register, for showing a name instead of only the ID. */
function readProjectNames(): Map<string, string> {
  try {
    const raw = localStorage.getItem("ista-fortis-projects-v1");
    const list = raw ? JSON.parse(raw) : [];
    return new Map(
      (Array.isArray(list) ? list : []).map((p: { id: string; projectName: string }) => [p.id, p.projectName])
    );
  } catch {
    return new Map();
  }
}

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
const TRANSACTIONS_CSS = `
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
.projects-module .tx-filters{display:grid;grid-template-columns:minmax(200px,1.6fr) repeat(3,minmax(150px,1fr));gap:10px;padding:0 20px 16px}
.projects-module .tx-filters .projects-search{width:100%;box-sizing:border-box}
.projects-module .tx-filters select,.projects-module .tx-filters input[type="date"]{width:100%;box-sizing:border-box;height:38px;border-radius:12px;border:1px solid var(--line);background:#fff;color:var(--ink);padding:0 10px;font:inherit;font-size:12px}
.projects-module .tx-clear{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:12px;border:1px solid var(--line);background:#fff;color:var(--ink);font-size:12px;font-weight:600;cursor:pointer}
.projects-module .tx-clear:hover{background:#f4f7f6}

/* tables */
.projects-module .projects-table th{background:transparent;padding:10px 20px;font-size:11px;font-weight:500;letter-spacing:0;color:#8a968f;border-bottom:1px solid var(--line);white-space:nowrap}
.projects-module .projects-table td{padding:14px 20px;font-size:12px;color:#3b4a42;border-top:0;border-bottom:1px solid #f1f4f4;vertical-align:middle}
.projects-module .projects-table tbody tr:last-child td{border-bottom:0}
.projects-module .projects-table tbody tr:hover{background:#f7faf9}
.projects-module .projects-table strong{font-size:12px;font-weight:600;color:var(--ink)}
.projects-module .projects-table .num{text-align:right}
.projects-module .money-cell{white-space:nowrap;font-variant-numeric:tabular-nums}
.projects-module .tx-none{color:var(--muted)}
.projects-module .tx-sub{display:block;margin-top:3px;font-size:10.5px;color:var(--muted)}
.projects-module .tx-type{display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;background:#eef8f2;color:#1f6b46;white-space:nowrap}
.projects-module .project-status{padding:5px 10px;font-weight:600;display:inline-flex;align-items:center;gap:5px;border-radius:999px;font-size:11px;white-space:nowrap}
.projects-module .status-active{background:#bdeed6;color:#1f6b46}
.projects-module .status-completed{background:#c9defb;color:#3a66ad}
.projects-module .status-on-hold{background:#fde5c4;color:#a8691f}
.projects-module .project-row-actions{display:flex;gap:6px}
.projects-module .project-row-actions button,.projects-module .projects-close{border-radius:10px;border:1px solid var(--line)}
.projects-module .project-row-actions button:hover,.projects-module .projects-close:hover{background:#f1f5f4;color:var(--ink)}
.projects-module .projects-empty-icon{background:#ebe8fb;color:#6a5bc2;border-radius:14px}
.projects-module .projects-table tfoot td{background:#eef8f2;font-weight:700;color:var(--ink);border-bottom:0}

/* pop-up */
.projects-module .projects-modal{border-radius:18px;max-width:760px}
.projects-module .projects-modal-header h3{color:var(--ink)}
.projects-module .projects-cancel{border-radius:12px;border-color:var(--line)}
.projects-module .project-detail-grid{border-radius:12px}
.projects-module .tx-section-title{font-size:13px;font-weight:600;margin:18px 0 8px;color:var(--ink)}

@media(max-width:1100px){.pj-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.projects-module .tx-filters{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:560px){.projects-module .tx-filters{grid-template-columns:1fr}}
@media(max-width:420px){.pj-kpis{grid-template-columns:1fr}}
@media(max-width:600px){.projects-module .projects-table th,.projects-module .projects-table td{padding-left:14px;padding-right:14px}}
@media(prefers-reduced-motion:reduce){.pj-kpi{transition:none}.pj-kpi:hover{transform:none}}
`;

export default function Transactions() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [projectNames] = useState<Map<string, string>>(readProjectNames);

  useEffect(() => {
    const refreshEntries = () => {
      setEntries([...ledger.getEntries()]);
    };

    refreshEntries();
    const unsubscribe = ledger.subscribe(refreshEntries);

    return unsubscribe;
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

  /**
   * Project of each source record. A payment entry (supplier, worker or client payment) often has
   * no project on its own lines, but the cost or invoice it settles does, and both share the same
   * source ID. So an entry without a project takes the project of its linked entries.
   */
  const projectBySource = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) {
      const id = entry.lines.find((line) => line.projectId)?.projectId;
      if (id && entry.sourceId && !map.has(entry.sourceId)) map.set(entry.sourceId, id);
    }
    return map;
  }, [entries]);

  const projectIdOf = (entry: JournalEntry) =>
    entry.lines.find((line) => line.projectId)?.projectId ?? projectBySource.get(entry.sourceId);

  const getProject = (entry: JournalEntry) => {
    const id = projectIdOf(entry);
    if (!id) return NO_PROJECT;
    const name = projectNames.get(id);
    return name ? `${name} (${id})` : id;
  };

  const filteredEntries = useMemo(() => {
    const query = search.toLowerCase().trim();

    return [...entries]
      .filter((entry) => {
        const matchesType =
          typeFilter === "All" || entry.sourceType === typeFilter;

        const matchesFrom = !fromDate || entry.date >= fromDate;
        const matchesTo = !toDate || entry.date <= toDate;

        const searchableText = [
          entry.id,
          entry.date,
          entry.description,
          entry.reference ?? "",
          entry.sourceId,
          entry.sourceType,
          getProject(entry),
          ...entry.lines.flatMap((line) => [
            line.account,
            getAccount(line.account)?.name ?? "",
            line.projectId ?? "",
            line.party ?? "",
            line.memo ?? "",
          ]),
        ]
          .join(" ")
          .toLowerCase();

        return (
          matchesType &&
          matchesFrom &&
          matchesTo &&
          (!query || searchableText.includes(query))
        );
      })
      .sort((a, b) => {
        const dateComparison = b.date.localeCompare(a.date);
        return dateComparison || b.createdAt.localeCompare(a.createdAt);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, search, typeFilter, fromDate, toDate, projectBySource, projectNames]);

  const activeEntries = entries.filter(
    (entry) => !entry.reversalOf && !reversedIds.has(entry.id)
  );

  const reversalCount = entries.filter((entry) => entry.reversalOf).length;

  const totalRecorded = activeEntries.reduce(
    (total, entry) => total + getEntryAmount(entry),
    0
  );

  const hasFilters = !!(search || typeFilter !== "All" || fromDate || toDate);

  const clearFilters = () => {
    setSearch("");
    setTypeFilter("All");
    setFromDate("");
    setToDate("");
  };

  const isReversed = (entry: JournalEntry) =>
    reversedIds.has(entry.id);

  const getStatus = (entry: JournalEntry) => {
    if (entry.reversalOf) return "Reversal";
    if (isReversed(entry)) return "Reversed";
    return "Posted";
  };

  return (
    <section className="projects-module">
      <style>{TRANSACTIONS_CSS}</style>

      <div className="welcome-row">
        <div>
          <div className="eyebrow">FINANCIAL MANAGEMENT</div>
          <h2>Transactions</h2>
          <p>View and track financial activity recorded across ISTA FORTIS.</p>
        </div>
      </div>

      <div className="pj-kpis">
        <Metric
          title="Total entries"
          value={String(entries.length)}
          note="All ledger entries"
          icon={<ArrowLeftRight size={13} />}
          tone="blue"
        />
        <Metric
          title="Active entries"
          value={String(activeEntries.length)}
          note="Excludes reversed entries"
          icon={<CheckCircle2 size={13} />}
          tone="green"
        />
        <Metric
          title="Value of active entries"
          value={formatRWF(totalRecorded)}
          note="Based on debit totals"
          icon={<Banknote size={13} />}
          tone="amber"
        />
        <Metric
          title="Reversal entries"
          value={String(reversalCount)}
          note="Reversal history retained"
          icon={<Undo2 size={13} />}
          tone="rose"
        />
      </div>

      <div className="panel projects-register">
        <div className="panel-heading projects-heading">
          <div>
            <h3>Transaction register</h3>
            <p>
              Showing {filteredEntries.length} of {entries.length} entr
              {entries.length === 1 ? "y" : "ies"}
            </p>
          </div>

          {hasFilters && (
            <button type="button" className="tx-clear" onClick={clearFilters}>
              <RotateCcw size={14} /> Clear filters
            </button>
          )}
        </div>

        <div className="tx-filters">
          <label className="projects-search">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search transactions..."
            />
          </label>

          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            aria-label="Filter by transaction type"
          >
            <option value="All">All transaction types</option>
            {Object.entries(sourceLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            aria-label="From date"
          />

          <input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            aria-label="To date"
          />
        </div>

        {filteredEntries.length === 0 ? (
          <div className="projects-empty">
            <div className="projects-empty-icon">
              <ArrowLeftRight size={24} />
            </div>
            <h3>
              {entries.length ? "No matching transactions" : "No transactions yet"}
            </h3>
            <p>
              {entries.length
                ? "Try another search term, type or date range."
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
                  <th>Transaction type</th>
                  <th>Project</th>
                  <th>Reference</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {filteredEntries.map((entry) => {
                  const status = getStatus(entry);

                  return (
                    <tr key={entry.id}>
                      <td className="money-cell">{formatDate(entry.date)}</td>
                      <td style={{ minWidth: 200 }}>
                        <strong>{entry.description}</strong>
                        <span className="tx-sub">{entry.id}</span>
                      </td>
                      <td>
                        <span className="tx-type">
                          {sourceLabels[entry.sourceType] ?? entry.sourceType}
                        </span>
                      </td>
                      <td className={projectIdOf(entry) ? undefined : "tx-none"}>{getProject(entry)}</td>
                      <td>{entry.reference || "—"}</td>
                      <td className="money-cell num">
                        <strong>{formatRWF(getEntryAmount(entry))}</strong>
                      </td>
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
                            aria-label={`View details of ${entry.description}`}
                            title="View transaction details"
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

      {/* Transaction details */}
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
            aria-labelledby="transaction-detail-title"
          >
            <div className="projects-modal-header">
              <div>
                <div className="eyebrow">TRANSACTION DETAILS</div>
                <h3 id="transaction-detail-title">{selectedEntry.description}</h3>
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

            <span
              className={`project-status ${statusClass(getStatus(selectedEntry))}`}
            >
              {getStatus(selectedEntry)}
            </span>

            <div className="project-detail-grid">
              <Detail label="Date" value={formatDate(selectedEntry.date)} />
              <Detail
                label="Transaction type"
                value={
                  sourceLabels[selectedEntry.sourceType] ??
                  selectedEntry.sourceType
                }
              />
              <Detail label="Entry ID" value={selectedEntry.id} />
              <Detail label="Source ID" value={selectedEntry.sourceId || "—"} />
              <Detail label="Reference" value={selectedEntry.reference || "—"} />
              <Detail label="Project" value={getProject(selectedEntry)} />
            </div>

            <h4 className="tx-section-title">Journal breakdown</h4>

            <div className="projects-table-wrap">
              <table className="projects-table" style={{ minWidth: 450 }}>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Project / party</th>
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
                        <span className="tx-sub">{line.account}</span>
                        {line.memo && <span className="tx-sub">{line.memo}</span>}
                      </td>
                      <td>{line.projectId || line.party || "—"}</td>
                      <td className="money-cell num">
                        {line.debit ? formatRWF(line.debit) : "—"}
                      </td>
                      <td className="money-cell num">
                        {line.credit ? formatRWF(line.credit) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Totals</td>
                    <td className="money-cell num">
                      {formatRWF(
                        selectedEntry.lines.reduce(
                          (sum, line) => sum + line.debit,
                          0
                        )
                      )}
                    </td>
                    <td className="money-cell num">
                      {formatRWF(
                        selectedEntry.lines.reduce(
                          (sum, line) => sum + line.credit,
                          0
                        )
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

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
  tone: "green" | "blue" | "amber" | "rose";
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
