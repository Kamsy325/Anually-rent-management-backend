// models/Notification.js
const db = require("./database");

function createNotificationTable() {
  return new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        role TEXT CHECK(role IN ('landlord', 'tenant')),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT CHECK(type IN ('due_soon', 'pending', 'overdue', 'paid', 'info')),
        is_read INTEGER DEFAULT 0,
        payment_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => (err ? reject(err) : resolve())
    );
  });
}

// Run table creation on startup
createNotificationTable().catch(console.error);

function createNotification({ userId, role, title, message, type, paymentId = null }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO notifications (user_id, role, title, message, type, payment_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, role, title, message, type, paymentId],
      function (err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, userId, role, title, message, type, paymentId });
      }
    );
  });
}

function getUserNotifications(userId, role) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM notifications 
       WHERE user_id = ? AND role = ?
       ORDER BY created_at DESC LIMIT 20`,
      [userId, role],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

function markAsRead(notificationId, userId) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
      [notificationId, userId],
      function (err) {
        if (err) return reject(err);
        resolve({ changes: this.changes });
      }
    );
  });
}

function markAllAsRead(userId, role) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND role = ?`,
      [userId, role],
      function (err) {
        if (err) return reject(err);
        resolve({ changes: this.changes });
      }
    );
  });
}

module.exports = {
  createNotification,
  getUserNotifications,
  markAsRead,
  markAllAsRead,
};