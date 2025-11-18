const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const File = require('../models/File');

async function main() {
  const [, , fileId, sourcePath] = process.argv;
  if (!fileId || !sourcePath) {
    console.error('Usage: node scripts/relink-file.js <fileId> "C:\\path\\to\\source.file"');
    process.exit(1);
  }

  if (!fs.existsSync(sourcePath)) {
    console.error('Source file not found:', sourcePath);
    process.exit(1);
  }

  const mongoUri = process.env.MONGO_URI || process.env.MONGO_URL || process.env.DATABASE_URL || process.env.MONGO || 'mongodb://localhost:27017/storage';
  console.log('Connecting to MongoDB at', mongoUri);

  await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });

  const file = await File.findById(fileId).exec();
  if (!file) {
    console.error('No file document found with id', fileId);
    await mongoose.disconnect();
    process.exit(1);
  }

  const ownerId = file.userId ? file.userId.toString() : null;
  if (!ownerId) {
    console.error('File document has no owner (userId)');
    await mongoose.disconnect();
    process.exit(1);
  }

  const uploadsDir = path.join(__dirname, '..', 'uploads', ownerId);
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
  } catch (err) {
    console.error('Failed to ensure uploads dir:', uploadsDir, err);
    await mongoose.disconnect();
    process.exit(1);
  }

  const srcBase = path.basename(sourcePath);
  let destPath = path.join(uploadsDir, srcBase);
  if (fs.existsSync(destPath)) {
    const ext = path.extname(srcBase);
    const base = path.basename(srcBase, ext);
    destPath = path.join(uploadsDir, `${base}-${Date.now()}${ext}`);
  }

  try {
    fs.copyFileSync(sourcePath, destPath);
    console.log('Copied file to', destPath);
  } catch (err) {
    console.error('Failed to copy file:', err);
    await mongoose.disconnect();
    process.exit(1);
  }

  try {
    file.path = destPath;
    await file.save();
    console.log('Updated DB file.path for', fileId);
  } catch (err) {
    console.error('Failed to update file document:', err);
    await mongoose.disconnect();
    process.exit(1);
  }

  await mongoose.disconnect();
  console.log('Done. You can now retry the download in the app.');
  process.exit(0);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});