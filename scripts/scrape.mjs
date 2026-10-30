#!/usr/bin/env node
// 抓取支付宝 AI 付社区 PAYATHON 2026 参赛作品：
//   1) 按“天”为粒度保存快照 -> public/data/daily/YYYY-MM-DD.json
//   2) 维护索引文件         -> public/data/index.json（供页面读取，无需自己抓取）
// 定时任务（.github/workflows/update.yml）每日凌晨执行本脚本。
// 赛程结束后（默认 2026-12-09）自动跳过，不再抓取；可用 PAYATHON_END_DATE 覆盖。
import { writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'public/data');
const DAILY_DIR = resolve(DATA_DIR, 'daily');
const INDEX_FILE = resolve(DATA_DIR, 'index.json');
const HISTORY_FILE = resolve(DATA_DIR, 'history.json');

const EVENT_CODE = process.env.PAYATHON_EVENT_CODE || 'alipay_aipay_hackathon_2026';
const END_DATE = process.env.PAYATHON_END_DATE || '2026-12-09'; // 作品提交截止日，之后不再抓取
const PAGE_SIZE = 50; // 接口上限
const API = (page) =>
  `https://aipayapi.alipay.com/community/public/events/${EVENT_CODE}/works/list.json?page=${page}&pageSize=${PAGE_SIZE}`;

// 赛道定义（顺序即展示顺序）
const TRACKS = [
  { code: 'VIBE_PAY', name: 'Vibe Pay' },
  { code: 'SKILL_PAY', name: 'Skill Pay' },
  { code: 'MACHINE_PAY', name: 'Machine Pay' },
  { code: 'AGENT_PAY', name: 'Agent Pay' },
  { code: 'TOKEN_PAY', name: 'Token Pay' },
  { code: 'NOT_INTEGRATED', name: '未接入 AI 付产品' },
];
const TRACK_NAME = Object.fromEntries(TRACKS.map((t) => [t.code, t.name]));
const TRACK_COLOR = {
  VIBE_PAY: '#1677ff',
  SKILL_PAY: '#722ed1',
  MACHINE_PAY: '#13c2c2',
  AGENT_PAY: '#fa8c16',
  TOKEN_PAY: '#eb2f96',
  NOT_INTEGRATED: '#8c8c8c',
};

// 热度权重：浏览量 + 点赞 + 评论加权
const HEAT = { view: 1, like: 10, comment: 10 };

// 以北京时间（Asia/Shanghai）计算日期，保证“每日快照”按自然日归档
function shanghaiDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(d);
}

async function fetchPage(page, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(API(page), { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.errorMsg || 'API 返回失败');
      return json.data;
    } catch (err) {
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
}

function normalize(item) {
  const s = item.stats || {};
  const views = s.viewCount || 0;
  const likes = s.likeCount || 0;
  const comments = s.commentCount || 0;
  const detailUrl = `https://aipay.alipay.com/community?chinfo=huodong&view=work%2F${item.workId}`;
  return {
    workId: item.workId,
    trackCode: item.trackCode || 'UNKNOWN',
    trackName: TRACK_NAME[item.trackCode] || item.trackCode || '未知赛道',
    title: item.titleOrName || '(未命名)',
    summary: String(item.summary || '').replace(/\s+/g, ' ').trim(),
    url: item.applicationUrl || item.acquisition?.url || detailUrl,
    detailUrl,
    createdAt: item.createdAt || null,
    views,
    likes,
    comments,
    heat: views * HEAT.view + likes * HEAT.like + comments * HEAT.comment,
  };
}

async function scrapeAll() {
  let page = 1;
  let raw = [];
  let apiTotal = 0;
  for (;;) {
    const data = await fetchPage(page);
    raw = raw.concat(data.items || []);
    apiTotal = data.total ?? raw.length;
    if (!data.hasMore || page > 500) break;
    page += 1;
  }
  return { raw, apiTotal };
}

function buildPayload(raw, apiTotal) {
  const seen = new Set();
  const works = raw
    .filter((it) => {
      if (!it.workId || seen.has(it.workId)) return false;
      seen.add(it.workId);
      return true;
    })
    .map(normalize);

  const total = works.length;
  const countMap = new Map();
  for (const w of works) countMap.set(w.trackCode, (countMap.get(w.trackCode) || 0) + 1);

  const tracks = [...countMap.entries()]
    .map(([code, count]) => ({
      code,
      name: TRACK_NAME[code] || code,
      color: TRACK_COLOR[code] || '#8c8c8c',
      count,
      share: total ? Number(((count / total) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const topByTrack = {};
  for (const t of tracks) {
    topByTrack[t.code] = works
      .filter((w) => w.trackCode === t.code)
      .sort((a, b) => b.heat - a.heat || b.views - a.views || b.likes - a.likes || a.title.localeCompare(b.title))
      .slice(0, 10)
      .map((w, i) => ({ rank: i + 1, ...w }));
  }

  return {
    date: shanghaiDate(),
    eventCode: EVENT_CODE,
    updatedAt: new Date().toISOString(),
    total,
    apiTotal,
    heatFormula: HEAT,
    tracks,
    topByTrack,
    // 全量作品的当日指标（紧凑字段），用于聚合跨天历史做折线图
    works: works.map((w) => ({ id: w.workId, t: w.title, tr: w.trackCode, v: w.views, l: w.likes, c: w.comments })),
  };
}

async function listDailyFiles() {
  const files = await readdir(DAILY_DIR).catch(() => []);
  return files.filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort(); // 升序 = 日期升序
}

async function writeIndex(latest) {
  const dates = (await listDailyFiles()).map((f) => f.replace(/\.json$/, '')).reverse();

  const index = {
    updatedAt: latest.updatedAt,
    latest: latest.date,
    eventCode: latest.eventCode,
    total: latest.total,
    dates,
  };
  await writeFile(INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');
  return index;
}

// 聚合所有每日快照 -> history.json，供页面绘制折线图
// 结构：dates 升序；tracks[].counts 与 dates 对齐；works[].m = [[浏览,点赞,评论] | null, ...] 与 dates 对齐
async function writeHistory() {
  const files = await listDailyFiles();
  const dates = files.map((f) => f.replace(/\.json$/, ''));
  const dayCount = files.length;

  const trackAgg = new Map();
  const workAgg = new Map();

  for (let di = 0; di < dayCount; di += 1) {
    const day = JSON.parse(await readFile(join(DAILY_DIR, files[di]), 'utf8'));

    for (const t of day.tracks || []) {
      if (!trackAgg.has(t.code)) {
        trackAgg.set(t.code, { code: t.code, name: t.name, color: t.color, counts: new Array(dayCount).fill(0) });
      }
      trackAgg.get(t.code).counts[di] = t.count;
    }

    for (const w of day.works || []) {
      if (!workAgg.has(w.id)) {
        workAgg.set(w.id, {
          id: w.id,
          title: w.t,
          trackCode: w.tr,
          trackName: TRACK_NAME[w.tr] || w.tr,
          m: new Array(dayCount).fill(null),
        });
      }
      const entry = workAgg.get(w.id);
      entry.title = w.t;
      entry.trackCode = w.tr;
      entry.trackName = TRACK_NAME[w.tr] || w.tr;
      entry.m[di] = [w.v, w.l, w.c];
    }
  }

  // 赛道按“最新一天”的数量降序，保证图表与表格顺序一致
  const lastIdx = dayCount - 1;
  const tracks = [...trackAgg.values()].sort(
    (a, b) => (b.counts[lastIdx] || 0) - (a.counts[lastIdx] || 0) || a.name.localeCompare(b.name)
  );

  const history = {
    updatedAt: new Date().toISOString(),
    dates,
    heatFormula: HEAT,
    tracks,
    works: [...workAgg.values()],
  };
  await writeFile(HISTORY_FILE, JSON.stringify(history), 'utf8');
  return history;
}

async function main() {
  const today = shanghaiDate();
  if (today > END_DATE) {
    console.log(`✓ 已过赛程截止日 ${END_DATE}（今日 ${today}），本次跳过抓取。`);
    return;
  }

  const { raw, apiTotal } = await scrapeAll();
  const payload = buildPayload(raw, apiTotal);

  await mkdir(DAILY_DIR, { recursive: true });
  const dailyFile = join(DAILY_DIR, `${payload.date}.json`);
  await writeFile(dailyFile, JSON.stringify(payload, null, 2), 'utf8');
  const index = await writeIndex(payload);
  const history = await writeHistory();

  console.log(`✓ 抓取 ${payload.total} 件作品，快照已写入 public/data/daily/${payload.date}.json`);
  for (const t of payload.tracks) console.log(`  ${t.name}: ${t.count} (${t.share}%)`);
  console.log(`✓ 索引已更新 public/data/index.json（共 ${index.dates.length} 天快照，最新 ${index.latest}）`);
  console.log(`✓ 历史已更新 public/data/history.json（${history.dates.length} 天 × ${history.works.length} 件作品）`);
}

main().catch((err) => {
  console.error('抓取失败:', err.message);
  process.exit(1);
});
