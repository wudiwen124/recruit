'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('../src/crawler/utils');

const bytedance = require('../src/crawler/bytedance');
const tencent = require('../src/crawler/tencent');
const alibaba = require('../src/crawler/alibaba');
const pinduoduo = require('../src/crawler/pinduoduo');
const meituan = require('../src/crawler/meituan');
const kuaishou = require('../src/crawler/kuaishou');

/** 构造按 URL 关键字路由的 mock fetch。 */
function mockFetch(routes) {
  const calls = [];
  return {
    calls,
    fn: async (url, options = {}) => {
      const u = String(url);
      const method = (options.method || 'GET').toUpperCase();
      calls.push({ url: u, method, options });
      for (const [needle, handler] of routes) {
        if (u.includes(needle)) {
          return handler({ url: u, method, options, calls });
        }
      }
      throw new Error(`mock 未覆盖: ${method} ${u}`);
    },
  };
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers });

test('字节跳动：仅实习 + Seed人才专项识别 + 上限3000', async () => {
  const m = mockFetch([
    ['/api/v1/csrf/token', () => json({ code: 0, data: { token: 'TKN' } }, 200, { 'set-cookie': 'atsx-csrf-token=abc123; Path=/' })],
    ['/api/v1/search/job/posts', ({ options }) => {
      const body = JSON.parse(options.body);
      assert.equal(body.portal_type, 3);
      assert.deepEqual(body.recruitment_id_list, ['202']); // 仅实习
      assert.equal(body.limit, 100);
      return json({
        code: 0,
        data: {
          count: 2,
          job_post_list: [
            {
              id: 'b1',
              title: '前端开发实习生',
              job_category: { name: '前端', parent: { name: '研发' } },
              city_info: { name: '深圳' },
              recruit_type: { name: '实习', parent: { name: '校招' } },
              job_subject: { name: { zh_cn: 'Seed大模型人才实习招聘', i18n: 'Seed大模型人才实习招聘' } },
              publish_time: 1787000000000,
              description: '岗位描述',
            },
            {
              id: 'b2',
              title: '后端开发实习生',
              job_category: { name: '后端', parent: { name: '研发' } },
              city_info: { name: '北京' },
              recruit_type: { name: '实习', parent: { name: '校招' } },
              job_subject: { name: { zh_cn: '日常实习', i18n: '日常实习' } },
              publish_time: 1787000000000,
              description: '',
            },
          ],
        },
      });
    }],
  ]);
  const result = await bytedance.crawl({ client: createClient({ fetchFn: m.fn, minIntervalMs: 0 }) });
  assert.equal(result.status, 'ok');
  assert.equal(result.jobs.length, 2);
  const seed = result.jobs.find((x) => x.id === '字节跳动:b1');
  assert.equal(seed.recruit_type, '实习');
  assert.equal(seed.department, 'Seed大模型人才实习招聘');
  assert.equal(seed.talent, 1);
  assert.equal(seed.url, 'https://jobs.bytedance.com/campus/position/b1/detail');
  const daily = result.jobs.find((x) => x.id === '字节跳动:b2');
  assert.equal(daily.talent, 0);
  assert.equal(bytedance.maxJobs, 3000);
});

test('腾讯：join.qq.com 实习项目映射 + positionFamily 技术族筛选 + 缺失时间归入6个月', async () => {
  const before = Date.now();
  const bodies = [];
  const m = mockFetch([
    ['/api/v1/position/getProjectMapping', () => json({
      status: 0,
      data: [
        { id: 2, recruitTypeName: '实习生', subProjectList: [
          { mappingId: 2, projectName: '应届实习' },
          { mappingId: 104, projectName: '日常实习' },
        ] },
        { id: 3, recruitTypeName: '人才专项', subProjectList: [
          { mappingId: 20, projectName: '青云计划-实习生' },
        ] },
      ],
    })],
    ['/api/v1/position/searchPosition', ({ options }) => {
      bodies.push(JSON.parse(options.body));
      return json({
        status: 0,
        data: {
          count: 2,
          positionList: [
            { postId: 't1', positionTitle: '后台开发', positionFamily: 2, workCities: '深圳总部 北京', bgs: 'CDG IEG', projectName: '应届实习' },
            { postId: 't2', positionTitle: '产品经理', positionFamily: 3, workCities: '深圳', bgs: 'PCG', projectName: '日常实习' },
            { postId: 't3', positionTitle: '大模型算法实习生', positionFamily: 7, workCities: '北京', bgs: 'TEG', projectName: '青云计划-实习生' },
          ],
        },
      });
    }],
  ]);
  const result = await tencent.crawl({ client: createClient({ fetchFn: m.fn, minIntervalMs: 0 }) });
  // 技术族过滤：产品经理(非技术族)被排除；青云为人才专项
  assert.equal(result.jobs.length, 2);
  const body = bodies[0];
  assert.ok(body.projectMappingIdList.includes(104) && body.projectMappingIdList.includes(20) && body.projectMappingIdList.includes(2));
  // 官方岗位族过滤：接口 positionFidList 无效，按返回的 positionFamily(2=技术/7=AI) 过滤
  const j = result.jobs.find((x) => x.id === '腾讯:t1');
  assert.equal(j.company, '腾讯');
  assert.equal(j.title, '后台开发');
  assert.equal(j.recruit_type, '实习');
  assert.equal(j.city, '深圳总部 北京');
  assert.equal(j.url, 'https://join.qq.com/post_detail.html?postid=t1');
  assert.equal(j.published_at_missing, true);
  assert.ok(j.published_at >= before);
  const qingyun = result.jobs.find((x) => x.id === '腾讯:t3');
  assert.equal(qingyun.talent, 1);
  assert.equal(qingyun.category, 'AI/大模型');
  assert.equal(tencent.maxJobs, 1000);
});

test('阿里：仅实习 + 人才专项识别 + 上限2000（校招批次不再请求）', async () => {
  let listBatchHit = false;
  const requestedBatchIds = [];
  const m = mockFetch([
    ['/campus/position', () => new Response('<!doctype html>', {
      status: 200,
      headers: { 'set-cookie': 'XSRF-TOKEN=abc-123; Path=/; SESSION=SES1; Path=/' },
    })],
    ['/searchCondition/listBatch', () => {
      listBatchHit = true;
      return json({ success: true, content: {
        graduate: [{ id: 333, name: '阿里巴巴2027届应届生', type: 'graduate' }],
        internship: [{ id: 111, name: '阿里巴巴2027届实习生', type: 'internship' }],
        topTalentPlan: [{ id: 222, name: '阿里星计划', type: 'star' }],
        sequence: ['graduate', 'internship', 'topTalentPlan'],
      } });
    }],
    ['/position/search', ({ options }) => {
      const body = JSON.parse(options.body);
      requestedBatchIds.push(body.batchId);
      const star = body.batchId === 222;
      return json({
        success: true,
        content: {
          datas: star ? [
            {
              id: 199907620014,
              name: '阿里星-大模型算法实习生',
              categoryName: '技术类',
              categoryType: 'internship',
              batchName: '阿里星计划',
              circleNames: ['达摩院'],
              workLocations: ['杭州', '北京'],
              modifyTime: 1787566228000,
              description: '职责',
              requirement: '要求',
            },
            {
              id: 199907620015,
              name: '阿里星-应届算法工程师',
              categoryName: '技术类',
              categoryType: 'freshman',
              batchName: '阿里星计划',
              circleNames: ['达摩院'],
              workLocations: ['杭州'],
              modifyTime: 1787566228000,
              description: '',
              requirement: '',
            },
          ] : [
            {
              id: 199907620013,
              name: 'AI应用研发实习生',
              categoryName: '技术类',
              categoryType: 'internship',
              batchName: '阿里巴巴2027届实习生',
              circleNames: ['淘天集团'],
              workLocations: ['杭州', '北京'],
              modifyTime: 1787566228000,
              description: '职责',
              requirement: '要求',
            },
          ],
        },
      });
    }],
  ]);
  const result = await alibaba.crawl({ client: createClient({ fetchFn: m.fn, minIntervalMs: 0 }) });
  assert.equal(listBatchHit, true);
  assert.equal(result.status, 'ok');
  // 实习 + 人才专项共 2 条；人才专项里的应届校招岗（freshman）被过滤
  assert.equal(result.jobs.length, 2);
  assert.ok(requestedBatchIds.includes(111));
  assert.ok(requestedBatchIds.includes(222));
  assert.ok(!requestedBatchIds.includes(333)); // 校招批次不再请求
  const j = result.jobs.find((x) => x.id === '阿里巴巴:199907620013');
  assert.equal(j.company, '阿里巴巴');
  assert.equal(j.recruit_type, '实习');
  assert.equal(j.city, '杭州/北京');
  assert.equal(j.department, '淘天集团');
  assert.equal(j.published_at, 1787566228000);
  assert.equal(j.talent, 0);
  assert.ok(j.url.includes('/campus/position/199907620013'));
  const star = result.jobs.find((x) => x.id === '阿里巴巴:199907620014');
  assert.equal(star.title, '阿里星-大模型算法实习生');
  assert.equal(star.recruit_type, '实习');
  assert.equal(star.talent, 1);
  assert.equal(alibaba.maxJobs, 2000);
});

test('拼多多：仅实习列表接口 + 技术过滤', async () => {
  const m = mockFetch([
    ['/position/train/list', () => json({
      success: true,
      errorCode: 1000000,
      result: { total: 0, list: [] },
    })],
    ['/position/list', () => json({
      success: true,
      errorCode: 1000000,
      result: {
        total: 2,
        list: [
          { id: 'p1', name: 'Java开发工程师', workLocationName: '上海', jobName: '技术', releaseTime: 1787000000000, jobDuty: '', recruitTypeName: '校招' },
          { id: 'p2', name: '商家运营', workLocationName: '上海', jobName: '运营', releaseTime: 1787000000000, jobDuty: '', recruitTypeName: '校招' },
        ],
      },
    })],
  ]);
  const result = await pinduoduo.crawl({ client: createClient({ fetchFn: m.fn, minIntervalMs: 0 }) });
  assert.equal(result.jobs.length, 0); // 实习接口为空，且不再请求应届生接口
});

test('美团：仅实习 + 北斗人才专项识别（校招已移除）', async () => {
  const bodies = [];
  const m = mockFetch([
    ['/getJobList', ({ options }) => {
      bodies.push(JSON.parse(options.body));
      return json({
        status: 1,
        message: '成功',
        data: {
          list: [{
            jobUnionId: 'm1',
            name: '【北斗】大模型数据算法工程师',
            jobFamily: '技术类',
            jobFamilyGroup: '算法',
            cityList: [{ name: '北京市' }],
            department: [{ name: '核心本地商业-业务研发平台' }],
            firstPostTime: null,
            refreshTime: 1788088506000,
            jobDuty: '',
          }],
          page: { totalCount: 1 },
        },
      });
    }],
  ]);
  const result = await meituan.crawl({ client: createClient({ fetchFn: m.fn, minIntervalMs: 0 }) });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].jobType[0].code, '2'); // 仅实习
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].recruit_type, '实习');
  assert.equal(result.jobs[0].published_at, 1788088506000);
  assert.equal(result.jobs[0].talent, 1); // 北斗计划
  assert.ok(result.jobs[0].url.includes('highlightType=campus'));
});

test('快手：仅实习项目 + 快Star人才专项识别（校招已移除）', async () => {
  const campusDict = {
    code: 0,
    result: {
      recruitSubProject: [
        { code: '20271772783534', name: '2027实习生' },
        { code: '20271779425607', name: '2027应届生' },
      ],
      positionCategory: [{ code: 'tech', name: '技术类' }],
    },
  };
  const bodies = [];
  const m = mockFetch([
    ['campus.kuaishou.cn/recruit/campus/e/api/v1/dictionary', () => json(campusDict)],
    ['campus.kuaishou.cn/recruit/campus/e/api/v1/open/positions/simple', ({ options }) => {
      bodies.push(JSON.parse(options.body));
      return json({
        code: 0,
        result: {
          list: [
            {
              id: 13101,
              name: '推荐大模型算法工程师',
              positionCategoryCode: 'J1005',
              releaseTime: '2026-08-09 17:59:47',
              updateTime: 1787887593000,
              workLocationDicts: [{ name: '北京', code: 'beijing' }],
              description: '',
              positionDemand: '',
            },
            {
              id: 13102,
              name: '【快Star实习】多模态大模型数据处理算法工程师',
              positionCategoryCode: 'J1001',
              releaseTime: '2026-08-09 17:59:47',
              updateTime: 1787887593000,
              workLocationDicts: [{ name: '北京', code: 'beijing' }],
              description: '',
              positionDemand: '',
            },
          ],
        },
      });
    }],
  ]);
  const result = await kuaishou.crawl({ client: createClient({ fetchFn: m.fn, minIntervalMs: 0 }) });
  assert.equal(result.status, 'ok');
  assert.equal(bodies.length, 1);
  // 仅请求最新一届实习项目码，不再请求应届项目
  assert.deepEqual(bodies[0].recruitSubProjectCodes, ['20271772783534']);
  assert.equal(result.jobs.length, 2);
  const campus = result.jobs.find((x) => x.id === '快手:campus:13101');
  assert.equal(campus.recruit_type, '实习');
  assert.equal(campus.city, '北京');
  assert.equal(campus.talent, 0);
  assert.ok(campus.url.includes('campus/job-info/13101'));
  const star = result.jobs.find((x) => x.id === '快手:campus:13102');
  assert.equal(star.talent, 1); // 快Star
  assert.equal(star.recruit_type, '实习');
});
