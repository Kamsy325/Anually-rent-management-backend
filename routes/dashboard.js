const express = require("express");

const authenticateToken =
  require("../middleware/auth");

const requireLandlord =
  require("../middleware/requireLandlord");

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

const router =
  express.Router();


// =====================================================
// CONSTANTS
// =====================================================

const DAY_MS =
  24 * 60 * 60 * 1000;


// =====================================================
// DATE HELPERS
// =====================================================

function normalizeDate(value) {

  if (!value) {
    return null;
  }

  const stringValue =
    String(value);

  let date;

  // YYYY-MM-DD
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      stringValue
    )
  ) {

    date =
      new Date(
        `${stringValue}T00:00:00`
      );

  } else {

    date =
      new Date(value);

  }

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  date.setHours(
    0,
    0,
    0,
    0
  );

  return date;
}


// =====================================================
// TODAY
// =====================================================

function getToday() {

  const today =
    new Date();

  today.setHours(
    0,
    0,
    0,
    0
  );

  return today;
}


// =====================================================
// DAYS UNTIL DUE
// =====================================================

function getDaysUntilDue(
  dueDate
) {

  const due =
    normalizeDate(
      dueDate
    );

  const today =
    getToday();

  if (!due) {
    return null;
  }

  return Math.floor(
    (
      due.getTime() -
      today.getTime()
    ) /
    DAY_MS
  );
}


// =====================================================
// FORMAT DATE
// =====================================================

function formatDate(
  date
) {

  const parsed =
    normalizeDate(
      date
    );

  if (!parsed) {
    return "Not specified";
  }

  return new Intl.DateTimeFormat(
    "en-US",
    {
      month: "long",
      day: "numeric",
      year: "numeric",
    }
  ).format(
    parsed
  );
}


// =====================================================
// FORMAT PAYMENT
// =====================================================

function formatPayment(
  payment,
  tenant = null
) {

  if (!payment) {
    return null;
  }

  const dueDate =
    payment.due_date ||
    null;

  const daysUntilDue =
    getDaysUntilDue(
      dueDate
    );

  return {

    id:
      payment.id,

    paymentId:
      payment.id,

    tenantId:
      payment.tenant_id,

    tenant:
      tenant?.name ||
      payment.tenant_name ||
      null,

    apartment:
      tenant?.apartment ||
      payment.apartment ||
      null,

    amount:
      Number(
        payment.amount || 0
      ),

    dueDate,

    dueDateText:
      formatDate(
        dueDate
      ),

    status:
      String(
        payment.status ||
        "pending"
      ).toLowerCase(),

    daysUntilDue,

    daysOverdue:
      typeof daysUntilDue === "number" &&
      daysUntilDue < 0
        ? Math.abs(
            daysUntilDue
          )
        : 0,

    paidDate:
      payment.paid_date ||
      null,

    paymentDate:
      payment.paid_date ||
      null,

    paymentMethod:
      payment.payment_method ||
      null,

    paystackReference:
      payment.paystack_reference ||
      null,

    paystackTransactionId:
      payment.paystack_transaction_id ||
      null,

    createdAt:
      payment.created_at ||
      null,

  };

}


// =====================================================
// FORMAT PAYMENT COLLECTION
// =====================================================

function formatPayments(
  databasePayments,
  tenant = null
) {

  if (
    !Array.isArray(
      databasePayments
    )
  ) {

    return [];

  }

  return databasePayments
    .map(
      payment =>
        formatPayment(
          payment,
          tenant
        )
    )
    .filter(
      Boolean
    );

}


// =====================================================
// BUILD LANDLORD PAYMENTS
// =====================================================

function buildLandlordPayments(
  tenants,
  databasePayments
) {

  const tenantMap =
    new Map();

  tenants.forEach(
    tenant => {

      tenantMap.set(
        Number(
          tenant.id
        ),
        tenant
      );

    }
  );


  return databasePayments
    .map(
      payment => {

        const tenant =
          tenantMap.get(
            Number(
              payment.tenant_id
            )
          );

        return formatPayment(
          payment,
          tenant
        );

      }
    )
    .filter(
      Boolean
    );

}


// =====================================================
// GET UPCOMING PAYMENTS
//
// Only pending payments.
// Only payments due within the next 30 days.
// The payment must be AFTER today.
//
// A payment due today belongs in Pending,
// not Upcoming.
// =====================================================

function getUpcomingPayments(
  payments,
  days = 30
) {

  return payments

    .filter(
      payment => {

        if (
          !payment?.dueDate
        ) {
          return false;
        }

        if (
          payment.status !==
          "pending"
        ) {
          return false;
        }

        return (
          typeof payment.daysUntilDue ===
            "number" &&

          payment.daysUntilDue > 0 &&

          payment.daysUntilDue <=
            days
        );

      }
    )

    .sort(
      (a, b) =>
        a.daysUntilDue -
        b.daysUntilDue
    );

}


// =====================================================
// GET PENDING PAYMENTS
// =====================================================

function getPendingPayments(
  payments
) {

  return payments

    .filter(
      payment =>
        payment.status ===
        "pending"
    )

    .sort(
      (a, b) =>
        String(
          a.dueDate || ""
        ).localeCompare(
          String(
            b.dueDate || ""
          )
        )
    );

}


// =====================================================
// GET OVERDUE PAYMENTS
// =====================================================

function getOverduePayments(
  payments
) {

  return payments

    .filter(
      payment =>
        payment.status ===
        "overdue"
    )

    .sort(
      (a, b) =>
        (
          a.daysUntilDue ?? 0
        ) -
        (
          b.daysUntilDue ?? 0
        )
    );

}


// =====================================================
// GET PAID PAYMENTS
// =====================================================

function getPaidPayments(
  payments
) {

  return payments

    .filter(
      payment =>
        payment.status ===
        "paid"
    )

    .sort(
      (a, b) =>
        new Date(
          b.paidDate || 0
        ) -
        new Date(
          a.paidDate || 0
        )
    );

}


// =====================================================
// LANDLORD DASHBOARD
//
// GET /dashboard-data
//
// IMPORTANT:
//
// We DO NOT call generateTenantPayments() here.
//
// We only call ensureNextPayment().
//
// This means:
//
// Paid August
//      ↓
// Create September
//
// Paid September
//      ↓
// Create October
//
// etc.
//
// We NEVER create 12 future records at once.
// =====================================================

router.get(
  "/dashboard-data",
  authenticateToken,
  requireLandlord,
  async (
    req,
    res
  ) => {

    try {

      console.log(
        "===================================="
      );

      console.log(
        "DASHBOARD-DATA ROUTE WAS CALLED"
      );

      console.log(
        "LANDLORD ID:",
        req.user.id
      );

      console.log(
        "LANDLORD EMAIL:",
        req.user.email
      );

      console.log(
        "===================================="
      );


      // =================================================
      // UPDATE PAYMENT STATUSES
      // =================================================

      const statusResult =
        await updatePaymentStatuses();

      console.log(
        "PAYMENT STATUS UPDATE:",
        statusResult
      );


      // =================================================
      // GET LANDLORD TENANTS
      // =================================================

      const tenants =
        await getTenantsByLandlord(
          req.user.id
        );


      console.log(
        "LANDLORD TENANTS COUNT:",
        tenants.length
      );


      console.log(
        "LANDLORD TENANTS:",
        tenants.map(
          tenant => ({
            id:
              tenant.id,

            name:
              tenant.name,

            rent:
              tenant.rent,

            leaseEnds:
              tenant.lease_ends ||
              tenant.leaseEnds,

            interval:
              tenant.lease_interval ||
              tenant.leaseInterval ||
              "monthly",
          })
        )
      );


      // =================================================
      // ENSURE ONLY ONE NEXT PAYMENT
      // =================================================

      for (
        const tenant of tenants
      ) {

        try {

          await ensureNextPayment(
            tenant
          );

        } catch (
          paymentError
        ) {

          console.error(
            "ENSURE NEXT PAYMENT ERROR:",
            {
              tenantId:
                tenant.id,

              tenant:
                tenant.name,

              error:
                paymentError.message,
            }
          );

        }

      }


      // =================================================
      // GET DATABASE PAYMENTS
      // =================================================

      const databasePayments =
        [];


      for (
        const tenant of tenants
      ) {

        const tenantPayments =
          await getPaymentsByTenant(
            tenant.id
          );


        databasePayments.push(
          ...tenantPayments
        );

      }


      console.log(
        "LANDLORD DATABASE PAYMENTS COUNT:",
        databasePayments.length
      );


      console.log(
        "LANDLORD DATABASE PAYMENTS:",
        databasePayments.map(
          payment => ({

            id:
              payment.id,

            tenantId:
              payment.tenant_id,

            dueDate:
              payment.due_date,

            status:
              payment.status,

            amount:
              payment.amount,

            paidDate:
              payment.paid_date,

          })
        )
      );


      // =================================================
      // FORMAT
      // =================================================

      const payments =
        buildLandlordPayments(
          tenants,
          databasePayments
        );


      // =================================================
      // CATEGORIES
      // =================================================

      const upcomingDeadlines =
        getUpcomingPayments(
          payments,
          30
        );


      const pendingPayments =
        getPendingPayments(
          payments
        );


      const overduePayments =
        getOverduePayments(
          payments
        );


      // =================================================
      // RECENT PAID
      // =================================================

      const recentPaymentsFromDatabase =
        await getRecentPaidPayments(
          req.user.id
        );


      const recentPayments =
        formatPayments(
          recentPaymentsFromDatabase
        );


      // =================================================
      // FINAL DEBUG
      // =================================================

      console.log(
        "LANDLORD DASHBOARD FINAL:",
        {
          totalPayments:
            payments.length,

          pending:
            pendingPayments.length,

          overdue:
            overduePayments.length,

          upcoming:
            upcomingDeadlines.length,

          recentPaid:
            recentPayments.length,
        }
      );


      // =================================================
      // RESPONSE
      // =================================================

      return res.status(200).json({

        payments,

        upcomingDeadlines,

        pendingPayments,

        overduePayments,

        recentPayments,

      });

    } catch (
      error
    ) {

      console.error(
        "LANDLORD DASHBOARD ERROR:",
        error
      );

      console.error(
        "LANDLORD DASHBOARD STACK:",
        error.stack
      );


      return res.status(500).json({

        message:
          "Failed to load dashboard data",

        error:
          error.message,

      });

    }

  }
);


// =====================================================
// TENANT DASHBOARD
//
// GET /tenant-dashboard-data
// =====================================================

router.get(
  "/tenant-dashboard-data",
  authenticateToken,
  async (
    req,
    res
  ) => {

    try {

      console.log(
        "TENANT DASHBOARD USER:",
        req.user
      );


      // =================================================
      // AUTHENTICATION
      // =================================================

      if (!req.user) {

        return res.status(401).json({

          message:
            "Authentication required",

        });

      }


      // =================================================
      // TENANT ROLE
      // =================================================

      if (
        req.user.role !==
        "tenant"
      ) {

        return res.status(403).json({

          message:
            "Tenant access required",

        });

      }


      // =================================================
      // FIND TENANT
      // =================================================

      const tenant =
        await findTenantByEmail(
          req.user.email
        );


      if (!tenant) {

        console.error(
          "TENANT RECORD NOT FOUND:",
          req.user.email
        );


        return res.status(404).json({

          message:
            "Tenant record not found",

        });

      }


      // =================================================
      // TENANT DATA
      // =================================================

      const tenantData = {

        id:
          tenant.id,

        landlord_id:
          tenant.landlord_id,

        name:
          tenant.name,

        apartment:
          tenant.apartment,

        email:
          tenant.email,

        phone:
          tenant.phone,

        rent:
          Number(
            tenant.rent || 0
          ),

        status:
          tenant.status,

        leaseEnds:
          tenant.lease_ends,

        leaseInterval:
          tenant.lease_interval ||
          "monthly",

        created_at:
          tenant.created_at,

      };


      console.log(
        "TENANT DATA:",
        tenantData
      );


      // =================================================
      // UPDATE STATUS
      // =================================================

      await updatePaymentStatuses();


      // =================================================
      // ENSURE ONLY NEXT PAYMENT
      // =================================================

      await ensureNextPayment(
        tenant
      );


      // =================================================
      // GET DATABASE PAYMENTS
      // =================================================

      const databasePayments =
        await getPaymentsByTenant(
          tenant.id
        );


      console.log(
        "TENANT DATABASE PAYMENTS:",
        databasePayments
      );


      // =================================================
      // FORMAT
      // =================================================

      const payments =
        formatPayments(
          databasePayments,
          tenantData
        );


      // =================================================
      // CATEGORIES
      // =================================================

      const upcomingDeadlines =
        getUpcomingPayments(
          payments,
          30
        );


      const pendingPayments =
        getPendingPayments(
          payments
        );


      const overduePayments =
        getOverduePayments(
          payments
        );


      const paidPayments =
        getPaidPayments(
          payments
        );


      const recentPayments =
        paidPayments.slice(
          0,
          5
        );


      // =================================================
      // DEBUG
      // =================================================

      console.log(
        "TENANT PAYMENT SUMMARY:",
        {
          total:
            payments.length,

          pending:
            pendingPayments.length,

          overdue:
            overduePayments.length,

          upcoming:
            upcomingDeadlines.length,

          paid:
            paidPayments.length,
        }
      );


      // =================================================
      // RESPONSE
      // =================================================

      return res.status(200).json({

        tenant:
          tenantData,

        payments,

        upcomingDeadlines,

        pendingPayments,

        overduePayments,

        recentPayments,

      });

    } catch (
      error
    ) {

      console.error(
        "TENANT DASHBOARD DATA ERROR:",
        error
      );

      console.error(
        "TENANT DASHBOARD STACK:",
        error.stack
      );


      return res.status(500).json({

        message:
          "Failed to load tenant dashboard data",

        error:
          error.message,

      });

    }

  }
);


// =====================================================
// EXPORT
// =====================================================

module.exports =
  router;