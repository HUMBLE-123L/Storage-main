const express = require('express');
const Notification = require('../models/Notification');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

// Get user notifications
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const notifications = await Notification.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('relatedFile', 'name type isFolder')
      .populate('relatedUser', 'username email');

    const total = await Notification.countDocuments({ userId: req.user._id });

    res.json({
      success: true,
      notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while fetching notifications'
    });
  }
});

// Mark notification as read
router.patch('/:id/read', authMiddleware, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }

    res.json({
      success: true,
      notification
    });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while updating notification'
    });
  }
});

// Mark all notifications as read
router.patch('/read-all', authMiddleware, async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user._id, isRead: false },
      { isRead: true }
    );

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while updating notifications'
    });
  }
});

// Get unread notification count
router.get('/unread-count', authMiddleware, async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      userId: req.user._id,
      isRead: false
    });

    res.json({
      success: true,
      count
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while counting notifications'
    });
  }
});

// Update notification preferences
router.put('/preferences', authMiddleware, async (req, res) => {
  try {
    const { sharedFiles, fileUpdates, emailNotifications } = req.body;

    const User = require('../models/User');
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          'notifications.sharedFiles': sharedFiles,
          'notifications.fileUpdates': fileUpdates,
          'notifications.emailNotifications': emailNotifications
        }
      },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Notification preferences updated',
      preferences: user.notifications
    });
  } catch (error) {
    console.error('Update notification preferences error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while updating preferences'
    });
  }
});

// Delete notification
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while deleting notification'
    });
  }
});

// Clear all notifications
router.delete('/', authMiddleware, async (req, res) => {
  try {
    await Notification.deleteMany({ userId: req.user._id });

    res.json({
      success: true,
      message: 'All notifications cleared successfully'
    });
  } catch (error) {
    console.error('Clear all notifications error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while clearing notifications'
    });
  }
});

module.exports = router;