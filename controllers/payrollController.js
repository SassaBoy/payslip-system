/**
 * controllers/payrollController.js – NamPayroll
 * ─────────────────────────────────────────────────────────────────────────────
 * Complete payroll controller: processing, downloads, statutory documents.
 * Custom pay items (defined per-company in Settings) are fully supported.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const moment              = require('moment-timezone');
const archiver            = require('archiver');
const { PassThrough }     = require('stream');

const Employee     = require('../models/Employee');
const PayrollRun   = require('../models/PayrollRun');
const Settings     = require('../models/Settings');
const User         = require('../models/User');
const Subscription = require('../models/Subscription');

const { calculateEmployeePayroll, calculatePayrollSummary } = require('../utils/payrollCalculator');
const { generatePayslipPDF, generateCompliancePDF }         = require('../utils/pdfGenerator');
const { generateBankTransferCSV, generateComplianceCSV }    = require('../utils/csvGenerator');
const { generateETXBuffer }                                  = require('../utils/etxGenerator');
const { generateSSCForm }                                    = require('../utils/sscFormGenerator');
const { generatePAYE5Certificate, appendAllPAYE5ToZip }     = require('../utils/paye5Generator');

const { TRIAL_RUN_LIMIT } = require('../middleware/subscriptionMiddleware');
const MAX_TRIAL_RUNS = TRIAL_RUN_LIMIT || 2;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getSettings(companyId) {
  let settings = await Settings.findOne({ company: companyId });
  if (!settings) settings = await Settings.create({ company: companyId });
  return settings;
}

function monthName(month, year) {
  return moment(`${year}-${String(month).padStart(2, '00')}-01`).format('MMMM YYYY');
}

// ── GET /payroll — History ────────────────────────────────────────────────────
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

// ── GET /payroll/run ──────────────────────────────────────────────────────────
exports.getRunPayroll = async (req, res) => {
  try {
    const companyId = req.session.user._id;
    const now       = moment().tz('Africa/Windhoek');

    const selectedMonth = parseInt(req.query.month) || now.month() + 1;
    const selectedYear  = parseInt(req.query.year)  || now.year();

    const existingRun = await PayrollRun.findOne({
      company: companyId, month: selectedMonth, year: selectedYear
    }).lean();

    const employees = await Employee.find({ company: companyId, isActive: true })
      .sort({ fullName: 1 })
      .lean();

    const settings = await getSettings(companyId);

    // Only active custom items go to the view — these become the dynamic columns
    const customPayItems = (settings.customPayItems || []).filter(i => i.isActive);

    const years = [];
    for (let y = now.year() - 2; y <= now.year() + 1; y++) years.push(y);

    const runCount = await PayrollRun.countDocuments({ company: companyId, status: 'finalised' });

    res.render('payroll/run', {
      title: 'Run Payroll – NamPayroll',
      employees,
      selectedMonth,
      selectedYear,
      existing:        existingRun,
      customPayItems,                // ← dynamic columns for this company
      years,
      months: [
        { value: 1,  name: 'January'   }, { value: 2,  name: 'February'  },
        { value: 3,  name: 'March'     }, { value: 4,  name: 'April'     },
        { value: 5,  name: 'May'       }, { value: 6,  name: 'June'      },
        { value: 7,  name: 'July'      }, { value: 8,  name: 'August'    },
        { value: 9,  name: 'September' }, { value: 10, name: 'October'   },
        { value: 11, name: 'November'  }, { value: 12, name: 'December'  }
      ],
      subscription:    req.subscription || null,
      runCount,
      TRIAL_RUN_LIMIT: MAX_TRIAL_RUNS
    });
  } catch (err) {
    console.error('Get run payroll error:', err);
    req.flash('error', 'Could not load payroll form.');
    res.redirect('/payroll');
  }
};

// ── POST /payroll/run ─────────────────────────────────────────────────────────
exports.postRunPayroll = async (req, res) => {
  try {
    const companyId     = req.session.user._id;
    const selectedMonth = parseInt(req.body.month);
    const selectedYear  = parseInt(req.body.year);

    if (!selectedMonth || !selectedYear) {
      req.flash('error', 'Invalid month or year.');
      return res.redirect('/payroll/run');
    }

    // ── Subscription / trial gate ─────────────────────────────────────────────
    const subscription = await Subscription.findOne({ company: companyId });
    const plan         = subscription ? subscription.plan   : 'trial';
    const subStatus    = subscription ? subscription.status : 'active';

    if (plan === 'trial') {
      const alreadyRunThisMonth = await PayrollRun.findOne({
        company: companyId, month: selectedMonth, year: selectedYear
      });
      if (!alreadyRunThisMonth) {
        const totalFinalisedRuns = await PayrollRun.countDocuments({
          company: companyId, status: 'finalised'
        });
        if (totalFinalisedRuns >= MAX_TRIAL_RUNS) {
          req.flash('error', `Free trial limit reached. You've used all ${MAX_TRIAL_RUNS} free payroll runs. Please upgrade to continue.`);
          return res.redirect('/subscribe');
        }
      }
    }
    if (subStatus === 'expired') {
      req.flash('error', 'Your subscription has expired. Please renew to continue processing payroll.');
      return res.redirect('/subscribe');
    }
    if (subStatus === 'pending_payment') {
      req.flash('error', 'Your payment is pending approval. Payroll will be available once verified.');
      return res.redirect('/subscribe');
    }
    // ── End gate ──────────────────────────────────────────────────────────────

    const settings  = await getSettings(companyId);
    const employees = await Employee.find({ company: companyId, isActive: true });

    if (employees.length === 0) {
      req.flash('error', 'No active employees found.');
      return res.redirect('/payroll/run');
    }

    // Active custom items define the variable columns for this run
    const customPayItems = (settings.customPayItems || []).filter(i => i.isActive);

    const payslips = [];

    for (const emp of employees) {
      const inputs = req.body.employees?.[emp._id.toString()] || {};

      // Standard always-present inputs
      const overtimeHours    = parseFloat(inputs.overtimeHours)    || 0;
      const annualLeaveTaken = parseFloat(inputs.annualLeaveTaken) || 0;
      const sickLeaveTaken   = parseFloat(inputs.sickLeaveTaken)   || 0;

      // ── Read custom item values from form ─────────────────────────────────
      // Form field name pattern: employees[empId][custom][itemId]
      const customInputs  = inputs.custom || {};
      const customItems   = [];
      let extraTaxable    = 0;
      let extraNonTaxable = 0;
      let extraDeductions = 0;

      for (const item of customPayItems) {
        const itemIdStr = item._id.toString();
        const rawVal    = customInputs[itemIdStr];

        // Fixed items: use defaultAmount unless the admin explicitly changed it
        const amount = (item.inputMode === 'fixed' && (rawVal === undefined || rawVal === ''))
          ? (item.defaultAmount || 0)
          : (parseFloat(rawVal) || 0);

        customItems.push({ itemId: item._id, name: item.name, type: item.type, amount });

        if (item.type === 'earning_taxable')    extraTaxable    += amount;
        if (item.type === 'earning_nontaxable') extraNonTaxable += amount;
        if (item.type === 'deduction')          extraDeductions += amount;
      }

      // Derive the three calculation buckets
      // If company has custom items, the buckets come from them.
      // If no custom items, fall back to the legacy single-bucket form fields
      // (supports companies that haven't set up custom items yet)
      const taxableAllowances    = customPayItems.length > 0
        ? extraTaxable
        : (parseFloat(inputs.taxableAllowances)    || 0);
      const nonTaxableAllowances = customPayItems.length > 0
        ? extraNonTaxable
        : (parseFloat(inputs.nonTaxableAllowances) || 0);
      const otherDeductions      = customPayItems.length > 0
        ? extraDeductions
        : (parseFloat(inputs.otherDeductions)      || 0);

      const calc = calculateEmployeePayroll(emp, {
        overtimeHours, taxableAllowances, nonTaxableAllowances, otherDeductions
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
          fullName:          emp.fullName,
          idNumber:          emp.idNumber,
          tinNumber:         emp.tinNumber              || '',
          sscNumber:         emp.socialSecurityNumber   || '',
          position:          emp.position               || '',
          department:        emp.department             || '',
          email:             emp.email,
          phone:             emp.phone                  || '',
          bankAccountNumber: emp.bankAccountNumber      || '',
          branchCode:        emp.bankBranchCode         || '',
          accountType:       emp.accountType            || ''
        },
        overtimeHours,
        taxableAllowances,
        nonTaxableAllowances,
        otherDeductions,
        customItems,   // stored per-payslip so PDF can render named rows
        ...calc,
        annualLeaveTaken,
        sickLeaveTaken
      });

      if (annualLeaveTaken > 0 || sickLeaveTaken > 0) {
        emp.annualLeaveBalance = Math.max(0, emp.annualLeaveBalance - annualLeaveTaken);
        emp.sickLeaveBalance   = Math.max(0, emp.sickLeaveBalance   - sickLeaveTaken);
        await emp.save();
      }
    }

    const summary = calculatePayrollSummary(payslips);

    const payrollRun = await PayrollRun.findOneAndUpdate(
      { company: companyId, month: selectedMonth, year: selectedYear },
      {
        company: companyId,
        month:   selectedMonth,
        year:    selectedYear,
        status:  'finalised',
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

// ── GET /payroll/:id ──────────────────────────────────────────────────────────
exports.getPayrollRun = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({
      _id: req.params.id, company: req.session.user._id
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

// ── DELETE /payroll/:id ───────────────────────────────────────────────────────
exports.deletePayrollRun = async (req, res) => {
  try {
    await PayrollRun.findOneAndDelete({ _id: req.params.id, company: req.session.user._id });
    req.flash('success', 'Payroll run deleted.');
    res.redirect('/payroll');
  } catch (err) {
    console.error('Delete payroll run error:', err);
    req.flash('error', 'Could not delete payroll run.');
    res.redirect('/payroll');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PAYSLIP DOWNLOADS
// ─────────────────────────────────────────────────────────────────────────────

exports.downloadPayslipPDF = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({ _id: req.params.id, company: req.session.user._id });
    if (!payrollRun) return res.status(404).send('Payroll run not found');

    const payslip = payrollRun.payslips.id(req.params.payslipId);
    if (!payslip) return res.status(404).send('Payslip not found');

    const companyUser = await User.findById(req.session.user._id).lean();
    const settings    = await Settings.findOne({ company: req.session.user._id }).lean();
    const theme       = settings?.payslipTheme || {};

    const safeName = (payslip.employeeSnapshot?.fullName || 'employee').replace(/[^a-z0-9]/gi, '_');
    const fileName = `payslip_${safeName}_${monthName(payrollRun.month, payrollRun.year).replace(' ', '_')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    generatePayslipPDF(payslip, companyUser, payrollRun.month, payrollRun.year, res, theme);
  } catch (err) {
    console.error('Download payslip PDF error:', err);
    res.status(500).send('Could not generate PDF');
  }
};

exports.downloadAllPayslipsZip = async (req, res) => {
  try {
    const payrollRun = await PayrollRun.findOne({ _id: req.params.id, company: req.session.user._id });
    if (!payrollRun) return res.status(404).send('Not found');

    const companyUser = await User.findById(req.session.user._id).lean();
    const settings    = await Settings.findOne({ company: req.session.user._id }).lean();
    const theme       = settings?.payslipTheme || {};
    const period      = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="payslips_${period}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);

    for (const payslip of payrollRun.payslips) {
      const safeName  = (payslip.employeeSnapshot?.fullName || 'employee').replace(/[^a-z0-9]/gi, '_');
      const pdfStream = new PassThrough();
      generatePayslipPDF(payslip, companyUser, payrollRun.month, payrollRun.year, pdfStream, theme);
      archive.append(pdfStream, { name: `payslip_${safeName}.pdf` });
    }

    await archive.finalize();
  } catch (err) {
    console.error('Download zip error:', err);
    res.status(500).send('Could not generate ZIP');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CSV DOWNLOADS
// ─────────────────────────────────────────────────────────────────────────────

exports.downloadBankCSV = async (req, res) => {
  try {
    const payrollRun  = await PayrollRun.findOne({ _id: req.params.id, company: req.session.user._id }).lean();
    if (!payrollRun) return res.status(404).send('Not found');
    const companyUser = await User.findById(req.session.user._id).lean();
    const csv         = await generateBankTransferCSV(payrollRun, companyUser);
    const period      = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');
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
    const payrollRun  = await PayrollRun.findOne({ _id: req.params.id, company: req.session.user._id }).lean();
    if (!payrollRun) return res.status(404).send('Not found');
    const companyUser = await User.findById(req.session.user._id).lean();
    const csv         = await generateComplianceCSV(payrollRun, companyUser);
    const period      = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');
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
    const payrollRun  = await PayrollRun.findOne({ _id: req.params.id, company: req.session.user._id });
    if (!payrollRun) return res.status(404).send('Not found');
    const companyUser = await User.findById(req.session.user._id).lean();
    const period      = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="compliance_summary_${period}.pdf"`);
    generateCompliancePDF(payrollRun, companyUser, res);
  } catch (err) {
    console.error('Download compliance PDF error:', err);
    res.status(500).send('Could not generate PDF');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// NAMIBIAN STATUTORY DOCUMENTS
// ─────────────────────────────────────────────────────────────────────────────

exports.downloadETX = async (req, res) => {
  try {
    const companyId  = req.session.user._id;
    const payrollRun = await PayrollRun.findOne({ _id: req.params.id, company: companyId }).lean();
    if (!payrollRun) return res.status(404).send('Payroll run not found');

    const taxYear = payrollRun.month >= 3 ? payrollRun.year : payrollRun.year - 1;
    const allRuns = await PayrollRun.find({
      company: companyId, status: 'finalised',
      $or: [{ year: taxYear, month: { $gte: 3 } }, { year: taxYear + 1, month: { $lte: 2 } }]
    }).lean();

    const employees = await Employee.find({ company: companyId }).lean();
    const buffer    = await generateETXBuffer(allRuns, employees, taxYear);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ETX_PAYE4_${taxYear}_${taxYear + 1}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('ETX download error:', err);
    res.status(500).send('Could not generate ETX file');
  }
};

exports.downloadSSCForm = async (req, res) => {
  try {
    const payrollRun  = await PayrollRun.findOne({ _id: req.params.id, company: req.session.user._id });
    if (!payrollRun) return res.status(404).send('Not found');
    const companyUser = await User.findById(req.session.user._id).lean();
    const period      = monthName(payrollRun.month, payrollRun.year).replace(' ', '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="SSC_Form10a_${period}.pdf"`);
    generateSSCForm(payrollRun, companyUser, res);
  } catch (err) {
    console.error('SSC form download error:', err);
    res.status(500).send('Could not generate SSC form');
  }
};

exports.downloadPAYE5Single = async (req, res) => {
  try {
    const companyId  = req.session.user._id;
    const payrollRun = await PayrollRun.findOne({ _id: req.params.id, company: companyId }).lean();
    if (!payrollRun) return res.status(404).send('Not found');

    const taxYear = payrollRun.month >= 3 ? payrollRun.year : payrollRun.year - 1;
    const allRuns = await PayrollRun.find({
      company: companyId, status: 'finalised',
      $or: [{ year: taxYear, month: { $gte: 3 } }, { year: taxYear + 1, month: { $lte: 2 } }]
    }).lean();

    const employee    = await Employee.findOne({ _id: req.params.employeeId, company: companyId }).lean();
    if (!employee) return res.status(404).send('Employee not found');

    const companyUser = await User.findById(companyId).lean();
    const empIdStr    = req.params.employeeId;

    const annualData = {
      annualSalary: 0, annualOTPay: 0, annualTaxAllow: 0,
      annualNonTaxAllow: 0, annualGross: 0, annualTaxGross: 0,
      annualPAYE: 0, annualSSCEmployee: 0
    };

    for (const run of allRuns) {
      for (const ps of run.payslips) {
        if (ps.employee?.toString() !== empIdStr) continue;
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

    const pensionAnn            = (employee.pensionContribution    || 0) * 12;
    const medicalAnn            = (employee.medicalAidContribution || 0) * 12;
    annualData.annualDeductions = pensionAnn + medicalAnn + annualData.annualSSCEmployee;
    annualData.taxableIncome    = Math.max(0, annualData.annualTaxGross - pensionAnn - medicalAnn);

    const safeName = (employee.fullName || 'employee').replace(/[^a-z0-9]/gi, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="PAYE5_${safeName}_${taxYear}.pdf"`);
    generatePAYE5Certificate(annualData, employee, companyUser, taxYear, res);
  } catch (err) {
    console.error('PAYE5 download error:', err);
    res.status(500).send('Could not generate PAYE5 certificate');
  }
};

exports.downloadPAYE5All = async (req, res) => {
  try {
    const companyId  = req.session.user._id;
    const payrollRun = await PayrollRun.findOne({ _id: req.params.id, company: companyId }).lean();
    if (!payrollRun) return res.status(404).send('Not found');

    const taxYear = payrollRun.month >= 3 ? payrollRun.year : payrollRun.year - 1;
    const allRuns = await PayrollRun.find({
      company: companyId, status: 'finalised',
      $or: [{ year: taxYear, month: { $gte: 3 } }, { year: taxYear + 1, month: { $lte: 2 } }]
    }).lean();

    const employees   = await Employee.find({ company: companyId }).lean();
    const companyUser = await User.findById(companyId).lean();

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="PAYE5_All_${taxYear}_${taxYear + 1}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);
    appendAllPAYE5ToZip(allRuns, employees, companyUser, taxYear, archive);
    await archive.finalize();
  } catch (err) {
    console.error('PAYE5 all download error:', err);
    res.status(500).send('Could not generate PAYE5 ZIP');
  }
};