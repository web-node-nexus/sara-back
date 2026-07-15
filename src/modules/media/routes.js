const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../../config/db');
const { requireAuth } = require('../../middleware/auth');
const { config } = require('../../config/env');

const router = express.Router();
const uploadDir = path.join(__dirname, '../../../uploads/media');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 12);
    cb(null, `${Date.now()}_${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
});

function kindFromMime(mime = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

router.post('/', requireAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'NO_FILE' });
    }
    const kind =
      req.body.kind && ['image', 'file', 'audio'].includes(req.body.kind)
        ? req.body.kind
        : kindFromMime(req.file.mimetype);
    const publicUrl = `${config.publicBaseUrl}/uploads/media/${req.file.filename}`;
    const result = await query(
      `INSERT INTO media_files
        (user_id, kind, original_name, mime, size_bytes, storage_path, public_url)
       VALUES
        (:userId, :kind, :name, :mime, :size, :path, :url)`,
      {
        userId: req.user.id,
        kind,
        name: req.file.originalname || req.file.filename,
        mime: req.file.mimetype || null,
        size: req.file.size || null,
        path: req.file.path,
        url: publicUrl,
      }
    );
    res.status(201).json({
      ok: true,
      id: result.insertId,
      kind,
      name: req.file.originalname || req.file.filename,
      uri: publicUrl,
      size: req.file.size,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
