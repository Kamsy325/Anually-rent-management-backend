// services/notificationScheduler.js
const cron = require("node-cron");
const db = require("../models/database");
const { createNotification, notificationExists } = require("../models/Notification");

function getTodayString() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.toISOString().split("T")[0];
}

function getFutureDateString(daysAhead) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().split("T")[0];
}

// Promisified SQLite helper functions to avoid callback blocking
const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

async function checkRentNotifications() {
  const todayStr = getTodayString();
  const fiveDaysAheadStr = getFutureDateString(5);

  try {
    // 1. Target only relevant payments using SQL instead of filtering everything in JavaScript memory
    const payments = await dbAll(
      `SELECT payments.*, tenants.name AS tenant_name, tenants.id AS tenant_user_id, tenants.apartment
       FROM payments
       INNER JOIN tenants ON tenants.id = payments.tenant_id
       WHERE payments.status != 'paid' 
       AND (payments.due_date = ? OR payments.due_date <= ? OR payments.status = 'overdue')`,
      [fiveDaysAheadStr, todayStr]
    );

    for (const p of payments) {
      const amountFormatted = `₦${Number(p.amount).toLocaleString()}`;

      // ---------------------------------------------------
      // 1. FIVE DAYS BEFORE DUE DATE (Tenant + Landlord)
      // ---------------------------------------------------
      if (p.due_date === fiveDaysAheadStr) {
        if (p.tenant_user_id) {
          const exists = await notificationExists(p.tenant_user_id, "tenant", "due_soon", p.id);
          if (!exists) {
            await createNotification({
              userId: p.tenant_user_id,
              role: "tenant",
              title: "Rent Due Soon",
              message: `Your rent payment of ${amountFormatted} for ${p.apartment} is due in 5 days.`,
              type: "due_soon",
              paymentId: p.id,
            });
          }
        }

        const landlordExists = await notificationExists(p.landlord_id, "landlord", "due_soon", p.id);
        if (!landlordExists) {
          await createNotification({
            userId: p.landlord_id,
            role: "landlord",
            title: "Rent Due Soon",
            message: `${p.tenant_name}'s rent payment of ${amountFormatted} (${p.apartment}) is due in 5 days.`,
            type: "due_soon",
            paymentId: p.id,
          });
        }
      }

      // ---------------------------------------------------
      // 2. WHEN RENT IS DUE TODAY (Tenant + Landlord)
      // ---------------------------------------------------
      if (p.due_date === todayStr && p.status === "pending") {
        if (p.tenant_user_id) {
          const exists = await notificationExists(p.tenant_user_id, "tenant", "pending", p.id);
          if (!exists) {
            await createNotification({
              userId: p.tenant_user_id,
              role: "tenant",
              title: "Rent Due Today",
              message: `Your rent payment of ${amountFormatted} for ${p.apartment} is due today.`,
              type: "pending",
              paymentId: p.id,
            });
          }
        }

        const landlordExists = await notificationExists(p.landlord_id, "landlord", "pending", p.id);
        if (!landlordExists) {
          await createNotification({
            userId: p.landlord_id,
            role: "landlord",
            title: "Rent Due Today",
            message: `${p.tenant_name}'s rent payment of ${amountFormatted} (${p.apartment}) is due today.`,
            type: "pending",
            paymentId: p.id,
          });
        }
      }

      // ---------------------------------------------------
      // 3. WHEN RENT IS OVERDUE (Tenant + Landlord)
      // ---------------------------------------------------
      if (p.status === "overdue" || (p.due_date < todayStr && p.status === "pending")) {
        if (p.tenant_user_id) {
          const exists = await notificationExists(p.tenant_user_id, "tenant", "overdue", p.id);
          if (!exists) {
            await createNotification({
              userId: p.tenant_user_id,
              role: "tenant",
              title: "Rent Payment Overdue",
              message: `Your rent payment of ${amountFormatted} for ${p.apartment} was due on ${p.due_date} and is now overdue.`,
              type: "overdue",
              paymentId: p.id,
            });
          }
        }

        const landlordExists = await notificationExists(p.landlord_id, "landlord", "overdue", p.id);
        if (!landlordExists) {
          await createNotification({
            userId: p.landlord_id,
            role: "landlord",
            title: "Rent Payment Overdue",
            message: `${p.tenant_name}'s rent payment of ${amountFormatted} (${p.apartment}) is overdue.`,
            type: "overdue",
            paymentId: p.id,
          });
        }
      }
    }
  } catch (err) {
    console.error("CRON ERROR: Failed to process rent notifications", err);
  }
}

async function checkPlanExpirations() {
  const todayStr = getTodayString();

  try {
    const subscriptions = await dbAll(
      `SELECT * FROM subscriptions WHERE current_period_end IS NOT NULL AND current_period_end <= ? AND status = 'active'`,
      [todayStr]
    );

    for (const sub of subscriptions) {
      const exists = await notificationExists(sub.landlord_id, "landlord", "plan_expired");
      if (!exists) {
        await createNotification({
          userId: sub.landlord_id,
          role: "landlord",
          title: "Subscription Expired",
          message: "Your subscription plan has expired. Please upgrade to keep enjoying premium features.",
          type: "plan_expired",
        });

        await dbRun(`UPDATE subscriptions SET status = 'expired' WHERE id = ?`, [sub.id]);
      }
    }
  } catch (err) {
    console.error("CRON ERROR: Failed to process subscription expirations", err);
  }
}

function startNotificationScheduler() {
  // Runs daily at midnight non-blockingly
  cron.schedule("0 0 * * *", async () => {
    console.log("[CRON] Running scheduled notification checks...");
    const start = Date.now();
    
    await checkRentNotifications();
    await checkPlanExpirations();
    
    console.log(`[CRON] Completed checks in ${Date.now() - start}ms`);
  });
}

module.exports = {
  startNotificationScheduler,
  checkRentNotifications,
  checkPlanExpirations,
};