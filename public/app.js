// 渲染看板：读取 ./data/index.json + ./data/daily/<日期>.json + ./data/history.json
// 页面只做读取展示，数据由定时任务（scripts/scrape.mjs）负责抓取与写入。
const FALLBACK_COLORS = ['#1677ff', '#722ed1', '#13c2c2', '#fa8c16', '#eb2f96', '#2f54eb', '#a0d911'];
const HEAT_DEFAULT = { view: 1, like: 10, comment: 10 };

const state = { history: null, trackCode: null, heat: HEAT_DEFAULT };

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Number(n || 0).toLocaleString('zh-CN');

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function trackColors(data) {
  return data.tracks.reduce((acc, t, i) => {
    acc[t.code] = t.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
    return acc;
  }, {});
}

/* ---------- 表格 ---------- */
function trendFor(code) {
  return state.history?.tracks.find((t) => t.code === code)?.counts || null;
}

function renderTracks(data, colors) {
  if (!data.tracks.length) {
    $('#track-body').innerHTML = '<tr><td colspan="4" class="empty">暂无数据</td></tr>';
    $('#track-foot').innerHTML = '';
    return;
  }
  $('#track-body').innerHTML = data.tracks
    .map((t) => {
      const c = colors[t.code] || '#1677ff';
      const counts = trendFor(t.code);
      return `<tr>
        <td><span class="track-name"><span class="dot" style="background:${c}"></span>${esc(t.name)}</span></td>
        <td class="num"><strong>${num(t.count)}</strong></td>
        <td class="spark-col">${counts ? sparkline(counts, { color: c }) : '—'}</td>
        <td class="share-cell">
          <div class="share">
            <span class="share-bar"><i style="width:${t.share}%;background:${c}"></i></span>
            <span class="share-num">${t.share}%</span>
          </div>
        </td>
      </tr>`;
    })
    .join('');

  $('#track-foot').innerHTML = `<tr>
    <td>总计</td>
    <td class="num">${num(data.total)}</td>
    <td class="spark-col"></td>
    <td class="share-cell"><div class="share"><span class="share-bar"></span><span class="share-num">100%</span></div></td>
  </tr>`;
}

/* ---------- Top 10 列表 ---------- */
// 取某作品某一指标的按天序列（views/likes/comments/heat），与 history.dates 对齐
function metricSeries(workId, kind) {
  const w = state.history?.works.find((x) => x.id === workId);
  if (!w) return null;
  const { view, like, comment } = state.heat;
  const pick = { views: 0, likes: 1, comments: 2 }[kind];
  if (pick === undefined) return w.m.map((m) => (m ? m[0] * view + m[1] * like + m[2] * comment : null));
  return w.m.map((m) => (m ? m[pick] : null));
}

function renderTopList(data, code, colors) {
  const list = data.topByTrack?.[code] || [];
  const color = colors[code] || '#1677ff';
  if (!list.length) {
    $('#top-list').innerHTML = '<div class="empty">该赛道暂无作品</div>';
    return;
  }
  const sparkOf = (workId, kind) => {
    const series = metricSeries(workId, kind);
    return series ? `<div class="spark-wrap">${sparkline(series, { color, width: 56, height: 16 })}</div>` : '';
  };

  $('#top-list').innerHTML = list
    .map((w) => {
      const title = `<a class="work-title" href="${esc(w.detailUrl)}" target="_blank" rel="noopener">${esc(w.title)}<span class="external">↗</span></a>`;
      const summary = w.summary ? `<div class="work-summary">${esc(w.summary)}</div>` : '';
      return `<article class="work" style="border-left:3px solid ${color}">
        <div class="rank">${w.rank}</div>
        <div class="work-main">${title}${summary}</div>
        <div class="work-stats">
          <div class="stat heat"><div class="v">${num(w.heat)}</div><div class="k">热度</div>${sparkOf(w.workId, 'heat')}</div>
          <div class="stat"><div class="v">${num(w.views)}</div><div class="k">浏览</div>${sparkOf(w.workId, 'views')}</div>
          <div class="stat"><div class="v">${num(w.likes)}</div><div class="k">点赞</div>${sparkOf(w.workId, 'likes')}</div>
          <div class="stat"><div class="v">${num(w.comments)}</div><div class="k">评论</div>${sparkOf(w.workId, 'comments')}</div>
        </div>
      </article>`;
    })
    .join('');
}

/* ---------- Tab ---------- */
function renderTabs(data, colors, current, onChange) {
  const tabs = $('#tabs');
  tabs.innerHTML = data.tracks
    .map((t) => {
      const active = t.code === current;
      const c = colors[t.code];
      return `<button class="tab" role="tab" data-code="${esc(t.code)}" aria-selected="${active}"
        style="background:${active ? c : ''};color:${active ? '#fff' : c}">
          <span class="dot" style="background:${active ? '#fff' : c}"></span>
          ${esc(t.name)}<span class="tab-count">${num(t.count)}</span>
        </button>`;
    })
    .join('');

  tabs.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => onChange(btn.dataset.code));
  });
}

/* ---------- 仪表盘 ---------- */
function renderDashboard(data) {
  const colors = trackColors(data);
  $('#updated').textContent = formatTime(data.updatedAt);
  $('#total').textContent = num(data.total);
  $('#track-hint').textContent = `${data.tracks.length} 个赛道：${data.tracks.map((t) => t.name).join(' / ')}`;

  renderTracks(data, colors);

  const selectTab = (code) => {
    state.trackCode = code;
    renderTabs(data, colors, code, selectTab);
    renderTopList(data, code, colors);
  };
  selectTab(state.trackCode ?? data.tracks[0]?.code);
}

async function loadJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadDate(date) {
  const data = await loadJSON(`./data/daily/${date}.json`);
  renderDashboard(data);
  $('#date-hint').textContent = `${date} 快照 · ${num(data.total)} 件作品`;
}

async function main() {
  try {
    const index = await loadJSON('./data/index.json');
    const select = $('#date-select');
    select.innerHTML = index.dates.map((d) => `<option value="${d}">${d}</option>`).join('');
    select.value = index.latest;
    select.addEventListener('change', () => {
      loadDate(select.value).catch((e) => {
        $('#top-list').innerHTML = `<div class="empty error">加载失败：${esc(e.message)}</div>`;
      });
    });

    // 历史数据（表格内迷你趋势图），缺失时不影响主表
    try {
      state.history = await loadJSON('./data/history.json');
      if (state.history?.heatFormula) state.heat = state.history.heatFormula;
    } catch {
      // history.json 缺失或损坏时忽略：表格与列表的迷你趋势图会降级为占位符
    }

    await loadDate(index.latest);
  } catch (err) {
    $('#track-body').innerHTML = `<tr><td colspan="4" class="empty error">数据加载失败：${esc(err.message)}</td></tr>`;
    $('#top-list').innerHTML = `<div class="empty error">数据加载失败：${esc(err.message)}</div>`;
    $('#date-hint').textContent = '数据加载失败';
  }
}

main();
