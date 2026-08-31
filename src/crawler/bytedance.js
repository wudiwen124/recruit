'use strict';

const { isTechJob, readJson, uniqueBy, clean } = require('./utils');
const { MAX_PAGES_PER_SOURCE } = require('../config');

const COMPANY = '字节跳动';
const HOST = 'https://jobs.bytedance.com';
const CATEGORY_ID = '6704215862603155720'; // 研发（技术大类）
// 实习招聘类型 id（recruit_type.name === '实习'），字节 campus 每源上限 3000 条
const INTERN_RECRUITMENT_ID = '202';
const MAX_JOBS_BYTEDANCE = 3000;
const MAX_PAGES_BYTEDANCE = 40;

/** 获取 CSRF token 与 Cookie。 */
async function acquireCsrf(client, channel) {
  const pathname = channel === 'society' ? 'experienced' : 'campus';
  const headers = {
    'website-path': channel,
    'Portal-Channel': 'office',
    'Portal-Platform': 'pc',
    Origin: HOST,
    Referer: `${HOST}/${pathname}/position`,
    'x-csrf-token': 'undefined',
  };
  const res = await client.post(`${HOST}/api/v1/csrf/token`, { portal_entrance: 1 }, headers);
  const j = await readJson(res);
  if (!j || j.code !== 0 || !j.data || !j.data.token) {
    throw new Error(`字节 CSRF 失败: ${j && j.message ? j.message : '未知错误'}`);
  }
  const cookies = res.headers.getSetCookie
    ? res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    : '';
  return { token: j.data.token, cookie: cookies };
}

/** 拉取校招渠道的全部岗位。 */
async function fetchChannel(client, channel, portalType) {
  const channelCap = MAX_JOBS_BYTEDANCE;
  const pathname = channel === 'society' ? 'experienced' : 'campus';
  const searchHeaders = (token, cookie) => ({
    'website-path': channel,
    'Portal-Channel': 'office',
    'Portal-Platform': 'pc',
    Origin: HOST,
    Referer: `${HOST}/${pathname}/position`,
    'x-csrf-token': token,
    Cookie: cookie,
  });

  const run = async (token, cookie) => {
    const out = [];
    for (let page = 0; page < MAX_PAGES_BYTEDANCE && out.length < channelCap; page++) {
      const body = {
        keyword: '',
        limit: 100,
        offset: page * 100,
        job_category_id_list: [CATEGORY_ID],
        tag_id_list: [],
        location_code_list: [],
        subject_id_list: [],
        recruitment_id_list: [INTERN_RECRUITMENT_ID], // 仅实习
        portal_type: portalType,
        job_function_id_list: [],
        storefront_id_list: [],
        portal_entrance: 1,
      };
      const res = await client.post(`${HOST}/api/v1/search/job/posts`, body, searchHeaders(token, cookie));
      const j = await readJson(res);
      if (j && j.code === 405) {
        const e = new Error('NEED_REFRESH');
        e.needRefresh = true;
        throw e;
      }
      if (!j || j.code !== 0) {
        throw new Error(`字节搜索失败: ${j && j.message ? j.message : `code=${j && j.code}`}`);
      }
      const list = j.data && j.data.job_post_list ? j.data.job_post_list : [];
      out.push(...list);
      if (list.length < 100 || out.length >= channelCap) break;
      await client.sleep(600);
    }
    return out;
  };

  try {
    const { token, cookie } = await acquireCsrf(client, channel);
    return await run(token, cookie);
  } catch (err) {
    if (err.needRefresh) {
      const { token, cookie } = await acquireCsrf(client, channel);
      return await run(token, cookie);
    }
    throw err;
  }
}

/** 提取招聘项目名（job_subject.name 可能是字符串或 {zh_cn,...}）。 */
function subjectName(item) {
  const s = item.job_subject && item.job_subject.name;
  if (!s) return '';
  if (typeof s === 'string') return s;
  return s.zh_cn || s.i18n || '';
}

function mapJob(item) {
  const recruitName = item.recruit_type ? item.recruit_type.name : '';
  const category = (item.job_category && (item.job_category.parent || {}).name) || (item.job_category && item.job_category.name) || '';
  const city = (item.city_info && item.city_info.name) || (item.city_list && item.city_list[0] && item.city_list[0].name) || '';
  const id = String(item.id);
  const sub = subjectName(item);
  return {
    id: `${COMPANY}:${id}`,
    company: COMPANY,
    title: clean(item.title, 300),
    category,
    recruit_type: recruitName || '实习',
    city,
    department: sub ? clean(sub, 200) : '',
    description: clean(item.description || item.requirement, 8000),
    url: `${HOST}/campus/position/${id}/detail`,
    published_at: item.publish_time,
    // 人才专项：Seed 大模型 / 前沿技术领域 / 各人才招聘项目
    talent: /Seed|前沿技术领域|人才/.test(sub) ? 1 : 0,
  };
}

async function crawl({ client }) {
  try {
    const items = await fetchChannel(client, 'campus', 3);
    const jobs = uniqueBy(items.map((it) => mapJob(it)), (j) => j.id)
      .filter((j) => j.published_at && j.recruit_type === '实习' && isTechJob({ category: j.category, title: j.title }));
    return { jobs: jobs.slice(0, MAX_JOBS_BYTEDANCE), status: 'ok', message: '' };
  } catch (err) {
    return { jobs: [], status: 'error', message: `实习: ${err.message}` };
  }
}

module.exports = { name: COMPANY, maxJobs: MAX_JOBS_BYTEDANCE, crawl, mapJob, subjectName, fetchChannel, acquireCsrf };
