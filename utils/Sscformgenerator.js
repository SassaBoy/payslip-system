/**
 * utils/sscFormGenerator.js – NamPayroll
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates SSC Form 10(a) — pure black & white, layout matches the official
 * Social Security Commission form exactly.
 *
 * Company fields pulled from companyUser:
 *   companyName    → field 1: Name of Employer
 *   sscNumber      → field 2: Social Security Registration Number
 *   postalAddress  → field 3: Postal Address  (falls back to .address)
 *   email          → field 4: Email Address
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PDFDocument = require('pdfkit');
const moment      = require('moment-timezone');

// ── Page geometry (A4) ────────────────────────────────────────────────────────
const PAGE_W = 595;
const PAGE_H = 842;
const ML     = 45;
const INNER  = PAGE_W - ML - 45;   // 505

// ── Palette — strict black & white ───────────────────────────────────────────
const BLACK = '#000000';
const WHITE = '#ffffff';
const GRAY  = '#aaaaaa';   // footer note only

// ── Dot leader (mirrors official form dashes) ─────────────────────────────────
const DOTS72 = '…………………………………………………………………………………………………………………………………………………';
const DOTS36 = '……………………………………………………………………';
const DOTS18 = '…………………………………';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hRule(doc, y, x1, x2, thickness = 0.5) {
  doc.save().moveTo(x1, y).lineTo(x2, y)
     .strokeColor(BLACK).lineWidth(thickness).stroke().restore();
}

/** Draws a rectangle border (no fill) */
function rect(doc, x, y, w, h, thickness = 0.5) {
  doc.save().rect(x, y, w, h).strokeColor(BLACK).lineWidth(thickness).stroke().restore();
}

/** Cell with optional white fill + border */
function cell(doc, x, y, w, h) {
  doc.save().rect(x, y, w, h).fill(WHITE).restore();
  doc.save().rect(x, y, w, h).strokeColor(BLACK).lineWidth(0.4).stroke().restore();
}

/** Text centred vertically inside a cell */
function cellText(doc, text, x, y, w, h, opts = {}) {
  const { font = 'Helvetica', size = 8, align = 'left', bold = false, pad = 3 } = opts;
  const lineH = size * 1.3;
  const textY = y + Math.max(0, (h - lineH) / 2);
  doc.font(bold ? 'Helvetica-Bold' : font)
     .fontSize(size).fillColor(BLACK)
     .text(String(text || ''), x + pad, textY, {
       width: w - pad * 2,
       lineBreak: false,
       ellipsis: true,
       align
     });
}

/**
 * Dotted-underline field row — identical to the official form's style:
 *   "1. Name of Employer: ...............<filled value>..............."
 */
function dottedField(doc, label, value, y) {
  const labelW = doc.font('Helvetica').fontSize(9).widthOfString(label) + 4;
  doc.font('Helvetica').fontSize(9).fillColor(BLACK)
     .text(label, ML, y, { lineBreak: false });

  // Dot leaders fill the rest of the line
  doc.font('Helvetica').fontSize(9).fillColor(BLACK)
     .text(DOTS72, ML + labelW, y, { width: INNER - labelW, lineBreak: false, ellipsis: false });

  // Value printed in bold over the dots
  if (value && value.trim()) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
       .text(value.trim(), ML + labelW + 3, y,
         { width: INNER - labelW - 6, lineBreak: false, ellipsis: true });
  }
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────

function generateSSCForm(payrollRun, companyUser, stream) {

  const doc = new PDFDocument({ margin: 0, size: 'A4', info: { Title: 'SSC Form 10(a) – NamPayroll' } });
  doc.pipe(stream);

  // White background
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(WHITE);

  let y = 26;

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION A — HEADER
  // ══════════════════════════════════════════════════════════════════════════

  // "Form 10(a)" — top right, matches official form
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
     .text('Form 10(a)', ML, y, { width: INNER, align: 'right' });

  // Centred title
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(BLACK)
     .text('REPUBLIC OF NAMIBIA', ML, y, { width: INNER, align: 'center' });
  y += 15;

  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(BLACK)
     .text('SOCIAL SECURITY COMMISSION', ML, y, { width: INNER, align: 'center' });
  y += 14;

  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(BLACK)
     .text('Social Security Act, 1994', ML, y, { width: INNER, align: 'center' });
  y += 12;

  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text('Cnr. A Klopper & J. Haupt Streets—Khomasdal', ML, y, { width: INNER, align: 'center' });
  y += 20;

  // ── Left-side addressee block (matches official form) ─────────────────────
  const addrLines = [
    ['Helvetica-Bold', 'The Executive Officer'],
    ['Helvetica-Bold', 'Social Security Commission'],
    ['Helvetica',      'Private Bag 13223'],
    ['Helvetica',      'Windhoek'],
    ['Helvetica',      'Namibia'],
  ];
  addrLines.forEach(([font, line], i) => {
    doc.font(font).fontSize(9).fillColor(BLACK).text(line, ML, y + i * 12, { lineBreak: false });
  });
  y += addrLines.length * 12 + 14;

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION B — PERIOD HEADER
  // ══════════════════════════════════════════════════════════════════════════

  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
     .text('RETURN ACCOMPANYING PAYMENT OF CONTRIBUTIONS FOR THE PERIOD',
       ML, y, { width: INNER, align: 'center' });
  y += 16;

  // Period dates with dot leaders (mirrors official form layout)
  const monthDate = moment(`${payrollRun.year}-${String(payrollRun.month).padStart(2,'0')}-01`);
  const dateFrom  = monthDate.clone().startOf('month').format('DD/MM/YYYY');
  const dateTo    = monthDate.clone().endOf('month').format('DD/MM/YYYY');

  const periodLine = DOTS36 + '  ' + dateFrom + '  TO  ' + dateTo + '  ' + DOTS36;
  doc.font('Helvetica').fontSize(9).fillColor(BLACK)
     .text(periodLine, ML, y, { width: INNER, align: 'center' });
  y += 14;

  doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(BLACK)
     .text('(Section 22/Regulation 5)', ML, y, { width: INNER, align: 'center' });
  y += 13;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
     .text('TO BE COMPLETED IN BLOCK LETTERS', ML, y, { width: INNER, align: 'center' });
  y += 20;

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION C — EMPLOYER DETAILS (dotted fields 1–4)
  // ══════════════════════════════════════════════════════════════════════════

  dottedField(doc, '1. Name of Employer:  ', companyUser.companyName || '', y);
  y += 18;

  dottedField(doc, '2. Social Security Registration Number:  ',
    companyUser.sscNumber || '', y);
  y += 18;

  dottedField(doc, '3. Postal Address:  ',
    companyUser.postalAddress || companyUser.address || '', y);
  y += 18;

  dottedField(doc, '4. Email Address:  ', companyUser.email || '', y);
  y += 20;

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION D — PARTICULARS OF EMPLOYEES TABLE
  // ══════════════════════════════════════════════════════════════════════════

  const tableTop = y;

  // ── Title row ───────────────────────────────────────────────────────────────
  const TITLE_H = 18;
  rect(doc, ML, y, INNER, TITLE_H, 0.7);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
     .text('* PARTICULARS OF EMPLOYEES *', ML, y + 5, { width: INNER, align: 'center' });
  y += TITLE_H;

  // ── Column layout (proportions from official form) ───────────────────────────
  //   Surname (110) | Initials (55) | SSC Reg No (105) |
  //   Monthly Remun (60+60=120) | Contributions Deducted (60+55=115)
  //   Total = 110+55+105+120+115 = 505 = INNER ✓
  const C = {
    surname:  { x: ML,       w: 110 },
    initials: { x: ML+110,   w: 55  },
    sscNo:    { x: ML+165,   w: 105 },
    mon1:     { x: ML+270,   w: 60  },  // Monthly Remuneration col 1
    mon2:     { x: ML+330,   w: 60  },  // col 2
    ded1:     { x: ML+390,   w: 60  },  // Contributions Deducted col 1
    ded2:     { x: ML+450,   w: 55  },  // col 2
  };

  // ── Header row ───────────────────────────────────────────────────────────────
  const HDR_H = 30;

  // All header cells
  Object.values(C).forEach(col => cell(doc, col.x, y, col.w, HDR_H));

  // Spanning group labels (top of header)
  const mrSpanW = C.mon1.w + C.mon2.w;     // 120
  const cdSpanW = C.ded1.w + C.ded2.w;     // 115

  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BLACK)
     .text('Monthly Remuneration', C.mon1.x + 1, y + 4, { width: mrSpanW - 2, align: 'center', lineBreak: false });

  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BLACK)
     .text('Contributions Deducted', C.ded1.x + 1, y + 4, { width: cdSpanW - 2, align: 'center', lineBreak: false });

  // Sub-divider between the two monthly cols and the two deduction cols
  hRule(doc, y + 14, C.mon1.x, C.mon2.x + C.mon2.w, 0.4);
  hRule(doc, y + 14, C.ded1.x, C.ded2.x + C.ded2.w, 0.4);

  // Column labels (lower portion of header)
  const colLabels = [
    { col: C.surname,  label: 'Surname' },
    { col: C.initials, label: 'Initials' },
    { col: C.sscNo,    label: 'Social Security\nRegistration No' },
  ];
  colLabels.forEach(({ col, label }) => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BLACK)
       .text(label, col.x + 2, y + 6, { width: col.w - 4, align: 'center' });
  });

  y += HDR_H;

  // ── Data rows ────────────────────────────────────────────────────────────────
  const ROW_H    = 18;
  const maxRowY  = PAGE_H - 240;   // leave room for summary/declaration/footer
  let   empTotal = 0;
  let   emplrTotal = 0;

  let renderedRows = 0;
  payrollRun.payslips.forEach((ps, idx) => {
    const rowY = y + idx * ROW_H;
    if (rowY + ROW_H > maxRowY) return;

    const snap      = ps.employeeSnapshot || {};
    const parts     = (snap.fullName || '').trim().split(/\s+/);
    const surname   = parts.length > 1 ? parts.slice(1).join(' ') : parts[0] || '';
    const initials  = parts[0] ? parts[0][0].toUpperCase() + '.' : '';
    const sscNo     = snap.sscNumber || '';
    const monthly   = Number(ps.basicSalary || 0).toFixed(2);
    const empDed    = Number(ps.sscEmployee || 0).toFixed(2);
    const emplrCont = Number(ps.sscEmployer || 0).toFixed(2);

    empTotal   += ps.sscEmployee || 0;
    emplrTotal += ps.sscEmployer || 0;
    renderedRows++;

    Object.values(C).forEach(col => cell(doc, col.x, rowY, col.w, ROW_H));
    cellText(doc, surname,   C.surname.x,  rowY, C.surname.w,  ROW_H, { size: 8 });
    cellText(doc, initials,  C.initials.x, rowY, C.initials.w, ROW_H, { size: 8, align: 'center' });
    cellText(doc, sscNo,     C.sscNo.x,    rowY, C.sscNo.w,    ROW_H, { size: 8 });
    cellText(doc, monthly,   C.mon1.x,     rowY, C.mon1.w,     ROW_H, { size: 8, align: 'right' });
    cellText(doc, '',        C.mon2.x,     rowY, C.mon2.w,     ROW_H);
    cellText(doc, empDed,    C.ded1.x,     rowY, C.ded1.w,     ROW_H, { size: 8, align: 'right' });
    cellText(doc, emplrCont, C.ded2.x,     rowY, C.ded2.w,     ROW_H, { size: 8, align: 'right' });
  });

  // Ensure minimum 7 empty rows (matches official blank form)
  const minRows = Math.max(renderedRows, 7);
  const emptyRows = minRows - renderedRows;
  for (let i = 0; i < emptyRows; i++) {
    const rowY = y + (renderedRows + i) * ROW_H;
    if (rowY + ROW_H > maxRowY) break;
    Object.values(C).forEach(col => cell(doc, col.x, rowY, col.w, ROW_H));
  }

  y += minRows * ROW_H;

  // ── Summary rows (mirror official form exactly) ───────────────────────────────
  const SUM_H = 18;
  const labelSpanW = C.sscNo.x + C.sscNo.w - ML;   // surname+initials+sscNo width

  const summaryRows = [
    { label: 'Total Amount Deducted',   empVal: empTotal.toFixed(2),               emplrVal: '' },
    { label: "Employer's Contribution", empVal: '',                                emplrVal: emplrTotal.toFixed(2) },
    { label: 'Total Amount Paid Over',  empVal: (empTotal + emplrTotal).toFixed(2),emplrVal: '' },
  ];

  summaryRows.forEach(({ label, empVal, emplrVal }) => {
    // Label cell (spans left 3 columns, right-aligned — matches official form)
    cell(doc, ML, y, labelSpanW, SUM_H);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK)
       .text(label, ML + 3, y + 5, { width: labelSpanW - 6, align: 'right' });

    // Data cells
    cell(doc, C.mon1.x, y, C.mon1.w, SUM_H);
    cell(doc, C.mon2.x, y, C.mon2.w, SUM_H);
    cell(doc, C.ded1.x, y, C.ded1.w, SUM_H);
    cell(doc, C.ded2.x, y, C.ded2.w, SUM_H);

    if (empVal)  cellText(doc, empVal,  C.mon1.x, y, C.mon1.w, SUM_H, { size: 8, align: 'right' });
    if (emplrVal) cellText(doc, emplrVal, C.ded2.x, y, C.ded2.w, SUM_H, { size: 8, align: 'right' });

    y += SUM_H;
  });

  // Outer table border (drawn last so it sits on top of all inner lines)
  rect(doc, ML, tableTop, INNER, y - tableTop, 0.8);

  y += 14;

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION E — DECLARATION
  // ══════════════════════════════════════════════════════════════════════════

  doc.font('Helvetica').fontSize(9).fillColor(BLACK)
     .text('Declaration', ML, y);
  y += 14;

  doc.font('Helvetica').fontSize(9).fillColor(BLACK)
     .text('I, ' + DOTS72 + '……………………………..(Full Names and Capacity)', ML, y, { width: INNER });
  y += 13;

  doc.font('Helvetica').fontSize(9).fillColor(BLACK)
     .text('certify that the above particulars are true and correct.', ML, y);
  y += 30;

  // ── Signature lines (EMPLOYER | OFFICIAL STAMP | DATE) ────────────────────
  const sigW   = (INNER - 24) / 3;
  const labels = ['EMPLOYER', 'OFFICIAL STAMP', 'DATE'];

  labels.forEach((lbl, i) => {
    const sx = ML + i * (sigW + 12);
    doc.font('Helvetica').fontSize(9).fillColor(BLACK)
       .text(DOTS36, sx, y, { width: sigW, align: 'center', lineBreak: false });
  });
  y += 12;

  labels.forEach((lbl, i) => {
    const sx = ML + i * (sigW + 12);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
       .text(lbl, sx, y, { width: sigW, align: 'center', lineBreak: false });
  });
  y += 20;

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION F — FOR OFFICE USE ONLY
  // ══════════════════════════════════════════════════════════════════════════

  const offTop = y;
  const offH   = 74;
  rect(doc, ML, offTop, INNER, offH, 0.8);

  // Title
  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
     .text('FOR OFFICE USE ONLY', ML, y + 6, { width: INNER, align: 'center' });
  y += 20;

  hRule(doc, y, ML, ML + INNER, 0.4);
  y += 7;

  // Row 1
  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text('Checked By:  ' + DOTS36, ML + 4, y, { lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text('Date:  ' + DOTS36, ML + 190, y, { lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text('Time:  ' + DOTS36, ML + 360, y, { lineBreak: false });
  y += 14;

  // Row 2
  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text('Receipt Number:  ' + DOTS36, ML + 4, y, { lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text('Fee Paid: N$' + DOTS36, ML + 240, y, { lineBreak: false });
  y += 14;

  // Remarks
  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text('Remarks: ..' + DOTS72, ML + 4, y, { width: INNER - 8, lineBreak: false });
  y += 11;
  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text('.' + DOTS72, ML + 4, y, { width: INNER - 8, lineBreak: false });

  // ── Footer (generated-by note — light gray, very small) ──────────────────────
  const footY = PAGE_H - 16;
  hRule(doc, footY - 4, ML, ML + INNER, 0.3);
  doc.font('Helvetica').fontSize(6).fillColor(GRAY)
     .text('Generated by NamPayroll · Verify all values before submission to the Social Security Commission.',
       ML, footY, { width: INNER * 0.7 });
  doc.font('Helvetica').fontSize(6).fillColor(GRAY)
     .text(moment().format('DD MMMM YYYY, HH:mm'), ML, footY, { width: INNER, align: 'right' });

  doc.end();
}

module.exports = { generateSSCForm };