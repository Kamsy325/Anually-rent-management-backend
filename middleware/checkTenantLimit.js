// middleware/checkTenantLimit.js
// Tenant limits removed: users can add as many tenants as possible
async function checkTenantLimit(req, res, next) {
  // Unlimited tenants permitted across all tiers
  next();
}

module.exports = checkTenantLimit;