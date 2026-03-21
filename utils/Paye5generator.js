/**
 * utils/paye5Generator.js – NamPayroll
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates the official Namibian P.A.Y.E.5 Employee's Tax Certificate.
 *
 * Layout matches the official Ministry of Finance / NamRA form:
 *   – Pure black & white, no colour fills
 *   – "P.A.Y.E.5" heading top-left with Republic of Namibia header centred
 *   – Bordered box sections: EMPLOYER DETAILS, EMPLOYEE DETAILS,
 *     REMUNERATION, DEDUCTIONS, TAX COMPUTATION, DECLARATION
 *   – Dotted value fields inside bordered sections
 *   – Code numbers in right margin (3601, 4001, etc.)
 *
 * Reference: Official PAYE5 / ITA5 form, Republic of Namibia Ministry of
 * Finance, Income Tax Act 1981, Section 83.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PDFDocument = require('pdfkit');
const moment      = require('moment-timezone');

// ── Page geometry (A4) ────────────────────────────────────────────────────────
const PAGE_W = 595;
const PAGE_H = 842;
const ML     = 40;
const MR     = 40;
const INNER  = PAGE_W - ML - MR;   // 515

// ── Palette — pure black & white only ────────────────────────────────────────
const BLACK  = '#000000';
const WHITE  = '#ffffff';
const LGRAY  = '#999999';   // footnote only

// ── Dot leader ────────────────────────────────────────────────────────────────
const DOTS = '……………………………………………………………………………………………………………………………………………………';

// ── Helpers ───────────────────────────────────────────────────────────────────

function hRule(doc, y, x1 = ML, x2 = ML + INNER, t = 0.5) {
  doc.save().moveTo(x1, y).lineTo(x2, y)
     .strokeColor(BLACK).lineWidth(t).stroke().restore();
}

function vRule(doc, x, y1, y2, t = 0.5) {
  doc.save().moveTo(x, y1).lineTo(x, y2)
     .strokeColor(BLACK).lineWidth(t).stroke().restore();
}

/** Outer border rectangle, no fill */
function borderRect(doc, x, y, w, h, t = 0.6) {
  doc.save().rect(x, y, w, h).strokeColor(BLACK).lineWidth(t).stroke().restore();
}

/**
 * Section header — bold label on left, full-width underline beneath.
 * Matches the "EMPLOYER DETAILS" style of the official form.
 */
function sectionHeader(doc, title, y, extraRight = '') {
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
     .text(title, ML + 3, y, { lineBreak: false });
  if (extraRight) {
    doc.font('Helvetica').fontSize(8).fillColor(BLACK)
       .text(extraRight, ML, y, { width: INNER - 3, align: 'right', lineBreak: false });
  }
  const lineY = y + 13;
  hRule(doc, lineY, ML, ML + INNER, 0.6);
  return lineY + 4;
}

/**
 * Two-column label/value row — label in left column, value in right.
 * Optional code number printed in far right margin (grey, smaller).
 */
function labelRow(doc, label, value, y, rowH = 16, code = '', labelW = 200) {
  // Label (left)
  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text(label, ML + 3, y + 3, { width: labelW - 6, lineBreak: false });

  // Value (right of label) — printed over dot leaders
  const valX = ML + labelW;
  const valW = INNER - labelW - (code ? 30 : 3);

  // Dot leaders
  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text(DOTS, valX, y + 3, { width: valW, lineBreak: false });

  // Actual value printed in bold over dots
  if (value && String(value).trim()) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
       .text(String(value).trim(), valX + 2, y + 3,
         { width: valW - 4, lineBreak: false, ellipsis: true });
  }

  // Code number in right margin
  if (code) {
    doc.font('Helvetica').fontSize(7).fillColor(LGRAY)
       .text(code, ML + INNER - 27, y + 4, { width: 27, align: 'right', lineBreak: false });
  }

  hRule(doc, y + rowH - 1, ML, ML + INNER, 0.3);
  return y + rowH;
}

/**
 * Amount row — description left, code centre, N$ value right-aligned.
 * Matches the tabular income/deduction rows of the official form.
 */
function amountRow(doc, description, code, amount, y, rowH = 16) {
  const amt = parseFloat(amount) || 0;
  const fmtAmt = amt === 0 ? '' : fmtNAD(amt);

  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text(description, ML + 3, y + 4, { width: INNER * 0.6, lineBreak: false });

  if (code) {
    doc.font('Helvetica').fontSize(7.5).fillColor(LGRAY)
       .text(code, ML + INNER * 0.62, y + 4, { width: 40, lineBreak: false });
  }

  if (fmtAmt) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
       .text(fmtAmt, ML, y + 4, { width: INNER - 3, align: 'right', lineBreak: false });
  }

  hRule(doc, y + rowH - 1, ML, ML + INNER, 0.25);
  return y + rowH;
}

/**
 * Total row — bold label, bold value, heavier border above and below.
 */
function totalRow(doc, label, amount, y) {
  const H = 18;
  hRule(doc, y,     ML, ML + INNER, 0.8);
  hRule(doc, y + H, ML, ML + INNER, 0.8);

  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
     .text(label, ML + 3, y + 5, { width: INNER * 0.6, lineBreak: false });

  doc.font('Helvetica-Bold').fontSize(9).fillColor(BLACK)
     .text(fmtNAD(amount), ML, y + 5, { width: INNER - 3, align: 'right', lineBreak: false });

  return y + H + 2;
}

function fmtNAD(n) {
  const v = parseFloat(n) || 0;
  return 'N$ ' + v.toLocaleString('en-NA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────

/**
 * @param {Object} annualData   – Aggregated annual payroll totals
 * @param {Object} employee     – Employee doc (lean)
 * @param {Object} companyUser  – Company/User doc (lean)
 * @param {number} taxYear      – e.g. 2025 → covers Mar 2025 – Feb 2026
 * @param {Stream} stream
 */
function generatePAYE5Certificate(annualData, employee, companyUser, taxYear, stream) {

  const doc = new PDFDocument({ margin: 0, size: 'A4',
    info: { Title: `PAYE5 Tax Certificate ${taxYear}` } });
  doc.pipe(stream);

  // White background
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(WHITE);

  const certNo     = `PAYE5-${taxYear}-${String(employee.idNumber || '').slice(-6)}`;
  const taxYearStr = `${taxYear}/${taxYear + 1}`;

  let y = 28;

  // ══════════════════════════════════════════════════════════════════════════
  // HEADER — matches official form exactly
  // ══════════════════════════════════════════════════════════════════════════

  // "P.A.Y.E.5" — top left, large, bold (official form identifier)
  doc.font('Helvetica-Bold').fontSize(16).fillColor(BLACK)
     .text('P.A.Y.E.5', ML, y, { lineBreak: false });

  // Certificate number — top right, small
  doc.font('Helvetica').fontSize(8).fillColor(LGRAY)
     .text(`Cert No: ${certNo}`, ML, y + 4, { width: INNER, align: 'right', lineBreak: false });

  y += 22;

  // Centred government header block
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BLACK)
     .text('REPUBLIC OF NAMIBIA', ML, y, { width: INNER, align: 'center' });
  y += 14;

  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(BLACK)
     .text('NAMIBIA REVENUE AGENCY (NamRA)', ML, y, { width: INNER, align: 'center' });
  y += 13;

  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(BLACK)
     .text("EMPLOYEE'S TAX CERTIFICATE", ML, y, { width: INNER, align: 'center' });
  y += 13;

  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(BLACK)
     .text(`YEAR OF ASSESSMENT  ${taxYearStr}`, ML, y, { width: INNER, align: 'center' });
  y += 13;

  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text(`(1 March ${taxYear} to 28/29 February ${taxYear + 1})`, ML, y, { width: INNER, align: 'center' });
  y += 6;

  // Heavy rule below header
  hRule(doc, y, ML, ML + INNER, 1.2);
  y += 10;

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 1 — EMPLOYER DETAILS
  // ══════════════════════════════════════════════════════════════════════════

  y = sectionHeader(doc, 'EMPLOYER DETAILS', y);

  // Two-column layout: left half employer fields, right half file numbers
  const halfInner = (INNER - 10) / 2;

  // Left column
  labelRow(doc, 'PAYE File Number / Reg. No.',
    companyUser.payeRegNo || '', y, 16, '', 175);
  y += 16;
  labelRow(doc, 'TIN (Employer)',
    companyUser.tinNumber || '', y, 16, '', 175);
  y += 16;
  labelRow(doc, 'Registered Name of Employer',
    companyUser.companyName || '', y, 16, '', 175);
  y += 16;
  labelRow(doc, 'Postal Address',
    companyUser.postalAddress || companyUser.address || '', y, 16, '', 175);
  y += 16;
  labelRow(doc, 'Email Address',
    companyUser.email || '', y, 16, '', 175);
  y += 20;

  hRule(doc, y, ML, ML + INNER, 0.6);
  y += 10;

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 2 — EMPLOYEE DETAILS
  // ══════════════════════════════════════════════════════════════════════════

  y = sectionHeader(doc, 'EMPLOYEE DETAILS', y);

  // Row 1: Income Tax File No + Employee Number (two cols, matches official form)
  const col1X = ML;
  const col2X = ML + INNER / 2 + 5;
  const colW  = INNER / 2 - 5;

  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text('INCOME TAX FILE IDENTIFICATION NO.', col1X + 3, y + 3, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
     .text(employee.tinNumber || '—', col1X + 3, y + 13, { width: colW - 6, lineBreak: false });

  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text('EMPLOYEE NUMBER / ID', col2X + 3, y + 3, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
     .text(employee.idNumber || '—', col2X + 3, y + 13, { width: colW - 6, lineBreak: false });

  vRule(doc, col2X - 3, y, y + 28, 0.4);
  hRule(doc, y + 28, ML, ML + INNER, 0.4);
  y += 32;

  // Row 2: Initials & Surname + First Names (two cols)
  const nameParts = (employee.fullName || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const surname   = nameParts.slice(1).join(' ') || '';
  const initials  = firstName ? firstName[0].toUpperCase() + '.' : '';

  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text('INITIALS AND SURNAME', col1X + 3, y + 3, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
     .text(`${initials} ${surname}`.trim(), col1X + 3, y + 13, { width: colW - 6, lineBreak: false });

  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text('FIRST NAMES', col2X + 3, y + 3, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
     .text(employee.fullName || '—', col2X + 3, y + 13, { width: colW - 6, lineBreak: false });

  vRule(doc, col2X - 3, y, y + 28, 0.4);
  hRule(doc, y + 28, ML, ML + INNER, 0.4);
  y += 32;

  // Row 3: Position + Department
  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text('POSITION / DESIGNATION', col1X + 3, y + 3, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
     .text(employee.position || '—', col1X + 3, y + 13, { width: colW - 6, lineBreak: false });

  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text('DEPARTMENT', col2X + 3, y + 3, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
     .text(employee.department || '—', col2X + 3, y + 13, { width: colW - 6, lineBreak: false });

  vRule(doc, col2X - 3, y, y + 28, 0.4);
  hRule(doc, y + 28, ML, ML + INNER, 0.4);
  y += 32;

  // Row 4: Date Joined + Period of Employment
  const dateJoined  = employee.dateJoined ? moment(employee.dateJoined).format('DD/MM/YYYY') : '—';
  const periodFrom  = `01/03/${taxYear}`;
  const periodTo    = `28/02/${taxYear + 1}`;

  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text('DATE OF EMPLOYMENT', col1X + 3, y + 3, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
     .text(dateJoined, col1X + 3, y + 13, { lineBreak: false });

  doc.font('Helvetica').fontSize(8).fillColor(BLACK)
     .text('PERIOD OF ASSESSMENT', col2X + 3, y + 3, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BLACK)
     .text(`${periodFrom}  TO  ${periodTo}`, col2X + 3, y + 13, { width: colW - 6, lineBreak: false });

  vRule(doc, col2X - 3, y, y + 28, 0.4);
  hRule(doc, y + 28, ML, ML + INNER, 0.6);
  y += 36;

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 3 — REMUNERATION (Income)
  // ══════════════════════════════════════════════════════════════════════════

  // Section header with code guide top-right (matches official form)
  y = sectionHeader(doc, 'REMUNERATION', y, 'CODE');

  y = amountRow(doc, 'Salaries, Wages & Allowances',        '3601', annualData.annualSalary,      y);
  y = amountRow(doc, 'Overtime Income',                     '3602', annualData.annualOTPay || 0,  y);
  y = amountRow(doc, 'Commission',                          '3606', 0,                             y);
  y = amountRow(doc, 'Taxable Allowances',                  '3605', annualData.annualTaxAllow || 0,y);
  y = amountRow(doc, 'Non-Taxable Allowances',              '3713', annualData.annualNonTaxAllow||0,y);
  y = amountRow(doc, 'Housing (Company-provided)',          '3701', 0,                             y);
  y = amountRow(doc, 'Use of Motor Vehicle (Fringe Benefit)','3802', 0,                            y);
  y = amountRow(doc, 'Subsistence & Travel Allowance',      '3714', 0,                             y);
  y = amountRow(doc, 'Other Income',                        '3699', 0,                             y);
  y += 2;
  y = totalRow(doc, 'GROSS REMUNERATION', annualData.annualGross, y);
  y += 6;

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 4 — DEDUCTIONS
  // ══════════════════════════════════════════════════════════════════════════

  y = sectionHeader(doc, 'DEDUCTIONS / CONTRIBUTIONS', y, 'CODE');

  const pensionAnn = (employee.pensionContribution    || 0) * 12;
  const medicalAnn = (employee.medicalAidContribution || 0) * 12;

  y = amountRow(doc, 'Pension Fund Contributions',          '4001', pensionAnn,                         y);
  y = amountRow(doc, 'Provident Fund Contributions',        '4003', 0,                                  y);
  y = amountRow(doc, 'Retirement Annuity Fund',             '4006', 0,                                  y);
  y = amountRow(doc, 'Medical Aid Contributions',           '4025', medicalAnn,                         y);
  y = amountRow(doc, 'Social Security (SSC) – Employee',   '4115', annualData.annualSSCEmployee || 0,  y);
  y = amountRow(doc, 'Other Deductions',                    '4999', 0,                                  y);
  y += 2;
  y = totalRow(doc, 'TOTAL DEDUCTIONS', annualData.annualDeductions || 0, y);
  y += 6;

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 5 — TAX COMPUTATION
  // ══════════════════════════════════════════════════════════════════════════

  y = sectionHeader(doc, 'TAX COMPUTATION', y, 'CODE');

  y = amountRow(doc, 'Taxable Income (Gross Remuneration less Deductions)',
    '3697', annualData.taxableIncome || 0, y);
  y = amountRow(doc, 'Annual Tax Liability (per NamRA tax tables)',
    '3698', annualData.annualPAYE || 0,    y);
  y = amountRow(doc, 'Tax Rebate / Directive',
    '3699', 0, y);
  y += 2;

  // Bold highlighted PAYE deducted box — black background, white text
  const pAYEH = 22;
  doc.rect(ML, y, INNER, pAYEH).fill(BLACK);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(WHITE)
     .text('TOTAL EMPLOYEES\' TAX (PAYE) DEDUCTED FOR THE YEAR', ML + 6, y + 7, { lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(WHITE)
     .text(fmtNAD(annualData.annualPAYE || 0), ML, y + 6, { width: INNER - 6, align: 'right', lineBreak: false });
  y += pAYEH + 10;

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 6 — DECLARATION
  // ══════════════════════════════════════════════════════════════════════════

  hRule(doc, y, ML, ML + INNER, 0.6);
  y += 8;

  doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK)
     .text('DECLARATION BY EMPLOYER', ML + 3, y);
  y += 14;

  doc.font('Helvetica').fontSize(8.5).fillColor(BLACK)
     .text(
       'I hereby certify that the particulars given in this certificate are correct and complete in every respect.',
       ML + 3, y, { width: INNER - 6 }
     );
  y += 20;

  // Signature row: Authorised Signatory | Employer Stamp | Date
  const sigW   = (INNER - 20) / 3;
  const sigLabels = [
    'AUTHORISED SIGNATORY',
    'EMPLOYER\'S STAMP',
    `DATE:  ${moment().format('DD / MM / YYYY')}`
  ];

  sigLabels.forEach((lbl, i) => {
    const sx = ML + i * (sigW + 10);
    // Signature line
    hRule(doc, y + 20, sx, sx + sigW, 0.5);
    // Label below line
    doc.font(i === 2 ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(BLACK)
       .text(lbl, sx, y + 23, { width: sigW, align: 'center', lineBreak: false });
  });

  y += 36;

  // ── Retention notice ──────────────────────────────────────────────────────
  hRule(doc, y, ML, ML + INNER, 0.4);
  y += 6;
  doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(BLACK)
     .text(
       'This certificate is issued in terms of Section 83 of the Income Tax Act, 1981. ' +
       'The employee must attach this certificate to their individual tax return (ITX300) submitted to NamRA. ' +
       'Keep this certificate for your records.',
       ML + 3, y, { width: INNER - 6 }
     );

  // ── Footer ────────────────────────────────────────────────────────────────
  const footY = PAGE_H - 16;
  hRule(doc, footY - 4, ML, ML + INNER, 0.3);
  doc.font('Helvetica').fontSize(6).fillColor(LGRAY)
     .text('Generated by NamPayroll · Namibia Revenue Agency (NamRA) · Income Tax Act, 1981',
       ML, footY, { lineBreak: false });
  doc.font('Helvetica').fontSize(6).fillColor(LGRAY)
     .text(moment().format('DD MMMM YYYY, HH:mm'), ML, footY, { width: INNER, align: 'right', lineBreak: false });

  doc.end();
}

// ── BULK ZIP helper ────────────────────────────────────────────────────────────

function appendAllPAYE5ToZip(payrollRuns, employees, companyUser, taxYear, archive) {
  const { PassThrough } = require('stream');

  const empMap = {};
  for (const emp of employees) empMap[emp._id.toString()] = emp;

  // Aggregate annual totals per employee across all payroll runs
  const annualMap = {};
  for (const run of payrollRuns) {
    for (const ps of run.payslips) {
      const empId = ps.employee?.toString();
      if (!empId) continue;
      if (!annualMap[empId]) {
        annualMap[empId] = {
          annualSalary: 0, annualOTPay: 0, annualTaxAllow: 0,
          annualNonTaxAllow: 0, annualGross: 0, annualTaxGross: 0,
          annualPAYE: 0, annualSSCEmployee: 0
        };
      }
      const a = annualMap[empId];
      a.annualSalary       += ps.basicSalary         || 0;
      a.annualOTPay        += ps.overtimePay          || 0;
      a.annualTaxAllow     += ps.taxableAllowances    || 0;
      a.annualNonTaxAllow  += ps.nonTaxableAllowances || 0;
      a.annualGross        += ps.grossPay             || 0;
      a.annualTaxGross     += ps.taxableGross          || 0;
      a.annualPAYE         += ps.paye                 || 0;
      a.annualSSCEmployee  += ps.sscEmployee          || 0;
    }
  }

  // Compute derived totals
  for (const [empId, a] of Object.entries(annualMap)) {
    const emp        = empMap[empId] || {};
    const pensionAnn = (emp.pensionContribution    || 0) * 12;
    const medicalAnn = (emp.medicalAidContribution || 0) * 12;
    a.annualDeductions = pensionAnn + medicalAnn + a.annualSSCEmployee;
    a.taxableIncome    = Math.max(0, a.annualTaxGross - pensionAnn - medicalAnn);
  }

  // Append each certificate to the ZIP
  for (const [empId, annualData] of Object.entries(annualMap)) {
    const emp = empMap[empId];
    if (!emp) continue;
    const safeName  = (emp.fullName || 'employee').replace(/[^a-z0-9]/gi, '_');
    const pdfStream = new PassThrough();
    generatePAYE5Certificate(annualData, emp, companyUser, taxYear, pdfStream);
    archive.append(pdfStream, { name: `PAYE5_${safeName}_${taxYear}.pdf` });
  }
}

module.exports = { generatePAYE5Certificate, appendAllPAYE5ToZip };