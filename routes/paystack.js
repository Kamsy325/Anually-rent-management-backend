const express = require("express");

const authenticateToken = require("../middleware/auth");
const requireLandlord = require("../middleware/requireLandlord");

const {
  getBanks,
  createSubaccount,
  getSubaccount,
} = require("../services/paystack");

const {
  getPayoutInfo,
  savePaystackSubaccount,
  findUserById,
} = require("../models/User");

const router = express.Router();

// =====================================================
// GET BANKS
//
// GET /paystack/banks
// =====================================================
router.get(
  "/paystack/banks",
  authenticateToken,
  requireLandlord,
  async (req, res) => {
    try {
      const banks = await getBanks();

      return res.status(200).json({
        banks,
      });
    } catch (error) {
      console.error(
        "GET PAYSTACK BANKS ERROR:",
        error.response?.data || error
      );

      return res.status(500).json({
        message: "Failed to load banks",
      });
    }
  }
);

// =====================================================
// GET PAYOUT STATUS
//
// GET /paystack/payout
// =====================================================
router.get(
  "/paystack/payout",
  authenticateToken,
  requireLandlord,
  async (req, res) => {
    try {
      const payout = await getPayoutInfo(req.user.id);

      if (!payout || !payout.paystack_subaccount_code) {
        return res.status(200).json({
          connected: false,
        });
      }

      // Safely fetch details from Paystack without throwing a 500 error if subaccount is invalid
      try {
        const subaccount = await getSubaccount(
          payout.paystack_subaccount_code
        );

        return res.status(200).json({
          connected: true,
          payout: {
            subaccountCode: payout.paystack_subaccount_code,
            businessName: subaccount.business_name,
            accountName: subaccount.account_name,
            bank: subaccount.settlement_bank,
            active: subaccount.active,
          },
        });
      } catch (paystackError) {
        console.error(
          "Paystack API Subaccount Lookup Failed:",
          paystackError.response?.data || paystackError.message
        );

        // Fallback: Return connected as false if the code doesn't exist on Paystack (e.g. test vs live mismatch)
        return res.status(200).json({
          connected: false,
          message: "Saved subaccount code is invalid or missing on Paystack.",
        });
      }
    } catch (error) {
      console.error(
        "GET PAYOUT ERROR:",
        error.response?.data || error
      );

      return res.status(500).json({
        message: "Failed to get payout information",
      });
    }
  }
);

// =====================================================
// CONNECT PAYOUT
//
// POST /paystack/payout
// =====================================================
router.post(
  "/paystack/payout",
  authenticateToken,
  requireLandlord,
  async (req, res) => {
    try {
      const { businessName, bankCode, accountNumber } = req.body;

      // =================================================
      // 1. VALIDATE INPUT FIELDS
      // =================================================
      if (!businessName || !bankCode || !accountNumber) {
        return res.status(400).json({
          message: "Business name, bank and account number are required",
        });
      }

      const cleanAccountNumber = String(accountNumber).replace(/\s/g, "");

      if (!/^\d{10}$/.test(cleanAccountNumber)) {
        return res.status(400).json({
          message: "Account number must contain 10 digits",
        });
      }

      // =================================================
      // 2. VERIFY LANDLORD ACCOUNT EXISTS IN DB
      // =================================================
      const landlordUser = await findUserById(req.user.id);

      if (!landlordUser) {
        console.error(
          `CONNECT PAYOUT ERROR: User ID ${req.user.id} from JWT token not found in database.`
        );
        return res.status(404).json({
          message: "Landlord account not found. Please log out and log back in.",
        });
      }

      // =================================================
      // 3. CHECK EXISTING CONNECTION
      // =================================================
      const existing = await getPayoutInfo(req.user.id);

      if (existing?.paystack_subaccount_code) {
        return res.status(409).json({
          message: "A Paystack payout account is already connected",
        });
      }

      // =================================================
      // 4. CREATE SUBACCOUNT VIA PAYSTACK SERVICE
      // =================================================
      const subaccount = await createSubaccount({
        businessName: businessName.trim(),
        bankCode: String(bankCode),
        accountNumber: cleanAccountNumber,
      });

      // =================================================
      // 5. SAVE SUBACCOUNT CODE TO DATABASE
      // =================================================
      const result = await savePaystackSubaccount(
        req.user.id,
        subaccount.subaccount_code
      );

      if (result.changes === 0) {
        return res.status(404).json({
          message: "Landlord account not found",
        });
      }

      // =================================================
      // 6. SUCCESS RESPONSE
      // =================================================
      return res.status(201).json({
        message: "Payout account connected successfully",
        payout: {
          connected: true,
          subaccountCode: subaccount.subaccount_code,
          businessName: subaccount.business_name,
          accountName: subaccount.account_name,
          bank: subaccount.settlement_bank,
          active: subaccount.active,
        },
      });
    } catch (error) {
      console.error(
        "CONNECT PAYOUT ERROR:",
        error.response?.data || error
      );

      return res.status(error.response?.status || 500).json({
        message:
          error.response?.data?.message ||
          "Failed to connect payout account",
      });
    }
  }
);

module.exports = router;
