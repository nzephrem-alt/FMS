import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { supabase } from '../lib/supabase';
import { roleLabel, useAccess } from '../lib/access';

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
  LogOut,
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
.if-sidebar .brand-logo{display:block;width:150px;max-width:100%;height:auto;margin:2px 0 0 6px}
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
.if-sidebar .profile{position:relative}
.if-sidebar .profile-copy{min-width:0}
.if-sidebar .profile-copy strong,.if-sidebar .profile-copy span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.if-sidebar .profile-more{width:32px;height:32px;flex-shrink:0;border:0;border-radius:9px;background:transparent;color:var(--text);display:grid;place-items:center;cursor:pointer}
.if-sidebar .profile-more:hover,.if-sidebar .profile-more[aria-expanded="true"]{background:var(--brand-tint-2)}
.if-sidebar .profile-more:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.if-sidebar .profile-menu{position:absolute;left:0;right:0;bottom:calc(100% + 8px);z-index:5;background:#fff;border:1px solid var(--line);border-radius:14px;padding:6px;box-shadow:0 12px 30px #0b3d2a24}
.if-sidebar .profile-menu-email{padding:8px 10px 10px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--line);margin-bottom:4px;overflow-wrap:anywhere}
.if-sidebar .profile-menu button{width:100%;height:38px;display:flex;align-items:center;gap:10px;padding:0 10px;border:0;border-radius:9px;background:transparent;color:var(--text);font:inherit;font-size:13.5px;font-weight:500;text-align:left;cursor:pointer}
.if-sidebar .profile-menu button:hover{background:var(--brand-tint);color:var(--brand-deep)}
.if-sidebar .profile-menu button.danger{color:#a63a49}
.if-sidebar .profile-menu button.danger:hover{background:#fdf0f2;color:#a63a49}

@media(prefers-reduced-motion:reduce){.if-sidebar .nav-item,.if-sidebar .nav-item svg{transition:none}}
`;

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '').slice(0, 2);
  return (letters || 'U').toUpperCase();
}

function Sidebar({
  active,
  onNavigate,
  mobileOpen,
  setMobileOpen,
}: SidebarProps) {
  const access = useAccess();
  const [menuOpen, setMenuOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // Close the profile menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => { if (profileRef.current && !profileRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const name = access.name;
  const email = access.email;
  const subtitle = access.loading ? email : [access.title, roleLabel(access.role)].filter(Boolean).join(' · ');

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
          <img className="brand-logo" src="/istafortis-green-logo.png" alt="ISTA FORTIS Group Ltd" />

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
          <div className="help-card">
            <div className="help-icon">
              <HardHat size={18} />
            </div>

            <strong>Need assistance?</strong>

            <p>
              Contact your system administrator for support.
            </p>
          </div>

          <div className="profile" ref={profileRef}>
            <div className="avatar" aria-hidden="true">{initialsOf(name)}</div>

            <div className="profile-copy" title={email}>
              <strong>{name}</strong>
              <span>{subtitle || email || 'Account'}</span>
            </div>

            <button
              type="button"
              className="profile-more"
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <MoreHorizontal size={18} />
            </button>

            {menuOpen && (
              <div className="profile-menu" role="menu">
                {email && <div className="profile-menu-email">{email}</div>}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); onNavigate('Settings'); setMobileOpen(false); }}
                >
                  <Settings size={16} /> Settings
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => { setMenuOpen(false); void supabase?.auth.signOut(); }}
                >
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
