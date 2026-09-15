const express = require("express");

const {
  findUserById
} = require("../models/User");
const {
  findTenantByUserEmail
} = require("../models/Tenant");

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
      // Check if user is a tenant
      if (req.user.role === "tenant") {
        const tenant = await findTenantByUserEmail(req.user.email);

        if (!tenant) {
          return res.status(404).json({
            message: "Tenant user not found"
          });
        }

        const nameParts = (tenant.name || "").trim().split(" ");
        const firstName = nameParts[0] || "";
        const lastName = nameParts.slice(1).join(" ") || "";

        return res.status(200).json({
          user: {
            id: tenant.id,
            firstName,
            lastName,
            email: tenant.email,
            phone_no: tenant.phone || "",
            apartment: tenant.apartment || "",
            rent: tenant.rent,
            status: tenant.status,
            role: "tenant",
            lease_ends: tenant.lease_ends,
            lease_interval: tenant.lease_interval || "monthly"
          }
        });
      }

      // The ID comes from the JWT for landlords
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

          role: user.role || "landlord",

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