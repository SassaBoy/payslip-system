/**
 * utils/etxGenerator.js – NamPayroll
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates the NamRA ETX / PAYE4 annual reconciliation XLSX file.
 * Column order matches ETX_Template_Version_2.xlsx exactly (81 columns).
 * Styling: pure black & white — no colour fills anywhere.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ExcelJS = require('exceljs');

// ── Housing type mapper → ETX string values ───────────────────────────────────
const HOUSING_MAP = {
  free:       'Free Housing',
  subsidised: 'Subsidised Housing',
  none:       ''
};

// ── Column definitions (all 81, exact ETX order) ─────────────────────────────
const ETX_COLUMNS = [
  'NO.',
  "Employee's TIN",
  'Identification Number',
  "Employee's Name",
  'Salaries, Wages, Pension',
  'Commission',
  'Housing Type',
  'Reference No.',
  'Tax Values',
  'Exempt on Tax Value',
  'Taxable portion',
  'Tax Value of Subsidised Loans (Specify)',
  'Tax Value of Company Vehicle(s)',
  'Other fringe benefits',
  'Entertainment Allowance',
  'Vehicle running expense allowance ',
  'Vehicle purchase allowance ',
  'Subsistance and Travel Expense Allowance',
  'Other Allowance (Specify)',
  'Other Allowance Type',
  'Other Income (Specify)',
  'Other Income Type',
  'Annuity Income',
  'Gross Remuneration',
  'Pension Fund Name',
  'Registration No. of Fund',
  'Contribution for Fund',
  'Provident Fund Name',
  'Registration No. of Fund',
  'Contribution for Fund',
  'Retirement Fund Name',
  'Registration No. of Fund',
  'Contribution for Fund',
  'Study Policy Name',
  'Registration No. of Study Policy',
  'Contribution for Study Policy',
  'Total Deductions',
  'TAXABLE INCOME',
  'TAX LIABILITY',
  'Tax Deducted',
  'Tax Directive Number_1',
  'Tax Directive Type_1',
  'Date of termination of service/Accrual Date_1',
  'Reason_1',
  'Gross Amount_1',
  'Tax Free Amount_1',
  'Taxable Amount_1',
  'Tax Deducted_1',
  'Tax Directive Number_2',
  'Tax Directive Type_2',
  'Date of termination of service/Accrual Date_2',
  'Reason_2',
  'Gross Amount_2',
  'Tax Free Amount_2',
  'Taxable Amount_2',
  'Tax Deducted_2',
  'Tax Directive Number_3',
  'Tax Directive Type_3',
  'Date of termination of service/Accrual Date_3',
  'Reason_3',
  'Gross Amount_3',
  'Tax Free Amount_3',
  'Taxable Amount_3',
  'Tax Deducted_3',
  'Tax Directive Number_4',
  'Tax Directive Type_4',
  'Date of termination of service/Accrual Date_4',
  'Reason_4',
  'Gross Amount_4',
  'Tax Free Amount_4',
  'Taxable Amount_4',
  'Tax Deducted_4',
  'Tax Directive Number_5',
  'Tax Directive Type_5',
  'Date of termination of service/Accrual Date_5',
  'Reason_5',
  'Gross Amount_5',
  'Tax Free Amount_5',
  'Taxable Amount_5',
  'Tax Deducted_5',
  'Totals'
];

// ── Shared border style — thin black on all sides ─────────────────────────────
const THIN_BORDER = {
  top:    { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  left:   { style: 'thin', color: { argb: 'FF000000' } },
  right:  { style: 'thin', color: { argb: 'FF000000' } }
};

const MEDIUM_BORDER = {
  top:    { style: 'medium', color: { argb: 'FF000000' } },
  bottom: { style: 'medium', color: { argb: 'FF000000' } },
  left:   { style: 'medium', color: { argb: 'FF000000' } },
  right:  { style: 'medium', color: { argb: 'FF000000' } }
};

// ── White fill (explicit — no pattern = transparent in some viewers) ───────────
const WHITE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
// ── Light grey fill for alternating rows ──────────────────────────────────────
const ALT_FILL   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
// ── Black fill for header and totals ─────────────────────────────────────────
const BLACK_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };

/**
 * Generates an ETX XLSX buffer for a given tax year's payroll runs.
 *
 * @param {Array}  payrollRuns — Array of PayrollRun docs (lean), same tax year
 * @param {Array}  employees  — Array of Employee docs (lean), keyed by _id
 * @param {number} taxYear    — e.g. 2025 (March 2025 – Feb 2026)
 * @returns {Buffer}
 */
async function generateETXBuffer(payrollRuns, employees, taxYear) {

  // ── Build employee lookup map ───────────────────────────────────────────────
  const empMap = {};
  for (const emp of employees) empMap[emp._id.toString()] = emp;

  // ── Aggregate annual totals per employee across all runs ────────────────────
  const annualMap = {};

  for (const run of payrollRuns) {
    for (const ps of run.payslips) {
      const empId = ps.employee?.toString() || ps.employeeSnapshot?.idNumber;
      if (!empId) continue;

      if (!annualMap[empId]) {
        annualMap[empId] = {
          employee:     empMap[empId] || null,
          snapshot:     ps.employeeSnapshot || {},
          salary:       0,
          otPay:        0,
          taxAllow:     0,
          nonTaxAllow:  0,
          grossPay:     0,
          taxableGross: 0,
          paye:         0,
          totalDed:     0,
          netPay:       0
        };
      }

      const a = annualMap[empId];
      a.salary       += ps.basicSalary         || 0;
      a.otPay        += ps.overtimePay          || 0;
      a.taxAllow     += ps.taxableAllowances    || 0;
      a.nonTaxAllow  += ps.nonTaxableAllowances || 0;
      a.grossPay     += ps.grossPay             || 0;
      a.taxableGross += ps.taxableGross          || 0;
      a.paye         += ps.paye                 || 0;
      a.totalDed     += ps.totalDeductions      || 0;
      a.netPay       += ps.netPay               || 0;
    }
  }

  // ── Build workbook ──────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NamPayroll';
  wb.created = new Date();

  const ws = wb.addWorksheet('PAYE4');

  // ── Header row — black background, white bold text ────────────────────────
  const headerRow = ws.addRow(ETX_COLUMNS);
  headerRow.height = 36;
  headerRow.eachCell({ includeEmpty: true }, cell => {
    cell.font      = { bold: true, size: 9, name: 'Arial', color: { argb: 'FFFFFFFF' } };
    cell.fill      = BLACK_FILL;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border    = THIN_BORDER;
  });

  // ── Data rows ───────────────────────────────────────────────────────────────
  let rowNum = 1;
  const columnTotals = new Array(81).fill(0);

  for (const [, a] of Object.entries(annualMap)) {
    const emp  = a.employee || {};
    const snap = a.snapshot;

    const r = (n) => Math.round(n * 100) / 100;

    const annualSalary     = r(a.salary);
    const annualGross      = r(a.grossPay);
    const annualTaxGross   = r(a.taxableGross);
    const annualPAYE       = r(a.paye);
    const annualPension    = r((emp.pensionContribution    || 0) * 12);
    const annualMedical    = r((emp.medicalAidContribution || 0) * 12);
    const annualDeductions = r(annualPension + annualMedical);
    const taxableIncome    = r(Math.max(0, annualTaxGross - annualDeductions));
    const seqNo            = String(rowNum).padStart(3, '0');
    const rowRef           = `ETX-${taxYear}-${String(rowNum).padStart(4, '0')}`;

    const rowData = [
      /* 1  */ seqNo,
      /* 2  */ emp.tinNumber          || snap.tinNumber  || '',
      /* 3  */ emp.idNumber           || snap.idNumber   || '',
      /* 4  */ emp.fullName           || snap.fullName   || '',
      /* 5  */ annualSalary,
      /* 6  */ 0,
      /* 7  */ HOUSING_MAP[emp.housingType] || '',
      /* 8  */ rowRef,
      /* 9  */ 0,
      /* 10 */ 0,
      /* 11 */ 0,
      /* 12 */ 0,
      /* 13 */ 0,
      /* 14 */ 0,
      /* 15 */ 0,
      /* 16 */ 0,
      /* 17 */ 0,
      /* 18 */ 0,
      /* 19 */ r(a.taxAllow),
      /* 20 */ a.taxAllow > 0 ? 'Performance/Other' : '',
      /* 21 */ r(a.nonTaxAllow),
      /* 22 */ a.nonTaxAllow > 0 ? 'Reimbursement/Exempt' : '',
      /* 23 */ 0,
      /* 24 */ annualGross,
      /* 25 */ emp.pensionFundName    || '',
      /* 26 */ emp.pensionFundRegNo   || '',
      /* 27 */ annualPension,
      /* 28 */ '',
      /* 29 */ '',
      /* 30 */ 0,
      /* 31 */ '',
      /* 32 */ '',
      /* 33 */ 0,
      /* 34 */ '',
      /* 35 */ '',
      /* 36 */ 0,
      /* 37 */ annualDeductions,
      /* 38 */ taxableIncome,
      /* 39 */ annualPAYE,
      /* 40 */ annualPAYE,
      // Tax Directives 1–5 — blank (no terminations)
      /* 41 */ '', /* 42 */ '', /* 43 */ '', /* 44 */ '',
      /* 45 */ 0,  /* 46 */ 0,  /* 47 */ 0,  /* 48 */ 0,
      /* 49 */ '', /* 50 */ '', /* 51 */ '', /* 52 */ '',
      /* 53 */ 0,  /* 54 */ 0,  /* 55 */ 0,  /* 56 */ 0,
      /* 57 */ '', /* 58 */ '', /* 59 */ '', /* 60 */ '',
      /* 61 */ 0,  /* 62 */ 0,  /* 63 */ 0,  /* 64 */ 0,
      /* 65 */ '', /* 66 */ '', /* 67 */ '', /* 68 */ '',
      /* 69 */ 0,  /* 70 */ 0,  /* 71 */ 0,  /* 72 */ 0,
      /* 73 */ '', /* 74 */ '', /* 75 */ '', /* 76 */ '',
      /* 77 */ 0,  /* 78 */ 0,  /* 79 */ 0,  /* 80 */ 0,
      /* 81 */ annualGross
    ];

    // Accumulate totals
    rowData.forEach((val, idx) => {
      if (typeof val === 'number') columnTotals[idx] = (columnTotals[idx] || 0) + val;
    });

    const dataRow  = ws.addRow(rowData);
    const rowFill  = rowNum % 2 === 0 ? ALT_FILL : WHITE_FILL;

    dataRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
      cell.font      = { size: 9, name: 'Arial', color: { argb: 'FF000000' } };
      cell.fill      = rowFill;
      cell.border    = THIN_BORDER;
      if (typeof rowData[colNum - 1] === 'number') {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        cell.numFmt    = '#,##0.00';
      } else {
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
      }
    });

    rowNum++;
  }

  // ── Totals row — black background, white bold text ────────────────────────
  const totalsData = new Array(81).fill('');
  totalsData[0] = 'TOTALS';
  columnTotals.forEach((val, idx) => {
    if (val && typeof val === 'number') totalsData[idx] = val;
  });

  const totalsRow = ws.addRow(totalsData);
  totalsRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
    cell.font      = { bold: true, size: 9, name: 'Arial', color: { argb: 'FFFFFFFF' } };
    cell.fill      = BLACK_FILL;
    cell.border    = MEDIUM_BORDER;
    if (typeof totalsData[colNum - 1] === 'number') {
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      cell.numFmt    = '#,##0.00';
    } else {
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
    }
  });

  // ── Column widths ───────────────────────────────────────────────────────────
  ws.columns.forEach((col, idx) => {
    if (idx === 3)       col.width = 28;   // Employee name — wider
    else if (idx <= 3)   col.width = 14;
    else if (idx >= 40)  col.width = 10;   // Tax directive cols — narrow
    else                 col.width = 18;
  });

  // Freeze header row so columns stay visible when scrolling
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  return await wb.xlsx.writeBuffer();
}

module.exports = { generateETXBuffer };