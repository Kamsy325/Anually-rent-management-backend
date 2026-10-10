const express = require("express");

const {
  findUserById,
  updateUser
} = require("../models/User");

const authenticateToken = require("../middleware/auth");

const router = express.Router();


// =====================================================
// UPDATE PROFILE
// =====================================================

router.put(
  "/update-profile",
  authenticateToken,
  async (req, res) => {

    try {

      const userId = req.user.id;


      const {
        firstName,
        lastName,
        email,
        phone_no,
        company_name,
        address,
        bio,
      } = req.body;

      const rawInterval =
        req.body.rent_interval ||
        req.body.rentInterval ||
        req.body.lease_interval ||
        req.body.leaseInterval;

      // =================================================
      // VALIDATION
      // =================================================

      if (
        !firstName ||
        !lastName ||
        !email
      ) {

        return res.status(400).json({
          message:
            "First name, last name and email are required"
        });

      }


      // =================================================
      // CHECK LEASE / RENT INTERVAL
      // =================================================

      let lease_interval = "monthly";
      if (rawInterval) {
        const cleaned = String(rawInterval).trim().toLowerCase();
        if (cleaned === "annual" || cleaned === "annually" || cleaned === "yearly") {
          lease_interval = "annually";
        } else if (cleaned === "monthly") {
          lease_interval = "monthly";
        } else {
          return res.status(400).json({
            message: "Rent/lease interval must be monthly or annually"
          });
        }
      }


      // =================================================
      // CHECK EMAIL
      // =================================================

      const existingUser =
        await findUserById(userId);


      if (!existingUser) {

        return res.status(404).json({
          message: "User not found"
        });

      }


      // If email changed, make sure another user
      // isn't already using it.

      const {
        findUserByEmail
      } = require("../models/User");


      const emailUser =
        await findUserByEmail(
          email.trim().toLowerCase()
        );


      if (
        emailUser &&
        emailUser.id !== userId
      ) {

        return res.status(409).json({
          message:
            "That email address is already in use"
        });

      }


      // =================================================
      // UPDATE
      // =================================================

      await updateUser(

        userId,

        firstName.trim(),

        lastName.trim(),

        email.trim().toLowerCase(),

        phone_no
          ? phone_no.trim()
          : "",

        company_name
          ? company_name.trim()
          : "",

        address
          ? address.trim()
          : "",

        bio
          ? bio.trim()
          : "",

        lease_interval

      );


      // =================================================
      // GET UPDATED USER
      // =================================================

      const updatedUser =
        await findUserById(userId);


      // =================================================
      // RESPONSE
      // =================================================

      return res.status(200).json({

        message:
          "Profile updated successfully",

        user: {

          id: updatedUser.id,

          firstName:
            updatedUser.first_name,

          lastName:
            updatedUser.last_name,

          email:
            updatedUser.email,

          phone_no:
            updatedUser.phone_no || "",

          company_name:
            updatedUser.company_name || "",

          address:
            updatedUser.address || "",

          bio:
            updatedUser.bio || "",

          lease_interval:
            updatedUser.lease_interval || "monthly",

          rent_interval:
            updatedUser.lease_interval || "monthly"
        }

      });

    } catch (error) {

      console.error(
        "Update profile error:",
        error
      );


      return res.status(500).json({
        message:
          "Something went wrong while updating your profile"
      });

    }

  }
);


module.exports = router;