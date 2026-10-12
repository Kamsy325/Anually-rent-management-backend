// routes/notificationRoutes.js
const express = require("express");
const jwt = require("jsonwebtoken");
const authenticateToken = require("../middleware/auth");
const {
  getUserNotifications,
  markAsRead,
  markAllAsRead,
} = require("../models/Notification");
const {
  savePushSubscription,
  deleteSubscriptionByEndpoint,
} = require("../models/PushSubscription");
const {
  getVapidPublicKey,
  sendDesktopNotification,
  addSSEClient,
} = require("../services/webPushService");

const router = express.Router();

// =====================================================
// GET /notifications
// =====================================================
router.get("/", authenticateToken, async (req, res) => {
  try {
    const notifications = await getUserNotifications(req.user.id, req.user.role);
    const unreadCount = notifications.filter((n) => !n.is_read).length;

    return res.status(200).json({ notifications, unreadCount });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch notifications", error: error.message });
  }
});

// =====================================================
// PATCH /notifications/:id/read
// =====================================================
router.patch("/:id/read", authenticateToken, async (req, res) => {
  try {
    await markAsRead(req.params.id, req.user.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to mark notification as read" });
  }
});

// =====================================================
// PATCH /notifications/read-all
// =====================================================
router.patch("/read-all", authenticateToken, async (req, res) => {
  try {
    await markAllAsRead(req.user.id, req.user.role);
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to mark all as read" });
  }
});

// =====================================================
// GET /notifications/push/public-key
// Returns VAPID public key so client can subscribe with PushManager
// =====================================================
router.get("/push/public-key", (req, res) => {
  try {
    const publicKey = getVapidPublicKey();
    return res.status(200).json({
      publicKey,
      status: "ok",
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to retrieve VAPID key", error: err.message });
  }
});

// =====================================================
// POST /notifications/push/subscribe
// Register a browser's Web Push subscription for desktop notifications
// =====================================================
router.post("/push/subscribe", authenticateToken, async (req, res) => {
  try {
    const subscription = req.body.subscription || req.body;
    const { endpoint, keys } = subscription || {};

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({
        message: "Invalid PushSubscription payload. Expected endpoint, keys.p256dh, and keys.auth.",
      });
    }

    const saved = await savePushSubscription({
      userId: req.user.id,
      role: req.user.role,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: req.headers["user-agent"] || "",
    });

    return res.status(200).json({
      success: true,
      message: "Desktop notification subscription saved successfully",
      subscriptionId: saved.id,
    });
  } catch (error) {
    console.error("[Push Subscribe Error]:", error);
    return res.status(500).json({ message: "Failed to save push subscription", error: error.message });
  }
});

// =====================================================
// POST /notifications/push/unsubscribe
// Remove a browser's Web Push subscription
// =====================================================
router.post("/push/unsubscribe", authenticateToken, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) {
      return res.status(400).json({ message: "Endpoint is required to unsubscribe" });
    }

    await deleteSubscriptionByEndpoint(endpoint);
    return res.status(200).json({
      success: true,
      message: "Unsubscribed from desktop push notifications",
    });
  } catch (error) {
    console.error("[Push Unsubscribe Error]:", error);
    return res.status(500).json({ message: "Failed to unsubscribe", error: error.message });
  }
});

// =====================================================
// POST /notifications/push/test
// Dispatch a test desktop notification immediately
// =====================================================
router.post("/push/test", authenticateToken, async (req, res) => {
  try {
    const { title, message } = req.body || {};
    const testPayload = {
      title: title || "Annually Desktop Notification",
      message: message || `Hello ${req.user.role}! Desktop notifications are working properly.`,
      type: "info",
      icon: "/icons/icon-192.png",
      url: "/",
    };

    const delivery = await sendDesktopNotification(req.user.id, req.user.role, testPayload);

    return res.status(200).json({
      success: true,
      message: "Test desktop notification dispatched",
      delivery,
    });
  } catch (error) {
    console.error("[Push Test Error]:", error);
    return res.status(500).json({ message: "Failed to send test desktop notification", error: error.message });
  }
});

// =====================================================
// GET /notifications/stream
// Server-Sent Events (SSE) live desktop notification stream for open tabs
// Supports Authorization header or ?token=<jwt> query parameter
// =====================================================
router.get("/stream", (req, res) => {
  let token = req.query.token;

  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(" ");
    if (parts.length === 2 && parts[0] === "Bearer") {
      token = parts[1];
    }
  }

  if (!token) {
    return res.status(401).json({ message: "Authentication token required for notification stream" });
  }

  const jwtSecret = process.env.JWT_SECRET || "your_jwt_secret";
  let user;
  try {
    user = jwt.verify(token, jwtSecret);
  } catch (err) {
    return res.status(403).json({ message: "Invalid or expired token" });
  }

  // Set SSE response headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Initial connection handshake
  res.write(`data: ${JSON.stringify({ type: "connected", message: "Desktop notification stream active", timestamp: Date.now() })}\n\n`);

  // Register client in webPushService
  addSSEClient(user.id, user.role, res);

  // Send periodic heartbeat ping to prevent proxy connection timeouts
  const pingInterval = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch (e) {
      clearInterval(pingInterval);
    }
  }, 30000);

  res.on("close", () => {
    clearInterval(pingInterval);
  });
});

module.exports = router;