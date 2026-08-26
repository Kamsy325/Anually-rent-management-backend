const db = require("./database");


// ========================================
// CREATE USERS TABLE
// ========================================

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    first_name TEXT,
    last_name TEXT,

    email TEXT UNIQUE NOT NULL,

    password TEXT NOT NULL,

    phone_no TEXT,

    company_name TEXT,

    address TEXT,

    bio TEXT,

    lease_interval TEXT DEFAULT 'monthly',

    role TEXT DEFAULT 'landlord',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);


// ========================================
// CREATE USER
// ========================================

function createUser(
  firstName,
  lastName,
  email,
  password,
  phoneNo = "",
  companyName = "",
  address = "",
  bio = "",
  leaseInterval = "monthly",
  role = "landlord"
) {

  return new Promise((resolve, reject) => {

    const sql = `
      INSERT INTO users (
        first_name,
        last_name,
        email,
        password,
        phone_no,
        company_name,
        address,
        bio,
        lease_interval,
        role
      )

      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;


    db.run(
      sql,

      [
        firstName,
        lastName,
        email,
        password,
        phoneNo,
        companyName,
        address,
        bio,
        leaseInterval,
        role
      ],

      function (err) {

        if (err) {
          reject(err);
          return;
        }


        resolve({
          id: this.lastID,

          firstName,
          lastName,

          email,

          phoneNo,

          companyName,

          address,

          bio,

          leaseInterval,

          role
        });

      }
    );

  });

}


// ========================================
// FIND USER BY EMAIL
// ========================================

function findUserByEmail(email) {

  return new Promise((resolve, reject) => {

    const sql = `
      SELECT *
      FROM users
      WHERE email = ?
      LIMIT 1
    `;


    db.get(
      sql,

      [email],

      (err, user) => {

        if (err) {
          reject(err);
          return;
        }


        resolve(user);

      }
    );

  });

}


// ========================================
// FIND USER BY ID
// ========================================

function findUserById(id) {

  return new Promise((resolve, reject) => {

    const sql = `
      SELECT *
      FROM users
      WHERE id = ?
      LIMIT 1
    `;


    db.get(
      sql,

      [id],

      (err, user) => {

        if (err) {
          reject(err);
          return;
        }


        resolve(user);

      }
    );

  });

}


// ========================================
// UPDATE USER
// ========================================

function updateUser(
  id,
  firstName,
  lastName,
  email,
  phoneNo,
  companyName,
  address,
  bio,
  leaseInterval
) {

  return new Promise((resolve, reject) => {

    const sql = `
      UPDATE users

      SET
        first_name = ?,
        last_name = ?,
        email = ?,
        phone_no = ?,
        company_name = ?,
        address = ?,
        bio = ?,
        lease_interval = ?

      WHERE id = ?
    `;


    db.run(

      sql,

      [
        firstName,
        lastName,
        email,
        phoneNo,
        companyName,
        address,
        bio,
        leaseInterval,
        id
      ],

      function (err) {

        if (err) {
          reject(err);
          return;
        }


        if (this.changes === 0) {

          resolve(null);

          return;
        }


        findUserById(id)

          .then(resolve)

          .catch(reject);

      }

    );

  });

}


// ========================================
// DELETE USER
// ========================================

function deleteUser(id) {

  return new Promise((resolve, reject) => {

    db.run(
      `
        DELETE FROM users
        WHERE id = ?
      `,

      [id],

      function (err) {

        if (err) {
          reject(err);
          return;
        }


        resolve({
          deleted: this.changes > 0
        });

      }
    );

  });

}


// =====================================================
// GET PAYOUT INFORMATION
// =====================================================

function getPayoutInfo(
  landlordId
) {

  return new Promise(
    (resolve, reject) => {

      db.get(
        `
          SELECT
            id,
            paystack_subaccount_code,
            paystack_connected
          FROM users
          WHERE id = ?
        `,
        [landlordId],
        (err, user) => {

          if (err) {
            reject(err);
            return;
          }

          resolve(user);

        }
      );

    }
  );

}


// =====================================================
// SAVE PAYSTACK SUBACCOUNT
// =====================================================

function savePaystackSubaccount(
  landlordId,
  subaccountCode
) {

  return new Promise(
    (resolve, reject) => {

      db.run(
        `
          UPDATE users

          SET
            paystack_subaccount_code = ?,
            paystack_connected = 1

          WHERE id = ?
        `,
        [
          subaccountCode,
          landlordId,
        ],
        function (err) {

          if (err) {
            reject(err);
            return;
          }

          resolve({
            changes: this.changes,
          });

        }
      );

    }
  );

}


// =====================================================
// REMOVE PAYSTACK CONNECTION
// =====================================================

function removePaystackConnection(
  landlordId
) {

  return new Promise(
    (resolve, reject) => {

      db.run(
        `
          UPDATE users

          SET
            paystack_subaccount_code = NULL,
            paystack_connected = 0

          WHERE id = ?
        `,
        [landlordId],
        function (err) {

          if (err) {
            reject(err);
            return;
          }

          resolve({
            changes: this.changes,
          });

        }
      );

    }
  );

}


// ========================================
// EXPORTS
// ========================================

module.exports = {

  createUser,

  findUserByEmail,

  findUserById,

  updateUser,

  deleteUser,

  getPayoutInfo,

  savePaystackSubaccount,

  removePaystackConnection,


};