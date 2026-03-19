/**
 * payrollCalculator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Core Namibian payroll calculation engine.
 * Updated for 2026: Supports dynamic Allowances and Manual Deductions.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Calculate annual PAYE using Namibia 2026 tax brackets.
 */
function calculateAnnualPAYE(annualIncome, taxBrackets) {
  if (annualIncome <= 50000) return 0; // Standard Namibian tax-free threshold

  const sorted = [...taxBrackets].sort((a, b) => a.min - b.min);

  for (const bracket of sorted) {
    const upperBound = bracket.max === null ? Infinity : bracket.max;
    if (annualIncome <= upperBound) {
      // Tax = baseAmount + rate * (income - (bracket.min - 1))
      const excess = Math.max(0, annualIncome - (bracket.min - 1));
      const tax = bracket.baseAmount + (excess * bracket.rate);
      return Math.round(tax * 100) / 100;
    }
  }

  const top = sorted[sorted.length - 1];
  const excess = Math.max(0, annualIncome - (top.min - 1));
  return Math.round((top.baseAmount + excess * top.rate) * 100) / 100;
}

/**
 * Calculate monthly PAYE by annualizing the TAXABLE monthly gross.
 */
function calculateMonthlyPAYE(taxableMonthlyGross, taxBrackets) {
  const annualizedGross = taxableMonthlyGross * 12;
  const annualTax = calculateAnnualPAYE(annualizedGross, taxBrackets);
  const monthlyPAYE = Math.round((annualTax / 12) * 100) / 100;
  return { monthlyPAYE, annualizedGross, annualTax };
}

/**
 * Calculate SSC. 
 * Note: In Namibia, SSC is usually calculated on the total of (Basic + Taxable Allowances).
 */
function calculateSSC(baseForSSC, sscRate = 0.009, sscMonthlyCap = 11000, sscMaxContrib = 99) {
  const assessableSalary = Math.min(baseForSSC, sscMonthlyCap);
  const rawSSC = assessableSalary * sscRate;
  const cappedSSC = Math.min(rawSSC, sscMaxContrib);
  const rounded = Math.round(cappedSSC * 100) / 100;
  return {
    sscEmployee: rounded,
    sscEmployer: rounded
  };
}

function calculateECF(basicSalary, ecfRate = 0.04) {
  return Math.round(basicSalary * ecfRate * 100) / 100;
}

function calculateOvertimePay(basicSalary, overtimeHours, workingDaysPerMonth = 22, overtimeMultiplier = 1.5) {
  if (!overtimeHours || overtimeHours <= 0) return 0;
  const hourlyRate = basicSalary / (workingDaysPerMonth * 8);
  const overtimePay = hourlyRate * overtimeHours * overtimeMultiplier;
  return Math.round(overtimePay * 100) / 100;
}

/**
 * Main function: calculate full payroll for a single employee.
 */
function calculateEmployeePayroll(employee, inputs, settings) {
  const {
    overtimeHours = 0,
    taxableAllowances = 0,    // New: Performance bonuses, etc.
    nonTaxableAllowances = 0, // New: Reimbursements, etc.
    otherDeductions = 0,      // New: Staff loans, etc.
    annualLeaveTaken = 0,
    sickLeaveTaken = 0
  } = inputs;

  const {
    ecfRate = 0.04,
    sscRate = 0.009,
    sscMonthlyCap = 11000,
    sscMaxContribution = 99,
    taxBrackets,
    overtimeMultiplier = 1.5,
    workingDaysPerMonth = 22
  } = settings;

  const basicSalary = employee.basicSalary;

  // 1. Overtime Pay
  const overtimePay = calculateOvertimePay(basicSalary, overtimeHours, workingDaysPerMonth, overtimeMultiplier);

  // 2. Calculate the Tax Base (Only basic, overtime, and taxable allowances)
  const taxableGross = Math.round((basicSalary + overtimePay + taxableAllowances) * 100) / 100;

  // 3. PAYE (Calculated on Taxable Gross)
  const { monthlyPAYE, annualizedGross, annualTax } = calculateMonthlyPAYE(taxableGross, taxBrackets);

  // 4. Social Security (Calculated on Taxable Gross)
  const { sscEmployee, sscEmployer } = calculateSSC(taxableGross, sscRate, sscMonthlyCap, sscMaxContribution);

  // 5. ECF (Employer only - usually on basic)
  const ecf = calculateECF(basicSalary, ecfRate);

  // 6. Final Gross Pay (Total money before deductions, including non-taxable perks)
  const totalGrossPay = Math.round((taxableGross + nonTaxableAllowances) * 100) / 100;

  // 7. Deductions
  const totalDeductions = Math.round((monthlyPAYE + sscEmployee + otherDeductions) * 100) / 100;

  // 8. Net Pay
  const netPay = Math.round((totalGrossPay - totalDeductions) * 100) / 100;

  // 9. Total Employer Cost (Gross + Employer SSC + Employer ECF)
  const totalEmployerCost = Math.round((totalGrossPay + sscEmployer + ecf) * 100) / 100;

  return {
    ...inputs,
    basicSalary,
    overtimePay,
    taxableAllowances,
    nonTaxableAllowances,
    otherDeductions,
    grossPay: totalGrossPay,
    taxableGross, // Added for transparency in reports
    annualizedGross,
    annualTax,
    paye: monthlyPAYE,
    sscEmployee,
    sscEmployer,
    ecf,
    totalDeductions,
    netPay,
    totalEmployerCost
  };
}

/**
 * Calculate summary totals.
 */
function calculatePayrollSummary(payslips) {
  return payslips.reduce((totals, p) => {
    totals.totalGrossPay      += p.grossPay;
    totals.totalNetPay        += p.netPay;
    totals.totalPAYE           += p.paye;
    totals.totalSSCEmployee    += p.sscEmployee;
    totals.totalSSCEmployer    += p.sscEmployer;
    totals.totalECF            += p.ecf;
    totals.totalOtherDeductions += (p.otherDeductions || 0);
    totals.totalEmployerCost  += p.totalEmployerCost;
    return totals;
  }, {
    totalGrossPay: 0,
    totalNetPay: 0,
    totalPAYE: 0,
    totalSSCEmployee: 0,
    totalSSCEmployer: 0,
    totalECF: 0,
    totalOtherDeductions: 0,
    totalEmployerCost: 0,
    employeeCount: payslips.length
  });
}

function formatNAD(amount) {
  if (isNaN(amount) || amount === null || amount === undefined) return 'N$ 0.00';
  return 'N$ ' + Number(amount).toLocaleString('en-NA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

module.exports = {
  calculateAnnualPAYE,
  calculateMonthlyPAYE,
  calculateSSC,
  calculateECF,
  calculateOvertimePay,
  calculateEmployeePayroll,
  calculatePayrollSummary,
  formatNAD
};