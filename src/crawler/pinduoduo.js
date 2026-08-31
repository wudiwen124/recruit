'use strict';

const { isTechJob, readJson, clean, uniqueBy } = require('./utils');
const { MAX_PAGES_PER_SOURCE, MAX_JOBS_PER_SOURCE } = require('../config');

const COMPANY = '拼多多';
const API_BASE = 'https://careers.pinduoduo.com/api/careers/api/recruit';
const HEADERS = { Referer: 'https://careers.pinduoduo.com/', Origin: 'https://careers.pinduoduo.com' };

/** 抓取单个列表接口（应届生 position/list、实习 position/train/list）。 */
async function fetchList(client, path, label) {
  const rows = [];
  for (let page = 1; page <= MAX_PAGES_PER_SOURCE; page++) {
    const res = await client.post(`${API_BASE}${path}`, { page, pageSize: 20 }, HEADERS);
    const j = await readJson(res);
    if (!j || !j.success) throw new Error(`拼多多接口异常: errorCode=${j && j.errorCode}`);
    const result = j.result || {};
    const list = result.list || [];
    rows.push(...list);
    const total = Number(result.total || 0);
    if (list.length < 20 || page * 20 >= total) break;
    await client.sleep(600);
  }
  return rows;
}

async function crawl({ client }) {
  const jobs = [];
  const errors = [];
  // 仅实习列表接口（校招已移除）
  try {
    const list = await fetchList(client, '/position/train/list', '实习');
    for (const p of list) {
      const title = clean(p.name, 300);
      const category = clean(p.jobName, 100);
      if (!title || !isTechJob({ category, title })) continue;
      if (!p.releaseTime) continue;
      jobs.push({
        id: `${COMPANY}:${p.id}`,
        company: COMPANY,
        title,
        category,
        recruit_type: '实习',
        city: clean(p.workLocationName, 200),
        department: '',
        description: clean(p.jobDuty, 8000),
        url: `https://careers.pinduoduo.com/intern/detail?positionId=${p.id}`,
        published_at: p.releaseTime,
      });
    }
  } catch (err) {
    errors.push(`实习: ${err.message}`);
  }
  const unique = uniqueBy(jobs, (j) => j.id);
  const message = errors.length
    ? `部分接口失败: ${errors.join('; ')}`
    : (unique.length ? '' : '接口正常，但当前仅发布管培生等非技术岗，暂无技术/研发岗位');
  return {
    jobs: unique.slice(0, MAX_JOBS_PER_SOURCE),
    status: errors.length && !unique.length ? 'error' : 'ok',
    message,
  };
}

module.exports = { name: COMPANY, crawl, fetchList };
