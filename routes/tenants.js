const express = require("express");

const bcrypt = require("bcrypt");

const authenticateToken =
  require("../middleware/auth");

const requireLandlord =
  require("../middleware/requireLandlord");

const {
  createTenant,
  getTenantsByLandlord,
  findTenantById,
  updateTenant,
  deleteTenant
} = require("../models/Tenant");


const router = express.Router();


// =====================================================
// GET ALL TENANTS
// GET /tenants
// =====================================================

router.get(
  "/tenants",
  authenticateToken,
  requireLandlord,
  async (req, res) => {

    try {

      const tenants =
        await getTenantsByLandlord(
          req.user.id
        );


      res.status(200).json({

        tenants

      });

    } catch (error) {

      console.error(
        "Get tenants error:",
        error
      );


      res.status(500).json({

        message:
          "Failed to get tenants"

      });

    }

  }
);


// =====================================================
// GET ONE TENANT
// GET /tenants/:id
// =====================================================

router.get(
  "/tenants/:id",
  authenticateToken,
  requireLandlord,
  async (req, res) => {

    try {

      const tenant =
        await findTenantById(
          req.params.id,
          req.user.id
        );

      if (!tenant) {

        return res.status(404).json({
          message: "Tenant not found"
        });

      }

      res.status(200).json({
        tenant
      });

    } catch (error) {

      console.error(
        "Get tenant error:",
        error
      );

      res.status(500).json({
        message: "Failed to get tenant"
      });

    }

  }
);

// =====================================================
// CREATE TENANT
// POST /tenants
// =====================================================

// =====================================================
// CREATE TENANT
// POST /tenants
// =====================================================

router.post(
  "/tenants",
  authenticateToken,
  requireLandlord,
  async (req, res) => {

    try {

      const {
        name,
        apartment,
        email,
        phone,
        rent,
        leaseEnds,
        password
      } = req.body;


      console.log(
        "ADD TENANT REQUEST:",
        {
          name,
          apartment,
          email,
          phone,
          rent,
          leaseEnds,
          passwordExists: !!password
        }
      );


      // =====================================================
      // VALIDATION
      // =====================================================

      if (
        !name ||
        !apartment ||
        !email ||
        !phone ||
        rent === undefined ||
        rent === null ||
        rent === "" ||
        !leaseEnds ||
        !password
      ) {

        return res.status(400).json({
          message:
            "All tenant fields are required"
        });

      }


      // =====================================================
      // VALIDATE RENT
      // =====================================================

      const numericRent = Number(rent);


      if (
        !Number.isFinite(numericRent) ||
        numericRent < 0
      ) {

        return res.status(400).json({
          message:
            "Rent must be a valid number"
        });

      }


      // =====================================================
      // HASH PASSWORD
      // =====================================================

      const hashedPassword =
        await bcrypt.hash(
          password,
          12
        );


      // =====================================================
      // CREATE TENANT
      // =====================================================

      const tenant =
        await createTenant(
          req.user.id,
          name,
          apartment,
          email,
          phone,
          hashedPassword,
          numericRent,
          leaseEnds
        );


      // =====================================================
      // RESPONSE
      // =====================================================

      return res.status(201).json({

        message:
          "Tenant created successfully",

        tenant

      });

    } catch (error) {

      console.error(
        "Create tenant error:",
        error
      );


      if (
        error.message &&
        error.message.includes("UNIQUE")
      ) {

        return res.status(409).json({
          message:
            "A tenant with this email already exists"
        });

      }


      return res.status(500).json({
        message:
          "Failed to create tenant"
      });

    }

  }
);


// =====================================================
// UPDATE TENANT
// PUT /tenants/:id
// =====================================================

router.put(
  "/tenants/:id",
  authenticateToken,
  requireLandlord,
  async (req, res) => {

    try {

      const {
        name,
        apartment,
        email,
        phone,
        rent,
        leaseEnds
      } = req.body;


      // =========================
      // FIND TENANT
      // =========================

      const existingTenant =
        await findTenantById(
          req.params.id,
          req.user.id
        );


      if (!existingTenant) {

        return res.status(404).json({
          message: "Tenant not found"
        });

      }


      // =========================
      // VALIDATION
      // =========================

      if (
        !name ||
        !apartment ||
        !email ||
        !phone ||
        rent === undefined ||
        rent === null ||
        !leaseEnds
      ) {

        return res.status(400).json({
          message: "All tenant fields are required"
        });

      }


      // =========================
      // UPDATE
      // =========================

      const result =
        await updateTenant(
          req.params.id,
          req.user.id,
          name,
          apartment,
          email,
          phone,
          rent,
          leaseEnds
        );


      if (result.changes === 0) {

        return res.status(404).json({
          message: "Tenant not found"
        });

      }


      // =========================
      // GET UPDATED TENANT
      // =========================

      const tenant =
        await findTenantById(
          req.params.id,
          req.user.id
        );


      res.status(200).json({

        message:
          "Tenant updated successfully",

        tenant

      });

    } catch (error) {

      console.error(
        "Update tenant error:",
        error
      );


      if (
        error.message &&
        error.message.includes("UNIQUE")
      ) {

        return res.status(409).json({
          message:
            "A tenant with this email already exists"
        });

      }


      res.status(500).json({
        message: "Failed to update tenant"
      });

    }

  }
);

// =====================================================
// DELETE TENANT
// DELETE /tenants/:id
// =====================================================

router.delete(
  "/tenants/:id",
  authenticateToken,
  requireLandlord,
  async (req, res) => {

    try {

      console.log(
        "DELETE TENANT ID:",
        req.params.id
      );

      console.log(
        "DELETE LANDLORD ID:",
        req.user.id
      );


      const tenant =
        await findTenantById(
          req.params.id,
          req.user.id
        );


      if (!tenant) {

        return res.status(404).json({
          message: "Tenant not found"
        });

      }


      const result =
        await deleteTenant(
          req.params.id,
          req.user.id
        );


      if (result.changes === 0) {

        return res.status(404).json({
          message: "Tenant not found"
        });

      }


      res.status(200).json({

        message:
          "Tenant deleted successfully"

      });

    } catch (error) {

      console.error(
        "Delete tenant error:",
        error
      );

      res.status(500).json({

        message:
          "Failed to delete tenant"

      });

    }

  }
);

module.exports = router;