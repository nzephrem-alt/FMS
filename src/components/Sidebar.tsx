import type { Dispatch, SetStateAction } from 'react';

import {
  LayoutDashboard,
  Building2,
  Wallet,
  ReceiptText,
  Users,
  Landmark,
  ArrowLeftRight,
  ChartNoAxesCombined,
  Settings,
  MoreHorizontal,
  HardHat,
  FileText,
  ClipboardList,
} from 'lucide-react';

type SidebarProps = {
  active: string;
  onNavigate: (page: string) => void;
  mobileOpen: boolean;
  setMobileOpen: Dispatch<SetStateAction<boolean>>;
};

const navGroups = [
  {
    title: 'WORKSPACE',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard },
      { label: 'Projects', icon: Building2 },
      { label: 'Project Costs', icon: HardHat },
      { label: 'Site Labour', icon: ClipboardList },
      { label: 'Client Invoices', icon: FileText },
      { label: 'Income', icon: Wallet },
      { label: 'Expenses', icon: ReceiptText },
      { label: 'Staff & Payroll', icon: Users },
    ],
  },
  {
    title: 'FINANCE',
    items: [
      { label: 'Cash & Bank', icon: Landmark },
      { label: 'Transactions', icon: ArrowLeftRight },
      { label: 'Accounting', icon: ChartNoAxesCombined },
      { label: 'Financial Reports', icon: FileText },
    ],
  },
];

/**
 * Sidebar styles live here so this component is a single file. Colours are taken from the
 * ISTA FORTIS logo: main green #1a9e6f, deeper green #0f7a53 (the "GROUP LTD" line) and
 * very light mint tints for surfaces. Everything is scoped under .if-sidebar.
 */
const SIDEBAR_CSS = `
.sidebar.if-sidebar{
  --brand:#1a9e6f;--brand-deep:#0f7a53;--brand-ink:#0b3d2a;
  --brand-tint:#e7f6ef;--brand-tint-2:#d3eee2;--lime:#d5f56b;
  --text:#2b3a32;--muted:#8a978f;--line:#e8efeb;
  background:#fff;color:var(--text);border-right:1px solid var(--line);
}

/* brand */
.if-sidebar .brand{border-bottom:0}
.if-sidebar .brand-mark{
  width:40px;height:40px;border-radius:12px;display:grid;place-items:center;
  background:var(--brand);color:#fff;box-shadow:0 6px 14px #1a9e6f40;
}
.if-sidebar .brand-mark svg{display:block}
.if-sidebar .brand-name{color:var(--brand);font-weight:800;letter-spacing:.6px}
.if-sidebar .brand-caption{color:var(--brand-deep);font-weight:500;letter-spacing:3px}
.if-sidebar .close-menu{color:var(--brand-deep)}

/* navigation */
.if-sidebar .nav-heading{color:var(--muted);font-size:10.5px;font-weight:600;letter-spacing:1.2px}
.if-sidebar .nav-item{
  color:var(--text);border-radius:12px;position:relative;
  transition:background .15s ease,color .15s ease;
}
.if-sidebar .nav-item svg{color:#6f7f76;transition:color .15s ease}
.if-sidebar .nav-item:hover{background:var(--brand-tint);color:var(--brand-deep)}
.if-sidebar .nav-item:hover svg{color:var(--brand)}
.if-sidebar .nav-item.active{
  background:var(--brand);color:#fff;font-weight:600;box-shadow:0 6px 14px #1a9e6f33;
}
.if-sidebar .nav-item.active svg{color:#fff}
.if-sidebar .nav-item.active::after{
  content:"";position:absolute;right:10px;top:50%;width:6px;height:6px;margin-top:-3px;
  border-radius:50%;background:var(--lime);
}
.if-sidebar .nav-item:focus-visible,.if-sidebar .close-menu:focus-visible{outline:2px solid var(--brand);outline-offset:2px}

/* bottom */
.if-sidebar .sidebar-bottom{border-top:1px solid var(--line)}
.if-sidebar .help-card{
  background:var(--brand-tint);border:1px solid var(--brand-tint-2);border-radius:16px;color:var(--brand-deep);
}
.if-sidebar .help-card strong{color:var(--brand-ink)}
.if-sidebar .help-card p{color:var(--brand-deep);opacity:.8}
.if-sidebar .help-icon{background:var(--brand);color:#fff;border-radius:10px}
.if-sidebar .profile{border-radius:14px;color:var(--text)}
.if-sidebar .profile:hover{background:var(--brand-tint)}
.if-sidebar .avatar{background:var(--brand-deep);color:#fff}
.if-sidebar .profile-copy strong{color:var(--brand-ink)}
.if-sidebar .profile-copy span{color:var(--muted)}

@media(prefers-reduced-motion:reduce){.if-sidebar .nav-item,.if-sidebar .nav-item svg{transition:none}}
`;

/** Simplified version of the logo's roof, window and pin marks, drawn in white on the green tile. */
function LogoMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 26 L16 12 L29 26" />
      <path d="M8 26 L16 17.5 L24 26" />
      <rect x="13.5" y="21" width="5" height="5" strokeWidth="1.5" />
      <path d="M16 12 V6" />
      <circle cx="16" cy="4.5" r="1.8" fill="#fff" stroke="none" />
      <circle cx="7" cy="9" r="1.6" fill="#fff" stroke="none" />
      <circle cx="25" cy="9" r="1.6" fill="#fff" stroke="none" />
    </svg>
  );
}

function Sidebar({
  active,
  onNavigate,
  mobileOpen,
  setMobileOpen,
}: SidebarProps) {
  return (
    <>
      <style>{SIDEBAR_CSS}</style>

      {mobileOpen && (
        <button
          className="mobile-scrim"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside className={`sidebar if-sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark" aria-label="ISTA FORTIS">
            <LogoMark />
          </div>

          <div>
            <div className="brand-name">ISTA FORTIS</div>
            <div className="brand-caption">GROUP LTD</div>
          </div>

          <button
            className="close-menu"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            ×
          </button>
        </div>

        <nav>
          {navGroups.map((group) => (
            <div className="nav-group" key={group.title}>
              <div className="nav-heading">{group.title}</div>

              {group.items.map((item) => {
                const Icon = item.icon;

                return (
                  <button
                    key={item.label}
                    className={`nav-item ${
                      active === item.label ? 'active' : ''
                    }`}
                    aria-current={active === item.label ? 'page' : undefined}
                    onClick={() => {
                      onNavigate(item.label);
                      setMobileOpen(false);
                    }}
                  >
                    <Icon size={18} strokeWidth={1.8} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button
            className={`nav-item ${
              active === 'Settings' ? 'active' : ''
            }`}
            aria-current={active === 'Settings' ? 'page' : undefined}
            onClick={() => {
              onNavigate('Settings');
              setMobileOpen(false);
            }}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>

          <div className="help-card">
            <div className="help-icon">
              <HardHat size={18} />
            </div>

            <strong>Need assistance?</strong>

            <p>
              Contact your system administrator for support.
            </p>
          </div>

          <div className="profile">
            <div className="avatar">MD</div>

            <div className="profile-copy">
              <strong>Managing Director</strong>
              <span>Administrator</span>
            </div>

            <MoreHorizontal size={18} />
          </div>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
