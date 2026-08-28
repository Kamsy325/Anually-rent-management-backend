// services/notificationScheduler.js
const cron = require("node-cron");
const db = require("../models/database");
const { createNotification } = require("../models/Notification");

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

async function checkAndSendNotifications() {
  const todayStr = getTodayString();
  const fiveDaysAheadStr = getFutureDateString(5);

  // Fetch active payments needing notification checks
  db.all(
    `SELECT payments.*, tenants.name AS tenant_name, tenants.user_id AS tenant_user_id, tenants.apartment
     FROM payments
     INNER JOIN tenants ON tenants.id = payments.tenant_id
     WHERE payments.status != 'paid'`,
    [],
    async (err, payments) => {
      if (err) {
        console.error("CRON ERROR: Failed to fetch payments", err);
        return;
      }

      for (const p of payments) {
        const amountFormatted = `$${Number(p.amount).toLocaleString()}`;

        // 1. DUE IN 5 DAYS (Landlord + Tenant)
        if (p.due_date === fiveDaysAheadStr) {
          // Tenant
          if (p.tenant_user_id) {
            await createNotification({
              userId: p.tenant_user_id,
              role: "tenant",
              title: "Rent Due Soon",
              message: `Your rent payment of ${amountFormatted} for ${p.apartment} is due in 5 days.`,
              type: "due_soon",
              paymentId: p.id,
            });
          }
          // Landlord
          await createNotification({
            userId: p.landlord_id,
            role: "landlord",
            title: "Rent Due Soon",
            message: `${p.tenant_name}'s rent payment of ${amountFormatted} (${p.apartment}) is due in 5 days.`,
            type: "due_soon",
            paymentId: p.id,
          });
        }

        // 2. DUE TODAY / PENDING (Landlord + Tenant)
        if (p.due_date === todayStr && p.status === "pending") {
          // Tenant
          if (p.tenant_user_id) {
            await createNotification({
              userId: p.tenant_user_id,
              role: "tenant",
              title: "Rent Due Today",
              message: `Your rent payment of ${amountFormatted} for ${p.apartment} is due today.`,
              type: "pending",
              paymentId: p.id,
            });
          }
          // Landlord
          await createNotification({
            userId: p.landlord_id,
            role: "landlord",
            title: "Rent Due Today",
            message: `${p.tenant_name}'s rent payment of ${amountFormatted} (${p.apartment}) is due today.`,
            type: "pending",
            paymentId: p.id,
          });
        }

        // 3. OVERDUE (Landlord + Tenant)
        if (p.status === "overdue" || (p.due_date < todayStr && p.status === "pending")) {
          // Tenant
          if (p.tenant_user_id) {
            await createNotification({
              userId: p.tenant_user_id,
              role: "tenant",
              title: "Rent Payment Overdue",
              message: `Your rent payment of ${amountFormatted} for ${p.apartment} was due on ${p.due_date} and is now overdue.`,
              type: "overdue",
              paymentId: p.id,
            });
          }
          // Landlord
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
  );
}

// Run daily at midnight (00:00)
function startNotificationScheduler() {
  cron.schedule("0 0 * * *", () => {
    console.log("Running scheduled rent notification checks...");
    checkAndSendNotifications();
  });
}

module.exports = { startNotificationScheduler, checkAndSendNotifications };