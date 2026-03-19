/**
 * Employee Model
 * Represents an employee belonging to a company (User)
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const employeeSchema = new mongoose.Schema({
  // ─── Link to company ───────────────────────────────────────────────────────
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // ─── Personal Details ──────────────────────────────────────────────────────
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  idNumber: {
    type: String,
    required: [true, 'ID number is required'],
    trim: true,
    maxlength: [20, 'ID number cannot exceed 20 characters']
  },
  phone: {
    type: String,
    trim: true,
    maxlength: [20, 'Phone cannot exceed 20 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address']
  },

  // ─── Employment Details ────────────────────────────────────────────────────
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

  // ─── Leave Balances ────────────────────────────────────────────────────────
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

  // ─── Portal Access & Verification ─────────────────────────────────────────
  portalPassword: {
    type: String,
    // Set by admin; hashed before save
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
  
  // For the "Forgot Password" flow we discussed
  resetPasswordToken: String,
  resetPasswordExpires: Date,

  // ─── Status ───────────────────────────────────────────────────────────────
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// ─── Compound index: email unique per company ─────────────────────────────────
employeeSchema.index({ company: 1, email: 1 }, { unique: true });

// ─── Hash portal password when set ───────────────────────────────────────────
employeeSchema.pre('save', async function (next) {
  // Only hash the password if it has been modified (or is new) AND it's not empty
  if (!this.isModified('portalPassword') || !this.portalPassword) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(12);
    this.portalPassword = await bcrypt.hash(this.portalPassword, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// ─── Instance method: compare portal password ────────────────────────────────
employeeSchema.methods.comparePortalPassword = async function (candidatePassword) {
  if (!this.portalPassword) return false;
  return bcrypt.compare(candidatePassword, this.portalPassword);
};

module.exports = mongoose.model('Employee', employeeSchema);