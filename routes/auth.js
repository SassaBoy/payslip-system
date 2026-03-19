const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { redirectIfAdmin } = require('../middleware/auth');
const upload = require('../middleware/upload');


// Root
router.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/login');
});

// REGISTER ROUTES
router.get('/register', redirectIfAdmin, authController.getRegister);

router.post('/register', 
  redirectIfAdmin,
  // 1. Multer MUST run FIRST to parse the text fields from multipart/form-data
  upload.single('companyLogo'),
  // 2. Now that req.body is populated, run validation
  [
    body('firstName').trim().notEmpty().withMessage('First name is required'),
    body('lastName').trim().notEmpty().withMessage('Last name is required'),
    body('companyName').trim().notEmpty().withMessage('Company name is required'),
    body('numEmployees').notEmpty().withMessage('Number of employees is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('phone').trim().notEmpty().withMessage('Telephone number is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('confirmPassword').custom((value, { req }) => {
      if (value !== req.body.password) throw new Error('Passwords do not match');
      return true;
    })
  ],
  // 3. Controller handles the logic
  authController.postRegister
);

// Login
router.get('/login', redirectIfAdmin, authController.getLogin);
router.post('/login', redirectIfAdmin, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password is required')
], authController.postLogin);

router.get('/verify-email', authController.verifyEmail);
router.post('/logout', authController.logout);

router.get('/forgot-password', authController.getForgotPassword);
router.post('/forgot-password', authController.postForgotPassword);
router.get('/reset-password/:token', authController.getResetPassword);
router.post('/reset-password/:token', authController.postResetPassword);

module.exports = router;