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

    password TEXT,

    phone_no TEXT,

    company_name TEXT,

    address TEXT,

    bio TEXT,

    lease_interval TEXT DEFAULT 'monthly',

    role TEXT DEFAULT 'landlord',

    is_verified INTEGER DEFAULT 0,

    verification_token TEXT,

    paystack_subaccount_code TEXT,

    paystack_connected INTEGER DEFAULT 0,

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
  verificationToken = null,
  phoneNo = "",
  companyName = "",
  address = "",
  bio = "",
  leaseInterval = "monthly",
  role = "landlord",
  isVerified = 1
) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO users (
        first_name,
        last_name,
        email,
        password,
        verification_token,
        is_verified,
        phone_no,
        company_name,
        address,
        bio,
        lease_interval,
        role
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(
      sql,
      [
        firstName,
        lastName,
        email,
        password,
        verificationToken,
        isVerified,
        phoneNo,
        companyName,
        address,
        bio,
        leaseInterval,
        role,
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
          role,
          isVerified,
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
    if (!email) {
      resolve(null);
      return;
    }

    const sql = `
      SELECT *
      FROM users
      WHERE LOWER(email) = LOWER(?)
      LIMIT 1
    `;

    db.get(sql, [email.trim().toLowerCase()], (err, user) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(user);
    });
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

    db.get(sql, [id], (err, user) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(user);
    });
  });
}

// ========================================
// FIND USER BY VERIFICATION TOKEN
// ========================================
function findUserByVerificationToken(token) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT *
      FROM users
      WHERE verification_token = ?
      LIMIT 1
    `;

    db.get(sql, [token], (err, user) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(user);
    });
  });
}

// ========================================
// VERIFY USER ACCOUNT
// ========================================
function verifyUserAccount(userId) {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE users
      SET is_verified = 1, verification_token = NULL
      WHERE id = ?
    `;

    db.run(sql, [userId], function (err) {
      if (err) {
        reject(err);
        return;
      }

      resolve({
        updated: this.changes > 0,
      });
    });
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
        id,
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

        findUserById(id).then(resolve).catch(reject);
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
          deleted: this.changes > 0,
        });
      }
    );
  });
}

// =====================================================
// GET PAYOUT INFORMATION
// =====================================================
function getPayoutInfo(landlordId) {
  return new Promise((resolve, reject) => {
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
  });
}

// =====================================================
// SAVE PAYSTACK SUBACCOUNT
// =====================================================
function savePaystackSubaccount(landlordId, subaccountCode) {
  return new Promise((resolve, reject) => {
    db.run(
      `
        UPDATE users
        SET
          paystack_subaccount_code = ?,
          paystack_connected = 1
        WHERE id = ?
      `,
      [subaccountCode, landlordId],
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
  });
}

// =====================================================
// REMOVE PAYSTACK CONNECTION
// =====================================================
function removePaystackConnection(landlordId) {
  return new Promise((resolve, reject) => {
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
  });
}

// =====================================================
// FIND OR CREATE GOOGLE USER
// =====================================================
function findOrCreateGoogleUser(googleUser) {
  const { email, given_name, family_name } = googleUser;

  return new Promise((resolve, reject) => {
    const findSql = `SELECT * FROM users WHERE email = ? LIMIT 1`;

    db.get(findSql, [email], (err, existingUser) => {
      if (err) return reject(err);

      if (existingUser) {
        return resolve(existingUser);
      }

      // Automatically mark Google accounts as verified (is_verified = 1)
      const insertSql = `
        INSERT INTO users (first_name, last_name, email, password, is_verified, role)
        VALUES (?, ?, ?, NULL, 1, 'landlord')
      `;

      db.run(
        insertSql,
        [given_name || "", family_name || "", email],
        function (err) {
          if (err) return reject(err);

          db.get(
            `SELECT * FROM users WHERE id = ?`,
            [this.lastID],
            (err, newUser) => {
              if (err) return reject(err);
              resolve(newUser);
            }
          );
        }
      );
    });
  });
}

function updateUserVerificationToken(userId, token) {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE users
      SET verification_token = ?
      WHERE id = ?
    `;
    db.run(sql, [token, userId], function (err) {
      if (err) return reject(err);
      resolve({ updated: this.changes > 0 });
    });
  });
}

// ========================================
// EXPORTS
// ========================================
module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
  findUserByVerificationToken,
  verifyUserAccount,
  updateUserVerificationToken,
  updateUser,
  deleteUser,
  getPayoutInfo,
  savePaystackSubaccount,
  removePaystackConnection,
  findOrCreateGoogleUser,
};