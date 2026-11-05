import { useEffect, useState } from "react";
import { Menu, LogOut } from "lucide-react";
import type { Session } from "@supabase/supabase-js";

import { supabase, supabaseConfigured } from "./lib/supabase";
import AuthPage from "./pages/AuthPage";
import { AccessProvider } from "./lib/access";
import { DatabaseGate, DatabaseStatus } from "./lib/database";

import Sidebar from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import ProjectCosts from "./pages/ProjectCosts";
import SiteLabour from "./pages/SiteLabour";
import Invoices from "./pages/Invoices";
import StaffPayroll from "./pages/StaffPayroll";
import Income from "./pages/Income";
import Expenses from "./pages/Expenses";
import Transactions from "./pages/Transactions";
import Accounting from "./pages/Accounting";
import FinancialReports from "./pages/FinancialReports";
import Settings from "./pages/Settings";

type Page =
  | "Dashboard"
  | "Projects"
  | "Project Costs"
  | "Site Labour"
  | "Client Invoices"
  | "Income"
  | "Expenses"
  | "Staff & Payroll"
  | "Cash & Bank"
  | "Transactions"
  | "Accounting"
  | "Financial Reports"
  | "Settings";

/** Styles for the sign-in gate and the sign-out button. */
const APP_AUTH_CSS = `
.auth-gate{min-height:100vh;display:grid;place-items:center;padding:24px;background:#f6f8f6;font-family:'Poppins',sans-serif;color:#1c2b22}
.auth-gate-card{max-width:560px;background:#fff;border:1px solid #e3e9e5;border-radius:18px;padding:28px}
.auth-gate-card h1{font-size:20px;margin:0 0 10px}
.auth-gate-card p,.auth-gate-card li{font-size:14px;line-height:1.6;color:#3b4a42}
.auth-gate-card code{background:#f1f5f3;padding:2px 6px;border-radius:6px;font-size:13px}
.auth-spinner{width:34px;height:34px;border-radius:50%;border:3px solid #d3eee2;border-top-color:#1a9e6f;animation:auth-spin .8s linear infinite}
@keyframes auth-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.auth-spinner{animation-duration:2.4s}}
.topbar-right .top-user span{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.signout-button{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border:1px solid #e3e9e5;border-radius:10px;background:#fff;color:#3b4a42;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.signout-button:hover{background:#f1f5f3;color:#1c2b22}
@media(max-width:760px){.signout-button span{display:none}.signout-button{width:36px;padding:0;justify-content:center}}
`;

/** Shows the sign-in page until there is a session, then the app. */
function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    if (!supabase) { setChecking(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecking(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === "PASSWORD_RECOVERY") setRecovering(true); // opened from a reset-password email
      if (event === "SIGNED_OUT") setRecovering(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) {
    return (
      <div className="auth-gate">
        <style>{APP_AUTH_CSS}</style>
        <div className="auth-gate-card">
          <h1>Sign-in is not set up yet</h1>
          <p>Add these two values in Vercel (Settings → Environment Variables), then redeploy:</p>
          <ul>
            <li><code>VITE_SUPABASE_URL</code></li>
            <li><code>VITE_SUPABASE_ANON_KEY</code></li>
          </ul>
          <p>Both are in Supabase under Project Settings → API.</p>
        </div>
      </div>
    );
  }

  if (checking) {
    return <div className="auth-gate" aria-busy="true" aria-label="Loading"><style>{APP_AUTH_CSS}</style><div className="auth-spinner" /></div>;
  }

  if (!session || recovering) {
    return <AuthPage initialMode={recovering ? "reset" : "signin"} onPasswordUpdated={() => setRecovering(false)} />;
  }

  return (
    <>
      <style>{APP_AUTH_CSS}</style>
      <AccessProvider userId={session.user.id} email={session.user.email ?? ""}>
        <DatabaseGate>
          <Workspace email={session.user.email ?? ""} onSignOut={() => { void supabase?.auth.signOut(); }} />
        </DatabaseGate>
      </AccessProvider>
    </>
  );
}

function Workspace({ email, onSignOut }: { email: string; onSignOut: () => void }) {
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

      case "Site Labour":
        return <SiteLabour />;

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

        case "Financial Reports":
        return <FinancialReports />;

      case "Settings":
        return <Settings />;

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
            <DatabaseStatus />
            <div className="top-user" title={email}>
              <div className="avatar small">{(email.slice(0, 2) || "MD").toUpperCase()}</div>
              <span>{email || "Signed in"}</span>
            </div>
            <button type="button" className="signout-button" onClick={onSignOut} title="Sign out">
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
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
