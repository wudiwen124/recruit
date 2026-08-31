'use strict';

const { isTechJob, readJson, clean } = require('./utils');

const COMPANY = '腾讯';
const BASE = 'https://join.qq.com';
const HEADERS = { Referer: `${BASE}/post.html`, Origin: BASE };
// 腾讯源每次最多返回 1000 条
const MAX_JOBS_TENCENT = 1000;

// 实习项目映射（URL query=p_104,p_20,p_2）：日常实习 / 青云计划-实习生 / 应届实习
const INTERN_MAPPING_IDS = [104, 20, 2];
const INTERN_PROJECT_RE = /(日常实习|青云计划-实习生|应届实习)/;
// 技术岗位族 fid（list 返回的 positionFamily）：2=技术类、7=AI/大模型专项
const TECH_FAMILIES = [2, 7];

/** 拉取实习项目映射，失败时回退到固定 [104,20,2]。 */
async function internMappingIds(client) {
  try {
    const res = await client.get(`${BASE}/api/v1/position/getProjectMapping`, HEADERS);
    const j = await readJson(res);
    const list = (j && j.data) || [];
    const ids = [];
    for (const g of list) {
      for (const sub of g.subProjectList || []) {
        if (INTERN_PROJECT_RE.test(sub.projectName || '')) ids.push(sub.mappingId);
      }
    }
    return ids.length ? Array.from(new Set(ids)) : INTERN_MAPPING_IDS;
  } catch (_) {
    return INTERN_MAPPING_IDS;
  }
}

/** 搜索实习技术岗。 */
async function searchInternJobs(client, mappingIds) {
  const jobs = [];
  const now = Date.now();
  for (let page = 1; page <= 10 && jobs.length < MAX_JOBS_TENCENT; page++) {
    const body = {
      projectIdList: [],
      projectMappingIdList: mappingIds,
      keyword: '',
      bgList: [],
      workCountryType: 0,
      workCityList: [],
      recruitCityList: [],
      positionFidList: [],
      pageIndex: page,
      pageSize: 100,
    };
    const res = await client.post(`${BASE}/api/v1/position/searchPosition`, body, HEADERS);
    const j = await readJson(res);
    if (!j || j.status !== 0 || !j.data) throw new Error(`腾讯校招接口异常: status=${j && j.status} message=${j && j.message}`);
    const list = j.data.positionList || [];
    for (const p of list) {
      const title = clean(p.positionTitle, 300);
      if (!title) continue;
      // 官方岗位族即类别依据：positionFamily 2=技术类、7=AI/大模型专项；
      // 个别缺失族值的岗位再用标题关键词兜底。
      const isTechFamily = TECH_FAMILIES.includes(p.positionFamily);
      if (!isTechFamily && !(p.positionFamily == null && isTechJob({ title }))) continue;
      const projectName = clean(p.projectName, 100);
      jobs.push({
        id: `${COMPANY}:${p.postId}`,
        company: COMPANY,
        title,
        category: p.positionFamily === 7 ? 'AI/大模型' : '技术',
        recruit_type: '实习',
        city: clean(p.workCities, 200),
        department: clean(p.bgs, 200),
        description: '',
        url: `${BASE}/post_detail.html?postid=${p.postId}`,
        published_at: now,
        published_at_missing: true, // join.qq.com 无发布时间，以首见时间归入 6 个月内
        talent: /青云/.test(projectName) ? 1 : 0,
      });
    }
    if (list.length < 100 || page * 100 >= (j.data.count || 0)) break;
    await client.sleep(500);
  }
  return jobs.slice(0, MAX_JOBS_TENCENT);
}

async function crawl({ client }) {
  try {
    const mappingIds = await internMappingIds(client);
    const jobs = await searchInternJobs(client, mappingIds);
    return { jobs, status: 'ok', message: '' };
  } catch (err) {
    return { jobs: [], status: 'error', message: err.message };
  }
}

module.exports = { name: COMPANY, maxJobs: MAX_JOBS_TENCENT, crawl, internMappingIds, searchInternJobs, INTERN_MAPPING_IDS, TECH_FAMILIES };
