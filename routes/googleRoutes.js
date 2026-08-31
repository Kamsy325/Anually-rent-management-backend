const express = require("express");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const { findOrCreateGoogleUser } = require("../models/User");

const router = express.Router();

router.post("/google", async (req, res) => {
  try {
    const { access_token } = req.body;

    if (!access_token) {
      return res.status(400).json({ message: "Google Access Token is required" });
    }

    // Use access_token to fetch user information directly from Google
    const googleRes = await axios.get(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    const googleUser = googleRes.data; // { email, given_name, family_name, picture, ... }

    // Find or create user in SQLite database
    const user = await findOrCreateGoogleUser(googleUser);

    // Generate backend session JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || "your_jwt_secret",
      { expiresIn: "7d" }
    );

    res.status(200).json({
      message: "Google sign-in successful",
      token,
      role: user.role,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("GOOGLE ROUTE ERROR:", error.response?.data || error.message);
    res.status(500).json({ message: "Google authentication failed" });
  }
});

module.exports = router;