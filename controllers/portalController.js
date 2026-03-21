/**
 * controllers/portalController.js – NamPayroll Employee Portal
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles employee self-service portal:
 *   - Login / logout / email verification
 *   - Dashboard (leave balances + payslip history)
 *   - Payslip PDF download (theme-aware)
 *   - PAYE5 / ITA5 annual tax certificate download
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { validationResult } = require('express-validator');
const Employee   = require('../models/Employee');
const PayrollRun = require('../models/PayrollRun');
const User       = require('../models/User');
const Settings   = require('../models/Settings');
const moment     = require('moment-timezone');

const { generatePayslipPDF }       = require('../utils/pdfGenerator');
const { generatePAYE5Certificate } = require('../utils/paye5Generator');

// ─────────────────────────────────────────────────────────────────────────────
// GET /portal/login
// ─────────────────────────────────────────────────────────────────────────────
exports.getLogin = (req, res) => {
  res.render('portal/login', {
    title:    'Employee Portal – NamPayroll',
    errors:   [],
    success:  req.flash('success'),
    error:    req.flash('error'),
    formData: {}
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /portal/login
// ─────────────────────────────────────────────────────────────────────────────
exports.postLogin = async (req, res) => {
  const valErrors = validationResult(req);
  if (!valErrors.isEmpty()) {
    return res.render('portal/login', {
      title:    'Employee Portal – NamPayroll',
      errors:   valErrors.array(),
      success:  [],
      error:    [],
      formData: req.body
    });
  }

  try {
    const { email, password } = req.body;

    // Find active employee by email across all companies
    const employee = await Employee.findOne({
      email:         email.toLowerCase().trim(),
      isActive:      true,
      portalEnabled: true
    });

    if (!employee || !(await employee.comparePortalPassword(password))) {
      return res.render('portal/login', {
        title:    'Employee Portal – NamPayroll',
        errors:   [{ msg: 'Invalid email or password, or portal access is not enabled for your account.' }],
        success:  [],
        error:    [],
        formData: req.body
      });
    }

    // Email verification guard
    if (!employee.emailVerified) {
      return res.render('portal/login', {
        title:    'Employee Portal – NamPayroll',
        errors:   [{ msg: 'Please verify your email address before logging in. Check your inbox for the activation link.' }],
        success:  [],
        error:    [],
        formData: req.body
      });
    }

    const company = await User.findById(employee.company).lean();

    req.session.employee = {
      _id:         employee._id.toString(),
      companyId:   employee.company.toString(),
      fullName:    employee.fullName,
      email:       employee.email,
      companyName: company?.companyName || ''
    };

    req.flash('success', `Welcome back, ${employee.fullName.split(' ')[0]}!`);
    res.redirect('/portal/dashboard');

  } catch (err) {
    console.error('Portal login error:', err);
    res.render('portal/login', {
      title:    'Employee Portal – NamPayroll',
      errors:   [{ msg: 'Login failed. Please try again.' }],
      success:  [],
      error:    [],
      formData: req.body
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /portal/verify-email
// Handles the verification link clicked in the welcome email
// ─────────────────────────────────────────────────────────────────────────────
exports.getVerifyEmail = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      req.flash('error', 'Invalid verification link.');
      return res.redirect('/portal/login');
    }

    const employee = await Employee.findOne({ verificationToken: token });

    if (!employee) {
      req.flash('error', 'Verification link is invalid or has already been used.');
      return res.redirect('/portal/login');
    }

    employee.emailVerified     = true;
    employee.verificationToken = undefined;
    await employee.save();

    req.flash('success', 'Your email has been verified! You can now log in.');
    res.redirect('/portal/login');

  } catch (err) {
    console.error('Email verification error:', err);
    req.flash('error', 'An error occurred during verification. Please try again.');
    res.redirect('/portal/login');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /portal/logout
// ─────────────────────────────────────────────────────────────────────────────
exports.logout = (req, res) => {
  req.session.destroy(() => res.redirect('/portal/login'));
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /portal/dashboard
// ─────────────────────────────────────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const empSession = req.session.employee;

    // Always fetch fresh employee data so leave balances are current
    const employee = await Employee.findById(empSession._id).lean();
    if (!employee) {
      req.session.destroy(() => res.redirect('/portal/login'));
      return;
    }

    // Attach companyName for the portal navbar
    employee.companyName = empSession.companyName || '';

    // All finalised payroll runs for this company containing this employee
    const payrollRuns = await PayrollRun.find({
      company:             employee.company,
      status:              'finalised',
      'payslips.employee': employee._id
    })
    .sort({ year: -1, month: -1 })
    .lean();

    // Build flat payslip list for this employee only
    const myPayslips = [];
    for (const run of payrollRuns) {
      const ps = run.payslips.find(
        p => p.employee?.toString() === employee._id.toString()
      );
      if (!ps) continue;

      myPayslips.push({
        runId:       run._id.toString(),
        payslipId:   ps._id.toString(),
        month:       run.month,
        year:        run.year,
        grossPay:    ps.grossPay    || 0,
        paye:        ps.paye        || 0,
        sscEmployee: ps.sscEmployee || 0,
        netPay:      ps.netPay      || 0
      });
    }

    res.render('portal/dashboard', {
      title:      'My Portal – NamPayroll',
      employee,
      myPayslips,
      success:    req.flash('success'),
      moment
    });

  } catch (err) {
    console.error('Portal dashboard error:', err);
    req.flash('error', 'Could not load your portal.');
    res.redirect('/portal/login');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /portal/payslip/:runId/:payslipId/pdf
// Employee downloads their own payslip — security verified
// ─────────────────────────────────────────────────────────────────────────────
exports.downloadPayslipPDF = async (req, res) => {
  try {
    const empSession = req.session.employee;

    const payrollRun = await PayrollRun.findOne({
      _id:     req.params.runId,
      company: empSession.companyId,
      status:  'finalised'
    });
    if (!payrollRun) return res.status(404).send('Payroll run not found');

    // Find payslip AND verify it belongs to this employee
    const payslip = payrollRun.payslips.find(
      p => p._id.toString()       === req.params.payslipId &&
           p.employee?.toString() === empSession._id
    );
    if (!payslip) return res.status(403).send('Payslip not found or access denied');

    const companyUser = await User.findById(empSession.companyId).lean();

    // Use company's payslip theme so employee gets the same styled PDF
    const settings = await Settings.findOne({ company: empSession.companyId }).lean();
    const theme    = settings?.payslipTheme || {};

    const safeName = (payslip.employeeSnapshot?.fullName || 'employee').replace(/[^a-z0-9]/gi, '_');
    const period   = moment(`${payrollRun.year}-${String(payrollRun.month).padStart(2,'0')}-01`).format('MMMM_YYYY');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip_${safeName}_${period}.pdf"`);

    generatePayslipPDF(payslip, companyUser, payrollRun.month, payrollRun.year, res, theme);

  } catch (err) {
    console.error('Portal payslip download error:', err);
    res.status(500).send('Could not generate payslip');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /portal/paye5/:taxYear
// Employee downloads their own ITA5/PAYE5 annual tax certificate
// ─────────────────────────────────────────────────────────────────────────────
exports.downloadPAYE5 = async (req, res) => {
  try {
    const empSession = req.session.employee;
    const taxYear    = parseInt(req.params.taxYear);

    if (!taxYear || taxYear < 2020 || taxYear > 2100) {
      return res.status(400).send('Invalid tax year');
    }

    // Namibia tax year: March taxYear – February taxYear+1
    const allRuns = await PayrollRun.find({
      company: empSession.companyId,
      status:  'finalised',
      $or: [
        { year: taxYear,     month: { $gte: 3 } },
        { year: taxYear + 1, month: { $lte: 2 } }
      ]
    }).lean();

    const employee = await Employee.findById(empSession._id).lean();
    if (!employee) return res.status(404).send('Employee not found');

    const companyUser = await User.findById(empSession.companyId).lean();

    // Aggregate annual totals for this employee only
    const annualData = {
      annualSalary: 0, annualOTPay: 0, annualTaxAllow: 0,
      annualNonTaxAllow: 0, annualGross: 0, annualTaxGross: 0,
      annualPAYE: 0, annualSSCEmployee: 0
    };

    let hasData = false;
    for (const run of allRuns) {
      for (const ps of run.payslips) {
        if (ps.employee?.toString() !== empSession._id) continue;
        hasData = true;
        annualData.annualSalary       += ps.basicSalary         || 0;
        annualData.annualOTPay        += ps.overtimePay          || 0;
        annualData.annualTaxAllow     += ps.taxableAllowances    || 0;
        annualData.annualNonTaxAllow  += ps.nonTaxableAllowances || 0;
        annualData.annualGross        += ps.grossPay             || 0;
        annualData.annualTaxGross     += ps.taxableGross          || 0;
        annualData.annualPAYE         += ps.paye                 || 0;
        annualData.annualSSCEmployee  += ps.sscEmployee          || 0;
      }
    }

    if (!hasData) {
      return res.status(404).send(`No payroll records found for the ${taxYear}/${taxYear + 1} tax year`);
    }

    const pensionAnn             = (employee.pensionContribution    || 0) * 12;
    const medicalAnn             = (employee.medicalAidContribution || 0) * 12;
    annualData.annualDeductions  = pensionAnn + medicalAnn + annualData.annualSSCEmployee;
    annualData.taxableIncome     = Math.max(0, annualData.annualTaxGross - pensionAnn - medicalAnn);

    const safeName = employee.fullName.replace(/[^a-z0-9]/gi, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="ITA5_${safeName}_${taxYear}.pdf"`);

    generatePAYE5Certificate(annualData, employee, companyUser, taxYear, res);

  } catch (err) {
    console.error('Portal PAYE5 download error:', err);
    res.status(500).send('Could not generate tax certificate');
  }
};