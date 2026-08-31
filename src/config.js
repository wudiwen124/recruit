'use strict';

const path = require('node:path');

const ROOT = path.join(__dirname, '..');

module.exports = {
  ROOT,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  DATA_DIR: path.join(ROOT, 'data'),
  DB_PATH: path.join(ROOT, 'data', 'jobs.db'),
  STATUS_PATH: path.join(ROOT, 'data', 'status.json'),

  PORT: Number(process.env.PORT || 3000),
  CRAWL_INTERVAL_MS: 2 * 60 * 60 * 1000, // 每 2 小时自动更新

  COMPANIES: ['字节跳动', '阿里巴巴', '腾讯', '拼多多', '美团', '快手'],

  // 滚动窗口（毫秒）
  WINDOWS: {
    today: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    halfyear: 180 * 24 * 60 * 60 * 1000, // “6个月内更新” = 近 6 个月
  },

  CLEANUP_DAYS: 90, // 清理 90 天前的非活跃记录
  MAX_PAGES_PER_SOURCE: Number(process.env.MAX_PAGES_PER_SOURCE || 20), // 每源最多翻页数
  MAX_JOBS_PER_SOURCE: Number(process.env.MAX_JOBS_PER_SOURCE || 500), // 每源每次最多入库条数
};
