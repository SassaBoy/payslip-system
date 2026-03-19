const { validationResult } = require('express-validator');
const User = require('../models/User');
const Settings = require('../models/Settings');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// GET /register
exports.getRegister = (req, res) => {
  res.render('auth/register', { 
    title: 'Register – NamPayroll', 
    errors: [], 
    formData: {} 
  });
};

// POST /register
exports.postRegister = async (req, res) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.render('auth/register', {
      title: 'Register – NamPayroll',
      errors: errors.array(),
      formData: req.body
    });
  }

  try {
    const { firstName, lastName, companyName, numEmployees, email, phone, password } = req.body;

    // Check if email already exists
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.render('auth/register', {
        title: 'Register – NamPayroll',
        errors: [{ msg: 'An account with that email already exists.' }],
        formData: req.body
      });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Create user - Mapping firstName/lastName to ownerName to match Schema
    const user = await User.create({
      ownerName: `${firstName.trim()} ${lastName.trim()}`,
      companyName: companyName.trim(),
      numEmployees,
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      password,
      companyLogo: req.file ? `/uploads/logos/${req.file.filename}` : null,
      verificationToken,
      emailVerified: false
    });

    // Create default settings
    await Settings.create({ company: user._id });

    // Send verification email
    const verifyUrl = `${req.protocol}://${req.get('host')}/verify-email?token=${verificationToken}`;

    await transporter.sendMail({
      from: `"NamPayroll" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Welcome to NamPayroll – Verify your email',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; border: 1px solid #eee; padding: 20px;">
          <h2 style="color: #f5a623;">Welcome, ${firstName}!</h2>
          <p>Your company <strong>${companyName}</strong> account has been created successfully.</p>
          <p>Please verify your email by clicking the button below:</p>
          <div style="margin: 30px 0;">
            <a href="${verifyUrl}" style="background:#f5a623;color:#1a0e00;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:700;display:inline-block;">Verify Email</a>
          </div>
          <p style="font-size: 0.9rem; color: #666;">
            After verification you can log in and use the <strong>free trial</strong> (up to 5 payslips).<br>
            For full access, please contact our support team.
          </p>
          <p>Thank you for choosing NamPayroll!</p>
        </div>
      `
    });

    req.flash('success', `Account created! Check ${email} to verify your account.`);
    res.redirect('/login');

  } catch (err) {
    console.error('Register error:', err);
    res.render('auth/register', {
      title: 'Register – NamPayroll',
      errors: [{ msg: 'Registration failed. Please try again later.' }],
      formData: req.body
    });
  }
};

// GET /login
exports.getLogin = (req, res) => {
  res.render('auth/login', { 
    title: 'Login – NamPayroll', 
    errors: [], 
    formData: {} 
  });
};

// POST /login
exports.postLogin = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('auth/login', {
      title: 'Login – NamPayroll',
      errors: errors.array(),
      formData: req.body
    });
  }

  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user || !(await user.comparePassword(password))) {
      return res.render('auth/login', {
        title: 'Login – NamPayroll',
        errors: [{ msg: 'Invalid email or password.' }],
        formData: req.body
      });
    }

    if (!user.emailVerified) {
      return res.render('auth/login', {
        title: 'Login – NamPayroll',
        errors: [{ msg: 'Please verify your email address before logging in.' }],
        formData: req.body
      });
    }

    // Set session user
    req.session.user = { 
      _id: user._id, 
      companyName: user.companyName, 
      email: user.email, 
      ownerName: user.ownerName 
    };

    req.flash('success', `Welcome back, ${user.ownerName.split(' ')[0]}!`);
    res.redirect('/dashboard');

  } catch (err) {
    console.error('Login error:', err);
    res.render('auth/login', {
      title: 'Login – NamPayroll',
      errors: [{ msg: 'Login failed. Please try again.' }],
      formData: req.body
    });
  }
};

// GET /verify-email
exports.verifyEmail = async (req, res) => {
  const { token } = req.query;

  if (!token) {
    req.flash('error', 'Invalid verification link.');
    return res.redirect('/login');
  }

  try {
    const user = await User.findOne({ verificationToken: token });

    if (!user) {
      req.flash('error', 'Invalid or expired verification link.');
      return res.redirect('/login');
    }

    user.emailVerified = true;
    user.verificationToken = undefined;
    await user.save();

    req.flash('success', 'Email verified successfully! You can now log in.');
    res.redirect('/login');
  } catch (err) {
    console.error('Verification error:', err);
    res.redirect('/login');
  }
};

// POST /logout
exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid'); // Clears session cookie
    res.redirect('/login');
  });
};

// GET /forgot-password
exports.getForgotPassword = (req, res) => {
  res.render('auth/forgot-password', { title: 'Forgot Password – NamPayroll' });
};
// POST /forgot-password
exports.postForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      req.flash('error', 'No account with that email address exists.');
      return res.redirect('/forgot-password');
    }

    const token = crypto.randomBytes(20).toString('hex');
    
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000; 

    // FIX: Bypass full validation because we are only setting the token
    await user.save({ validateBeforeSave: false }); 

    const resetUrl = `${req.protocol}://${req.get('host')}/reset-password/${token}`;

    await transporter.sendMail({
      from: `"NamPayroll Support" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'NamPayroll Password Reset',
      html: `
        <h3>Password Reset Request</h3>
        <p>You requested a password reset for your NamPayroll account.</p>
        <p>Please click the link below to set a new password (expires in 1 hour):</p>
        <a href="${resetUrl}" style="background:#f5a623;color:#fff;padding:12px 20px;text-decoration:none;border-radius:5px;display:inline-block;font-weight:bold;">Reset My Password</a>
      `
    });

    req.flash('success', `A reset link has been sent to ${user.email}`);
    res.redirect('/forgot-password');
  } catch (err) {
    console.error('Forgot Password Error:', err);
    req.flash('error', 'Something went wrong. Please try again.');
    res.redirect('/forgot-password');
  }
};
// GET /reset-password/:token
exports.getResetPassword = async (req, res) => {
  const user = await User.findOne({
    resetPasswordToken: req.params.token,
    resetPasswordExpires: { $gt: Date.now() }
  });

  if (!user) {
    req.flash('error', 'Password reset token is invalid or has expired.');
    return res.redirect('/forgot-password');
  }
  res.render('auth/reset-password', { title: 'Reset Password', token: req.params.token });
};

// POST /reset-password/:token
exports.postResetPassword = async (req, res) => {
  try {
    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      req.flash('error', 'Password reset token is invalid or has expired.');
      return res.redirect('/forgot-password');
    }

    if (req.body.password !== req.body.confirmPassword) {
        req.flash('error', 'Passwords do not match.');
        return res.redirect('back');
    }

    user.password = req.body.password; 
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    // FIX: Bypass full validation so it doesn't ask for numEmployees again
    await user.save({ validateBeforeSave: false });

    req.flash('success', 'Success! Your password has been changed.');
    res.redirect('/login');
  } catch (err) {
    console.error('Reset Password Error:', err);
    res.redirect('/forgot-password');
  }
};