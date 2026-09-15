// Payment.js

const db = require("./database");

// =====================================================
// CREATE PAYMENTS TABLE
// =====================================================
db.run(`
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    landlord_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    due_date TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    paid_date TEXT,
    paystack_reference TEXT UNIQUE,
    paystack_transaction_id TEXT,
    payment_method TEXT DEFAULT 'paystack',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, due_date),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (landlord_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// =====================================================
// DATE HELPERS
// =====================================================
function toDateString(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function getToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function addMonth(date) {
  const result = new Date(date);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
}

function addYear(date) {
  const result = new Date(date);
  const month = result.getMonth();
  const day = result.getDate();
  result.setDate(1);
  result.setFullYear(result.getFullYear() + 1);
  result.setMonth(month);
  const lastDay = new Date(result.getFullYear(), month + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

function getNextDueDate(currentDate, leaseInterval) {
  const interval = String(leaseInterval || "monthly").toLowerCase();
  if (interval === "annual" || interval === "yearly") {
    return addYear(currentDate);
  }
  return addMonth(currentDate);
}

// =====================================================
// DATABASE HELPERS
// =====================================================
function getPaymentsByTenant(tenantId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM payments WHERE tenant_id = ? ORDER BY due_date DESC`,
      [tenantId],
      (err, payments) => (err ? reject(err) : resolve(payments || []))
    );
  });
}

function createPayment({ tenantId, landlordId, amount, dueDate, status = "pending" }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO payments (tenant_id, landlord_id, amount, due_date, status)
       VALUES (?, ?, ?, ?, ?)`,
      [tenantId, landlordId, amount, dueDate, status],
      function (err) {
        if (err) return reject(err);
        if (this.changes === 0) return resolve(null);
        resolve({
          id: this.lastID,
          tenant_id: tenantId,
          landlord_id: landlordId,
          amount,
          due_date: dueDate,
          status,
        });
      }
    );
  });
}

// =====================================================
// ENSURE NEXT / CURRENT PAYMENT
// =====================================================
async function ensureNextPayment(tenant) {
  if (!tenant) return [];
  const leaseStart = parseDate(tenant.lease_ends || tenant.leaseEnds);
  if (!leaseStart) return [];

  const amount = Number(tenant.rent);
  if (!Number.isFinite(amount) || amount < 0) return [];

  const interval = String(tenant.lease_interval || tenant.leaseInterval || "monthly").toLowerCase();
  const today = getToday();
  const existingPayments = await getPaymentsByTenant(tenant.id);

  let cursorDate = new Date(leaseStart);
  let safetyCounter = 0;

  while (safetyCounter < 120) {
    const dueDateStr = toDateString(cursorDate);
    const existing = existingPayments.find((p) => p.due_date === dueDateStr);

    if (!existing) {
      const daysDiff = Math.floor((cursorDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
      if (daysDiff <= 30) {
        const initialStatus = daysDiff > 0 ? "upcoming" : "pending";

        const newPayment = await createPayment({
          tenantId: tenant.id,
          landlordId: tenant.landlord_id,
          amount,
          dueDate: dueDateStr,
          status: initialStatus,
        });
        return newPayment ? [newPayment] : [];
      }
      break;
    }

    if (existing.status === "pending" || existing.status === "overdue" || existing.status === "upcoming") {
      break;
    }

    cursorDate = getNextDueDate(cursorDate, interval);
    safetyCounter++;
  }

  return [];
}

// =====================================================
// UPDATE PAYMENT STATUSES
// =====================================================
function updatePaymentStatuses() {
  return new Promise((resolve, reject) => {
    const today = getToday();
    const todayString = toDateString(today);

    const overdueDate = new Date(today);
    overdueDate.setDate(overdueDate.getDate() - 7);
    const overdueDateString = toDateString(overdueDate);

    db.run(
      `UPDATE payments
       SET status = 'pending'
       WHERE status = 'upcoming' AND due_date <= ?`,
      [todayString],
      (err) => {
        if (err) return reject(err);

        db.run(
          `UPDATE payments
           SET status = 'overdue'
           WHERE status = 'pending' AND due_date < ?`,
          [overdueDateString],
          function (err2) {
            if (err2) return reject(err2);
            resolve({ changes: this.changes });
          }
        );
      }
    );
  });
}

function getPaymentsByLandlord(landlordId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT payments.*, tenants.name AS tenant_name, tenants.email AS tenant_email, tenants.apartment AS apartment
       FROM payments
       INNER JOIN tenants ON tenants.id = payments.tenant_id
       WHERE payments.landlord_id = ?
       ORDER BY payments.due_date ASC`,
      [landlordId],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

function getUpcomingPayments(landlordId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT payments.*, tenants.name AS tenant_name, tenants.email AS tenant_email, tenants.apartment AS apartment
       FROM payments
       INNER JOIN tenants ON tenants.id = payments.tenant_id
       WHERE payments.landlord_id = ? AND payments.status = 'upcoming'
       ORDER BY payments.due_date ASC`,
      [landlordId],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

function getPendingPayments(landlordId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT payments.*, tenants.name AS tenant_name, tenants.email AS tenant_email, tenants.apartment AS apartment
       FROM payments
       INNER JOIN tenants ON tenants.id = payments.tenant_id
       WHERE payments.landlord_id = ? AND payments.status = 'pending'
       ORDER BY payments.due_date ASC`,
      [landlordId],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

function getOverduePayments(landlordId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT payments.*, tenants.name AS tenant_name, tenants.email AS tenant_email, tenants.apartment AS apartment
       FROM payments
       INNER JOIN tenants ON tenants.id = payments.tenant_id
       WHERE payments.landlord_id = ? AND payments.status = 'overdue'
       ORDER BY payments.due_date ASC`,
      [landlordId],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

function getRecentPaidPayments(landlordId) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT payments.*, tenants.name AS tenant_name, tenants.email AS tenant_email, tenants.apartment AS apartment
       FROM payments
       INNER JOIN tenants ON tenants.id = payments.tenant_id
       WHERE payments.landlord_id = ? AND payments.status = 'paid'
       ORDER BY payments.paid_date DESC
       LIMIT 5`,
      [landlordId],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

function getPaymentById(paymentId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT payments.*, tenants.name AS tenant_name, tenants.email AS tenant_email, tenants.apartment AS apartment
       FROM payments
       INNER JOIN tenants ON tenants.id = payments.tenant_id
       WHERE payments.id = ? LIMIT 1`,
      [paymentId],
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });
}

function getPaymentByReference(reference) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT payments.*, tenants.name AS tenant_name, tenants.email AS tenant_email, tenants.apartment AS apartment
       FROM payments
       INNER JOIN tenants ON tenants.id = payments.tenant_id
       WHERE payments.paystack_reference = ? LIMIT 1`,
      [reference],
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });
}

function savePaystackReference(paymentId, reference) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE payments SET paystack_reference = ? WHERE id = ?`,
      [reference, paymentId],
      function (err) {
        if (err) return reject(err);
        resolve({ changes: this.changes });
      }
    );
  });
}

function markPaymentAsPaid({ paymentId, reference, transactionId, paymentMethod = "paystack" }) {
  return new Promise((resolve, reject) => {
    const paidDate = new Date().toISOString();
    db.run(
      `UPDATE payments
       SET status = 'paid', paid_date = ?, paystack_reference = ?, paystack_transaction_id = ?, payment_method = ?
       WHERE id = ? AND status != 'paid'`,
      [paidDate, reference, transactionId, paymentMethod, paymentId],
      function (err) {
        if (err) return reject(err);
        resolve({ changes: this.changes });
      }
    );
  });
}

module.exports = {
  createPayment,
  ensureNextPayment,
  generateTenantPayments: ensureNextPayment,
  updatePaymentStatuses,
  getPaymentsByTenant,
  getPaymentsByLandlord,
  getUpcomingPayments,
  getPendingPayments,
  getOverduePayments,
  getRecentPaidPayments,
  getNextDueDate,
  getPaymentByReference,
  getPaymentById,
  savePaystackReference,
  markPaymentAsPaid,
  toDateString,
};