const { validationResult } = require('express-validator');
const Employee = require('../models/Employee');
const crypto   = require('crypto');
const nodemailer = require('nodemailer');

// ─── Email transporter ────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

function sendMailWithTimeout(mailOptions, timeoutMs = 8000) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Email send timeout')), timeoutMs)
  );
  return Promise.race([transporter.sendMail(mailOptions), timeout])
    .catch(err => console.error('Background email error:', err.message));
}

// ─── Shared email styles & assets ─────────────────────────────────────────────
const emailStyles = `
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:#06111c; font-family:'DM Sans',Arial,sans-serif; color:rgba(255,255,255,0.82); }
  .wrapper { max-width:620px; margin:40px auto; background:#0d1b2a; border:1px solid rgba(255,255,255,0.07); border-radius:18px; overflow:hidden; }
  .header { background:linear-gradient(135deg,#112235 0%,#0d1b2a 100%); border-bottom:1px solid rgba(245,166,35,0.18); padding:32px 40px 28px; display:flex; align-items:center; gap:14px; }
  .header-logo-wrap { width:46px; height:46px; background:#f5a623; border-radius:12px; display:flex; align-items:center; justify-content:center; }
  .header-brand { font-family:'Sora',Arial,sans-serif; font-size:1.25rem; font-weight:700; color:#fff; letter-spacing:-0.02em; }
  .header-tagline { font-size:0.75rem; color:rgba(255,255,255,0.35); margin-top:2px; letter-spacing:0.04em; text-transform:uppercase; }
  .body { padding:36px 40px 32px; }
  .greeting { font-family:'Sora',Arial,sans-serif; font-size:1.3rem; font-weight:700; color:#fff; margin-bottom:12px; }
  .body p { font-size:0.9rem; line-height:1.7; color:rgba(255,255,255,0.6); margin-bottom:14px; }
  .cta-wrap { margin:28px 0; }
  .cta-btn { display:inline-block; background:#f5a623; color:#1a0e00 !important; font-family:'Sora',Arial,sans-serif; font-size:0.9rem; font-weight:700; padding:14px 32px; border-radius:10px; text-decoration:none; }
  .info-card { background:#112235; border:1px solid rgba(255,255,255,0.07); border-radius:10px; padding:16px 20px; margin:20px 0; }
  .info-card-row { display:flex; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.05); }
  .info-card-row:last-child { border-bottom:none; }
  .info-label { font-size:0.75rem; color:rgba(255,255,255,0.35); text-transform:uppercase; letter-spacing:0.04em; min-width:120px; }
  .info-value { font-size:0.875rem; color:rgba(255,255,255,0.82); font-weight:500; }
  .divider { border:none; border-top:1px solid rgba(255,255,255,0.06); margin:24px 0; }
  .url-fallback { font-size:0.75rem; color:rgba(255,255,255,0.25); word-break:break-all; }
  .url-fallback a { color:rgba(245,166,35,0.6); text-decoration:none; }
  .notice-badge { display:inline-flex; align-items:center; gap:6px; background:rgba(245,166,35,0.08); border:1px solid rgba(245,166,35,0.2); color:#f5a623; font-size:0.75rem; font-weight:600; padding:5px 12px; border-radius:20px; margin-bottom:20px; }
  .footer { background:#071421; border-top:1px solid rgba(255,255,255,0.06); padding:22px 40px; text-align:center; }
  .footer p { font-size:0.75rem; color:rgba(255,255,255,0.2); line-height:1.6; }
  .footer a { color:rgba(245,166,35,0.5); text-decoration:none; }
  .separator { display:inline-block; margin:0 8px; color:rgba(255,255,255,0.1); }
`;

const logoSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 7V12C3 16.55 6.84 20.74 12 22C17.16 20.74 21 16.55 21 12V7L12 2Z" fill="#1a0e00"/><path d="M9 12L11 14L15 10" stroke="#1a0e00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function buildEmployeeWelcomeEmail({ to, fullName, companyName, email, verifyUrl, portalUrl }) {
  return {
    from: `"NamPayroll" <${process.env.EMAIL_USER}>`,
    to,
    subject: `You've been added to ${companyName} on NamPayroll`,
    html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Employee Portal Invitation</title>
    <style>${emailStyles}</style></head><body>
    <div class="wrapper">
      <div class="header">
        <div class="header-logo-wrap">${logoSvg}</div>
        <div><div class="header-brand">NamPayroll</div><div class="header-tagline">Employee Portal Invitation</div></div>
      </div>
      <div class="body">
        <h2 class="greeting">Hello, ${fullName}! 👋</h2>
        <p><strong style="color:#fff;">${companyName}</strong> has created an employee portal account for you on NamPayroll.</p>
        <div class="notice-badge">📋 &nbsp;Action Required — Verify your email to activate</div>
        <div class="info-card">
          <div class="info-card-row"><span class="info-label">Company</span><span class="info-value">${companyName}</span></div>
          <div class="info-card-row"><span class="info-label">Username</span><span class="info-value">${email}</span></div>
          <div class="info-card-row"><span class="info-label">Portal URL</span><span class="info-value"><a href="${portalUrl}" style="color:#f5a623;">${portalUrl}</a></span></div>
        </div>
        <p>Click below to verify your email and activate your account:</p>
        <div class="cta-wrap"><a href="${verifyUrl}" class="cta-btn">✓ &nbsp;Verify Email &amp; Activate Account</a></div>
        <hr class="divider"/>
        <p class="url-fallback"><a href="${verifyUrl}">${verifyUrl}</a></p>
        <hr class="divider"/>
        <p style="font-size:0.8rem;color:rgba(255,255,255,0.3);">If you were not expecting this, you can safely ignore this email.</p>
      </div>
      <div class="footer">
        <p>© ${new Date().getFullYear()} NamPayroll · All rights reserved</p>
        <p style="margin-top:6px;"><a href="#">Privacy Policy</a><span class="separator">·</span><a href="#">Terms of Service</a><span class="separator">·</span><a href="#">Support</a></p>
      </div>
    </div></body></html>`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Namibian phone normaliser
//   Accepts: 0811234567 / 811234567 / +264811234567 / 264811234567
//   Returns: +264XXXXXXXXX  (12 chars)
// ─────────────────────────────────────────────────────────────────────────────
function normalisePhone(raw) {
  if (!raw) return '';
  let p = raw.trim().replace(/[\s\-()]/g, '');
  if (p.startsWith('+264')) return p;
  if (p.startsWith('264'))  return '+' + p;
  if (p.startsWith('0'))    return '+264' + p.slice(1);
  return '+264' + p;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /employees
// ─────────────────────────────────────────────────────────────────────────────
exports.getEmployees = async (req, res) => {
  try {
    const companyId = req.session.user._id;
    const search    = req.query.search || '';
    const query     = { company: companyId, isActive: true };

    if (search) {
      query.$or = [
        { fullName:   { $regex: search, $options: 'i' } },
        { position:   { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
        { email:      { $regex: search, $options: 'i' } }
      ];
    }

    const employees = await Employee.find(query).sort({ fullName: 1 }).lean();
    res.render('employees/index', { title: 'Employees – NamPayroll', employees, search });
  } catch (err) {
    console.error('Get employees error:', err);
    req.flash('error', 'Could not load employees.');
    res.redirect('/dashboard');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /employees/new
// ─────────────────────────────────────────────────────────────────────────────
exports.getNewEmployee = async (req, res) => {
  try {
    const employees = await Employee.find(
      { company: req.session.user._id, isActive: true },
      'idNumber'
    ).lean();

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

// ─────────────────────────────────────────────────────────────────────────────
// POST /employees  — create single employee
// ─────────────────────────────────────────────────────────────────────────────
exports.createEmployee = async (req, res) => {
  const companyId = req.session.user._id;
  const employees = await Employee.find({ company: companyId, isActive: true }, 'idNumber').lean();

  const valErrors = validationResult(req);
  if (!valErrors.isEmpty()) {
    return res.render('employees/new', {
      title: 'Add Employee – NamPayroll',
      employees,
      errors: valErrors.array(),
      formData: req.body
    });
  }

  try {
    const companyName = req.session.user.companyName || 'NamPayroll Client';

    // ── Free trial cap (3 employees) ─────────────────────────────────────────
    const subscription = await require('../models/Subscription').findOne({ company: companyId });
    if ((subscription?.plan ?? 'trial') === 'trial') {
      const count = await Employee.countDocuments({ company: companyId, isActive: true });
      if (count >= 3) {
        req.flash('error', 'Free trial is limited to 3 employees. Please upgrade to add more.');
        return res.redirect('/subscribe');
      }
    }

    const {
      fullName, idNumber, tinNumber, socialSecurityNumber,
      phone, email,
      position, department, basicSalary, dateJoined,
      annualLeaveBalance, sickLeaveBalance,
      pensionFundName, pensionFundRegNo, pensionContribution,
      medicalAidFundName, medicalAidMemberNo, medicalAidContribution,
      hasCompanyVehicle, housingType,
      bankName, bankAccountNumber, bankBranchCode, accountType,
      portalPassword
    } = req.body;

    // ── Unique ID check per company ──────────────────────────────────────────
    const dupId = await Employee.findOne({ company: companyId, idNumber: idNumber.trim(), isActive: true });
    if (dupId) {
      return res.render('employees/new', {
        title: 'Add Employee – NamPayroll',
        employees,
        errors: [{ msg: 'An employee with this Namibian ID number already exists in your company.' }],
        formData: req.body
      });
    }

    // ── Unique email check per company ───────────────────────────────────────
    const dupEmail = await Employee.findOne({ company: companyId, email: email.toLowerCase().trim(), isActive: true });
    if (dupEmail) {
      return res.render('employees/new', {
        title: 'Add Employee – NamPayroll',
        employees,
        errors: [{ msg: 'An employee with that email already exists in your company.' }],
        formData: req.body
      });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');

    const employeeData = {
      company: companyId,
      fullName: fullName.trim(),
      idNumber: idNumber.trim(),
      tinNumber: tinNumber?.trim() || undefined,
      socialSecurityNumber: socialSecurityNumber?.trim() || undefined,
      phone: normalisePhone(phone),
      email: email.toLowerCase().trim(),
      position: position?.trim() || '',
      department: department?.trim() || '',
      basicSalary: parseFloat(basicSalary),
      dateJoined: new Date(dateJoined),
      annualLeaveBalance: annualLeaveBalance ? parseInt(annualLeaveBalance) : 24,
      sickLeaveBalance:   sickLeaveBalance   ? parseInt(sickLeaveBalance)   : 30,
      pensionFundName:    pensionFundName?.trim()  || '',
      pensionFundRegNo:   pensionFundRegNo?.trim() || '',
      pensionContribution: parseFloat(pensionContribution) || 0,
      medicalAidFundName:     medicalAidFundName?.trim()     || '',
      medicalAidMemberNo:     medicalAidMemberNo?.trim()     || '',
      medicalAidContribution: parseFloat(medicalAidContribution) || 0,
      hasCompanyVehicle: hasCompanyVehicle === 'on' || hasCompanyVehicle === 'true',
      housingType: ['none','free','subsidised'].includes(housingType) ? housingType : 'none',
      bankName:          bankName?.trim()          || '',
      bankAccountNumber: bankAccountNumber?.trim() || '',
      bankBranchCode:    bankBranchCode?.trim()    || '',
      accountType:       accountType || '',
      verificationToken,
      emailVerified: false
    };

    if (portalPassword && portalPassword.length >= 6) {
      employeeData.portalPassword = portalPassword;
      employeeData.portalEnabled  = true;
    }

    const newEmployee = await Employee.create(employeeData);

    const verifyUrl = `${req.protocol}://${req.get('host')}/portal/verify-email?token=${verificationToken}`;
    const portalUrl = `${req.protocol}://${req.get('host')}/portal/login`;

    sendMailWithTimeout(buildEmployeeWelcomeEmail({
      to: newEmployee.email,
      fullName,
      companyName,
      email: newEmployee.email,
      verifyUrl,
      portalUrl
    }));

    req.flash('success', `${fullName} has been added successfully.`);
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /employees/import-csv
// Bulk-creates employees from a CSV upload.
//
// Expected CSV columns (header row required):
//   Full Name, ID Number, TIN, SSC Number, Email, Phone,
//   Position, Department, Basic Salary, Date Joined,
//   Annual Leave, Sick Leave,
//   Pension Fund, Pension Reg No, Pension Contribution,
//   Medical Aid Fund, Medical Aid No, Medical Aid Contribution,
//   Has Vehicle, Housing Type,
//   Bank Name, Account Number, Branch Code, Account Type
// ─────────────────────────────────────────────────────────────────────────────
exports.importEmployeesCSV = async (req, res) => {
  try {
    const companyId   = req.session.user._id;
    const companyName = req.session.user.companyName || 'NamPayroll Client';

    // ── Trial cap check ───────────────────────────────────────────────────────
    const subscription = await require('../models/Subscription').findOne({ company: companyId });
    if ((subscription?.plan ?? 'trial') === 'trial') {
      req.flash('error', 'CSV import is not available on the free trial. Please upgrade.');
      return res.redirect('/employees');
    }

    if (!req.file) {
      req.flash('error', 'No CSV file uploaded.');
      return res.redirect('/employees');
    }

    const lines  = req.file.buffer.toString('utf8').split(/\r?\n/).filter(l => l.trim());
    const header = lines[0].toLowerCase();

    // Loose header check
    if (!header.includes('id number') && !header.includes('full name')) {
      req.flash('error', 'Invalid CSV format. Please use the provided template.');
      return res.redirect('/employees');
    }

    const results = { created: 0, skipped: 0, errors: [] };

    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;

      // Handles quoted fields with commas inside
      const parts = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)
        || line.split(',');
      const col = parts.map(p => p.replace(/^"|"$/g, '').trim());

      const [
        fullName, idNumber, tinNumber, socialSecurityNumber, email, phone,
        position, department, basicSalary, dateJoined,
        annualLeave, sickLeave,
        pensionFundName, pensionFundRegNo, pensionContribution,
        medicalAidFundName, medicalAidMemberNo, medicalAidContribution,
        hasVehicle, housingType,
        bankName, bankAccountNumber, bankBranchCode, accountType
      ] = col;

      // Skip rows missing the two truly required fields
      if (!fullName || !idNumber) {
        results.errors.push(`Row skipped — missing Full Name or ID Number.`);
        results.skipped++;
        continue;
      }

      // Namibian ID: must be 11 digits
      if (!/^\d{11}$/.test(idNumber)) {
        results.errors.push(`${fullName}: invalid ID number "${idNumber}" (must be 11 digits).`);
        results.skipped++;
        continue;
      }

      if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        results.errors.push(`${fullName}: invalid or missing email "${email}".`);
        results.skipped++;
        continue;
      }

      const salary = parseFloat(basicSalary);
      if (!salary || salary < 0) {
        results.errors.push(`${fullName}: invalid basic salary "${basicSalary}".`);
        results.skipped++;
        continue;
      }

      // Duplicate checks
      const dupId    = await Employee.findOne({ company: companyId, idNumber, isActive: true });
      const dupEmail = await Employee.findOne({ company: companyId, email: email.toLowerCase(), isActive: true });
      if (dupId || dupEmail) {
        results.errors.push(`${fullName}: duplicate ID or email — skipped.`);
        results.skipped++;
        continue;
      }

      const verificationToken = crypto.randomBytes(32).toString('hex');

      try {
        const emp = await Employee.create({
          company:  companyId,
          fullName: fullName.trim(),
          idNumber: idNumber.trim(),
          tinNumber: tinNumber?.trim() || undefined,
          socialSecurityNumber: socialSecurityNumber?.trim() || undefined,
          email:    email.toLowerCase().trim(),
          phone:    normalisePhone(phone),
          position:   position?.trim()   || '',
          department: department?.trim() || '',
          basicSalary: salary,
          dateJoined:  dateJoined ? new Date(dateJoined) : new Date(),
          annualLeaveBalance: parseInt(annualLeave) || 24,
          sickLeaveBalance:   parseInt(sickLeave)   || 30,
          pensionFundName:    pensionFundName?.trim()  || '',
          pensionFundRegNo:   pensionFundRegNo?.trim() || '',
          pensionContribution: parseFloat(pensionContribution) || 0,
          medicalAidFundName:     medicalAidFundName?.trim()     || '',
          medicalAidMemberNo:     medicalAidMemberNo?.trim()     || '',
          medicalAidContribution: parseFloat(medicalAidContribution) || 0,
          hasCompanyVehicle: hasVehicle?.toLowerCase() === 'yes',
          housingType: ['none','free','subsidised'].includes(housingType?.toLowerCase())
            ? housingType.toLowerCase() : 'none',
          bankName:          bankName?.trim()          || '',
          bankAccountNumber: bankAccountNumber?.trim() || '',
          bankBranchCode:    bankBranchCode?.trim()    || '',
          accountType:       accountType?.trim()       || '',
          verificationToken,
          emailVerified: false
        });

        const verifyUrl = `${req.protocol}://${req.get('host')}/portal/verify-email?token=${verificationToken}`;
        const portalUrl = `${req.protocol}://${req.get('host')}/portal/login`;
        sendMailWithTimeout(buildEmployeeWelcomeEmail({
          to: emp.email, fullName: emp.fullName,
          companyName, email: emp.email, verifyUrl, portalUrl
        }));

        results.created++;
      } catch (innerErr) {
        results.errors.push(`${fullName}: ${innerErr.message}`);
        results.skipped++;
      }
    }

    const msg = `CSV import complete: ${results.created} added, ${results.skipped} skipped.`
      + (results.errors.length ? ' Errors: ' + results.errors.join(' | ') : '');
    req.flash(results.created > 0 ? 'success' : 'error', msg);
    res.redirect('/employees');

  } catch (err) {
    console.error('CSV import error:', err);
    req.flash('error', 'Failed to import CSV. Please check the file and try again.');
    res.redirect('/employees');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /employees/:id/edit
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// PUT /employees/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.updateEmployee = async (req, res) => {
  const valErrors = validationResult(req);
  const employee  = await Employee.findOne({ _id: req.params.id, company: req.session.user._id });

  if (!employee) {
    req.flash('error', 'Employee not found.');
    return res.redirect('/employees');
  }
  if (!valErrors.isEmpty()) {
    return res.render('employees/edit', {
      title: 'Edit Employee – NamPayroll',
      employee: employee.toObject(),
      errors: valErrors.array(),
      formData: req.body
    });
  }

  try {
    const {
      fullName, idNumber, tinNumber, socialSecurityNumber,
      phone, email,
      position, department, basicSalary, dateJoined,
      annualLeaveBalance, sickLeaveBalance,
      pensionFundName, pensionFundRegNo, pensionContribution,
      medicalAidFundName, medicalAidMemberNo, medicalAidContribution,
      hasCompanyVehicle, housingType,
      bankName, bankAccountNumber, bankBranchCode, accountType,
      portalPassword, portalEnabled
    } = req.body;

    employee.fullName            = fullName.trim();
    employee.idNumber            = idNumber.trim();
    employee.tinNumber           = tinNumber?.trim()            || undefined;
    employee.socialSecurityNumber = socialSecurityNumber?.trim() || undefined;
    employee.phone               = normalisePhone(phone);
    employee.email               = email.toLowerCase().trim();
    employee.position            = position?.trim()   || '';
    employee.department          = department?.trim() || '';
    employee.basicSalary         = parseFloat(basicSalary);
    employee.dateJoined          = new Date(dateJoined);
    employee.annualLeaveBalance  = parseInt(annualLeaveBalance) || 24;
    employee.sickLeaveBalance    = parseInt(sickLeaveBalance)   || 30;
    employee.pensionFundName     = pensionFundName?.trim()  || '';
    employee.pensionFundRegNo    = pensionFundRegNo?.trim() || '';
    employee.pensionContribution = parseFloat(pensionContribution) || 0;
    employee.medicalAidFundName     = medicalAidFundName?.trim()     || '';
    employee.medicalAidMemberNo     = medicalAidMemberNo?.trim()     || '';
    employee.medicalAidContribution = parseFloat(medicalAidContribution) || 0;
    employee.hasCompanyVehicle   = hasCompanyVehicle === 'on';
    employee.housingType         = ['none','free','subsidised'].includes(housingType) ? housingType : 'none';
    employee.bankName            = bankName?.trim()          || '';
    employee.bankAccountNumber   = bankAccountNumber?.trim() || '';
    employee.bankBranchCode      = bankBranchCode?.trim()    || '';
    employee.accountType         = accountType || '';
    employee.portalEnabled       = portalEnabled === 'on';

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

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /employees/:id  (soft delete)
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteEmployee = async (req, res) => {
  try {
    const employee = await Employee.findOne({ _id: req.params.id, company: req.session.user._id });
    if (!employee) {
      req.flash('error', 'Employee not found.');
      return res.redirect('/employees');
    }
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