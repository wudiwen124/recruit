'use strict';

const { MAX_PAGES_PER_SOURCE, MAX_JOBS_PER_SOURCE } = require('../config');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 创建带全局限速、超时与退避重试的请求客户端。
 * 返回 { get, post, rawGet, sleep }。get/post 已带浏览器 UA 与 zh-CN 头。
 */
function createClient({ minIntervalMs = 1000, timeoutMs = 15000, retries = 2, fetchFn = fetch } = {}) {
  let lastTs = 0;

  async function throttle() {
    const now = Date.now();
    const wait = Math.max(0, lastTs + minIntervalMs - now);
    if (wait > 0) await sleep(wait);
    lastTs = Date.now();
  }

  async function request(url, options, attempt = 0) {
    await throttle();
    try {
      const res = await fetchFn(url, {
        ...options,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 500 && attempt < retries) {
        await sleep(500 * (attempt + 1));
        return request(url, options, attempt + 1);
      }
      return res;
    } catch (err) {
      if (attempt < retries) {
        await sleep(700 * (attempt + 1));
        return request(url, options, attempt + 1);
      }
      throw err;
    }
  }

  const baseHeaders = (headers) => ({
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    ...headers,
  });

  return {
    sleep,
    /** 原始 GET（不强制 JSON Accept 头），用于抓取 Cookie 等场景。 */
    rawGet(url, headers = {}) {
      return request(url, { method: 'GET', headers: baseHeaders(headers) });
    },
    get(url, headers = {}) {
      return request(url, { method: 'GET', headers: baseHeaders(headers) });
    },
    post(url, body, headers = {}) {
      return request(url, {
        method: 'POST',
        headers: baseHeaders({ 'Content-Type': 'application/json', ...headers }),
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    },
  };
}

/** 技术岗来源类别正向词（命中即视为技术岗，除非类别同时含明显非技术词）。 */
const CATEGORY_TECH_RE = /(研发|技术|工程|算法|测试|运维|软件|大模型|安全|机器学习)/;
/** 来源类别黑名单。 */
const CATEGORY_NON_TECH_RE = /(产品|运营|市场|销售|人力|HR|财务|法务|行政|设计|客服|审核|商务|营销|公关|采购|职能|战略|投资|内容|法律|游戏策划)/;
/** 标题技术词白名单。 */
const TITLE_TECH_RE = /(研发|开发|工程|算法|测试|运维|后端|前端|客户端|服务端|数据|安全|架构|技术|大模型|机器学习|AI|Infra|SRE|DevOps|DBA|全栈|嵌入式|音视频|编译器|内核|网络|数据库|风控引擎)/;
/** 标题非技术词黑名单（命中优先排除）。 */
const TITLE_NON_TECH_RE = /(产品|运营|市场|销售|人力|HR|财务|法务|行政|设计|客服|审核|商务|管培|战略|投资|采购|公关|品牌|内容|策划|营销|编辑|咨询|助理|顾问|法务|合规|讲师|教练)/;

/**
 * 技术岗判定：源类别优先，标题白/黑名单兜底。
 * @param {{category?: string, title?: string}} job
 */
function isTechJob({ category = '', title = '' } = {}) {
  const c = String(category || '');
  const t = String(title || '');

  if (CATEGORY_NON_TECH_RE.test(c)) {
    // 类别明确非技术（产品类/运营类/职能类…）直接排除，即使标题含技术词。
    if (!CATEGORY_TECH_RE.test(c)) return false;
  }
  if (CATEGORY_TECH_RE.test(c)) return true;

  // 类别缺失或中性时，用标题兜底：黑名单优先，再匹配白名单。
  if (TITLE_NON_TECH_RE.test(t)) return false;
  return TITLE_TECH_RE.test(t);
}

/** 安全的 JSON 解析。 */
async function readJson(res) {
  if (!res) throw new Error('无响应');
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 循环翻页通用封装：返回去重后的原始列表。 */
async function paginate({ fetchPage, maxPages = MAX_PAGES_PER_SOURCE, maxItems = MAX_JOBS_PER_SOURCE }) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const items = await fetchPage(page);
    if (!items || items.length === 0) break;
    out.push(...items);
    if (items.length < 1 || out.length >= maxItems) break;
    await sleep(600);
  }
  return out.slice(0, maxItems);
}

/** 去重并保留顺序。 */
function uniqueBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (k != null && seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

/** 字符串清理：截断、去空白。 */
function clean(s, max = 5000) {
  if (s == null) return '';
  return String(s).replace(/\s+/g, ' ').trim().slice(0, max);
}

module.exports = { UA, sleep, createClient, isTechJob, readJson, paginate, uniqueBy, clean };
