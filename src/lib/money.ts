/** All amounts in the ledger are whole RWF integers. */
export const toRWF = (value: number): number => {
  if (!Number.isFinite(value)) throw new Error('Amount must be a valid number.');
  return Math.round(value);
};

export const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

export const formatRWF = (n: number): string =>
  new Intl.NumberFormat('en-RW', {
    style: 'currency',
    currency: 'RWF',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);