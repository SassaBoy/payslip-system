const { validationResult } = require('express-validator');
const Employee = require('../models/Employee');
const PayrollRun = require('../models/PayrollRun');
const User = require('../models/User');
const moment = require('moment-timezone');
const { generatePayslipPDF } = require('../utils/pdfGenerator');

// GET /portal/login
exports.getLogin = (req, res) => {
  res.render('portal/login', {
    title: 'Employee Portal – NamPayroll',
    errors: [],
    formData: {}
  });
};

// POST /portal/login
exports.postLogin = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('portal/login', {
      title: 'Employee Portal – NamPayroll',
      errors: errors.array(),
      formData: req.body
    });
  }

  try {
    const { email, password } = req.body;

    // Find active employee by email (across all companies)
    const employee = await Employee.findOne({ 
      email: email.toLowerCase().trim(), 
      isActive: true, 
      portalEnabled: true 
    });

    // Check if employee exists and password matches
    if (!employee || !(await employee.comparePortalPassword(password))) {
      return res.render('portal/login', {
        title: 'Employee Portal – NamPayroll',
        errors: [{ msg: 'Invalid email or password, or portal access is not enabled for your account.' }],
        formData: req.body
      });
    }

    // NEW: Verification Guard - Check if employee has verified their email
    if (!employee.emailVerified) {
      return res.render('portal/login', {
        title: 'Employee Portal – NamPayroll',
        errors: [{ msg: 'Please verify your email address before logging in. Check your inbox for the activation link.' }],
        formData: req.body
      });
    }

    const company = await User.findById(employee.company).lean();

    req.session.employee = {
      _id: employee._id,
      fullName: employee.fullName,
      email: employee.email,
      company: employee.company,
      companyName: company?.companyName || ''
    };

    req.flash('success', `Welcome, ${employee.fullName}!`);
    res.redirect('/portal/dashboard');
  } catch (err) {
    console.error('Portal login error:', err);
    res.render('portal/login', {
      title: 'Employee Portal – NamPayroll',
      errors: [{ msg: 'Login failed. Please try again.' }],
      formData: req.body
    });
  }
};

// GET /portal/verify-email
// Handles the link clicked by the employee in their welcome email
exports.getVerifyEmail = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      req.flash('error', 'Invalid verification link.');
      return res.redirect('/portal/login');
    }

    // Find employee with the matching token
    const employee = await Employee.findOne({ verificationToken: token });

    if (!employee) {
      req.flash('error', 'Verification link is invalid or has expired.');
      return res.redirect('/portal/login');
    }

    // Update verification status and clear the token
    employee.emailVerified = true;
    employee.verificationToken = undefined;
    await employee.save();

    req.flash('success', 'Your email has been verified successfully! You can now log in.');
    res.redirect('/portal/login');
  } catch (err) {
    console.error('Email verification error:', err);
    req.flash('error', 'An error occurred during verification.');
    res.redirect('/portal/login');
  }
};

// POST /portal/logout
exports.logout = (req, res) => {
  req.session.destroy(() => res.redirect('/portal/login'));
};

// GET /portal/dashboard
exports.getDashboard = async (req, res) => {
  try {
    const empSession = req.session.employee;

    // Get fresh employee data
    const employee = await Employee.findById(empSession._id).lean();
    if (!employee) {
      req.flash('error', 'Employee record not found.');
      return res.redirect('/portal/login');
    }

    // Get all payroll runs for this company that contain this employee's payslip
    const payrollRuns = await PayrollRun.find({ company: employee.company })
      .sort({ year: -1, month: -1 })
      .lean();

    // Extract only this employee's payslips
    const myPayslips = [];
    for (const run of payrollRuns) {
      const ps = run.payslips.find(p => p.employee.toString() === employee._id.toString());
      if (ps) {
        myPayslips.push({
          runId: run._id,
          payslipId: ps._id,
          month: run.month,
          year: run.year,
          grossPay: ps.grossPay,
          netPay: ps.netPay,
          paye: ps.paye,
          sscEmployee: ps.sscEmployee
        });
      }
    }

    res.render('portal/dashboard', {
      title: 'My Portal – NamPayroll',
      employee,
      myPayslips,
      moment
    });
  } catch (err) {
    console.error('Portal dashboard error:', err);
    req.flash('error', 'Could not load your portal.');
    res.redirect('/portal/login');
  }
};

// GET /portal/payslip/:runId/:payslipId/pdf
exports.downloadPayslipPDF = async (req, res) => {
  try {
    const empSession = req.session.employee;

    const payrollRun = await PayrollRun.findById(req.params.runId);
    if (!payrollRun) return res.status(404).send('Not found');

    const payslip = payrollRun.payslips.id(req.params.payslipId);
    if (!payslip) return res.status(404).send('Payslip not found');

    // Security: ensure the payslip belongs to this employee
    if (payslip.employee.toString() !== empSession._id.toString()) {
      return res.status(403).send('Access denied');
    }

    const companyUser = await User.findById(payrollRun.company).lean();
    const safeName = (payslip.employeeSnapshot?.fullName || 'employee').replace(/[^a-z0-9]/gi, '_');
    const fileName = `payslip_${safeName}_${payrollRun.year}_${String(payrollRun.month).padStart(2, '0')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    generatePayslipPDF(payslip, companyUser, payrollRun.month, payrollRun.year, res);
  } catch (err) {
    console.error('Portal download payslip error:', err);
    res.status(500).send('Could not generate payslip');
  }
};