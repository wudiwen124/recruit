'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DB_PATH, CLEANUP_DAYS, WINDOWS } = require('./config');

let _db = null;

function openDb(dbPath = DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id           TEXT PRIMARY KEY,
      company      TEXT NOT NULL,
      title        TEXT NOT NULL,
      category     TEXT,
      recruit_type TEXT,
      city         TEXT,
      department   TEXT,
      description  TEXT,
      url          TEXT,
      published_at INTEGER NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_seen_at  INTEGER NOT NULL,
      active       INTEGER NOT NULL DEFAULT 1,
      talent       INTEGER NOT NULL DEFAULT 0,
      published_at_missing INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_published ON jobs(published_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(active)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company)');
  // 迁移：老库补充 talent 列
  const cols = db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name);
  if (!cols.includes('talent')) {
    db.exec('ALTER TABLE jobs ADD COLUMN talent INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('published_at_missing')) {
    db.exec('ALTER TABLE jobs ADD COLUMN published_at_missing INTEGER NOT NULL DEFAULT 0');
    // 历史腾讯岗位来自 join.qq.com（无发布时间字段），回填为“无时间标注”
    db.prepare("UPDATE jobs SET published_at_missing = 1 WHERE company = '腾讯' AND published_at_missing = 0").run();
  }
  return db;
}

function getDb() {
  if (!_db) _db = openDb();
  return _db;
}

function closeDb() {
  if (_db) {
    try { _db.close(); } catch (_) {}
    _db = null;
  }
}

function upsertJobs(db, jobs, now = Date.now()) {
  if (!jobs || jobs.length === 0) return 0;
  // published_at_missing=true 表示来源无时间字段（如腾讯缺失时间、BOSS 列表无时间）：
  // 首次入库用抓取时间（自然落在 6 个月内），后续抓取保留原值，避免每次都挤进“今日更新”。
  const stmt = db.prepare(`
    INSERT INTO jobs (id, company, title, category, recruit_type, city, department, description, url, published_at, first_seen_at, last_seen_at, active, talent, published_at_missing)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      category = excluded.category,
      recruit_type = excluded.recruit_type,
      talent = excluded.talent,
      published_at_missing = excluded.published_at_missing,
      city = excluded.city,
      department = excluded.department,
      description = excluded.description,
      url = excluded.url,
      published_at = CASE WHEN ? THEN jobs.published_at ELSE excluded.published_at END,
      last_seen_at = excluded.last_seen_at,
      active = 1
  `);
  db.exec('BEGIN');
  try {
    for (const j of jobs) {
      stmt.run(
        j.id, j.company, j.title, j.category || null, j.recruit_type || null,
        j.city || null, j.department || null, j.description || null, j.url || null,
        j.published_at, j.first_seen_at ?? now, j.last_seen_at ?? now,
        j.talent ? 1 : 0,
        j.published_at_missing ? 1 : 0,
        j.published_at_missing ? 1 : 0
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return jobs.length;
}

/** 本次爬取未出现的旧岗位置为 inactive。 */
function markInactive(db, company, seenIds, now = Date.now()) {
  const ids = Array.from(new Set((seenIds || []).filter(Boolean)));
  if (ids.length === 0) {
    db.prepare('UPDATE jobs SET active = 0 WHERE company = ? AND active = 1').run(company);
    return;
  }
  // 用临时表避免大列表 NOT IN 分片互相抵消（每段只保护自己那部分 id）
  db.exec('CREATE TEMP TABLE IF NOT EXISTS _seen_ids (id TEXT PRIMARY KEY)');
  db.exec('DELETE FROM _seen_ids');
  const stmt = db.prepare('INSERT OR IGNORE INTO _seen_ids (id) VALUES (?)');
  db.exec('BEGIN');
  try {
    for (const id of ids) stmt.run(id);
    db.prepare('UPDATE jobs SET active = 0 WHERE company = ? AND active = 1 AND id NOT IN (SELECT id FROM _seen_ids)').run(company);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** 删除指定招聘类型的记录（如清理历史社招数据）。 */
function deleteRecruitType(db, recruitType) {
  if (!recruitType) return 0;
  return db.prepare('DELETE FROM jobs WHERE recruit_type = ?').run(recruitType).changes;
}

/** 清理 CLEANUP_DAYS 天前仍未重新出现的非活跃记录。 */
function cleanupOldJobs(db, now = Date.now()) {
  const cutoff = now - CLEANUP_DAYS * 24 * 60 * 60 * 1000;
  const r = db.prepare('DELETE FROM jobs WHERE active = 0 AND last_seen_at < ?').run(cutoff);
  return r.changes;
}

function countAll(db) {
  return db.prepare('SELECT COUNT(*) AS c FROM jobs WHERE active = 1').get().c;
}

/** 统计某个时间点之后发布的活跃岗位数。 */
function countActiveSince(db, sinceMs) {
  if (!sinceMs) return countAll(db);
  return db.prepare('SELECT COUNT(*) AS c FROM jobs WHERE active = 1 AND published_at >= ?').get(sinceMs).c;
}

function hasJobs(db) {
  return countAll(db) > 0;
}

/**
 * 查询岗位列表。
 * options: { period, company, recruitType, q, city, page, pageSize, now }
 */
function queryJobs(db, options = {}) {
  const { period, company, recruitType, q, city, talent, page = 1, pageSize = 20, now = Date.now() } = options;
  const where = ['active = 1'];
  const params = [];
  if (period === 'missing') {
    // “无时间标注”：来源没有发布时间字段的岗位
    where.push('published_at_missing = 1');
  } else {
    // “6个月内更新”按近 6 个月展示，其余为滚动窗口
    const windowMs = period === 'all' ? WINDOWS.halfyear : (WINDOWS[period] || 0);
    if (windowMs) {
      where.push('published_at >= ?');
      params.push(now - windowMs);
    }
    // 无时间标注岗位只进“6个月内更新”，不进今日/今周/今月
    if (period === 'today' || period === 'week' || period === 'month') {
      where.push('published_at_missing = 0');
    }
  }
  if (company) {
    where.push('company = ?');
    params.push(company);
  }
  if (recruitType) {
    where.push('recruit_type = ?');
    params.push(recruitType);
  }
  if (q) {
    const like = `%${q}%`;
    where.push('(title LIKE ? OR category LIKE ? OR department LIKE ? OR city LIKE ?)');
    params.push(like, like, like, like);
  }
  if (city) {
    where.push('city LIKE ?');
    params.push(`%${city}%`);
  }
  if (talent === '1' || talent === '0') {
    where.push('talent = ?');
    params.push(Number(talent));
  }
  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE ${whereSql}`).get(...params).c;
  const limit = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const offset = (Math.max(1, Number(page) || 1) - 1) * limit;
  const rows = db.prepare(
    `SELECT id, company, title, category, recruit_type, city, department, description, url, published_at, talent
     FROM jobs WHERE ${whereSql}
     ORDER BY published_at DESC, id DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
  return { total, page: Math.max(1, Number(page) || 1), pageSize: limit, jobs: rows };
}

function countByWindow(db, now = Date.now()) {
  const out = {};
  for (const period of Object.keys(WINDOWS)) {
    // 今日/今周/今月不计无时间标注岗位；“6个月内更新”包含
    const excludeMissing = period === 'today' || period === 'week' || period === 'month';
    const sql = excludeMissing
      ? 'SELECT COUNT(*) AS c FROM jobs WHERE active = 1 AND published_at_missing = 0 AND published_at >= ?'
      : 'SELECT COUNT(*) AS c FROM jobs WHERE active = 1 AND published_at >= ?';
    out[period] = db.prepare(sql).get(now - WINDOWS[period]).c;
  }
  out.missing = db.prepare('SELECT COUNT(*) AS c FROM jobs WHERE active = 1 AND published_at_missing = 1').get().c;
  return out;
}

module.exports = { openDb, getDb, closeDb, upsertJobs, markInactive, cleanupOldJobs, deleteRecruitType, countAll, countActiveSince, hasJobs, queryJobs, countByWindow };
