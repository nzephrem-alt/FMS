export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';

export type Account = {
  code: string;
  name: string;
  type: AccountType;
  group: string;
  active: boolean;
};

export const ACC = {
  cash: '1010',
  bank: '1020',
  mobileMoney: '1030',
  receivables: '1100',
  supplierAdvances: '1200',
  equipment: '1500',
  accumulatedDepreciation: '1510',
  payables: '2010',
  accruedWages: '2020',
  clientAdvances: '2030',
  taxPayable: '2100',
  loans: '2200',
  capital: '3010',
  retained: '3020',
  openingBalance: '3030',
  contractRevenue: '4010',
  otherIncome: '4090',
  labour: '5010',
  materials: '5020',
  equipmentHire: '5030',
  transport: '5040',
  siteExpenses: '5050',
  otherDirect: '5060',
  salaries: '6010',
  admin: '6020',
  rentUtilities: '6030',
  bankCharges: '6040',
  interest: '6050',
  depreciation: '6060',
  travel: '6070',
  otherOperating: '6090',
} as const;

const a = (code: string, name: string, type: AccountType, group: string): Account => ({
  code, name, type, group, active: true,
});

export const ACCOUNTS: Account[] = [
  a(ACC.cash, 'Cash on Hand', 'Asset', 'Cash & Bank'),
  a(ACC.bank, 'Bank Account', 'Asset', 'Cash & Bank'),
  a(ACC.mobileMoney, 'Mobile Money', 'Asset', 'Cash & Bank'),
  a(ACC.receivables, 'Accounts Receivable (Clients)', 'Asset', 'Receivables'),
  a(ACC.supplierAdvances, 'Advances to Suppliers & Subcontractors', 'Asset', 'Prepayments'),
  a(ACC.equipment, 'Equipment & Assets', 'Asset', 'Fixed Assets'),
  a(ACC.accumulatedDepreciation, 'Accumulated Depreciation', 'Asset', 'Fixed Assets'), // a negative asset: reduces the cost of fixed assets
  a(ACC.payables, 'Accounts Payable (Suppliers)', 'Liability', 'Payables'),
  a(ACC.accruedWages, 'Accrued Wages', 'Liability', 'Payables'),
  a(ACC.clientAdvances, 'Client Advances Received', 'Liability', 'Client Funds'),
  a(ACC.taxPayable, 'Taxes Payable', 'Liability', 'Taxes'),
  a(ACC.loans, 'Loans & Financing Payable', 'Liability', 'Borrowings'),
  a(ACC.capital, "Owner's Capital", 'Equity', 'Equity'),
  a(ACC.retained, 'Retained Earnings', 'Equity', 'Equity'),
  a(ACC.openingBalance, 'Opening Balance Equity', 'Equity', 'Equity'),
  a(ACC.contractRevenue, 'Contract Revenue', 'Revenue', 'Revenue'),
  a(ACC.otherIncome, 'Other Income', 'Revenue', 'Revenue'),
  a(ACC.labour, 'Direct Labour', 'Expense', 'Direct Costs'),
  a(ACC.materials, 'Direct Materials', 'Expense', 'Direct Costs'),
  a(ACC.equipmentHire, 'Equipment Hire', 'Expense', 'Direct Costs'),
  a(ACC.transport, 'Transport', 'Expense', 'Direct Costs'),
  a(ACC.siteExpenses, 'Site Expenses', 'Expense', 'Direct Costs'),
  a(ACC.otherDirect, 'Other Direct Costs', 'Expense', 'Direct Costs'),
  a(ACC.salaries, 'Staff Salaries', 'Expense', 'Operating Expenses'),
  a(ACC.admin, 'Administration Expenses', 'Expense', 'Operating Expenses'),
  a(ACC.rentUtilities, 'Office Rent & Utilities', 'Expense', 'Operating Expenses'),
  a(ACC.bankCharges, 'Bank & Mobile Money Charges', 'Expense', 'Operating Expenses'),
  a(ACC.interest, 'Interest Expense', 'Expense', 'Operating Expenses'),
  a(ACC.depreciation, 'Depreciation', 'Expense', 'Operating Expenses'),
  a(ACC.travel, 'Travel & Business Trips', 'Expense', 'Operating Expenses'),
  a(ACC.otherOperating, 'Other Operating Expenses', 'Expense', 'Operating Expenses'),
];

const byCode = new Map(ACCOUNTS.map((x) => [x.code, x]));
export const getAccount = (code: string): Account | undefined => byCode.get(code);
export const isDebitNormal = (type: AccountType): boolean => type === 'Asset' || type === 'Expense';
/** Direct costs (5xxx) must always be linked to a project. */
export const isDirectCost = (code: string): boolean => code.startsWith('5');
