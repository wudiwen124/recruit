'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { PUBLIC_DIR, PORT, CRAWL_INTERVAL_MS, COMPANIES, WINDOWS } = require('./config');
const { getDb, countActiveSince, queryJobs, countByWindow } = require('./db');
const { runCrawl, readStatus } = require('./crawler');
const { fmtTime } = require('./time');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

let crawling = false;
let lastCrawlPromise = null;

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

function apiJobs(req, res, url) {
  const params = url.searchParams;
  const period = ['today', 'week', 'month', 'all', 'missing'].includes(params.get('period') || '')
    ? params.get('period')
    : 'all';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(params.get('pageSize')) || 20));
  const result = queryJobs(getDb(), {
    period,
    company: params.get('company') || '',
    recruitType: params.get('recruitType') || '',
    talent: params.get('talent') || '',
    q: params.get('q') || '',
    city: params.get('city') || '',
    page,
    pageSize,
  });
  result.jobs = result.jobs.map((j) => ({ ...j, published_at_text: fmtTime(j.published_at) }));
  sendJson(res, 200, result);
}

function apiStats(_req, res) {
  const db = getDb();
  const status = readStatus() || { updatedAt: null, sources: {} };
  const windowCounts = countByWindow(db);
  const sixMonthsAgo = Date.now() - WINDOWS.halfyear;
  const sources = {};
  for (const company of COMPANIES) {
    const st = status.sources[company] || {};
    // 与“6个月内更新”Tab 一致：只统计近 6 个月发布的岗位
    const count = db.prepare('SELECT COUNT(*) AS c FROM jobs WHERE active = 1 AND company = ? AND published_at >= ?').get(company, sixMonthsAgo).c;
    sources[company] = {
      status: st.status || 'pending',
      error: st.error || '',
      message: st.message || '',
      channels: st.channels || undefined,
      count,
      crawledAt: st.crawledAt || null,
      tookMs: st.tookMs || 0,
    };
  }
  sendJson(res, 200, {
    updatedAt: status.updatedAt,
    updatedAtText: fmtTime(status.updatedAt),
    total: countActiveSince(db, Date.now() - WINDOWS.halfyear),
    windows: windowCounts,
    sources,
    companies: COMPANIES,
  });
}

function apiHealth(_req, res) {
  sendJson(res, 200, { ok: true, service: 'recruit-aggregator', now: Date.now() });
}

async function triggerCrawl(req, res) {
  if (crawling) {
    sendJson(res, 409, { ok: false, message: '正在抓取中，请稍后再试' });
    return;
  }
  crawling = true;
  sendJson(res, 202, { ok: true, message: '已开始抓取' });
  try {
    lastCrawlPromise = runCrawl();
    await lastCrawlPromise;
  } catch (err) {
    console.error('crawl error:', err);
  } finally {
    crawling = false;
  }
}

function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (p === '/api/jobs') return apiJobs(req, res, url);
  if (p === '/api/stats') return apiStats(req, res);
  if (p === '/api/health') return apiHealth(req, res);
  if (p === '/api/crawl' && req.method === 'POST') return triggerCrawl(req, res);
  if (p.startsWith('/api/')) {
    sendJson(res, 404, { ok: false, message: 'Not Found' });
    return;
  }
  return serveStatic(req, res, p);
}

const server = http.createServer(route);

/** 获取本机局域网 IPv4 地址列表。 */
function lanAddresses() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

async function main() {
  const db = getDb();
  void db;

  // 先监听端口，页面立即可用（使用已有数据），抓取放到后台执行。
  server.listen(PORT, () => {
    console.log('==================================================');
    console.log(`  招聘信息聚合网站已启动: http://localhost:${PORT}`);
    for (const ip of lanAddresses()) {
      console.log(`  局域网访问（同一网络的朋友）: http://${ip}:${PORT}`);
    }
    console.log(`  每 ${CRAWL_INTERVAL_MS / 3600000} 小时自动更新一次；可 POST /api/crawl 手动触发。`);
    console.log('==================================================');
  });

  setInterval(() => {
    if (!crawling) {
      crawling = true;
      runCrawl()
        .catch((err) => console.error('定时抓取失败:', err.message))
        .finally(() => { crawling = false; });
    }
  }, CRAWL_INTERVAL_MS);

  // 后台执行首次抓取（不阻塞网站启动）
  crawling = true;
  console.log('正在后台抓取岗位数据（约需 1-3 分钟），期间可先浏览已有数据…');
  lastCrawlPromise = runCrawl()
    .catch((err) => console.error('首次抓取失败（不影响网站运行）:', err.message))
    .finally(() => { crawling = false; });
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { server, main, route };
