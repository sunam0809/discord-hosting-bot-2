/**
 * PostgreSQL database via Neon — persistent across Render restarts.
 */
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Init tables ────────────────────────────────────────────────────────────

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id          TEXT PRIMARY KEY,
      key_value   TEXT UNIQUE NOT NULL,
      created_by  TEXT NOT NULL,
      label       TEXT,
      created_at  BIGINT NOT NULL,
      expires_at  BIGINT,
      is_active   INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS hosting_records (
      id          TEXT PRIMARY KEY,
      key_id      TEXT REFERENCES api_keys(id),
      user_id     TEXT NOT NULL,
      username    TEXT NOT NULL,
      language    TEXT NOT NULL,
      code        TEXT NOT NULL,
      status      TEXT DEFAULT 'stopped',
      pid         INTEGER,
      created_at  BIGINT NOT NULL,
      updated_at  BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS libraries (
      id           TEXT PRIMARY KEY,
      record_id    TEXT REFERENCES hosting_records(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      version      TEXT,
      installed_at BIGINT NOT NULL,
      UNIQUE(record_id, name)
    );
  `);
  console.log('[DB] Tables ready (Neon PostgreSQL)');
}

// ── Key functions ──────────────────────────────────────────────────────────

async function createKey({ createdBy, label, expiresAt }) {
  const id       = uuidv4();
  const keyValue = uuidv4().replace(/-/g, '').toUpperCase();
  const now      = Date.now();
  await pool.query(
    'INSERT INTO api_keys (id, key_value, created_by, label, created_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, keyValue, createdBy, label || null, now, expiresAt || null],
  );
  return { id, keyValue, label, expiresAt };
}

async function validateKey(keyValue) {
  const { rows } = await pool.query(
    'SELECT * FROM api_keys WHERE key_value = $1 AND is_active = 1',
    [keyValue],
  );
  const key = rows[0];
  if (!key) return { valid: false, reason: '존재하지 않는 키입니다.' };
  if (key.expires_at && Date.now() > Number(key.expires_at))
    return { valid: false, reason: '키가 만료되었습니다.' };
  return { valid: true, key };
}

async function getAllKeys() {
  const { rows } = await pool.query('SELECT * FROM api_keys ORDER BY created_at DESC');
  return rows;
}

async function getKeyById(id) {
  const { rows } = await pool.query('SELECT * FROM api_keys WHERE id = $1', [id]);
  return rows[0] || null;
}

async function deactivateKey(id) {
  await pool.query('UPDATE api_keys SET is_active = 0 WHERE id = $1', [id]);
}

// ── Hosting record functions ───────────────────────────────────────────────

async function createHostingRecord({ keyId, userId, username, language, code }) {
  const id  = uuidv4();
  const now = Date.now();
  await pool.query(
    `INSERT INTO hosting_records (id, key_id, user_id, username, language, code, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'stopped',$7,$8)`,
    [id, keyId, userId, username, language, code, now, now],
  );
  return id;
}

async function updateHostingStatus(id, status, pid = null) {
  await pool.query(
    'UPDATE hosting_records SET status = $1, pid = $2, updated_at = $3 WHERE id = $4',
    [status, pid, Date.now(), id],
  );
}

async function updateHostingCode(id, language, code) {
  await pool.query(
    `UPDATE hosting_records SET language = $1, code = $2, status = 'stopped', pid = NULL, updated_at = $3 WHERE id = $4`,
    [language, code, Date.now(), id],
  );
}

async function getHostingRecord(id) {
  const { rows } = await pool.query('SELECT * FROM hosting_records WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getHostingRecordsByUser(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM hosting_records WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  );
  return rows;
}

async function deleteHostingRecord(id) {
  // Libraries cascade-delete via FK ON DELETE CASCADE
  await pool.query('DELETE FROM hosting_records WHERE id = $1', [id]);
}

async function getExpiredKeyIds() {
  const now = Date.now();
  const { rows } = await pool.query(
    'SELECT id FROM api_keys WHERE is_active = 1 AND expires_at IS NOT NULL AND expires_at < $1',
    [now],
  );
  return rows.map(r => r.id);
}

async function getRunningRecords() {
  const { rows } = await pool.query(`SELECT * FROM hosting_records WHERE status = 'running'`);
  return rows;
}

async function getRunningRecordsByKeyIds(keyIds) {
  if (!keyIds.length) return [];
  const placeholders = keyIds.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await pool.query(
    `SELECT * FROM hosting_records WHERE key_id IN (${placeholders}) AND status = 'running'`,
    keyIds,
  );
  return rows;
}

// ── Library functions ──────────────────────────────────────────────────────

async function addLibrary({ recordId, name, version }) {
  const id  = uuidv4();
  const now = Date.now();
  await pool.query(
    `INSERT INTO libraries (id, record_id, name, version, installed_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (record_id, name) DO UPDATE SET version=$4, installed_at=$5`,
    [id, recordId, name, version || null, now],
  );
  return id;
}

async function removeLibraryById(id) {
  await pool.query('DELETE FROM libraries WHERE id = $1', [id]);
}

async function removeLibraryByName(recordId, name) {
  await pool.query('DELETE FROM libraries WHERE record_id = $1 AND name = $2', [recordId, name]);
}

async function getLibraries(recordId) {
  const { rows } = await pool.query(
    'SELECT * FROM libraries WHERE record_id = $1 ORDER BY installed_at DESC',
    [recordId],
  );
  return rows;
}

// ── Admin dashboard functions ──────────────────────────────────────────────

async function getAllHostingRecords({ limit = 50, offset = 0, language, status } = {}) {
  let where = [];
  const params = [];

  if (language) { params.push(language); where.push(`hr.language = $${params.length}`); }
  if (status)   { params.push(status);   where.push(`hr.status = $${params.length}`); }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT hr.*, ak.key_value, ak.label as key_label, ak.expires_at as key_expires_at, ak.is_active as key_is_active
     FROM hosting_records hr
     LEFT JOIN api_keys ak ON hr.key_id = ak.id
     ${whereClause}
     ORDER BY hr.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

async function countAllHostingRecords({ language, status } = {}) {
  let where = [];
  const params = [];
  if (language) { params.push(language); where.push(`language = $${params.length}`); }
  if (status)   { params.push(status);   where.push(`status = $${params.length}`); }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { rows } = await pool.query(`SELECT COUNT(*) as cnt FROM hosting_records ${whereClause}`, params);
  return parseInt(rows[0].cnt, 10);
}

async function getHostingRecordWithKey(id) {
  const { rows } = await pool.query(
    `SELECT hr.*, ak.key_value, ak.label as key_label, ak.expires_at as key_expires_at, ak.is_active as key_is_active
     FROM hosting_records hr
     LEFT JOIN api_keys ak ON hr.key_id = ak.id
     WHERE hr.id = $1`,
    [id],
  );
  return rows[0] || null;
}

module.exports = {
  init,
  createKey, validateKey, getAllKeys, getKeyById, deactivateKey,
  createHostingRecord, updateHostingStatus, updateHostingCode,
  getHostingRecord, getHostingRecordsByUser, deleteHostingRecord,
  getExpiredKeyIds, getRunningRecords, getRunningRecordsByKeyIds,
  addLibrary, removeLibraryById, removeLibraryByName, getLibraries,
  getAllHostingRecords, countAllHostingRecords, getHostingRecordWithKey,
};
