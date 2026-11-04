import { STORAGE_KEYS, readJSON, writeJSON } from './storage';
import type { StorageAdapter } from './storage';

export type AuditEvent = {
  id: string;
  at: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  details?: Record<string, unknown>;
};

export type NewAuditEvent = Omit<AuditEvent, 'id' | 'at' | 'actor'>;

/** Append-only audit trail. Events are never edited or deleted. */
export function createAuditLog(adapter: StorageAdapter, actor: string) {
  let cache: AuditEvent[] | null = null;

  const load = (): AuditEvent[] => {
    if (cache === null) {
      const raw = readJSON<AuditEvent[]>(adapter, STORAGE_KEYS.audit, []);
      cache = Array.isArray(raw) ? raw : [];
    }
    return cache;
  };

  return {
    log(event: NewAuditEvent): AuditEvent {
      const current = load();
      const record: AuditEvent = {
        ...event,
        id: `AUD-${String(current.length + 1).padStart(6, '0')}`,
        at: new Date().toISOString(),
        actor,
      };
      const next = [...current, record];
      writeJSON(adapter, STORAGE_KEYS.audit, next);
      cache = next;
      return record;
    },
    list(): readonly AuditEvent[] {
      return load();
    },
  };
}