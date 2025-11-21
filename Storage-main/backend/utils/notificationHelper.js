const Notification = require('../models/Notification');
const FileShare = require('../models/FileShare');

// Helper function to create notifications
async function createNotification(userId, type, title, message, relatedFile = null, relatedUser = null, metadata = {}) {
  try {
    const notification = new Notification({
      userId,
      type,
      title,
      message,
      relatedFile,
      relatedUser,
      metadata
    });

    await notification.save();
    
    // Here you can add WebSocket integration for real-time notifications
    // emitNotification(userId, notification);
    
    return notification;
  } catch (error) {
    console.error('Create notification error:', error);
    throw error;
  }
}

// Notification templates
const notificationTemplates = {
  file_shared: (sharerName, fileName) => ({
    title: 'File Shared with You',
    message: `${sharerName} shared "${fileName}" with you`
  }),
  file_updated: (updaterName, fileName) => ({
    title: 'File Updated',
    message: `${updaterName} updated "${fileName}"`
  }),
  file_renamed: (renamerName, oldName, newName) => ({
    title: 'File Renamed',
    message: `${renamerName} renamed "${oldName}" to "${newName}"`
  }),
  file_moved: (moverName, fileName) => ({
    title: 'File Moved',
    message: `${moverName} moved "${fileName}"`
  }),
  file_uploaded: (fileName) => ({
    title: 'File Uploaded',
    message: `"${fileName}" has been uploaded successfully`
  }),
  file_deleted: (fileName) => ({
    title: 'File Deleted',
    message: `"${fileName}" has been moved to trash`
  })
};

// Create notification for file operations
async function notifyFileOperation(operation, file, user, targetUsers = [], additionalData = {}) {
  try {
    const template = notificationTemplates[operation];
    if (!template) {
      console.warn(`No notification template for operation: ${operation}`);
      return;
    }

    const { title, message } = template(user.username, file.name, additionalData.oldName);

    // Notify target users or all users who have access to the file
    const usersToNotify = targetUsers.length > 0 ? targetUsers : await getFileAccessUsers(file._id);
    
    for (const targetUser of usersToNotify) {
      // Don't notify the user who performed the action
      if (targetUser.toString() === user._id.toString()) continue;

      // Check if user wants to receive this type of notification
      if (!(await shouldSendNotification(targetUser, operation))) {
        continue;
      }

      await createNotification(
        targetUser,
        operation,
        title,
        message,
        file._id,
        user._id,
        additionalData
      );
    }
  } catch (error) {
    console.error('Notify file operation error:', error);
  }
}

// Get all users who have access to a file
async function getFileAccessUsers(fileId) {
  try {
    const File = require('../models/File');
    const file = await File.findById(fileId).populate('sharedWith.user');
    
    if (!file) return [];

    const users = new Set();
    
    // Add file owner
    users.add(file.userId.toString());
    
    // Add all users the file is shared with
    file.sharedWith.forEach(share => {
      if (share.user && share.user._id) {
        users.add(share.user._id.toString());
      }
    });

    return Array.from(users);
  } catch (error) {
    console.error('Get file access users error:', error);
    return [];
  }
}

// Check if user wants to receive specific notification type
async function shouldSendNotification(userId, notificationType) {
  try {
    const User = require('../models/User');
    const user = await User.findById(userId);
    
    if (!user) return false;

    // If user doesn't have notification preferences set, default to true
    if (!user.notifications) return true;

    switch (notificationType) {
      case 'file_shared':
        return user.notifications.sharedFiles !== false;
      case 'file_updated':
      case 'file_renamed':
      case 'file_moved':
        return user.notifications.fileUpdates !== false;
      case 'file_uploaded':
      case 'file_deleted':
        // Always notify for uploads and deletions by default
        return true;
      default:
        return true;
    }
  } catch (error) {
    console.error('Check notification preference error:', error);
    return true; // Default to sending notification if there's an error
  }
}

// Create notification for multiple users
async function notifyMultipleUsers(userIds, type, title, message, relatedFile = null, relatedUser = null) {
  try {
    for (const userId of userIds) {
      if (await shouldSendNotification(userId, type)) {
        await createNotification(userId, type, title, message, relatedFile, relatedUser);
      }
    }
  } catch (error) {
    console.error('Notify multiple users error:', error);
  }
}

// Get user notifications with pagination
async function getUserNotifications(userId, page = 1, limit = 20) {
  try {
    const skip = (page - 1) * limit;
    
    const notifications = await Notification.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('relatedFile', 'name type isFolder')
      .populate('relatedUser', 'username email');

    const total = await Notification.countDocuments({ userId });

    return {
      notifications,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  } catch (error) {
    console.error('Get user notifications error:', error);
    throw error;
  }
}

// Mark notification as read
async function markNotificationAsRead(notificationId, userId) {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, userId },
      { isRead: true },
      { new: true }
    );

    return notification;
  } catch (error) {
    console.error('Mark notification as read error:', error);
    throw error;
  }
}

// Mark all notifications as read for user
async function markAllNotificationsAsRead(userId) {
  try {
    await Notification.updateMany(
      { userId, isRead: false },
      { isRead: true }
    );
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    throw error;
  }
}

// Get unread notification count
async function getUnreadNotificationCount(userId) {
  try {
    const count = await Notification.countDocuments({
      userId,
      isRead: false
    });

    return count;
  } catch (error) {
    console.error('Get unread notification count error:', error);
    throw error;
  }
}

// Delete notification
async function deleteNotification(notificationId, userId) {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      userId
    });

    return notification;
  } catch (error) {
    console.error('Delete notification error:', error);
    throw error;
  }
}

// Clear all notifications for user
async function clearAllNotifications(userId) {
  try {
    await Notification.deleteMany({ userId });
  } catch (error) {
    console.error('Clear all notifications error:', error);
    throw error;
  }
}

module.exports = {
  createNotification,
  notifyFileOperation,
  shouldSendNotification,
  notifyMultipleUsers,
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadNotificationCount,
  deleteNotification,
  clearAllNotifications,
  notificationTemplates
};