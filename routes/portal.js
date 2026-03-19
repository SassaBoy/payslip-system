const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { requireEmployee, redirectIfEmployee } = require('../middleware/auth');
const portalController = require('../controllers/portalController');

// Helper: Redirect root portal to login
router.get('/', (req, res) => res.redirect('/portal/login'));

// --- Authentication ---
router.get('/login', redirectIfEmployee, portalController.getLogin);

router.post('/login', redirectIfEmployee, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required')
], portalController.postLogin);

// NEW: Email Verification Route
// This matches the link sent in the createEmployee email
router.get('/verify-email', portalController.getVerifyEmail);

router.post('/logout', portalController.logout);

// --- Protected Employee Routes ---
router.get('/dashboard', requireEmployee, portalController.getDashboard);
router.get('/payslip/:runId/:payslipId/pdf', requireEmployee, portalController.downloadPayslipPDF);

module.exports = router;