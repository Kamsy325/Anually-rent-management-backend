// routes/subscriptionRoutes.js
const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/auth");
const paystackService = require("../services/paystack");
const {
  getLandlordSubscription,
  updateSubscription,
  countLandlordTenants,
  PLAN_PRICES,
} = require("../models/Subscription");

// GET /subscription/status
router.get("/status", authenticateToken, async (req, res) => {
  try {
    const sub = await getLandlordSubscription(req.user.id);
    const tenantCount = await countLandlordTenants(req.user.id);

    res.json({
      ...sub,
      tenantCount,
      canAddMoreTenants: sub.maxTenants === null || tenantCount < sub.maxTenants,
    });
  } catch (err) {
    console.error("FETCH SUBSCRIPTION ERROR:", err);
    res.status(500).json({ message: "Failed to fetch plan status" });
  }
});

// POST /subscription/initialize
router.post("/initialize", authenticateToken, async (req, res) => {
  try {
    const { planType } = req.body;
    const normalizedPlan = (planType || "").toLowerCase();

    if (normalizedPlan === "free") {
      await updateSubscription(req.user.id, "free");
      return res.json({ message: "Switched to Free plan", free: true });
    }

    const priceInNaira = PLAN_PRICES[normalizedPlan];
    if (!priceInNaira) {
      return res.status(400).json({ message: "Invalid plan selected" });
    }

    const reference = `SUB_${req.user.id}_${Date.now()}`;
    const frontendUrl = process.env.FRONTEND_URL || "https://anually.netlify.app";

    const transaction = await paystackService.initializeSubscription({
      email: req.user.email,
      amount: priceInNaira,
      reference,
      callbackUrl: `${frontendUrl}/subscription/callback?reference=${reference}`,
      // Embed metadata so the verification route / webhook does not trust query params
      metadata: {
        landlord_id: req.user.id,
        plan_type: normalizedPlan,
      },
    });

    res.json({ authorization_url: transaction.authorization_url, reference });
  } catch (err) {
    console.error("INITIALIZE SUBSCRIPTION ERROR:", err);
    res.status(500).json({ message: "Failed to start payment", error: err.message });
  }
});

// GET /subscription/verify/:reference
// GET /subscription/verify/:reference
router.get("/verify/:reference", authenticateToken, async (req, res) => {
  try {
    const { reference } = req.params;
    const data = await paystackService.verifyTransaction(reference);

    if (data.status === "success") {
      // Look for plan_type or planType inside metadata sent during transaction init
      const planType =
        data.metadata?.plan_type ||
        data.metadata?.planType ||
        req.query.planType ||
        "pro"; // Fallback if metadata is missing

      const landlordId = data.metadata?.landlord_id || req.user.id;

      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + 1);

      await updateSubscription(
        landlordId,
        planType,
        data.subscription_code || null,
        endDate.toISOString()
      );

      return res.json({ success: true, message: `Upgraded to ${planType} plan!` });
    }

    res.status(400).json({ message: "Payment verification failed" });
  } catch (err) {
    console.error("VERIFY SUBSCRIPTION ERROR:", err);
    res.status(500).json({ message: "Verification error", error: err.message });
  }
});

module.exports = router;