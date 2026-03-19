/**
 * subscriptionController.js – NamPayroll
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles:
 *   GET  /subscribe             — Pricing / upgrade page
 *   POST /subscribe/request     — Submit payment proof (manual bank transfer)
 *   GET  /admin/subscriptions   — Admin list of pending approvals
 *   POST /admin/subscriptions/:id/approve  — Approve a payment
 *   POST /admin/subscriptions/:id/reject   — Reject a payment
 */

const Subscription = require('../models/Subscription');
const User = require('../models/User');
const { PLANS, TRIAL_LIMIT } = require('../middleware/subscriptionMiddleware');
const moment = require('moment-timezone');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ── Proof of payment upload ───────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'payment-proofs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const name = `proof-${req.session.user._id}-${Date.now()}${ext}`;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only JPG, PNG, or PDF files are accepted.'));
  }
});
exports.uploadProof = upload.single('proofFile');

// ── GET /subscribe ────────────────────────────────────────────────────────────
exports.getSubscribePage = async (req, res) => {
  try {
    const companyId = req.session.user._id;
    let sub = await Subscription.findOne({ company: companyId });
    if (!sub) sub = await Subscription.create({ company: companyId });

    res.render('subscription/pricing', {
      title: 'Upgrade Your Plan – NamPayroll',
      subscription: sub,
      plans: PLANS,
      trialLimit: TRIAL_LIMIT,
      bankDetails: {
        bankName:      process.env.BANK_NAME      || 'Bank Windhoek',
        accountName:   process.env.BANK_ACC_NAME  || 'NamPayroll (Pty) Ltd',
        accountNumber: process.env.BANK_ACC_NUM   || '8XXXXXXXXX',
        branchCode:    process.env.BANK_BRANCH    || '483 772',
        reference:     `NP-${String(companyId).slice(-6).toUpperCase()}`
      }
    });
  } catch (err) {
    console.error('Subscribe page error:', err);
    req.flash('error', 'Could not load subscription page.');
    res.redirect('/dashboard');
  }
};

// ── POST /subscribe/request ───────────────────────────────────────────────────
exports.postSubscribeRequest = async (req, res) => {
  try {
    const companyId = req.session.user._id;
    const { plan, reference } = req.body;

    if (!['monthly', 'annual'].includes(plan)) {
      req.flash('error', 'Invalid plan selected.');
      return res.redirect('/subscribe');
    }

    const proofUrl = req.file ? `/uploads/payment-proofs/${req.file.filename}` : null;
    const amount   = PLANS[plan].price;

    const sub = await Subscription.findOneAndUpdate(
      { company: companyId },
      {
        $set: {
          status: 'pending_payment',
          pendingRequest: {
            plan,
            amount,
            proofUrl,
            reference: reference?.trim() || '',
            submittedAt: new Date()
          }
        }
      },
      { upsert: true, new: true }
    );

    req.flash('success', `Your ${PLANS[plan].label} plan request has been submitted. We'll verify your payment within 1 business day and notify you by email.`);
    res.redirect('/subscribe');
  } catch (err) {
    console.error('Subscribe request error:', err);
    req.flash('error', 'Failed to submit request. Please try again.');
    res.redirect('/subscribe');
  }
};

// ── GET /admin/subscriptions ──────────────────────────────────────────────────
exports.getAdminSubscriptions = async (req, res) => {
  try {
    const pending = await Subscription.find({ status: 'pending_payment' })
      .populate('company', 'companyName email ownerName')
      .sort({ updatedAt: -1 })
      .lean();

    const all = await Subscription.find({})
      .populate('company', 'companyName email ownerName')
      .sort({ updatedAt: -1 })
      .lean();

    res.render('subscription/admin', {
      title: 'Subscription Management – NamPayroll Admin',
      pending,
      all,
      plans: PLANS,
      moment
    });
  } catch (err) {
    console.error('Admin subscriptions error:', err);
    req.flash('error', 'Could not load subscriptions.');
    res.redirect('/dashboard');
  }
};

// ── POST /admin/subscriptions/:id/approve ─────────────────────────────────────
exports.approveSubscription = async (req, res) => {
  try {
    const sub = await Subscription.findById(req.params.id).populate('company');
    if (!sub || !sub.pendingRequest) {
      req.flash('error', 'Subscription or pending request not found.');
      return res.redirect('/admin/subscriptions');
    }

    const { plan, amount, proofUrl, reference } = sub.pendingRequest;
    const now   = new Date();
    const end   = plan === 'annual'
      ? moment(now).add(1, 'year').toDate()
      : moment(now).add(1, 'month').toDate();

    // Record the verified payment
    sub.payments.push({
      amount,
      method: 'Bank Transfer',
      reference,
      proofUrl,
      period:     moment(now).format('YYYY-MM'),
      status:     'verified',
      verifiedAt: now,
      verifiedBy: req.session?.user?.email || 'admin'
    });

    sub.plan               = plan;
    sub.status             = 'active';
    sub.currentPeriodStart = now;
    sub.currentPeriodEnd   = end;
    sub.pendingRequest     = undefined;
    sub.pricingSnapshot    = { monthlyRate: PLANS.monthly.price, annualRate: PLANS.annual.price, currency: 'NAD' };

    await sub.save({ validateBeforeSave: false });

    req.flash('success', `${sub.company.companyName}'s ${plan} plan approved. Active until ${moment(end).format('DD MMM YYYY')}.`);
    res.redirect('/admin/subscriptions');
  } catch (err) {
    console.error('Approve subscription error:', err);
    req.flash('error', 'Approval failed.');
    res.redirect('/admin/subscriptions');
  }
};

// ── POST /admin/subscriptions/:id/reject ──────────────────────────────────────
exports.rejectSubscription = async (req, res) => {
  try {
    const { note } = req.body;
    const sub = await Subscription.findById(req.params.id);
    if (!sub) {
      req.flash('error', 'Subscription not found.');
      return res.redirect('/admin/subscriptions');
    }

    // Record the rejected payment
    if (sub.pendingRequest) {
      sub.payments.push({
        amount:    sub.pendingRequest.amount,
        method:    'Bank Transfer',
        reference: sub.pendingRequest.reference,
        proofUrl:  sub.pendingRequest.proofUrl,
        status:    'rejected',
        note:      note || 'Payment could not be verified.',
        verifiedBy: req.session?.user?.email || 'admin'
      });
    }

    // Revert to previous status (trial if first time, expired if lapsed)
    sub.status         = sub.plan === 'trial' ? 'active' : 'expired';
    sub.pendingRequest = undefined;
    await sub.save({ validateBeforeSave: false });

    req.flash('success', 'Payment rejected. The company has been notified.');
    res.redirect('/admin/subscriptions');
  } catch (err) {
    console.error('Reject subscription error:', err);
    req.flash('error', 'Rejection failed.');
    res.redirect('/admin/subscriptions');
  }
};
