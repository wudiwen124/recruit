'use strict';

const { isTechJob, readJson, clean, uniqueBy } = require('./utils');
const { MAX_PAGES_PER_SOURCE, MAX_JOBS_PER_SOURCE } = require('../config');

const COMPANY = '美团';
const API = 'https://zhaopin.meituan.com/api/official/job/getJobList';
const HEADERS = {
  Referer: 'https://zhaopin.meituan.com/web/position?jobType=3',
  Origin: 'https://zhaopin.meituan.com',
};

async function fetchJobType(client, code, cap = MAX_JOBS_PER_SOURCE) {
  const rows = [];
  for (let page = 1; page <= MAX_PAGES_PER_SOURCE && rows.length < cap; page++) {
    const body = {
      page: { pageNo: page, pageSize: 100 },
      jobShareType: '1',
      keywords: '',
      cityList: [],
      department: [],
      jobType: [{ code, subCode: [] }],
    };
    const res = await client.post(API, body, HEADERS);
    const j = await readJson(res);
    // 注意：美团接口 status === 1 才是成功
    if (!j || j.status !== 1 || !j.data) throw new Error(`美团接口异常: status=${j && j.status} message=${j && j.message}`);
    const list = j.data.list || [];
    rows.push(...list);
    const total = (j.data.page && j.data.page.totalCount) || 0;
    if (list.length < 100 || page * 100 >= total) break;
    await client.sleep(600);
  }
  return rows.slice(0, cap);
}

function mapJob(item, code) {
  const id = String(item.jobUnionId);
  return {
    id: `${COMPANY}:${id}`,
    company: COMPANY,
    title: clean(item.name, 300),
    category: clean(item.jobFamilyGroup || item.jobFamily, 100),
    recruit_type: '实习',
    city: Array.isArray(item.cityList) ? item.cityList.map((c) => c.name).filter(Boolean).join('/') : '',
    department: Array.isArray(item.department) ? item.department.map((d) => d.name).filter(Boolean).join('/') : '',
    description: clean(item.jobDuty, 8000),
    url: `https://zhaopin.meituan.com/web/position/detail?jobUnionId=${id}&jobShareType=1&highlightType=campus`,
    published_at: item.firstPostTime || item.refreshTime,
    // 美团北斗计划：岗位名以【北斗】开头（jobSpecialCode=3）
    talent: /北斗/.test(item.name || '') ? 1 : 0,
  };
}

async function crawl({ client }) {
  const jobs = [];
  const errors = [];
  try {
    const items = await fetchJobType(client, '2', MAX_JOBS_PER_SOURCE);
    const mapped = uniqueBy(items.map((it) => mapJob(it, '2')), (j) => j.id)
      .filter((j) => j.published_at && isTechJob({ category: j.category, title: j.title }));
    jobs.push(...mapped);
  } catch (err) {
    errors.push(`实习: ${err.message}`);
  }
  const status = errors.length ? (jobs.length ? 'degraded' : 'error') : 'ok';
  return { jobs: jobs.slice(0, MAX_JOBS_PER_SOURCE), status, message: errors.length ? errors.join('; ') : '' };
}

module.exports = { name: COMPANY, crawl, mapJob, fetchJobType };
