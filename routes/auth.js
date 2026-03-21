/**
 * routes/auth.js
 */

const express = require('express');
const router  = express.Router();
const { body } = require('express-validator');
const authController           = require('../controllers/authController');
const { redirectIfAdmin }      = require('../middleware/auth');
const upload                   = require('../middleware/upload');

// Root redirect
router.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/login');
});

// ── REGISTER ──────────────────────────────────────────────────────────────────
router.get('/register', redirectIfAdmin, authController.getRegister);

router.post('/register',
  redirectIfAdmin,
  upload.single('companyLogo'),   // multer first — populates req.body
  [
    // Personal
    body('firstName').trim().notEmpty().withMessage('First name is required'),
    body('lastName').trim().notEmpty().withMessage('Last name is required'),

    // Company
    body('companyName').trim().notEmpty().withMessage('Company name is required'),
    body('numEmployees').notEmpty().withMessage('Number of employees is required'),
    body('phone').trim().notEmpty().withMessage('Phone number is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),

    // Address
    body('postalAddress').trim().notEmpty().withMessage('Postal address is required (needed for SSC Form 10a)'),

    // Statutory numbers — optional at registration but validated if provided
    body('tinNumber').optional({ checkFalsy: true })
      .trim()
      .matches(/^\d{10}$/).withMessage('TIN must be exactly 10 digits'),
    body('sscNumber').optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 30 }).withMessage('SSC number cannot exceed 30 characters'),
    body('payeRegNo').optional({ checkFalsy: true })
      .trim()
      .isLength({ max: 30 }).withMessage('PAYE registration number cannot exceed 30 characters'),

    // Security
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('confirmPassword').custom((value, { req }) => {
      if (value !== req.body.password) throw new Error('Passwords do not match');
      return true;
    })
  ],
  authController.postRegister
);

// ── LOGIN ─────────────────────────────────────────────────────────────────────
router.get('/login', redirectIfAdmin, authController.getLogin);
router.post('/login', redirectIfAdmin, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password is required')
], authController.postLogin);

// ── EMAIL VERIFICATION ────────────────────────────────────────────────────────
router.get('/verify-email', authController.verifyEmail);
router.get('/resend-verification', authController.getResendVerification);

// ── LOGOUT ────────────────────────────────────────────────────────────────────
router.post('/logout', authController.logout);

// ── PASSWORD RESET ────────────────────────────────────────────────────────────
router.get('/forgot-password',         authController.getForgotPassword);
router.post('/forgot-password',        authController.postForgotPassword);
router.get('/reset-password/:token',   authController.getResetPassword);
router.post('/reset-password/:token',  authController.postResetPassword);

module.exports = router;