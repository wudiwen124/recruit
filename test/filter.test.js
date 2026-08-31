'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isTechJob } = require('../src/crawler/utils');

test('源类别明确技术 -> 接受', () => {
  assert.equal(isTechJob({ category: '技术类', title: '随便什么' }), true);
  assert.equal(isTechJob({ category: '技术', title: '' }), true);
  assert.equal(isTechJob({ category: '工程类', title: '' }), true);
  assert.equal(isTechJob({ category: '算法类', title: '' }), true);
  assert.equal(isTechJob({ category: '研发', title: '' }), true);
  assert.equal(isTechJob({ category: '软件', title: '' }), true);
  assert.equal(isTechJob({ category: '测试类', title: '' }), true);
  assert.equal(isTechJob({ category: '运维类', title: '' }), true);
});

test('源类别明确非技术 -> 拒绝', () => {
  assert.equal(isTechJob({ category: '产品类', title: '算法产品专家' }), false);
  assert.equal(isTechJob({ category: '运营类', title: '' }), false);
  assert.equal(isTechJob({ category: '市场类', title: '' }), false);
  assert.equal(isTechJob({ category: '职能类', title: '后端开发' }), false);
  assert.equal(isTechJob({ category: '销售类', title: '' }), false);
  assert.equal(isTechJob({ category: '人力资源', title: '' }), false);
});

test('标题白名单正例', () => {
  const cases = [
    'Java开发工程师',
    '后端研发工程师',
    '前端开发工程师',
    '客户端开发工程师',
    '推荐算法工程师',
    '大模型算法工程师',
    '测试开发工程师',
    '运维工程师',
    '数据分析师',
    '信息安全工程师',
    '解决方案架构师',
    '嵌入式软件开发工程师',
    'SRE工程师',
    'AI Infra 研发工程师',
    '数据仓库工程师',
  ];
  for (const t of cases) {
    assert.equal(isTechJob({ title: t }), true, `应为技术岗: ${t}`);
  }
});

test('标题黑名单反例', () => {
  const cases = [
    '产品经理',
    '数据产品经理',
    '运营专员',
    '商家运营',
    '市场管培生',
    '销售经理',
    'HRBP',
    '人力资源专家',
    '财务分析师',
    '法务专员',
    '行政助理',
    '视觉设计师',
    '游戏策划',
    '营销策划',
    '客服专员',
    '内容运营',
  ];
  for (const t of cases) {
    assert.equal(isTechJob({ title: t }), false, `应排除非技术岗: ${t}`);
  }
});

test('黑名单优先于白名单', () => {
  assert.equal(isTechJob({ title: '数据运营专家' }), false);
  assert.equal(isTechJob({ title: '安全运营工程师' }), false);
  assert.equal(isTechJob({ title: 'AI产品经理' }), false);
});
