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

// ─────────────────────────────────────────────
// HELPER: Send email with a timeout (non-blocking)
// Fires and forgets — will never stall the HTTP response.
// ─────────────────────────────────────────────
function sendMailWithTimeout(mailOptions, timeoutMs = 8000) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Email send timeout')), timeoutMs)
  );
  return Promise.race([transporter.sendMail(mailOptions), timeoutPromise])
    .catch(err => console.error('Background email error:', err.message));
}

// ─────────────────────────────────────────────
// SHARED EMAIL STYLES
// One source of truth for the premium dark email template.
// ─────────────────────────────────────────────
const emailStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=DM+Sans:wght@400;500&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background-color: #06111c;
    font-family: 'DM Sans', Arial, sans-serif;
    color: rgba(255,255,255,0.82);
    -webkit-font-smoothing: antialiased;
  }

  .wrapper {
    max-width: 620px;
    margin: 40px auto;
    background: #0d1b2a;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 18px;
    overflow: hidden;
  }

  /* Header bar */
  .header {
    background: linear-gradient(135deg, #112235 0%, #0d1b2a 100%);
    border-bottom: 1px solid rgba(245,166,35,0.18);
    padding: 32px 40px 28px;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .header-logo-wrap {
    width: 46px;
    height: 46px;
    background: #f5a623;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .header-logo-wrap svg { display: block; }
  .header-brand { font-family: 'Sora', Arial, sans-serif; font-size: 1.25rem; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
  .header-tagline { font-size: 0.75rem; color: rgba(255,255,255,0.35); margin-top: 2px; letter-spacing: 0.04em; text-transform: uppercase; }

  /* Body */
  .body { padding: 36px 40px 32px; }
  .greeting { font-family: 'Sora', Arial, sans-serif; font-size: 1.3rem; font-weight: 700; color: #fff; margin-bottom: 12px; letter-spacing: -0.02em; }
  .body p { font-size: 0.9rem; line-height: 1.7; color: rgba(255,255,255,0.6); margin-bottom: 14px; }

  /* CTA button */
  .cta-wrap { margin: 28px 0; }
  .cta-btn {
    display: inline-block;
    background: #f5a623;
    color: #1a0e00 !important;
    font-family: 'Sora', Arial, sans-serif;
    font-size: 0.9rem;
    font-weight: 700;
    padding: 14px 32px;
    border-radius: 10px;
    text-decoration: none;
    letter-spacing: 0.01em;
  }

  /* Info card */
  .info-card {
    background: #112235;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 10px;
    padding: 16px 20px;
    margin: 20px 0;
  }
  .info-card-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
  .info-card-row:last-child { border-bottom: none; }
  .info-label { font-size: 0.75rem; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.04em; min-width: 120px; }
  .info-value { font-size: 0.875rem; color: rgba(255,255,255,0.82); font-weight: 500; }

  /* Divider */
  .divider { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 24px 0; }

  /* URL fallback */
  .url-fallback { font-size: 0.75rem; color: rgba(255,255,255,0.25); word-break: break-all; }
  .url-fallback a { color: rgba(245,166,35,0.6); text-decoration: none; }

  /* Expiry badge */
  .expiry-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(245,166,35,0.08);
    border: 1px solid rgba(245,166,35,0.2);
    color: #f5a623;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 5px 12px;
    border-radius: 20px;
    margin-bottom: 20px;
  }

  /* Footer */
  .footer {
    background: #071421;
    border-top: 1px solid rgba(255,255,255,0.06);
    padding: 22px 40px;
    text-align: center;
  }
  .footer p { font-size: 0.75rem; color: rgba(255,255,255,0.2); line-height: 1.6; }
  .footer a { color: rgba(245,166,35,0.5); text-decoration: none; }
  .footer .separator { display: inline-block; margin: 0 8px; color: rgba(255,255,255,0.1); }
`;

// ─────────────────────────────────────────────
// EMAIL BUILDER: Verification Email
// ─────────────────────────────────────────────
function buildVerificationEmail({ to, firstName, companyName, verifyUrl }) {
  const logoSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L3 7V12C3 16.55 6.84 20.74 12 22C17.16 20.74 21 16.55 21 12V7L12 2Z" fill="#1a0e00"/><path d="M9 12L11 14L15 10" stroke="#1a0e00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  return {
    from: `"NamPayroll" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Verify your NamPayroll account`,
    html: `
      <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
      <title>Verify your email – NamPayroll</title>
      <style>${emailStyles}</style></head>
      <body>
        <div class="wrapper">
          <div class="header">
            <div class="header-logo-wrap">${logoSvg}</div>
            <div>
              <div class="header-brand">NamPayroll</div>
              <div class="header-tagline">Namibian Payroll Platform</div>
            </div>
          </div>

          <div class="body">
            <h2 class="greeting">Welcome, ${firstName}! 👋</h2>
            <p>Your <strong style="color:#fff;">${companyName}</strong> account has been created successfully on NamPayroll. You're one step away from managing your payroll with ease.</p>
            <p>Please verify your email address to activate your account:</p>

            <div class="cta-wrap">
              <a href="${verifyUrl}" class="cta-btn">✓ &nbsp;Verify My Email Address</a>
            </div>

            <div class="info-card">
              <div class="info-card-row">
                <span class="info-label">Company</span>
                <span class="info-value">${companyName}</span>
              </div>
              <div class="info-card-row">
                <span class="info-label">Email</span>
                <span class="info-value">${to}</span>
              </div>
              <div class="info-card-row">
                <span class="info-label">Free Trial</span>
                <span class="info-value">Up to 5 payslips included</span>
              </div>
            </div>

            <hr class="divider" />

            <p>If the button above doesn't work, copy and paste this link into your browser:</p>
            <p class="url-fallback"><a href="${verifyUrl}">${verifyUrl}</a></p>

            <hr class="divider" />

            <p style="font-size:0.8rem; color:rgba(255,255,255,0.3);">Didn't create this account? You can safely ignore this email.</p>
          </div>

          <div class="footer">
            <p>© ${new Date().getFullYear()} NamPayroll · All rights reserved</p>
            <p style="margin-top:6px;"><a href="#">Privacy Policy</a><span class="separator">·</span><a href="#">Terms of Service</a><span class="separator">·</span><a href="#">Support</a></p>
          </div>
        </div>
      </body></html>
    `
  };
}

// ─────────────────────────────────────────────
// EMAIL BUILDER: Password Reset Email
// ─────────────────────────────────────────────
function buildPasswordResetEmail({ to, resetUrl }) {
  const logoSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L3 7V12C3 16.55 6.84 20.74 12 22C17.16 20.74 21 16.55 21 12V7L12 2Z" fill="#1a0e00"/><path d="M9 12L11 14L15 10" stroke="#1a0e00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  return {
    from: `"NamPayroll Support" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Reset your NamPayroll password`,
    html: `
      <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
      <title>Password Reset – NamPayroll</title>
      <style>${emailStyles}</style></head>
      <body>
        <div class="wrapper">
          <div class="header">
            <div class="header-logo-wrap">${logoSvg}</div>
            <div>
              <div class="header-brand">NamPayroll</div>
              <div class="header-tagline">Namibian Payroll Platform</div>
            </div>
          </div>

          <div class="body">
            <h2 class="greeting">Password Reset Request</h2>
            <p>We received a request to reset the password associated with this email address. If you made this request, click the button below to choose a new password.</p>

            <div class="expiry-badge">
              ⏱ &nbsp;This link expires in 1 hour
            </div>

            <div class="cta-wrap">
              <a href="${resetUrl}" class="cta-btn">🔐 &nbsp;Reset My Password</a>
            </div>

            <hr class="divider" />

            <p>If the button above doesn't work, copy and paste this link into your browser:</p>
            <p class="url-fallback"><a href="${resetUrl}">${resetUrl}</a></p>

            <hr class="divider" />

            <p style="font-size:0.8rem; color:rgba(255,255,255,0.3);">If you did not request a password reset, you can safely ignore this email. Your password will not be changed.</p>
          </div>

          <div class="footer">
            <p>© ${new Date().getFullYear()} NamPayroll · All rights reserved</p>
            <p style="margin-top:6px;"><a href="#">Privacy Policy</a><span class="separator">·</span><a href="#">Terms of Service</a><span class="separator">·</span><a href="#">Support</a></p>
          </div>
        </div>
      </body></html>
    `
  };
}

// GET /register
exports.getRegister = (req, res) => {
  res.render('auth/register', {
    title: 'Register – NamPayroll',
    errors: [],
    formData: {}
  });
};
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
    const {
      firstName, lastName, companyName, numEmployees, email, phone,
      physicalAddress, postalAddress,
      tinNumber, payeRegNo, sscNumber,
      bankName, bankAccountNumber, bankBranchCode,
      password
    } = req.body;
 
    // Check if email already exists
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      if (!existing.emailVerified) {
        const newToken = crypto.randomBytes(32).toString('hex');
        existing.verificationToken = newToken;
        await existing.save({ validateBeforeSave: false });
 
        const verifyUrl = `${req.protocol}://${req.get('host')}/verify-email?token=${newToken}`;
        sendMailWithTimeout(buildVerificationEmail({
          to: existing.email,
          firstName: existing.ownerName.split(' ')[0],
          companyName: existing.companyName,
          verifyUrl
        }));
 
        req.flash('success', `An account with that email already exists but hasn't been verified. We've resent the verification email to ${email}.`);
        return res.redirect('/login');
      }
 
      return res.render('auth/register', {
        title: 'Register – NamPayroll',
        errors: [{ msg: 'An account with that email already exists.' }],
        formData: req.body
      });
    }
 
    const verificationToken = crypto.randomBytes(32).toString('hex');
 
    const user = await User.create({
      ownerName:         `${firstName.trim()} ${lastName.trim()}`,
      companyName:        companyName.trim(),
      numEmployees,
      email:              email.toLowerCase().trim(),
      phone:              phone.trim(),
      physicalAddress:    physicalAddress?.trim()     || '',
      postalAddress:      postalAddress?.trim()       || '',
      tinNumber:          tinNumber?.trim()           || undefined,
      payeRegNo:          payeRegNo?.trim()           || undefined,
      sscNumber:          sscNumber?.trim()           || undefined,
      bankName:           bankName?.trim()            || '',
      bankAccountNumber:  bankAccountNumber?.trim()   || '',
      bankBranchCode:     bankBranchCode?.trim()      || '',
      password,
      companyLogo:        req.file ? `/uploads/logos/${req.file.filename}` : null,
      verificationToken,
      emailVerified:      false
    });
 
    await Settings.create({ company: user._id });
 
    const verifyUrl = `${req.protocol}://${req.get('host')}/verify-email?token=${verificationToken}`;
    sendMailWithTimeout(buildVerificationEmail({ to: email, firstName, companyName, verifyUrl }));
 
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
        errors: [{ msg: 'Please verify your email address before logging in. Check your inbox or <a href="/resend-verification?email=' + encodeURIComponent(user.email) + '" style="color:#f5a623;">click here to resend</a>.' }],
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

// ─────────────────────────────────────────────
// GET /resend-verification
// Allows users stuck with unverified accounts to get a fresh email.
// ─────────────────────────────────────────────
exports.getResendVerification = async (req, res) => {
  const { email } = req.query;

  if (!email) {
    req.flash('error', 'No email address provided.');
    return res.redirect('/login');
  }

  try {
    const user = await User.findOne({ email: decodeURIComponent(email).toLowerCase().trim() });

    if (!user) {
      req.flash('error', 'No account found with that email.');
      return res.redirect('/login');
    }

    if (user.emailVerified) {
      req.flash('success', 'Your email is already verified. Please log in.');
      return res.redirect('/login');
    }

    const newToken = crypto.randomBytes(32).toString('hex');
    user.verificationToken = newToken;
    await user.save({ validateBeforeSave: false });

    const verifyUrl = `${req.protocol}://${req.get('host')}/verify-email?token=${newToken}`;

    // Fire-and-forget
    sendMailWithTimeout(buildVerificationEmail({
      to: user.email,
      firstName: user.ownerName.split(' ')[0],
      companyName: user.companyName,
      verifyUrl
    }));

    req.flash('success', `A new verification email has been sent to ${user.email}.`);
    res.redirect('/login');

  } catch (err) {
    console.error('Resend verification error:', err);
    req.flash('error', 'Something went wrong. Please try again.');
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

    // ─── FIX: Fire-and-forget with timeout — never blocks the redirect
    sendMailWithTimeout(buildPasswordResetEmail({ to: user.email, resetUrl }));

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