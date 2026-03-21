/**
 * Employee Model
 * Namibia-compliant — covers all fields required for:
 *   • NamRA ETX / PAYE4 annual reconciliation
 *   • Social Security Commission Form 10(a)
 *   • Standard payroll processing
 */

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const employeeSchema = new mongoose.Schema({

  // ─── Link to company ──────────────────────────────────────────────────────
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // ─── Personal Details ─────────────────────────────────────────────────────
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },

  /**
   * Namibian ID — 11 digits, format: YYMMDDSSSSQ
   *   YY   = year of birth
   *   MM   = month of birth
   *   DD   = day of birth
   *   SSSS = sequence number
   *   Q    = gender/citizenship digit
   */
  idNumber: {
    type: String,
    required: [true, 'Namibian ID number is required'],
    trim: true,
    match: [/^\d{11}$/, 'Namibian ID number must be exactly 11 digits']
  },

  /**
   * NamRA Taxpayer Identification Number (TIN) — required for ETX/PAYE4.
   * 10-digit number issued by NamRA.
   */
  tinNumber: {
    type: String,
    trim: true,
    match: [/^\d{10}$/, 'TIN must be exactly 10 digits']
  },

  /**
   * Social Security Commission registration number — required for Form 10(a).
   * Format used by SSC: typically numeric, up to 15 chars.
   */
  socialSecurityNumber: {
    type: String,
    trim: true,
    maxlength: [20, 'SSC number cannot exceed 20 characters']
  },

  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },

  /**
   * Namibian mobile numbers: +264 followed by 8 or 9 digits (no leading zero).
   * Common prefixes: 81, 85 (MTC), 60, 61 (TN Mobile).
   * Stored with +264 prefix — validated server-side.
   */
  phone: {
    type: String,
    trim: true,
    maxlength: [20, 'Phone cannot exceed 20 characters']
  },

  // ─── Employment Details ───────────────────────────────────────────────────
  position: {
    type: String,
    trim: true,
    maxlength: [100, 'Position cannot exceed 100 characters']
  },
  department: {
    type: String,
    trim: true,
    maxlength: [100, 'Department cannot exceed 100 characters']
  },
  basicSalary: {
    type: Number,
    required: [true, 'Basic monthly salary is required'],
    min: [0, 'Salary cannot be negative']
  },
  dateJoined: {
    type: Date,
    required: [true, 'Date joined is required']
  },

  // ─── Tax & Remuneration details (NamRA ETX / PAYE4) ──────────────────────

  /** Pension fund name — required for PAYE4 reconciliation */
  pensionFundName: {
    type: String,
    trim: true,
    maxlength: [100, 'Pension fund name cannot exceed 100 characters']
  },
  /** Pension fund registration number */
  pensionFundRegNo: {
    type: String,
    trim: true,
    maxlength: [50, 'Fund registration number cannot exceed 50 characters']
  },
  /** Employee's monthly pension contribution (NAD) */
  pensionContribution: {
    type: Number,
    default: 0,
    min: 0
  },

  /** Medical aid fund name */
  medicalAidFundName: {
    type: String,
    trim: true,
    maxlength: [100, 'Medical aid fund name cannot exceed 100 characters']
  },
  /** Medical aid member/policy number */
  medicalAidMemberNo: {
    type: String,
    trim: true,
    maxlength: [50, 'Medical aid number cannot exceed 50 characters']
  },
  /** Employee's monthly medical aid contribution (NAD) */
  medicalAidContribution: {
    type: Number,
    default: 0,
    min: 0
  },

  /**
   * Company vehicle — used for fringe benefit calculation on PAYE4.
   * true = employee has a company vehicle.
   */
  hasCompanyVehicle: {
    type: Boolean,
    default: false
  },

  /**
   * Company housing type — fringe benefit for PAYE4.
   * Values: 'none' | 'free' | 'subsidised'
   */
  housingType: {
    type: String,
    enum: ['none', 'free', 'subsidised'],
    default: 'none'
  },

  // ─── Leave Balances ───────────────────────────────────────────────────────
  annualLeaveBalance: {
    type: Number,
    default: 24,
    min: 0
  },
  sickLeaveBalance: {
    type: Number,
    default: 30,
    min: 0
  },

  // ─── Banking Details (for net pay transfer) ───────────────────────────────
  bankName: {
    type: String,
    trim: true,
    maxlength: [80, 'Bank name cannot exceed 80 characters']
  },
  bankAccountNumber: {
    type: String,
    trim: true,
    maxlength: [30, 'Account number cannot exceed 30 characters']
  },
  bankBranchCode: {
    type: String,
    trim: true,
    maxlength: [10, 'Branch code cannot exceed 10 characters']
  },
  accountType: {
    type: String,
    enum: ['cheque', 'savings', 'transmission', ''],
    default: ''
  },

  // ─── Portal Access & Verification ─────────────────────────────────────────
  portalPassword: {
    type: String
  },
  portalEnabled: {
    type: Boolean,
    default: false
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  verificationToken: String,
  resetPasswordToken: String,
  resetPasswordExpires: Date,

  // ─── Status ───────────────────────────────────────────────────────────────
  isActive: {
    type: Boolean,
    default: true
  }

}, { timestamps: true });

// ─── Indexes ──────────────────────────────────────────────────────────────────
employeeSchema.index({ company: 1, email: 1 },    { unique: true });
employeeSchema.index({ company: 1, idNumber: 1 }, { unique: true });

// ─── Hash portal password on change ──────────────────────────────────────────
employeeSchema.pre('save', async function (next) {
  if (!this.isModified('portalPassword') || !this.portalPassword) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.portalPassword = await bcrypt.hash(this.portalPassword, salt);
    next();
  } catch (err) {
    next(err);
  }
});

employeeSchema.methods.comparePortalPassword = async function (candidate) {
  if (!this.portalPassword) return false;
  return bcrypt.compare(candidate, this.portalPassword);
};

module.exports = mongoose.model('Employee', employeeSchema);