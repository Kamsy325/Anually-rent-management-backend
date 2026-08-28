// routes/notificationRoutes.js
const express = require("express");
const authenticateToken = require("../middleware/auth");
const {
  getUserNotifications,
  markAsRead,
  markAllAsRead,
} = require("../models/Notification");

const router = express.Router();

// GET /notifications
router.get("/", authenticateToken, async (req, res) => {
  try {
    const notifications = await getUserNotifications(req.user.id, req.user.role);
    const unreadCount = notifications.filter((n) => !n.is_read).length;

    return res.status(200).json({ notifications, unreadCount });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch notifications", error: error.message });
  }
});

// PATCH /notifications/:id/read
router.patch("/:id/read", authenticateToken, async (req, res) => {
  try {
    await markAsRead(req.params.id, req.user.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to mark notification as read" });
  }
});

// PATCH /notifications/read-all
router.patch("/read-all", authenticateToken, async (req, res) => {
  try {
    await markAllAsRead(req.user.id, req.user.role);
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to mark all as read" });
  }
});

module.exports = router;