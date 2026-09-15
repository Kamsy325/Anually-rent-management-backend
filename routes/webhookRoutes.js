// routes/webhookRoutes.js
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { updateSubscription } = require("../models/Subscription");

router.post("/paystack", express.json(), async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      console.warn("[WEBHOOK WARNING] PAYSTACK_SECRET_KEY not set; unable to verify signature.");
      return res.status(500).send("PAYSTACK_SECRET_KEY not set");
    }

    const hash = crypto
      .createHmac("sha512", secret)
      .update(JSON.stringify(req.body))
      .digest("hex");

    // Validate Paystack HMAC signature
    if (hash !== req.headers["x-paystack-signature"]) {
      return res.status(400).send("Invalid signature");
    }

    const event = req.body;

    if (event.event === "charge.success") {
      const data = event.data;
      const metadata = data.metadata;

      // Handle subscription payment event
      if (metadata && metadata.plan_type && metadata.landlord_id) {
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 1);

        await updateSubscription(
          metadata.landlord_id,
          metadata.plan_type,
          data.subscription_code || null,
          endDate.toISOString()
        );

        console.log(`[WEBHOOK SUCCESS] Landlord ${metadata.landlord_id} upgraded to ${metadata.plan_type}`);
      }
    }

    res.status(200).send("Webhook received");
  } catch (err) {
    console.error("PAYSTACK WEBHOOK ERROR:", err);
    res.status(500).send("Webhook handler error");
  }
});

module.exports = router;