'use strict';

const { WINDOWS } = require('./config');

/**
 * 返回发布时间所属的最小滚动窗口：today(近24h) / week(近7天) / month(近30天)，
 * 超出 30 天返回 null。
 */
function periodOf(publishedAt, now = Date.now()) {
  if (typeof publishedAt !== 'number' || !Number.isFinite(publishedAt)) return null;
  if (publishedAt >= now - WINDOWS.today) return 'today';
  if (publishedAt >= now - WINDOWS.week) return 'week';
  if (publishedAt >= now - WINDOWS.month) return 'month';
  return null;
}

/** 滚动窗口起点（毫秒），period 非法时返回 0。 */
function windowStart(period, now = Date.now()) {
  const ms = WINDOWS[period];
  return ms ? now - ms : 0;
}

/** 格式化绝对时间（本地时区，YYYY-MM-DD HH:mm）。 */
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 相对时间文案。 */
function relTime(ts, now = Date.now()) {
  if (!ts) return '';
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} 个月前`;
  return `${Math.floor(month / 12)} 年前`;
}

/**
 * 解析「2026年08月29日」这类中文日期为本地零点毫秒时间戳。
 * 解析失败返回 null。
 */
function parseCnDate(str) {
  if (!str) return null;
  const m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/.exec(String(str));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** 解析「2026-08-09 17:59:47」这类本地时间字符串；失败返回 null。 */
function parseLocalDateTime(str) {
  if (!str) return null;
  const m = /(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(String(str));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** 解析来源时间：毫秒时间戳 / ISO 字符串 / 中文日期，统一返回毫秒或 null。 */
function toTs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const num = Number(value);
  if (Number.isFinite(num) && num > 100000000000) return num;
  const s = String(value);
  const iso = Date.parse(s);
  if (Number.isFinite(iso)) return iso;
  return parseLocalDateTime(s) ?? parseCnDate(s);
}

module.exports = { WINDOWS, periodOf, windowStart, fmtTime, relTime, parseCnDate, parseLocalDateTime, toTs };
