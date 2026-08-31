'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { periodOf, windowStart, parseCnDate, parseLocalDateTime, toTs, relTime } = require('../src/time');

const NOW = 1787000000000; // 固定基准时间（ms）
const H = 3600000;
const D = 24 * H;

test('滚动窗口边界：今日=近24小时', () => {
  assert.equal(periodOf(NOW - 1, NOW), 'today');
  assert.equal(periodOf(NOW - 23 * H, NOW), 'today');
  assert.equal(periodOf(NOW - 24 * H, NOW), 'today'); // 恰好 24h 仍属于今日
  assert.equal(periodOf(NOW - 24 * H - 1, NOW), 'week');
  assert.equal(periodOf(NOW - 25 * H, NOW), 'week');
});

test('滚动窗口边界：今周=近7天', () => {
  assert.equal(periodOf(NOW - 6 * D, NOW), 'week');
  assert.equal(periodOf(NOW - 7 * D, NOW), 'week'); // 恰好 7 天
  assert.equal(periodOf(NOW - 7 * D - 1, NOW), 'month');
  assert.equal(periodOf(NOW - 8 * D, NOW), 'month');
});

test('滚动窗口边界：今月=近30天', () => {
  assert.equal(periodOf(NOW - 29 * D, NOW), 'month');
  assert.equal(periodOf(NOW - 30 * D, NOW), 'month'); // 恰好 30 天
  assert.equal(periodOf(NOW - 30 * D - 1, NOW), null);
  assert.equal(periodOf(NOW - 31 * D, NOW), null);
});

test('windowStart 返回滚动起点', () => {
  assert.equal(windowStart('today', NOW), NOW - 24 * H);
  assert.equal(windowStart('week', NOW), NOW - 7 * D);
  assert.equal(windowStart('month', NOW), NOW - 30 * D);
  assert.equal(windowStart('bogus', NOW), 0);
});

test('中文日期解析', () => {
  const ts = parseCnDate('2026年08月29日');
  assert.ok(ts);
  const d = new Date(ts);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth() + 1, 8);
  assert.equal(d.getDate(), 29);
  assert.equal(parseCnDate('not a date'), null);
});

test('本地日期时间解析与统一 toTs', () => {
  const ts = parseLocalDateTime('2026-08-09 17:59:47');
  assert.ok(ts);
  assert.equal(new Date(ts).getHours(), 17);
  assert.equal(toTs(1787887593000), 1787887593000);
  assert.equal(toTs('1787887593000'), 1787887593000);
  assert.ok(toTs('2026-08-30T23:06:00.000+08:00'));
  assert.equal(toTs(null), null);
  assert.equal(toTs(''), null);
});

test('相对时间文案', () => {
  assert.equal(relTime(NOW - 30 * 1000, NOW), '刚刚');
  assert.equal(relTime(NOW - 5 * 60000, NOW), '5 分钟前');
  assert.equal(relTime(NOW - 3 * H, NOW), '3 小时前');
  assert.equal(relTime(NOW - 2 * D, NOW), '2 天前');
});
