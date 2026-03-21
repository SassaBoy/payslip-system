const express = require('express');
const router  = express.Router();
const { requireAdmin } = require('../middleware/auth');
const payrollController = require('../controllers/payrollController');

// ── Payroll history ───────────────────────────────────────────────────────────
router.get('/', requireAdmin, payrollController.getPayrollHistory);

// ── Run payroll ───────────────────────────────────────────────────────────────
router.get('/run',  requireAdmin, payrollController.getRunPayroll);
router.post('/run', requireAdmin, payrollController.postRunPayroll);

// ── Single payroll run view ───────────────────────────────────────────────────
router.get('/:id', requireAdmin, payrollController.getPayrollRun);

// ── Delete a run ──────────────────────────────────────────────────────────────
router.delete('/:id', requireAdmin, payrollController.deletePayrollRun);

// ─── Per-payslip downloads ────────────────────────────────────────────────────

// Single payslip PDF
router.get('/:id/payslip/:payslipId/pdf',     requireAdmin, payrollController.downloadPayslipPDF);

// All payslips ZIP
router.get('/:id/zip',                        requireAdmin, payrollController.downloadAllPayslipsZip);

// ─── Compliance documents ─────────────────────────────────────────────────────

// Compliance summary PDF
router.get('/:id/compliance-pdf',             requireAdmin, payrollController.downloadCompliancePDF);

// Compliance summary CSV
router.get('/:id/compliance-csv',             requireAdmin, payrollController.downloadComplianceCSV);

// Bank transfer CSV
router.get('/:id/bank-csv',                   requireAdmin, payrollController.downloadBankCSV);

// ─── Namibian statutory documents ────────────────────────────────────────────

// NamRA ETX / PAYE4 XLSX — annual reconciliation (aggregates full tax year)
router.get('/:id/etx',                        requireAdmin, payrollController.downloadETX);

// SSC Form 10(a) — pre-filled PDF for this payroll month
router.get('/:id/ssc-form',                   requireAdmin, payrollController.downloadSSCForm);

// PAYE5 / ITA5 tax certificate — single employee (tax year aggregate)
router.get('/:id/paye5/:employeeId',          requireAdmin, payrollController.downloadPAYE5Single);

// PAYE5 / ITA5 — all employees as ZIP
router.get('/:id/paye5-all',                  requireAdmin, payrollController.downloadPAYE5All);

module.exports = router;