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

// 总量趋势 = 各赛道逐日数量之和，与 history.dates 对齐
function totalTrend() {
  const hist = state.history;
  if (!hist?.tracks.length) return null;
  return hist.dates.map((_, i) => hist.tracks.reduce((sum, t) => sum + (t.counts[i] || 0), 0));
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

  const totals = totalTrend();
  $('#track-foot').innerHTML = `<tr>
    <td>总计</td>
    <td class="num">${num(data.total)}</td>
    <td class="spark-col">${totals ? sparkline(totals, { color: '#6b7280' }) : '—'}</td>
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
    const svg = series ? sparkline(series, { color, width: 44, height: 13 }) : '';
    return `<span class="spark-wrap">${svg}</span>`;
  };
  const statOf = (cls, value, label, kind, workId) =>
    `<span class="stat ${cls}"><span class="kv"><b class="v">${num(value)}</b><span class="k">${label}</span></span>${sparkOf(workId, kind)}</span>`;

  $('#top-list').innerHTML = list
    .map((w) => {
      const summary = w.summary ? `<div class="work-summary">${esc(w.summary)}</div>` : '';
      return `<article class="work">
        <div class="rank">${w.rank}</div>
        <div class="work-main">
          <a class="work-title" href="${esc(w.detailUrl)}" target="_blank" rel="noopener">${esc(w.title)}<span class="external">↗</span></a>
          ${summary}
        </div>
        <div class="work-stats">
          ${statOf('heat', w.heat, '热度', 'heat', w.workId)}
          ${statOf('', w.views, '浏览', 'views', w.workId)}
          ${statOf('', w.likes, '点赞', 'likes', w.workId)}
          ${statOf('', w.comments, '评论', 'comments', w.workId)}
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

async function main() {
  try {
    // 数据请求已由 index.html 的引导脚本提前发起（见 window.__dataBoot）
    const { index, daily, history } = await window.__dataBoot;

    // 数据采集时间范围（dates 为降序，末位是开始采集的那天）
    const first = index.dates[index.dates.length - 1];
    $('#range').innerHTML =
      first === index.latest ? `采集于 <strong>${esc(first)}</strong>` : `采集范围 <strong>${esc(first)} ~ ${esc(index.latest)}</strong>`;

    // 历史数据（表格内迷你趋势图），缺失时不影响主表
    if (history) {
      state.history = history;
      if (history.heatFormula) state.heat = history.heatFormula;
    }

    renderDashboard(daily);
  } catch (err) {
    $('#track-body').innerHTML = `<tr><td colspan="4" class="empty error">数据加载失败：${esc(err.message)}</td></tr>`;
    $('#top-list').innerHTML = `<div class="empty error">数据加载失败：${esc(err.message)}</div>`;
  }
}

main();
