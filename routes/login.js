const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const { findUserByEmail } = require("../models/User");
const { findTenantByEmail } = require("../models/Tenant");

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // =========================
    // VALIDATION
    // =========================
    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    let account = null;
    let role = null;

    // =========================
    // CHECK LANDLORD
    // =========================
    const landlord = await findUserByEmail(normalizedEmail);

    // Safeguard: Ensure landlord exists and actually has a password stored (handles Google OAuth users)
    if (landlord && landlord.password) {
      const passwordMatch = await bcrypt.compare(password, landlord.password);

      if (passwordMatch) {
        account = landlord;
        role = "landlord";
      }
    }

    // =========================
    // CHECK TENANT
    // =========================
    if (!account) {
      const tenant = await findTenantByEmail(normalizedEmail);

      // Safeguard: Ensure tenant exists and actually has a password set
      if (tenant && tenant.password) {
        const passwordMatch = await bcrypt.compare(password, tenant.password);

        if (passwordMatch) {
          account = tenant;
          role = "tenant";
        }
      }
    }

    // =========================
    // INVALID LOGIN
    // =========================
    if (!account) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    // =========================
    // JWT
    // =========================
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is missing");
      return res.status(500).json({
        message: "Server authentication configuration error",
      });
    }

    const token = jwt.sign(
      {
        id: account.id,
        email: account.email,
        role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    // =========================
    // LANDLORD RESPONSE
    // =========================
    if (role === "landlord") {
      return res.status(200).json({
        message: "Login successful",
        token,
        role: "landlord",
        user: {
          id: account.id,
          firstName: account.first_name,
          lastName: account.last_name,
          email: account.email,
        },
      });
    }

    // =========================
    // TENANT RESPONSE
    // =========================
    return res.status(200).json({
      message: "Login successful",
      token,
      role: "tenant",
      user: {
        id: account.id,
        name: account.name,
        apartment: account.apartment,
        email: account.email,
        phone: account.phone,
        rent: account.rent,
        status: account.status,
        leaseEnds: account.lease_ends,
      },
    });
  } catch (error) {
    console.error("========== LOGIN ERROR ==========");
    console.error(error);
    console.error("Message:", error.message);
    console.error("Stack:", error.stack);
    console.error("=================================");

    return res.status(500).json({
      message: "Something went wrong",
      error: error.message,
    });
  }
});

module.exports = router;