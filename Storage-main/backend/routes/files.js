const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const File = require('../models/File');
const Activity = require('../models/Activity');
const StorageStats = require('../models/StorageStats');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const userUploadDir = path.join(__dirname, '../uploads', req.user._id.toString());
    if (!fs.existsSync(userUploadDir)) {
      fs.mkdirSync(userUploadDir, { recursive: true });
    }
    cb(null, userUploadDir);
  },
  filename: function (req, file, cb) {
    const fileExt = path.extname(file.originalname);
    const fileName = path.basename(file.originalname, fileExt);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, fileName + '-' + uniqueSuffix + fileExt);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  },
  fileFilter: function (req, file, cb) {
    cb(null, true);
  }
});

// Public download by token (no auth required) - MUST be before /:fileId routes
router.get('/public/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const file = await File.findOne({ publicUrl: token, inTrash: false });

    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    if (file.isFolder) {
      return res.status(400).json({ success: false, error: 'Cannot download folders' });
    }

    if (!fs.existsSync(file.path)) {
      return res.status(404).json({ success: false, error: 'File not found on server' });
    }

    await Activity.logActivity({
      type: 'download_public',
      fileId: file._id,
      fileName: file.name,
      userId: null
    });

    res.setHeader('Content-Disposition', `attachment; filename="${file.originalName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    const fileStream = fs.createReadStream(file.path);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Public download error:', error);
    res.status(500).json({ success: false, error: 'Server error while downloading file' });
  }
});

// Get user files
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { folder, type, search, sort = 'updatedAt', order = 'desc' } = req.query;
    
    let query = { 
      userId: req.user._id, 
      inTrash: false 
    };

    // Default to root folder if no folder specified
    if (folder && folder !== 'root') {
      query.parentFolder = folder;
    } else {
      // Default to root - show files with no parent folder
      query.parentFolder = null;
    }

    if (type && type !== 'all') {
      query.type = type;
    }

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    const sortOrder = order === 'desc' ? -1 : 1;
    const files = await File.find(query)
      .sort({ [sort]: sortOrder })
      .populate('sharedWith.user', 'username email')
      .lean();

    res.json({
      success: true,
      files: files.map(file => ({
        id: file._id,
        name: file.name,
        type: file.type,
        size: file.size,
        uploadDate: file.createdAt,
        updatedAt: file.updatedAt,
        uploader: req.user.username,
        uploaderEmail: req.user.email,
        url: `/api/files/${file._id}/download`,
        sharedWith: file.sharedWith,
        isFolder: file.isFolder,
        parentFolder: file.parentFolder
      }))
    });
  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while fetching files'
    });
  }
});

// Get folder contents
router.get('/folders/:folderId', authMiddleware, async (req, res) => {
  try {
    const { folderId } = req.params;
    
    let query = { 
      userId: req.user._id, 
      inTrash: false 
    };

    if (folderId === 'root') {
      query.parentFolder = null;
    } else {
      query.parentFolder = folderId;
    }

    const files = await File.find(query)
      .sort({ isFolder: -1, name: 1 })
      .populate('sharedWith.user', 'username email')
      .lean();

    res.json({
      success: true,
      files: files.map(file => ({
        id: file._id,
        name: file.name,
        type: file.type,
        size: file.size,
        uploadDate: file.createdAt,
        updatedAt: file.updatedAt,
        uploader: req.user.username,
        uploaderEmail: req.user.email,
        url: `/api/files/${file._id}/download`,
        sharedWith: file.sharedWith,
        isFolder: file.isFolder,
        parentFolder: file.parentFolder
      }))
    });
  } catch (error) {
    console.error('Get folder contents error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while fetching folder contents'
    });
  }
});

// Create new folder
router.post('/folders', authMiddleware, async (req, res) => {
  try {
    const { name, parentFolder = null } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Folder name is required'
      });
    }

    const existingFolder = await File.findOne({
      userId: req.user._id,
      name: name.trim(),
      isFolder: true,
      parentFolder: parentFolder,
      inTrash: false
    });

    if (existingFolder) {
      return res.status(400).json({
        success: false,
        error: 'A folder with this name already exists in this location'
      });
    }

    const newFolder = new File({
      name: name.trim(),
      type: 'folder',
      size: 0,
      path: null,
      userId: req.user._id,
      parentFolder: parentFolder,
      isFolder: true,
      metadata: new Map([['folderType', 'user_created']])
    });

    await newFolder.save();

    await Activity.logActivity({
      type: 'create_folder',
      fileId: newFolder._id,
      fileName: name.trim(),
      userId: req.user._id,
      details: new Map([['folderId', newFolder._id.toString()], ['parentFolder', parentFolder || 'root']])
    });

    res.status(201).json({
      success: true,
      message: 'Folder created successfully',
      folder: {
        id: newFolder._id,
        name: newFolder.name,
        type: 'folder',
        size: 0,
        uploadDate: newFolder.createdAt,
        updatedAt: newFolder.updatedAt,
        isFolder: true,
        parentFolder: newFolder.parentFolder
      }
    });
  } catch (error) {
    console.error('Create folder error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while creating folder'
    });
  }
});

// Upload file - UPDATED: Respects parentFolder
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const { originalname, mimetype, size, filename, path: filePath } = req.file;
    let { parentFolder } = req.body;

    // Convert empty or 'root' to null for root folder
    if (parentFolder === '' || parentFolder === 'root') {
      parentFolder = null;
    }
    // Also normalize undefined to null so Mongoose will use the schema default
    if (typeof parentFolder === 'undefined') {
      parentFolder = null;
    }

    // Check if parent folder exists and belongs to user
    if (parentFolder) {
      const parentFolderDoc = await File.findOne({
        _id: parentFolder,
        userId: req.user._id,
        isFolder: true,
        inTrash: false
      });
      
      if (!parentFolderDoc) {
        fs.unlinkSync(filePath);
        return res.status(400).json({
          success: false,
          error: 'Parent folder not found or access denied'
        });
      }
    }

    const storageStats = await StorageStats.findOne({ userId: req.user._id });
    if (storageStats && (storageStats.usedStorage + size) > 16106127360) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        success: false,
        error: 'Storage limit exceeded. Please upgrade your plan or free up space.'
      });
    }

    const fileType = getFileTypeFromMime(mimetype);
    // Duplicate detection: avoid creating duplicate DB entries for same user/name/size in same folder
    const existingSame = await File.findOne({
      userId: req.user._id,
      originalName: originalname,
      size: size,
      parentFolder: parentFolder,
      inTrash: false
    });

    if (existingSame) {
      console.log('Duplicate detected for upload (single) - skipping DB save:', originalname, 'user:', req.user._id.toString(), 'parentFolder:', parentFolder);

      // Update storage stats and activity but don't create a duplicate file entry
      await StorageStats.updateUserStats(req.user._id);

      return res.status(200).json({
        success: true,
        message: 'File already exists, skipped duplicate',
        file: {
          id: existingSame._id,
          name: existingSame.name,
          type: existingSame.type,
          size: existingSame.size,
          uploadDate: existingSame.createdAt,
          parentFolder: existingSame.parentFolder
        }
      });
    }

    const newFile = new File({
      name: originalname,
      originalName: originalname,
      type: fileType,
      size: size,
      path: filePath,
      userId: req.user._id,
      parentFolder: parentFolder, // This will keep the file in the specified folder
      isFolder: false,
      metadata: new Map([['uploadMethod', 'multer'], ['mimetype', mimetype]])
    });

    await newFile.save();

    await StorageStats.updateUserStats(req.user._id);

    await Activity.logActivity({
      type: 'upload',
      fileId: newFile._id,
      fileName: originalname,
      userId: req.user._id,
      details: new Map([
        ['size', size.toString()], 
        ['type', fileType], 
        ['parentFolder', parentFolder || 'root']
      ])
    });

    res.status(201).json({
      success: true,
      message: 'File uploaded successfully',
      file: {
        id: newFile._id,
        name: newFile.name,
        type: newFile.type,
        size: newFile.size,
        uploadDate: newFile.createdAt,
        uploader: req.user.username,
        uploaderEmail: req.user.email,
        url: `/api/files/${newFile._id}/download`,
        parentFolder: newFile.parentFolder
      }
    });
  } catch (error) {
    console.error('Upload file error:', error);
    
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }
    
    res.status(500).json({
      success: false,
      error: 'Server error while uploading file'
    });
  }
});

// Upload multiple files with folder structure support
router.post('/upload-multiple', authMiddleware, upload.array('files', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded'
      });
    }

    let { parentFolder, isFolder, folderStructure, filePaths } = req.body;
    
    console.log('Upload-multiple request:', {
      filesCount: req.files.length,
      parentFolder: parentFolder,
      isFolder: isFolder,
      filePaths: filePaths ? (Array.isArray(filePaths) ? filePaths.length : 'string') : undefined
    });
    
    if (parentFolder === '' || parentFolder === 'root') {
      parentFolder = null;
    }
    // Normalize when parentFolder not provided in the form (undefined)
    if (typeof parentFolder === 'undefined') {
      parentFolder = null;
    }

    // Check if parent folder exists and belongs to user
    if (parentFolder) {
      console.log('Checking parent folder:', parentFolder);
      
      const parentFolderDoc = await File.findOne({
        _id: parentFolder,
        userId: req.user._id,
        isFolder: true,
        inTrash: false
      });
      
      if (!parentFolderDoc) {
        console.log('Parent folder not found or access denied');
        req.files.forEach(file => {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        });
        return res.status(400).json({
          success: false,
          error: 'Parent folder not found or access denied'
        });
      }
    }

    const uploadedFiles = [];
    let totalSize = 0;

    const storageStats = await StorageStats.findOne({ userId: req.user._id });
    const currentUsed = storageStats ? storageStats.usedStorage : 0;
    
    const uploadSize = req.files.reduce((sum, file) => sum + file.size, 0);
    if ((currentUsed + uploadSize) > 16106127360) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
      
      return res.status(400).json({
        success: false,
        error: 'Storage limit exceeded. Please upgrade your plan or free up space.'
      });
    }

    // If this is a folder upload, parse the file paths and create folder structure
    let folderMap = {}; // Map of folder paths to folder IDs
    
    if (isFolder === 'true' && filePaths) {
      const filePathArray = Array.isArray(filePaths) ? filePaths : [filePaths];
      
      // Create all necessary folders first
      for (const filePath of filePathArray) {
        const pathParts = filePath.split('/');
        
        // Create folders for all intermediate directories
        let currentParent = parentFolder;
        let currentPath = '';
        
        for (let i = 0; i < pathParts.length - 1; i++) {
          const folderName = pathParts[i];
          currentPath += (currentPath ? '/' : '') + folderName;
          
          // Check if we've already created this folder in this upload
          if (!folderMap[currentPath]) {
            // Check if folder already exists
            const existingFolder = await File.findOne({
              name: folderName,
              userId: req.user._id,
              parentFolder: currentParent,
              isFolder: true,
              inTrash: false
            });
            
            if (existingFolder) {
              folderMap[currentPath] = existingFolder._id;
              currentParent = existingFolder._id;
            } else {
              // Create new folder
              const newFolder = new File({
                name: folderName,
                userId: req.user._id,
                parentFolder: currentParent,
                isFolder: true,
                type: 'folder',
                size: 0,
                path: null,
                metadata: new Map([['createdBy', 'folderUpload']])
              });
              
              await newFolder.save();
              folderMap[currentPath] = newFolder._id;
              currentParent = newFolder._id;
              
              console.log(`Created folder: ${folderName} with parent: ${currentParent}`);
            }
          } else {
            currentParent = folderMap[currentPath];
          }
        }
      }
    }

    // Now upload all files with proper parent folders
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const { originalname, mimetype, size, filename, path: filePath } = file;
      
      let fileParentFolder = parentFolder;
      if (typeof fileParentFolder === 'undefined') {
        fileParentFolder = null;
      }
      
      // If folder upload, determine the correct parent folder from the file path
      if (isFolder === 'true' && filePaths) {
        const filePathArray = Array.isArray(filePaths) ? filePaths : [filePaths];
        const uploadFilePath = filePathArray[i];
        const pathParts = uploadFilePath.split('/');
        
        console.log(`Processing file ${i}: ${uploadFilePath}, pathParts:`, pathParts);
        
        // Build the path to the parent folder
        if (pathParts.length > 1) {
          let currentPath = '';
          for (let j = 0; j < pathParts.length - 1; j++) {
            currentPath += (currentPath ? '/' : '') + pathParts[j];
            if (folderMap[currentPath]) {
              fileParentFolder = folderMap[currentPath];
              console.log(`  -> Set fileParentFolder to ${fileParentFolder} for path ${currentPath}`);
            }
          }
        }
      }
      
      const fileType = getFileTypeFromMime(mimetype);

      console.log(`Saving file: ${originalname}, parentFolder: ${fileParentFolder}`);

      // Duplicate detection per-file: same originalName, size, user, and parentFolder
      const existingSame = await File.findOne({
        userId: req.user._id,
        originalName: originalname,
        size: size,
        parentFolder: fileParentFolder,
        inTrash: false
      });

      if (existingSame) {
        console.log('Duplicate detected for upload-multiple - skipping DB save for', originalname, 'parentFolder:', fileParentFolder);
        // Add to uploadedFiles response using existing doc
        uploadedFiles.push({
          id: existingSame._id,
          name: existingSame.name,
          type: existingSame.type,
          size: existingSame.size,
          uploadDate: existingSame.createdAt,
          uploader: req.user.username,
          uploaderEmail: req.user.email,
          url: `/api/files/${existingSame._id}/download`,
          parentFolder: existingSame.parentFolder
        });

        // Still log activity for completeness
        await Activity.logActivity({
          type: 'upload_skipped_duplicate',
          fileId: existingSame._id,
          fileName: originalname,
          userId: req.user._id,
          details: new Map([['reason', 'duplicate_detected'], ['parentFolder', fileParentFolder || 'root']])
        });

        continue; // Skip creating a new File document
      }

      const newFile = new File({
        name: originalname,
        originalName: originalname,
        type: fileType,
        size: size,
        path: filePath,
        userId: req.user._id,
        parentFolder: fileParentFolder,
        isFolder: false,
        metadata: new Map([['uploadMethod', 'multer'], ['mimetype', mimetype]])
      });

      await newFile.save();
      totalSize += size;

      uploadedFiles.push({
        id: newFile._id,
        name: newFile.name,
        type: newFile.type,
        size: newFile.size,
        uploadDate: newFile.createdAt,
        uploader: req.user.username,
        uploaderEmail: req.user.email,
        url: `/api/files/${newFile._id}/download`,
        parentFolder: newFile.parentFolder
      });

      await Activity.logActivity({
        type: 'upload',
        fileId: newFile._id,
        fileName: originalname,
        userId: req.user._id,
        details: new Map([
          ['size', size.toString()], 
          ['type', fileType], 
          ['parentFolder', fileParentFolder || 'root']
        ])
      });
    }

    await StorageStats.updateUserStats(req.user._id);

    res.status(201).json({
      success: true,
      message: `${uploadedFiles.length} files uploaded successfully`,
      files: uploadedFiles,
      totalSize: totalSize
    });
  } catch (error) {
    console.error('Multiple upload error:', error);
    
    if (req.files) {
      req.files.forEach(file => {
        if (file && file.path) {
          try {
            fs.unlinkSync(file.path);
          } catch (cleanupError) {
            console.error('Error cleaning up file:', cleanupError);
          }
        }
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Server error while uploading files'
    });
  }
});

// Get recent activities
router.get('/recent', authMiddleware, async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    console.log('GET /files/recent called by user:', req.user ? req.user._id.toString() : 'unknown');

    const activities = await Activity.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .populate('fileId', 'name type parentFolder')
      .populate('targetUserId', 'username email')
      .lean();

    console.log('Found activities count:', activities.length);
    console.log('Activity ids:', activities.map(a => a._id.toString()).slice(0,10));

    const formattedActivities = activities.map(activity => ({
      id: activity._id,
      type: activity.type,
      fileName: activity.fileName,
      description: getActivityDescription(activity),
      timestamp: activity.createdAt,
      icon: getActivityIcon(activity.type),
      file: activity.fileId
    }));

    // Also include recently modified files (updatedAt) so "Recent" shows modified files
    try {
      const recentFiles = await File.find({ userId: req.user._id, inTrash: false })
        .sort({ updatedAt: -1 })
        .limit(Math.max(50, parseInt(limit) * 2))
        .lean();

      // Build a map of fileId -> latest activity timestamp (if any)
      const activityFileTimestamps = new Map();
      formattedActivities.forEach(a => {
        const fid = a.file && a.file._id ? a.file._id.toString() : (a.file && a.file.id ? a.file.id.toString() : null);
        if (fid) {
          activityFileTimestamps.set(fid, new Date(a.timestamp).getTime());
        }
      });

      for (const f of recentFiles) {
        const fid = f._id.toString();
        const fileUpdatedAt = f.updatedAt ? new Date(f.updatedAt).getTime() : null;

        // If there's no activity for this file or the file's updatedAt is newer than the last activity,
        // include a synthetic "modified" activity so it appears in Recent.
        if (fileUpdatedAt && (!activityFileTimestamps.has(fid) || fileUpdatedAt > activityFileTimestamps.get(fid))) {
          formattedActivities.push({
            id: `file_${fid}`,
            type: 'modified',
            fileName: f.name,
            description: `Modified ${f.name}`,
            timestamp: f.updatedAt,
            icon: getActivityIcon('rename'),
            file: { _id: f._id, name: f.name, type: f.type, parentFolder: f.parentFolder }
          });
        }
      }
    } catch (fileErr) {
      console.error('Error fetching recent files for merge:', fileErr);
    }

    // Merge and sort by timestamp desc and trim to limit
    const merged = formattedActivities
      .map(a => ({ ...a, _ts: new Date(a.timestamp).getTime() }))
      .sort((a, b) => b._ts - a._ts)
      .slice(0, parseInt(limit))
      .map(a => {
        delete a._ts;
        return a;
      });

    res.json({
      success: true,
      activities: merged
    });
  } catch (error) {
    console.error('Get recent activities error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while fetching recent activities'
    });
  }
});

// Debug endpoint: return raw activity documents for current user (dev only)
router.get('/debug/activities', authMiddleware, async (req, res) => {
  try {
    const activities = await Activity.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100).lean();
    console.log(`Debug activities for user ${req.user._id.toString()}: ${activities.length}`);
    return res.json({ success: true, activities });
  } catch (error) {
    console.error('Debug activities error:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Debug endpoint: return file document for debugging (owner or shared recipient)
router.get('/:fileId/debug', authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;
    const file = await File.findOne({
      _id: fileId,
      $or: [
        { userId: req.user._id },
        { 'sharedWith.user': req.user._id }
      ]
    }).lean();

    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found or access denied' });
    }

    // Include a simple server-side check whether the file exists on disk
    let exists = false;
    try {
      if (file.path) {
        exists = require('fs').existsSync(file.path);
      }
    } catch (e) {
      exists = false;
    }

    return res.json({ success: true, file, existsOnDisk: exists });
  } catch (error) {
    console.error('Debug file endpoint error:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Get shared files
router.get('/shared', authMiddleware, async (req, res) => {
  try {
    const sharedFiles = await File.find({
      'sharedWith.user': req.user._id,
      inTrash: false
    })
    .populate('userId', 'username email')
    .populate('sharedWith.user', 'username email')
    .sort({ updatedAt: -1 })
    .lean();

    const formattedFiles = sharedFiles.map(file => {
      const shareInfo = file.sharedWith.find(share => 
        share.user._id.toString() === req.user._id.toString()
      );
      
      return {
        id: file._id,
        name: file.name,
        type: file.type,
        size: file.size,
        uploadDate: file.createdAt,
        sharedBy: file.userId.username,
        sharedByEmail: file.userId.email,
        sharedAt: shareInfo.sharedAt,
        permission: shareInfo.permission,
        url: `/api/files/${file._id}/download`,
        canEdit: shareInfo.permission === 'edit',
        isFolder: file.isFolder,
        parentFolder: file.parentFolder
      };
    });

    res.json({
      success: true,
      files: formattedFiles
    });
  } catch (error) {
    console.error('Get shared files error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while fetching shared files'
    });
  }
});

// Remove shared entry for current user (recipient removes the share from their view)
router.post('/:fileId/remove-share', authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;

    const file = await File.findOne({ _id: fileId }).populate('sharedWith.user', 'username email');
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    // Check if user is in sharedWith list
    const shareIndex = file.sharedWith.findIndex(share => share.user && share.user._id.toString() === req.user._id.toString());
    if (shareIndex === -1) {
      return res.status(403).json({ success: false, error: 'You are not a recipient of this file' });
    }

    // Remove the shared entry for this user
    file.sharedWith.splice(shareIndex, 1);
    await file.save();

    await Activity.logActivity({
      type: 'share',
      fileId: file._id,
      fileName: file.name,
      userId: req.user._id,
      details: new Map([['action', 'removed_by_recipient']])
    });

    return res.json({ success: true, message: 'Removed shared file from your list' });
  } catch (error) {
    console.error('Remove shared entry error:', error);
    return res.status(500).json({ success: false, error: 'Server error while removing shared entry' });
  }
});

// Get trash files
router.get('/trash', authMiddleware, async (req, res) => {
  try {
    const trashFiles = await File.find({
      userId: req.user._id,
      inTrash: true
    })
    .sort({ deletedAt: -1 })
    .lean();

    res.json({
      success: true,
      files: trashFiles.map(file => ({
        id: file._id,
        name: file.name,
        type: file.type,
        size: file.size,
        uploadDate: file.createdAt,
        deletedAt: file.deletedAt,
        permanentDeleteAt: file.permanentDeleteAt,
        url: `/api/files/${file._id}/download`,
        isFolder: file.isFolder,
        parentFolder: file.parentFolder
      }))
    });
  } catch (error) {
    console.error('Get trash files error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while fetching trash files'
    });
  }
});

// Rename file or folder
router.patch('/:fileId/rename', authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;
    const { name } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'New name is required'
      });
    }

    const file = await File.findOne({ 
      _id: fileId, 
      userId: req.user._id 
    });

    if (!file) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    const oldName = file.name;
    file.name = name.trim();
    file.updatedAt = new Date();

    await file.save();

    await Activity.logActivity({
      type: 'rename',
      fileId: file._id,
      fileName: name.trim(),
      userId: req.user._id,
      details: new Map([['oldName', oldName], ['newName', name.trim()]])
    });

    res.json({
      success: true,
      message: 'Renamed successfully',
      file: {
        id: file._id,
        name: file.name,
        type: file.type,
        size: file.size,
        updatedAt: file.updatedAt
      }
    });
  } catch (error) {
    console.error('Rename file error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while renaming file'
    });
  }
});

// Move file/folder
router.post('/:fileId/move', authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;
    let { targetFolderId, targetFolderName } = req.body;

    const file = await File.findOne({ _id: fileId, userId: req.user._id });
    if (!file) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // If folder name is provided instead of ID, find the folder ID
    if (targetFolderName && !targetFolderId) {
      const targetFolder = await File.findOne({
        name: targetFolderName,
        userId: req.user._id,
        isFolder: true,
        inTrash: false
      });
      
      if (targetFolder) {
        targetFolderId = targetFolder._id;
      } else {
        return res.status(404).json({
          success: false,
          error: `Folder "${targetFolderName}" not found`
        });
      }
    }

    if (targetFolderId === '' || targetFolderId === 'root') {
      targetFolderId = null;
    }

    if (targetFolderId) {
      const targetFolder = await File.findOne({ 
        _id: targetFolderId, 
        userId: req.user._id, 
        isFolder: true 
      });
      
      if (!targetFolder) {
        return res.status(404).json({
          success: false,
          error: 'Target folder not found'
        });
      }

      if (file.isFolder && fileId === targetFolderId) {
        return res.status(400).json({
          success: false,
          error: 'Cannot move folder into itself'
        });
      }

      if (file.isFolder) {
        const isSubfolder = await checkIfSubfolder(targetFolderId, fileId);
        if (isSubfolder) {
          return res.status(400).json({
            success: false,
            error: 'Cannot move folder into its own subfolder'
          });
        }
      }
    }

    const oldParent = file.parentFolder;
    file.parentFolder = targetFolderId;
    file.updatedAt = new Date();

    await file.save();

    await Activity.logActivity({
      type: 'move',
      fileId: file._id,
      fileName: file.name,
      userId: req.user._id,
      details: new Map([['oldLocation', oldParent || 'root'], ['newLocation', targetFolderId || 'root']])
    });

    res.json({
      success: true,
      message: 'Moved successfully'
    });
  } catch (error) {
    console.error('Move file error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while moving file'
    });
  }
});

// Copy file/folder
router.post('/:fileId/copy', authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;
    let { targetFolderId } = req.body;

    const originalFile = await File.findOne({ _id: fileId, userId: req.user._id });
    if (!originalFile) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    if (targetFolderId === '' || targetFolderId === 'root') {
      targetFolderId = null;
    }

    if (targetFolderId) {
      const targetFolder = await File.findOne({ 
        _id: targetFolderId, 
        userId: req.user._id, 
        isFolder: true 
      });
      
      if (!targetFolder) {
        return res.status(404).json({
          success: false,
          error: 'Target folder not found'
        });
      }
    }

    const fileCopy = new File({
      name: originalFile.name + ' (Copy)',
      originalName: originalFile.originalName,
      type: originalFile.type,
      size: originalFile.size,
      path: originalFile.path,
      userId: req.user._id,
      parentFolder: targetFolderId,
      isFolder: originalFile.isFolder,
      metadata: originalFile.metadata
    });

    await fileCopy.save();

    await Activity.logActivity({
      type: 'copy',
      fileId: fileCopy._id,
      fileName: fileCopy.name,
      userId: req.user._id,
      details: new Map([['originalFile', originalFile.name], ['newLocation', targetFolderId || 'root']])
    });

    res.json({
      success: true,
      message: 'Copied successfully',
      file: {
        id: fileCopy._id,
        name: fileCopy.name,
        type: fileCopy.type,
        size: fileCopy.size,
        isFolder: fileCopy.isFolder,
        parentFolder: fileCopy.parentFolder
      }
    });
  } catch (error) {
    console.error('Copy file error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while copying file'
    });
  }
});

// Download file
router.get('/:fileId/download', authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;
    
    const file = await File.findOne({ 
      _id: fileId,
      $or: [
        { userId: req.user._id },
        { 'sharedWith.user': req.user._id }
      ]
    });

    if (!file) {
      return res.status(404).json({
        success: false,
        error: 'File not found or access denied'
      });
    }

    if (file.isFolder) {
      return res.status(400).json({
        success: false,
        error: 'Cannot download folders'
      });
    }

    if (!file.path || !fs.existsSync(file.path)) {
      // Log file path and existence for debugging
      try { console.error(`Download requested but file missing on disk. fileId=${fileId}, path=${file.path}`); } catch(e) {}

      // Try to find the file in the owner's upload directory as a fallback (more flexible)
      try {
        const ownerId = file.userId ? file.userId.toString() : null;
        let found = null;
        const baseName = file.originalName ? path.basename(file.originalName, path.extname(file.originalName)) : null;

        if (ownerId) {
          const userUploadDir = path.join(__dirname, '../uploads', ownerId);
          try {
            if (fs.existsSync(userUploadDir)) {
              const entries = fs.readdirSync(userUploadDir);
              for (const e of entries) {
                const candidatePath = path.join(userUploadDir, e);
                try {
                  const stat = fs.statSync(candidatePath);
                  if (!stat.isFile()) continue;
                  const candidateBase = path.basename(e, path.extname(e));
                  const sizeMatches = file.size && stat.size === (file.size || 0);
                  const nameMatches = baseName && candidateBase.toLowerCase().includes(baseName.toLowerCase());
                  if (sizeMatches && nameMatches) { found = candidatePath; break; }
                  if (!file.size && nameMatches) { found = candidatePath; break; }
                  if (!found && nameMatches) { found = candidatePath; }
                } catch (innerErr) {
                  continue;
                }
              }
            } else {
              console.error(`Owner upload dir does not exist: ${userUploadDir}`);
            }
          } catch (dirErr) {
            console.error('Error reading owner upload dir:', dirErr);
          }
        }

        // Global search across uploads as a last resort
        if (!found) {
          try {
            const uploadsRoot = path.join(__dirname, '../uploads');
            if (fs.existsSync(uploadsRoot)) {
              const users = fs.readdirSync(uploadsRoot);
              for (const u of users) {
                const dir = path.join(uploadsRoot, u);
                if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
                const entries = fs.readdirSync(dir);
                for (const e of entries) {
                  const candidatePath = path.join(dir, e);
                  try {
                    const stat = fs.statSync(candidatePath);
                    if (!stat.isFile()) continue;
                    const candidateBase = path.basename(e, path.extname(e));
                    const sizeMatches = file.size && stat.size === (file.size || 0);
                    const nameMatches = baseName && candidateBase.toLowerCase().includes(baseName.toLowerCase());
                    if (sizeMatches && nameMatches) { found = candidatePath; break; }
                    if (!file.size && nameMatches) { found = candidatePath; break; }
                    if (!found && nameMatches) { found = candidatePath; }
                  } catch (innerErr) {
                    continue;
                  }
                }
                if (found) break;
              }
            }
          } catch (globalErr) {
            console.error('Error during global uploads search:', globalErr);
          }
        }

        if (found) {
          console.log(`Found file on disk via fallback for fileId=${fileId}: ${found}`);
          file.path = found;
          // Persist found path to DB so future downloads work without fallback
          try {
            await File.updateOne({ _id: file._id }, { $set: { path: found } });
            console.log(`Persisted found path to DB for fileId=${fileId}`);
          } catch (persistErr) {
            console.error('Failed to persist fallback path to DB:', persistErr);
          }
        } else {
          console.error(`Fallback search did not locate file for fileId=${fileId}`);
          return res.status(404).json({
            success: false,
            error: 'File found in DB but not on server (file not found on server)'
          });
        }
      } catch (fallbackErr) {
        console.error('Error during fallback file search:', fallbackErr);
        return res.status(500).json({ success: false, error: 'Server error while locating file' });
      }
    }

    await Activity.logActivity({
      type: 'download',
      fileId: file._id,
      fileName: file.name,
      userId: req.user._id
    });

    res.setHeader('Content-Disposition', `attachment; filename="${file.originalName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    
    const fileStream = fs.createReadStream(file.path);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Download file error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while downloading file'
    });
  }
});

// Share file
router.post('/:fileId/share', authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;
    const { targetUserEmail, permission = 'view' } = req.body;

    if (!targetUserEmail) {
      return res.status(400).json({
        success: false,
        error: 'Target user email is required'
      });
    }

    // Find target user
    const targetUser = await User.findOne({ email: targetUserEmail.toLowerCase() });
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check if trying to share with self
    if (targetUser._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'Cannot share file with yourself'
      });
    }

    const file = await File.findOne({ _id: fileId, userId: req.user._id });
    if (!file) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // Check if already shared
    const alreadyShared = file.sharedWith.some(share => 
      share.user.toString() === targetUser._id.toString()
    );

    if (alreadyShared) {
      return res.status(400).json({
        success: false,
        error: 'File already shared with this user'
      });
    }

    file.sharedWith.push({
      user: targetUser._id,
      permission,
      sharedAt: new Date()
    });

    await file.save();

    // Log activity
    await Activity.logActivity({
      type: 'share',
      fileId: file._id,
      fileName: file.name,
      userId: req.user._id,
      targetUserId: targetUser._id,
      details: new Map([['permission', permission]])
    });

    res.json({
      success: true,
      message: `File shared successfully with ${targetUserEmail}`
    });
  } catch (error) {
    console.error('Share file error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while sharing file'
    });
  }
});

// Generate or get a public share link for a file
router.post('/:fileId/share-link', authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;
    console.log('Share link requested for fileId:', fileId);
    console.log('User ID:', req.user._id);

    const file = await File.findOne({ _id: fileId, userId: req.user._id });
    console.log('File found:', file ? 'Yes' : 'No');
    
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    if (file.isFolder) {
      return res.status(400).json({ success: false, error: 'Cannot create public link for folders' });
    }

    // If there's already a token, return it
    if (file.isPublic && file.publicUrl) {
      const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      return res.json({ success: true, publicLink: `${base}/api/files/public/${file.publicUrl}` });
    }

    const token = crypto.randomBytes(16).toString('hex');
    file.isPublic = true;
    file.publicUrl = token;

    await file.save();

    await Activity.logActivity({
      type: 'share_link',
      fileId: file._id,
      fileName: file.name,
      userId: req.user._id,
      details: new Map([['action', 'created']])
    });

    const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    res.json({ success: true, publicLink: `${base}/api/files/public/${token}` });
  } catch (error) {
    console.error('Create share link error:', error);
    res.status(500).json({ success: false, error: 'Server error while creating share link' });
  }
});

// Revoke public share link
router.post('/:fileId/revoke-link', authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;

    const file = await File.findOne({ _id: fileId, userId: req.user._id });
    if (!file) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    file.isPublic = false;
    file.publicUrl = null;
    await file.save();

    await Activity.logActivity({
      type: 'share_link',
      fileId: file._id,
      fileName: file.name,
      userId: req.user._id,
      details: new Map([['action', 'revoked']])
    });

    res.json({ success: true, message: 'Public link revoked' });
  } catch (error) {
    console.error('Revoke share link error:', error);
    res.status(500).json({ success: false, error: 'Server error while revoking share link' });
  }
});

// Move to trash
router.post('/:fileId/trash', authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;

    const file = await File.findOne({ _id: fileId, userId: req.user._id });
    if (!file) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    file.inTrash = true;
    file.deletedAt = new Date();
    file.permanentDeleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await file.save();

    await StorageStats.updateUserStats(req.user._id);

    await Activity.logActivity({
      type: 'delete',
      fileId: file._id,
      fileName: file.name,
      userId: req.user._id
    });

    res.json({
      success: true,
      message: 'Moved to trash'
    });
  } catch (error) {
    console.error('Move to trash error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while moving file to trash'
    });
  }
});

// Restore file from trash
router.post('/:fileId/restore', authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;

    const file = await File.findOne({ _id: fileId, userId: req.user._id, inTrash: true });
    if (!file) {
      return res.status(404).json({
        success: false,
        error: 'File not found in trash'
      });
    }

    file.inTrash = false;
    file.deletedAt = null;
    file.permanentDeleteAt = null;

    await file.save();

    await StorageStats.updateUserStats(req.user._id);

    await Activity.logActivity({
      type: 'restore',
      fileId: file._id,
      fileName: file.name,
      userId: req.user._id
    });

    res.json({
      success: true,
      message: 'File restored successfully'
    });
  } catch (error) {
    console.error('Restore file error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while restoring file'
    });
  }
});

// Delete file permanently
router.delete('/:fileId', authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;

    const file = await File.findOne({ _id: fileId, userId: req.user._id });
    if (!file) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // Delete physical file
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    await File.findByIdAndDelete(fileId);

    // Update storage stats
    await StorageStats.updateUserStats(req.user._id);

    // Log activity
    await Activity.logActivity({
      type: 'permanent_delete',
      fileId: fileId,
      fileName: file.name,
      userId: req.user._id
    });

    res.json({
      success: true,
      message: 'File permanently deleted'
    });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while deleting file'
    });
  }
});

// Empty trash
router.delete('/trash/empty', authMiddleware, async (req, res) => {
  try {
    const trashFiles = await File.find({ 
      userId: req.user._id, 
      inTrash: true 
    });

    // Delete physical files
    for (const file of trashFiles) {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }

    // Delete from database
    await File.deleteMany({ 
      userId: req.user._id, 
      inTrash: true 
    });

    // Update storage stats
    await StorageStats.updateUserStats(req.user._id);

    // Log activity
    await Activity.logActivity({
      type: 'empty_trash',
      userId: req.user._id,
      fileName: 'Multiple Files',
      details: new Map([['count', trashFiles.length.toString()]])
    });

    res.json({
      success: true,
      message: 'Trash emptied successfully',
      deletedCount: trashFiles.length
    });
  } catch (error) {
    console.error('Empty trash error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while emptying trash'
    });
  }
});

// Get file info
router.get('/:fileId/info', authMiddleware, async (req, res) => {
  try {
    const { fileId } = req.params;
    
    const file = await File.findOne({ 
      _id: fileId,
      $or: [
        { userId: req.user._id },
        { 'sharedWith.user': req.user._id }
      ]
    }).populate('sharedWith.user', 'username email');

    if (!file) {
      return res.status(404).json({
        success: false,
        error: 'File not found or access denied'
      });
    }

    res.json({
      success: true,
      file: {
        id: file._id,
        name: file.name,
        type: file.type,
        size: file.size,
        uploadDate: file.createdAt,
        updatedAt: file.updatedAt,
        uploader: req.user.username,
        sharedWith: file.sharedWith,
        isFolder: file.isFolder,
        inTrash: file.inTrash,
        parentFolder: file.parentFolder,
        url: `/api/files/${file._id}/download`
      }
    });
  } catch (error) {
    console.error('Get file info error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while fetching file info'
    });
  }
});

// Get storage overview
router.get('/storage/overview', authMiddleware, async (req, res) => {
  try {
    let storageStats = await StorageStats.findOne({ userId: req.user._id });
    
    // If no stats exist, calculate them
    if (!storageStats) {
      console.log('No storage stats found for user, calculating...');
      storageStats = await StorageStats.updateUserStats(req.user._id);
    }

    // Ensure we have all the required fields
    const usedStorage = storageStats.usedStorage || 0;
    
    console.log('Storage stats response:', {
      userId: req.user._id.toString(),
      usedStorage: usedStorage,
      totalFiles: storageStats.totalFiles || 0,
      totalFolders: storageStats.totalFolders || 0,
      hasUsedStorage: storageStats.hasOwnProperty('usedStorage'),
      storageStatsKeys: Object.keys(storageStats.toObject?.() || {})
    });

    res.json({
      success: true,
      overview: {
        total: {
          used: usedStorage,
          available: 16106127360,
          fileCount: storageStats.totalFiles || 0,
          folderCount: storageStats.totalFolders || 0
        },
        byType: storageStats.fileTypeBreakdown || {}
      }
    });
  } catch (error) {
    console.error('Get storage overview error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while fetching storage overview'
    });
  }
});

// Helper functions
async function checkIfSubfolder(parentFolderId, potentialSubfolderId) {
  let currentFolderId = parentFolderId;
  
  while (currentFolderId) {
    const folder = await File.findById(currentFolderId);
    if (!folder) break;
    
    if (folder._id.toString() === potentialSubfolderId.toString()) {
      return true;
    }
    
    currentFolderId = folder.parentFolder;
  }
  
  return false;
}

function getFileTypeFromMime(mimeType) {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar') || mimeType.includes('7z')) return 'archive';
  if (mimeType.includes('text') || mimeType.includes('plain')) return 'text';
  if (mimeType.includes('javascript') || mimeType.includes('python') || mimeType.includes('java') || 
      mimeType.includes('cpp') || mimeType.includes('html') || mimeType.includes('css')) return 'code';
  return 'document';
}

function getActivityDescription(activity) {
  // Helper to read details whether stored as a Map (with .get) or plain object
  function getDetail(key) {
    if (!activity.details) return undefined;
    if (typeof activity.details.get === 'function') {
      return activity.details.get(key);
    }
    return activity.details[key];
  }

  const descriptions = {
    upload: `You uploaded ${activity.fileName}`,
    download: `You downloaded ${activity.fileName}`,
    view: `You viewed ${activity.fileName}`,
    share: `You shared ${activity.fileName} with ${activity.targetUserId?.username || 'another user'}`,
    rename: `You renamed a file to ${activity.fileName}`,
    move: `You moved ${activity.fileName}`,
    delete: `You deleted ${activity.fileName}`,
    restore: `You restored ${activity.fileName}`,
    create_folder: `You created folder ${activity.fileName}`,
    copy: `You copied ${activity.fileName}`,
    permanent_delete: `You permanently deleted ${activity.fileName}`,
    empty_trash: `You emptied trash (${getDetail('count') || 'multiple'} files)`
  };

  return descriptions[activity.type] || `You performed ${activity.type} on ${activity.fileName}`;
}

function getActivityIcon(type) {
  const icons = {
    upload: 'file_upload',
    download: 'download',
    view: 'visibility',
    share: 'share',
    rename: 'drive_file_rename_outline',
    move: 'drive_file_move',
    delete: 'delete',
    restore: 'restore',
    create_folder: 'create_new_folder',
    copy: 'content_copy',
    permanent_delete: 'delete_forever',
    empty_trash: 'delete_sweep'
  };
  return icons[type] || 'description';
}

module.exports = router;