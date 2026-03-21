/**
 * routes/settings.js – NamPayroll
 */

const express            = require('express');
const router             = express.Router();
const { requireAdmin }   = require('../middleware/auth');
const settingsController = require('../controllers/settingsController');

// ── Main settings page ────────────────────────────────────────────────────────
router.get('/',  requireAdmin, settingsController.getSettings);
router.post('/', requireAdmin, settingsController.updateSettings);

// ── Custom pay items CRUD ─────────────────────────────────────────────────────
// NOTE: These must be defined BEFORE any /:id style routes if you add them later.
router.post('/custom-items',                requireAdmin, settingsController.addCustomPayItem);
router.post('/custom-items/:itemId/toggle', requireAdmin, settingsController.toggleCustomPayItem);
router.post('/custom-items/:itemId/delete', requireAdmin, settingsController.deleteCustomPayItem);

module.exports = router;