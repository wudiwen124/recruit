'use strict';

const { isTechJob, readJson, clean, uniqueBy } = require('./utils');
const { parseLocalDateTime } = require('../time');
const { MAX_PAGES_PER_SOURCE, MAX_JOBS_PER_SOURCE } = require('../config');

const COMPANY = '快手';
const CAMPUS_HOST = 'https://campus.kuaishou.cn';

async function campusDictionary(client) {
  const res = await client.get(`${CAMPUS_HOST}/recruit/campus/e/api/v1/dictionary/batch?types=recruitSubProject,positionCategory`, {
    Referer: `${CAMPUS_HOST}/recruit/campus/e/`,
    Origin: CAMPUS_HOST,
  });
  const j = await readJson(res);
  if (!j || j.code !== 0) return { freshCode: '', internCode: '', catMap: new Map() };
  const result = j.result || {};
  const catMap = new Map();
  for (const c of result.positionCategory || []) catMap.set(c.code, c.name);
  // 挑选最新一届的应届 / 实习项目码
  const fresh = [];
  const intern = [];
  for (const s of result.recruitSubProject || []) {
    const m = /(20\d{2})\s*(应届生|实习生)/.exec(s.name || '');
    if (!m) continue;
    if (m[2] === '应届生') fresh.push({ code: s.code, year: Number(m[1]) });
    else intern.push({ code: s.code, year: Number(m[1]) });
  }
  const pick = (arr) => (arr.length ? arr.sort((a, b) => b.year - a.year)[0].code : '');
  return { freshCode: pick(fresh), internCode: pick(intern), catMap };
}

async function crawlCampus(client) {
  const { internCode, catMap } = await campusDictionary(client);
  const projects = [];
  // 仅保留实习（校招已移除）
  if (internCode) projects.push({ code: internCode, recruitType: '实习' });
  if (!projects.length) throw new Error('快手未找到实习项目码');

  const campusCap = MAX_JOBS_PER_SOURCE;
  const rows = [];
  for (const proj of projects) {
    if (rows.length >= campusCap) break;
    for (let page = 1; page <= MAX_PAGES_PER_SOURCE; page++) {
      if (rows.length >= campusCap) break;
      const res = await client.post(
        `${CAMPUS_HOST}/recruit/campus/e/api/v1/open/positions/simple`,
        { recruitSubProjectCodes: [proj.code], pageSize: 20, pageNum: page },
        { Referer: `${CAMPUS_HOST}/recruit/campus/e/`, Origin: CAMPUS_HOST }
      );
      const j = await readJson(res);
      if (!j || j.code !== 0) throw new Error(`快手校招接口异常: code=${j && j.code}`);
      const list = (j.result && j.result.list) || [];
      for (const it of list) rows.push({ item: it, recruitType: proj.recruitType });
      if (list.length < 20) break;
      await client.sleep(600);
    }
  }
  return uniqueBy(rows, (x) => String(x.item.id)).map(({ item, recruitType }) => {
    const category = catMap.get(item.positionCategoryCode) || '';
    const isTechCode = /^J10\d\d$/.test(item.positionCategoryCode || '');
    const techByCode = isTechCode || ['tech', 'algorithm', 'engeering'].includes(item.positionCategoryCode);
    if (!techByCode && !isTechJob({ category, title: item.name })) return null;
    const publishedAt = parseLocalDateTime(item.releaseTime) || item.updateTime;
    if (!publishedAt) return null;
    const city = Array.isArray(item.workLocationDicts) ? item.workLocationDicts.map((c) => c.name).filter(Boolean).join('/') : '';
    return {
      id: `${COMPANY}:campus:${item.id}`,
      company: COMPANY,
      title: clean(item.name, 300),
      category,
      recruit_type: recruitType,
      city,
      department: '',
      description: clean([item.description, item.positionDemand].filter(Boolean).join('\n'), 8000),
      url: `${CAMPUS_HOST}/recruit/campus/e#/campus/job-info/${item.id}`,
      published_at: publishedAt,
      // 快手人才专项：快Star（岗位名含【快Star】）
      talent: /快Star/.test(item.name || '') ? 1 : 0,
    };
  }).filter(Boolean).slice(0, campusCap);
}

async function crawl({ client }) {
  try {
    const campus = await crawlCampus(client);
    return { jobs: campus.slice(0, MAX_JOBS_PER_SOURCE), status: 'ok', message: '' };
  } catch (err) {
    return { jobs: [], status: 'error', message: `校招: ${err.message}` };
  }
}

module.exports = { name: COMPANY, crawl, crawlCampus, campusDictionary };
