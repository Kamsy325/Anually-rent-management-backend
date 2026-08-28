// dashboard.js

const express = require("express");

const authenticateToken = require("../middleware/auth");

const requireLandlord = require("../middleware/requireLandlord");

const {
  getTenantsByLandlord,
  findTenantByEmail,
} = require("../models/Tenant");

const {
  getPaymentsByTenant,
  getRecentPaidPayments,
  updatePaymentStatuses,
  ensureNextPayment,
} = require("../models/Payment");

const router = express.Router();

// =====================================================
// CONSTANTS
// =====================================================

const DAY_MS = 24 * 60 * 60 * 1000;

// =====================================================
// DATE HELPERS
// =====================================================

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const stringValue = String(value);

  let date;

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
    date = new Date(`${stringValue}T00:00:00`);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setHours(0, 0, 0, 0);

  return date;
}

// =====================================================
// TODAY
// =====================================================

function getToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

// =====================================================
// DAYS UNTIL DUE
// =====================================================

function getDaysUntilDue(dueDate) {
  const due = normalizeDate(dueDate);

  const today = getToday();

  if (!due) {
    return null;
  }

  return Math.floor((due.getTime() - today.getTime()) / DAY_MS);
}

// =====================================================
// FORMAT DATE
// =====================================================

function formatDate(date) {
  const parsed = normalizeDate(date);

  if (!parsed) {
    return "Not specified";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

// =====================================================
// FORMAT PAYMENT
// =====================================================

function formatPayment(payment, tenant = null) {
  if (!payment) {
    return null;
  }

  const dueDate = payment.due_date || null;

  const daysUntilDue = getDaysUntilDue(dueDate);

  return {
    id: payment.id,

    paymentId: payment.id,

    tenantId: payment.tenant_id,

    tenant: tenant?.name || payment.tenant_name || null,

    apartment: tenant?.apartment || payment.apartment || null,

    amount: Number(payment.amount || 0),

    dueDate,

    dueDateText: formatDate(dueDate),

    status: String(payment.status || "pending").toLowerCase(),

    daysUntilDue,

    daysOverdue:
      typeof daysUntilDue === "number" && daysUntilDue < 0
        ? Math.abs(daysUntilDue)
        : 0,

    paidDate: payment.paid_date || null,

    paymentDate: payment.paid_date || null,

    paymentMethod: payment.payment_method || null,

    paystackReference: payment.paystack_reference || null,

    paystackTransactionId: payment.paystack_transaction_id || null,

    createdAt: payment.created_at || null,
  };
}

// =====================================================
// FORMAT PAYMENT COLLECTION
// =====================================================

function formatPayments(databasePayments, tenant = null) {
  if (!Array.isArray(databasePayments)) {
    return [];
  }

  return databasePayments
    .map((payment) => formatPayment(payment, tenant))
    .filter(Boolean);
}

// =====================================================
// BUILD LANDLORD PAYMENTS
// =====================================================

function buildLandlordPayments(tenants, databasePayments) {
  const tenantMap = new Map();

  tenants.forEach((tenant) => {
    tenantMap.set(Number(tenant.id), tenant);
  });

  return databasePayments
    .map((payment) => {
      const tenant = tenantMap.get(Number(payment.tenant_id));

      return formatPayment(payment, tenant);
    })
    .filter(Boolean);
}

// =====================================================
// CATEGORY FILTERS
// =====================================================

// UPCOMING: Status is 'upcoming' OR (status is 'pending' but due date is in the future)
function getUpcomingPayments(payments, maxDays = 30) {
  return payments
    .filter(
      (p) =>
        (p.status === "upcoming" || p.status === "pending") &&
        typeof p.daysUntilDue === "number" &&
        p.daysUntilDue > 0 &&
        p.daysUntilDue <= maxDays
    )
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

// PENDING: Only active payments that are due today or currently payable (daysUntilDue <= 0)
function getPendingPayments(payments) {
  return payments
    .filter(
      (p) =>
        p.status === "pending" &&
        (p.daysUntilDue === null || p.daysUntilDue <= 0)
    )
    .sort((a, b) => String(a.dueDate || "").localeCompare(String(b.dueDate || "")));
}

// OVERDUE: More than 7 days overdue
function getOverduePayments(payments) {
  return payments
    .filter((p) => p.status === "overdue")
    .sort((a, b) => (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0));
}

// GET PAID PAYMENTS
function getPaidPayments(payments) {
  return payments
    .filter((payment) => payment.status === "paid")
    .sort(
      (a, b) =>
        new Date(b.paidDate || 0) - new Date(a.paidDate || 0)
    );
}

// =====================================================
// LANDLORD DASHBOARD
// GET /dashboard-data
// =====================================================

router.get("/dashboard-data", authenticateToken, requireLandlord, async (req, res) => {
  try {
    await updatePaymentStatuses();

    const tenants = await getTenantsByLandlord(req.user.id);

    for (const tenant of tenants) {
      try {
        await ensureNextPayment(tenant);
      } catch (paymentError) {
        console.error("ENSURE NEXT PAYMENT ERROR:", paymentError.message);
      }
    }

    const databasePayments = [];

    for (const tenant of tenants) {
      const tenantPayments = await getPaymentsByTenant(tenant.id);
      databasePayments.push(...tenantPayments);
    }

    const payments = buildLandlordPayments(tenants, databasePayments);

    const upcomingDeadlines = getUpcomingPayments(payments, 30);
    const pendingPayments = getPendingPayments(payments);
    const overduePayments = getOverduePayments(payments);
    const recentPaymentsFromDatabase = await getRecentPaidPayments(req.user.id);
    const recentPayments = formatPayments(recentPaymentsFromDatabase);

    return res.status(200).json({
      payments,
      upcomingDeadlines,
      pendingPayments,
      overduePayments,
      recentPayments,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to load dashboard data",
      error: error.message,
    });
  }
});

// =====================================================
// TENANT DASHBOARD
// GET /tenant-dashboard-data
// =====================================================

router.get("/tenant-dashboard-data", authenticateToken, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (req.user.role !== "tenant") {
      return res.status(403).json({ message: "Tenant access required" });
    }

    const tenant = await findTenantByEmail(req.user.email);

    if (!tenant) {
      return res.status(404).json({ message: "Tenant record not found" });
    }

    const tenantData = {
      id: tenant.id,
      landlord_id: tenant.landlord_id,
      name: tenant.name,
      apartment: tenant.apartment,
      email: tenant.email,
      phone: tenant.phone,
      rent: Number(tenant.rent || 0),
      status: tenant.status,
      leaseEnds: tenant.lease_ends,
      leaseInterval: tenant.lease_interval || "monthly",
      created_at: tenant.created_at,
    };

    await updatePaymentStatuses();
    await ensureNextPayment(tenant);

    const databasePayments = await getPaymentsByTenant(tenant.id);
    const payments = formatPayments(databasePayments, tenantData);

    const upcomingDeadlines = getUpcomingPayments(payments, 30);
    const pendingPayments = getPendingPayments(payments);
    const overduePayments = getOverduePayments(payments);
    const paidPayments = getPaidPayments(payments);
    const recentPayments = paidPayments.slice(0, 5);

    return res.status(200).json({
      tenant: tenantData,
      payments,
      upcomingDeadlines,
      pendingPayments,
      overduePayments,
      recentPayments,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to load tenant dashboard data",
      error: error.message,
    });
  }
});

module.exports = router;