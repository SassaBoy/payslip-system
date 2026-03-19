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

    // Send Welcome & Verification Email
    await transporter.sendMail({
      from: `"NamPayroll" <${process.env.EMAIL_USER}>`,
      to: newEmployee.email,
      subject: `Welcome to the Employee Portal - ${companyName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 10px; padding: 20px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="color: #f5a623;">NamPayroll</h1>
            <p style="color: #666;">Employee Access Invitation</p>
          </div>
          <p>Hello <strong>${fullName}</strong>,</p>
          <p>An account has been created for you by <strong>${companyName}</strong>. You can now access your payslips and leave balances online.</p>
          
          <div style="background: #fff9f0; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #ffe8cc;">
            <p style="margin: 0;"><strong>Employee Portal:</strong> <a href="${portalUrl}">${portalUrl}</a></p>
            <p style="margin: 5px 0 0 0;"><strong>Username:</strong> ${newEmployee.email}</p>
          </div>

          <p>To secure your account and log in, please verify your email address below:</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verifyUrl}" style="background-color: #f5a623; color: #fff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Verify Email & Activate Account</a>
          </div>

          <p style="font-size: 12px; color: #999;">If the button doesn't work, copy this link into your browser:<br>${verifyUrl}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 11px; color: #bbb; text-align: center;">This is an automated message from NamPayroll Namibia.</p>
        </div>
      `
    });

    req.flash('success', `${fullName} has been added. A verification email has been sent to ${newEmployee.email}.`);
    res.redirect('/employees');
  } catch (err) {
    console.error('Create employee error:', err);
    res.render('employees/new', {
      title: 'Add Employee – NamPayroll',
      employees,
      errors: [{ msg: 'Employee added, but email failed to send. Please check your system email settings.' }],
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