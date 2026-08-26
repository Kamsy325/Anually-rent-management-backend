const express = require("express");

const {
  findUserById
} = require("../models/User");

const authenticateToken = require("../middleware/auth");

const router = express.Router();


// =====================================================
// GET CURRENT USER
// =====================================================

router.get(
  "/get-user",
  authenticateToken,
  async (req, res) => {

    try {

      // The ID comes from the JWT
      const user = await findUserById(
        req.user.id
      );


      if (!user) {

        return res.status(404).json({
          message: "User not found"
        });

      }


      console.log("GET USER FROM DATABASE:", user);
      console.log("GET USER ROLE:", user.role);
      
      return res.status(200).json({

        user: {

          id: user.id,

          firstName: user.first_name,
          lastName: user.last_name,

          email: user.email,

          phone_no: user.phone_no || "",

          company_name:
            user.company_name || "",

          address:
            user.address || "",

          bio:
            user.bio || "",

          lease_interval:
            user.lease_interval || "monthly"

        }

      });

    } catch (error) {

      console.error(
        "Get user error:",
        error
      );

      return res.status(500).json({
        message: "Something went wrong"
      });

    }

  }
);


module.exports = router;