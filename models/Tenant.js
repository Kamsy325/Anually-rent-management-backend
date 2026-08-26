const db = require("./database");


// =====================================================
// CREATE TENANTS TABLE
// =====================================================

db.run(`
  CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    landlord_id INTEGER NOT NULL,

    name TEXT NOT NULL,
    apartment TEXT NOT NULL,

    email TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,

    password TEXT NOT NULL,

    rent REAL NOT NULL,

    status TEXT DEFAULT 'Pending',

    lease_ends TEXT NOT NULL,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (landlord_id)
      REFERENCES users(id)
      ON DELETE CASCADE
  )
`, (err) => {

  if (err) {

    console.error(
      "Error creating tenants table:",
      err
    );

  } else {

    console.log(
      "Tenants table ready"
    );

  }

});


// =====================================================
// CREATE TENANT
// =====================================================

function createTenant(
  landlordId,
  name,
  apartment,
  email,
  phone,
  password,
  rent,
  leaseEnds
) {

  return new Promise((resolve, reject) => {

    const numericRent =
      Number(rent);


    if (
      !Number.isFinite(numericRent) ||
      numericRent < 0
    ) {

      reject(
        new Error(
          "Rent must be a valid number"
        )
      );

      return;

    }


    if (!leaseEnds) {

      reject(
        new Error(
          "Lease end date is required"
        )
      );

      return;

    }


    const sql = `
      INSERT INTO tenants (
        landlord_id,
        name,
        apartment,
        email,
        phone,
        password,
        rent,
        status,
        lease_ends
      )

      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;


    db.run(
      sql,

      [
        landlordId,
        name.trim(),
        apartment.trim(),
        email.trim().toLowerCase(),
        phone.trim(),
        password,
        numericRent,
        "Pending",
        leaseEnds
      ],

      function (err) {

        if (err) {

          reject(err);

          return;

        }


        resolve({

          id: this.lastID,

          landlord_id:
            landlordId,

          name:
            name.trim(),

          apartment:
            apartment.trim(),

          email:
            email.trim().toLowerCase(),

          phone:
            phone.trim(),

          rent:
            numericRent,

          status:
            "Pending",

          lease_ends:
            leaseEnds

        });

      }
    );

  });

}


// =====================================================
// GET TENANTS FOR LANDLORD
// =====================================================

function getTenantsByLandlord(
  landlordId
) {

  return new Promise((resolve, reject) => {

    db.all(

      `
        SELECT

          tenants.id,

          tenants.landlord_id,

          tenants.name,

          tenants.apartment,

          tenants.email,

          tenants.phone,

          tenants.rent,

          tenants.status,

          tenants.lease_ends,

          tenants.created_at,

          users.lease_interval

        FROM tenants

        INNER JOIN users
          ON users.id = tenants.landlord_id

        WHERE tenants.landlord_id = ?

        ORDER BY tenants.created_at DESC
      `,

      [landlordId],

      (err, tenants) => {

        if (err) {

          reject(err);

          return;

        }


        const formattedTenants =
          tenants.map((tenant) => ({

            ...tenant,

            rent:
              Number(tenant.rent),

            leaseEnds:
              tenant.lease_ends,

            lease_interval:
              tenant.lease_interval

          }));


        resolve(
          formattedTenants
        );

      }

    );

  });

}


// =====================================================
// FIND TENANT BY EMAIL
// =====================================================

function findTenantByEmail(
  email
) {

  return new Promise((resolve, reject) => {

    if (!email) {

      resolve(null);

      return;

    }


    db.get(

      `
        SELECT *

        FROM tenants

        WHERE LOWER(email) = LOWER(?)

        LIMIT 1
      `,

      [
        email.trim().toLowerCase()
      ],

      (err, tenant) => {

        if (err) {

          reject(err);

          return;

        }


        resolve(tenant);

      }

    );

  });

}


// =====================================================
// FIND TENANT FOR LOGGED-IN TENANT
//
// IMPORTANT:
//
// This is different from findTenantById().
//
// Landlords identify tenants using:
// tenant.id + landlord_id
//
// Tenants identify themselves using:
// their authenticated email.
//
// This prevents a tenant from getting another tenant's data.
// =====================================================

function findTenantByUserEmail(
  email
) {

  return new Promise((resolve, reject) => {

    if (!email) {

      resolve(null);

      return;

    }


    db.get(

      `
        SELECT

          tenants.id,

          tenants.landlord_id,

          tenants.name,

          tenants.apartment,

          tenants.email,

          tenants.phone,

          tenants.rent,

          tenants.status,

          tenants.lease_ends,

          tenants.created_at,

          users.lease_interval

        FROM tenants

        INNER JOIN users
          ON users.id = tenants.landlord_id

        WHERE LOWER(tenants.email) = LOWER(?)

        LIMIT 1
      `,

      [
        email.trim().toLowerCase()
      ],

      (err, tenant) => {

        if (err) {

          reject(err);

          return;

        }


        if (!tenant) {

          resolve(null);

          return;

        }


        tenant.rent =
          Number(tenant.rent);


        tenant.leaseEnds =
          tenant.lease_ends;


        tenant.lease_interval =
          tenant.lease_interval;


        resolve(tenant);

      }

    );

  });

}


// =====================================================
// FIND TENANT BY ID FOR LANDLORD
// =====================================================

function findTenantById(
  id,
  landlordId
) {

  return new Promise((resolve, reject) => {

    db.get(

      `
        SELECT

          tenants.id,

          tenants.landlord_id,

          tenants.name,

          tenants.apartment,

          tenants.email,

          tenants.phone,

          tenants.rent,

          tenants.status,

          tenants.lease_ends,

          tenants.created_at,

          users.lease_interval

        FROM tenants

        INNER JOIN users
          ON users.id = tenants.landlord_id

        WHERE tenants.id = ?

          AND tenants.landlord_id = ?
      `,

      [
        id,
        landlordId
      ],

      (err, tenant) => {

        if (err) {

          reject(err);

          return;

        }


        if (tenant) {

          tenant.rent =
            Number(tenant.rent);

          tenant.leaseEnds =
            tenant.lease_ends;

          tenant.lease_interval =
            tenant.lease_interval;

        }


        resolve(tenant);

      }

    );

  });

}


// =====================================================
// UPDATE TENANT
// =====================================================

function updateTenant(
  id,
  landlordId,
  name,
  apartment,
  email,
  phone,
  rent,
  leaseEnds
) {

  return new Promise((resolve, reject) => {

    const numericRent =
      Number(rent);


    if (
      !Number.isFinite(numericRent) ||
      numericRent < 0
    ) {

      reject(
        new Error(
          "Rent must be a valid number"
        )
      );

      return;

    }


    if (!leaseEnds) {

      reject(
        new Error(
          "Lease end date is required"
        )
      );

      return;

    }


    const sql = `
      UPDATE tenants

      SET

        name = ?,

        apartment = ?,

        email = ?,

        phone = ?,

        rent = ?,

        lease_ends = ?

      WHERE id = ?

        AND landlord_id = ?
    `;


    db.run(

      sql,

      [
        name.trim(),

        apartment.trim(),

        email.trim().toLowerCase(),

        phone.trim(),

        numericRent,

        leaseEnds,

        id,

        landlordId
      ],

      function (err) {

        if (err) {

          reject(err);

          return;

        }


        resolve({

          changes:
            this.changes

        });

      }

    );

  });

}


// =====================================================
// DELETE TENANT
// =====================================================

function deleteTenant(
  id,
  landlordId
) {

  return new Promise((resolve, reject) => {

    db.run(

      `
        DELETE FROM tenants

        WHERE id = ?

          AND landlord_id = ?
      `,

      [
        id,
        landlordId
      ],

      function (err) {

        if (err) {

          reject(err);

          return;

        }


        resolve({

          changes:
            this.changes

        });

      }

    );

  });

}


// =====================================================
// EXPORTS
// =====================================================

module.exports = {

  createTenant,

  getTenantsByLandlord,

  findTenantByEmail,

  findTenantByUserEmail,

  findTenantById,

  updateTenant,

  deleteTenant

};