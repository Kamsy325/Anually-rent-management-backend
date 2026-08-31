// middleware/checkTenantLimit.js
const { getLandlordSubscription, countLandlordTenants } = require("../models/Subscription");

async function checkTenantLimit(req, res, next) {
  try {
    const landlordId = req.user.id;
    const sub = await getLandlordSubscription(landlordId);
    const tenantCount = await countLandlordTenants(landlordId);

    if (sub.maxTenants !== null && tenantCount >= sub.maxTenants) {
      return res.status(403).json({
        code: "TENANT_LIMIT_REACHED",
        message: `You have reached the maximum limit of ${sub.maxTenants} tenants for your ${sub.plan_type.toUpperCase()} plan. Please upgrade to add more.`,
        currentCount: tenantCount,
        limit: sub.maxTenants,
      });
    }

    next();
  } catch (err) {
    res.status(500).json({ message: "Failed to check tenant limit", error: err.message });
  }
}

module.exports = checkTenantLimit;