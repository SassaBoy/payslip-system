/**
 * subscriptionMiddleware.js – NamPayroll
 * ─────────────────────────────────────────────────────────────────────────────
 * Guards payroll-processing routes.
 * Blocks access if:
 *  - plan is expired / cancelled / suspended
 *  - trial user has already completed 2 payroll runs
 *
 * Usage example:
 *   const { requireSubscription } = require('../middleware/subscriptionMiddleware');
 *   router.post('/payroll/run', requireSubscription, payrollController.postRun);
 */

const Subscription = require('../models/Subscription');
const PayrollRun   = require('../models/PayrollRun');

// ── Constants ─────────────────────────────────────────────────────────────────
const PLANS = {
  monthly: { price: 299,  label: 'Monthly',  billingCycle: 'month' },
  annual:  { price: 2990, label: 'Annual',   billingCycle: 'year'  },
  trial:   { price: 0,    label: 'Free Trial', billingCycle: null   }
};

const TRIAL_RUN_LIMIT = 2;   // ← single source of truth for how many free runs

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get or create subscription document
 * @returns {Promise<Subscription>}
 */
async function ensureSubscription(companyId) {
  let sub = await Subscription.findOne({ company: companyId });
  if (!sub) {
    sub = await Subscription.create({ company: companyId });
  }
  return sub;
}

/**
 * Human-readable message shown when access is blocked
 */
function getBlockMessage(reason, trialLimit = TRIAL_RUN_LIMIT) {
  const messages = {
    trial_exhausted: `Your free trial has ended — you've used all ${trialLimit} free payroll runs. Upgrade to continue.`,
    expired:         'Your subscription has expired. Please renew to continue.',
    cancelled:       'Your subscription was cancelled. Reactivate to continue.',
    suspended:       'Your account has been suspended. Please contact support.',
    pending_payment: 'Your payment is awaiting verification. You’ll be notified once approved.'
  };
  return messages[reason] || 'Your subscription is not active. Please upgrade to continue.';
}

// ── Main guard middleware ────────────────────────────────────────────────────
/**
 * Blocks payroll processing if:
 *  - paid plan is not active
 *  - trial user has already completed >= TRIAL_RUN_LIMIT payroll runs
 */
async function requireSubscription(req, res, next) {
  try {
    const companyId = req.session?.user?._id;
    if (!companyId) {
      return res.redirect('/login');
    }

    const sub = await ensureSubscription(companyId);

    // Force-expire paid plans that are past currentPeriodEnd
    if (sub.plan !== 'trial' && sub.currentPeriodEnd && new Date() > new Date(sub.currentPeriodEnd)) {
      sub.status = 'expired';
      await sub.save({ validateBeforeSave: false });
    }

    // ── Paid plan check ────────────────────────────────────────
    if (sub.plan !== 'trial') {
      if (sub.status === 'active') {
        req.subscription = sub;
        return next();
      }

      // blocked paid plan
      req.flash('error', getBlockMessage(sub.status));
      return res.redirect('/subscribe');
    }

    // ── Trial plan check ───────────────────────────────────────
    // Count **completed payroll runs** instead of payslipsUsed
    const completedRuns = await PayrollRun.countDocuments({
      company: companyId,
      status: 'finalised'
    });

    if (completedRuns < TRIAL_RUN_LIMIT) {
      req.subscription = sub;
      return next();
    }

    // Trial exhausted
    req.flash('error', getBlockMessage('trial_exhausted'));
    return res.redirect('/subscribe');

  } catch (err) {
    console.error('Subscription middleware error:', err);
    req.flash('error', 'Unable to verify your subscription status. Please try again.');
    return res.redirect('/dashboard');
  }
}

// ── Soft check (only attaches subscription — never blocks) ───────────────────
async function attachSubscription(req, res, next) {
  try {
    const companyId = req.session?.user?._id;
    if (companyId) {
      req.subscription = await ensureSubscription(companyId);
      res.locals.subscription = req.subscription; // for views
    }
  } catch (err) {
    // silent fail — views can handle missing subscription gracefully
  }
  next();
}

// ── Optional: still increment payslipsUsed if you want stats ─────────────────
async function incrementPayslipCount(companyId, count = 1) {
  await Subscription.findOneAndUpdate(
    { company: companyId },
    { $inc: { payslipsUsed: count } },
    { upsert: true }
  );
}

module.exports = {
  requireSubscription,
  attachSubscription,
  incrementPayslipCount,        // keep only if you still display payslipsUsed somewhere
  ensureSubscription,
  PLANS,
  TRIAL_RUN_LIMIT               // renamed for clarity
};