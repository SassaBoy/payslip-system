/**
 * PayrollRun Model
 * Stores the result of a monthly payroll run for a company
 */
const mongoose = require('mongoose');

// ─── Sub-document: individual employee payslip data ──────────────────────────
const payslipSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  employeeSnapshot: {
    fullName: String,
    idNumber: String,
    position: String,
    department: String,
    email: String,
    phone: String
  },

  // ─── Variable Inputs (Admin defined per month) ───────────────────────────
  overtimeHours: { type: Number, default: 0, min: 0 },
  
  // New Fields for flexibility
  taxableAllowances: { 
    type: Number, 
    default: 0, 
    min: 0,
    description: "Bonuses, commissions, taxable fringe benefits"
  },
  nonTaxableAllowances: { 
    type: Number, 
    default: 0, 
    min: 0,
    description: "Expense reimbursements, non-taxable perks" 
  },
  otherDeductions: { 
    type: Number, 
    default: 0, 
    min: 0,
    description: "Staff loans, uniform costs, union fees"
  },

  // ─── Calculated Values ────────────────────────────────────────────────────
  basicSalary: { type: Number, required: true, min: 0 },
  overtimePay: { type: Number, default: 0, min: 0 },
  
  // Total Taxable Income = Basic + Overtime + Taxable Allowances
  totalTaxableIncome: { type: Number, default: 0 }, 
  
  // Gross Pay = Basic + Overtime + Taxable Allowances + Non-Taxable Allowances
  grossPay: { type: Number, required: true, min: 0 },

  // Tax & deductions
  annualizedGross: { type: Number, default: 0 },
  paye: { type: Number, default: 0, min: 0 },

  // Social Security Contributions
  sscEmployee: { type: Number, default: 0, min: 0 },
  sscEmployer: { type: Number, default: 0, min: 0 },
  ecf: { type: Number, default: 0, min: 0 },

  // ─── Totals ───────────────────────────────────────────────────────────────
  // totalDeductions = PAYE + sscEmployee + otherDeductions
  totalDeductions: { type: Number, default: 0, min: 0 }, 
  netPay: { type: Number, required: true, min: 0 },

  // Total employer cost = (Gross Pay - Non-Taxable) + sscEmployer + ecf
  totalEmployerCost: { type: Number, default: 0, min: 0 }
}, { _id: true });

// ─── Main PayrollRun document ─────────────────────────────────────────────────
const payrollRunSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  month: { type: Number, required: true, min: 1, max: 12 },
  year: { type: Number, required: true, min: 2020 },
  status: {
    type: String,
    enum: ['draft', 'finalised'],
    default: 'finalised'
  },

  // ─── Summary totals ───────────────────────────────────────────────────────
  totalGrossPay: { type: Number, default: 0 },
  totalNetPay: { type: Number, default: 0 },
  totalPAYE: { type: Number, default: 0 },
  totalSSCEmployee: { type: Number, default: 0 },
  totalSSCEmployer: { type: Number, default: 0 },
  totalECF: { type: Number, default: 0 },
  totalOtherDeductions: { type: Number, default: 0 }, // Summary of manual deductions
  totalEmployerCost: { type: Number, default: 0 },
  employeeCount: { type: Number, default: 0 },

  payslips: [payslipSchema],

  settingsSnapshot: {
    ecfRate: Number,
    sscRate: Number,
    sscCap: Number,
    taxBrackets: mongoose.Schema.Types.Mixed
  },

  processedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

payrollRunSchema.index({ company: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('PayrollRun', payrollRunSchema);