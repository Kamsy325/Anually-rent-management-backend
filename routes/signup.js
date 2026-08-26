const express = require("express");
const bcrypt = require("bcrypt");
const { createUser, findUserByEmail } = require("../models/User");

const router = express.Router();

router.post("/signup", async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email,
      password,
    } = req.body;

    if (!first_name || !last_name || !email || !password) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    const existingUser = await findUserByEmail(email);

    if (existingUser) {
      return res.status(409).json({
        message: "Email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await createUser(
      first_name,
      last_name,
      email,
      hashedPassword
    );

    res.status(201).json({
      message: "Account created successfully",
      user,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Something went wrong",
    });
  }
});

module.exports = router;