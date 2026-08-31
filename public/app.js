(function () {
  'use strict';

  const PERIODS = { all: '6个月内更新', today: '今日更新', week: '今周更新', month: '今月更新', missing: '无时间标注' };
  const state = {
    period: 'all',
    page: 1,
    pageSize: 20,
    company: '',
    talent: '',
    q: '',
    city: '',
    jobs: [],
    total: 0,
    totalPages: 1,
  };

  const $ = (sel) => document.querySelector(sel);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function relTime(ts) {
    const diff = Math.max(0, Date.now() - ts);
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    const hour = Math.floor(min / 60);
    if (hour < 24) return hour + ' 小时前';
    const day = Math.floor(hour / 24);
    if (day < 30) return day + ' 天前';
    return '较早';
  }

  function renderStatus(stats) {
    const banner = $('#statusBanner');
    const chips = Object.entries(stats.sources || {}).map(([name, s]) => {
      let label = { ok: '正常', degraded: '部分可用', error: '暂不可用', pending: '待抓取' }[s.status] || s.status;
      if (s.status === 'ok' && s.count === 0) label = '正常（暂无技术岗）';
      const title = s.error || s.message || '';
      return `<span class="chip ${s.status}" title="${esc(title)}">${esc(name)} · ${label}（${s.count}）</span>`;
    }).join('');
    banner.innerHTML = `<div class="status-title">数据源状态</div><div class="status-chips">${chips || '暂无数据'}</div>`;

    const counts = stats.windows || {};
    $('#count-all').textContent = stats.total ?? '-';
    $('#count-today').textContent = counts.today ?? '-';
    $('#count-week').textContent = counts.week ?? '-';
    $('#count-month').textContent = counts.month ?? '-';
    $('#count-missing').textContent = counts.missing ?? '-';
    $('#lastUpdate').textContent = stats.updatedAt
      ? `上次更新：${stats.updatedAtText} · 共 ${stats.total} 个岗位`
      : '尚未抓取数据';
  }

  function renderJobs() {
    const listEl = $('#jobList');
    const infoEl = $('#resultInfo');
    const windowNote = state.period === 'all' ? '（近 6 个月）' : (state.period === 'missing' ? '（来源无发布时间字段）' : '（滚动窗口）');
    infoEl.textContent = `${PERIODS[state.period]}${windowNote}共 ${state.total} 个岗位 · 第 ${state.page} / ${state.totalPages} 页`;
    if (state.jobs.length === 0) {
      listEl.innerHTML = '';
      $('#emptyTip').classList.remove('hidden');
      renderPagination();
      return;
    }
    $('#emptyTip').classList.add('hidden');
    const tagClass = { 校招: 'campus', 实习: 'intern' };
    const html = state.jobs.map((j) => {
      const typeTag = j.recruit_type ? `<span class="tag ${tagClass[j.recruit_type] || ''}">${esc(j.recruit_type)}</span>` : '';
      const talentTag = Number(j.talent) === 1 ? '<span class="tag talent">人才专项</span>' : '';
      const catTag = j.category ? `<span class="tag">${esc(j.category)}</span>` : '';
      const city = j.city ? `<span>城市：<b>${esc(j.city)}</b></span>` : '';
      const dept = j.department ? `<span>部门：<b>${esc(j.department)}</b></span>` : '';
      const timeText = j.published_at_text || '';
      const rel = j.published_at ? relTime(j.published_at) : '';
      return `
        <article class="job-card">
          <div class="job-top">
            <a class="job-title" href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a>
            <div class="job-tags">${talentTag}${catTag}${typeTag}</div>
          </div>
          <div class="job-meta">
            <span>公司：<b>${esc(j.company)}</b></span>
            ${city}${dept}
            <span class="job-time"><span class="rel">${rel}</span><span>${esc(timeText)}</span></span>
          </div>
        </article>`;
    }).join('');
    listEl.innerHTML = html;
    renderPagination();
  }

  /** 生成页码序列（含省略号）。 */
  function pageNumbers(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = new Set([1, 2, total - 1, total]);
    for (let i = current - 2; i <= current + 2; i++) {
      if (i >= 1 && i <= total) pages.add(i);
    }
    const sorted = [...pages].sort((x, y) => x - y);
    const out = [];
    let prev = 0;
    for (const p of sorted) {
      if (p - prev > 1) out.push('…');
      out.push(p);
      prev = p;
    }
    return out;
  }

  function renderPagination() {
    const wrap = $('#paginationWrap');
    const totalPages = state.totalPages;
    if (state.total === 0 || totalPages <= 1) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    $('#pageNumbers').innerHTML = pageNumbers(state.page, totalPages).map((n) =>
      n === '…'
        ? '<span class="page-ellipsis">…</span>'
        : `<button class="page-num${n === state.page ? ' active' : ''}" data-page="${n}">${n}</button>`
    ).join('');
    $('#prevPageBtn').disabled = state.page <= 1;
    $('#nextPageBtn').disabled = state.page >= totalPages;
  }

  function gotoPage(n) {
    n = Math.max(1, Math.min(state.totalPages, Math.floor(Number(n) || 1)));
    if (n === state.page) return;
    state.page = n;
    loadJobs(false);
  }

  async function loadJobs(reset) {
    if (reset) state.page = 1;
    const p = new URLSearchParams({
      period: state.period,
      page: state.page,
      pageSize: state.pageSize,
    });
    if (state.company) p.set('company', state.company);
    if (state.talent) p.set('talent', state.talent);
    if (state.q) p.set('q', state.q);
    if (state.city) p.set('city', state.city);
    try {
      const data = await fetchJSON('/api/jobs?' + p.toString());
      state.total = data.total;
      state.totalPages = Math.max(1, Math.ceil(data.total / state.pageSize));
      state.jobs = data.jobs;
      renderJobs();
    } catch (err) {
      $('#jobList').innerHTML = `<p class="empty-tip">加载失败：${esc(err.message)}</p>`;
    }
  }

  async function loadStats() {
    try {
      const stats = await fetchJSON('/api/stats');
      renderStatus(stats);
      const sel = $('#filterCompany');
      const current = sel.value;
      sel.innerHTML = '<option value="">全部公司</option>' + (stats.companies || [])
        .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      if (current) sel.value = current;
    } catch (err) {
      $('#statusBanner').innerHTML = `<div class="status-title">数据源状态</div><div class="status-chips"><span class="chip error">无法连接后端：${esc(err.message)}</span></div>`;
    }
  }

  function bindEvents() {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => {
          t.classList.toggle('active', t === tab);
          t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
        });
        state.period = tab.dataset.period;
        loadJobs(true);
      });
    });

    const filters = ['company', 'talent', 'q', 'city'];
    filters.forEach((key) => {
      const el = $('#filter' + key.charAt(0).toUpperCase() + key.slice(1));
      if (!el) return;
      const onInput = () => {
        state[key] = el.value.trim();
        loadJobs(true);
      };
      if (key === 'q' || key === 'city') {
        let timer = null;
        el.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(onInput, 350);
        });
      } else {
        el.addEventListener('change', onInput);
      }
    });

    $('#clearFilters').addEventListener('click', () => {
      state.company = state.talent = state.q = state.city = '';
      $('#filterCompany').value = '';
      $('#filterTalent').value = '';
      $('#filterQ').value = '';
      $('#filterCity').value = '';
      loadJobs(true);
    });

    $('#prevPageBtn').addEventListener('click', () => gotoPage(state.page - 1));
    $('#nextPageBtn').addEventListener('click', () => gotoPage(state.page + 1));
    $('#pageNumbers').addEventListener('click', (e) => {
      const btn = e.target.closest('.page-num');
      if (btn) gotoPage(Number(btn.dataset.page));
    });
    $('#jumpPageBtn').addEventListener('click', () => gotoPage($('#jumpPageInput').value));
    $('#jumpPageInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') gotoPage(e.target.value);
    });

    $('#refreshBtn').addEventListener('click', async () => {
      const btn = $('#refreshBtn');
      btn.disabled = true;
      btn.textContent = '抓取中…';
      try {
        const before = (await fetchJSON('/api/stats')).updatedAt;
        const res = await fetch('/api/crawl', { method: 'POST' });
        if (res.status === 409) {
          // 已有抓取正在进行，直接等待其完成
        } else if (!res.ok) {
          throw new Error('HTTP ' + res.status);
        }
        $('#lastUpdate').textContent = '正在抓取，完成后自动刷新…';
        // 轮询 /api/stats，等 updatedAt 变化（抓取完成）后再刷新，最多等 6 分钟
        const deadline = Date.now() + 6 * 60 * 1000;
        const poll = async () => {
          if (Date.now() > deadline) { location.reload(); return; }
          try {
            const stats = await fetchJSON('/api/stats');
            if (stats.updatedAt && stats.updatedAt !== before) { location.reload(); return; }
          } catch (err) {
            // 网络抖动时忽略，继续轮询
          }
          setTimeout(poll, 3000);
        };
        setTimeout(poll, 3000);
      } catch (err) {
        alert('触发失败：' + err.message);
        btn.disabled = false;
        btn.textContent = '重新抓取';
      }
    });
  }

  async function init() {
    bindEvents();
    document.querySelectorAll('.tab').forEach((t) => {
      const active = t.dataset.period === state.period;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    await Promise.all([loadStats(), loadJobs(true)]);
    setInterval(loadStats, 60000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
