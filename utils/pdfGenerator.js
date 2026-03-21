/**
 * utils/pdfGenerator.js – NamPayroll
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates payslip and compliance PDFs.
 * Custom pay items (defined per-company in Settings) render as named rows.
 * Companies without custom items fall back to generic single-bucket rows.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PDFDocument     = require('pdfkit');
const moment          = require('moment-timezone');
const path            = require('path');
const fs              = require('fs');
const { formatNAD }   = require('./payrollCalculator');

const C = {
  pageBg:     '#ffffff',
  black:      '#000000',
  darkGray:   '#1a1a1a',
  bodyText:   '#333333',
  medGray:    '#777777',
  lightGray:  '#aaaaaa',
  border:     '#eeeeee',
  borderDark: '#dddddd',
  rowAlt:     '#f9fafb',
  pillBg:     '#f1f5f9',
  accentBg:   '#f8fafc',
  headerText: '#1e293b'
};

const PAGE_W = 595;
const PAGE_H = 842;
const ML     = 48;
const MR     = 48;
const INNER  = PAGE_W - ML - MR;

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderCompanyLogo(doc, logoPath, x, y, maxW = 120, maxH = 50) {
  if (!logoPath) return false;
  const fullPath = path.join(__dirname, '..', 'public', logoPath);
  try {
    if (fs.existsSync(fullPath)) { doc.image(fullPath, x, y, { fit: [maxW, maxH] }); return true; }
  } catch (err) { console.error('PDF Logo Error:', err); }
  return false;
}

function rule(doc, y, color = C.border, thickness = 0.5) {
  doc.save().moveTo(ML, y).lineTo(ML + INNER, y).strokeColor(color).lineWidth(thickness).stroke().restore();
}

function fullRule(doc, y, color = C.border, thickness = 0.5) {
  doc.save().moveTo(0, y).lineTo(PAGE_W, y).strokeColor(color).lineWidth(thickness).stroke().restore();
}

function infoField(doc, label, value, x, y, labelW = 56, colW = 140) {
  doc.font('Helvetica').fontSize(7.5).fillColor(C.medGray)
     .text(label, x, y, { width: labelW, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.darkGray)
     .text(value || '—', x + labelW + 4, y, { width: colW - labelW - 4, lineBreak: false, ellipsis: true });
}

function tableRow(doc, description, amount, y, opts = {}) {
  const {
    descColor   = C.bodyText,
    amountColor = C.darkGray,
    fontSize    = 9,
    bold        = false,
    shade       = false,
    note        = null,
    rowHeight   = note ? 26 : 20
  } = opts;

  if (shade) doc.rect(ML, y - 4, INNER, rowHeight).fill(C.rowAlt);

  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
     .fontSize(fontSize).fillColor(descColor)
     .text(description, ML + 12, y, { width: INNER * 0.65 });

  if (note) {
    doc.font('Helvetica').fontSize(7).fillColor(C.lightGray)
       .text(note, ML + 12, y + 11, { width: INNER * 0.65 });
  }

  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
     .fontSize(fontSize).fillColor(amountColor)
     .text(amount || 'N$ 0.00', ML, y, { width: INNER - 12, align: 'right' });
}

function sectionHeader(doc, title, y, accentColor = C.black) {
  const H = 22;
  doc.rect(ML, y, INNER, H).fill(C.pillBg);
  doc.rect(ML, y, 3, H).fill(accentColor);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.headerText)
     .text(title.toUpperCase(), ML + 12, y + 7, { characterSpacing: 1.2 });
  return y + H + 8;
}

function summaryRow(doc, label, amount, y) {
  doc.rect(ML, y, INNER, 24).fill(C.accentBg);
  rule(doc, y, C.borderDark, 0.5);
  rule(doc, y + 24, C.borderDark, 0.5);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.headerText).text(label, ML + 12, y + 7);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.darkGray)
     .text(amount, ML, y + 7, { width: INNER - 12, align: 'right' });
  return y + 24;
}

function footer(doc, theme) {
  const fy = PAGE_H - 44;
  rule(doc, fy, C.borderDark, 0.5);

  if (theme?.footerNote) {
    doc.font('Helvetica').fontSize(7).fillColor(C.medGray)
       .text(theme.footerNote, ML, fy + 8, { width: INNER * 0.65 });
  } else {
    doc.font('Helvetica').fontSize(6.5).fillColor(C.lightGray)
       .text('This payslip is a private and confidential document. Please retain for your records.',
         ML, fy + 8, { width: INNER * 0.6 });
  }

  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.lightGray)
     .text('NamPayroll System', ML, fy + 10, { width: INNER - 12, align: 'right' });
  doc.font('Helvetica').fontSize(6.5).fillColor(C.lightGray)
     .text(`Generated: ${moment().format('DD MMM YYYY, HH:mm')}`, ML, fy + 22, { width: INNER - 12, align: 'right' });
}

// ── PAYSLIP PDF ───────────────────────────────────────────────────────────────

function generatePayslipPDF(payslip, companyUser, month, year, stream, theme = {}) {
  const doc = new PDFDocument({ margin: 0, size: 'A4' });
  doc.pipe(stream);
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(C.pageBg);

  const accent = /^#[0-9a-fA-F]{6}$/.test(theme.accentColor || '') ? theme.accentColor : C.black;

  const monthName = moment(`${year}-${String(month).padStart(2, '0')}-01`).format('MMMM YYYY');
  const snap      = payslip.employeeSnapshot || {};

  // ── Top bar ───────────────────────────────────────────────────────────────
  doc.rect(0, 0, PAGE_W, 4).fill(accent);

  const HEADER_H = 78;
  doc.rect(0, 4, PAGE_W, HEADER_H).fill(C.pageBg);

  const hasLogo = renderCompanyLogo(doc, companyUser.companyLogo, ML, 16, 110, 46);
  const rightX  = ML + INNER * 0.52;
  const rightW  = INNER * 0.48;

  if (!hasLogo) {
    doc.font('Helvetica-Bold').fontSize(13).fillColor(C.black)
       .text((companyUser.companyName || 'NAMIBIA PAYROLL').toUpperCase(), ML, 24, { width: rightW * 0.95 });
  }

  doc.font('Helvetica-Bold').fontSize(18).fillColor(C.black)
     .text('PAYSLIP', rightX, 18, { width: rightW, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor(C.medGray)
     .text(monthName.toUpperCase(), rightX, 42, { width: rightW, align: 'right', characterSpacing: 1 });

  if (theme.showRefNumber !== false) {
    const refNum = `REF-${year}${String(month).padStart(2,'0')}-${String(snap.idNumber || '').slice(-4) || '0000'}`;
    doc.font('Helvetica').fontSize(7.5).fillColor(C.lightGray)
       .text(refNum, rightX, 56, { width: rightW, align: 'right' });
  }

  let y = 4 + HEADER_H;
  fullRule(doc, y, C.borderDark, 1);
  y += 1;

  // ── Employee info grid ────────────────────────────────────────────────────
  const COL1_W = 148, COL2_W = 148, COL3_W = INNER - 148 - 148;
  const col1X = ML, col2X = ML + COL1_W, col3X = ML + COL1_W + COL2_W;
  const iY = y + 10, iY2 = iY + 14;

  const measureVal = (val, w) => { doc.font('Helvetica-Bold').fontSize(7.5); return doc.heightOfString(val || '—', { width: w }); };
  const r1h   = Math.max(measureVal(snap.fullName, COL1_W-64), measureVal(snap.position, COL2_W-68), measureVal(monthName, COL3_W-64));
  const iY3   = iY2 + r1h + 5;
  const r2h   = Math.max(measureVal(snap.idNumber, COL1_W-64), measureVal(snap.department||'—', COL2_W-68), measureVal(moment().format('DD MMM YYYY'), COL3_W-64));
  const iY4   = iY3 + r2h + 5;
  const dynH  = Math.max(76, (iY4 - y) + 22);

  doc.rect(0, y, PAGE_W, dynH).fill(C.accentBg);
  fullRule(doc, y + dynH, C.borderDark, 0.5);

  doc.save()
     .moveTo(col2X - 1, y + 8).lineTo(col2X - 1, y + dynH - 8).strokeColor(C.borderDark).lineWidth(0.5).stroke()
     .moveTo(col3X - 1, y + 8).lineTo(col3X - 1, y + dynH - 8).strokeColor(C.borderDark).lineWidth(0.5).stroke()
     .restore();

  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.medGray)
     .text('EMPLOYEE',       col1X + 4, iY, { characterSpacing: 0.8, width: COL1_W - 8,  lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.medGray)
     .text('EMPLOYMENT',     col2X + 8, iY, { characterSpacing: 0.8, width: COL2_W - 12, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.medGray)
     .text('PAYMENT PERIOD', col3X + 8, iY, { characterSpacing: 0.8, width: COL3_W - 12, lineBreak: false });

  infoField(doc, 'Full Name',  snap.fullName,                  col1X + 4, iY2, 52, COL1_W - 8);
  infoField(doc, 'Position',   snap.position,                  col2X + 8, iY2, 52, COL2_W - 16);
  infoField(doc, 'Period',     monthName,                      col3X + 8, iY2, 48, COL3_W - 16);
  infoField(doc, 'ID No.',     snap.idNumber,                  col1X + 4, iY3, 52, COL1_W - 8);
  infoField(doc, 'Department', snap.department || '—',         col2X + 8, iY3, 52, COL2_W - 16);
  infoField(doc, 'Pay Date',   moment().format('DD MMM YYYY'), col3X + 8, iY3, 48, COL3_W - 16);
  infoField(doc, 'Method',     'EFT / Bank Transfer',          col3X + 8, iY4, 48, COL3_W - 16);

  y += dynH + 16;

  // ── EARNINGS ─────────────────────────────────────────────────────────────
  y = sectionHeader(doc, 'Earnings', y, accent);

  tableRow(doc, 'Basic Salary', formatNAD(payslip.basicSalary), y);
  y += 22;

  if (payslip.overtimePay > 0) {
    tableRow(doc, 'Overtime Pay', formatNAD(payslip.overtimePay), y,
      { shade: true, note: `${payslip.overtimeHours} hrs @ overtime rate` });
    y += 28;
  }

  // Custom taxable earnings → each as a named row
  const custTaxable   = (payslip.customItems || []).filter(i => i.type === 'earning_taxable'    && i.amount > 0);
  const custNonTaxable= (payslip.customItems || []).filter(i => i.type === 'earning_nontaxable' && i.amount > 0);

  if (custTaxable.length > 0) {
    custTaxable.forEach((item, idx) => {
      tableRow(doc, item.name, formatNAD(item.amount), y,
        { shade: idx % 2 === 0, note: 'Taxable — included in PAYE computation' });
      y += 28;
    });
  } else if (payslip.taxableAllowances > 0) {
    // Legacy fallback for companies without custom items
    tableRow(doc, 'Taxable Allowances', formatNAD(payslip.taxableAllowances), y,
      { note: 'Housing, Car or Performance Bonuses — subject to PAYE' });
    y += 28;
  }

  if (custNonTaxable.length > 0) {
    custNonTaxable.forEach((item, idx) => {
      tableRow(doc, item.name, formatNAD(item.amount), y,
        { shade: idx % 2 === 1, note: 'Non-taxable — exempt from PAYE' });
      y += 28;
    });
  } else if (payslip.nonTaxableAllowances > 0) {
    tableRow(doc, 'Non-Taxable Allowances', formatNAD(payslip.nonTaxableAllowances), y,
      { shade: true, note: 'Reimbursements and Exempt Perks — excluded from PAYE' });
    y += 28;
  }

  rule(doc, y, C.border, 0.5);
  y += 8;
  y = summaryRow(doc, 'GROSS PAY', formatNAD(payslip.grossPay), y);
  y += 18;

  // ── DEDUCTIONS ────────────────────────────────────────────────────────────
  y = sectionHeader(doc, 'Statutory & Other Deductions', y, accent);

  tableRow(doc, 'P.A.Y.E (Income Tax)', formatNAD(payslip.paye), y,
    { note: 'Namibia Revenue Agency (NamRA) — Pay As You Earn' });
  y += 28;

  tableRow(doc, 'Social Security Contribution', formatNAD(payslip.sscEmployee), y,
    { shade: true, note: 'Employee portion — 0.9% of basic salary' });
  y += 28;

  // Custom deductions → each as a named row
  const custDeductions = (payslip.customItems || []).filter(i => i.type === 'deduction' && i.amount > 0);

  if (custDeductions.length > 0) {
    custDeductions.forEach((item, idx) => {
      tableRow(doc, item.name, formatNAD(item.amount), y,
        { shade: idx % 2 === 0, note: item.description || 'Manual deduction' });
      y += 28;
    });
  } else if (payslip.otherDeductions > 0) {
    tableRow(doc, 'Other Deductions', formatNAD(payslip.otherDeductions), y,
      { note: 'Manual adjustments / Staff loan repayments' });
    y += 28;
  }

  rule(doc, y, C.border, 0.5);
  y += 8;
  y = summaryRow(doc, 'TOTAL DEDUCTIONS', formatNAD(payslip.totalDeductions), y);
  y += 22;

  // ── NET PAY ───────────────────────────────────────────────────────────────
  const NET_H = 52;
  doc.rect(ML, y, INNER, NET_H).fill(accent);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff')
     .text('NET PAY', ML + 16, y + 12, { characterSpacing: 1.5 });
  doc.font('Helvetica').fontSize(7.5).fillColor('rgba(255,255,255,0.5)')
     .text('Amount payable to employee', ML + 16, y + 26);
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#ffffff')
     .text(formatNAD(payslip.netPay), ML, y + 13, { width: INNER - 16, align: 'right' });
  y += NET_H + 22;

  // ── EMPLOYER CONTRIBUTIONS (optional) ─────────────────────────────────────
  if (theme.showEmployerContributions !== false) {
    if (payslip.sscEmployer > 0 || payslip.ecf > 0) {
      y = sectionHeader(doc, 'Employer Contributions (Informational — Not Deducted From Employee)', y, accent);
      if (payslip.sscEmployer > 0) {
        tableRow(doc, 'Social Security (Employer)', formatNAD(payslip.sscEmployer), y,
          { note: 'Employer statutory contribution — 0.9% of basic salary' });
        y += 28;
      }
      if (payslip.ecf > 0) {
        tableRow(doc, "Workmen's Compensation (ECF)", formatNAD(payslip.ecf), y,
          { shade: true, note: "Employer's Compensation Fund — employer liability only" });
        y += 28;
      }
      y += 4;
    }
  }

  // ── LEAVE BALANCES (optional) ─────────────────────────────────────────────
  if (theme.showLeaveBalances !== false) {
    const LEAVE_H = 40;
    doc.rect(ML, y, INNER, LEAVE_H).fill(C.accentBg);
    rule(doc, y, C.borderDark, 0.5);
    rule(doc, y + LEAVE_H, C.borderDark, 0.5);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.medGray)
       .text('LEAVE BALANCES', ML + 12, y + 8, { characterSpacing: 0.8 });
    const leaveY = y + 20;
    doc.font('Helvetica').fontSize(8).fillColor(C.bodyText).text('Annual Leave Taken:', ML + 12, leaveY);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.darkGray).text(`${payslip.annualLeaveTaken || 0} day(s)`, ML + 112, leaveY);
    doc.font('Helvetica').fontSize(8).fillColor(C.bodyText).text('Sick Leave Taken:', ML + 230, leaveY);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.darkGray).text(`${payslip.sickLeaveTaken || 0} day(s)`, ML + 318, leaveY);
  }

  footer(doc, theme);
  doc.end();
}

// ── COMPLIANCE REPORT PDF ─────────────────────────────────────────────────────

function generateCompliancePDF(payrollRun, companyUser, stream) {
  const doc = new PDFDocument({ margin: 0, size: 'A4' });
  doc.pipe(stream);
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(C.pageBg);
  doc.rect(0, 0, PAGE_W, 4).fill(C.black);

  const HDR_H = 66;
  doc.rect(0, 4, PAGE_W, HDR_H).fill(C.pillBg);
  fullRule(doc, 4 + HDR_H, C.borderDark, 1);

  doc.font('Helvetica-Bold').fontSize(15).fillColor(C.black).text('MONTHLY COMPLIANCE REPORT', ML, 20);
  doc.font('Helvetica').fontSize(9).fillColor(C.medGray).text(companyUser.companyName, ML, 40);
  doc.font('Helvetica').fontSize(9).fillColor(C.medGray)
     .text(`Payroll Period: ${String(payrollRun.month).padStart(2,'0')} / ${payrollRun.year}`, ML + 200, 40);
  doc.font('Helvetica').fontSize(8).fillColor(C.lightGray)
     .text(`Generated: ${moment().format('DD MMM YYYY, HH:mm')}`, ML, 40, { width: INNER, align: 'right' });

  let y = 4 + HDR_H + 22;
  y = sectionHeader(doc, 'Statutory Remittance Summary', y);

  const stats = [
    ['Total Gross Salaries Paid',          formatNAD(payrollRun.totalGrossPay),    'Sum of all employee gross earnings this period'],
    ['Total PAYE Liability (NamRA)',        formatNAD(payrollRun.totalPAYE),        'Remit to Namibia Revenue Agency by 20th of following month'],
    ['Total SSC — Employee Contributions', formatNAD(payrollRun.totalSSCEmployee), '0.9% deducted from employee salaries'],
    ['Total SSC — Employer Contributions', formatNAD(payrollRun.totalSSCEmployer), '0.9% employer-funded contribution'],
    ["Total Workmen's Compensation (ECF)", formatNAD(payrollRun.totalECF),         "Employer's Compensation Fund — employer liability"],
    ['Total Net Salaries Distributed',     formatNAD(payrollRun.totalNetPay),      'Actual amounts transferred to employee bank accounts'],
  ];

  stats.forEach(([label, val, note], i) => {
    if (i % 2 === 1) doc.rect(ML, y - 4, INNER, note ? 30 : 22).fill(C.rowAlt);
    tableRow(doc, label, val, y, { note, shade: false });
    y += note ? 30 : 22;
    rule(doc, y - 2, C.border, 0.4);
  });

  y += 20;
  doc.rect(ML, y, INNER, 36).fill(C.black);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff')
     .text('TOTAL EMPLOYER PAYROLL COST', ML + 16, y + 8, { characterSpacing: 0.8 });
  doc.font('Helvetica').fontSize(7.5).fillColor('rgba(255,255,255,0.5)')
     .text('Gross pay + employer SSC + ECF', ML + 16, y + 20);

  const totalCost = (payrollRun.totalGrossPay || 0) + (payrollRun.totalSSCEmployer || 0) + (payrollRun.totalECF || 0);
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#ffffff')
     .text(formatNAD(totalCost), ML, y + 9, { width: INNER - 16, align: 'right' });

  footer(doc, {});
  doc.end();
}

module.exports = { generatePayslipPDF, generateCompliancePDF };