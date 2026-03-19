/**
 * csvGenerator.js – NamPayroll Professional Edition
 * ─────────────────────────────────────────────────────────────────────────────
 * Updated to include Taxable/Non-Taxable Allowances and Other Deductions.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { stringify } = require('csv-stringify/sync');
const moment        = require('moment-timezone');

// ── Shared Helpers ────────────────────────────────────────────────────────────

function buildMetaBlock(lines) {
  return lines.map(line => [`# ${line}`]);
}

function buildCSV(metaRows, dataRows, columns) {
  const preamble = metaRows.map(r => r.join(',')).join('\n');
  const dataCSV = stringify(dataRows, {
    header: true,
    columns: columns,
  });
  return `${preamble}\n#\n${dataCSV}`;
}

function fmt(val) {
  const n = parseFloat(val);
  // Returns '0.00' for NaN or undefined to prevent CSV breakage
  return isNaN(n) ? '0.00' : n.toFixed(2);
}

// ─────────────────────────────────────────────────────────────────────────────
//  BANK TRANSFER CSV (Focused on Net Pay distribution)
// ─────────────────────────────────────────────────────────────────────────────

function generateBankTransferCSV(payrollRun, companyUser) {
  return new Promise((resolve, reject) => {
    try {
      const tz          = 'Africa/Windhoek';
      const monthDate   = moment(`${payrollRun.year}-${String(payrollRun.month).padStart(2, '0')}-01`);
      const monthName   = monthDate.format('MMMM YYYY');
      const shortMonth  = monthDate.format('MMM YYYY');
      const paymentDate = moment().tz(tz).format('DD/MM/YYYY');
      const generatedAt = moment().tz(tz).format('DD MMMM YYYY HH:mm');

      const totalNetPay = (payrollRun.totalNetPay || 0).toFixed(2);

      const meta = buildMetaBlock([
        'NamPayroll – Bank Transfer File',
        `Company       : ${companyUser.companyName}`,
        `Pay Period     : ${monthName}`,
        `Payment Date   : ${paymentDate}`,
        `Total Net Pay  : NAD ${totalNetPay}`,
        `Generated      : ${generatedAt}`,
      ]);

      const columns = [
        'Beneficiary Name', 'Bank Account Number', 'Branch Code', 'Account Type',
        'Amount (NAD)', 'Payment Reference', 'Own Reference', 'Payment Date'
      ];

      const dataRows = payrollRun.payslips.map((ps, idx) => {
        const snap = ps.employeeSnapshot || {};
        return {
          'Beneficiary Name':    snap.fullName || '',
          'Bank Account Number': snap.bankAccountNumber || '',
          'Branch Code':         snap.branchCode || '',
          'Account Type':        snap.accountType || 'Cheque/Current',
          'Amount (NAD)':        fmt(ps.netPay),
          'Payment Reference':   `Salary ${shortMonth}`,
          'Own Reference':       `SAL-${payrollRun.year}${String(payrollRun.month).padStart(2,'0')}-${String(idx + 1).padStart(3,'0')}`,
          'Payment Date':        paymentDate,
        };
      });

      resolve(buildCSV(meta, dataRows, columns));
    } catch (err) { reject(err); }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  COMPLIANCE SUMMARY CSV (Detailed Statutory Reporting)
// ─────────────────────────────────────────────────────────────────────────────

function generateComplianceCSV(payrollRun, companyUser) {
  return new Promise((resolve, reject) => {
    try {
      const tz           = 'Africa/Windhoek';
      const monthName    = moment(`${payrollRun.year}-${String(payrollRun.month).padStart(2, '0')}-01`).format('MMMM YYYY');
      const generatedAt  = moment().tz(tz).format('DD MMMM YYYY HH:mm');

      const totalSSC = (
        (payrollRun.totalSSCEmployee || 0) + (payrollRun.totalSSCEmployer || 0)
      ).toFixed(2);

      // ── Metadata preamble ─────────────────────────────────────────────────
      const meta = buildMetaBlock([
        'NamPayroll – Monthly Compliance Summary',
        `Company               : ${companyUser.companyName}`,
        `Reporting Period      : ${monthName}`,
        `Employees Processed   : ${payrollRun.employeeCount}`,
        '─────────────────────────────────────────────────────',
        `Total Gross Pay       : NAD ${fmt(payrollRun.totalGrossPay)}`,
        `Total PAYE (NamRA)    : NAD ${fmt(payrollRun.totalPAYE)}`,
        `Total SSC (Emp+Empr)  : NAD ${totalSSC}`,
        `Total Other Deduct.   : NAD ${fmt(payrollRun.totalOtherDeductions || 0)}`,
        `Total Net Pay         : NAD ${fmt(payrollRun.totalNetPay)}`,
        '─────────────────────────────────────────────────────',
        `Generated             : ${generatedAt}`,
      ]);

      // ── Column definitions ────────────────────────────────────────────────
      const columns = [
        'No.',
        'Employee Name',
        'ID Number',
        'Basic Salary',
        'Overtime Pay',
        'Taxable Allowances',
        'Non-Taxable Allowances',
        'Gross Pay',
        'PAYE',
        'SSC Employee',
        'Other Deductions',
        'Total Deductions',
        'Net Pay',
        'SSC Employer',
        'ECF',
        'Total Employer Cost',
      ];

      // ── Data rows ─────────────────────────────────────────────────────────
      const dataRows = payrollRun.payslips.map((ps, idx) => {
        const snap = ps.employeeSnapshot || {};
        return {
          'No.':                     idx + 1,
          'Employee Name':           snap.fullName   || '',
          'ID Number':               snap.idNumber   || '',
          'Basic Salary':            fmt(ps.basicSalary),
          'Overtime Pay':            fmt(ps.overtimePay || 0),
          'Taxable Allowances':      fmt(ps.taxableAllowances || 0),
          'Non-Taxable Allowances':  fmt(ps.nonTaxableAllowances || 0),
          'Gross Pay':               fmt(ps.grossPay),
          'PAYE':                    fmt(ps.paye),
          'SSC Employee':            fmt(ps.sscEmployee),
          'Other Deductions':        fmt(ps.otherDeductions || 0),
          'Total Deductions':        fmt(ps.totalDeductions),
          'Net Pay':                 fmt(ps.netPay),
          'SSC Employer':            fmt(ps.sscEmployer),
          'ECF':                     fmt(ps.ecf),
          'Total Employer Cost':     fmt(ps.totalEmployerCost),
        };
      });

      // ── Totals row ────────────────────────────────────────────────────────
      dataRows.push({
        'No.':                     '',
        'Employee Name':           'TOTALS',
        'ID Number':               '',
        'Basic Salary':            '',
        'Overtime Pay':            '',
        'Taxable Allowances':      '', 
        'Non-Taxable Allowances':  '',
        'Gross Pay':               fmt(payrollRun.totalGrossPay),
        'PAYE':                    fmt(payrollRun.totalPAYE),
        'SSC Employee':            fmt(payrollRun.totalSSCEmployee),
        'Other Deductions':        fmt(payrollRun.totalOtherDeductions || 0),
        'Total Deductions':        '', // Calculated as a sum of above if needed
        'Net Pay':                 fmt(payrollRun.totalNetPay),
        'SSC Employer':            fmt(payrollRun.totalSSCEmployer),
        'ECF':                     fmt(payrollRun.totalECF),
        'Total Employer Cost':     fmt(payrollRun.totalEmployerCost),
      });

      resolve(buildCSV(meta, dataRows, columns));
    } catch (err) { reject(err); }
  });
}

module.exports = { generateBankTransferCSV, generateComplianceCSV };