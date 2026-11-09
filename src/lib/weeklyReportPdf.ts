/**
 * Turns a weekly (or any period) report into a PDF in the same style as the client invoice.
 * jsPDF is loaded only when someone clicks "Download PDF".
 */
import type { WReport } from './weeklyReport';
import { rwf, shortDay } from './weeklyReport';

const COMPANY = 'ISTA FORTIS Group Ltd';
const COMPANY_EMAIL = 'fortisgroupltd1@gmail.com';
const COMPANY_PHONES = '0782 291 551 / 0788 620 610';
const LOGO_URL = '/istafortis-green-logo.png';

type RGB = [number, number, number];
const GREEN: RGB = [26, 158, 111];
const GREEN_DEEP: RGB = [15, 122, 83];
const INK: RGB = [28, 43, 34];
const BODY: RGB = [59, 74, 66];
const MUTED: RGB = [110, 124, 116];
const LINE: RGB = [227, 233, 229];
const TINT: RGB = [238, 248, 242];
const LIME: RGB = [213, 245, 107];

async function loadLogo(): Promise<{ data: string; ratio: number } | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('logo'));
      el.src = LOGO_URL;
    });
    if (!img.naturalWidth || !img.naturalHeight) return null;
    const ratio = img.naturalWidth / img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = Math.round(600 / ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL('image/jpeg', 0.9), ratio };
  } catch {
    return null;
  }
}

type Col = { head: string; width: number; align?: 'left' | 'right' };

export async function downloadWeeklyReportPdf(r: WReport, from: string, to: string, preparedBy: string, priorities: string): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 16;
  const BOTTOM = H - 18;

  const font = (size: number, style: 'normal' | 'bold' = 'normal', color: RGB = INK) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
  };
  const lines = (text: string, width: number) => doc.splitTextToSize(text, width) as string[];

  /* ---------- header (first page) ---------- */
  doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.rect(0, 0, W, 4, 'F');
  const logo = await loadLogo();
  let y = 12;
  if (logo) doc.addImage(logo.data, 'JPEG', M, y, 16 * logo.ratio, 16);
  else { font(16, 'bold', GREEN); doc.text('ISTA FORTIS', M, y + 9); }
  font(22, 'bold', GREEN);
  doc.text(r.title, W - M, y + 8, { align: 'right' });
  font(9, 'normal', MUTED);
  doc.text(r.periodLabel, W - M, y + 14, { align: 'right' });
  if (preparedBy) doc.text(`Prepared by ${preparedBy}`, W - M, y + 18.5, { align: 'right' });
  y += 26;
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3); doc.line(M, y, W - M, y);
  y += 9;

  const newPage = () => { doc.addPage(); y = 18; };
  const need = (h: number) => { if (y + h > BOTTOM) newPage(); };

  const heading = (text: string) => {
    need(16);
    font(11.5, 'bold', GREEN_DEEP);
    doc.text(text, M, y);
    y += 6;
  };
  const paragraph = (text: string) => {
    font(9.5, 'normal', BODY);
    lines(text, W - 2 * M).forEach((l) => { need(5); doc.text(l, M, y); y += 4.8; });
    y += 3;
  };

  /** Table with wrapped cells; the header repeats on new pages. */
  const table = (cols: Col[], rows: string[][], opts: { total?: string[]; boldRows?: Set<number> } = {}) => {
    const scale = (W - 2 * M) / cols.reduce((s, c) => s + c.width, 0);
    const widths = cols.map((c) => c.width * scale);
    const drawHead = () => {
      doc.setFillColor(TINT[0], TINT[1], TINT[2]);
      doc.rect(M, y - 4.5, W - 2 * M, 7, 'F');
      font(8, 'bold', GREEN_DEEP);
      let x = M;
      cols.forEach((c, i) => {
        doc.text(c.head.toUpperCase(), c.align === 'right' ? x + widths[i] - 2 : x + 2, y, { align: c.align === 'right' ? 'right' : 'left' });
        x += widths[i];
      });
      y += 6;
    };
    need(16);
    drawHead();
    const drawRow = (cells: string[], bold: boolean, fill?: RGB) => {
      font(8.8, bold ? 'bold' : 'normal', bold ? INK : BODY);
      const wrapped = cells.map((c, i) => lines(c || '', widths[i] - 4));
      const h = Math.max(...wrapped.map((w) => w.length)) * 4.2 + 2.6;
      if (y + h > BOTTOM) { newPage(); drawHead(); font(8.8, bold ? 'bold' : 'normal', bold ? INK : BODY); }
      if (fill) { doc.setFillColor(fill[0], fill[1], fill[2]); doc.rect(M, y - 3.6, W - 2 * M, h, 'F'); }
      let x = M;
      wrapped.forEach((w, i) => {
        const right = cols[i].align === 'right';
        w.forEach((l, k) => doc.text(l, right ? x + widths[i] - 2 : x + 2, y + k * 4.2, { align: right ? 'right' : 'left' }));
        x += widths[i];
      });
      y += h;
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.2); doc.line(M, y - 3.6, W - M, y - 3.6);
    };
    rows.forEach((row, i) => drawRow(row, opts.boldRows?.has(i) ?? false));
    if (opts.total) drawRow(opts.total, true, LIME);
    y += 5;
  };

  /* ---------- 1. Summary ---------- */
  heading('1. Summary');
  paragraph(r.summary);
  if (r.projects.length) {
    table(
      [{ head: 'Project', width: 34 }, { head: r.periodWord === 'this week' ? 'Work this week' : 'Work in this period', width: 46 }, { head: 'Cost', width: 20, align: 'right' }],
      r.projects.map((p) => [`${p.name} (${p.id})`, p.work, rwf(p.cost)]),
      { total: ['Total', '', rwf(r.total)] },
    );
  }

  /* ---------- 2. Daily activities ---------- */
  heading('2. Daily activities');
  const dayRows: string[][] = [];
  const bold = new Set<number>();
  r.days.forEach((d) => {
    if (!d.rows.length) { dayRows.push([shortDay(d.date), '', 'No site entries recorded', '', '']); return; }
    d.rows.forEach((row, i) => dayRows.push([i === 0 ? shortDay(d.date) : '', row.project, row.activity, row.description, rwf(row.amount)]));
  });
  if (dayRows.length) {
    table(
      [{ head: 'Date', width: 13 }, { head: 'Project', width: 18 }, { head: 'Activity', width: 22 }, { head: 'Description / notes', width: 33 }, { head: 'Cost', width: 15, align: 'right' }],
      dayRows,
      { total: ['Total', '', '', '', rwf(r.total)], boldRows: bold },
    );
  } else paragraph('No site entries recorded.');

  /* ---------- 3. Issues ---------- */
  heading('3. Issues to follow up');
  if (!r.issues.length) paragraph('Nothing to follow up.');
  else {
    font(9.5, 'normal', BODY);
    r.issues.forEach((issue) => {
      const ls = lines(issue, W - 2 * M - 6);
      need(ls.length * 4.8 + 1);
      doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
      doc.circle(M + 1.3, y - 1.2, 0.8, 'F');
      ls.forEach((l) => { doc.text(l, M + 5, y); y += 4.8; });
      y += 1.2;
    });
    y += 3;
  }

  /* ---------- 4. Priorities ---------- */
  const next = priorities.split('\n').map((s) => s.trim()).filter(Boolean);
  if (next.length) {
    heading(r.periodWord === 'this week' ? '4. Next week priorities' : '4. Next priorities');
    font(9.5, 'normal', BODY);
    next.forEach((p, i) => {
      const ls = lines(p.replace(/^[-•*\d.)\s]+/, ''), W - 2 * M - 7);
      need(ls.length * 4.8 + 1);
      doc.text(`${i + 1}.`, M, y);
      ls.forEach((l) => { doc.text(l, M + 6, y); y += 4.8; });
      y += 1.2;
    });
  }

  /* ---------- footer on every page ---------- */
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3); doc.line(M, H - 12, W - M, H - 12);
    font(7.5, 'normal', MUTED);
    doc.text(`${COMPANY}  |  ${COMPANY_EMAIL}  |  ${COMPANY_PHONES}`, M, H - 7.5);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 7.5, { align: 'right' });
  }

  const name = r.title === 'WEEKLY REPORT' ? 'Weekly_Report' : 'Activity_Report';
  doc.save(`${name}_${from}_to_${to}.pdf`);
}
