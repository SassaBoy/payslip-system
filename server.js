/**
 * NamPayroll - Namibian Payroll SaaS
 * Main application server
 */
require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const MongoStore   = require('connect-mongo');
const flash        = require('connect-flash');
const methodOverride = require('method-override');
const path         = require('path');
const connectDB    = require('./config/db');
const moment       = require('moment-timezone');

const { attachSubscription } = require('./middleware/subscriptionMiddleware');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Database ──────────────────────────────────────────────────────────────────
connectDB();

// ── View Engine ───────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Core Middleware ───────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

// ── Session ───────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_secret_change_in_production',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    touchAfter: 24 * 3600
  }),
  cookie: {
    maxAge:   1000 * 60 * 60 * 24 * 7, // 7 days
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production'
  }
}));

// ── Flash ─────────────────────────────────────────────────────────────────────
app.use(flash());

// ── Global Template Variables ─────────────────────────────────────────────────
// Runs on every request — makes user, flash messages, moment, and subscription
// available in every EJS template without needing to pass them manually.
app.use((req, res, next) => {
  res.locals.user       = req.session.user     || null;
  res.locals.employee   = req.session.employee || null;
  res.locals.success    = req.flash('success');
  res.locals.error      = req.flash('error');
  res.locals.formData   = req.body || {};
  res.locals.moment     = moment; // used in payroll views for date formatting
  next();
});

// ── Subscription Attachment ───────────────────────────────────────────────────
// Attaches req.subscription and res.locals.subscription to every authenticated
// request so all views can read plan/trial status for banners, nav badges, etc.
// This never blocks — it only reads. Blocking happens inside requireSubscription
// which is applied per-route in the payroll router.
app.use((req, res, next) => {
  if (req.session.user) return attachSubscription(req, res, next);
  next();
});

// ── Application Routes ────────────────────────────────────────────────────────
app.use('/',          require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/employees', require('./routes/employees'));
app.use('/payroll',   require('./routes/payroll'));
app.use('/portal',    require('./routes/portal'));
app.use('/settings',  require('./routes/settings'));

// ── Subscription Routes (/subscribe, /admin/subscriptions) ────────────────────
app.use('/', require('./routes/subscriptionRoutes'));

// ── Static Legal & Support Pages ─────────────────────────────────────────────
app.get('/terms',   (req, res) => res.render('terms',   { title: 'Terms of Service – NamPayroll' }));
app.get('/privacy', (req, res) => res.render('privacy', { title: 'Privacy Policy – NamPayroll' }));
app.get('/support', (req, res) => res.render('support', { title: 'Support – NamPayroll' }));

// ── 404 Handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('404', { title: '404 – Page Not Found' });
});

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).render('500', {
    title: 'Server Error',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// ── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ NamPayroll running at http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;