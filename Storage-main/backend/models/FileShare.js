const mongoose = require('mongoose');

const fileShareSchema = new mongoose.Schema({
  fileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'File',
    required: true
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  permission: {
    type: String,
    enum: ['view', 'edit'],
    default: 'view'
  },
  sharedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Index for efficient queries
fileShareSchema.index({ fileId: 1, userId: 1 });
fileShareSchema.index({ userId: 1 });
fileShareSchema.index({ ownerId: 1 });

module.exports = mongoose.models.FileShare || mongoose.model('FileShare', fileShareSchema);