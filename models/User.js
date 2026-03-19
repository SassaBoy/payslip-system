/**
 * User (Company Admin) Model
 * Represents a company that has registered on NamPayroll
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
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
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters']
  },
  companyLogo: {
    type: String,
    default: null
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  verificationToken: {
    type: String
  },
  // --- Password Reset Fields ---
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  
  role: {
    type: String,
    default: 'admin',
    enum: ['admin']
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);