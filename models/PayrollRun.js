/**
 * models/PayrollRun.js
 * Stores the result of a monthly payroll run for a company.
 * customItems on each payslip holds the per-employee values for any
 * custom earnings/deductions the company has configured in Settings.
 */

const mongoose = require('mongoose');

// ── Custom item value (stored per payslip) ────────────────────────────────────
// Mirrors the Settings.customPayItems definition at the time of the run.
const customItemValueSchema = new mongoose.Schema({
  itemId:   { type: mongoose.Schema.Types.ObjectId, required: true }, // ref to Settings.customPayItems._id
  name:     { type: String, required: true },
  type:     { type: String, enum: ['earning_taxable', 'earning_nontaxable', 'deduction'], required: true },
  amount:   { type: Number, default: 0, min: 0 }
}, { _id: false });

// ── Payslip sub-document ──────────────────────────────────────────────────────
const payslipSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  employeeSnapshot: {
    fullName:   String,
    idNumber:   String,
    tinNumber:  String,
    sscNumber:  String,
    position:   String,
    department: String,
    email:      String,
    phone:      String,
    bankAccountNumber: String,
    branchCode: String,
    accountType: String
  },

  // ── Variable inputs (admin-entered per month) ─────────────────────────────
  overtimeHours:        { type: Number, default: 0, min: 0 },
  taxableAllowances:    { type: Number, default: 0, min: 0 }, // legacy single bucket
  nonTaxableAllowances: { type: Number, default: 0, min: 0 }, // legacy single bucket
  otherDeductions:      { type: Number, default: 0, min: 0 }, // legacy single bucket

  // ── Custom line items (company-defined) ───────────────────────────────────
  // Amounts from all custom earning_taxable items are summed into taxableAllowances
  // for PAYE calculation. Non-taxable items → nonTaxableAllowances.
  // Deduction items → otherDeductions. They are ALSO stored individually here
  // so payslips can show each one as a separate named line.
  customItems: { type: [customItemValueSchema], default: [] },

  // ── Leave ─────────────────────────────────────────────────────────────────
  annualLeaveTaken: { type: Number, default: 0, min: 0 },
  sickLeaveTaken:   { type: Number, default: 0, min: 0 },

  // ── Calculated values ─────────────────────────────────────────────────────
  basicSalary:        { type: Number, required: true, min: 0 },
  overtimePay:        { type: Number, default: 0, min: 0 },
  totalTaxableIncome: { type: Number, default: 0 },
  grossPay:           { type: Number, required: true, min: 0 },
  taxableGross:       { type: Number, default: 0 },
  annualizedGross:    { type: Number, default: 0 },
  paye:               { type: Number, default: 0, min: 0 },
  sscEmployee:        { type: Number, default: 0, min: 0 },
  sscEmployer:        { type: Number, default: 0, min: 0 },
  ecf:                { type: Number, default: 0, min: 0 },
  totalDeductions:    { type: Number, default: 0, min: 0 },
  netPay:             { type: Number, required: true, min: 0 },
  totalEmployerCost:  { type: Number, default: 0, min: 0 }

}, { _id: true });

// ── PayrollRun root document ──────────────────────────────────────────────────
const payrollRunSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  month:  { type: Number, required: true, min: 1, max: 12 },
  year:   { type: Number, required: true, min: 2020 },
  status: { type: String, enum: ['draft', 'finalised'], default: 'finalised' },

  totalGrossPay:        { type: Number, default: 0 },
  totalNetPay:          { type: Number, default: 0 },
  totalPAYE:            { type: Number, default: 0 },
  totalSSCEmployee:     { type: Number, default: 0 },
  totalSSCEmployer:     { type: Number, default: 0 },
  totalECF:             { type: Number, default: 0 },
  totalOtherDeductions: { type: Number, default: 0 },
  totalEmployerCost:    { type: Number, default: 0 },
  employeeCount:        { type: Number, default: 0 },

  payslips: [payslipSchema],

  settingsSnapshot: {
    ecfRate:     Number,
    sscRate:     Number,
    sscCap:      Number,
    taxBrackets: mongoose.Schema.Types.Mixed
  },

  processedAt: { type: Date, default: Date.now }
}, { timestamps: true });

payrollRunSchema.index({ company: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('PayrollRun', payrollRunSchema);