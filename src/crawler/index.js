'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR, STATUS_PATH, CLEANUP_DAYS } = require('../config');
const { openDb, upsertJobs, markInactive, cleanupOldJobs, deleteRecruitType } = require('../db');
const { createClient, sleep } = require('./utils');
const { MAX_JOBS_PER_SOURCE } = require('../config');

const bytedance = require('./bytedance');
const tencent = require('./tencent');
const alibaba = require('./alibaba');
const pinduoduo = require('./pinduoduo');
const meituan = require('./meituan');
const kuaishou = require('./kuaishou');

const SOURCES = [bytedance, tencent, alibaba, pinduoduo, meituan, kuaishou];

function log(...args) {
  console.log(new Date().toLocaleString('zh-CN', { hour12: false }), ...args);
}

function writeStatus(status) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2), 'utf8');
}

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * 执行一轮完整爬取。
 * options.fetchFn 可注入 mock fetch（测试用）；writeDb=false 时仅探测不写库。
 */
async function runCrawl(options = {}) {
  const { fetchFn, writeDb = true } = options;
  const now = Date.now();
  const status = { updatedAt: now, sources: {} };
  const db = writeDb ? openDb() : null;

  for (const src of SOURCES) {
    const client = createClient({ fetchFn, minIntervalMs: 1000 });
    const start = Date.now();
    const entry = { status: 'error', error: '', count: 0, crawledAt: start };
    try {
      const result = await src.crawl({ client });
      // 按源截断：腾讯上限 1000，其余默认 500
      const sourceCap = src.maxJobs || MAX_JOBS_PER_SOURCE;
      const jobs = (Array.isArray(result.jobs) ? result.jobs : [])
        .slice()
        .sort((a, b) => (b.published_at || 0) - (a.published_at || 0))
        .slice(0, sourceCap);
      entry.status = result.status || 'ok';
      entry.error = result.message || '';
      entry.count = jobs.length;
      entry.channels = result.channels || undefined;
      if (writeDb && jobs.length) {
        upsertJobs(db, jobs, now);
        markInactive(db, src.name, jobs.map((j) => j.id), now);
      }
      log(`[${src.name}] 抓取 ${jobs.length} 条，状态=${entry.status}${entry.error ? '，' + entry.error : ''}`);
    } catch (err) {
      entry.status = 'error';
      entry.error = String((err && err.message) || err);
      log(`[${src.name}] 抓取失败: ${entry.error}`);
    }
    entry.tookMs = Date.now() - start;
    status.sources[src.name] = entry;
    await sleep(1000);
  }

  if (writeDb) {
    // 全站仅展示实习：清理历史遗留的社招/校招数据
    const removed = deleteRecruitType(db, '社招') + deleteRecruitType(db, '校招');
    if (removed) log(`清理社招/校招记录 ${removed} 条`);
    cleanupOldJobs(db, now);
  }
  writeStatus(status);
  return status;
}

/** 探测模式：逐源拉取少量数据并打印字段映射，不写库。 */
async function probe() {
  log('== 探测模式：仅验证各源接口与字段映射（不写库） ==');
  for (const src of SOURCES) {
    const client = createClient({ minIntervalMs: 1000 });
    try {
      const result = await src.crawl({ client });
      const jobs = Array.isArray(result.jobs) ? result.jobs : [];
      log(`[${src.name}] 状态=${result.status || 'ok'} 命中 ${jobs.length} 条`);
      for (const j of jobs.slice(0, 3)) {
        log(`   - ${j.title} | ${j.company} | ${j.recruit_type} | ${j.city} | ${new Date(j.published_at).toISOString()}`);
      }
      if (result.message) log(`   说明: ${result.message}`);
    } catch (err) {
      log(`[${src.name}] 失败: ${String((err && err.message) || err)}`);
    }
  }
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.includes('--probe')) {
    probe().catch((e) => { console.error(e); process.exit(1); });
  } else {
    runCrawl().catch((e) => { console.error(e); process.exit(1); });
  }
}

module.exports = { runCrawl, probe, SOURCES, readStatus, writeStatus, log };
