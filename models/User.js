/**
 * models/User.js
 * Represents a company (employer) registered on NamPayroll.
 * Fields cover every detail required for:
 *   - SSC Form 10(a)  : companyName, sscNumber, postalAddress, email
 *   - NamRA ETX/PAYE4 : tinNumber, payeRegNo
 *   - PAYE5 / ITA5    : companyName, tinNumber, payeRegNo
 *   - Bank transfer CSV: bankName, bankAccountNumber, bankBranchCode
 *   - Compliance PDF  : companyName, postalAddress, email
 */

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({

  // ─── Basic identity ────────────────────────────────────────────────────────
  companyName: {
    type: String,
    required: [true, 'Company name is required'],
    trim: true,
    maxlength: [100, 'Company name cannot exceed 100 characters']
  },
  ownerName: {
    type: String,
    required: [true, 'Owner name is required'],
    trim: true,
    maxlength: [100, 'Owner name cannot exceed 100 characters']
  },
  numEmployees: {
    type: String,
    required: [true, 'Number of employees is required']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    maxlength: [20, 'Phone number cannot exceed 20 characters']
  },

  // ─── Address ───────────────────────────────────────────────────────────────
  /** Physical / street address — used on letterheads and compliance reports */
  physicalAddress: {
    type: String,
    trim: true,
    maxlength: [200, 'Physical address cannot exceed 200 characters']
  },
  /**
   * Postal address — required on SSC Form 10(a) field 3.
   * Often a P.O. Box or Private Bag.
   */
  postalAddress: {
    type: String,
    trim: true,
    maxlength: [200, 'Postal address cannot exceed 200 characters']
  },

  // ─── Statutory registration numbers ───────────────────────────────────────
  /**
   * NamRA Taxpayer Identification Number (TIN).
   * 10 digits. Required on ETX/PAYE4 and PAYE5 as "Employer TIN".
   */
  tinNumber: {
    type: String,
    trim: true,
    match: [/^\d{10}$/, 'TIN must be exactly 10 digits']
  },
  /**
   * NamRA PAYE Employer Registration Number.
   * Issued separately from the TIN for payroll tax purposes.
   * Required on PAYE5 / ITA5 certificates.
   */
  payeRegNo: {
    type: String,
    trim: true,
    maxlength: [30, 'PAYE registration number cannot exceed 30 characters']
  },
  /**
   * Social Security Commission employer registration number.
   * Required on SSC Form 10(a) field 2.
   */
  sscNumber: {
    type: String,
    trim: true,
    maxlength: [30, 'SSC registration number cannot exceed 30 characters']
  },

  // ─── Banking details ───────────────────────────────────────────────────────
  /** Bank name — for bank transfer CSV header and audit trail */
  bankName: {
    type: String,
    trim: true,
    maxlength: [80, 'Bank name cannot exceed 80 characters']
  },
  /** Company's bank account number for EFT payroll disbursement */
  bankAccountNumber: {
    type: String,
    trim: true,
    maxlength: [30, 'Account number cannot exceed 30 characters']
  },
  /** Branch / sort code */
  bankBranchCode: {
    type: String,
    trim: true,
    maxlength: [10, 'Branch code cannot exceed 10 characters']
  },

  // ─── Branding ──────────────────────────────────────────────────────────────
  companyLogo: {
    type: String,
    default: null
  },

  // ─── Auth ──────────────────────────────────────────────────────────────────
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters']
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  verificationToken:    String,
  resetPasswordToken:   String,
  resetPasswordExpires: Date,

  role: {
    type: String,
    default: 'admin',
    enum: ['admin']
  }

}, { timestamps: true });

// ─── Hash password ─────────────────────────────────────────────────────────────
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) { next(err); }
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);