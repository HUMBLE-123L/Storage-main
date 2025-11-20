const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

// Generate JWT Token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// Sign Up
router.post('/signup', async (req, res) => {
  try {
    const { email, username, password, confirmPassword } = req.body;

    // Validation
    if (!email || !username || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'All fields are required' 
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ 
        success: false,
        error: 'Passwords do not match' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        success: false,
        error: 'Password must be at least 6 characters' 
      });
    }

    if (username.length < 3) {
      return res.status(400).json({ 
        success: false,
        error: 'Username must be at least 3 characters' 
      });
    }

    // Check if email or username already exists
    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { username: username.toLowerCase() }
      ]
    });

    if (existingUser) {
      if (existingUser.email === email.toLowerCase()) {
        return res.status(400).json({ 
          success: false,
          error: 'Email already exists' 
        });
      } else {
        return res.status(400).json({ 
          success: false,
          error: 'Username already taken' 
        });
      }
    }

    // Create user
    const user = new User({
      email: email.toLowerCase(),
      username: username.toLowerCase(),
      password
    });

    await user.save();

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        profile: user.profile,
        notifications: user.notifications,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false,
        error: 'Email or username already exists' 
      });
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Server error during registration' 
    });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'Please enter both email and password' 
      });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid email or password' 
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid email or password' 
      });
    }

    // Generate token
    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        profile: user.profile,
        notifications: user.notifications,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error during login' 
    });
  }
});

// Get Current User
router.get('/me', authMiddleware, async (req, res) => {
  try {
    res.json({
      success: true,
      user: {
        id: req.user._id,
        email: req.user.email,
        username: req.user.username,
        profile: req.user.profile,
        notifications: req.user.notifications,
        createdAt: req.user.createdAt,
        updatedAt: req.user.updatedAt
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error' 
    });
  }
});

// Edit Profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { 
      firstName, 
      lastName, 
      username,
      bio, 
      location, 
      website,
      currentPassword,
      newPassword,
      confirmNewPassword 
    } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Update profile fields
    const updateData = {
      profile: {
        firstName: firstName !== undefined ? firstName : user.profile.firstName,
        lastName: lastName !== undefined ? lastName : user.profile.lastName,
        bio: bio !== undefined ? bio : user.profile.bio,
        location: location !== undefined ? location : user.profile.location,
        website: website !== undefined ? website : user.profile.website
      }
    };

    // Update username if provided
    if (username && username !== user.username) {
      // Check if username is already taken
      const existingUser = await User.findOne({ 
        username: username.toLowerCase(),
        _id: { $ne: req.user._id }
      });
      
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: 'Username already taken'
        });
      }
      updateData.username = username.toLowerCase();
    }

    // Handle password change if provided
    if (currentPassword && newPassword) {
      if (!confirmNewPassword) {
        return res.status(400).json({
          success: false,
          error: 'Please confirm your new password'
        });
      }

      if (newPassword !== confirmNewPassword) {
        return res.status(400).json({
          success: false,
          error: 'New passwords do not match'
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'New password must be at least 6 characters'
        });
      }

      // Verify current password
      const isCurrentPasswordValid = await user.comparePassword(currentPassword);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({
          success: false,
          error: 'Current password is incorrect'
        });
      }

      updateData.password = newPassword;
    }

    // Update user
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: updatedUser._id,
        email: updatedUser.email,
        username: updatedUser.username,
        profile: updatedUser.profile,
        notifications: updatedUser.notifications,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt
      }
    });

  } catch (error) {
    console.error('Edit profile error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'Username already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Server error while updating profile'
    });
  }
});

// Update Email
router.put('/email', authMiddleware, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        error: 'Password is incorrect'
      });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser && existingUser._id.toString() !== req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'Email already exists'
      });
    }

    // Update email
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { email: email.toLowerCase() },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Email updated successfully',
      user: {
        id: updatedUser._id,
        email: updatedUser.email,
        username: updatedUser.username,
        profile: updatedUser.profile,
        notifications: updatedUser.notifications,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt
      }
    });

  } catch (error) {
    console.error('Update email error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'Email already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Server error while updating email'
    });
  }
});

// Update Username
router.put('/username', authMiddleware, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required'
      });
    }

    if (username.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Username must be at least 3 characters'
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        error: 'Password is incorrect'
      });
    }

    // Check if username already exists
    const existingUser = await User.findOne({ username: username.toLowerCase() });
    if (existingUser && existingUser._id.toString() !== req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'Username already taken'
      });
    }

    // Update username
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { username: username.toLowerCase() },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Username updated successfully',
      user: {
        id: updatedUser._id,
        email: updatedUser.email,
        username: updatedUser.username,
        profile: updatedUser.profile,
        notifications: updatedUser.notifications,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt
      }
    });

  } catch (error) {
    console.error('Update username error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'Username already taken'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Server error while updating username'
    });
  }
});

// Delete Account
router.delete('/account', authMiddleware, async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required to delete account'
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        error: 'Password is incorrect'
      });
    }

    // Import required models
    const File = require('../models/File');
    const FileShare = require('../models/FileShare');
    const Notification = require('../models/Notification');

    // Delete user files
    await File.deleteMany({ owner: req.user._id });
    
    // Delete user shares
    await FileShare.deleteMany({ 
      $or: [
        { ownerId: req.user._id },
        { userId: req.user._id }
      ]
    });
    
    // Delete user notifications
    await Notification.deleteMany({ userId: req.user._id });
    
    // Delete user
    await User.findByIdAndDelete(req.user._id);

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while deleting account'
    });
  }
});

module.exports = router;