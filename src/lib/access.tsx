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
  loading: false, email, name: nameFromEmail(email), title: '', role: 'viewer', isAdmin: false, problem: '',
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
      .select('full_name, title, role')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error || !data) {
          setAccess({ ...fallback(email), problem: error ? error.message : 'No profile found for this account.' });
          return;
        }
        const role: Role = data.role === 'admin' ? 'admin' : 'viewer';
        setAccess({
          loading: false,
          email,
          name: (typeof data.full_name === 'string' && data.full_name.trim()) || nameFromEmail(email),
          title: typeof data.title === 'string' ? data.title.trim() : '',
          role,
          isAdmin: role === 'admin',
          problem: '',
        });
      });
    return () => { alive = false; };
  }, [userId, email]);

  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>;
}

export function useAccess(): Access {
  return useContext(AccessContext);
}

export const roleLabel = (role: Role) => (role === 'admin' ? 'Admin' : 'Viewer');
