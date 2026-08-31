'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDb, closeDb, upsertJobs, markInactive, cleanupOldJobs, deleteRecruitType, queryJobs, countAll, countByWindow } = require('../src/db');

const NOW = Date.now();
const H = 3600000;
const D = 24 * H;

function makeJob(id, overrides = {}) {
  return {
    id, company: '测试公司', title: 'Java开发工程师', category: '研发',
    recruit_type: '社招', city: '北京', department: '基础平台', description: '',
    url: 'https://example.com/' + id, published_at: NOW - 1000,
    ...overrides,
  };
}

test('upsert 幂等：同 id 重复插入只保留一行', () => {
  const db = openDb(':memory:');
  upsertJobs(db, [makeJob('a:1')], NOW);
  upsertJobs(db, [makeJob('a:1', { title: '更新后的标题' })], NOW + 1000);
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get('a:1');
  assert.equal(row.title, '更新后的标题');
  assert.equal(countAll(db), 1);
  closeDb();
});


test('published_at_missing：后续抓取保留首次入库时间，不挤进今日更新', () => {
  const db = openDb(':memory:');
  const first = Date.now() - 10 * D;
  upsertJobs(db, [makeJob('m:1', { published_at: first, published_at_missing: true })], first);
  // 第二次抓取传入不同时间，应保留首次值
  upsertJobs(db, [makeJob('m:1', { published_at: first + 1000, published_at_missing: true })], first + 1000);
  const row = db.prepare('SELECT published_at FROM jobs WHERE id = ?').get('m:1');
  assert.equal(row.published_at, first);
  // 普通岗位仍以新值覆盖
  upsertJobs(db, [makeJob('m:2', { published_at: first })], first);
  upsertJobs(db, [makeJob('m:2', { published_at: first + 1000 })], first + 1000);
  assert.equal(db.prepare('SELECT published_at FROM jobs WHERE id = ?').get('m:2').published_at, first + 1000);
  closeDb();
});

test('talent 字段写入与筛选', () => {
  const db = openDb(':memory:');
  upsertJobs(db, [
    makeJob('tl:1', { talent: 1 }),
    makeJob('tl:2', { talent: 0 }),
  ], NOW);
  assert.equal(queryJobs(db, { talent: '1', now: NOW }).total, 1);
  assert.equal(queryJobs(db, { talent: '1', now: NOW }).jobs[0].talent, 1);
  assert.equal(queryJobs(db, { talent: '0', now: NOW }).total, 1);
  assert.equal(queryJobs(db, { talent: '', now: NOW }).total, 2);
  // upsert 后保留 talent
  upsertJobs(db, [makeJob('tl:1', { talent: 0 })], NOW);
  assert.equal(queryJobs(db, { talent: '1', now: NOW }).total, 0);
  closeDb();
});

test('deleteRecruitType 删除指定招聘类型记录', () => {
  const db = openDb(':memory:');
  upsertJobs(db, [makeJob('d:1', { recruit_type: '社招' }), makeJob('d:2', { recruit_type: '校招' })], NOW);
  const removed = deleteRecruitType(db, '社招');
  assert.equal(removed, 1);
  assert.equal(countAll(db), 1);
  assert.equal(db.prepare('SELECT recruit_type FROM jobs WHERE id = ?').get('d:2').recruit_type, '校招');
  closeDb();
});

test('markInactive：本次未出现的旧岗被下线', () => {
  const db = openDb(':memory:');
  upsertJobs(db, [makeJob('a:1'), makeJob('a:2')], NOW);
  assert.equal(countAll(db), 2);
  markInactive(db, '测试公司', ['a:1'], NOW + 60000);
  assert.equal(countAll(db), 1);
  const active1 = db.prepare('SELECT active FROM jobs WHERE id = ?').get('a:1').active;
  const active2 = db.prepare('SELECT active FROM jobs WHERE id = ?').get('a:2').active;
  assert.equal(active1, 1);
  assert.equal(active2, 0);
  closeDb();
});

test('markInactive 空列表 -> 全部下线', () => {
  const db = openDb(':memory:');
  upsertJobs(db, [makeJob('a:1'), makeJob('a:2')], NOW);
  markInactive(db, '测试公司', [], NOW);
  assert.equal(countAll(db), 0);
  closeDb();
});

test('markInactive 大批量（500 条）不会误下线本次抓到的岗位', () => {
  const db = openDb(':memory:');
  const jobs = Array.from({ length: 500 }, (_, i) =>
    makeJob('big:' + i, { title: '开发工程师' + i }));
  upsertJobs(db, jobs, NOW);
  markInactive(db, '测试公司', jobs.map((j) => j.id), NOW);
  assert.equal(countAll(db), 500);
  // 再补一条旧岗，应被下线
  upsertJobs(db, [makeJob('big:old', { published_at: NOW - 10 * D })], NOW);
  markInactive(db, '测试公司', jobs.map((j) => j.id), NOW);
  assert.equal(countAll(db), 500);
  assert.equal(db.prepare('SELECT active FROM jobs WHERE id = ?').get('big:old').active, 0);
  closeDb();
});

test('cleanupOldJobs 清理 90 天前非活跃记录', () => {
  const db = openDb(':memory:');
  const old = NOW - 100 * D;
  upsertJobs(db, [makeJob('old:1', { published_at: old, last_seen_at: old })], NOW);
  // 手动把该岗位下线，并将 last_seen_at 改老
  db.prepare('UPDATE jobs SET active = 0, last_seen_at = ? WHERE id = ?').run(old, 'old:1');
  upsertJobs(db, [makeJob('recent:1', { published_at: NOW - 1 * D })], NOW);
  const removed = cleanupOldJobs(db, NOW);
  assert.equal(removed, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM jobs WHERE id = ?').get('recent:1').c, 1);
  closeDb();
});

test('queryJobs 支持窗口/公司/类型/关键词/城市/分页', () => {
  const db = openDb(':memory:');
  upsertJobs(db, [
    makeJob('a:1', { published_at: NOW - 2 * H, city: '北京' }),
    makeJob('a:2', { published_at: NOW - 3 * D, recruit_type: '校招', city: '上海' }),
    makeJob('a:3', { published_at: NOW - 20 * D, city: '杭州' }),
    makeJob('a:4', { published_at: NOW - 200 * D, city: '广州' }), // 超过 6 个月，all 应排除
  ], NOW);
  assert.equal(queryJobs(db, { period: 'today', now: NOW }).total, 1);
  assert.equal(queryJobs(db, { period: 'week', now: NOW }).total, 2);
  assert.equal(queryJobs(db, { period: 'month', now: NOW }).total, 3);
  assert.equal(queryJobs(db, { period: 'all', now: NOW }).total, 3); // all = 近 6 个月
  assert.equal(queryJobs(db, { period: '', now: NOW }).total, 4);
  assert.equal(queryJobs(db, { company: '测试公司', now: NOW }).total, 4);
  assert.equal(queryJobs(db, { recruitType: '校招', now: NOW }).total, 1);
  assert.equal(queryJobs(db, { q: 'Java', now: NOW }).total, 4);
  assert.equal(queryJobs(db, { city: '上海', now: NOW }).total, 1);
  const p2 = queryJobs(db, { period: 'month', page: 2, pageSize: 2, now: NOW });
  assert.equal(p2.jobs.length, 1);
  assert.equal(p2.total, 3);
  // 按发布时间倒序
  const all = queryJobs(db, { period: 'month', pageSize: 10, now: NOW });
  assert.ok(all.jobs[0].published_at >= all.jobs[all.jobs.length - 1].published_at);
  assert.deepEqual(Object.keys(countByWindow(db, NOW)), ['today', 'week', 'month', 'halfyear', 'missing']);
  closeDb();
});

test('queryJobs all 窗口边界：179 天在内、181 天在外', () => {
  const db = openDb(':memory:');
  upsertJobs(db, [
    makeJob('b:in', { published_at: NOW - 179 * D }),
    makeJob('b:out', { published_at: NOW - 181 * D }),
  ], NOW);
  const r = queryJobs(db, { period: 'all', now: NOW, pageSize: 10 });
  assert.deepEqual(r.jobs.map((j) => j.id), ['b:in']);
  assert.equal(r.total, 1);
  closeDb();
});

test('无时间标注岗位：只出现在“无时间标注”与“6个月内更新”，不进今日/今周/今月', () => {
  const db = openDb(':memory:');
  upsertJobs(db, [
    makeJob('x:1', { published_at: NOW - 2 * H, published_at_missing: true }),
    makeJob('x:2', { published_at: NOW - 2 * H, published_at_missing: false }),
  ], NOW);
  assert.equal(queryJobs(db, { period: 'missing', now: NOW }).total, 1);
  assert.equal(queryJobs(db, { period: 'missing', now: NOW }).jobs[0].id, 'x:1');
  assert.equal(queryJobs(db, { period: 'all', now: NOW }).total, 2);
  assert.equal(queryJobs(db, { period: 'today', now: NOW }).total, 1);
  assert.equal(queryJobs(db, { period: 'week', now: NOW }).total, 1);
  assert.equal(queryJobs(db, { period: 'month', now: NOW }).total, 1);
  const counts = countByWindow(db, NOW);
  assert.equal(counts.today, 1);
  assert.equal(counts.week, 1);
  assert.equal(counts.month, 1);
  assert.equal(counts.halfyear, 2);
  assert.equal(counts.missing, 1);
  closeDb();
});
