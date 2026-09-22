const express = require("express");
const { createNotification } = require("../models/Notification");
const authenticateToken = require("../middleware/auth");

const {
  initializeRentPayment,
  verifyTransaction,
} = require("../services/paystack");

const {
  getPaymentById,
  getPaymentByReference,
  savePaystackReference,
  markPaymentAsPaid,
} = require("../models/Payment");

const { getPayoutInfo } = require("../models/User");

// Flat 3% platform fee on all transactions
const PLATFORM_FEE_PERCENT = 3.0;

const router = express.Router();

function logPaymentError(label, error) {
  console.error(`\n========== ${label} ==========`);
  console.error("MESSAGE:", error?.message);
  console.error("STATUS:", error?.response?.status);
  console.error("RESPONSE DATA:", error?.response?.data);
  console.error("RESPONSE MESSAGE:", error?.response?.data?.message);
  console.error("STACK:", error?.stack);
  console.error("====================================\n");
}

// =====================================================
// INITIALIZE RENT PAYMENT
// POST /payments/initialize
// =====================================================
router.post("/initialize", authenticateToken, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    if (req.user.role !== "tenant") {
      return res.status(403).json({ message: "Only tenants can make rent payments" });
    }

    const { paymentId } = req.body;
    const numericPaymentId = Number(paymentId);

    if (!Number.isInteger(numericPaymentId) || numericPaymentId <= 0) {
      return res.status(400).json({ message: "Invalid payment ID" });
    }

    const payment = await getPaymentById(numericPaymentId);
    if (!payment) {
      return res.status(404).json({ message: "Payment record not found" });
    }

    // Security checks
    const userTenantId = req.user.tenant_id;
    if (userTenantId !== undefined && userTenantId !== null) {
      if (Number(payment.tenant_id) !== Number(userTenantId)) {
        return res.status(403).json({ message: "You cannot pay this payment" });
      }
    } else if (
      String(payment.tenant_email).toLowerCase() !== String(req.user.email).toLowerCase()
    ) {
      return res.status(403).json({ message: "You cannot pay this payment" });
    }

    if (payment.status === "paid") {
      return res.status(400).json({ message: "This payment has already been paid" });
    }

    if (payment.status !== "pending" && payment.status !== "overdue") {
      return res.status(400).json({ message: "This payment cannot currently be paid" });
    }

    const amount = Number(payment.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Invalid payment amount" });
    }

    // Get landlord payout subaccount
    const payout = await getPayoutInfo(payment.landlord_id);
    if (!payout || !payout.paystack_subaccount_code) {
      return res.status(400).json({
        message: "The landlord has not connected a payout account",
      });
    }

    const tenantEmail = payment.tenant_email || req.user.email;
    const reference = `RENT-${payment.id}-${Date.now()}`;
    const callbackUrl =
      process.env.PAYSTACK_CALLBACK_URL ||
      "https://anually.vercel.app/payment/callback";

    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(500).json({
        message: "Paystack secret key is not configured on the server",
      });
    }

    // Initialize Paystack with flat 3% platform fee & landlord pays fees (bearer: subaccount)
    const transaction = await initializeRentPayment({
      email: tenantEmail,
      amount,
      reference,
      subaccountCode: payout.paystack_subaccount_code,
      platformFeePercent: PLATFORM_FEE_PERCENT,
      callbackUrl,
    });

    const authorizationUrl = transaction?.authorization_url;
    if (!authorizationUrl) {
      return res.status(500).json({
        message: "Paystack did not return a payment authorization URL",
      });
    }

    await savePaystackReference(payment.id, reference);

    return res.status(200).json({
      success: true,
      message: "Payment initialized successfully",
      paymentId: payment.id,
      reference,
      authorization_url: authorizationUrl,
      access_code: transaction.access_code,
    });
  } catch (error) {
    logPaymentError("INITIALIZE PAYMENT ERROR", error);
    return res.status(error?.response?.status || 500).json({
      message: error?.response?.data?.message || error?.message || "Failed to initialize payment",
    });
  }
});

// =====================================================
// VERIFY RENT PAYMENT
// GET /payments/verify/:reference
// =====================================================
router.get("/verify/:reference", authenticateToken, async (req, res) => {
  try {
    const { reference } = req.params;
    if (!reference) {
      return res.status(400).json({ message: "Payment reference is required" });
    }

    const transaction = await verifyTransaction(reference);
    const payment = await getPaymentByReference(reference);

    if (!payment) {
      return res.status(404).json({ message: "Local payment record not found" });
    }

    // Financial calculations: Flat 3% fee + Paystack fee paid by landlord
    const totalAmount = transaction.amount / 100;
    const paystackFee = transaction.fees / 100;
    const platformCommission = totalAmount * (PLATFORM_FEE_PERCENT / 100);
    const landlordPayout = totalAmount - paystackFee - platformCommission;

    console.log("--------------------------------------------------");
    console.log("💰 FINANCIAL BREAKDOWN (FLAT 3% FEE)");
    console.log(`Gross Charged to Tenant: ₦${totalAmount.toLocaleString()}`);
    console.log(`Paystack Processing Fee: -₦${paystackFee.toLocaleString()} (Paid by Landlord)`);
    console.log(`Platform Commission (3%): +₦${platformCommission.toLocaleString()} (Retained on Main Account)`);
    console.log(`Landlord Net Payout:     +₦${landlordPayout.toLocaleString()}`);
    console.log("--------------------------------------------------");

    if (transaction.status !== "success") {
      return res.status(400).json({
        message: "Paystack payment was not successful",
        status: transaction.status,
      });
    }

    if (
      String(payment.tenant_email).toLowerCase() !== String(req.user.email).toLowerCase()
    ) {
      return res.status(403).json({ message: "You cannot verify this payment" });
    }

    const expectedAmount = Math.round(Number(payment.amount) * 100);
    const receivedAmount = Number(transaction.amount);

    if (receivedAmount !== expectedAmount) {
      return res.status(400).json({ message: "Payment amount does not match the rent amount" });
    }

    await markPaymentAsPaid({
      paymentId: payment.id,
      reference,
      transactionId: transaction.id,
      paymentMethod: "paystack",
    });

    // Notify Tenant
    if (req.user?.id) {
      const formattedAmount = `₦${Number(payment.amount).toLocaleString()}`;
      await createNotification({
        userId: req.user.id,
        role: "tenant",
        title: "Rent Paid Successfully",
        message: `Your rent payment of ${formattedAmount} for ${
          payment.apartment || "your apartment"
        } was processed successfully.`,
        type: "paid",
        paymentId: payment.id,
      });
    }

    // Notify Landlord
    if (payment.landlord_id) {
      const formattedAmount = `₦${Number(payment.amount).toLocaleString()}`;
      const tenantName = payment.tenant_name || req.user.name || "A tenant";

      await createNotification({
        userId: payment.landlord_id,
        role: "landlord",
        title: "Rent Payment Received",
        message: `Payment of ${formattedAmount} for ${
          payment.apartment || "an apartment"
        } has been received.`,
        senderName: tenantName,
        type: "paid",
        paymentId: payment.id,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      payment: {
        id: payment.id,
        amount: payment.amount,
        status: "paid",
        reference,
        paidDate: new Date().toISOString(),
      },
    });
  } catch (error) {
    logPaymentError("VERIFY PAYMENT ERROR", error);
    return res.status(error?.response?.status || 500).json({
      message: error?.response?.data?.message || error?.message || "Failed to verify payment",
    });
  }
});

module.exports = router;
