import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  UserRound, KeyRound, LogOut, Database, ShieldCheck, AlertTriangle, CheckCircle2, Info, X, Eye, EyeOff,
  Users, UserPlus, Pencil, Trash2, Copy, Check, DatabaseZap,
} from 'lucide-react';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { roleLabel, useAccess } from '../lib/access';
import type { Role } from '../lib/access';
import { useDatabase } from '../lib/database';

/* ---------- what this browser stores ---------- */

const PREFIX = 'ista-fortis-';
const MIN_PASSWORD = 8;

/** The records the app keeps, with how to count each one. */
const DATASETS: { key: string; label: string; count: (v: unknown) => number }[] = [
  { key: 'ista-fortis-projects-v1', label: 'Projects', count: listLength },
  { key: 'ista-fortis-project-costs-v1', label: 'Project costs', count: listLength },
  { key: 'ista-fortis-site-labour-v1', label: 'Site labour worker-days', count: (v) => listLength((v as { entries?: unknown })?.entries) },
  { key: 'ista-fortis-invoices-v1', label: 'Client invoices', count: listLength },
  { key: 'ista-fortis-expenses-v1', label: 'Expenses', count: listLength },
  { key: 'ista-fortis-staff-v1', label: 'Staff', count: listLength },
  { key: 'ista-fortis-payroll-payments-v1', label: 'Salary payments', count: listLength },
  { key: 'ista-fortis-ledger-v1', label: 'Ledger entries', count: listLength },
  { key: 'ista-fortis-audit-v1', label: 'Audit log entries', count: listLength },
];

function listLength(v: unknown): number { return Array.isArray(v) ? v.length : 0; }
function parse(raw: string | null | undefined): unknown { try { return raw ? JSON.parse(raw) : null; } catch { return null; } }

function readAll(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) out[k] = localStorage.getItem(k) ?? '';
    }
  } catch { /* storage blocked */ }
  return out;
}

function countsOf(data: Record<string, string>) {
  return DATASETS.map((d) => ({ label: d.label, count: d.count(parse(data[d.key])) }));
}

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const when = (iso?: string) => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/* ---------- styles ---------- */

const SETTINGS_CSS = `
.projects-module{--lime:#d5f56b;--lime-ink:#1d2b12;--ink:#1c2b22;--muted:#5f6e66;--line:#edf0f1;display:flex;flex-direction:column;gap:22px;color:var(--ink)}
.projects-module button:focus-visible{outline:2px solid #2f8f6b;outline-offset:2px}
.projects-module button:disabled{opacity:.55;cursor:not-allowed}
.projects-module .welcome-row{margin-bottom:0;gap:20px;flex-wrap:wrap;align-items:flex-end}
.projects-module .welcome-row>div:first-child{text-align:left}
.projects-module .welcome-row h2{font-size:28px;font-weight:700;letter-spacing:-.4px;margin:6px 0 4px;color:var(--ink)}
.projects-module .welcome-row p{font-size:14px;color:var(--muted)}

.st-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;align-items:start}
.st-card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 1px 2px #1c2b2208;display:flex;flex-direction:column;gap:16px;min-width:0}
.st-card.wide{grid-column:1/-1}
.st-head{display:flex;align-items:center;gap:12px}
.st-icon{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;flex-shrink:0}
.st-icon.green{background:#bdeed6;color:#1f6b46}.st-icon.blue{background:#c9defb;color:#2f5a9c}.st-icon.amber{background:#fde5c4;color:#8a5516}
.st-head h3{margin:0;font-size:17px;font-weight:600}
.st-head p{margin:2px 0 0;font-size:13px;color:var(--muted)}
.st-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:12px;background:#f6f8f7}
.st-row span{font-size:13px;color:var(--muted)}
.st-row strong{font-size:14px;font-weight:600;overflow-wrap:anywhere;text-align:right}
.st-form{display:grid;gap:12px}
.st-field{display:grid;gap:6px;font-size:12.5px;font-weight:600;color:#3b4a42}
.st-input{position:relative}
.st-input input{width:100%;box-sizing:border-box;height:42px;padding:0 44px 0 12px;border:1px solid #e3e9e5;border-radius:11px;font:inherit;font-size:14px;font-weight:400;color:var(--ink);background:#fff;outline:none}
.st-input input:focus{border-color:#1a9e6f;box-shadow:0 0 0 3px #1a9e6f22}
.st-eye{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:34px;height:34px;border:0;border-radius:9px;background:transparent;color:var(--muted);display:grid;place-items:center;cursor:pointer}
.st-actions{display:flex;flex-wrap:wrap;gap:10px}
.st-btn{height:40px;padding:0 15px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border-radius:12px;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;border:1px solid var(--line);background:#fff;color:var(--ink)}
.st-btn:hover:not(:disabled){background:#f4f7f6}
.st-btn.primary{background:var(--lime);border-color:var(--lime);color:var(--lime-ink)}
.st-btn.primary:hover:not(:disabled){background:#c8ea52}
.st-btn.danger{color:#a63a49;border-color:#f3c9cf}
.st-btn.danger:hover:not(:disabled){background:#fdf0f2}
.st-btn.danger-solid{background:#b04a58;border-color:#b04a58;color:#fff}
.st-btn.danger-solid:hover:not(:disabled){background:#963d4a}
.st-msg{display:flex;gap:10px;align-items:flex-start;margin:0;padding:12px 14px;border-radius:12px;font-size:13.5px;line-height:1.5}
.st-msg svg{flex-shrink:0;margin-top:2px}
.st-msg.ok{background:#bdeed6;color:#1f6b46}.st-msg.error{background:#fbd6db;color:#8f2d3b}.st-msg.warn{background:#fde5c4;color:#7a4c14}.st-msg.info{background:#eef4fb;color:#2f4f7a}
.st-counts{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
.st-count{padding:12px 14px;border-radius:12px;background:#f6f8f7}
.st-count b{display:block;font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
.st-count span{font-size:12.5px;color:var(--muted)}
.st-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
.st-box{border:1px solid var(--line);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:10px}
.st-box h4{margin:0;font-size:15px;font-weight:600}
.st-box p{margin:0;font-size:13.5px;color:var(--muted);line-height:1.55}
.st-move{border-color:#cfe7d9;background:#f7fbf8}
.st-confirm{border:1px solid #f3c9cf;background:#fff8f9;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px}
.st-confirm h4{margin:0;font-size:15px}
.st-confirm .st-counts{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
.st-confirm .st-count{background:#fff}
.st-file{display:none}

/* team */
.st-team-form{display:grid;grid-template-columns:1.4fr 1.2fr 1.2fr .8fr auto;gap:10px;align-items:end}
.st-team-form .st-field input,.st-team-form .st-field select,.st-member-edit input,.st-member-edit select{width:100%;box-sizing:border-box;height:42px;padding:0 12px;border:1px solid #e3e9e5;border-radius:11px;font:inherit;font-size:14px;font-weight:400;color:var(--ink);background:#fff;outline:none}
.st-team-form .st-field input:focus,.st-team-form .st-field select:focus,.st-member-edit input:focus,.st-member-edit select:focus{border-color:#1a9e6f;box-shadow:0 0 0 3px #1a9e6f22}
.st-members{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.st-member{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) auto auto auto;gap:14px;align-items:center;padding:14px 16px;border-top:1px solid #f1f4f4}
.st-member:first-child{border-top:0}
.st-member-who strong{display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-member-who span{display:block;font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-member-title{font-size:13.5px;color:#3b4a42;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-pill{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.st-pill.admin{background:#c9defb;color:#2f5a9c}.st-pill.viewer{background:#eceff0;color:#4f5d55}
.st-pill.active{background:#bdeed6;color:#1f6b46}.st-pill.invited{background:#fde5c4;color:#8a5516}
.st-member-actions{display:flex;gap:6px;justify-content:flex-end}
.st-icon-btn{width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--line);border-radius:10px;background:#fff;color:#4f5d55;cursor:pointer}
.st-icon-btn:hover:not(:disabled){background:#f1f5f4;color:var(--ink)}
.st-icon-btn.danger:hover:not(:disabled){background:#fdf0f2;color:#a63a49}
.st-member-edit{grid-column:1/-1;display:grid;grid-template-columns:1.2fr 1.2fr .8fr auto;gap:10px;align-items:end;padding-top:4px}
.st-member-confirm{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-radius:12px;background:#fff8f9;border:1px solid #f3c9cf;font-size:13.5px;color:#7a2533}
.st-invite{border:1px solid #cfe6d6;background:#f3fbf6;border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.st-invite pre{margin:0;white-space:pre-wrap;font:inherit;font-size:13.5px;line-height:1.6;color:#2b3a32}
@media(max-width:1000px){.st-team-form{grid-template-columns:1fr 1fr}.st-team-form .st-actions{grid-column:1/-1}}
@media(max-width:700px){
  .st-team-form,.st-member-edit{grid-template-columns:1fr}
  .st-member{grid-template-columns:minmax(0,1fr) auto;row-gap:8px}
  .st-member-title{grid-column:1/-1;order:3}
  .st-member-actions{grid-column:1/-1;order:4;justify-content:flex-start}
}

@media(max-width:900px){.st-grid,.st-split{grid-template-columns:1fr}}
@media(max-width:640px){
  .projects-module .welcome-row h2{font-size:24px}
  .st-card{padding:18px 16px}
  .st-input input{font-size:16px}
  .st-actions>.st-btn{flex:1 1 auto}
  .st-counts{grid-template-columns:repeat(2,minmax(0,1fr))}
}
`;

/* ---------- page ---------- */

export default function Settings() {
  const access = useAccess();
  const db = useDatabase();
  const toMove = access.isAdmin ? db.sections.filter((x) => !x.inDatabase) : [];
  const inDb = db.sections.filter((x) => x.inDatabase).map((x) => x.label);
  const [moving, setMoving] = useState('');
  const [moveConfirm, setMoveConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [lastSignIn, setLastSignIn] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const [data] = useState<Record<string, string>>(readAll);
  const [dataMsg, setDataMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data: d }) => {
      setEmail(d.user?.email ?? '');
      setLastSignIn(d.user?.last_sign_in_at ?? '');
    });
  }, []);

  const counts = useMemo(() => countsOf(data), [data]);
  const totalRecords = counts.reduce((s, c) => s + c.count, 0);

  /* account */
  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPwMsg(null);
    if (!supabase) return;
    if (password.length < MIN_PASSWORD) { setPwMsg({ kind: 'error', text: `Use at least ${MIN_PASSWORD} characters.` }); return; }
    if (password !== confirm) { setPwMsg({ kind: 'error', text: 'The two passwords do not match.' }); return; }
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setPwBusy(false);
    if (error) {
      const m = error.message.toLowerCase();
      setPwMsg({ kind: 'error', text: m.includes('different from the old') || m.includes('same') ? 'Choose a password different from your current one.' : m.includes('reauthentication') ? 'For security, sign out and use "Forgot password?" to set a new one.' : error.message });
      return;
    }
    setPassword(''); setConfirm('');
    setPwMsg({ kind: 'ok', text: 'Password changed. Use the new one next time you sign in.' });
  };

  const signOut = async (everywhere: boolean) => {
    if (!supabase) return;
    setSigningOut(true);
    await supabase.auth.signOut(everywhere ? { scope: 'global' } : undefined);
    // The app returns to the sign-in page automatically.
  };

  /* one-time move of a section into the database */
  const moveSection = async (table: string) => {
    setDataMsg(null);
    setMoving(table);
    const problem = await db.moveToDatabase(table); // reloads the page when it works
    setMoving('');
    if (problem) setDataMsg({ kind: 'error', text: problem });
  };

  return (
    <section className="projects-module">
      <style>{SETTINGS_CSS}</style>

      <div className="welcome-row">
        <div>
          <div className="eyebrow">SYSTEM</div>
          <h2>Settings</h2>
          <p>Your account, your team and the company records.</p>
        </div>
      </div>

      <div className="st-grid">
        {/* ---------- account ---------- */}
        <section className="st-card" aria-labelledby="st-account">
          <Head icon={<UserRound size={19} />} tone="green" id="st-account" title="Account" sub="Who is signed in" />
          {supabaseConfigured ? (
            <>
              <div className="st-row"><span>Name</span><strong>{access.name}</strong></div>
              <div className="st-row"><span>Title</span><strong>{access.title || '—'}</strong></div>
              <div className="st-row"><span>Role</span><strong>{access.loading ? '…' : roleLabel(access.role)}</strong></div>
              <div className="st-row"><span>Email</span><strong>{email || access.email || '—'}</strong></div>
              {access.problem && <p className="st-msg warn"><AlertTriangle size={16} /><span>Your profile could not be loaded, so you have view-only access. If you are the Admin, run the roles script in Supabase.</span></p>}
              <div className="st-row"><span>Last sign-in</span><strong>{when(lastSignIn || undefined)}</strong></div>
              <div className="st-actions">
                <button type="button" className="st-btn" onClick={() => void signOut(false)} disabled={signingOut}><LogOut size={16} /> Sign out</button>
                <button type="button" className="st-btn danger" onClick={() => void signOut(true)} disabled={signingOut} title="Signs this account out on every phone and computer"><ShieldCheck size={16} /> Sign out everywhere</button>
              </div>
            </>
          ) : (
            <p className="st-msg warn"><AlertTriangle size={16} /><span>Sign-in is not set up yet. Add the Supabase keys in Vercel.</span></p>
          )}
        </section>

        <section className="st-card" aria-labelledby="st-password">
          <Head icon={<KeyRound size={19} />} tone="blue" id="st-password" title="Change password" sub={`At least ${MIN_PASSWORD} characters`} />
          <form className="st-form" onSubmit={changePassword} noValidate>
            <label className="st-field">New password
              <span className="st-input">
                <input type={showPw ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!supabaseConfigured} />
                <button type="button" className="st-eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>{showPw ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </span>
            </label>
            <label className="st-field">Confirm new password
              <span className="st-input"><input type={showPw ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={!supabaseConfigured} /></span>
            </label>
            {pwMsg && <p className={`st-msg ${pwMsg.kind}`} role={pwMsg.kind === 'error' ? 'alert' : 'status'}>{pwMsg.kind === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}<span>{pwMsg.text}</span></p>}
            <div className="st-actions"><button type="submit" className="st-btn primary" disabled={pwBusy || !supabaseConfigured}><KeyRound size={16} /> {pwBusy ? 'Saving…' : 'Save new password'}</button></div>
          </form>
        </section>

        {access.isAdmin && <TeamCard currentEmail={access.email} />}

        {/* ---------- data ---------- */}
        <section className="st-card wide" aria-labelledby="st-data">
          <Head icon={<Database size={19} />} tone="amber" id="st-data" title="Data" sub={`${toMove.length ? 'Partly saved in the database' : 'Saved in the database'} · ${totalRecords.toLocaleString('en-RW')} records`} />

          {toMove.length
            ? <p className="st-msg warn"><AlertTriangle size={16} /><span>{toMove.map((x) => x.label).join(', ')} {toMove.length === 1 ? 'is' : 'are'} still only on this computer. Move {toMove.length === 1 ? 'it' : 'them'} below so your team can see {toMove.length === 1 ? 'it' : 'them'} and {toMove.length === 1 ? 'it is' : 'they are'} kept safe.</span></p>
            : inDb.length > 0 && <p className="st-msg ok"><CheckCircle2 size={16} /><span>All records are saved in the database. They open on any computer you sign in from{access.isAdmin ? ', and every change is saved automatically' : ''}.</span></p>}

          {toMove.map((x) => (
            <div className="st-box st-move" key={x.table}>
              <h4>Move {x.label.toLowerCase()} to the database</h4>
              <p>{x.onThisComputer.toLocaleString('en-RW')} {x.label.toLowerCase()} are only on this computer. Do this once, from the computer with your up-to-date records.</p>
              {moveConfirm !== x.table
                ? <div className="st-actions"><button type="button" className="st-btn primary" onClick={() => setMoveConfirm(x.table)}><DatabaseZap size={16} /> Move {x.label.toLowerCase()}</button></div>
                : <>
                    <p className="st-msg warn"><AlertTriangle size={16} /><span>Make sure this is the browser with your latest records.</span></p>
                    <div className="st-actions">
                      <button type="button" className="st-btn" onClick={() => setMoveConfirm('')} disabled={!!moving}><X size={16} /> Cancel</button>
                      <button type="button" className="st-btn primary" onClick={() => { void moveSection(x.table); }} disabled={!!moving}><DatabaseZap size={16} /> {moving === x.table ? 'Moving…' : `Move ${x.onThisComputer.toLocaleString('en-RW')} ${x.label.toLowerCase()}`}</button>
                    </div>
                  </>}
            </div>
          ))}

          {dataMsg && <p className={`st-msg ${dataMsg.kind}`} role={dataMsg.kind === 'error' ? 'alert' : 'status'}>{dataMsg.kind === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}<span>{dataMsg.text}</span></p>}

          <div className="st-counts">
            {counts.map((c) => <div className="st-count" key={c.label}><b>{c.count.toLocaleString('en-RW')}</b><span>{c.label}</span></div>)}
          </div>
        </section>

        {/* ---------- about ---------- */}
        <section className="st-card wide" aria-labelledby="st-about">
          <Head icon={<Info size={19} />} tone="blue" id="st-about" title="About" sub="ISTA FORTIS Group Ltd · Financial Management System" />
          <div className="st-split">
            <div className="st-row"><span>Records</span><strong>{totalRecords.toLocaleString('en-RW')}</strong></div>
            <div className="st-row"><span>Currency</span><strong>Rwandan franc (RWF), whole amounts</strong></div>
          </div>
        </section>
      </div>
    </section>
  );
}

function Head({ icon, tone, id, title, sub }: { icon: ReactNode; tone: 'green' | 'blue' | 'amber'; id: string; title: string; sub: string }) {
  return (
    <div className="st-head">
      <span className={`st-icon ${tone}`} aria-hidden="true">{icon}</span>
      <div><h3 id={id}>{title}</h3><p>{sub}</p></div>
    </div>
  );
}

/* ---------- team (Admins only) ---------- */

type Member = { email: string; full_name: string | null; title: string | null; role: Role; added_at: string; has_account: boolean; active: boolean };
type Draft = { email: string; full_name: string; title: string; role: Role };
const emptyDraft: Draft = { email: '', full_name: '', title: '', role: 'viewer' };

/** Friendly text for errors from Supabase. */
function teamError(message: string, code?: string): string {
  if (code === '23505' || /duplicate key/i.test(message)) return 'This email is already on the team list.';
  if (/at least one admin/i.test(message)) return 'There must be at least one Admin. Make someone else Admin first.';
  if (/row-level security|permission denied/i.test(message)) return 'Only an Admin can manage the team.';
  if (/team_members|could not find the function|schema cache/i.test(message)) return 'The team script has not been run in Supabase yet.';
  if (/failed to fetch|network/i.test(message)) return 'Cannot reach Supabase. Check your internet connection.';
  return message;
}

function inviteText(m: { email: string; full_name: string; role: Role }): string {
  const site = typeof window !== 'undefined' ? window.location.origin : '';
  const hello = m.full_name.trim() ? `Hello ${m.full_name.trim()},` : 'Hello,';
  const access = m.role === 'admin' ? 'Admin access' : 'view-only access';
  return `${hello}\n\nYou have been given ${access} to the ISTA FORTIS Financial Management System.\n\n1. Open ${site}\n2. Choose "Create account" and use this email: ${m.email}\n3. Open the confirmation email we send you, then sign in.`;
}

function TeamCard({ currentEmail }: { currentEmail: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [invite, setInvite] = useState('');
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [removing, setRemoving] = useState<string | null>(null);
  const me = currentEmail.toLowerCase();

  const load = async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('team_members');
    setLoading(false);
    if (error) { setMsg({ kind: 'error', text: teamError(error.message, error.code) }); return; }
    setMembers(((data ?? []) as Member[]).map((m) => ({ ...m, role: m.role === 'admin' ? 'admin' : 'viewer' })));
  };
  useEffect(() => { void load(); }, []);

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMsg(null); setInvite(''); setCopied(false);
    if (!supabase) return;
    const email = draft.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setMsg({ kind: 'error', text: 'Enter a valid email address.' }); return; }
    if (members.some((m) => m.email === email)) { setMsg({ kind: 'error', text: 'This email is already on the team list.' }); return; }
    setBusy(true);
    const { error } = await supabase.from('allowed_emails').insert({ email, full_name: draft.full_name.trim() || null, title: draft.title.trim() || null, role: draft.role });
    setBusy(false);
    if (error) { setMsg({ kind: 'error', text: teamError(error.message, error.code) }); return; }
    setInvite(inviteText({ email, full_name: draft.full_name, role: draft.role }));
    setMsg({ kind: 'ok', text: `${email} can now create an account. Send them the message below.` });
    setDraft(emptyDraft);
    void load();
  };

  const startEdit = (m: Member) => {
    setRemoving(null); setMsg(null);
    setEditing(m.email);
    setEditDraft({ email: m.email, full_name: m.full_name ?? '', title: m.title ?? '', role: m.role });
  };

  const saveEdit = async () => {
    if (!supabase || !editing) return;
    setBusy(true);
    const { error } = await supabase.from('allowed_emails')
      .update({ full_name: editDraft.full_name.trim() || null, title: editDraft.title.trim() || null, role: editDraft.role })
      .eq('email', editing);
    setBusy(false);
    if (error) { setMsg({ kind: 'error', text: teamError(error.message, error.code) }); return; }
    setMsg({ kind: 'ok', text: `Saved. ${editing === me ? 'Reload the page to see your changes.' : 'The change applies next time they open the system.'}` });
    setEditing(null);
    void load();
  };

  const remove = async (email: string) => {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.from('allowed_emails').delete().eq('email', email);
    setBusy(false);
    setRemoving(null);
    if (error) { setMsg({ kind: 'error', text: teamError(error.message, error.code) }); return; }
    setMsg({ kind: 'ok', text: `${email} no longer has access.` });
    void load();
  };

  const copyInvite = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2500); }
    catch { setMsg({ kind: 'error', text: 'Copying is blocked by the browser. Select the message and copy it by hand.' }); }
  };

  return (
    <section className="st-card wide" aria-labelledby="st-team">
      <Head icon={<Users size={19} />} tone="green" id="st-team" title="Team" sub="Who can open the system. Viewers can see everything but cannot change anything." />

      <form className="st-team-form" onSubmit={add} noValidate>
        <label className="st-field">Email *<input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="name@company.com" /></label>
        <label className="st-field">Name<input value={draft.full_name} onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} placeholder="Full name" /></label>
        <label className="st-field">Title<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Site engineer" /></label>
        <label className="st-field">Role
          <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <div className="st-actions"><button type="submit" className="st-btn primary" disabled={busy}><UserPlus size={16} /> Add person</button></div>
      </form>

      {msg && <p className={`st-msg ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.kind === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}<span>{msg.text}</span></p>}

      {invite && (
        <div className="st-invite">
          <pre>{invite}</pre>
          <div className="st-actions"><button type="button" className="st-btn" onClick={() => void copyInvite(invite)}>{copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy message</>}</button></div>
        </div>
      )}

      {loading ? <p className="st-msg info"><Info size={16} /><span>Loading the team…</span></p> : members.length === 0 ? null : (
        <div className="st-members">
          {members.map((m) => {
            const self = m.email === me;
            const name = m.full_name?.trim() || m.email;
            return (
              <div className="st-member" key={m.email}>
                <div className="st-member-who"><strong>{name}{self && ' (you)'}</strong><span>{m.email}</span></div>
                <div className="st-member-title">{m.title || '—'}</div>
                <span className={`st-pill ${m.role}`}>{roleLabel(m.role)}</span>
                <span className={`st-pill ${m.has_account ? 'active' : 'invited'}`} title={m.has_account ? 'Has created an account' : 'Approved, but has not created an account yet'}>{m.has_account ? 'Active' : 'Invited'}</span>
                <div className="st-member-actions">
                  {!m.has_account && <button type="button" className="st-icon-btn" title="Copy invite message" aria-label={`Copy invite message for ${m.email}`} onClick={() => { setInvite(inviteText({ email: m.email, full_name: m.full_name ?? '', role: m.role })); setCopied(false); }}><Copy size={15} /></button>}
                  <button type="button" className="st-icon-btn" title="Edit" aria-label={`Edit ${m.email}`} onClick={() => startEdit(m)}><Pencil size={15} /></button>
                  <button type="button" className="st-icon-btn danger" title={self ? 'You cannot remove yourself' : 'Remove access'} aria-label={`Remove ${m.email}`} disabled={self} onClick={() => { setEditing(null); setRemoving(m.email); }}><Trash2 size={15} /></button>
                </div>

                {editing === m.email && (
                  <div className="st-member-edit">
                    <label className="st-field">Name<input value={editDraft.full_name} onChange={(e) => setEditDraft({ ...editDraft, full_name: e.target.value })} /></label>
                    <label className="st-field">Title<input value={editDraft.title} onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })} /></label>
                    <label className="st-field">Role
                      <select value={editDraft.role} onChange={(e) => setEditDraft({ ...editDraft, role: e.target.value as Role })}>
                        <option value="viewer">Viewer</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>
                    <div className="st-actions">
                      <button type="button" className="st-btn" onClick={() => setEditing(null)}>Cancel</button>
                      <button type="button" className="st-btn primary" onClick={() => void saveEdit()} disabled={busy}>Save</button>
                    </div>
                  </div>
                )}

                {removing === m.email && (
                  <div className="st-member-confirm" role="alertdialog" aria-label={`Remove ${m.email}`}>
                    <span>Remove access for <b>{m.email}</b>? {m.has_account ? 'They will be signed out of the system.' : 'They will no longer be able to create an account.'}</span>
                    <div className="st-actions">
                      <button type="button" className="st-btn" onClick={() => setRemoving(null)}>Cancel</button>
                      <button type="button" className="st-btn danger-solid" onClick={() => void remove(m.email)} disabled={busy}><Trash2 size={15} /> Remove access</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
