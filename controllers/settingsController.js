/**
 * controllers/settingsController.js – NamPayroll
 */

const Settings = require('../models/Settings');

// ── GET /settings ─────────────────────────────────────────────────────────────
exports.getSettings = async (req, res) => {
  try {
    let settings = await Settings.findOne({ company: req.session.user._id });
    if (!settings) settings = await Settings.create({ company: req.session.user._id });

    res.render('settings/index', {
      title:    'Settings – NamPayroll',
      settings: settings.toObject()
    });
  } catch (err) {
    console.error('Get settings error:', err);
    req.flash('error', 'Could not load settings.');
    res.redirect('/dashboard');
  }
};

// ── POST /settings ────────────────────────────────────────────────────────────
exports.updateSettings = async (req, res) => {
  try {
    const {
      ecfRate, sscRate, sscMonthlyCap, sscMaxContribution,
      overtimeMultiplier, workingDaysPerMonth,
      themeAccentColor, themeShowEmployerContributions,
      themeShowLeaveBalances, themeShowRefNumber, themeFooterNote
    } = req.body;

    const updates = {};

    if (ecfRate             !== undefined) updates.ecfRate             = parseFloat(ecfRate)             / 100;
    if (sscRate             !== undefined) updates.sscRate             = parseFloat(sscRate)             / 100;
    if (sscMonthlyCap       !== undefined) updates.sscMonthlyCap       = parseFloat(sscMonthlyCap);
    if (sscMaxContribution  !== undefined) updates.sscMaxContribution  = parseFloat(sscMaxContribution);
    if (overtimeMultiplier  !== undefined) updates.overtimeMultiplier  = parseFloat(overtimeMultiplier);
    if (workingDaysPerMonth !== undefined) updates.workingDaysPerMonth = parseInt(workingDaysPerMonth);

    const hexOk = /^#[0-9a-fA-F]{6}$/.test(themeAccentColor || '');
    updates['payslipTheme.accentColor']               = hexOk ? themeAccentColor : '#000000';
    updates['payslipTheme.showEmployerContributions'] = themeShowEmployerContributions === 'on';
    updates['payslipTheme.showLeaveBalances']         = themeShowLeaveBalances         === 'on';
    updates['payslipTheme.showRefNumber']             = themeShowRefNumber             === 'on';
    updates['payslipTheme.footerNote']                = (themeFooterNote || '').trim().slice(0, 300);

    await Settings.findOneAndUpdate(
      { company: req.session.user._id },
      { $set: updates },
      { upsert: true }
    );

    req.flash('success', 'Settings updated successfully.');
    res.redirect('/settings');
  } catch (err) {
    console.error('Update settings error:', err);
    req.flash('error', 'Could not save settings.');
    res.redirect('/settings');
  }
};

// ── POST /settings/custom-items ───────────────────────────────────────────────
exports.addCustomPayItem = async (req, res) => {
  try {
    const { name, type, inputMode, defaultAmount, description } = req.body;

    if (!name || !type) {
      req.flash('error', 'Item name and type are required.');
      return res.redirect('/settings#custom-items');
    }

    const settings = await Settings.findOne({ company: req.session.user._id });
    if (!settings) return res.redirect('/settings#custom-items');

    settings.customPayItems.push({
      name:          name.trim(),
      type,
      inputMode:     inputMode || 'variable',
      defaultAmount: parseFloat(defaultAmount) || 0,
      description:   (description || '').trim(),
      isActive:      true
    });

    await settings.save();
    req.flash('success', `"${name.trim()}" added — it will appear as a column on your next payroll run.`);
    res.redirect('/settings#custom-items');
  } catch (err) {
    console.error('Add custom item error:', err);
    req.flash('error', 'Could not add item.');
    res.redirect('/settings#custom-items');
  }
};

// ── POST /settings/custom-items/:itemId/delete ────────────────────────────────
exports.deleteCustomPayItem = async (req, res) => {
  try {
    const settings = await Settings.findOne({ company: req.session.user._id });
    if (!settings) return res.redirect('/settings#custom-items');

    const item = settings.customPayItems.id(req.params.itemId);
    if (item) item.isActive = false;   // soft-delete preserves history

    await settings.save();
    req.flash('success', 'Item removed from future payroll runs.');
    res.redirect('/settings#custom-items');
  } catch (err) {
    console.error('Delete custom item error:', err);
    req.flash('error', 'Could not remove item.');
    res.redirect('/settings#custom-items');
  }
};

// ── POST /settings/custom-items/:itemId/toggle ────────────────────────────────
exports.toggleCustomPayItem = async (req, res) => {
  try {
    const settings = await Settings.findOne({ company: req.session.user._id });
    if (!settings) return res.redirect('/settings#custom-items');

    const item = settings.customPayItems.id(req.params.itemId);
    if (item) item.isActive = !item.isActive;

    await settings.save();
    res.redirect('/settings#custom-items');
  } catch (err) {
    console.error('Toggle custom item error:', err);
    res.redirect('/settings#custom-items');
  }
};