// models/Subscription.js
const db = require("./database");

// Single Source of Truth for Plan Pricing and Tier Limits
const PLAN_PRICES = {
  free: 0,
  pro: 9000,
  premium: 17000,
  business: 34000,
};

const TIER_LIMITS = {
  free: { maxTenants: 5, feePercent: 5.0 },
  pro: { maxTenants: 8, feePercent: 3.0 },
  premium: { maxTenants: 15, feePercent: 1.0 },
  business: { maxTenants: null, feePercent: 0.0 },
};

function createSubscriptionTable() {
  return new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        landlord_id INTEGER UNIQUE,
        plan_type TEXT DEFAULT 'free' CHECK(plan_type IN ('free', 'pro', 'premium', 'business')),
        paystack_subscription_code TEXT,
        status TEXT DEFAULT 'active',
        current_period_end DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => (err ? reject(err) : resolve())
    );
  });
}

createSubscriptionTable().catch(console.error);

/**
 * Fetch subscription record and compute current active state (checking expiration)
 */
function getLandlordSubscription(landlordId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM subscriptions WHERE landlord_id = ?`,
      [landlordId],
      (err, row) => {
        if (err) return reject(err);

        // Fallback default if no record exists
        if (!row) {
          return resolve({
            landlord_id: landlordId,
            plan_type: "free",
            status: "active",
            current_period_end: null,
            is_expired: false,
            ...TIER_LIMITS.free,
          });
        }

        const rawPlan = (row.plan_type || "free").toLowerCase();
        const hasEndDate = Boolean(row.current_period_end);
        const isExpired = hasEndDate && new Date(row.current_period_end) < new Date();

        // If the subscription period has expired, default plan benefits back to 'free'
        const effectivePlan = isExpired ? "free" : rawPlan;
        const tierDetails = TIER_LIMITS[effectivePlan] || TIER_LIMITS.free;

        resolve({
          ...row,
          effective_plan: effectivePlan,
          status: isExpired ? "expired" : row.status,
          is_expired: isExpired,
          ...tierDetails,
        });
      }
    );
  });
}

/**
 * Update or insert (UPSERT) landlord subscription details
 */
function updateSubscription(landlordId, planType, subscriptionCode = null, endDate = null) {
  return new Promise((resolve, reject) => {
    const normalizedPlan = (planType || "free").toLowerCase();

    db.run(
      `INSERT INTO subscriptions (landlord_id, plan_type, paystack_subscription_code, status, current_period_end, updated_at)
       VALUES (?, ?, ?, 'active', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(landlord_id) DO UPDATE SET
         plan_type = excluded.plan_type,
         paystack_subscription_code = excluded.paystack_subscription_code,
         status = 'active',
         current_period_end = excluded.current_period_end,
         updated_at = CURRENT_TIMESTAMP`,
      [landlordId, normalizedPlan, subscriptionCode, endDate],
      function (err) {
        if (err) return reject(err);
        resolve({ landlordId, planType: normalizedPlan });
      }
    );
  });
}

/**
 * Count active total tenants belonging to a landlord
 */
function countLandlordTenants(landlordId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT COUNT(*) AS count FROM tenants WHERE landlord_id = ?`,
      [landlordId],
      (err, row) => (err ? reject(err) : resolve(row?.count || 0))
    );
  });
}

module.exports = {
  PLAN_PRICES,
  TIER_LIMITS,
  getLandlordSubscription,
  getSubscriptionByLandlord: getLandlordSubscription,
  updateSubscription,
  countLandlordTenants,
};