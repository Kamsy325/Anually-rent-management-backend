const express = require("express");

const authenticateToken =
  require("../middleware/auth");

const {
  getNotificationsByUser,
  getUnreadNotificationCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} = require("../models/Notification");


const router =
  express.Router();


// =====================================================
// GET NOTIFICATIONS
//
// GET /notifications
// =====================================================

router.get(
  "/",
  authenticateToken,
  async (req, res) => {

    try {

      const notifications =
        await getNotificationsByUser(
          req.user.id
        );


      const unreadCount =
        await getUnreadNotificationCount(
          req.user.id
        );


      return res.status(200).json({

        notifications,

        unreadCount,

      });

    } catch (error) {

      console.error(
        "GET NOTIFICATIONS ERROR:",
        error
      );


      return res.status(500).json({

        message:
          "Failed to load notifications",

      });

    }

  }
);


// =====================================================
// GET UNREAD COUNT
//
// GET /notifications/unread-count
// =====================================================

router.get(
  "/unread-count",
  authenticateToken,
  async (req, res) => {

    try {

      const count =
        await getUnreadNotificationCount(
          req.user.id
        );


      return res.status(200).json({

        count,

      });

    } catch (error) {

      console.error(
        "GET UNREAD COUNT ERROR:",
        error
      );


      return res.status(500).json({

        message:
          "Failed to load unread count",

      });

    }

  }
);


// =====================================================
// MARK ONE READ
//
// PATCH /notifications/:id/read
// =====================================================

router.patch(
  "/:id/read",
  authenticateToken,
  async (req, res) => {

    try {

      const result =
        await markNotificationAsRead(
          req.params.id,
          req.user.id
        );


      return res.status(200).json(
        result
      );

    } catch (error) {

      console.error(
        "MARK NOTIFICATION READ ERROR:",
        error
      );


      return res.status(500).json({

        message:
          "Failed to mark notification as read",

      });

    }

  }
);


// =====================================================
// MARK ALL READ
//
// PATCH /notifications/read-all
// =====================================================

router.patch(
  "/read-all",
  authenticateToken,
  async (req, res) => {

    try {

      const result =
        await markAllNotificationsAsRead(
          req.user.id
        );


      return res.status(200).json(
        result
      );

    } catch (error) {

      console.error(
        "MARK ALL NOTIFICATIONS READ ERROR:",
        error
      );


      return res.status(500).json({

        message:
          "Failed to mark notifications as read",

      });

    }

  }
);


module.exports =
  router;