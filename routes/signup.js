const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const db = require("../models/database");
const {
  createUser,
  findUserByEmail,
  findUserByVerificationToken,
  verifyUserAccount,
  updateUserVerificationToken,
} = require("../models/User");

const router = express.Router();
const dns = require("dns");

// Ensure IPv4 lookup takes precedence to avoid ENETUNREACH on cloud platforms
try {
  dns.setDefaultResultOrder("ipv4first");
} catch (e) {}

/**
 * Sends email via HTTP APIs (Resend, Brevo, SendGrid) over HTTPS (port 443),
 * completely bypassing cloud hosting SMTP port blocks (such as Render free tier).
 */
async function sendViaHttpApi(email, firstName, verificationUrl, htmlContent) {
  // 1. Resend (https://resend.com - Free tier: 3,000 emails/month)
  if (process.env.RESEND_API_KEY) {
    try {
      const apiKey = process.env.RESEND_API_KEY.trim();
      const fromAddress = process.env.EMAIL_FROM || "Annually <onboarding@resend.dev>";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [email],
          subject: "Activate Your Annually Account",
          html: htmlContent,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        console.log(`[SIGNUP] Email successfully delivered to ${email} via Resend HTTP API (id: ${data.id || "ok"})`);
        return { success: true };
      } else {
        console.warn(`[SIGNUP] Resend API error:`, data);
      }
    } catch (err) {
      console.warn(`[SIGNUP] Resend API request failed:`, err.message);
    }
  }

  // 2. Brevo / Sendinblue (https://brevo.com - Free tier: 300 emails/day)
  if (process.env.BREVO_API_KEY) {
    try {
      const apiKey = process.env.BREVO_API_KEY.trim();
      const senderEmail = process.env.EMAIL_USER || "no-reply@annually.com";
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender: { name: "Annually", email: senderEmail },
          to: [{ email, name: firstName }],
          subject: "Activate Your Annually Account",
          htmlContent,
        }),
      });

      if (res.ok) {
        console.log(`[SIGNUP] Email successfully delivered to ${email} via Brevo HTTP API`);
        return { success: true };
      }
    } catch (err) {
      console.warn(`[SIGNUP] Brevo API request failed:`, err.message);
    }
  }

  // 3. SendGrid (https://sendgrid.com - Free tier: 100 emails/day)
  if (process.env.SENDGRID_API_KEY) {
    try {
      const apiKey = process.env.SENDGRID_API_KEY.trim();
      const senderEmail = process.env.EMAIL_USER || "no-reply@annually.com";
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email }] }],
          from: { email: senderEmail, name: "Annually" },
          subject: "Activate Your Annually Account",
          content: [{ type: "text/html", value: htmlContent }],
        }),
      });

      if (res.ok || res.status === 202) {
        console.log(`[SIGNUP] Email successfully delivered to ${email} via SendGrid HTTP API`);
        return { success: true };
      }
    } catch (err) {
      console.warn(`[SIGNUP] SendGrid API request failed:`, err.message);
    }
  }

  return { success: false };
}

/**
 * Creates a Nodemailer transporter configured with IPv4 enforcement
 * and optimal cloud host settings.
 */
function createSmtpTransporter(port = 587, secure = false) {
  const emailUser = (process.env.EMAIL_USER || "").trim();
  // Strip any whitespace from the app password (e.g. Google's 4-char spaced format "xxxx xxxx xxxx xxxx")
  const emailPass = (process.env.EMAIL_PASS || "").trim().replace(/\s+/g, "");

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure, // true for 465, false for 587 (uses STARTTLS)
    auth: {
      user: emailUser,
      pass: emailPass,
    },
    tls: {
      rejectUnauthorized: false,
    },
    family: 4, // Forces IPv4
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 8000,
  });
}

async function dispatchVerificationEmail(email, firstName, verificationToken) {
  const frontendUrl = process.env.FRONTEND_URL || "https://anually.netlify.app";
  const verificationUrl = `${frontendUrl}/verify-email?token=${verificationToken}`;

  const htmlContent = `
    <h2>Welcome to Annually, ${firstName}!</h2>
    <p>Please click the link below to verify your email address and activate your account:</p>
    <a href="${verificationUrl}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
      Verify Email Account
    </a>
    <p>If you did not request this, please ignore this email.</p>
  `;

  // First: Check if an HTTP Email API key is configured (Resend, Brevo, SendGrid)
  // This bypasses Render's free-tier outbound SMTP port restrictions
  const httpResult = await sendViaHttpApi(email, firstName, verificationUrl, htmlContent);
  if (httpResult.success) {
    return { sent: true, verificationUrl };
  }

  const emailUser = (process.env.EMAIL_USER || "").trim();
  const emailPass = (process.env.EMAIL_PASS || "").trim().replace(/\s+/g, "");

  if (!emailUser || !emailPass) {
    console.warn("[SIGNUP] EMAIL_USER, EMAIL_PASS, or RESEND_API_KEY not configured in environment variables.");
    console.info(`[SIGNUP] Direct activation link: ${verificationUrl}`);
    return { sent: false, error: "SMTP not configured", verificationUrl };
  }

  // Use the authenticated email in the 'from' field so Gmail SMTP does not reject or flag the message
  const senderAddress = process.env.EMAIL_FROM || `"Annually" <${emailUser}>`;

  const mailOptions = {
    from: senderAddress,
    to: email,
    subject: "Activate Your Annually Account",
    html: htmlContent,
  };

  const configuredPort = parseInt(process.env.SMTP_PORT || "587", 10);
  const isConfiguredSecure = configuredPort === 465 || process.env.SMTP_SECURE === "true";

  // Attempt SMTP
  try {
    const primaryTransporter = createSmtpTransporter(configuredPort, isConfiguredSecure);
    await primaryTransporter.sendMail(mailOptions);
    console.log(`[SIGNUP] Verification email successfully sent to ${email} via port ${configuredPort}`);
    return { sent: true, verificationUrl };
  } catch (primaryErr) {
    console.warn(`[SIGNUP] Primary SMTP (port ${configuredPort}) failed:`, primaryErr.message);

    const fallbackPort = configuredPort === 465 ? 587 : 465;
    const fallbackSecure = fallbackPort === 465;

    try {
      console.log(`[SIGNUP] Attempting fallback SMTP on port ${fallbackPort}...`);
      const fallbackTransporter = createSmtpTransporter(fallbackPort, fallbackSecure);
      await fallbackTransporter.sendMail(mailOptions);
      console.log(`[SIGNUP] Verification email successfully sent to ${email} via fallback port ${fallbackPort}`);
      return { sent: true, verificationUrl };
    } catch (fallbackErr) {
      console.warn(
        `[SIGNUP] Outbound SMTP failed (Render free tier blocks SMTP ports 587 & 465).\n` +
        `[SIGNUP] TIP: Add RESEND_API_KEY to your Render environment to send emails over HTTPS.\n` +
        `[SIGNUP] Direct activation link: ${verificationUrl}`
      );
      return { sent: false, error: primaryErr.message || fallbackErr.message, verificationUrl };
    }
  }
}

// Track in-flight signup requests to prevent race conditions from double-clicks/submits
const inFlightSignups = new Map();

// ========================================
// 1. SIGNUP ROUTE
// ========================================
router.post("/signup", async (req, res) => {
  const { first_name, last_name, email, password } = req.body;

  if (!first_name || !last_name || !email || !password) {
    return res.status(400).json({ message: "All fields are required" });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // If a signup for this email is currently in progress, wait for it rather than creating a duplicate or throwing 409
  if (inFlightSignups.has(normalizedEmail)) {
    try {
      const result = await inFlightSignups.get(normalizedEmail);
      return res.status(result.status || 201).json(result.body);
    } catch (err) {
      console.error("[SIGNUP IN-FLIGHT ERROR]:", err);
    }
  }

  const signupPromise = (async () => {
    const existingUser = await findUserByEmail(normalizedEmail);

    if (existingUser) {
      // If user is already verified, inform them to log in
      if (existingUser.is_verified) {
        return {
          status: 409,
          body: {
            message: "An account with this email already exists and is verified. Please log in.",
            is_verified: true,
          },
        };
      }

      // If user registered earlier but never verified, refresh token and resend verification
      const verificationToken = crypto.randomBytes(32).toString("hex");
      const hashedPassword = await bcrypt.hash(password, 12);

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE users SET password = ?, first_name = ?, last_name = ?, verification_token = ? WHERE id = ?`,
          [hashedPassword, first_name.trim(), last_name.trim(), verificationToken, existingUser.id],
          (err) => (err ? reject(err) : resolve())
        );
      });

      const emailResult = await dispatchVerificationEmail(normalizedEmail, first_name.trim(), verificationToken);

      return {
        status: 200,
        body: {
          message: emailResult.sent
            ? "Confirmation link sent to your email."
            : "Account was previously created. Please use the activation link to verify your account.",
          emailSent: emailResult.sent,
          verificationUrl: emailResult.verificationUrl,
          unverified: true,
        },
      };
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const verificationToken = crypto.randomBytes(32).toString("hex");

    try {
      await createUser(
        first_name.trim(),
        last_name.trim(),
        normalizedEmail,
        hashedPassword,
        verificationToken
      );
    } catch (insertErr) {
      // If a collision occurred (e.g. concurrent insert), fetch user and return confirmation
      console.warn("[SIGNUP] Collision during createUser, recovering:", insertErr.message);
      const freshlyCreated = await findUserByEmail(normalizedEmail);
      if (freshlyCreated) {
        const emailResult = await dispatchVerificationEmail(
          normalizedEmail,
          first_name.trim(),
          freshlyCreated.verification_token || verificationToken
        );
        return {
          status: 201,
          body: {
            message: emailResult.sent
              ? "Confirmation link sent to your email."
              : "Account created! Please use the activation link below to verify your account.",
            emailSent: emailResult.sent,
            verificationUrl: emailResult.verificationUrl,
          },
        };
      }
      throw insertErr;
    }

    const emailResult = await dispatchVerificationEmail(normalizedEmail, first_name.trim(), verificationToken);

    return {
      status: 201,
      body: {
        message: emailResult.sent
          ? "Confirmation link sent to your email."
          : "Account created! Please use the activation link below to verify your account.",
        emailSent: emailResult.sent,
        verificationUrl: emailResult.verificationUrl,
      },
    };
  })();

  inFlightSignups.set(normalizedEmail, signupPromise);

  try {
    const result = await signupPromise;
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("SIGNUP ERROR:", error);
    return res.status(500).json({ message: "Something went wrong" });
  } finally {
    // Keep in-flight lock active briefly to absorb immediate double-submits
    setTimeout(() => {
      inFlightSignups.delete(normalizedEmail);
    }, 2000);
  }
});

// ========================================
// 2. RESEND VERIFICATION EMAIL ROUTE
// ========================================
router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await findUserByEmail(normalizedEmail);

    if (!user) {
      return res.status(404).json({ message: "No account found with this email" });
    }

    if (user.is_verified) {
      return res.status(400).json({ message: "This account is already verified. Please log in." });
    }

    const verificationToken = crypto.randomBytes(32).toString("hex");
    await updateUserVerificationToken(user.id, verificationToken);

    const emailResult = await dispatchVerificationEmail(
      normalizedEmail,
      user.first_name || "there",
      verificationToken
    );

    return res.status(200).json({
      message: emailResult.sent
        ? "A fresh verification link has been sent to your email."
        : "Fresh verification link generated.",
      emailSent: emailResult.sent,
      verificationUrl: emailResult.verificationUrl,
    });
  } catch (error) {
    console.error("RESEND VERIFICATION ERROR:", error);
    res.status(500).json({ message: "Failed to resend verification email" });
  }
});

// ========================================
// 3. VERIFY EMAIL ROUTE (GET & POST)
// ========================================
const handleVerifyEmail = async (req, res) => {
  try {
    const token = req.query.token || req.body?.token;

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
};

router.get("/verify-email", handleVerifyEmail);
router.post("/verify-email", handleVerifyEmail);

module.exports = router;