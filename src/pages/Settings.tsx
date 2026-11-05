import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  UserRound, KeyRound, LogOut, Download, Upload, Database, ShieldCheck, AlertTriangle, CheckCircle2, Info, X, Eye, EyeOff,
} from 'lucide-react';
import { supabase, supabaseConfigured } from '../lib/supabase';

/* ---------- what this browser stores ---------- */

const PREFIX = 'ista-fortis-';
const SETTINGS_KEY = 'ista-fortis-settings-v1';
const BACKUP_APP = 'ista-fortis-fms';
const BACKUP_VERSION = 1;
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

type Backup = { app: string; version: number; exportedAt: string; data: Record<string, string> };
type Pending = { fileName: string; backup: Backup; counts: { label: string; count: number }[] };

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

function readSettings(): { lastBackupAt?: string } {
  const v = parse(localStorage.getItem(SETTINGS_KEY));
  return v && typeof v === 'object' ? (v as { lastBackupAt?: string }) : {};
}

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const when = (iso?: string) => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const daysSince = (iso?: string) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : Infinity);
const sizeOf = (data: Record<string, string>) => {
  const bytes = Object.entries(data).reduce((s, [k, v]) => s + (k.length + v.length) * 2, 0);
  return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

/** Saves a backup file. Returns the time it was made. */
function downloadBackup(label = 'backup'): string {
  const now = new Date();
  const backup: Backup = { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), data: readAll() };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ista-fortis-${label}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return backup.exportedAt;
}

/** Checks a file really is an ISTA FORTIS backup before anything is replaced. */
function validateBackup(text: string): Backup {
  const v = parse(text) as Partial<Backup> | null;
  if (!v || typeof v !== 'object') throw new Error('This file is not a valid backup (it could not be read).');
  if (v.app !== BACKUP_APP) throw new Error('This file is not an ISTA FORTIS backup.');
  if (typeof v.version !== 'number' || v.version > BACKUP_VERSION) throw new Error('This backup was made by a newer version of the system. Update the app first.');
  if (!v.data || typeof v.data !== 'object') throw new Error('This backup has no data in it.');
  const data: Record<string, string> = {};
  for (const [k, val] of Object.entries(v.data)) {
    if (!k.startsWith(PREFIX) || typeof val !== 'string') throw new Error('This backup contains unexpected data, so it was not used.');
    if (val && parse(val) === null) throw new Error(`Part of this backup is damaged (${k}).`);
    data[k] = val;
  }
  if (!Object.keys(data).length) throw new Error('This backup is empty.');
  return { app: BACKUP_APP, version: v.version, exportedAt: typeof v.exportedAt === 'string' ? v.exportedAt : '', data };
}

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
.st-confirm{border:1px solid #f3c9cf;background:#fff8f9;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px}
.st-confirm h4{margin:0;font-size:15px}
.st-confirm .st-counts{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
.st-confirm .st-count{background:#fff}
.st-file{display:none}

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
  const [email, setEmail] = useState('');
  const [lastSignIn, setLastSignIn] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const [data, setData] = useState<Record<string, string>>(readAll);
  const [lastBackupAt, setLastBackupAt] = useState(() => readSettings().lastBackupAt);
  const [pending, setPending] = useState<Pending | null>(null);
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
  const backupOverdue = totalRecords > 0 && daysSince(lastBackupAt) >= 7;

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

  /* backup */
  const backupNow = () => {
    setDataMsg(null);
    try {
      const at = downloadBackup();
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readSettings(), lastBackupAt: at }));
      setLastBackupAt(at);
      setDataMsg({ kind: 'ok', text: 'Backup downloaded. Keep the file somewhere safe, such as Google Drive or a USB stick.' });
    } catch {
      setDataMsg({ kind: 'error', text: 'The backup could not be created. Check that the browser allows downloads.' });
    }
  };

  const chooseFile = async (file: File | undefined) => {
    setDataMsg(null); setPending(null);
    if (!file) return;
    try {
      const backup = validateBackup(await file.text());
      setPending({ fileName: file.name, backup, counts: countsOf(backup.data) });
    } catch (e) {
      setDataMsg({ kind: 'error', text: e instanceof Error ? e.message : 'This file could not be used.' });
    }
  };

  const restore = () => {
    if (!pending) return;
    try {
      // Safety copy of what is here now, in case the wrong file was chosen.
      if (Object.keys(readAll()).length) downloadBackup('before-restore');
      Object.keys(readAll()).forEach((k) => localStorage.removeItem(k));
      Object.entries(pending.backup.data).forEach(([k, v]) => localStorage.setItem(k, v));
      // Reload so every page and the ledger read the restored data.
      window.location.reload();
    } catch {
      setDataMsg({ kind: 'error', text: 'The restore could not finish. Browser storage may be full or blocked. Your previous data was saved to a file first.' });
      setData(readAll());
    }
  };

  return (
    <section className="projects-module">
      <style>{SETTINGS_CSS}</style>

      <div className="welcome-row">
        <div>
          <div className="eyebrow">SYSTEM</div>
          <h2>Settings</h2>
          <p>Your account, and the data stored in this browser.</p>
        </div>
      </div>

      <div className="st-grid">
        {/* ---------- account ---------- */}
        <section className="st-card" aria-labelledby="st-account">
          <Head icon={<UserRound size={19} />} tone="green" id="st-account" title="Account" sub="Who is signed in" />
          {supabaseConfigured ? (
            <>
              <div className="st-row"><span>Email</span><strong>{email || '—'}</strong></div>
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

        {/* ---------- data & backup ---------- */}
        <section className="st-card wide" aria-labelledby="st-data">
          <Head icon={<Database size={19} />} tone="amber" id="st-data" title="Data & backup" sub={`Stored in this browser · ${sizeOf(data)} · last backup: ${when(lastBackupAt)}`} />

          <p className="st-msg info"><Info size={16} /><span>Your records are saved in this browser only. Another computer or browser starts empty, and clearing browser data deletes them. Download a backup regularly; restore it to move your data to another device.</span></p>
          {backupOverdue && <p className="st-msg warn" role="status"><AlertTriangle size={16} /><span>{lastBackupAt ? `Your last backup was ${daysSince(lastBackupAt)} days ago.` : 'You have not made a backup yet.'} Download one now.</span></p>}

          <div className="st-counts">
            {counts.map((c) => <div className="st-count" key={c.label}><b>{c.count.toLocaleString('en-RW')}</b><span>{c.label}</span></div>)}
          </div>

          <div className="st-split">
            <div className="st-box">
              <h4>Download a backup</h4>
              <p>Saves everything on this browser to one file.</p>
              <div className="st-actions"><button type="button" className="st-btn primary" onClick={backupNow} disabled={!Object.keys(data).length}><Download size={16} /> Download backup</button></div>
            </div>
            <div className="st-box">
              <h4>Restore from a backup</h4>
              <p>Replaces the data on this browser with the data in a backup file.</p>
              <div className="st-actions">
                <label className="st-btn" htmlFor="st-restore-file"><Upload size={16} /> Choose backup file</label>
                <input id="st-restore-file" className="st-file" type="file" accept=".json,application/json" onChange={(e) => { void chooseFile(e.target.files?.[0]); e.target.value = ''; }} />
              </div>
            </div>
          </div>

          {dataMsg && <p className={`st-msg ${dataMsg.kind}`} role={dataMsg.kind === 'error' ? 'alert' : 'status'}>{dataMsg.kind === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}<span>{dataMsg.text}</span></p>}

          {pending && (
            <div className="st-confirm" role="alertdialog" aria-labelledby="st-confirm-title">
              <h4 id="st-confirm-title">Replace this browser's data with "{pending.fileName}"?</h4>
              <p className="st-msg warn"><AlertTriangle size={16} /><span>Backup made on {when(pending.backup.exportedAt || undefined)}. Everything currently on this browser will be replaced. A copy of the current data downloads first, just in case.</span></p>
              <div className="st-counts">
                {pending.counts.map((c) => <div className="st-count" key={c.label}><b>{c.count.toLocaleString('en-RW')}</b><span>{c.label}</span></div>)}
              </div>
              <div className="st-actions">
                <button type="button" className="st-btn" onClick={() => setPending(null)}><X size={16} /> Cancel</button>
                <button type="button" className="st-btn danger-solid" onClick={restore}><Upload size={16} /> Replace and restore</button>
              </div>
            </div>
          )}
        </section>

        {/* ---------- about ---------- */}
        <section className="st-card wide" aria-labelledby="st-about">
          <Head icon={<Info size={19} />} tone="blue" id="st-about" title="About" sub="ISTA FORTIS Group Ltd · Financial Management System" />
          <div className="st-split">
            <div className="st-row"><span>Records on this browser</span><strong>{totalRecords.toLocaleString('en-RW')}</strong></div>
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
