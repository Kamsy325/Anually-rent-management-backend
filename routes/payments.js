const express = require("express");

const authenticateToken =
  require("../middleware/auth");

const requireLandlord =
  require("../middleware/requireLandlord");

const {
  generateTenantPayments,
  updatePaymentStatuses,
  getPaymentsByLandlord,
  getUpcomingPayments,
  getPendingPayments,
  getOverduePayments,
  getRecentPaidPayments
} = require("../models/Payment");

const {
  getTenantsByLandlord
} = require("../models/Tenant");

const router =
  express.Router();


// =====================================================
// GET DASHBOARD PAYMENT DATA
//
// GET /dashboard/payments
// =====================================================

router.get(
  "/dashboard/payments",
  authenticateToken,
  requireLandlord,
  async (req, res) => {
    try {

      const landlordId =
        req.user.id;


      // ===============================================
      // GET TENANTS
      // ===============================================

      const tenants =
        await getTenantsByLandlord(
          landlordId
        );


      // ===============================================
      // GENERATE PAYMENT OBLIGATIONS
      // ===============================================

      for (
        const tenant of tenants
      ) {

        await generateTenantPayments(
          tenant
        );

      }


      // ===============================================
      // UPDATE PENDING -> OVERDUE
      // ===============================================

      await updatePaymentStatuses();


      // ===============================================
      // GET DASHBOARD DATA
      // ===============================================

      const [
        payments,
        upcoming,
        pending,
        overdue,
        recentPaid
      ] = await Promise.all([
        getPaymentsByLandlord(
          landlordId
        ),

        getUpcomingPayments(
          landlordId
        ),

        getPendingPayments(
          landlordId
        ),

        getOverduePayments(
          landlordId
        ),

        getRecentPaidPayments(
          landlordId
        )
      ]);


      // ===============================================
      // ANALYTICS
      // ===============================================

      const pendingAmount =
        pending.reduce(
          (total, payment) =>
            total +
            Number(payment.amount || 0),
          0
        );


      const overdueAmount =
        overdue.reduce(
          (total, payment) =>
            total +
            Number(payment.amount || 0),
          0
        );


      const paidAmount =
        recentPaid.reduce(
          (total, payment) =>
            total +
            Number(payment.amount || 0),
          0
        );


      res.status(200).json({

        payments,

        upcoming,

        pending,

        overdue,

        recentPaid,

        analytics: {

          activeTenants:
            tenants.length,

          pendingAmount,

          overdueAmount,

          recentPaidAmount:
            paidAmount

        }

      });

    } catch (error) {

      console.error(
        "Dashboard payments error:",
        error
      );

      res.status(500).json({
        message:
          "Failed to load payment data"
      });

    }
  }
);


module.exports = router;