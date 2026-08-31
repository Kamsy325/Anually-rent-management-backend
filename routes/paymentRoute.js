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

// Import subscription model to fetch landlord's tier & platform fee rate
const { getLandlordSubscription } = require("../models/Subscription");

const router = express.Router();

// =====================================================
// DEBUG HELPER
// =====================================================

function logPaymentError(label, error) {
  console.error(`\n========== ${label} ==========`);
  console.error("MESSAGE:", error?.message);
  console.error("STATUS:", error?.response?.status);
  console.error("RESPONSE DATA:", error?.response?.data);
  console.error("RESPONSE MESSAGE:", error?.response?.data?.message);
  console.error("RESPONSE:", error?.response);
  console.error("STACK:", error?.stack);
  console.error("====================================\n");
}

// =====================================================
// INITIALIZE RENT PAYMENT
//
// POST /payments/initialize
// =====================================================

router.post("/initialize", authenticateToken, async (req, res) => {
  console.log("\n=================================================");
  console.log("PAYMENT INITIALIZATION REQUEST");
  console.log("=================================================");
  console.log("USER:", req.user);
  console.log("BODY:", req.body);

  try {
    // =================================================
    // USER SECURITY
    // =================================================

    if (!req.user) {
      console.error("INITIALIZE ERROR: No authenticated user");
      return res.status(401).json({
        message: "Authentication required",
      });
    }

    // =================================================
    // TENANT ROLE CHECK
    // =================================================

    console.log("USER ROLE:", req.user.role);

    if (req.user.role !== "tenant") {
      console.error("INITIALIZE ERROR: User is not a tenant");
      return res.status(403).json({
        message: "Only tenants can make rent payments",
      });
    }

    // =================================================
    // PAYMENT ID VALIDATION
    // =================================================

    const { paymentId } = req.body;

    console.log("RECEIVED PAYMENT ID:", paymentId);

    if (paymentId === undefined || paymentId === null || paymentId === "") {
      console.error("INITIALIZE ERROR: Payment ID missing");
      return res.status(400).json({
        message: "Payment ID is required",
      });
    }

    const numericPaymentId = Number(paymentId);

    if (!Number.isInteger(numericPaymentId) || numericPaymentId <= 0) {
      console.error("INITIALIZE ERROR: Invalid payment ID:", paymentId);
      return res.status(400).json({
        message: "Invalid payment ID",
      });
    }

    // =================================================
    // GET PAYMENT RECORD
    // =================================================

    console.log("LOOKING UP PAYMENT:", numericPaymentId);

    const payment = await getPaymentById(numericPaymentId);

    console.log("PAYMENT FROM DATABASE:", payment);

    if (!payment) {
      console.error("INITIALIZE ERROR: Payment not found:", numericPaymentId);
      return res.status(404).json({
        message: "Payment record not found",
      });
    }

    console.log("DATABASE PAYMENT ID:", payment.id);
    console.log("DATABASE TENANT ID:", payment.tenant_id);
    console.log("DATABASE LANDLORD ID:", payment.landlord_id);
    console.log("DATABASE AMOUNT:", payment.amount);
    console.log("DATABASE DUE DATE:", payment.due_date);
    console.log("DATABASE STATUS:", payment.status);

    // =================================================
    // TENANT SECURITY CHECK
    // =================================================

    const userTenantId = req.user.tenant_id;
    const paymentTenantId = payment.tenant_id;

    console.log("SECURITY CHECK:", {
      userTenantId,
      paymentTenantId,
      userEmail: req.user.email,
      paymentEmail: payment.tenant_email,
    });

    if (userTenantId !== undefined && userTenantId !== null) {
      if (Number(paymentTenantId) !== Number(userTenantId)) {
        console.error("INITIALIZE ERROR: Tenant ID mismatch");
        return res.status(403).json({
          message: "You cannot pay this payment",
        });
      }
    } else {
      console.log("JWT does not contain tenant_id. Using email security check.");

      if (!payment.tenant_email) {
        console.error("INITIALIZE ERROR: Payment has no tenant email");
        return res.status(500).json({
          message: "Payment tenant information is missing",
        });
      }

      if (
        String(payment.tenant_email).toLowerCase() !==
        String(req.user.email).toLowerCase()
      ) {
        console.error("INITIALIZE ERROR: Tenant email mismatch");
        return res.status(403).json({
          message: "You cannot pay this payment",
        });
      }
    }

    // =================================================
    // PAYMENT STATUS CHECK
    // =================================================

    console.log("PAYMENT STATUS:", payment.status);

    if (payment.status === "paid") {
      console.error("INITIALIZE ERROR: Payment already paid");
      return res.status(400).json({
        message: "This payment has already been paid",
      });
    }

    if (payment.status !== "pending" && payment.status !== "overdue") {
      console.error("INITIALIZE ERROR: Invalid payment status:", payment.status);
      return res.status(400).json({
        message: "This payment cannot currently be paid",
      });
    }

    // =================================================
    // AMOUNT VALIDATION
    // =================================================

    const amount = Number(payment.amount);

    console.log("PAYMENT AMOUNT:", amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      console.error("INITIALIZE ERROR: Invalid payment amount:", payment.amount);
      return res.status(400).json({
        message: "Invalid payment amount",
      });
    }

    // =================================================
    // LANDLORD INFORMATION CHECK
    // =================================================

    console.log("LANDLORD ID:", payment.landlord_id);

    if (!payment.landlord_id) {
      console.error("INITIALIZE ERROR: Payment has no landlord ID");
      return res.status(500).json({
        message: "Payment landlord information is missing",
      });
    }

    // =================================================
    // GET LANDLORD PAYOUT ACCOUNT
    // =================================================

    console.log("GETTING LANDLORD PAYOUT INFO...");

    const payout = await getPayoutInfo(payment.landlord_id);

    console.log("LANDLORD PAYOUT INFO:", payout);

    if (!payout || !payout.paystack_subaccount_code) {
      console.error("INITIALIZE ERROR: Missing Paystack subaccount");
      return res.status(400).json({
        message: "The landlord has not connected a Paystack payout account",
      });
    }

    console.log("PAYSTACK SUBACCOUNT:", payout.paystack_subaccount_code);

    // =================================================
    // FETCH LANDLORD SUBSCRIPTION TIER & FEE PERCENT
    // =================================================

    console.log("FETCHING LANDLORD SUBSCRIPTION TIER...");

    const landlordSub = await getLandlordSubscription(payment.landlord_id);
    const platformFeePercent = landlordSub?.feePercent ?? 5.0;

    console.log(
      "EFFECTIVE LANDLORD PLAN:",
      landlordSub?.effective_plan || "free"
    );
    console.log("APPLIED PLATFORM COMMISSION FEE %:", platformFeePercent);

    // =================================================
    // TENANT EMAIL & REFERENCE GENERATION
    // =================================================

    const tenantEmail = payment.tenant_email || req.user.email;

    console.log("TENANT EMAIL:", tenantEmail);

    if (!tenantEmail) {
      console.error("INITIALIZE ERROR: Tenant email missing");
      return res.status(400).json({
        message: "Tenant email is required for payment",
      });
    }

    const reference = `RENT-${payment.id}-${Date.now()}`;

    console.log("PAYSTACK REFERENCE:", reference);

    const callbackUrl =
      process.env.PAYSTACK_CALLBACK_URL ||
      "http://localhost:5173/payment/callback";

    console.log("PAYSTACK CALLBACK URL:", callbackUrl);

    if (!process.env.PAYSTACK_SECRET_KEY) {
      console.error("INITIALIZE ERROR: PAYSTACK_SECRET_KEY is missing");
      return res.status(500).json({
        message: "Paystack secret key is not configured on the server",
      });
    }

    // =================================================
    // INITIALIZE PAYSTACK TRANSACTION WITH SPLIT
    // =================================================

    console.log("\n----- CALLING PAYSTACK -----");
    console.log({
      email: tenantEmail,
      amountNaira: amount,
      amountKobo: Math.round(amount * 100),
      reference,
      subaccountCode: payout.paystack_subaccount_code,
      platformFeePercent,
      callbackUrl,
    });

    const transaction = await initializeRentPayment({
      email: tenantEmail,
      amount,
      reference,
      subaccountCode: payout.paystack_subaccount_code,
      platformFeePercent, // Dynamic split commission based on landlord's active plan
      callbackUrl,
    });

    console.log("PAYSTACK TRANSACTION RESPONSE:", transaction);

    // =================================================
    // VALIDATE PAYSTACK RESPONSE
    // =================================================

    const authorizationUrl = transaction?.authorization_url;

    if (!authorizationUrl) {
      console.error(
        "INITIALIZE ERROR: Paystack did not return authorization URL"
      );
      return res.status(500).json({
        message: "Paystack did not return a payment authorization URL",
      });
    }

    // =================================================
    // SAVE REFERENCE TO DATABASE
    // =================================================

    console.log("SAVING PAYSTACK REFERENCE...");

    const referenceResult = await savePaystackReference(payment.id, reference);

    console.log("REFERENCE SAVE RESULT:", referenceResult);

    // =================================================
    // SUCCESS RESPONSE
    // =================================================

    console.log("\n=================================================");
    console.log("PAYMENT INITIALIZATION SUCCESS");
    console.log("PAYMENT ID:", payment.id);
    console.log("REFERENCE:", reference);
    console.log("AUTHORIZATION URL:", authorizationUrl);
    console.log("=================================================\n");

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
      message:
        error?.response?.data?.message ||
        error?.message ||
        "Failed to initialize payment",
      error: error?.message || "Unknown payment initialization error",
      paystack: error?.response?.data || null,
    });
  }
});

// =====================================================
// VERIFY RENT PAYMENT
//
// GET /payments/verify/:reference
// =====================================================

router.get("/verify/:reference", authenticateToken, async (req, res) => {
  console.log("\n=================================================");
  console.log("PAYMENT VERIFICATION REQUEST");
  console.log("=================================================");
  console.log("USER:", req.user);
  console.log("REFERENCE:", req.params.reference);

  try {
    const { reference } = req.params;

    if (!reference) {
      console.error("VERIFY ERROR: Reference missing");
      return res.status(400).json({
        message: "Payment reference is required",
      });
    }

    // =================================================
    // VERIFY WITH PAYSTACK
    // =================================================

    console.log("VERIFYING TRANSACTION WITH PAYSTACK...");

    const transaction = await verifyTransaction(reference);

    console.log("PAYSTACK VERIFICATION RESPONSE:", transaction);

    // =================================================
    // GET LOCAL PAYMENT RECORD
    // =================================================

    console.log("LOOKING UP LOCAL PAYMENT BY REFERENCE...");

    const payment = await getPaymentByReference(reference);

    console.log("LOCAL PAYMENT:", payment);

    if (!payment) {
      console.error("VERIFY ERROR: Local payment not found");
      return res.status(404).json({
        message: "Local payment record not found",
      });
    }

    // Fetch landlord subscription rate to calculate breakdown
    const landlordSub = await getLandlordSubscription(payment.landlord_id);
    const platformFeePercent = landlordSub?.feePercent ?? 5.0;

    // Financial calculations (in Main Currency Unit, e.g. NGN)
    const totalAmount = transaction.amount / 100;
    const paystackFee = transaction.fees / 100;
    const platformCommission = totalAmount * (platformFeePercent / 100);
    const landlordPayout = totalAmount - paystackFee - platformCommission;

    // 🔍 SPLIT AUDIT & FINANCIAL BREAKDOWN LOGS
    console.log("\n==================================================");
    console.log("💳 VERIFY TRANSACTION SPLIT AUDIT");
    console.log("==================================================");
    console.log("Reference:", transaction.reference);
    console.log("Status:", transaction.status);
    console.log("Total Amount Charged:", `${totalAmount} ${transaction.currency}`);
    console.log("Paystack Fee:", `${paystackFee} ${transaction.currency}`);

    // Check direct subaccount assignment
    if (transaction.subaccount && transaction.subaccount.subaccount_code) {
      console.log("✅ SPLIT TYPE: Single Subaccount Direct Split");
      console.log("Subaccount Code:", transaction.subaccount.subaccount_code);
      console.log("Subaccount Name:", transaction.subaccount.business_name || transaction.subaccount.name);
      if (transaction.authorization?.account_name) {
        console.log("Settlement Target:", transaction.authorization.account_name);
      }
    } 
    // Check multi-split configuration
    else if (transaction.split && (transaction.split.split_code || transaction.split.id)) {
      console.log("✅ SPLIT TYPE: Multi-Split Group");
      console.log("Split Code:", transaction.split.split_code);
      console.log("Split Name:", transaction.split.name);
      console.log("Subaccounts Involved:", JSON.stringify(transaction.split.subaccounts, null, 2));
      console.log("Bearer Type (Who pays Paystack fee):", transaction.split.bearer_type);
    } 
    // No split active
    else {
      console.log("❌ SPLIT STATUS: NO SPLIT DETECTED");
      console.log("Notice: 100% of this payout (minus Paystack fees) will go to the main platform account.");
    }

    console.log("--------------------------------------------------");
    console.log("💰 FINANCIAL BREAKDOWN LOG");
    console.log("--------------------------------------------------");
    console.log(`Gross Charged:           ₦${totalAmount.toLocaleString()}`);
    console.log(`Paystack Gateway Fee:    -₦${paystackFee.toLocaleString()}`);
    console.log(`Your Platform Commission (${platformFeePercent}%): +₦${platformCommission.toLocaleString()} (Retained on Main Account)`);
    console.log(`Landlord Net Payout:     +₦${landlordPayout.toLocaleString()} (Settled to Subaccount)`);
    console.log("==================================================\n");

    if (transaction.status !== "success") {
      console.error(
        "VERIFY ERROR: Paystack transaction not successful:",
        transaction.status
      );
      return res.status(400).json({
        message: "Paystack payment was not successful",
        status: transaction.status,
      });
    }

    // =================================================
    // SECURITY CHECK
    // =================================================

    console.log("VERIFY SECURITY:", {
      paymentTenant: payment.tenant_email,
      loggedInTenant: req.user.email,
    });

    if (
      String(payment.tenant_email).toLowerCase() !==
      String(req.user.email).toLowerCase()
    ) {
      console.error("VERIFY ERROR: Tenant email mismatch");
      return res.status(403).json({
        message: "You cannot verify this payment",
      });
    }

    // =================================================
    // VERIFY AMOUNT
    // =================================================

    const expectedAmount = Math.round(Number(payment.amount) * 100);
    const receivedAmount = Number(transaction.amount);

    console.log("AMOUNT VERIFICATION:", {
      databaseAmount: payment.amount,
      expectedKobo: expectedAmount,
      paystackKobo: receivedAmount,
    });

    if (receivedAmount !== expectedAmount) {
      console.error("VERIFY ERROR: Payment amount mismatch");
      return res.status(400).json({
        message: "Payment amount does not match the rent amount",
      });
    }

    // =================================================
    // MARK PAYMENT AS PAID
    // =================================================

    console.log("MARKING PAYMENT AS PAID...");

    const result = await markPaymentAsPaid({
      paymentId: payment.id,
      reference,
      transactionId: transaction.id,
      paymentMethod: "paystack",
    });

    if (req.user?.id) {
      const formattedAmount = `$${Number(payment.amount).toLocaleString()}`;
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

    // 1. Notify Tenant
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

    // 2. Notify Landlord
    if (payment.landlord_id) {
      const formattedAmount = `₦${Number(payment.amount).toLocaleString()}`;
      await createNotification({
        userId: payment.landlord_id,
        role: "landlord",
        title: "Rent Payment Received",
        message: `Payment of ${formattedAmount} for ${
          payment.apartment || "an apartment"
        } has been received.`,
        type: "paid",
        paymentId: payment.id,
      });
    }

    console.log("MARK PAID RESULT:", result);

    // =================================================
    // SUCCESS RESPONSE
    // =================================================

    console.log("\n=================================================");
    console.log("PAYMENT VERIFICATION SUCCESS");
    console.log("PAYMENT ID:", payment.id);
    console.log("REFERENCE:", reference);
    console.log("=================================================\n");

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
      message:
        error?.response?.data?.message ||
        error?.message ||
        "Failed to verify payment",
      error: error?.message || "Unknown payment verification error",
      paystack: error?.response?.data || null,
    });
  }
});

// =====================================================
// EXPORT
// =====================================================

module.exports = router;