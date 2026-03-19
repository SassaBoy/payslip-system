/**
 * pdfGenerator.js – NamPayroll Professional Edition
 * ─────────────────────────────────────────────────────────────────────────────
 * Full version: Supports Taxable/Non-Taxable Allowances and Manual Deductions.
 * Updated: White Header Design & Larger Logo Support.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PDFDocument = require('pdfkit');
const moment = require('moment-timezone');
const path = require('path');
const fs = require('fs');
const { formatNAD } = require('./payrollCalculator');

// ── Design Tokens ─────────────────────────────────────────────────────────────
const C = {
  pageBg:     '#ffffff',
  black:      '#000000',
  darkGray:   '#1a1a1a',
  bodyText:   '#333333',
  subText:    '#555555',
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

// ── Utility Helpers ───────────────────────────────────────────────────────────

/**
 * Renders company logo with increased dimensions
 */
function renderCompanyLogo(doc, logoPath, x, y) {
  if (!logoPath) return false;
  const fullPath = path.join(__dirname, '..', 'public', logoPath);
  try {
    if (fs.existsSync(fullPath)) {
      // Increased width to 180 and max height to 65
      doc.image(fullPath, x, y, { fit: [180, 65] });
      return true;
    }
  } catch (err) { console.error('PDF Logo Error:', err); }
  return false;
}

function rule(doc, y, color = C.border, thickness = 0.5) {
  doc.save().moveTo(ML, y).lineTo(ML + INNER, y).strokeColor(color).lineWidth(thickness).stroke().restore();
}

function tableRow(doc, description, amount, y, opts = {}) {
  const { descColor = C.bodyText, amountColor = C.darkGray, fontSize = 9, bold = false, shade = false, note = null } = opts;
  
  if (shade) {
    doc.rect(ML, y - 4, INNER, note ? 24 : 18).fill(C.rowAlt);
  }
  
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor(descColor);
  doc.text(description, ML + 10, y);
  
  if (note) {
    doc.font('Helvetica').fontSize(7.5).fillColor(C.lightGray);
    doc.text(note, ML + 10, y + 11);
  }
  
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor(amountColor);
  const displayAmount = amount || 'N$ 0.00';
  doc.text(displayAmount, ML, y, { width: INNER - 10, align: 'right' });
}

function sectionHeader(doc, title, y) {
  const H = 20;
  doc.rect(ML, y, INNER, H).fill(C.pillBg);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.headerText);
  doc.text(title.toUpperCase(), ML + 10, y + 6, { characterSpacing: 1 });
  return y + H + 10;
}

function footer(doc) {
  const fy = PAGE_H - 40;
  rule(doc, fy, C.borderDark, 0.5);
  doc.font('Helvetica').fontSize(7).fillColor(C.lightGray);
  doc.text('This payslip is a private and confidential document.', ML, fy + 12);
  doc.text(`NamPayroll System • ${moment().format('YYYY-MM-DD HH:mm')}`, ML, fy + 12, { align: 'right', width: INNER });
}

// ── PAYSLIP GENERATION ────────────────────────────────────────────────────────

function generatePayslipPDF(payslip, companyUser, month, year, stream) {
  const doc = new PDFDocument({ margin: 0, size: 'A4' });
  doc.pipe(stream);

  doc.rect(0, 0, PAGE_W, PAGE_H).fill(C.pageBg);
  const monthName = moment(`${year}-${String(month).padStart(2, '0')}-01`).format('MMMM YYYY');
  const snap = payslip.employeeSnapshot || {};

  // ── HEADER (White Background) ──
  let y = 30;
  const hasLogo = renderCompanyLogo(doc, companyUser.companyLogo, ML, y);
  
  // Header Text
  doc.font('Helvetica-Bold').fontSize(14).fillColor(C.headerText)
     .text(companyUser.companyName || 'NAMIBIA PAYROLL', ML, y + (hasLogo ? 0 : 0), { align: 'right', width: INNER });
  
  doc.font('Helvetica-Bold').fontSize(22).fillColor(C.black)
     .text('PAYSLIP', ML, y + 20, { align: 'right', width: INNER });
  
  doc.font('Helvetica').fontSize(10).fillColor(C.medGray)
     .text(monthName.toUpperCase(), ML, y + 45, { align: 'right', width: INNER });

  y = 110;
  rule(doc, y, C.borderDark, 1);
  y += 20;

  // ── EMPLOYEE INFO GRID ──
  const colW = INNER / 2;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.black).text('EMPLOYEE DETAILS', ML, y);
  doc.text('PAYMENT INFO', ML + colW, y);
  y += 15;

  const infoRow = (label, val, x) => {
    doc.font('Helvetica').fontSize(8.5).fillColor(C.medGray).text(label, x, y);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.darkGray).text(val || '-', x + 75, y);
  };

  infoRow('Name:', snap.fullName, ML);
  infoRow('Period:', monthName, ML + colW);
  y += 14;
  infoRow('ID No:', snap.idNumber, ML);
  infoRow('Date:', moment().format('DD MMM YYYY'), ML + colW);
  y += 14;
  infoRow('Position:', snap.position, ML);
  infoRow('Method:', 'EFT / Bank Transfer', ML + colW);

  y += 30;

  // ── EARNINGS ──
  y = sectionHeader(doc, 'Earnings', y);
  
  tableRow(doc, 'Basic Salary', formatNAD(payslip.basicSalary), y);
  y += 20;

  if (payslip.overtimePay > 0) {
    tableRow(doc, 'Overtime Pay', formatNAD(payslip.overtimePay), y, { shade: true, note: `${payslip.overtimeHours} hours worked` });
    y += 25;
  }

  if (payslip.taxableAllowances > 0) {
    tableRow(doc, 'Taxable Allowances', formatNAD(payslip.taxableAllowances), y, { note: 'Housing, Car, or Performance Bonuses' });
    y += 25;
  }

  if (payslip.nonTaxableAllowances > 0) {
    tableRow(doc, 'Non-Taxable Allowances', formatNAD(payslip.nonTaxableAllowances), y, { shade: true, note: 'Reimbursements and Exempt Perks' });
    y += 25;
  }

  // Gross Pay Summary
  doc.rect(ML, y, INNER, 22).fill(C.accentBg);
  tableRow(doc, 'GROSS PAY', formatNAD(payslip.grossPay), y + 6, { bold: true, fontSize: 10 });
  y += 40;

  // ── DEDUCTIONS ──
  y = sectionHeader(doc, 'Deductions', y);

  tableRow(doc, 'P.A.Y.E (Tax)', formatNAD(payslip.paye), y, { note: 'NamRA Statutory Income Tax' });
  y += 25;

  tableRow(doc, 'Social Security (Employee)', formatNAD(payslip.sscEmployee), y, { shade: true, note: '0.9% Employee Contribution' });
  y += 25;

  if (payslip.otherDeductions > 0) {
    tableRow(doc, 'Other Deductions', formatNAD(payslip.otherDeductions), y, { note: 'Manual Adjustments / Staff Loans' });
    y += 25;
  }

  doc.rect(ML, y, INNER, 22).fill(C.accentBg);
  tableRow(doc, 'TOTAL DEDUCTIONS', formatNAD(payslip.totalDeductions), y + 6, { bold: true });
  y += 50;

  // ── NET PAY BOX ──
  doc.rect(ML, y, INNER, 45).fill(C.black);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff').text('NET PAYABLE AMOUNT', ML + 15, y + 16);
  doc.fontSize(18).text(formatNAD(payslip.netPay), ML, y + 13, { width: INNER - 15, align: 'right' });
  y += 70;

  // ── LEAVE BALANCE (Optional) ──
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.medGray).text('LEAVE BALANCES', ML, y);
  y += 12;
  doc.font('Helvetica').fontSize(8).fillColor(C.bodyText)
     .text(`Annual Leave Taken: ${payslip.annualLeaveTaken || 0} days`, ML, y);
  doc.text(`Sick Leave Taken: ${payslip.sickLeaveTaken || 0} days`, ML + 200, y);

  footer(doc);
  doc.end();
}

// ── COMPLIANCE REPORT ────────────────────────────────────────────────────────

function generateCompliancePDF(payrollRun, companyUser, stream) {
  const doc = new PDFDocument({ margin: 0, size: 'A4' });
  doc.pipe(stream);
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(C.pageBg);
  
  doc.rect(0, 0, PAGE_W, 70).fill(C.pillBg);
  doc.font('Helvetica-Bold').fontSize(16).fillColor(C.black).text('MONTHLY COMPLIANCE REPORT', ML, 25);
  doc.font('Helvetica').fontSize(10).fillColor(C.medGray).text(`${companyUser.companyName} • ${payrollRun.month}/${payrollRun.year}`, ML, 45);

  let y = 100;
  y = sectionHeader(doc, 'Statutory Remittance Summary', y);
  
  const stats = [
    ['Total Gross Salaries', formatNAD(payrollRun.totalGrossPay)],
    ['Total PAYE Liability (NamRA)', formatNAD(payrollRun.totalPAYE)],
    ['Total SSC (Employee + Employer)', formatNAD(payrollRun.totalSSCEmployee + payrollRun.totalSSCEmployer)],
    ['Total Workmens Comp (ECF)', formatNAD(payrollRun.totalECF)],
    ['Total Net Salaries Distributed', formatNAD(payrollRun.totalNetPay)]
  ];

  stats.forEach(([label, val]) => {
    tableRow(doc, label, val, y);
    y += 25;
    rule(doc, y - 5);
  });

  footer(doc);
  doc.end();
}

module.exports = { generatePayslipPDF, generateCompliancePDF };