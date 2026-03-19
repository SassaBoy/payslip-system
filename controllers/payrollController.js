/**
 * payrollController.js – NamPayroll
 * Handles creating, viewing, downloading payroll runs and related exports.
 */

const moment = require('moment-timezone');
const archiver = require('archiver');
const { PassThrough } = require('stream');

const Employee       = require('../models/Employee');
const PayrollRun     = require('../models/PayrollRun');
const Settings       = require('../models/Settings');
const User           = require('../models/User');
const Subscription   = require('../models/Subscription');

const {
  calculateEmployeePayroll,
  calculatePayrollSummary
} = require('../utils/payrollCalculator');

const {
  generatePayslipPDF,
  generateCompliancePDF
} = require('../utils/pdfGenerator');

const {
  generateBankTransferCSV,
  generateComplianceCSV
} = require('../utils/csvGenerator');

const { TRIAL_RUN_LIMIT } = require('../middleware/subscriptionMiddleware');

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getSettings(companyId) {
  let settings = await Settings.findOne({ company: companyId });
  if (!settings) {
    settings = await Settings.create({ company: companyId });
  }
  return settings;
}

function monthName(month, year) {
  return moment(`${year}-${String(month).padStart(2, '0')}-01`).format('MMMM YYYY');
}

// ─── GET /payroll ─────────────────────────────────────────────────────────────
exports.getPayrollHistory = async (req, res) => {
  try {
    const payrolls = await PayrollRun.find({ company: req.session.user._id })
      .sort({ year: -1, month: -1 })
      .lean();

    res.render('payroll/history', {
      title: 'Payroll History – NamPayroll',
      payrolls,
      monthName,
      moment
    });
  } catch (err) {
    console.error('Payroll history error:', err);
    req.flash('error', 'Could not load payroll history.');
    res.redirect('/dashboard');
  }
};

// ─── GET /payroll/run ─────────────────────────────────────────────────────────
exports.getRunPayroll = async (req, res) => {
  try {
    const companyId = req.session.user._id;
    const now = moment().tz('Africa/Windhoek');

    const selectedMonth = parseInt(req.query.month) || now.month() + 1;
    const selectedYear  = parseInt(req.query.year)  || now.year();

    const existingRun = await PayrollRun.findOne({
      company: companyId,
      month: selectedMonth,
      year: selectedYear
    }).lean();

    const employees = await Employee.find({ company: companyId, isActive: true })
      .sort({ fullName: 1 })
      .lean();

    const years = [];
    for (let y = now.year() - 2; y <= now.year() + 1; y++) years.push(y);

    // Calculate run count for trial warning in the view
    const runCount = await PayrollRun.countDocuments({
      company: companyId,
      status: 'finalised'
    });

    res.render('payroll/run', {
      title: 'Run Payroll – NamPayroll',
      employees,
      selectedMonth,
      selectedYear,
      existing: existingRun,
      years,
      months: [
        { value: 1,  name: 'January'   },
        { value: 2,  name: 'February'  },
        { value: 3,  name: 'March'     },
        { value: 4,  name: 'April'     },
        { value: 5,  name: 'May'       },
        { value: 6,  name: 'June'      },
        { value: 7,  name: 'July'      },
        { value: 8,  name: 'August'    },
        { value: 9,  name: 'September' },
        { value: 10, name: 'October'   },
        { value: 11, name: 'November'  },
        { value: 12, name: 'December'  }
      ],
      subscription: req.subscription || null,
      runCount,
      TRIAL_RUN_LIMIT
    });
  } catch (err) {
    console.error('Get run payroll error:', err);
    req.flash('error', 'Could not load payroll form.');
    res.redirect('/payroll');
  }
};

// ─── POST /payroll/run ────────────────────────────────────────────────────────
exports.postRunPayroll = async (req, res) => {
  try {
    const companyId     = req.session.user._id;
    const selectedMonth = parseInt(req.body.month);
    const selectedYear  = parseInt(req.body.year);

    if (!selectedMonth || !selectedYear) {
      req.flash('error', 'Invalid month or year.');
      return res.redirect('/payroll/run');
    }

    // Check if this is a new run or re-processing an existing month
    const existingRun = await PayrollRun.findOne({
      company: companyId,
      month: selectedMonth,
      year: selectedYear
    }).lean();

    const isNewRun = !existingRun;

    // ── Load data ─────────────────────────────────────────────────────────────
    const settings = await getSettings(companyId);
    const employees = await Employee.find({ company: companyId, isActive: true });

    if (employees.length === 0) {
      req.flash('error', 'No active employees found.');
      return res.redirect('/payroll/run');
    }

    // ── Calculate payslips ────────────────────────────────────────────────────
    const payslips = [];

    for (const emp of employees) {
      const inputs = req.body.employees?.[emp._id.toString()] || {};

      const overtimeHours        = parseFloat(inputs.overtimeHours)        || 0;
      const taxableAllowances    = parseFloat(inputs.taxableAllowances)    || 0;
      const nonTaxableAllowances = parseFloat(inputs.nonTaxableAllowances) || 0;
      const otherDeductions      = parseFloat(inputs.otherDeductions)      || 0;
      const annualLeaveTaken     = parseFloat(inputs.annualLeaveTaken)     || 0;
      const sickLeaveTaken       = parseFloat(inputs.sickLeaveTaken)       || 0;

      const calc = calculateEmployeePayroll(emp, {
        overtimeHours,
        taxableAllowances,
        nonTaxableAllowances,
        otherDeductions
      }, {
        ecfRate:             settings.ecfRate,
        sscRate:             settings.sscRate,
        sscMonthlyCap:       settings.sscMonthlyCap,
        sscMaxContribution:  settings.sscMaxContribution,
        taxBrackets:         settings.taxBrackets,
        overtimeMultiplier:  settings.overtimeMultiplier,
        workingDaysPerMonth: settings.workingDaysPerMonth
      });

      payslips.push({
        employee: emp._id,
        employeeSnapshot: {
          fullName:   emp.fullName,
          idNumber:   emp.idNumber,
          position:   emp.position   || '',
          department: emp.department || '',
          email:      emp.email,
          phone:      emp.phone      || ''
        },
        overtimeHours,
        taxableAllowances,
        nonTaxableAllowances,
        otherDeductions,
        ...calc,
        annualLeaveTaken,   // applied last
        sickLeaveTaken
      });

      // Update leave balances if used
      if (annualLeaveTaken > 0 || sickLeaveTaken > 0) {
        emp.annualLeaveBalance = Math.max(0, emp.annualLeaveBalance - annualLeaveTaken);
        emp.sickLeaveBalance   = Math.max(0, emp.sickLeaveBalance   - sickLeaveTaken);
        await emp.save();
      }
    }

    const summary = calculatePayrollSummary(payslips);

    // ── Save / update payroll run ─────────────────────────────────────────────
    const payrollRun = await PayrollRun.findOneAndUpdate(
      { company: companyId, month: selectedMonth, year: selectedYear },
      {
        company: companyId,
        month: selectedMonth,
        year: selectedYear,
        status: 'finalised',
        payslips,
        ...summary,
        settingsSnapshot: {
          ecfRate:     settings.ecfRate,
          sscRate:     settings.sscRate,
          sscCap:      settings.sscMonthlyCap,
          taxBrackets: settings.taxBrackets
        },
        processedAt: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    req.flash('success', `Payroll for ${monthName(selectedMonth, selectedYear)} processed successfully.`);
    res.redirect(`/payroll/${payrollRun._id}`);

  } catch (err) {
    console.error('Run payroll error:', err);
    req.flash('error', 'Processing failed: ' + (err.message || 'Unknown error'));
    res.redirect('/payroll/run');
  }
};

// ─── GET /payroll/:id ─────────────────────────────────────────────────────────
exports.getPayrollRun = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({
      _id: req.params.id,
      company: req.session.user._id
    }).lean();

    if (!payrollRun) {
      req.flash('error', 'Payroll run not found.');
      return res.redirect('/payroll');
    }

    res.render('payroll/index', {
      title: `${monthName(payrollRun.month, payrollRun.year)} Payroll – NamPayroll`,
      payrollRun,
      monthName,
      moment
    });
  } catch (err) {
    console.error('Get payroll run error:', err);
    req.flash('error', 'Could not load payroll run.');
    res.redirect('/payroll');
  }
};

// ─── DELETE /payroll/:id ──────────────────────────────────────────────────────
exports.deletePayrollRun = async (req, res) => {
  try {
    await PayrollRun.findOneAndDelete({
      _id: req.params.id,
      company: req.session.user._id
    });
    req.flash('success', 'Payroll run deleted.');
    res.redirect('/payroll');
  } catch (err) {
    console.error('Delete payroll run error:', err);
    req.flash('error', 'Could not delete payroll run.');
    res.redirect('/payroll');
  }
};

// ─── DOWNLOAD HELPERS ────────────────────────────────────────────────────────

exports.downloadPayslipPDF = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({
      _id: req.params.id,
      company: req.session.user._id
    });

    if (!payrollRun) return res.status(404).send('Payroll run not found');

    const payslip = payrollRun.payslips.id(req.params.payslipId);
    if (!payslip) return res.status(404).send('Payslip not found');

    const companyUser = await User.findById(req.session.user._id).lean();
    const safeName = (payslip.employeeSnapshot?.fullName || 'employee')
      .replace(/[^a-z0-9]/gi, '_');
    const fileName = `payslip_${safeName}_${monthName(payrollRun.month, payrollRun.year).replace(' ', '_')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    generatePayslipPDF(payslip, companyUser, payrollRun.month, payrollRun.year, res);
  } catch (err) {
    console.error('Download payslip PDF error:', err);
    res.status(500).send('Could not generate PDF');
  }
};

exports.downloadAllPayslipsZip = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({
      _id: req.params.id,
      company: req.session.user._id
    });

    if (!payrollRun) return res.status(404).send('Not found');

    const companyUser = await User.findById(req.session.user._id).lean();
    const period = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="payslips_${period}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);

    for (const payslip of payrollRun.payslips) {
      const safeName = (payslip.employeeSnapshot?.fullName || 'employee')
        .replace(/[^a-z0-9]/gi, '_');
      const pdfStream = new PassThrough();
      generatePayslipPDF(payslip, companyUser, payrollRun.month, payrollRun.year, pdfStream);
      archive.append(pdfStream, { name: `payslip_${safeName}.pdf` });
    }

    await archive.finalize();
  } catch (err) {
    console.error('Download zip error:', err);
    res.status(500).send('Could not generate ZIP');
  }
};

exports.downloadBankCSV = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({
      _id: req.params.id,
      company: req.session.user._id
    }).lean();

    if (!payrollRun) return res.status(404).send('Not found');

    const companyUser = await User.findById(req.session.user._id).lean();
    const csv = await generateBankTransferCSV(payrollRun, companyUser);
    const period = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="bank_transfer_${period}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Download bank CSV error:', err);
    res.status(500).send('Could not generate CSV');
  }
};

exports.downloadComplianceCSV = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({
      _id: req.params.id,
      company: req.session.user._id
    }).lean();

    if (!payrollRun) return res.status(404).send('Not found');

    const companyUser = await User.findById(req.session.user._id).lean();
    const csv = await generateComplianceCSV(payrollRun, companyUser);
    const period = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="compliance_${period}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Download compliance CSV error:', err);
    res.status(500).send('Could not generate CSV');
  }
};

exports.downloadCompliancePDF = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({
      _id: req.params.id,
      company: req.session.user._id
    });

    if (!payrollRun) return res.status(404).send('Not found');

    const companyUser = await User.findById(req.session.user._id).lean();
    const period = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="compliance_summary_${period}.pdf"`);
    generateCompliancePDF(payrollRun, companyUser, res);
  } catch (err) {
    console.error('Download compliance PDF error:', err);
    res.status(500).send('Could not generate PDF');
  }
};