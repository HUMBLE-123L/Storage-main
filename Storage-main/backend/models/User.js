const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: { 
    type: String, 
    required: true, 
    unique: true,
    lowercase: true,
    trim: true
  },
  username: { 
    type: String, 
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  password: { 
    type: String, 
    required: true 
  },
  profile: {
    firstName: {
      type: String,
      trim: true,
      maxlength: 50,
      default: ''
    },
    lastName: {
      type: String,
      trim: true,
      maxlength: 50,
      default: ''
    },
    bio: {
      type: String,
      maxlength: 500,
      default: ''
    },
    avatar: {
      type: String,
      default: null
    },
    location: {
      type: String,
      maxlength: 100,
      default: ''
    },
    website: {
      type: String,
      trim: true,
      maxlength: 200,
      default: ''
    }
  },
  notifications: {
    sharedFiles: {
      type: Boolean,
      default: true
    },
    fileUpdates: {
      type: Boolean,
      default: true
    },
    emailNotifications: {
      type: Boolean,
      default: true
    }
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Update updatedAt before saving
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Prevent OverwriteModelError
module.exports = mongoose.models.User || mongoose.model('User', userSchema);