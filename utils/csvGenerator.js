/**
 * csvGenerator.js – NamPayroll Professional Edition
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates Bank Transfer and Compliance Summary CSV exports.
 * Structured to mirror the payslip layout standard: clear metadata preamble,
 * consistent column ordering, and leave data included.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { stringify } = require('csv-stringify/sync');
const moment        = require('moment-timezone');

// ── Shared Constants ──────────────────────────────────────────────────────────
const TZ        = 'Africa/Windhoek';
const DIVIDER   = '─────────────────────────────────────────────────────────────';

// ── Shared Helpers ────────────────────────────────────────────────────────────

/**
 * Formats a number to exactly 2 decimal places.
 * Returns '0.00' for any non-numeric value to prevent CSV breakage.
 */
function fmt(val) {
  const n = parseFloat(val);
  return isNaN(n) ? '0.00' : n.toFixed(2);
}

/**
 * Builds the metadata preamble rows.
 * Each entry in `lines` becomes a CSV comment row prefixed with `#`.
 * Divider strings are passed through as-is.
 */
function buildMetaBlock(lines) {
  return lines.map(line =>
    line === DIVIDER ? [`# ${DIVIDER}`] : [`# ${line}`]
  );
}

/**
 * Assembles the final CSV string: preamble + data.
 */
function buildCSV(metaRows, dataRows, columns) {
  const preamble = metaRows.map(r => r.join(',')).join('\n');
  const dataCSV  = stringify(dataRows, { header: true, columns });
  return `${preamble}\n#\n${dataCSV}`;
}

/**
 * Safely formats a leave value — shows '0.0' for falsy, preserves decimals.
 */
function fmtLeave(val) {
  const n = parseFloat(val);
  return isNaN(n) ? '0.0' : n % 1 === 0 ? `${n}` : n.toFixed(1);
}

// ─────────────────────────────────────────────────────────────────────────────
//  BANK TRANSFER CSV
//  Purpose : Net salary distribution instructions for the company's bank.
//  Layout  : One row per employee. Mirrors payslip Employee / Payment sections.
// ─────────────────────────────────────────────────────────────────────────────

function generateBankTransferCSV(payrollRun, companyUser) {
  return new Promise((resolve, reject) => {
    try {
      const monthDate   = moment(`${payrollRun.year}-${String(payrollRun.month).padStart(2, '0')}-01`);
      const monthName   = monthDate.format('MMMM YYYY');
      const shortMonth  = monthDate.format('MMM YYYY');
      const paymentDate = moment().tz(TZ).format('DD/MM/YYYY');
      const generatedAt = moment().tz(TZ).format('DD MMMM YYYY, HH:mm');
      const refPrefix   = `SAL-${payrollRun.year}${String(payrollRun.month).padStart(2, '0')}`;

      // ── Metadata preamble ─────────────────────────────────────────────────
      const meta = buildMetaBlock([
        'NamPayroll – Bank Transfer File',
        DIVIDER,
        `Company          : ${companyUser.companyName}`,
        `Pay Period        : ${monthName}`,
        `Payment Date      : ${paymentDate}`,
        `Employees         : ${payrollRun.employeeCount || payrollRun.payslips.length}`,
        DIVIDER,
        `Total Net Pay     : NAD ${fmt(payrollRun.totalNetPay)}`,
        DIVIDER,
        `Generated         : ${generatedAt}`,
        `Reference Prefix  : ${refPrefix}`,
      ]);

      // ── Columns — mirror payslip Employee + Payment Period sections ───────
      const columns = [
        'Ref No.',
        'Beneficiary Name',
        'ID Number',
        'Bank Account Number',
        'Branch Code',
        'Account Type',
        'Amount (NAD)',
        'Payment Reference',
        'Payment Date',
      ];

      // ── Data rows ─────────────────────────────────────────────────────────
      const dataRows = payrollRun.payslips.map((ps, idx) => {
        const snap = ps.employeeSnapshot || {};
        const seq  = String(idx + 1).padStart(3, '0');
        return {
          'Ref No.':             `${refPrefix}-${seq}`,
          'Beneficiary Name':    snap.fullName         || '',
          'ID Number':           snap.idNumber         || '',
          'Bank Account Number': snap.bankAccountNumber || '',
          'Branch Code':         snap.branchCode        || '',
          'Account Type':        snap.accountType       || 'Cheque/Current',
          'Amount (NAD)':        fmt(ps.netPay),
          'Payment Reference':   `Salary ${shortMonth}`,
          'Payment Date':        paymentDate,
        };
      });

      // ── Totals footer row ─────────────────────────────────────────────────
      dataRows.push({
        'Ref No.':             '',
        'Beneficiary Name':    'TOTAL',
        'ID Number':           '',
        'Bank Account Number': '',
        'Branch Code':         '',
        'Account Type':        '',
        'Amount (NAD)':        fmt(payrollRun.totalNetPay),
        'Payment Reference':   '',
        'Payment Date':        '',
      });

      resolve(buildCSV(meta, dataRows, columns));
    } catch (err) { reject(err); }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  COMPLIANCE SUMMARY CSV
//  Purpose : Full statutory reporting — mirrors payslip Earnings + Deductions
//            + Leave sections in column order.
//  Layout  : One row per employee, with a TOTALS footer row.
// ─────────────────────────────────────────────────────────────────────────────

function generateComplianceCSV(payrollRun, companyUser) {
  return new Promise((resolve, reject) => {
    try {
      const monthDate   = moment(`${payrollRun.year}-${String(payrollRun.month).padStart(2, '0')}-01`);
      const monthName   = monthDate.format('MMMM YYYY');
      const generatedAt = moment().tz(TZ).format('DD MMMM YYYY, HH:mm');

      const totalSSC = fmt(
        (payrollRun.totalSSCEmployee || 0) + (payrollRun.totalSSCEmployer || 0)
      );
      const totalEmployerCost = fmt(
        (payrollRun.totalGrossPay    || 0) +
        (payrollRun.totalSSCEmployer || 0) +
        (payrollRun.totalECF         || 0)
      );

      // ── Metadata preamble — mirrors Compliance PDF header ─────────────────
      const meta = buildMetaBlock([
        'NamPayroll – Monthly Compliance Summary',
        DIVIDER,
        `Company                   : ${companyUser.companyName}`,
        `Reporting Period           : ${monthName}`,
        `Employees Processed        : ${payrollRun.employeeCount || payrollRun.payslips.length}`,
        DIVIDER,
        // ── Earnings summary (mirrors payslip Earnings section) ──
        `Total Gross Pay            : NAD ${fmt(payrollRun.totalGrossPay)}`,
        // ── Deductions summary (mirrors payslip Deductions section) ──
        `Total PAYE (NamRA)         : NAD ${fmt(payrollRun.totalPAYE)}`,
        `Total SSC (Emp + Employer) : NAD ${totalSSC}`,
        `Total Other Deductions     : NAD ${fmt(payrollRun.totalOtherDeductions || 0)}`,
        `Total Net Pay              : NAD ${fmt(payrollRun.totalNetPay)}`,
        // ── Employer cost summary ──
        `Total Employer Cost        : NAD ${totalEmployerCost}`,
        DIVIDER,
        `Generated                  : ${generatedAt}`,
      ]);

      // ── Columns — ordered to mirror payslip layout ────────────────────────
      // Group 1: Employee identity   (mirrors payslip EMPLOYEE panel)
      // Group 2: Earnings            (mirrors payslip Earnings section)
      // Group 3: Deductions          (mirrors payslip Deductions section)
      // Group 4: Totals
      // Group 5: Employer costs      (mirrors payslip Employer Contributions)
      // Group 6: Leave               (mirrors payslip Leave Balances section)
      const columns = [
        // Group 1 — Identity
        'No.',
        'Employee Name',
        'ID Number',
        'Position',
        'Department',
        // Group 2 — Earnings
        'Basic Salary (NAD)',
        'Overtime Hours',
        'Overtime Pay (NAD)',
        'Taxable Allowances (NAD)',
        'Non-Taxable Allowances (NAD)',
        'Gross Pay (NAD)',
        // Group 3 — Deductions
        'PAYE (NAD)',
        'SSC Employee (NAD)',
        'Other Deductions (NAD)',
        'Total Deductions (NAD)',
        // Group 4 — Net
        'Net Pay (NAD)',
        // Group 5 — Employer costs
        'SSC Employer (NAD)',
        'ECF (NAD)',
        'Total Employer Cost (NAD)',
        // Group 6 — Leave
        'Annual Leave Taken (days)',
        'Sick Leave Taken (days)',
      ];

      // ── Data rows ─────────────────────────────────────────────────────────
      const dataRows = payrollRun.payslips.map((ps, idx) => {
        const snap = ps.employeeSnapshot || {};
        return {
          // Group 1
          'No.':                          idx + 1,
          'Employee Name':                snap.fullName   || '',
          'ID Number':                    snap.idNumber   || '',
          'Position':                     snap.position   || '',
          'Department':                   snap.department || '',
          // Group 2 — Earnings
          'Basic Salary (NAD)':           fmt(ps.basicSalary),
          'Overtime Hours':               ps.overtimeHours || 0,
          'Overtime Pay (NAD)':           fmt(ps.overtimePay           || 0),
          'Taxable Allowances (NAD)':     fmt(ps.taxableAllowances     || 0),
          'Non-Taxable Allowances (NAD)': fmt(ps.nonTaxableAllowances  || 0),
          'Gross Pay (NAD)':              fmt(ps.grossPay),
          // Group 3 — Deductions
          'PAYE (NAD)':                   fmt(ps.paye),
          'SSC Employee (NAD)':           fmt(ps.sscEmployee),
          'Other Deductions (NAD)':       fmt(ps.otherDeductions       || 0),
          'Total Deductions (NAD)':       fmt(ps.totalDeductions),
          // Group 4 — Net
          'Net Pay (NAD)':                fmt(ps.netPay),
          // Group 5 — Employer costs
          'SSC Employer (NAD)':           fmt(ps.sscEmployer),
          'ECF (NAD)':                    fmt(ps.ecf),
          'Total Employer Cost (NAD)':    fmt(ps.totalEmployerCost),
          // Group 6 — Leave
          'Annual Leave Taken (days)':    fmtLeave(ps.annualLeaveTaken),
          'Sick Leave Taken (days)':      fmtLeave(ps.sickLeaveTaken),
        };
      });

      // ── Totals footer row — mirrors payslip summary rows ──────────────────
      dataRows.push({
        'No.':                          '',
        'Employee Name':                'TOTALS',
        'ID Number':                    '',
        'Position':                     '',
        'Department':                   '',
        'Basic Salary (NAD)':           '',
        'Overtime Hours':               '',
        'Overtime Pay (NAD)':           '',
        'Taxable Allowances (NAD)':     '',
        'Non-Taxable Allowances (NAD)': '',
        'Gross Pay (NAD)':              fmt(payrollRun.totalGrossPay),
        'PAYE (NAD)':                   fmt(payrollRun.totalPAYE),
        'SSC Employee (NAD)':           fmt(payrollRun.totalSSCEmployee),
        'Other Deductions (NAD)':       fmt(payrollRun.totalOtherDeductions || 0),
        'Total Deductions (NAD)':       '',
        'Net Pay (NAD)':                fmt(payrollRun.totalNetPay),
        'SSC Employer (NAD)':           fmt(payrollRun.totalSSCEmployer),
        'ECF (NAD)':                    fmt(payrollRun.totalECF),
        'Total Employer Cost (NAD)':    totalEmployerCost,
        'Annual Leave Taken (days)':    '',
        'Sick Leave Taken (days)':      '',
      });

      resolve(buildCSV(meta, dataRows, columns));
    } catch (err) { reject(err); }
  });
}

module.exports = { generateBankTransferCSV, generateComplianceCSV };