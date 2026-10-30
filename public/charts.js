// 零依赖的 SVG 折线图渲染器
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  return node;
}

/* ---------- 颜色工具：同一赛道色派生出多条可区分的同色系线 ---------- */
function hexToHsl(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex).trim());
  if (!m) return [210, 80, 52];
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.min(100, Math.max(0, s)) / 100;
  const ll = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  const seg = Math.floor(hh / 60) % 6;
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
  return '#' + rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

// 以 base 色为基准，派生 n 个同色系、可区分的颜色
function shades(base, n) {
  if (n <= 1) return [base];
  const [h, s, l] = hexToHsl(base);
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1) - 0.5; // -0.5 .. 0.5
    return hslToHex(h + t * 46, Math.min(96, Math.max(42, s + t * 16)), Math.min(72, Math.max(26, l + t * 30)));
  });
}

/* ---------- 坐标轴刻度 ---------- */
function niceScale(max, tickCount = 4) {
  if (!(max > 0)) return { max: 1, step: 1 };
  const rawStep = max / tickCount;
  const pow = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map((c) => c * pow).find((v) => v >= rawStep) || 10 * pow;
  return { max: Math.ceil(max / step) * step, step };
}

/* ---------- 主渲染函数 ----------
 * container: 容器元素
 * opts: { xLabels: string[], series: [{ name, color, values: (number|null)[] }], unit: string }
 */
function renderLineChart(container, { xLabels, series, unit = '' }) {
  container.innerHTML = '';
  const W = 840;
  const H = 300;
  const pad = { top: 18, right: 20, bottom: 36, left: 56 };
  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;

  const allValues = series.flatMap((s) => s.values).filter((v) => typeof v === 'number');
  const { max: yMax, step } = niceScale(Math.max(0, ...allValues));
  const n = xLabels.length;

  const xAt = (i) => (n <= 1 ? pad.left + iw / 2 : pad.left + (iw * i) / (n - 1));
  const yAt = (v) => pad.top + ih - (yMax ? (v / yMax) * ih : 0);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', role: 'img' });

  // 悬浮提示：hover 数据点时展示该点的系列名与数值
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  container.appendChild(tip);
  const hideTip = () => tip.classList.remove('on');
  const showTip = (node, s, i, v) => {
    tip.innerHTML =
      `<div class="tip-head"><i style="background:${s.color}"></i><span>${escapeHtml(s.name)}</span></div>` +
      `<div class="tip-row"><span class="tip-x">${escapeHtml(xLabels[i])}</span><strong>${v}${unit}</strong></div>`;
    const box = container.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    tip.style.left = `${r.left + r.width / 2 - box.left}px`;
    tip.style.top = `${r.top - box.top}px`;
    tip.classList.add('on');
  };

  // 横向网格线 + Y 轴刻度
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    const y = yAt(v);
    svg.appendChild(svgEl('line', { x1: pad.left, y1: y, x2: pad.left + iw, y2: y, stroke: '#eef1f6', 'stroke-width': 1 }));
    const label = svgEl('text', { x: pad.left - 10, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#98a2b3' });
    label.textContent = `${Number(v.toFixed(2))}${unit}`;
    svg.appendChild(label);
  }

  // X 轴刻度（按需稀疏显示）
  const every = Math.max(1, Math.ceil(n / 8));
  xLabels.forEach((label, i) => {
    if (i % every !== 0 && i !== n - 1) return;
    const x = xAt(i);
    const text = svgEl('text', { x, y: pad.top + ih + 20, 'text-anchor': 'middle', 'font-size': 11, fill: '#98a2b3' });
    text.textContent = label.slice(5); // MM-DD
    svg.appendChild(text);
  });

  // 折线（遇到 null 断开）+ 数据点
  for (const s of series) {
    const color = s.color || '#1677ff';
    let segment = [];
    const flush = () => {
      if (segment.length > 1) {
        svg.appendChild(svgEl('polyline', {
          points: segment.map(([x, y]) => `${x},${y}`).join(' '),
          fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        }));
      }
      segment = [];
    };
    s.values.forEach((v, i) => {
      if (typeof v !== 'number') { flush(); return; }
      const x = xAt(i);
      const y = yAt(v);
      segment.push([x, y]);

      // <g> 包裹：透明大圆用于命中，实心圆用于展示
      const g = svgEl('g', { class: 'pt' });
      g.appendChild(svgEl('circle', { cx: x, cy: y, r: 10, fill: 'transparent', 'pointer-events': 'all' }));
      const dot = svgEl('circle', { cx: x, cy: y, r: 3, fill: '#fff', stroke: color, 'stroke-width': 2, 'pointer-events': 'none' });
      g.appendChild(dot);
      g.addEventListener('mouseenter', () => { dot.setAttribute('r', 4.6); showTip(g, s, i, v); });
      g.addEventListener('mousemove', () => showTip(g, s, i, v));
      g.addEventListener('mouseleave', () => { dot.setAttribute('r', 3); hideTip(); });
      svg.appendChild(g);
    });
    flush();
  }

  container.appendChild(svg);
}

/* ---------- 图例 ---------- */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderLegend(container, items) {
  container.innerHTML = items
    .map((it) => `<span class="legend-item" title="${escapeHtml(it.name)}"><i style="background:${it.color}"></i><span>${escapeHtml(it.name)}</span></span>`)
    .join('');
}

/* ---------- 迷你趋势图（表格行内） ----------
 * values: (number|null)[]，按日期升序；返回 SVG 字符串
 */
function sparkline(values, { color = '#1677ff', width = 64, height = 18 } = {}) {
  const nums = values.filter((v) => typeof v === 'number');
  if (nums.length < 2) return '<span class="spark-empty">—</span>';

  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const n = values.length;
  const xAt = (i) => pad + (n <= 1 ? w / 2 : (w * i) / (n - 1));
  const yAt = (v) => pad + h - ((v - min) / span) * h;

  let d = '';
  let opened = false;
  values.forEach((v, i) => {
    if (typeof v !== 'number') { opened = false; return; }
    d += `${opened ? 'L' : 'M'}${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)} `;
    opened = true;
  });

  return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
    <path d="${d.trim()}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
