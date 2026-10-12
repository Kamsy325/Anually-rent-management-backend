// services/webPushService.js
const webpush = require("web-push");
const path = require("path");
const fs = require("fs");
const {
  getSubscriptionsByUser,
  deleteSubscriptionByEndpoint,
} = require("../models/PushSubscription");

// In-memory registry for Server-Sent Events (SSE) live desktop streams
// Map of `${role}:${userId}` -> Set of Express response objects
const sseClients = new Map();

// VAPID Configuration: Load from environment or auto-generate and persist locally
let vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:notifications@annually.com";

const KEY_CACHE_PATH = path.join(__dirname, "../.vapid-keys.json");

if (!vapidPublicKey || !vapidPrivateKey) {
  try {
    if (fs.existsSync(KEY_CACHE_PATH)) {
      const cached = JSON.parse(fs.readFileSync(KEY_CACHE_PATH, "utf-8"));
      vapidPublicKey = cached.publicKey;
      vapidPrivateKey = cached.privateKey;
    }
  } catch (err) {
    console.warn("[WebPush] Failed to read cached VAPID keys, generating fresh pair:", err.message);
  }
}

if (!vapidPublicKey || !vapidPrivateKey) {
  const generated = webpush.generateVAPIDKeys();
  vapidPublicKey = generated.publicKey;
  vapidPrivateKey = generated.privateKey;
  try {
    fs.writeFileSync(KEY_CACHE_PATH, JSON.stringify(generated, null, 2), "utf-8");
  } catch (err) {
    console.warn("[WebPush] Could not persist generated VAPID keys to disk:", err.message);
  }
}

try {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  console.log("[WebPush] VAPID configuration initialized successfully");
} catch (err) {
  console.error("[WebPush] Error setting VAPID details:", err.message);
}

function getVapidPublicKey() {
  return vapidPublicKey;
}

/**
 * Register an active SSE response stream for live desktop notifications
 */
function addSSEClient(userId, role, res) {
  const key = `${role}:${userId}`;
  if (!sseClients.has(key)) {
    sseClients.set(key, new Set());
  }
  sseClients.get(key).add(res);

  res.on("close", () => {
    const set = sseClients.get(key);
    if (set) {
      set.delete(res);
      if (set.size === 0) {
        sseClients.delete(key);
      }
    }
  });
}

/**
 * Dispatch an event to all open browser desktop tabs for a given user
 */
function broadcastSSE(userId, role, payload) {
  const key = `${role}:${userId}`;
  const clients = sseClients.get(key);
  if (!clients || clients.size === 0) return 0;

  const dataString = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try {
      client.write(dataString);
    } catch (err) {
      clients.delete(client);
    }
  }
  return clients.size;
}

/**
 * Send a desktop notification to all subscribed devices for a user (tenant or landlord)
 * Falls back / dual-delivers to open SSE browser tabs
 */
async function sendDesktopNotification(userId, role, notification) {
  const payload = {
    title: notification.title || "Annually Notification",
    message: notification.message || "",
    body: notification.message || "",
    icon: notification.icon || "/icons/icon-192.png",
    badge: notification.badge || "/icons/badge-72.png",
    tag: notification.type || `notif-${Date.now()}`,
    data: {
      url: notification.url || "/",
      paymentId: notification.paymentId || null,
      type: notification.type || "info",
      timestamp: Date.now(),
    },
  };

  // 1. Deliver to active browser tabs via SSE stream
  const sseDelivered = broadcastSSE(userId, role, payload);

  // 2. Deliver via Web Push protocol (shows native desktop banner even when tab is closed)
  let subscriptions = [];
  try {
    subscriptions = await getSubscriptionsByUser(userId, role);
  } catch (err) {
    console.error(`[WebPush] Failed to fetch subscriptions for ${role} #${userId}:`, err.message);
  }

  const results = {
    sseDelivered,
    pushTotal: subscriptions.length,
    pushSent: 0,
    pushFailed: 0,
  };

  if (subscriptions.length === 0) {
    return results;
  }

  const pushString = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, pushString, {
          TTL: 60 * 60 * 24, // 24 hours
          urgency: "high",
        });
        results.pushSent++;
      } catch (err) {
        results.pushFailed++;
        // If the subscription is no longer valid or unsubscribed (404/410), remove it
        if (err.statusCode === 404 || err.statusCode === 410) {
          console.log(`[WebPush] Removing expired endpoint for ${role} #${userId}`);
          deleteSubscriptionByEndpoint(sub.endpoint).catch(() => {});
        } else {
          console.warn(`[WebPush] Failed delivering to ${sub.endpoint.slice(0, 40)}...`, err.message);
        }
      }
    })
  );

  return results;
}

module.exports = {
  getVapidPublicKey,
  sendDesktopNotification,
  addSSEClient,
  broadcastSSE,
};
