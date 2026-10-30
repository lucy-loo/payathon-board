// 零依赖的迷你趋势图（sparkline）渲染器
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
