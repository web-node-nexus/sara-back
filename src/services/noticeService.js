const { query } = require('../config/db');
const cache = require('../config/redis');

const CACHE_KEY = 'app:notices:v1';

const DEFAULTS = {
  flashTitle: '',
  flashMessage: '',
  flashEnabled: false,
  marqueeTitle: '',
  marqueeDescription: '',
};

function mapSettings(row) {
  if (!row) return { ...DEFAULTS };
  return {
    flashTitle: row.flash_title || '',
    flashMessage: row.flash_message || '',
    flashEnabled: !!row.flash_enabled,
    marqueeTitle: row.marquee_title || '',
    marqueeDescription: row.marquee_description || '',
  };
}

function mapBoardRow(r) {
  return {
    id: Number(r.id),
    title: r.title,
    content: r.content,
    sortOrder: Number(r.sort_order),
    isActive: !!r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function bustCache() {
  await cache.del(CACHE_KEY);
}

async function getSettingsRow() {
  const rows = await query(
    `SELECT flash_title, flash_message, flash_enabled,
            marquee_title, marquee_description
     FROM notice_settings WHERE id = 1 LIMIT 1`
  );
  return rows[0] || null;
}

async function getNoticeSettings() {
  return mapSettings(await getSettingsRow());
}

async function updateFlash({ title, message, enabled }) {
  await query(
    `UPDATE notice_settings SET
       flash_title = :title,
       flash_message = :message,
       flash_enabled = :enabled
     WHERE id = 1`,
    {
      title: String(title || '').slice(0, 255),
      message: String(message || ''),
      enabled: enabled ? 1 : 0,
    }
  );
  await bustCache();
  return getNoticeSettings();
}

async function updateMarquee({ title, description }) {
  await query(
    `UPDATE notice_settings SET
       marquee_title = :title,
       marquee_description = :description
     WHERE id = 1`,
    {
      title: String(title || '').slice(0, 255),
      description: String(description || ''),
    }
  );
  await bustCache();
  return getNoticeSettings();
}

async function listBoardItems(activeOnly = false) {
  const rows = await query(
    `SELECT id, title, content, sort_order, is_active, created_at, updated_at
     FROM notice_board
     WHERE (:activeOnly = 0 OR is_active = 1)
     ORDER BY sort_order ASC, id ASC`,
    { activeOnly: activeOnly ? 1 : 0 }
  );
  return rows.map(mapBoardRow);
}

async function createBoardItem({ title, content, sortOrder }) {
  const maxRows = await query(
    `SELECT COALESCE(MAX(sort_order), 0) AS mx FROM notice_board`
  );
  const sort =
    sortOrder != null ? sortOrder : Number(maxRows[0]?.mx || 0) + 1;
  const result = await query(
    `INSERT INTO notice_board (title, content, sort_order) VALUES (:title, :content, :sort)`,
    {
      title: String(title || '').trim().slice(0, 255),
      content: String(content || ''),
      sort,
    }
  );
  await bustCache();
  const rows = await query(
    `SELECT id, title, content, sort_order, is_active, created_at, updated_at
     FROM notice_board WHERE id = :id LIMIT 1`,
    { id: result.insertId }
  );
  return mapBoardRow(rows[0]);
}

async function updateBoardItem(id, { title, content, sortOrder, isActive }) {
  const rows = await query(
    `SELECT id FROM notice_board WHERE id = :id LIMIT 1`,
    { id }
  );
  if (!rows[0]) {
    const err = new Error('Notice not found');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  await query(
    `UPDATE notice_board SET
       title = COALESCE(:title, title),
       content = COALESCE(:content, content),
       sort_order = COALESCE(:sort, sort_order),
       is_active = COALESCE(:active, is_active)
     WHERE id = :id`,
    {
      id,
      title: title != null ? String(title).trim().slice(0, 255) : null,
      content: content != null ? String(content) : null,
      sort: sortOrder != null ? sortOrder : null,
      active: isActive == null ? null : isActive ? 1 : 0,
    }
  );
  await bustCache();
  const updated = await query(
    `SELECT id, title, content, sort_order, is_active, created_at, updated_at
     FROM notice_board WHERE id = :id LIMIT 1`,
    { id }
  );
  return mapBoardRow(updated[0]);
}

async function deleteBoardItem(id) {
  const rows = await query(
    `SELECT id FROM notice_board WHERE id = :id LIMIT 1`,
    { id }
  );
  if (!rows[0]) {
    const err = new Error('Notice not found');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  await query(`DELETE FROM notice_board WHERE id = :id`, { id });
  await bustCache();
  return { deleted: true, id };
}

async function getPublicNotices() {
  const cached = await cache.get(CACHE_KEY);
  if (cached) return cached;

  const settings = await getNoticeSettings();
  const board = await listBoardItems(true);
  const payload = {
    flash: {
      enabled: settings.flashEnabled,
      title: settings.flashTitle,
      message: settings.flashMessage,
    },
    marquee: {
      title: settings.marqueeTitle,
      description: settings.marqueeDescription,
    },
    board,
  };
  await cache.set(CACHE_KEY, payload, 60);
  return payload;
}

async function getAdminNotices() {
  const settings = await getNoticeSettings();
  const board = await listBoardItems(false);
  return { settings, board };
}

module.exports = {
  getNoticeSettings,
  updateFlash,
  updateMarquee,
  listBoardItems,
  createBoardItem,
  updateBoardItem,
  deleteBoardItem,
  getPublicNotices,
  getAdminNotices,
};
