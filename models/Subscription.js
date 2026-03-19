/**
 * Subscription Model – NamPayroll
 * ─────────────────────────────────────────────────────────────────────────────
 * Tracks each company's subscription plan, status, payment history,
 * and pending payment requests.
 *
 * Billing limit enforcement is now done by counting completed PayrollRun documents,
 * so payslipsUsed counter is no longer used.
 */

const mongoose = require('mongoose');
const moment = require('moment-timezone');

// ── Payment record sub-document ───────────────────────────────────────────────
const paymentSchema = new mongoose.Schema({
  amount:       { type: Number, required: true },               // Amount in NAD
  currency:     { type: String, default: 'NAD' },
  method:       { type: String, default: 'Bank Transfer' },     // Can be extended later (Stripe, etc.)
  reference:    { type: String },                               // Bank reference or transaction ID
  proofUrl:     { type: String },                               // Path to uploaded proof file
  period:       { type: String },                               // e.g. '2025-01'
  status:       { 
    type: String, 
    enum: ['pending', 'verified', 'rejected'], 
    default: 'pending' 
  },
  verifiedAt:   { type: Date },
  verifiedBy:   { type: String },                               // Admin email who verified
  note:         { type: String },                               // Rejection/admin note
  createdAt:    { type: Date, default: Date.now }
}, { _id: true });

// ── Main subscription schema ──────────────────────────────────────────────────
const subscriptionSchema = new mongoose.Schema({
  company: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
    unique:   true,           // One subscription per company
    index:    true
  },

  // Plan type
  plan: {
    type:     String,
    enum:     ['trial', 'monthly', 'annual'],
    default:  'trial'
  },

  // Subscription status
  status: {
    type:     String,
    enum:     ['active', 'pending_payment', 'expired', 'cancelled', 'suspended'],
    default:  'active'
  },

  // Trial start (for display/reference only)
  trialStartedAt: {
    type:     Date,
    default:  Date.now
  },

  // Paid period tracking
  currentPeriodStart: { type: Date },
  currentPeriodEnd:   { type: Date },     // null for lifetime / indefinite plans
  cancelledAt:        { type: Date },

  // Pricing at time of purchase (snapshot)
  pricingSnapshot: {
    monthlyRate: { type: Number },
    annualRate:  { type: Number },
    currency:    { type: String, default: 'NAD' }
  },

  // Payment & request history
  payments: [paymentSchema],

  // Current pending upgrade/payment request (awaiting admin approval)
  pendingRequest: {
    plan:        { type: String, enum: ['monthly', 'annual'] },
    amount:      { type: Number },
    proofUrl:    { type: String },
    reference:   { type: String },
    submittedAt: { type: Date }
  }

}, { timestamps: true });

// ── Virtuals ──────────────────────────────────────────────────────────────────

/**
 * daysUntilExpiry
 * How many days remain until the current paid period ends (for monthly/annual plans)
 */
subscriptionSchema.virtual('daysUntilExpiry').get(function () {
  if (!this.currentPeriodEnd) return null;
  const diff = new Date(this.currentPeriodEnd) - new Date();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
});

/**
 * isCurrentlyActive (convenience virtual)
 * True if the subscription allows payroll processing right now
 */
subscriptionSchema.virtual('isCurrentlyActive').get(function () {
  if (this.status !== 'active') return false;

  // For paid plans: check expiry
  if (this.plan !== 'trial' && this.currentPeriodEnd) {
    return new Date() < new Date(this.currentPeriodEnd);
  }

  // Trial: always relies on run count in middleware — no virtual limit here anymore
  return true;
});

subscriptionSchema.set('toJSON',   { virtuals: true });
subscriptionSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Subscription', subscriptionSchema);