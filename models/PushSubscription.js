// models/PushSubscription.js
const db = require("./database");

function createPushSubscriptionTable() {
  return new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('landlord', 'tenant')),
        endpoint TEXT UNIQUE NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => {
        if (err) {
          console.error("Error creating push_subscriptions table:", err);
          return reject(err);
        }
        resolve();
      }
    );
  });
}

createPushSubscriptionTable().catch(console.error);

/**
 * Save or update a push subscription for a user (landlord or tenant)
 */
function savePushSubscription({ userId, role, endpoint, p256dh, auth, userAgent = "" }) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO push_subscriptions (user_id, role, endpoint, p256dh, auth, user_agent, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id,
        role = excluded.role,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        updated_at = CURRENT_TIMESTAMP
    `;

    db.run(sql, [userId, role, endpoint, p256dh, auth, userAgent], function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, userId, role, endpoint });
    });
  });
}

/**
 * Get all push subscriptions for a specific user and role
 */
function getSubscriptionsByUser(userId, role) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM push_subscriptions WHERE user_id = ? AND role = ?`;
    db.all(sql, [userId, role], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

/**
 * Delete a subscription by endpoint (e.g. after unsubscribing or upon receiving 410 Gone)
 */
function deleteSubscriptionByEndpoint(endpoint) {
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM push_subscriptions WHERE endpoint = ?`;
    db.run(sql, [endpoint], function (err) {
      if (err) return reject(err);
      resolve({ deleted: this.changes > 0 });
    });
  });
}

/**
 * Delete all subscriptions for a user (e.g. on account deletion or reset)
 */
function deleteSubscriptionsByUser(userId, role) {
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM push_subscriptions WHERE user_id = ? AND role = ?`;
    db.run(sql, [userId, role], function (err) {
      if (err) return reject(err);
      resolve({ deleted: this.changes > 0 });
    });
  });
}

module.exports = {
  savePushSubscription,
  getSubscriptionsByUser,
  deleteSubscriptionByEndpoint,
  deleteSubscriptionsByUser,
};
