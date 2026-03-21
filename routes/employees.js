const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const { body } = require('express-validator');
const { requireAdmin }     = require('../middleware/auth');
const employeeController   = require('../controllers/employeeController');

const upload = multer({ storage: multer.memoryStorage() });

const employeeValidation = [
  body('fullName').trim().notEmpty().withMessage('Full name is required'),
  body('idNumber').trim().notEmpty().withMessage('ID number is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('basicSalary').isFloat({ min: 0 }).withMessage('Valid salary required'),
  body('dateJoined').notEmpty().withMessage('Date joined is required')
];

router.get('/',    requireAdmin, employeeController.getEmployees);
router.get('/new', requireAdmin, employeeController.getNewEmployee);

// ── CSV bulk import — must be above /:id routes ───────────────────────────────
router.post('/import-csv', requireAdmin, upload.single('csvFile'), employeeController.importEmployeesCSV);

router.post('/',       requireAdmin, employeeValidation, employeeController.createEmployee);
router.get('/:id/edit',requireAdmin, employeeController.getEditEmployee);
router.put('/:id',     requireAdmin, employeeValidation, employeeController.updateEmployee);
router.delete('/:id',  requireAdmin, employeeController.deleteEmployee);

module.exports = router;