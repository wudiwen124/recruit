'use strict';

const { isTechJob, readJson, clean, uniqueBy } = require('./utils');

const COMPANY = '阿里巴巴';
const ROOT = 'https://campus-talent.alibaba.com';
const CHANNEL = 'new_campus_group_official_site';
// 阿里源每次最多返回 2000 条（仅实习）
const MAX_JOBS_ALIBABA = 2000;

/** 通过打开校招列表页获取 XSRF-TOKEN / SESSION Cookie。 */
async function acquireCsrf(client) {
  const res = await client.rawGet(`${ROOT}/campus/position`, { Accept: 'text/html,application/xhtml+xml' });
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('阿里校招页面未返回 Cookie');
  const xsrfRaw = cookie.split('; ').map((c) => c.split('=')).find((kv) => kv[0] === 'XSRF-TOKEN');
  if (!xsrfRaw) throw new Error('阿里校招页面未返回 XSRF-TOKEN');
  const token = decodeURIComponent(xsrfRaw[1] || '');
  return { cookie, token };
}

async function listBatches(client, csrf) {
  const res = await client.post(
    `${ROOT}/searchCondition/listBatch`,
    { channel: CHANNEL, language: 'zh' },
    { Cookie: csrf.cookie, 'X-XSRF-TOKEN': csrf.token, Origin: ROOT, Referer: `${ROOT}/campus/position` }
  );
  const j = await readJson(res);
  if (!j || !j.success || !j.content) throw new Error('阿里 listBatch 失败');
  const sections = ['graduate', 'internship', 'topTalentPlan', ...(j.content.sequence || [])];
  const seen = new Set();
  const batches = [];
  for (const s of sections) {
    const list = j.content[s];
    if (!Array.isArray(list)) continue;
    for (const b of list) {
      if (typeof b.id !== 'number' || seen.has(b.id)) continue;
      seen.add(b.id);
      batches.push({ batchId: b.id, name: b.name || '', section: s, type: b.type || '' });
    }
  }
  return batches;
}

async function searchBatch(client, csrf, batch, maxJobs) {
  const rows = [];
  const pageSize = Math.min(100, maxJobs);
  for (let page = 1; rows.length < maxJobs && page <= 12; page++) {
    const res = await client.post(
      `${ROOT}/position/search`,
      {
        batchId: batch.batchId,
        pageIndex: page,
        pageSize,
        channel: CHANNEL,
        language: 'zh',
        subCategories: '11', // 技术类
      },
      { Cookie: csrf.cookie, 'X-XSRF-TOKEN': csrf.token, Origin: ROOT, Referer: `${ROOT}/campus/position` }
    );
    const j = await readJson(res);
    if (!j || !j.success) throw new Error(`阿里搜索失败: batch=${batch.batchId}`);
    const datas = (j.content && j.content.datas) || [];
    rows.push(...datas);
    if (datas.length < pageSize) break;
    await client.sleep(500);
  }
  return rows.slice(0, maxJobs);
}

function mapJob(item, batch = {}) {
  const id = String(item.id);
  const categoryType = item.categoryType || '';
  const recruitType = categoryType === 'graduate' || categoryType === 'freshman' ? '校招' : '实习';
  // 阿里人才专项：topTalentPlan 批次 / 星计划、顶尖人才等批次名
  const talentByBatch = batch.section === 'topTalentPlan' || /阿里星|星计划|顶尖|人才专项/.test(batch.name || '');
  const talentByTitle = /阿里星|星计划|顶尖/.test(item.name || '');
  return {
    id: `${COMPANY}:${id}`,
    company: COMPANY,
    title: clean(item.name, 300),
    category: clean(item.categoryName, 100),
    recruit_type: recruitType,
    city: Array.isArray(item.workLocations) ? item.workLocations.join('/') : '',
    department: Array.isArray(item.circleNames) && item.circleNames.length ? clean(item.circleNames[0], 200) : '',
    description: clean([item.description, item.requirement].filter(Boolean).join('\n'), 8000),
    url: `${ROOT}/campus/positionDetail?positionId=${id}`,
    published_at: item.modifyTime || item.publishTime,
    talent: talentByBatch || talentByTitle ? 1 : 0,
  };
}

async function crawl({ client }) {
  let campusJobs = [];
  let campusError = '';
  try {
    const csrf = await acquireCsrf(client);
    const batches = await listBatches(client, csrf);
    // 仅实习（internship）批次 + 人才专项（topTalentPlan/星计划）批次；
    // 人才专项里若有校招岗，最终按 recruit_type === '实习' 过滤掉
    const internBatches = batches.filter((b) => b.section === 'internship');
    const talentBatches = batches.filter((b) => b.section === 'topTalentPlan' || /阿里星|星计划|顶尖|人才专项/.test(b.name));
    const collect = async (list, cap) => {
      const out = [];
      for (const b of list.slice(0, 4)) {
        if (out.length >= cap) break;
        try {
          const rows = await searchBatch(client, csrf, b, cap - out.length);
          out.push(...rows.map((item) => ({ item, batch: b })));
        } catch (err) {
          campusError = (campusError ? campusError + '; ' : '') + `batch ${b.batchId}: ${err.message}`;
        }
      }
      return out;
    };
    const rows = [
      ...(await collect(internBatches, MAX_JOBS_ALIBABA)),
      // 人才专项额外配额，且最终截断时优先保留
      ...(await collect(talentBatches, Math.ceil(MAX_JOBS_ALIBABA / 2))),
    ];
    campusJobs = uniqueBy(rows.map(({ item, batch }) => mapJob(item, batch)), (j) => j.id)
      .filter((j) => j.published_at && j.recruit_type === '实习' && isTechJob({ category: j.category, title: j.title }))
      .sort((x, y) => (y.talent - x.talent) || ((y.published_at || 0) - (x.published_at || 0)))
      .slice(0, MAX_JOBS_ALIBABA);
  } catch (err) {
    campusError = err.message;
  }

  const message = campusError ? `部分失败: ${campusError}` : '';
  const status = campusError ? (campusJobs.length ? 'degraded' : 'error') : 'ok';
  return { jobs: campusJobs.slice(0, MAX_JOBS_ALIBABA), status, message, channels: { campus: campusError ? 'error' : 'ok' } };
}

module.exports = { name: COMPANY, maxJobs: MAX_JOBS_ALIBABA, crawl, mapJob, acquireCsrf, listBatches, searchBatch };
