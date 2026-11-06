/**
 * Builds a client invoice as a PDF file and downloads it, ready to send to the client.
 * jsPDF is loaded only when someone clicks "Download PDF", so it does not slow the app down.
 */

export type InvoicePdfData = {
  invoiceNumber: string;
  client: string;
  clientAddress?: string;
  clientTin?: string;
  clientPhone?: string;
  projectName: string;
  description: string;
  issueDate: string;
  dueDate: string;
  amount: number;
  items: { description: string; quantity: number; unitPrice: number }[];
  /** Shown as a note under the items: whether the prices include VAT. */
  vatMode: 'exclusive' | 'inclusive' | 'none';
  notes: string;
  voided: boolean;
};

const COMPANY = 'ISTA FORTIS Group Ltd';
const COMPANY_EMAIL = 'fortisgroupltd1@gmail.com';
const COMPANY_PHONES = '0782 291 551 / 0788 620 610';
const COMPANY_TIN = '155740325';
const BANK = { name: 'Bank of Kigali', account: '1002 6239 4063', holder: 'ISTA FORTIS GROUP Ltd' };
const LOGO_URL = '/istafortis-green-logo.png';

// Brand colours (RGB)
const GREEN: [number, number, number] = [26, 158, 111];
const GREEN_DEEP: [number, number, number] = [15, 122, 83];
const INK: [number, number, number] = [28, 43, 34];
const MUTED: [number, number, number] = [110, 124, 116];
const LINE: [number, number, number] = [227, 233, 229];
const TINT: [number, number, number] = [238, 248, 242];
const LIME: [number, number, number] = [213, 245, 107];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return y && m >= 1 && m <= 12 && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso || '—';
};
const rwf = (n: number) => `RWF ${Math.round(Number.isFinite(n) ? n : 0).toLocaleString('en-US')}`;
const safeName = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

/** The green logo as a data URL, or null if it cannot be loaded (the PDF then uses the name in text). */
async function loadLogo(): Promise<{ data: string; ratio: number } | null> {
  try {
    const res = await fetch(LOGO_URL);
    if (!res.ok) return null;
    const blob = await res.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const ratio = await new Promise<number>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1.64);
      img.onerror = () => resolve(1.64);
      img.src = data;
    });
    return { data, ratio };
  } catch {
    return null;
  }
}

export async function downloadInvoicePdf(inv: InvoicePdfData): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 18; // page margin

  const font = (size: number, style: 'normal' | 'bold' = 'normal', color: [number, number, number] = INK) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
  };
  const rule = (y: number) => { doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3); doc.line(M, y, W - M, y); };

  /* ---------- header ---------- */
  doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.rect(0, 0, W, 4, 'F');

  const logo = await loadLogo();
  let y = 14;
  if (logo) {
    const h = 20;
    doc.addImage(logo.data, 'PNG', M, y, h * logo.ratio, h);
  } else {
    font(18, 'bold', GREEN); doc.text('ISTA FORTIS', M, y + 9);
    font(8, 'normal', GREEN_DEEP); doc.text('G R O U P   L T D', M, y + 14);
  }
  font(8.5, 'bold', INK);
  doc.text(COMPANY, M, y + 26);
  font(8.5, 'normal', MUTED);
  doc.text(`Email: ${COMPANY_EMAIL}`, M, y + 30.5);
  doc.text(`Tel: ${COMPANY_PHONES}`, M, y + 35);
  doc.text(`TIN: ${COMPANY_TIN}`, M, y + 39.5);

  font(26, 'bold', GREEN);
  doc.text('INVOICE', W - M, y + 8, { align: 'right' });
  font(10.5, 'bold', INK);
  doc.text(`No. ${inv.invoiceNumber}`, W - M, y + 15, { align: 'right' });

  y += 46;
  rule(y);

  /* ---------- bill to / details ---------- */
  y += 9;
  const colR = W / 2 + 6;
  font(8, 'bold', GREEN_DEEP);
  doc.text('BILL TO', M, y);
  doc.text('INVOICE DETAILS', colR, y);

  font(11, 'bold', INK);
  const clientLines = doc.splitTextToSize(inv.client, W / 2 - M - 6) as string[];
  doc.text(clientLines, M, y + 6.5);
  let ly = y + 6.5 + clientLines.length * 5;
  font(9.5, 'normal', [59, 74, 66]);
  const billLines: string[] = [];
  if (inv.clientAddress) billLines.push(...(doc.splitTextToSize(inv.clientAddress, W / 2 - M - 6) as string[]));
  if (inv.clientPhone) billLines.push(`Phone: ${inv.clientPhone}`);
  if (inv.clientTin) billLines.push(`TIN: ${inv.clientTin}`);
  billLines.forEach((line) => { doc.text(line, M, ly); ly += 5; });

  const details: [string, string][] = [
    ['Issue date', niceDate(inv.issueDate)],
    ['Due date', niceDate(inv.dueDate)],
    ['Project', inv.projectName || 'General'],
  ];
  let ry = y + 6.5;
  details.forEach(([k, v]) => {
    font(9.5, 'normal', MUTED); doc.text(k, colR, ry);
    font(9.5, 'bold', INK);
    const lines = doc.splitTextToSize(v, W - M - colR - 28) as string[];
    doc.text(lines, W - M, ry, { align: 'right' });
    ry += Math.max(lines.length, 1) * 5 + 1;
  });

  y = Math.max(ly, ry) + 6;

  /* ---------- items table ---------- */
  const cQty = W - M - 82;   // right edge of the Qty column
  const cPrice = W - M - 44; // right edge of the Unit price column
  const cAmt = W - M - 5;    // right edge of the Amount column
  doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.roundedRect(M, y, W - 2 * M, 10, 1.5, 1.5, 'F');
  font(8.5, 'bold', [255, 255, 255]);
  doc.text('DESCRIPTION', M + 5, y + 6.5);
  doc.text('QTY', cQty, y + 6.5, { align: 'right' });
  doc.text('UNIT PRICE', cPrice, y + 6.5, { align: 'right' });
  doc.text('AMOUNT', cAmt, y + 6.5, { align: 'right' });
  y += 10;

  const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));
  inv.items.forEach((it, n) => {
    font(9.5, 'normal', INK);
    const lines = doc.splitTextToSize(it.description, cQty - M - 22) as string[];
    const rowH = Math.max(10, lines.length * 4.6 + 5.5);
    if (y + rowH > H - 40) { doc.addPage(); y = M; }
    if (n % 2 === 1) { doc.setFillColor(TINT[0], TINT[1], TINT[2]); doc.rect(M, y, W - 2 * M, rowH, 'F'); }
    doc.text(lines, M + 5, y + 6.5);
    doc.text(qtyText(it.quantity), cQty, y + 6.5, { align: 'right' });
    doc.text(rwf(it.unitPrice), cPrice, y + 6.5, { align: 'right' });
    font(9.5, 'bold', INK);
    doc.text(rwf(Math.round(it.quantity * it.unitPrice)), cAmt, y + 6.5, { align: 'right' });
    y += rowH;
  });
  rule(y);

  /* ---------- VAT note and total ---------- */
  y += 7;
  if (y > H - 70) { doc.addPage(); y = M; }
  if (inv.vatMode !== 'none') {
    font(9.5, 'bold', GREEN_DEEP);
    doc.text(`All prices are VAT ${inv.vatMode === 'inclusive' ? 'inclusive' : 'exclusive'}.`, M, y);
  }
  const tx = W - M - 82;
  y += 1;
  doc.setFillColor(LIME[0], LIME[1], LIME[2]);
  doc.roundedRect(tx - 4, y - 6, W - M - tx + 4, 11, 2, 2, 'F');
  font(11.5, 'bold', [29, 43, 18]);
  doc.text('Amount due', tx, y + 1.5);
  doc.text(rwf(inv.voided ? 0 : inv.amount), W - M - 5, y + 1.5, { align: 'right' });
  y += 15;

  /* ---------- notes ---------- */
  if (inv.notes) {
    if (y > H - 50) { doc.addPage(); y = M; }
    font(8, 'bold', GREEN_DEEP);
    doc.text('NOTES', M, y);
    font(9.5, 'normal', [59, 74, 66]);
    const noteLines = doc.splitTextToSize(inv.notes, W - 2 * M) as string[];
    doc.text(noteLines, M, y + 5.5);
    y += 5.5 + noteLines.length * 5;
  }

  /* ---------- how to pay ---------- */
  if (y > H - 62) { doc.addPage(); y = M; }
  y += 4;
  const boxH = 26;
  doc.setFillColor(TINT[0], TINT[1], TINT[2]);
  doc.roundedRect(M, y, W - 2 * M, boxH, 2, 2, 'F');
  font(8, 'bold', GREEN_DEEP);
  doc.text('PAYMENT DETAILS', M + 5, y + 7);
  const bank: [string, string][] = [['Bank', BANK.name], ['Account number', BANK.account], ['Account name', BANK.holder]];
  bank.forEach(([k, v], i) => {
    font(9.5, 'normal', MUTED); doc.text(k, M + 5, y + 13.5 + i * 5);
    font(9.5, 'bold', INK); doc.text(v, M + 42, y + 13.5 + i * 5);
  });
  font(8.5, 'normal', MUTED);
  doc.text(`Please quote invoice No. ${inv.invoiceNumber}`, W - M - 5, y + 23.5, { align: 'right' });
  y += boxH + 6;

  /* ---------- void mark ---------- */
  if (inv.voided) {
    font(90, 'bold', [240, 200, 205]);
    doc.text('VOID', W / 2, H / 2, { align: 'center', angle: 30 });
  }

  /* ---------- footer on every page ---------- */
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    rule(H - 22);
    font(9.5, 'bold', GREEN_DEEP);
    doc.text('Thank you for your business.', M, H - 15);
    font(8.5, 'normal', MUTED);
    doc.text(`${COMPANY} · ${COMPANY_EMAIL} · Tel: ${COMPANY_PHONES} · TIN: ${COMPANY_TIN}`, M, H - 10.5);
    if (pages > 1) doc.text(`Page ${i} of ${pages}`, W - M, H - 10.5, { align: 'right' });
  }

  doc.save(`Invoice-${safeName(inv.invoiceNumber) || 'draft'}-${safeName(inv.client).slice(0, 30)}.pdf`);
}
