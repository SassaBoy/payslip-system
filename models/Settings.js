/**
 * models/Settings.js
 * Per-company payroll configuration + payslip design + custom pay items.
 */

const mongoose = require('mongoose');

// ── Tax bracket sub-doc ───────────────────────────────────────────────────────
const taxBracketSchema = new mongoose.Schema({
  min:         { type: Number, required: true },
  max:         { type: Number, default: null },
  baseAmount:  { type: Number, required: true },
  rate:        { type: Number, required: true },
  description: { type: String }
}, { _id: false });

// ── Payslip theme sub-doc ─────────────────────────────────────────────────────
const payslipThemeSchema = new mongoose.Schema({
  accentColor:               { type: String,  default: '#000000' },
  showEmployerContributions: { type: Boolean, default: true },
  showLeaveBalances:         { type: Boolean, default: true },
  showRefNumber:             { type: Boolean, default: true },
  footerNote:                { type: String,  default: '', maxlength: 300 }
}, { _id: false });

// ── Custom pay item sub-doc ───────────────────────────────────────────────────
/**
 * A custom earning or deduction line that the company defines once
 * and which then appears as an extra column on every payroll run.
 *
 * type:
 *   'earning_taxable'    → adds to grossPay AND taxableGross (subject to PAYE)
 *   'earning_nontaxable' → adds to grossPay only (exempt from PAYE)
 *   'deduction'          → reduces netPay (not a statutory deduction)
 *
 * inputMode:
 *   'variable'  → admin enters an amount per employee each payroll run
 *   'fixed'     → same defaultAmount applied to every employee automatically
 *                 (admin can still override per employee if needed)
 */
const customPayItemSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true, maxlength: 60 },
  type: {
    type: String,
    required: true,
    enum: ['earning_taxable', 'earning_nontaxable', 'deduction']
  },
  inputMode:    { type: String, enum: ['variable', 'fixed'], default: 'variable' },
  defaultAmount:{ type: Number, default: 0, min: 0 },
  description:  { type: String, trim: true, maxlength: 120, default: '' },
  isActive:     { type: Boolean, default: true }
}, { _id: true, timestamps: false });

// ── Main Settings schema ──────────────────────────────────────────────────────
const settingsSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },

  ecfRate:             { type: Number, default: 0.04,  min: 0, max: 1 },
  sscRate:             { type: Number, default: 0.009, min: 0, max: 1 },
  sscMonthlyCap:       { type: Number, default: 11000 },
  sscMaxContribution:  { type: Number, default: 99 },

  taxBrackets: {
    type: [taxBracketSchema],
    default: [
      { min: 0,       max: 100000,  baseAmount: 0,      rate: 0,    description: '0 – 100,000: 0%'           },
      { min: 100001,  max: 150000,  baseAmount: 0,      rate: 0.18, description: '100,001 – 150,000: 18%'    },
      { min: 150001,  max: 350000,  baseAmount: 9000,   rate: 0.25, description: '150,001 – 350,000: 25%'    },
      { min: 350001,  max: 550000,  baseAmount: 59000,  rate: 0.28, description: '350,001 – 550,000: 28%'    },
      { min: 550001,  max: 850000,  baseAmount: 115000, rate: 0.30, description: '550,001 – 850,000: 30%'    },
      { min: 850001,  max: 1550000, baseAmount: 205000, rate: 0.32, description: '850,001 – 1,550,000: 32%'  },
      { min: 1550001, max: null,    baseAmount: 429000, rate: 0.37, description: 'Above 1,550,000: 37%'      }
    ]
  },

  overtimeMultiplier:  { type: Number, default: 1.5, min: 1 },
  workingDaysPerMonth: { type: Number, default: 22,  min: 1 },

  payslipTheme: { type: payslipThemeSchema, default: () => ({}) },

  /** Company-defined custom earnings and deductions */
  customPayItems: { type: [customPayItemSchema], default: [] }

}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);