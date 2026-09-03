const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const {
  createUser,
  findUserByEmail,
  findUserByVerificationToken,
  verifyUserAccount,
} = require("../models/User");

const router = express.Router();

// Email Transporter Config
const transporter = nodemailer.createTransport({
  service: "gmail", // or your SMTP provider
  auth: {
    user: process.env.EMAIL_USER, // your email
    pass: process.env.EMAIL_PASS, // app-specific password
  },
});

// ========================================
// 1. SIGNUP ROUTE
// ========================================
router.post("/signup", async (req, res) => {
  try {
    const { first_name, last_name, email, password } = req.body;

    if (!first_name || !last_name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const verificationToken = crypto.randomBytes(32).toString("hex");

    await createUser(
      first_name,
      last_name,
      email,
      hashedPassword,
      verificationToken
    );

    // Send Verification Email
    const verificationUrl = `https://anually.vercel.app/verify-email?token=${verificationToken}`;

    const mailOptions = {
      from: '"Annually" <no-reply@annually.com>',
      to: email,
      subject: "Activate Your Annually Account",
      html: `
        <h2>Welcome to Annually, ${first_name}!</h2>
        <p>Please click the link below to verify your email address and activate your account:</p>
        <a href="${verificationUrl}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          Verify Email Account
        </a>
        <p>If you did not request this, please ignore this email.</p>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(201).json({
      message: "Confirmation link sent to your email.",
    });
  } catch (error) {
    console.error("SIGNUP ERROR:", error);
    res.status(500).json({ message: "Something went wrong" });
  }
});

// ========================================
// 2. VERIFY EMAIL ROUTE
// ========================================
router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ message: "Verification token is required" });
    }

    const user = await findUserByVerificationToken(token);

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired token." });
    }

    // Update user status
    await verifyUserAccount(user.id);

    // Generate login session JWT
    const authToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || "your_jwt_secret",
      { expiresIn: "7d" }
    );

    res.status(200).json({
      message: "Email verified successfully!",
      token: authToken,
      role: user.role,
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("VERIFY ERROR:", error);
    res.status(500).json({ message: "Verification failed. Please try again." });
  }
});

module.exports = router;