import { useSyncExternalStore } from 'react';
import { ledger } from './ledger';

/** Re-renders a component whenever the ledger changes. */
export function useLedgerEntries() {
  return useSyncExternalStore(ledger.subscribe, ledger.getEntries, ledger.getEntries);
}