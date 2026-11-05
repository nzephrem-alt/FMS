import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from './supabase';

export type Role = 'admin' | 'viewer';

export type Access = {
  /** Still loading the profile from Supabase. */
  loading: boolean;
  email: string;
  /** Name to show: the profile name, or one made from the email. */
  name: string;
  title: string;
  role: Role;
  isAdmin: boolean;
  /** False when an Admin has removed this person's access. */
  active: boolean;
  /** Set when the profile could not be loaded (for example the roles script has not been run yet). */
  problem: string;
};

/** "ephrem.nzayikorera@x.rw" → "Ephrem Nzayikorera". */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const words = local.replace(/[._-]+/g, ' ').replace(/\d+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return email || 'Signed in';
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

const fallback = (email: string): Access => ({
  loading: false, email, name: nameFromEmail(email), title: '', role: 'viewer', isAdmin: false, active: true, problem: '',
});

const AccessContext = createContext<Access>(fallback(''));

/**
 * Loads the signed-in person's profile (name, title, role) once and shares it with every page.
 * Anyone without a profile is treated as a Viewer, so a missing profile never grants editing.
 */
export function AccessProvider({ userId, email, children }: { userId: string; email: string; children: ReactNode }) {
  const [access, setAccess] = useState<Access>({ ...fallback(email), loading: true });

  useEffect(() => {
    let alive = true;
    if (!supabase) { setAccess(fallback(email)); return; }
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error || !data) {
          setAccess({ ...fallback(email), problem: error ? error.message : 'No profile found for this account.' });
          return;
        }
        const active = data.active !== false;
        const role: Role = data.role === 'admin' && active ? 'admin' : 'viewer';
        setAccess({
          loading: false,
          email,
          name: (typeof data.full_name === 'string' && data.full_name.trim()) || nameFromEmail(email),
          title: typeof data.title === 'string' ? data.title.trim() : '',
          role,
          isAdmin: role === 'admin',
          active,
          problem: '',
        });
      });
    return () => { alive = false; };
  }, [userId, email]);

  if (!access.loading && !access.active) return <AccessRemoved email={email} />;
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>;
}

/** Shown to someone whose access an Admin has removed. */
function AccessRemoved({ email }: { email: string }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f6f8f6', fontFamily: "'Poppins',sans-serif", color: '#1c2b22' }}>
      <div style={{ maxWidth: 460, background: '#fff', border: '1px solid #e3e9e5', borderRadius: 18, padding: 28 }}>
        <h1 style={{ fontSize: 20, margin: '0 0 10px' }}>Your access has been removed</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: '#3b4a42', margin: '0 0 18px' }}>
          {email} no longer has access to the ISTA FORTIS Financial Management System. Contact the Admin if you think this is a mistake.
        </p>
        <button type="button" onClick={() => { void supabase?.auth.signOut(); }}
          style={{ height: 40, padding: '0 16px', border: 0, borderRadius: 12, background: '#d5f56b', color: '#1d2b12', font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Sign out
        </button>
      </div>
    </div>
  );
}

export function useAccess(): Access {
  return useContext(AccessContext);
}

export const roleLabel = (role: Role) => (role === 'admin' ? 'Admin' : 'Viewer');
