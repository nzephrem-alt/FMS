export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const STORAGE_KEYS = {
  ledger: 'ista-fortis-ledger-v1',
  audit: 'ista-fortis-audit-v1',
} as const;

/** Local development store. Swap this adapter for an API client when the backend arrives. */
export const localStorageAdapter: StorageAdapter = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};

/** In-memory store, used by tests so they never touch real data. */
export function createMemoryAdapter(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

export function readJSON<T>(adapter: StorageAdapter, key: string, fallback: T): T {
  try {
    const raw = adapter.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(adapter: StorageAdapter, key: string, value: unknown): void {
  try {
    adapter.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error('Could not save data. Browser storage may be full or blocked.');
  }
}