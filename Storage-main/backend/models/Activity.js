const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['upload', 'download', 'view', 'share', 'rename', 'move', 'delete', 'restore', 'create_folder', 'share_link', 'copy', 'permanent_delete', 'empty_trash', 'download_public']
  },
  fileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'File'
  },
  fileName: {
    type: String,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  details: {
    type: Map,
    of: String
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  }
}, {
  timestamps: true
});

// Index for better query performance
activitySchema.index({ userId: 1, createdAt: -1 });
activitySchema.index({ fileId: 1 });
activitySchema.index({ type: 1 });

// Static method to log activity
activitySchema.statics.logActivity = async function(activityData) {
  try {
    const activity = new this(activityData);
    await activity.save();
    // Log saved activity for easier debugging of recent activity visibility
    try {
      console.log('Activity logged:', {
        id: activity._id.toString(),
        type: activity.type,
        fileName: activity.fileName,
        userId: activity.userId ? activity.userId.toString() : null,
        createdAt: activity.createdAt
      });
    } catch (logErr) {
      console.error('Error logging activity debug info:', logErr);
    }

    return activity;
  } catch (error) {
    console.error('Error logging activity:', error);
    throw error;
  }
};

module.exports = mongoose.models.Activity || mongoose.model('Activity', activitySchema);