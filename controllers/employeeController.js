const { validationResult } = require('express-validator');
const Employee = require('../models/Employee');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Helper: Setup Email Transporter
const transporter = nodemailer.createTransport({
  service: 'gmail', // Ensure EMAIL_USER and EMAIL_PASS are in your .env
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

  .body { padding: 36px 40px 32px; }
  .greeting { font-family: 'Sora', Arial, sans-serif; font-size: 1.3rem; font-weight: 700; color: #fff; margin-bottom: 12px; letter-spacing: -0.02em; }
  .body p { font-size: 0.9rem; line-height: 1.7; color: rgba(255,255,255,0.6); margin-bottom: 14px; }

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

  .divider { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 24px 0; }

  .url-fallback { font-size: 0.75rem; color: rgba(255,255,255,0.25); word-break: break-all; }
  .url-fallback a { color: rgba(245,166,35,0.6); text-decoration: none; }

  .notice-badge {
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

const logoSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L3 7V12C3 16.55 6.84 20.74 12 22C17.16 20.74 21 16.55 21 12V7L12 2Z" fill="#1a0e00"/><path d="M9 12L11 14L15 10" stroke="#1a0e00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ─────────────────────────────────────────────
// EMAIL BUILDER: Employee Welcome & Verification
// ─────────────────────────────────────────────
function buildEmployeeWelcomeEmail({ to, fullName, companyName, email, verifyUrl, portalUrl }) {
  return {
    from: `"NamPayroll" <${process.env.EMAIL_USER}>`,
    to,
    subject: `You've been added to ${companyName} on NamPayroll`,
    html: `
      <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
      <title>Employee Portal Invitation – NamPayroll</title>
      <style>${emailStyles}</style></head>
      <body>
        <div class="wrapper">
          <div class="header">
            <div class="header-logo-wrap">${logoSvg}</div>
            <div>
              <div class="header-brand">NamPayroll</div>
              <div class="header-tagline">Employee Portal Invitation</div>
            </div>
          </div>

          <div class="body">
            <h2 class="greeting">Hello, ${fullName}! 👋</h2>
            <p>
              <strong style="color:#fff;">${companyName}</strong> has created an employee portal account for you on NamPayroll.
              You can use it to view and download your payslips, check your leave balances, and more — all in one place.
            </p>

            <div class="notice-badge">📋 &nbsp;Action Required — Verify your email to activate</div>

            <div class="info-card">
              <div class="info-card-row">
                <span class="info-label">Company</span>
                <span class="info-value">${companyName}</span>
              </div>
              <div class="info-card-row">
                <span class="info-label">Username</span>
                <span class="info-value">${email}</span>
              </div>
              <div class="info-card-row">
                <span class="info-label">Portal URL</span>
                <span class="info-value"><a href="${portalUrl}" style="color:#f5a623;text-decoration:none;">${portalUrl}</a></span>
              </div>
            </div>

            <p>Click the button below to verify your email address and activate your account:</p>

            <div class="cta-wrap">
              <a href="${verifyUrl}" class="cta-btn">✓ &nbsp;Verify Email &amp; Activate Account</a>
            </div>

            <hr class="divider" />

            <p>If the button above doesn't work, copy and paste this link into your browser:</p>
            <p class="url-fallback"><a href="${verifyUrl}">${verifyUrl}</a></p>

            <hr class="divider" />

            <p style="font-size:0.8rem; color:rgba(255,255,255,0.3);">If you were not expecting this invitation, you can safely ignore this email.</p>
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

// GET /employees
exports.getEmployees = async (req, res) => {
  try {
    const companyId = req.session.user._id;
    const search = req.query.search || '';
    const query = { company: companyId, isActive: true };

    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { position: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const employees = await Employee.find(query).sort({ fullName: 1 }).lean();

    res.render('employees/index', {
      title: 'Employees – NamPayroll',
      employees,
      search
    });
  } catch (err) {
    console.error('Get employees error:', err);
    req.flash('error', 'Could not load employees.');
    res.redirect('/dashboard');
  }
};

// GET /employees/new
exports.getNewEmployee = async (req, res) => {
  try {
    // Added: Fetch existing employees so the frontend duplicate check works
    const employees = await Employee.find({ company: req.session.user._id, isActive: true }, 'idNumber').lean();

    res.render('employees/new', {
      title: 'Add Employee – NamPayroll',
      employees,
      errors: [],
      formData: {}
    });
  } catch (err) {
    res.redirect('/employees');
  }
};

// POST /employees
exports.createEmployee = async (req, res) => {
  const companyId = req.session.user._id;
  // Fetch for re-rendering if validation fails
  const employees = await Employee.find({ company: companyId, isActive: true }, 'idNumber').lean();

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('employees/new', {
      title: 'Add Employee – NamPayroll',
      employees,
      errors: errors.array(),
      formData: req.body
    });
  }

  try {
    const companyName = req.session.user.companyName || 'NamPayroll Client';
    const {
      fullName, idNumber, phone, email, position, department,
      basicSalary, dateJoined, annualLeaveBalance, sickLeaveBalance,
      portalPassword
    } = req.body;

    // Added: Unique ID Number check per company
    const duplicateId = await Employee.findOne({ company: companyId, idNumber: idNumber.trim(), isActive: true });
    if (duplicateId) {
      return res.render('employees/new', {
        title: 'Add Employee – NamPayroll',
        employees,
        errors: [{ msg: 'An employee with this ID number already exists in your company.' }],
        formData: req.body
      });
    }

    // Check email uniqueness per company
    const existing = await Employee.findOne({ company: companyId, email: email.toLowerCase().trim(), isActive: true });
    if (existing) {
      return res.render('employees/new', {
        title: 'Add Employee – NamPayroll',
        employees,
        errors: [{ msg: 'An employee with that email already exists in your company.' }],
        formData: req.body
      });
    }

    // Added: Handle +264 Phone Prefix
    let cleanPhone = phone?.trim() || '';
    if (cleanPhone && !cleanPhone.startsWith('+')) {
      cleanPhone = '+264' + cleanPhone.replace(/^0/, '');
    }

    // Generate Verification Token
    const verificationToken = crypto.randomBytes(32).toString('hex');

    const employeeData = {
      company: companyId,
      fullName: fullName.trim(),
      idNumber: idNumber.trim(),
      phone: cleanPhone,
      email: email.toLowerCase().trim(),
      position: position?.trim() || '',
      department: department?.trim() || '',
      basicSalary: parseFloat(basicSalary),
      dateJoined: new Date(dateJoined),
      annualLeaveBalance: annualLeaveBalance ? parseInt(annualLeaveBalance) : 24,
      sickLeaveBalance: sickLeaveBalance ? parseInt(sickLeaveBalance) : 30,
      verificationToken,
      emailVerified: false
    };

    // Set portal password if provided
    if (portalPassword && portalPassword.length >= 6) {
      employeeData.portalPassword = portalPassword;
      employeeData.portalEnabled = true;
    }

    const newEmployee = await Employee.create(employeeData);

    // Prepare URLs for the email
    const verifyUrl = `${req.protocol}://${req.get('host')}/portal/verify-email?token=${verificationToken}`;
    const portalUrl = `${req.protocol}://${req.get('host')}/portal/login`;

    // ─── FIX: Fire-and-forget with timeout — redirect happens immediately,
    //         email sends in the background without blocking the response.
    sendMailWithTimeout(buildEmployeeWelcomeEmail({
      to: newEmployee.email,
      fullName,
      companyName,
      email: newEmployee.email,
      verifyUrl,
      portalUrl
    }));

    req.flash('success', `${fullName} has been added. A verification email has been sent to ${newEmployee.email}.`);
    res.redirect('/employees');
  } catch (err) {
    console.error('Create employee error:', err);
    res.render('employees/new', {
      title: 'Add Employee – NamPayroll',
      employees,
      errors: [{ msg: 'Failed to add employee. Please try again.' }],
      formData: req.body
    });
  }
};

// GET /employees/:id/edit
exports.getEditEmployee = async (req, res) => {
  try {
    const employee = await Employee.findOne({
      _id: req.params.id,
      company: req.session.user._id
    }).lean();

    if (!employee) {
      req.flash('error', 'Employee not found.');
      return res.redirect('/employees');
    }

    res.render('employees/edit', {
      title: 'Edit Employee – NamPayroll',
      employee,
      errors: [],
      formData: employee
    });
  } catch (err) {
    console.error('Get edit employee error:', err);
    req.flash('error', 'Could not load employee.');
    res.redirect('/employees');
  }
};

// PUT /employees/:id
exports.updateEmployee = async (req, res) => {
  const errors = validationResult(req);
  const employee = await Employee.findOne({ _id: req.params.id, company: req.session.user._id });

  if (!employee) {
    req.flash('error', 'Employee not found.');
    return res.redirect('/employees');
  }

  if (!errors.isEmpty()) {
    return res.render('employees/edit', {
      title: 'Edit Employee – NamPayroll',
      employee: employee.toObject(),
      errors: errors.array(),
      formData: req.body
    });
  }

  try {
    const {
      fullName, idNumber, phone, email, position, department,
      basicSalary, dateJoined, annualLeaveBalance, sickLeaveBalance,
      portalPassword, portalEnabled
    } = req.body;

    // Added: Update Phone Formatting logic for Edit too
    let cleanPhone = phone?.trim() || '';
    if (cleanPhone && !cleanPhone.startsWith('+')) {
      cleanPhone = '+264' + cleanPhone.replace(/^0/, '');
    }

    employee.fullName = fullName.trim();
    employee.idNumber = idNumber.trim();
    employee.phone = cleanPhone;
    employee.email = email.toLowerCase().trim();
    employee.position = position?.trim() || '';
    employee.department = department?.trim() || '';
    employee.basicSalary = parseFloat(basicSalary);
    employee.dateJoined = new Date(dateJoined);
    employee.annualLeaveBalance = parseInt(annualLeaveBalance) || 24;
    employee.sickLeaveBalance = parseInt(sickLeaveBalance) || 30;
    employee.portalEnabled = portalEnabled === 'on';

    if (portalPassword && portalPassword.length >= 6) {
      employee.portalPassword = portalPassword;
    }

    await employee.save();
    req.flash('success', `${fullName} has been updated.`);
    res.redirect('/employees');
  } catch (err) {
    console.error('Update employee error:', err);
    res.render('employees/edit', {
      title: 'Edit Employee – NamPayroll',
      employee: employee.toObject(),
      errors: [{ msg: 'Failed to update employee.' }],
      formData: req.body
    });
  }
};

// DELETE /employees/:id
exports.deleteEmployee = async (req, res) => {
  try {
    const employee = await Employee.findOne({ _id: req.params.id, company: req.session.user._id });
    if (!employee) {
      req.flash('error', 'Employee not found.');
      return res.redirect('/employees');
    }
    // Soft delete
    employee.isActive = false;
    await employee.save();
    req.flash('success', `${employee.fullName} has been removed.`);
    res.redirect('/employees');
  } catch (err) {
    console.error('Delete employee error:', err);
    req.flash('error', 'Could not remove employee.');
    res.redirect('/employees');
  }
};