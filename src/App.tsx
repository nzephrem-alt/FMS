import { useState } from "react";
import { Menu } from "lucide-react";

import Sidebar from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import ProjectCosts from "./pages/ProjectCosts";
import Invoices from "./pages/Invoices";
import StaffPayroll from "./pages/StaffPayroll";
import Income from "./pages/Income";
import Expenses from "./pages/Expenses";
import Transactions from "./pages/Transactions";
import Accounting from "./pages/Accounting";

type Page =
  | "Dashboard"
  | "Projects"
  | "Project Costs"
  | "Client Invoices"
  | "Income"
  | "Expenses"
  | "Staff & Payroll"
  | "Cash & Bank"
  | "Transactions"
  | "Accounting"
  | "Financial Reports"
  | "Settings";

function App() {
  const [activePage, setActivePage] = useState<Page>("Dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNavigate = (page: string) => {
    setActivePage(page as Page);
    setMobileOpen(false);
  };

  const renderPage = () => {
    switch (activePage) {
      case "Dashboard":
        return <Dashboard onNavigate={handleNavigate} />;

      case "Projects":
        return <Projects />;

      case "Project Costs":
        return <ProjectCosts />;

      case "Client Invoices":
        return <Invoices />;

      case "Staff & Payroll":
        return <StaffPayroll />;

        case 'Income':
  return <Income />;

        case 'Expenses':
  return <Expenses />;

case "Transactions":
  return <Transactions />;

  case "Accounting":
  return <Accounting />;


      default:
        return (
          <div className="placeholder-panel">
            <h2>{activePage}</h2>
            <p>
              This module is not available yet.
              It will be added as development progresses.
            </p>
            <span className="coming-label">Coming soon</span>
          </div>
        );
    }
  };

  return (
    <div className="app-shell">
      <Sidebar
        active={activePage}
        onNavigate={handleNavigate}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="menu-toggle"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={21} />
            </button>

            <div className="breadcrumb">
              ISTA FORTIS
              <span>/</span>
              <strong>{activePage}</strong>
            </div>
          </div>

          <div className="topbar-right">
            <div className="top-user">
              <div className="avatar small">MD</div>
              <span>Managing Director</span>
            </div>
          </div>
        </header>

        <main className="page-content">
          {renderPage()}
        </main>

        <footer className="footer">
          <span>© {new Date().getFullYear()} ISTA FORTIS Group Ltd</span>
          <span>Financial Management System</span>
        </footer>
      </div>
    </div>
  );
}

export default App;