// 2026 物理类志愿填报助手 - Vue 3 单文件应用
// 数据文件: data/plans.json, data/score_rank.json, data/meta.json

const { createApp, ref, reactive, computed, watch, onMounted, onUnmounted } = Vue;

// ========== 工具函数 ==========

const LS_KEY_FAV   = "zyhelper_favorites_v1";
const LS_KEY_VOL   = "zyhelper_voluntary_v1";
const LS_KEY_PRIORITY_OVR = "zyhelper_priority_overrides_v1";
const LS_KEY_PRESET= "zyhelper_presets_v2";   // v2: 含 subjects + allowed 关键词维度
const LS_KEY_UI    = "zyhelper_ui_v1";

const loadLS = (k, defVal) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : defVal; }
  catch (e) { return defVal; }
};
const saveLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// P2.2: URL hash base64url 编解码
function encodeHash(obj) {
  try {
    const json = JSON.stringify(obj);
    return btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch { return ""; }
}
function decodeHash(s) {
  try {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return JSON.parse(decodeURIComponent(escape(atob(s))));
  } catch { return null; }
}

// P2.1: filters 序列化 (Set → Array)
function serializeFilters(f) {
  return {
    ...f,
    evalAccept: [...f.evalAccept],
    schoolTags: [...f.schoolTags],
    selectedSchools: f.selectedSchools ? [...f.selectedSchools] : null,
    selectedCities: f.selectedCities ? [...f.selectedCities] : null,
    selectedMajorClasses: f.selectedMajorClasses ? [...f.selectedMajorClasses] : null,
    subjects: [...f.subjects],
    // scoreRanges/rankRanges 是普通 array, 不需转
  };
}
function deserializeFilters(o) {
  return {
    ...o,
    evalAccept: new Set(o.evalAccept || []),
    schoolTags: new Set(o.schoolTags || []),
    selectedSchools: o.selectedSchools ? new Set(o.selectedSchools) : null,
    selectedCities: o.selectedCities ? new Set(o.selectedCities) : null,
    selectedMajorClasses: o.selectedMajorClasses ? new Set(o.selectedMajorClasses) : null,
    subjects: new Set(o.subjects || ["化学", "政治"]),
  };
}

// 26 分数 → 25 等位分 + 25 等位次 (查 equivalent 表)
// source: '25' / '24' / '23' / '22' / 'avg' (平均 25/24/23)
function equivFromScore26(score26, scoreRank, source = "25") {
  if (!score26 || !scoreRank?.equivalent?.length) return { score: null, rank: null };
  const table = scoreRank.equivalent;
  let best = null;
  for (const r of table) {
    if (r.score26 === score26) return resolveEquiv(r, source);
    if (!best || Math.abs(r.score26 - score26) < Math.abs(best.score26 - score26)) best = r;
  }
  return resolveEquiv(best, source);
}

function resolveEquiv(r, source) {
  if (!r) return { score: null, rank: null };
  if (source === "avg") {
    const ss = [r.score25, r.score24, r.score23].filter(x => x != null);
    const rs = [r.rank25, r.rank24, r.rank23].filter(x => x != null);
    return {
      score: ss.length ? Math.round(ss.reduce((a, b) => a + b, 0) / ss.length) : null,
      rank:  rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length) : null,
    };
  }
  return { score: r["score" + source] ?? null, rank: r["rank" + source] ?? null };
}

// 25 一分一段: 给 25 分数返回 25 位次
function rank25FromScore25(score25, scoreRank) {
  if (!score25 || !scoreRank?.oneScoreOneRank?.["2025"]) return null;
  const table = scoreRank.oneScoreOneRank["2025"];
  let lastCum = null;
  for (const [score, cnt, cumRank] of table) {
    if (score === score25) return cumRank;
    if (score < score25) return lastCum ?? cumRank;
    lastCum = cumRank;
  }
  return lastCum;
}

// 26 位次 → 26 分数 (反查 26 一分一段)
function score26FromRank26(rank, scoreRank) {
  if (!rank || !scoreRank?.oneScoreOneRank?.["2026"]) return null;
  const table = scoreRank.oneScoreOneRank["2026"];
  for (const [score, cnt, cumRank] of table) {
    if (cumRank >= rank) return score;
  }
  return table[table.length - 1]?.[0] ?? null;
}

// 26 分数 → 26 位次 (查 26 一分一段)
function rank26FromScore26(score26, scoreRank) {
  if (!score26 || !scoreRank?.oneScoreOneRank?.["2026"]) return null;
  const table = scoreRank.oneScoreOneRank["2026"];
  let lastCum = null;
  for (const [score, cnt, cumRank] of table) {
    if (score === score26) return cumRank;
    if (score < score26) return lastCum ?? cumRank;
    lastCum = cumRank;
  }
  return lastCum;
}

// 冲稳保: 用 26 分数 X → 先转 25 等位分 Y → 在 Y 上做 delta → 用 25 一分一段反查位次
// 因为筛选用的是 25 参考数据 (ref25Score / ref25Rank), 必须用 25 标尺
function computeChongWenBao(score26, scoreRank, equivSource = "25") {
  if (!score26) return null;
  const { score: Y, rank: equivRank } = equivFromScore26(score26, scoreRank, equivSource);
  if (Y == null) return null;
  const ranges = {
    chong: { scoreLow: Y + 6,  scoreHigh: Y + 23, label: "冲" },
    wen:   { scoreLow: Y - 10, scoreHigh: Y + 5,  label: "稳" },
    bao:   { scoreLow: Y - 27, scoreHigh: Y - 11, label: "保" },
  };
  for (const k of Object.keys(ranges)) {
    const r = ranges[k];
    r.rankHigh = rank25FromScore25(r.scoreLow,  scoreRank); // 低分 → 高位次
    r.rankLow  = rank25FromScore25(r.scoreHigh, scoreRank); // 高分 → 低位次
  }
  // 修复位次离散造成的缺口: 三段首尾相连 (冲.rankHigh = 稳.rankLow - 1, 等)
  // 一分一段表中相邻分数的位次可能有 gap (cnt=0 或多个分数同一 cumRank), 强制对齐避免漏掉 plan
  if (ranges.chong.rankHigh && ranges.wen.rankLow && ranges.chong.rankHigh < ranges.wen.rankLow - 1) {
    ranges.chong.rankHigh = ranges.wen.rankLow - 1;
  }
  if (ranges.wen.rankHigh && ranges.bao.rankLow && ranges.wen.rankHigh < ranges.bao.rankLow - 1) {
    ranges.wen.rankHigh = ranges.bao.rankLow - 1;
  }
  return { equivScore25: Y, equivRank25: equivRank, ranges };
}

// 判断 plan 落入哪档 (冲/稳/保/null)
// 用分数判, 停招用 25 实际分数 (score25), 非停招用 25 参考分 (ref25Score)
function planTier(plan, cwb) {
  if (!cwb) return null;
  const s = plan.isStopped ? plan.score25 : plan.ref25Score;
  if (s == null) return null;
  const R = cwb.ranges;
  if (s >= R.chong.scoreLow && s <= R.chong.scoreHigh) return "chong";
  if (s >= R.wen.scoreLow   && s <= R.wen.scoreHigh)   return "wen";
  if (s >= R.bao.scoreLow   && s <= R.bao.scoreHigh)   return "bao";
  return null;
}

// 学科评估 多评级 字符串解析: "通信工程(A+),计算机科学与技术(A)" -> ["A+", "A"]
function extractEvalLevels(s) {
  if (!s) return [];
  const matches = s.matchAll(/\(([ABCD][+-]?)\)/g);
  return [...matches].map(m => m[1]);
}

// 检查行的学科评估是否满足用户接受的评级集合
function matchesEvalFilter(plan, acceptSet) {
  if (!acceptSet || acceptSet.size === 0) return true;
  if (acceptSet.size === 9) return true;   // 全选
  // 非停招行: 用 rankEval (含括号格式)
  // 停招行: 用 rankEval25 (纯评级)
  let levels;
  if (plan.isStopped) {
    const r = plan.rankEval25;
    levels = r ? [r] : [];
  } else {
    levels = extractEvalLevels(plan.rankEval || "");
  }
  // 空评级一律通过 (不参与筛选)
  if (levels.length === 0) return true;
  return levels.some(lv => acceptSet.has(lv));
}

// 选科要求匹配 (P1.3: 用户可配置选科组合)
// subjects: Set<string>  - 用户选定的 2 个科目 (物理隐含), 如 {化学, 政治}
// 规则: 专业 req 含 "不限" → 通过
//      专业 req 含用户未选的科目 → 过滤 (即用户没选生物就不能填要求生物的)
//      专业 req 含用户选的科目 → 通过
//      其它 → 通过 (空 req 视为不限)
const ALL_SUBJECTS = ["化学", "政治", "生物", "地理"];   // 物理类除物理外的 4 个可选
function matchesSubjectRequirement(req, subjects) {
  if (!req) return true;
  if (req.includes("不限")) return true;
  // 用户未选的科目 — 若专业要求, 则过滤
  if (subjects) {
    for (const s of ALL_SUBJECTS) {
      if (!subjects.has(s) && req.includes(s)) return false;
    }
    // 至少一个用户选的科目出现在 req 里
    for (const s of subjects) {
      if (req.includes(s)) return true;
    }
    // 如果 req 不含任何科目名 (例如纯 "物理"), 也算通过
    let hasAnySubject = false;
    for (const s of ALL_SUBJECTS) if (req.includes(s)) { hasAnySubject = true; break; }
    return !hasAnySubject;
  }
  // 默认 fallback (兼容)
  if (req.includes("生物") || req.includes("地理")) return false;
  return req.includes("化学") || req.includes("政治");
}

// 关键词模糊匹配 (回车直接搜)
function matchesKeyword(plan, kw) {
  if (!kw) return true;
  const k = kw.toLowerCase().trim();
  if (!k) return true;
  const fields = [
    plan.schoolName, plan.majorName26, plan.majorClass, plan.majorCategory,
    ...(plan.containedMajors || []),
    plan.majorName25,
  ].filter(Boolean).map(s => s.toString().toLowerCase());
  return fields.some(f => f.includes(k));
}

// 学制格式化: "四年" -> "4", "五年" -> "5", "八年医" -> "8"
function formatDuration(s) {
  if (!s) return "";
  const m = String(s).match(/[一二三四五六七八九十]/);
  if (!m) {
    const m2 = String(s).match(/(\d+)/);
    return m2 ? m2[1] : s;
  }
  const map = { 一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10 };
  return String(map[m[0]] || s);
}

// ========== 表格列元数据 (V4: Item 8 默认顺序调整) ==========
// 默认顺序: 档 - 城市 - 院校 - 专业 - 计划 - 学制 - 学费 - 变化 - 25分数 - 25位次 - 可信度 - 学科评估 - 软科评估 - 专业备注 - 专业保研率 - 操作
const COLUMNS = [
  { key: "tier",    label: "档",       width: 28,  sortable: false, fixed: true },
  { key: "city",    label: "城市",     width: 60,  sortable: true,  sortField: "city" },
  { key: "school",  label: "院校",     width: 200, sortable: true,  sortField: "schoolName" },
  { key: "major",   label: "专业",     width: 240, sortable: false },
  { key: "num",     label: "计划",     width: 50,  sortable: true,  sortField: "enrollNum26" },
  { key: "dur",     label: "学制",     width: 40,  sortable: false },
  { key: "tuition", label: "学费",     width: 60,  sortable: true,  sortField: "tuition" },
  { key: "diff",    label: "变化",     width: 100, sortable: false },
  { key: "score",   label: "25分数",   width: 70,  sortable: true,  sortField: "ref25Score" },
  { key: "rank",    label: "25位次",   width: 80,  sortable: true,  sortField: "ref25Rank" },
  { key: "conf",    label: "可信度",   width: 60,  sortable: true,  sortField: "refConfidence" },
  { key: "eval",    label: "学科评估", width: 130, sortable: false },
  { key: "soft",    label: "软科评级", width: 90,  sortable: false },
  { key: "remarks", label: "专业备注", width: 200, sortable: false },
  { key: "baoyan",  label: "专业保研", width: 140, sortable: false },
  { key: "sp",      label: "校优",     width: 50,  sortable: true,  sortField: "schoolPriority" },
  { key: "mp",      label: "类优",     width: 50,  sortable: true,  sortField: "majorPriority" },
  { key: "actions", label: "",         width: 70,  sortable: false, fixed: true },
];
const DEFAULT_HIDDEN_COLS = new Set(["sp", "mp"]); // 默认隐藏 (avoid clutter)
const COL_LABEL = Object.fromEntries(COLUMNS.map(c => [c.key, c.label]));
const SORT_FIELD_LABEL = Object.fromEntries(
  COLUMNS.filter(c => c.sortable).map(c => [c.sortField, c.label])
);

// ========== 优先次序 "allowed" 集合 ==========
// 这是关键修复 (V5 bug fix): 之前用 p.majorPriority 数值过滤, 但当 plan 该字段为 null
// 时会逃过过滤. 改为直接从 priority.json 算出 "允许的学校/城市/专业类" 名字集合, 严格匹配.
function priorityNamesInRange(items, nameKey, lo, hi) {
  const s = new Set();
  for (const it of items) {
    if (it.sort != null && it.sort >= lo && it.sort <= hi) s.add(it[nameKey]);
  }
  return s;
}

// ========== 主筛选 ==========
//
// f 结构 (新版):
//   enableScoreRange / enableRankRange: bool
//   scoreRanges: [{low, high, tier}] — 3 段冲稳保 (并集匹配)
//   rankRanges:  [{low, high, tier}]
//   tuitionMax: number
//   schoolPriorityRange: [lo, hi]
//   selectedSchools: Set<schoolName> | null (null = 不按学校 chip 过滤)
//   majorClassPriorityMax: number
//   selectedMajorClasses: Set<className> | null
//   cityPriorityMax: number
//   selectedCities: Set<cityName> | null
//   schoolTags: Set
//   evalAccept: Set
//   includeStopped / includeMidOutside / refRequired: bool
//   keyword / pickedSchool / pickedMajorClass / pickedMajorName: 关键词维度
function applyFilters(plans, f, allowed) {
  const result = [];
  for (const p of plans) {
    const score = p.isStopped ? (p.score25 ?? null) : (p.ref25Score ?? null);
    const rank  = p.isStopped ? (p.rank25 ?? null)  : (p.ref25Rank ?? null);

    if (score == null) continue;

    // 分数范围 (3 段并集)
    if (f.enableScoreRange && f.scoreRanges && f.scoreRanges.length) {
      const hit = f.scoreRanges.some(r => score >= r.low && score <= r.high);
      if (!hit) continue;
    }
    // 位次范围 (3 段并集)
    if (f.enableRankRange && f.rankRanges && f.rankRanges.length && rank != null) {
      const hit = f.rankRanges.some(r => rank >= r.low && rank <= r.high);
      if (!hit) continue;
    }

    // 学费 (停招用 25 学费)
    const tuition = p.isStopped ? p.tuition25 : p.tuition;
    if (typeof tuition === "number" && tuition > f.tuitionMax) continue;

    // V5 bug fix: 用 allowed 集合 (从 priority.json 算) 严格过滤
    // 不再依赖 plan 上的 priority 数值 (那个字段可能为 null, 之前会逃过过滤)
    if (allowed) {
      // 学校优先
      if (allowed.schools && !allowed.schools.has(p.schoolName)) continue;
      // 城市优先
      if (allowed.cities && !allowed.cities.has(p.city)) continue;
      // 专业类优先 (停招行没有 26 专业类, 不卡)
      if (allowed.majorClasses && !p.isStopped) {
        const cls = p.majorClass || "";
        if (cls && !allowed.majorClasses.has(cls)) continue;
        if (!cls) continue;   // 无专业类的非停招行也不该出现
      }
    }

    if (p.isStopped && !f.includeStopped) continue;
    if (p.isMidOutside && !f.includeMidOutside) continue;
    if (p.refConfidence === "无" && f.refRequired) continue;

    // 院校标签
    if (f.schoolTags.size) {
      const tag = p.schoolTag || "";
      let hit = false;
      for (const t of f.schoolTags) { if (tag.includes(t)) { hit = true; break; } }
      if (!hit) continue;
    }

    // 学校 chip 过滤 (selectedSchools = null 表示不按 chip 过滤)
    if (f.selectedSchools && !f.selectedSchools.has(p.schoolName)) continue;
    // 城市 chip 过滤
    if (f.selectedCities && !f.selectedCities.has(p.city)) continue;
    // 专业类 chip 过滤 (停招行没有 26 专业类, 用 25)
    if (f.selectedMajorClasses) {
      const cls = p.majorClass || p.majorClass25 || "";
      if (!f.selectedMajorClasses.has(cls)) continue;
    }

    if (!matchesEvalFilter(p, f.evalAccept)) continue;

    // 选科要求 (停招用 25, 非停招用 26)
    const sub = p.isStopped ? p.subjectReq25 : p.subjectReq;
    if (!matchesSubjectRequirement(sub, f.subjects)) continue;

    // 关键词 (autocomplete 选中的强等于过滤)
    if (f.pickedSchool && p.schoolName !== f.pickedSchool) continue;
    if (f.pickedMajorClass && (p.majorClass || p.majorClass25) !== f.pickedMajorClass) continue;
    if (f.pickedMajorName) {
      if (p.majorName26 !== f.pickedMajorName && p.majorName25 !== f.pickedMajorName) continue;
    }
    // 关键词模糊
    if (!matchesKeyword(p, f.keyword)) continue;

    result.push(p);
  }
  return result;
}

// ========== 排序 ==========

// 取字段值 (停招行用 25 实际, 非停招用 25 参考)
function getSortField(plan, field) {
  if (field === "ref25Score") return plan.isStopped ? plan.score25 : plan.ref25Score;
  if (field === "ref25Rank")  return plan.isStopped ? plan.rank25  : plan.ref25Rank;
  return plan[field];
}

// 多列排序 (Item 6.1): sortKeys = [{field, dir}, ...]
function applySort(plans, sortKeys) {
  if (!sortKeys || !sortKeys.length) return [...plans];
  const sorted = [...plans];
  sorted.sort((a, b) => {
    for (const { field, dir } of sortKeys) {
      const sign = dir === "desc" ? -1 : 1;
      const av = getSortField(a, field);
      const bv = getSortField(b, field);
      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      const c = typeof av === "string" ? av.localeCompare(bv) : (av - bv);
      if (c !== 0) return sign * c;
    }
    return 0;
  });
  return sorted;
}

// ========== Store ==========

const initialFilters = () => ({
  // 3 段范围 (启动时基于"我的分数"自动填; 用户可手改)
  enableScoreRange: true,
  enableRankRange: false,            // 默认仅按分数 (位次需主动启用)
  scoreRanges: [],                   // [{low, high, tier: 'chong'|'wen'|'bao'}]
  rankRanges:  [],
  tuitionMax: 20000,
  // 学校优先双端 (V4: 默认第一档 1-18)
  schoolPriorityRange: [1, 18],
  selectedSchools: null,             // null = 全部 in range; Set = 用户手动子集
  // 专业类优先 (单端)
  majorClassPriorityMax: 16,
  selectedMajorClasses: null,
  // 城市优先 (单端, V4: 默认 Top 10)
  cityPriorityMax: 10,
  selectedCities: null,
  // 评估 + 标签
  evalAccept: new Set(["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-"]),
  schoolTags: new Set(),
  // 开关
  includeStopped: false,
  includeMidOutside: false,       // V4: 默认不含中外合作
  refRequired: false,
  // P1.3: 选科组合 (物理类除物理外的 2 科)
  subjects: new Set(["化学", "政治"]),
  // 关键词
  keyword: "",
  pickedSchool: null,
  pickedMajorClass: null,
  pickedMajorName: null,
});

const LS_KEY_LAYOUT = "zyhelper_layout_v2";   // v2: 列顺序改为 城市前置 + 新增 baoyan
const layoutInit = loadLS(LS_KEY_LAYOUT, {});

const store = reactive({
  allPlans: [],
  filters: initialFilters(),
  sortKeys: layoutInit.sortKeys || [{ field: "ref25Score", dir: "desc" }],
  viewMode: "table",
  pageSize: 0,
  sidebarCollapsed: layoutInit.sidebarCollapsed || false,
  hiddenColumns: new Set(layoutInit.hiddenColumns || []),
  columnOrder: layoutInit.columnOrder || null,   // null = 默认顺序
  columnWidths: layoutInit.columnWidths || {},    // {key: px}, 用户拖拽后持久化
  favorites: new Set(loadLS(LS_KEY_FAV, [])),
  // 志愿单: ordered array of plan ids (取代 favorites 的语义, favorites 保留为兼容)
  voluntary: loadLS(LS_KEY_VOL, null) || loadLS(LS_KEY_FAV, []),   // 首次加载从 favorites 迁移
  // 用户自定义排序覆盖 (null = 用 priority.json 默认; Array<name> = 自定义顺序)
  priorityOverrides: loadLS(LS_KEY_PRIORITY_OVR, { schools: null, cities: null, majorClasses: null }),
  compareList: [],
  expandedRows: new Set(),
  // P2.1: 筛选预设 [{name, filters: serialized}, ...]
  presets: loadLS(LS_KEY_PRESET, []),
});

watch(() => store.presets, v => saveLS(LS_KEY_PRESET, v), { deep: true });

// 持久化布局
watch(() => ({
  sortKeys: store.sortKeys,
  sidebarCollapsed: store.sidebarCollapsed,
  hiddenColumns: Array.from(store.hiddenColumns),
  columnOrder: store.columnOrder,
  columnWidths: store.columnWidths,
}), v => saveLS(LS_KEY_LAYOUT, v), { deep: true });

const isMobile = () => window.matchMedia("(max-width: 767px)").matches;

const ui = reactive({
  dark: false,
  showCompare: false,
  showFavorites: false,
  showColSettings: false,
  showRatioPanel: false,
  showMoreMenu: false,
  showPrioritySettings: false,
  detailPlan: null,
  myScore: 0,
  myRank: 0,
  totalVolunteers: 112,
  ratioChong: 0.25,
  ratioWen: 0.45,
  ratioBao: 0.30,
  equivSource: "25",                  // '25' | '24' | '23' | 'avg'
  screenshotting: false,
  ...loadLS(LS_KEY_UI, {}),
});

watch(() => Array.from(store.favorites), v => saveLS(LS_KEY_FAV, v));
watch(() => [...store.voluntary], v => saveLS(LS_KEY_VOL, v));
watch(() => store.priorityOverrides, v => saveLS(LS_KEY_PRIORITY_OVR, v), { deep: true });
watch(ui, v => saveLS(LS_KEY_UI, { ...v, detailPlan: null }), { deep: true });

// ========== 组件 ==========

// 分数 + 冲稳保 工具 (顶部栏)
// P1.1 双向输入: 分数 ↔ 位次, 任一改动 自动算另一个
// P1.2 多年等位分对照: 显示 25/24/23/22 各年等位分 + 位次
const ScoreTool = {
  props: ["scoreRank", "myScore", "myRank", "totalVolunteers",
          "ratioChong", "ratioWen", "ratioBao", "equivSource"],
  emits: ["update:myScore", "update:myRank", "update:totalVolunteers",
          "update:ratioChong", "update:ratioWen", "update:ratioBao", "update:equivSource",
          "apply-tier"],
  setup(props, { emit }) {
    const cwb = computed(() => computeChongWenBao(props.myScore, props.scoreRank, props.equivSource));
    const targetNum = computed(() => ({
      bao:   Math.round(props.totalVolunteers * props.ratioBao),
      wen:   Math.round(props.totalVolunteers * props.ratioWen),
      chong: Math.round(props.totalVolunteers * props.ratioChong),
    }));
    // P1.1 用 flag 防止循环更新 (改分数 → emit rank → watch rank → emit score → ...)
    let updatingFromScore = false;
    let updatingFromRank = false;
    function onScore(v) {
      if (updatingFromRank) return;
      const s = +v || 0;
      updatingFromScore = true;
      emit("update:myScore", s);
      if (s && props.scoreRank) {
        const rank26 = rank26FromScore26(s, props.scoreRank);
        if (rank26) emit("update:myRank", rank26);
      } else {
        emit("update:myRank", 0);
      }
      setTimeout(() => { updatingFromScore = false; }, 50);
    }
    function onRank(v) {
      if (updatingFromScore) return;
      const r = +v || 0;
      updatingFromRank = true;
      emit("update:myRank", r);
      if (r && props.scoreRank) {
        const score = score26FromRank26(r, props.scoreRank);
        if (score) emit("update:myScore", score);
      } else {
        emit("update:myScore", 0);
      }
      setTimeout(() => { updatingFromRank = false; }, 50);
    }
    // P1.2: 多年等位 (V6: 去掉 22, 只显示 25/24/23)
    const multiEquiv = computed(() => {
      if (!props.myScore || !props.scoreRank) return null;
      const years = ["25", "24", "23"];
      const result = [];
      for (const y of years) {
        const { score, rank } = equivFromScore26(props.myScore, props.scoreRank, y);
        if (score != null) result.push({ year: y, score, rank });
      }
      return result;
    });
    return { cwb, targetNum, onScore, onRank, multiEquiv };
  },
  template: `
    <div class="flex items-center gap-2 text-sm flex-wrap">
      <label class="text-slate-500 whitespace-nowrap">26 分数:</label>
      <input type="number" :value="myScore" @input="onScore($event.target.value)"
             class="w-20 border rounded px-2 py-1 text-center font-bold text-blue-600"
             placeholder="0">
      <label class="text-slate-500 whitespace-nowrap">26 位次:</label>
      <input type="number" :value="myRank || ''" @input="onRank($event.target.value)"
             class="w-20 border rounded px-2 py-1 text-center text-slate-700"
             placeholder="0">
      <template v-if="multiEquiv && multiEquiv.length">
        <span class="text-xs text-slate-400 hide-mobile">|</span>
        <span class="text-xs text-slate-500 mr-1 hide-mobile whitespace-nowrap">多年等位:</span>
        <span v-for="(e, i) in multiEquiv" :key="e.year"
              class="text-xs text-slate-600 mr-2 whitespace-nowrap"
              :class="i > 0 ? 'hide-mobile' : ''"
              :title="e.year + ' 年: ' + e.score + ' 分 / ' + e.rank + ' 名'">
          <b class="text-purple-700">{{ e.year }}</b>: {{ e.score }}/<span class="text-slate-500">{{ e.rank || '—' }}</span>
        </span>
        <select :value="equivSource" @change="$emit('update:equivSource', $event.target.value)"
                class="text-xs border rounded px-1 py-0.5 text-slate-600 hide-mobile"
                title="冲稳保基准">
          <option value="25">基准: 25</option>
          <option value="avg">基准: 平均</option>
          <option value="24">基准: 24</option>
          <option value="23">基准: 23</option>
        </select>
      </template>
    </div>
  `,
};

// === 关键词自动补全 (V3: 候选受其他筛选条件约束) ===
// 5 微妙点:
//   (1) "已选 chip" + "未选输入" 共存: pickedSchool/Class/Name (强等于过滤) + keyword (模糊)
//   (2) 候选下拉分组展示: 学校 / 专业类 / 专业 (三类不混淆)
//   (3) 同维度 OR, 跨维度 AND (本版先实现单选, 后续可扩展)
//   (4) mousedown 拦截而非 click, 避免 blur 抢跑
//   (5) 候选 = 其他筛选条件下的子集 (避免"补全选了发现 0 结果"困境)
const KeywordAutocomplete = {
  props: ["filters", "priority", "plans"],
  setup(props) {
    const input = ref("");
    const open = ref(false);
    const activeIdx = ref(-1);
    const expandedGroups = ref(new Set());   // K3: 展开"更多"的组

    // props.plans 现在是 "候选池" (已应用其他筛选条件, 关键词维度清空)
    const groups = computed(() => {
      const kw = input.value.toLowerCase().trim();
      if (!kw) return [];
      const result = [];
      const SHOW_INIT = 8, SHOW_MAX = 50;

      // 学校 (去重, 限于候选池)
      const schoolSet = new Set();
      for (const p of props.plans) {
        if (p.schoolName && p.schoolName.toLowerCase().includes(kw)) schoolSet.add(p.schoolName);
        if (schoolSet.size >= SHOW_MAX + 1) break;
      }
      if (schoolSet.size) {
        const all = Array.from(schoolSet);
        const limit = expandedGroups.value.has("school") ? SHOW_MAX : SHOW_INIT;
        result.push({
          key: "school",
          icon: "🏫", label: "学校",
          items: all.slice(0, limit).map(v => ({ kind: "school", value: v })),
          total: all.length, expanded: expandedGroups.value.has("school"),
        });
      }

      // 专业类: 在候选池中实际出现过的专业类
      const classSet = new Set();
      for (const p of props.plans) {
        const c = p.majorClass || p.majorClass25;
        if (c) classSet.add(c);
      }
      if (props.priority?.majorClasses) {
        const all = props.priority.majorClasses
          .filter(c => c.name.includes(kw) && classSet.has(c.name));
        if (all.length) {
          const limit = expandedGroups.value.has("majorClass") ? SHOW_MAX : SHOW_INIT;
          result.push({
            key: "majorClass",
            icon: "📚", label: "专业类",
            items: all.slice(0, limit).map(c => ({ kind: "majorClass", value: c.name, sub: `[${c.category}] 排序 ${c.sort}` })),
            total: all.length, expanded: expandedGroups.value.has("majorClass"),
          });
        }
      }

      // 专业名 (去重, 限于候选池)
      const majorSet = new Set();
      for (const p of props.plans) {
        if (p.majorName26 && p.majorName26.toLowerCase().includes(kw)) majorSet.add(p.majorName26);
        if (p.majorName25 && p.majorName25.toLowerCase().includes(kw)) majorSet.add(p.majorName25);
        if (majorSet.size >= SHOW_MAX + 1) break;
      }
      if (majorSet.size) {
        const all = Array.from(majorSet);
        const limit = expandedGroups.value.has("majorName") ? SHOW_MAX : SHOW_INIT;
        result.push({
          key: "majorName",
          icon: "📖", label: "专业",
          items: all.slice(0, limit).map(v => ({ kind: "majorName", value: v })),
          total: all.length, expanded: expandedGroups.value.has("majorName"),
        });
      }
      return result;
    });
    function expandGroup(key) {
      const s = new Set(expandedGroups.value);
      s.add(key);
      expandedGroups.value = s;
    }

    const flatItems = computed(() => groups.value.flatMap(g => g.items));

    function pickItem(item) {
      // 写入到对应的 picked* 字段, 清空 input
      if (item.kind === "school") props.filters.pickedSchool = item.value;
      else if (item.kind === "majorClass") props.filters.pickedMajorClass = item.value;
      else if (item.kind === "majorName") props.filters.pickedMajorName = item.value;
      input.value = "";
      open.value = false;
      activeIdx.value = -1;
    }
    function clearPicked(kind) {
      if (kind === "school") props.filters.pickedSchool = null;
      else if (kind === "majorClass") props.filters.pickedMajorClass = null;
      else if (kind === "majorName") props.filters.pickedMajorName = null;
    }
    function onEnter() {
      // 1. 如果有高亮候选, 选它
      if (activeIdx.value >= 0 && flatItems.value[activeIdx.value]) {
        pickItem(flatItems.value[activeIdx.value]);
        return;
      }
      // 2. 否则把输入作为模糊关键词
      props.filters.keyword = input.value;
      open.value = false;
    }
    function onKeyDown(e) {
      if (!open.value) { open.value = true; return; }
      const total = flatItems.value.length;
      if (e.key === "ArrowDown") { e.preventDefault(); activeIdx.value = (activeIdx.value + 1) % total; }
      else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx.value = (activeIdx.value - 1 + total) % total; }
      else if (e.key === "Escape") { open.value = false; activeIdx.value = -1; }
    }
    function onFocus() { if (input.value) open.value = true; }
    // 输入时自动开下拉
    watch(input, v => { if (v) open.value = true; });
    function onBlur() {
      // 延迟关闭以让 mousedown 处理 (兜底)
      setTimeout(() => { open.value = false; }, 150);
    }
    function activeForItem(item) {
      const idx = flatItems.value.indexOf(item);
      return idx === activeIdx.value;
    }
    return { input, open, activeIdx, groups, expandGroup, pickItem, clearPicked, onEnter, onKeyDown, onFocus, onBlur, activeForItem };
  },
  template: `
    <div class="relative">
      <div class="flex flex-wrap gap-1 items-center border rounded px-1.5 py-1 bg-white"
           :class="{ 'ring-2 ring-blue-200': open }">
        <!-- 已选 chip -->
        <span v-if="filters.pickedSchool" class="chip-pick chip-pick-school">
          🏫 {{ filters.pickedSchool }}
          <button @click="clearPicked('school')" class="ml-1 hover:text-red-500">×</button>
        </span>
        <span v-if="filters.pickedMajorClass" class="chip-pick chip-pick-class">
          📚 {{ filters.pickedMajorClass }}
          <button @click="clearPicked('majorClass')" class="ml-1 hover:text-red-500">×</button>
        </span>
        <span v-if="filters.pickedMajorName" class="chip-pick chip-pick-name">
          📖 {{ filters.pickedMajorName }}
          <button @click="clearPicked('majorName')" class="ml-1 hover:text-red-500">×</button>
        </span>
        <!-- 输入 -->
        <input v-model="input"
               @keydown.enter="onEnter"
               @keydown="onKeyDown"
               @focus="onFocus"
               @blur="onBlur"
               type="text"
               placeholder="🔍 学校 / 专业类 / 专业"
               class="flex-1 min-w-[100px] outline-none px-1 text-sm">
        <button v-if="filters.keyword" @click="filters.keyword = ''"
                class="text-xs text-slate-400 hover:text-red-500 px-1" title="清除关键词">×</button>
      </div>

      <!-- 当前模糊关键词指示 -->
      <div v-if="filters.keyword" class="text-xs text-slate-500 mt-1">
        模糊匹配: <b>{{ filters.keyword }}</b>
      </div>

      <!-- 下拉候选 -->
      <div v-if="open && groups.length"
           class="absolute z-40 left-0 right-0 mt-1 bg-white border rounded shadow-lg max-h-96 overflow-y-auto">
        <div class="px-2 py-1 text-xs text-slate-500 bg-blue-50 border-b">
          📍 在当前筛选 <b>{{ plans.length }}</b> 条结果内补全
        </div>
        <div v-for="(g, gi) in groups" :key="gi" class="py-1">
          <div class="px-2 py-1 text-xs text-slate-400 bg-slate-50">{{ g.icon }} {{ g.label }} ({{ g.total }})</div>
          <div v-for="item in g.items" :key="item.kind+'-'+item.value"
               @mousedown.prevent="pickItem(item)"
               class="px-3 py-1 text-sm cursor-pointer hover:bg-blue-50"
               :class="{ 'bg-blue-100': activeForItem(item) }">
            {{ item.value }}
            <span v-if="item.sub" class="text-xs text-slate-400 ml-2">{{ item.sub }}</span>
          </div>
          <!-- K3: "更多" 按钮 -->
          <div v-if="!g.expanded && g.total > g.items.length"
               @mousedown.prevent="expandGroup(g.key)"
               class="px-3 py-1 text-xs text-blue-500 cursor-pointer hover:bg-blue-50">
            ... 还有 {{ g.total - g.items.length }} 条, 点击展开
          </div>
        </div>
      </div>
    </div>
  `,
};

// === 优先次序筛选器 (复用: 学校 / 城市 / 专业类) ===
//
// modeRange: 双端范围 ([lo, hi]) — 用于学校 (1-18, 20-50, 50+ 三档)
// modeMax:   单端 (≤ N) — 用于城市 / 专业类
const PriorityFilter = {
  props: {
    label: String,
    items: Array,           // [{name, sort, ...extra}]
    mode: { type: String, default: "max" },     // 'max' | 'range'
    // mode='max':
    valueMax: Number,
    presets: { type: Array, default: () => [] }, // [{label, value}]
    // mode='range':
    valueLo: Number,
    valueHi: Number,
    rangePresets: { type: Array, default: () => [] }, // [{label, lo, hi}]
    // 共用: 选中集合 (null = 全部 in range; Set = 用户子集)
    selected: Object,        // Set | null
    // 单 chip 显示: 主 label / 副 label
    chipLabel: Function,     // (item) => string
    chipSub:   Function,     // (item) => string
  },
  emits: ["update:valueMax", "update:valueLo", "update:valueHi", "update:selected"],
  setup(props, { emit }) {
    const expanded = ref(true);

    const inRange = computed(() => {
      if (props.mode === "range") {
        const lo = props.valueLo, hi = props.valueHi;
        return props.items.filter(i => i.sort != null && i.sort >= lo && i.sort <= hi);
      } else {
        return props.items.filter(i => i.sort != null && i.sort <= props.valueMax);
      }
    });

    // selected 自动跟随 valueMax/Range 变化 (新加入的项目默认选中, 但保留用户已取消的)
    // 实现: 如果 selected === null, 视为"全部 in range"; 用户首次去除某个 → 转 Set
    function isActive(item) {
      if (props.selected == null) return true;
      return props.selected.has(item.name);
    }
    function toggle(item) {
      let set = props.selected;
      if (set == null) {
        // 转成 Set: 包含所有 in range 但不含此项
        set = new Set(inRange.value.map(i => i.name));
        set.delete(item.name);
      } else {
        const next = new Set(set);
        if (next.has(item.name)) next.delete(item.name);
        else next.add(item.name);
        set = next;
      }
      emit("update:selected", set);
    }
    function reset() { emit("update:selected", null); }
    function applyPreset(p) {
      if (props.mode === "range") {
        emit("update:valueLo", p.lo);
        emit("update:valueHi", p.hi);
      } else {
        emit("update:valueMax", p.value);
      }
      emit("update:selected", null);
    }
    function isActivePreset(p) {
      if (props.mode === "range") {
        return p.lo === props.valueLo && p.hi === props.valueHi;
      }
      return p.value === props.valueMax;
    }
    function selectedCount() {
      return props.selected == null ? inRange.value.length : props.selected.size;
    }

    return { expanded, inRange, isActive, toggle, reset, applyPreset, isActivePreset, selectedCount };
  },
  template: `
    <div class="filter-section">
      <div class="flex items-center justify-between cursor-pointer" @click="expanded = !expanded">
        <label class="font-medium">{{ label }}
          <span class="text-xs text-slate-400">({{ selectedCount() }} / {{ inRange.length }})</span>
        </label>
        <span class="text-slate-400">{{ expanded ? '▾' : '▸' }}</span>
      </div>

      <div v-show="expanded" class="mt-2 space-y-2">
        <!-- 范围滑杆 / 数值 -->
        <div v-if="mode === 'range'" class="flex items-center gap-2 text-xs">
          <span class="text-slate-500">排序范围:</span>
          <input type="number" :value="valueLo" @input="$emit('update:valueLo', +$event.target.value)"
                 class="w-16 border rounded px-1 py-0.5 text-center">
          <span class="text-slate-400">-</span>
          <input type="number" :value="valueHi" @input="$emit('update:valueHi', +$event.target.value)"
                 class="w-16 border rounded px-1 py-0.5 text-center">
        </div>
        <div v-else class="flex items-center gap-2 text-xs">
          <span class="text-slate-500">排序 ≤</span>
          <input type="number" :value="valueMax" @input="$emit('update:valueMax', +$event.target.value)"
                 class="w-16 border rounded px-1 py-0.5 text-center">
          <input type="range" min="1" :max="items.length"
                 :value="valueMax" @input="$emit('update:valueMax', +$event.target.value)"
                 class="flex-1">
        </div>

        <!-- 预设按钮 (Item 9: 选中态) -->
        <div v-if="presets.length || rangePresets.length" class="flex flex-wrap gap-1">
          <button v-for="p in (mode==='range' ? rangePresets : presets)" :key="p.label"
                  @click="applyPreset(p)"
                  class="text-xs px-2 py-0.5 border rounded"
                  :class="isActivePreset(p) ? 'bg-blue-600 border-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'">
            {{ p.label }}
          </button>
          <button v-if="selected != null" @click="reset"
                  class="text-xs px-2 py-0.5 border rounded bg-amber-50 text-amber-700">
            ✕ 恢复全选
          </button>
        </div>

        <!-- chip 组 -->
        <div class="chip-row max-h-64 overflow-y-auto">
          <span v-for="item in inRange" :key="item.name"
                class="chip" :class="{ active: isActive(item) }"
                :title="chipSub ? chipSub(item) : ''"
                @click="toggle(item)">
            {{ chipLabel ? chipLabel(item) : item.name }}
          </span>
        </div>
      </div>
    </div>
  `,
};

// === 筛选侧栏 (重写) ===
const FilterPanel = {
  components: { KeywordAutocomplete, PriorityFilter },
  props: ["store", "meta", "priority", "plans", "cwb"],
  emits: ["reset", "save-preset", "load-preset", "delete-preset", "rename-preset"],
  setup(props) {
    const toggleSet = (set, val) => {
      if (set.has(val)) set.delete(val);
      else set.add(val);
    };
    const schoolChipLabel = (item) =>
      `[${item.tag ? item.tag.split('/')[0] : '—'}] ${item.name} (${item.sort})`;
    const schoolChipSub = (item) =>
      `${item.city} · 学校排名 ${item.rank} · ${item.type || ''}`;
    const cityChipLabel = (item) => `${item.city} (${item.sort})`;
    const classChipLabel = (item) => `[${item.category}] ${item.name} (${item.sort})`;
    // 学校优先预设 (三档)
    const schoolPresets = [
      { label: "第一档 1-18 (默认)", lo: 1, hi: 18 },
      { label: "第二档 20-50", lo: 20, hi: 50 },
      { label: "第三档 50+", lo: 50, hi: 999 },
      { label: "1-50", lo: 1, hi: 50 },
      { label: "全部", lo: 1, hi: 999 },
    ];
    const cityPresets = [
      { label: "Top 10 (默认)", value: 10 },
      { label: "Top 18", value: 18 },
      { label: "Top 30", value: 30 },
      { label: "全部", value: 999 },
    ];
    const classPresets = [
      { label: "Top 8", value: 8 },
      { label: "Top 16 (默认)", value: 16 },
      { label: "Top 25", value: 25 },
      { label: "全部", value: 999 },
    ];
    return { toggleSet, schoolChipLabel, schoolChipSub, cityChipLabel, classChipLabel,
             schoolPresets, cityPresets, classPresets };
  },
  template: `
    <div class="p-3 space-y-4 text-sm">
      <div class="flex items-center justify-between sticky top-0 bg-white pb-1 z-10 border-b">
        <div class="flex items-center gap-2">
          <button @click="store.sidebarCollapsed = true"
                  class="text-lg px-1 rounded hover:bg-slate-100 leading-none"
                  title="收起筛选">‹</button>
          <h2 class="font-bold text-base">筛选</h2>
        </div>
        <button @click="$emit('reset')" class="text-xs text-blue-500 hover:underline">重置全部</button>
      </div>

      <!-- P2.1: 预设 -->
      <div class="filter-section">
        <div class="flex items-center justify-between mb-1">
          <label class="font-medium text-xs text-slate-500">📑 筛选预设</label>
          <button @click="$emit('save-preset')" class="text-xs text-blue-500 hover:underline">+ 保存当前</button>
        </div>
        <div v-if="!store.presets.length" class="text-xs text-slate-400">点击 "+ 保存当前" 把当前筛选另存</div>
        <div v-else class="flex flex-wrap gap-1">
          <span v-for="(p, i) in store.presets" :key="i"
                class="preset-chip"
                @click="$emit('load-preset', i)">
            {{ p.name }}
            <button @click.stop="$emit('rename-preset', i)" class="ml-1 text-slate-400 hover:text-blue-500" title="重命名">✎</button>
            <button @click.stop="$emit('delete-preset', i)" class="ml-1 text-slate-400 hover:text-red-500" title="删除">×</button>
          </span>
        </div>
      </div>

      <!-- 关键词 (智能补全) -->
      <div class="filter-section">
        <keyword-autocomplete :filters="store.filters" :priority="priority" :plans="plans"></keyword-autocomplete>
      </div>

      <!-- 3 段冲稳保 范围 -->
      <div class="filter-section">
        <div class="flex items-center justify-between mb-1">
          <label class="font-medium">25 参考分数 (冲稳保 3 段)</label>
        </div>
        <label class="flex items-center gap-1 text-xs mb-1">
          <input type="checkbox" v-model="store.filters.enableScoreRange">
          <span>启用分数范围筛选</span>
        </label>
        <div class="space-y-1 text-xs">
          <template v-for="(r, i) in store.filters.scoreRanges" :key="r.tier">
            <div class="flex items-center gap-1">
              <span class="tier-dot" :class="'tier-'+r.tier"></span>
              <span class="w-6 text-slate-500">{{ r.tier === 'chong' ? '冲' : r.tier === 'wen' ? '稳' : '保' }}</span>
              <input type="number" v-model.number="r.low"
                     class="w-16 border rounded px-1 py-0.5 text-center">
              <span class="text-slate-400">-</span>
              <input type="number" v-model.number="r.high"
                     class="w-16 border rounded px-1 py-0.5 text-center">
            </div>
          </template>
          <div v-if="!store.filters.scoreRanges.length" class="text-slate-400">
            (在顶部输入 26 分数自动填充)
          </div>
        </div>
      </div>

      <div class="filter-section">
        <label class="flex items-center gap-1 text-xs mb-1">
          <input type="checkbox" v-model="store.filters.enableRankRange">
          <span class="font-medium">25 参考位次 (冲稳保 3 段)</span>
        </label>
        <div class="space-y-1 text-xs">
          <template v-for="(r, i) in store.filters.rankRanges" :key="r.tier">
            <div class="flex items-center gap-1">
              <span class="tier-dot" :class="'tier-'+r.tier"></span>
              <span class="w-6 text-slate-500">{{ r.tier === 'chong' ? '冲' : r.tier === 'wen' ? '稳' : '保' }}</span>
              <input type="number" v-model.number="r.low"
                     class="w-20 border rounded px-1 py-0.5 text-center">
              <span class="text-slate-400">-</span>
              <input type="number" v-model.number="r.high"
                     class="w-20 border rounded px-1 py-0.5 text-center">
            </div>
          </template>
          <div v-if="!store.filters.rankRanges.length" class="text-slate-400">
            (在顶部输入 26 分数自动填充)
          </div>
        </div>
      </div>

      <!-- 学费 -->
      <div class="filter-section">
        <label class="block font-medium mb-1">学费上限 <span class="text-slate-400">¥{{ store.filters.tuitionMax }}</span></label>
        <input v-model.number="store.filters.tuitionMax" type="range" min="3000" max="200000" step="1000" class="w-full">
      </div>

      <!-- 学校优先 (双端 + 三档预设) -->
      <priority-filter
        v-if="priority"
        label="🏫 学校优先 (排序)"
        :items="priority.schools"
        mode="range"
        :value-lo="store.filters.schoolPriorityRange[0]"
        :value-hi="store.filters.schoolPriorityRange[1]"
        :range-presets="schoolPresets"
        :selected="store.filters.selectedSchools"
        :chip-label="schoolChipLabel"
        :chip-sub="schoolChipSub"
        @update:value-lo="store.filters.schoolPriorityRange[0] = $event"
        @update:value-hi="store.filters.schoolPriorityRange[1] = $event"
        @update:selected="store.filters.selectedSchools = $event"
      ></priority-filter>

      <!-- 城市优先 -->
      <priority-filter
        v-if="priority"
        label="🏙 城市优先"
        :items="priority.cities.map(c => ({ ...c, name: c.city }))"
        mode="max"
        :value-max="store.filters.cityPriorityMax"
        :presets="cityPresets"
        :selected="store.filters.selectedCities"
        :chip-label="cityChipLabel"
        @update:value-max="store.filters.cityPriorityMax = $event"
        @update:selected="store.filters.selectedCities = $event"
      ></priority-filter>

      <!-- 专业类优先 -->
      <priority-filter
        v-if="priority"
        label="📚 专业类优先"
        :items="priority.majorClasses"
        mode="max"
        :value-max="store.filters.majorClassPriorityMax"
        :presets="classPresets"
        :selected="store.filters.selectedMajorClasses"
        :chip-label="classChipLabel"
        @update:value-max="store.filters.majorClassPriorityMax = $event"
        @update:selected="store.filters.selectedMajorClasses = $event"
      ></priority-filter>

      <!-- 学科评估 -->
      <div class="filter-section">
        <label class="block font-medium mb-1">学科评估接受</label>
        <div class="chip-row">
          <span v-for="lv in meta.enumerations.evalLevels" :key="lv"
                class="chip" :class="{ active: store.filters.evalAccept.has(lv) }"
                @click="toggleSet(store.filters.evalAccept, lv)">{{ lv }}</span>
        </div>
      </div>

      <!-- 院校标签 -->
      <div class="filter-section">
        <label class="block font-medium mb-1">院校标签</label>
        <div class="chip-row">
          <span v-for="tag in ['985','211','双一流','国重点','省重点','保研资格']" :key="tag"
                class="chip" :class="{ active: store.filters.schoolTags.has(tag) }"
                @click="toggleSet(store.filters.schoolTags, tag)">{{ tag }}</span>
        </div>
      </div>

      <!-- P1.3: 选科组合 -->
      <div class="filter-section">
        <label class="block font-medium mb-1">
          选科组合
          <span class="text-xs text-slate-400">(物理 + ↓)</span>
        </label>
        <div class="chip-row">
          <span v-for="s in ['化学','政治','生物','地理']" :key="s"
                class="chip" :class="{ active: store.filters.subjects.has(s) }"
                @click="toggleSet(store.filters.subjects, s)">{{ s }}</span>
        </div>
      </div>

      <!-- 开关 -->
      <div class="filter-section space-y-1 pt-2">
        <label class="flex items-center gap-2">
          <input type="checkbox" v-model="store.filters.includeStopped">
          <span>包含停招行</span>
        </label>
        <label class="flex items-center gap-2">
          <input type="checkbox" v-model="store.filters.includeMidOutside">
          <span>包含中外合作办学</span>
        </label>
        <label class="flex items-center gap-2">
          <input type="checkbox" v-model="store.filters.refRequired">
          <span>仅有 25 参考</span>
        </label>
      </div>
    </div>
  `,
};

// 提取主标签 (优先级: 985 > 211 > 双一流 > 国重点 > 省重点 > 其他)
function primaryTier(tag) {
  if (!tag) return "";
  for (const t of ["985", "211", "双一流", "国重点", "省重点"]) {
    if (tag.includes(t)) return t;
  }
  return "其他";
}

// 院校标签 chip
const TierBadge = {
  props: ["tag"],
  computed: {
    primary() { return primaryTier(this.tag); },
  },
  template: `<span v-if="tag" class="inline-block px-1.5 py-0.5 text-xs font-bold rounded"
                  :class="'tag-'+primary" :title="tag">{{ primary }}</span>`,
};

// 可信度 chip
const ConfBadge = {
  props: ["conf"],
  template: `<span v-if="conf" class="inline-block px-1.5 py-0.5 text-xs rounded"
                  :class="'conf-'+conf">{{ conf }}</span>`,
};

// 单条结果卡片 (Item 10: 加变化; Item 6: 按 tier 左边框颜色; V6: 加 voluntary badge)
const PlanCard = {
  components: { TierBadge, ConfBadge },
  props: ["plan", "isCompared", "isFav", "tier", "volIndex"],
  emits: ["open-detail", "toggle-compare", "toggle-favorite", "toggle-voluntary"],
  template: `
    <div class="plan-card bg-white border border-slate-200 rounded-lg p-3 cursor-pointer"
         :class="tier ? 'tier-border-'+tier : ''"
         @click="$emit('open-detail', plan)">
      <div class="flex items-start gap-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <tier-badge :tag="plan.schoolTag"></tier-badge>
            <span class="font-bold text-base">{{ plan.schoolName }}</span>
            <span class="text-xs text-slate-500">{{ plan.city }} · {{ plan.cityTier }}</span>
            <span class="text-xs text-slate-400" v-if="plan.schoolRank">学校排名 {{ plan.schoolRank }}</span>
            <span v-if="tier" class="text-xs px-1.5 py-0.5 rounded font-bold ml-auto"
                  :class="'tier-chip-'+tier">
              {{ tier === 'chong' ? '冲' : tier === 'wen' ? '稳' : '保' }}
            </span>
          </div>
          <div class="text-sm font-medium text-slate-800 mb-1">
            <span v-if="plan.isNew==='新增'" class="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded mr-1">新</span>
            <span v-if="plan.isStopped" class="text-xs px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded mr-1">停招</span>
            <span v-if="plan.diff && !plan.isStopped && plan.isNew !== '新增'"
                  class="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded mr-1"
                  :title="plan.diff">变</span>
            <span v-if="plan.isMidOutside" class="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded mr-1">中外</span>
            {{ plan.majorName26 || plan.majorName25 || '—' }}
          </div>
          <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
            <span v-if="plan.duration || plan.duration25">⏱ {{ plan.duration || plan.duration25 }}</span>
            <span v-if="plan.tuition || plan.tuition25">¥ {{ plan.tuition || plan.tuition25 }}</span>
            <span v-if="plan.enrollNum26 || plan.enrollNum25">👥 {{ plan.enrollNum26 || plan.enrollNum25 }} 人</span>
            <span v-if="plan.diff" class="text-orange-700">📈 {{ plan.diff }}</span>
          </div>
          <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-700 mt-1" v-if="plan.rankEval || plan.rankEval25">
            <span class="text-slate-500">学科评估:</span>
            <span>{{ plan.rankEval || plan.rankEval25 }}</span>
          </div>
          <div class="text-xs text-slate-700" v-if="plan.rankSoftware">
            <span class="text-slate-500">软科:</span> {{ plan.rankSoftware }}
          </div>
          <div class="text-xs text-slate-700" v-if="plan.baoyanDetail">
            <span class="text-slate-500">保研:</span> {{ plan.baoyanDetail }}
          </div>
          <div class="text-xs text-amber-700" v-if="plan.remarks">
            <span class="text-amber-600">📌 备注:</span> {{ plan.remarks }}
          </div>
          <div class="border-t border-slate-100 mt-2 pt-1 flex items-center gap-3 text-xs">
            <span class="font-bold text-blue-700">
              25 参考: {{ plan.isStopped ? plan.score25 : plan.ref25Score }} 分 /
              {{ plan.isStopped ? plan.rank25 : plan.ref25Rank }} 名
            </span>
            <conf-badge :conf="plan.refConfidence || (plan.isStopped ? '停招' : '')"></conf-badge>
          </div>
        </div>
        <div class="flex flex-col items-end gap-1">
          <button @click.stop="$emit('toggle-voluntary', plan.id)"
                  :class="volIndex ? 'vol-badge vol-in' : 'vol-badge vol-out'"
                  :title="volIndex ? '点击移出志愿单' : '加入志愿单'">
            {{ volIndex ? '#' + volIndex : '+ 志愿' }}
          </button>
          <button @click.stop="$emit('toggle-compare', plan.id)"
                  class="text-xs px-2 py-1 rounded border"
                  :class="isCompared ? 'bg-amber-100 border-amber-400 text-amber-700' : 'border-slate-300 hover:bg-slate-50'">
            {{ isCompared ? '✓ 对比' : '+ 对比' }}
          </button>
        </div>
      </div>
    </div>
  `,
};

// 结果列表 (Items 6/7/8/9/10 第 3 轮; V5: 加 pane 模式; V6: 加 voluntary 模式)
const ResultList = {
  components: { PlanCard, TierBadge, ConfBadge },
  props: ["plans", "total", "currentPage", "pageSize", "compareSet", "favorites",
          "viewMode", "expandedRows", "tierMap",
          "columns", "sortKeys", "cwb", "paneTargets",
          "voluntary", "voluntarySet", "columnWidths"],
  emits: ["page-change", "open-detail", "toggle-compare", "toggle-favorite", "toggle-expand",
          "sort-col", "col-drop", "col-resize",
          "toggle-voluntary", "vol-up", "vol-down", "vol-top", "vol-bottom"],
  setup(props, { emit }) {
    function fmtDuration(p) { return formatDuration(p.duration || p.duration25); }
    function formatDur25(p) { return formatDuration(p.duration25 || p.duration); }
    function volIdx(id) {
      const i = props.voluntary?.indexOf(id);
      return (i !== undefined && i >= 0) ? i + 1 : 0;
    }
    function rowTier(p) {
      return props.tierMap ? (props.tierMap.get(p.id) || null) : null;
    }
    function isExpanded(id) { return props.expandedRows && props.expandedRows.has(id); }
    function cellValue(p, key) {
      switch (key) {
        case "city":    return p.city;
        case "num":     return p.enrollNum26 || p.enrollNum25 || "—";
        case "dur":     return fmtDuration(p) || "—";
        case "tuition": return p.tuition || p.tuition25 || "—";
        case "eval":    return p.rankEval || p.rankEval25 || "—";
        case "soft":    return p.rankSoftware || "—";
        case "score":   return p.isStopped ? p.score25 : p.ref25Score;
        case "rank":    return p.isStopped ? p.rank25 : p.ref25Rank;
        case "conf":    return p.refConfidence || (p.isStopped ? "停招" : "");
        case "diff":    return p.diffSummary || p.diff || "—";
        case "remarks": return p.remarks || "—";
        case "sp":      return p.schoolPriority ?? "—";
        case "mp":      return p.majorPriority ?? "—";
        case "baoyan":  return p.baoyanDetail || "—";
      }
    }
    // 给某列查它在 sortKeys 中的索引 + 方向
    function sortIndicator(col) {
      if (!col.sortable) return null;
      const i = props.sortKeys.findIndex(k => k.field === col.sortField);
      if (i < 0) return null;
      return { idx: i + 1, dir: props.sortKeys[i].dir };
    }
    // 拖动状态
    let dragSourceKey = null;
    function onColDragStart(col, ev) { dragSourceKey = col.key; ev.dataTransfer.effectAllowed = "move"; }
    function onColDrop(col) {
      if (!dragSourceKey || dragSourceKey === col.key) return;
      emit("col-drop", { from: dragSourceKey, to: col.key });
      dragSourceKey = null;
    }
    // 列宽 resize: mousedown 在 .th-resize → 跟踪 mousemove → 写入 store (持久化)
    function startResize(col, ev) {
      ev.preventDefault();
      ev.stopPropagation();
      const th = ev.target.closest("th");
      const startX = ev.clientX;
      const startW = th.offsetWidth;
      function onMove(e) {
        const w = Math.max(30, startW + (e.clientX - startX));
        // 临时直接 set DOM 让用户看到拖拽实时效果
        th.style.width = w + "px";
      }
      function onUp(e) {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        const w = Math.max(30, startW + (e.clientX - startX));
        // 提交到 state, 持久化
        emit("col-resize", { key: col.key, width: w });
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }
    function colWidth(c) {
      return (props.columnWidths && props.columnWidths[c.key]) || c.width;
    }
    // 3.16.1: 三栏分桶
    const paneLists = computed(() => {
      const buckets = { chong: [], wen: [], bao: [] };
      if (!props.cwb) return buckets;
      for (const p of props.plans) {
        const t = planTier(p, props.cwb);
        if (t) buckets[t].push(p);
      }
      return buckets;
    });
    const paneCounts = computed(() => ({
      chong: paneLists.value.chong.length,
      wen:   paneLists.value.wen.length,
      bao:   paneLists.value.bao.length,
    }));
    return { fmtDuration, formatDur25, rowTier, isExpanded, cellValue, sortIndicator,
             onColDragStart, onColDrop, startResize, colWidth,
             paneLists, paneCounts, volIdx };
  },
  computed: {
    totalPages() {
      if (!this.pageSize) return 1;
      return Math.ceil(this.total / this.pageSize);
    },
  },
  template: `
    <div>
      <div v-if="plans.length === 0" class="text-center text-slate-400 py-16">
        <div class="text-4xl mb-2">🤔</div>
        <div>未找到符合条件的招生计划</div>
        <div class="text-sm mt-1">尝试调整左侧筛选条件</div>
      </div>

      <!-- 志愿单视图 (V6: 加序号 + 上下移 + 不可排序) -->
      <div v-else-if="viewMode==='voluntary'" class="overflow-x-auto">
        <div v-if="plans.length === 0" class="text-center text-slate-400 py-16">
          <div class="text-4xl mb-2">📋</div>
          <div>志愿单为空</div>
          <div class="text-sm mt-1">回到查询页, 点击 "+ 志愿" 加入招生计划</div>
        </div>
        <table v-else class="resizable-table w-full bg-white border text-xs">
          <thead>
            <tr>
              <th style="width:40px" class="text-center">#</th>
              <template v-for="c in columns" :key="c.key">
                <th v-if="c.key !== 'actions'"
                    :class="['col-'+c.key, c.fixed ? 'fixed-col' : '']"
                    :style="{ width: colWidth(c) + 'px' }">
                  <span>{{ c.label }}</span>
                </th>
              </template>
              <th style="width:130px" class="text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(p, idx) in plans" :key="p.id">
              <tr class="hover:bg-slate-50 cursor-pointer"
                  :class="[rowTier(p) ? 'tier-row-'+rowTier(p) : '', isExpanded(p.id) ? 'main-row-expanded' : '']"
                  @click="$emit('toggle-expand', p.id)">
                <th class="vol-num-cell text-center">{{ idx + 1 }}</th>
                <template v-for="c in columns" :key="c.key">
                  <td v-if="c.key==='actions'"></td>
                  <td v-else-if="c.key==='tier'" :class="'col-'+c.key">
                    <span v-if="rowTier(p)" class="tier-cell" :class="'tier-cell-'+rowTier(p)">
                      {{ rowTier(p) === 'chong' ? '冲' : rowTier(p) === 'wen' ? '稳' : '保' }}
                    </span>
                  </td>
                  <td v-else-if="c.key==='school'" :class="'col-'+c.key">
                    <tier-badge :tag="p.schoolTag"></tier-badge>
                    <span class="ml-1">{{ p.schoolName }}</span>
                    <span v-if="p.schoolRank" class="text-slate-400 ml-1">#{{ p.schoolRank }}</span>
                  </td>
                  <td v-else-if="c.key==='major'" :class="['col-'+c.key, 'truncate']" :title="p.majorName26 || p.majorName25">
                    <span v-if="p.isNew==='新增'" class="badge-new">新</span>
                    <span v-if="p.isStopped" class="badge-stop">停</span>
                    <span v-if="p.diff && !p.isStopped && p.isNew !== '新增'"
                          class="badge-diff" :title="p.diff">变</span>
                    <span v-if="p.isMidOutside" class="badge-mid">中外</span>
                    {{ p.majorName26 || p.majorName25 || '—' }}
                  </td>
                  <td v-else-if="c.key==='score'" :class="['col-'+c.key, 'font-bold text-blue-700 text-right']">
                    {{ cellValue(p, c.key) }}
                  </td>
                  <td v-else-if="c.key==='rank' || c.key==='tuition'" :class="['col-'+c.key, 'text-right']">{{ cellValue(p, c.key) }}</td>
                  <td v-else-if="c.key==='conf'" :class="'col-'+c.key"><conf-badge :conf="cellValue(p, c.key)"></conf-badge></td>
                  <td v-else-if="c.key==='num' || c.key==='dur' || c.key==='sp' || c.key==='mp'"
                      :class="['col-'+c.key, 'text-center']">{{ cellValue(p, c.key) }}</td>
                  <td v-else :class="['col-'+c.key, 'truncate']" :title="cellValue(p, c.key)">{{ cellValue(p, c.key) }}</td>
                </template>
                <td class="text-center vol-actions">
                  <button @click.stop="$emit('vol-top', p.id)" :disabled="idx === 0"
                          class="px-1 hover:text-blue-600 disabled:opacity-30" title="置顶">⬆⬆</button>
                  <button @click.stop="$emit('vol-up', p.id)" :disabled="idx === 0"
                          class="px-1 hover:text-blue-600 disabled:opacity-30" title="上移">⬆</button>
                  <button @click.stop="$emit('vol-down', p.id)" :disabled="idx === plans.length-1"
                          class="px-1 hover:text-blue-600 disabled:opacity-30" title="下移">⬇</button>
                  <button @click.stop="$emit('vol-bottom', p.id)" :disabled="idx === plans.length-1"
                          class="px-1 hover:text-blue-600 disabled:opacity-30" title="置底">⬇⬇</button>
                  <button @click.stop="$emit('toggle-voluntary', p.id)"
                          class="px-1 text-red-500 hover:text-red-700" title="移除">✕</button>
                </td>
              </tr>
              <!-- 展开行 (复用主表格的展开行) -->
              <tr v-if="isExpanded(p.id)" class="expanded-row">
                <td :colspan="columns.length + 1" class="bg-slate-50 p-3">
                  <div class="text-sm">
                    <div><b>所在省:</b> {{ p.province }} · {{ p.cityTier }} · <b>类型:</b> {{ p.schoolType }} · <b>主管:</b> {{ p.managing || '—' }}</div>
                    <div class="mt-1"><b>学科评估:</b> {{ p.rankEval || p.rankEval25 || '—' }}</div>
                    <div class="mt-1"><b>软科评级:</b> {{ p.rankSoftware || '—' }}</div>
                    <div class="mt-1" v-if="p.remarks"><b class="text-amber-700">📌 备注:</b> {{ p.remarks }}</div>
                    <div class="mt-1" v-if="p.diffSummary"><b class="text-orange-700">📈 变化:</b> {{ p.diffSummary }}</div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- 三栏冲稳保 (3.16.1) -->
      <div v-else-if="viewMode==='pane'" class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div v-for="t in ['chong', 'wen', 'bao']" :key="t" class="pane-col">
          <div class="pane-header" :class="'tier-chip-'+t">
            <span class="text-base font-bold">
              {{ t==='chong' ? '冲' : t==='wen' ? '稳' : '保' }}
            </span>
            <span class="text-xs">
              {{ paneCounts[t] }} 项
              <span v-if="paneTargets[t]"> / 目标 {{ paneTargets[t] }}</span>
            </span>
          </div>
          <div class="pane-body">
            <div v-if="paneLists[t].length === 0" class="text-center text-slate-400 text-xs py-6">
              该档没有符合条件的计划
            </div>
            <plan-card v-for="p in paneLists[t]" :key="p.id" :plan="p"
                       :is-compared="compareSet.has(p.id)"
                       :is-fav="favorites.has(p.id)"
                       :tier="t"
                       @open-detail="$emit('open-detail', $event)"
                       @toggle-compare="$emit('toggle-compare', $event)"
                       @toggle-favorite="$emit('toggle-favorite', $event)"></plan-card>
          </div>
        </div>
      </div>

      <!-- 卡片视图 -->
      <div v-else-if="viewMode==='list'" class="space-y-3">
        <plan-card v-for="p in plans" :key="p.id" :plan="p"
                   :is-compared="compareSet.has(p.id)"
                   :is-fav="favorites.has(p.id)"
                   :tier="rowTier(p)"
                   :vol-index="volIdx(p.id)"
                   @open-detail="$emit('open-detail', $event)"
                   @toggle-compare="$emit('toggle-compare', $event)"
                   @toggle-favorite="$emit('toggle-favorite', $event)"
                   @toggle-voluntary="$emit('toggle-voluntary', $event)"></plan-card>
      </div>

      <!-- 表格视图: 数据驱动 (V4: drag/sort/resize 拆子元素, sticky header) -->
      <div v-else class="table-scroll">
        <table class="resizable-table w-full bg-white border text-xs">
          <thead>
            <tr>
              <th v-for="c in columns" :key="c.key"
                  :class="['col-'+c.key, c.fixed ? 'fixed-col' : '']"
                  :style="{ width: colWidth(c) + 'px' }"
                  @dragover.prevent
                  @drop="onColDrop(c)">
                <!-- 拖动手柄 (左) -->
                <span v-if="!c.fixed" class="th-drag"
                      draggable="true"
                      @dragstart="onColDragStart(c, $event)"
                      title="拖动调整列顺序">⠿</span>
                <!-- 表头文字 (中) - 点击排序 -->
                <span class="th-text" :class="c.sortable ? 'sortable' : ''"
                      @click.stop="c.sortable && $emit('sort-col', c.sortField)">{{ c.label }}</span>
                <span v-if="sortIndicator(c)" class="sort-indicator">
                  {{ sortIndicator(c).dir === 'desc' ? '↓' : '↑' }}<sub>{{ sortIndicator(c).idx }}</sub>
                </span>
                <!-- 列宽 resize 手柄 (右) -->
                <span v-if="!c.fixed" class="th-resize"
                      @mousedown.stop="startResize(c, $event)"
                      title="拖动调整列宽"></span>
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="p in plans" :key="p.id">
              <tr class="hover:bg-slate-50 cursor-pointer"
                  :class="[rowTier(p) ? 'tier-row-'+rowTier(p) : '', isExpanded(p.id) ? 'main-row-expanded' : '']"
                  @click="$emit('toggle-expand', p.id)">
                <template v-for="c in columns" :key="c.key">
                  <td v-if="c.key==='tier'" :class="'col-'+c.key">
                    <span v-if="rowTier(p)" class="tier-cell" :class="'tier-cell-'+rowTier(p)">
                      {{ rowTier(p) === 'chong' ? '冲' : rowTier(p) === 'wen' ? '稳' : '保' }}
                    </span>
                  </td>
                  <td v-else-if="c.key==='school'" :class="'col-'+c.key">
                    <tier-badge :tag="p.schoolTag"></tier-badge>
                    <span class="ml-1">{{ p.schoolName }}</span>
                    <span v-if="p.schoolRank" class="text-slate-400 ml-1">#{{ p.schoolRank }}</span>
                  </td>
                  <td v-else-if="c.key==='major'" :class="['col-'+c.key, 'truncate']" :title="p.majorName26 || p.majorName25">
                    <span v-if="p.isNew==='新增'" class="badge-new">新</span>
                    <span v-if="p.isStopped" class="badge-stop">停</span>
                    <span v-if="p.diff && !p.isStopped && p.isNew !== '新增'"
                          class="badge-diff" :title="p.diff">变</span>
                    <span v-if="p.isMidOutside" class="badge-mid">中外</span>
                    {{ p.majorName26 || p.majorName25 || '—' }}
                  </td>
                  <td v-else-if="c.key==='score'" :class="['col-'+c.key, 'font-bold text-blue-700 text-right']">
                    {{ cellValue(p, c.key) }}
                  </td>
                  <td v-else-if="c.key==='rank' || c.key==='tuition'" :class="['col-'+c.key, 'text-right']">{{ cellValue(p, c.key) }}</td>
                  <td v-else-if="c.key==='conf'" :class="'col-'+c.key"><conf-badge :conf="cellValue(p, c.key)"></conf-badge></td>
                  <td v-else-if="c.key==='num' || c.key==='dur' || c.key==='sp' || c.key==='mp'"
                      :class="['col-'+c.key, 'text-center']">{{ cellValue(p, c.key) }}</td>
                  <td v-else-if="c.key==='actions'" :class="'col-'+c.key">
                    <button @click.stop="$emit('toggle-voluntary', p.id)"
                            :class="volIdx(p.id) ? 'vol-badge vol-in' : 'vol-badge vol-out'"
                            :title="volIdx(p.id) ? '点击移出志愿单 (序号 ' + volIdx(p.id) + ')' : '加入志愿单'">
                      {{ volIdx(p.id) ? '#' + volIdx(p.id) : '+志愿' }}
                    </button>
                    <button @click.stop="$emit('toggle-compare', p.id)"
                            class="ml-1 px-1 border rounded text-xs"
                            :class="compareSet.has(p.id) ? 'bg-amber-100 border-amber-400 text-amber-700' : ''">
                      {{ compareSet.has(p.id) ? '✓' : '+对' }}
                    </button>
                    <button @click.stop="$emit('open-detail', p)"
                            class="ml-1 text-blue-500 hover:underline text-xs">详</button>
                  </td>
                  <td v-else :class="['col-'+c.key, 'truncate']" :title="cellValue(p, c.key)">{{ cellValue(p, c.key) }}</td>
                </template>
              </tr>
              <!-- 展开行 V5 (Item 7: 紧凑 + 变化合并 25vs26 + 预测 1 行) -->
              <tr v-if="isExpanded(p.id)" class="expanded-row">
                <td :colspan="columns.length" class="bg-slate-50 p-3">
                  <div class="space-y-3">

                    <!-- 学校基本信息 (1 行 inline) -->
                    <section class="expand-section">
                      <h4 class="expand-section-title">🏫 学校基本信息</h4>
                      <div class="info-line">
                        <span><b>所在省</b> {{ p.province || '—' }}</span>
                        <span><b>城市层级</b> {{ p.cityTier || '—' }}</span>
                        <span><b>学校类型</b> {{ p.schoolType || '—' }}</span>
                        <span><b>主管部门</b> {{ p.managing || '—' }}</span>
                        <span><b>学校排名</b> {{ p.schoolRank || '—' }}</span>
                        <span><b>保研资格</b> {{ p.hasBaoyan || '—' }}</span>
                        <span><b>校保研率</b> {{ p.schoolBaoyan ? (p.schoolBaoyan*100).toFixed(1)+'%' : '—' }}</span>
                        <span><b>校升学率</b> {{ p.schoolUpgrade ? (p.schoolUpgrade*100).toFixed(1)+'%' : '—' }}</span>
                      </div>
                    </section>

                    <!-- 专业信息 (按用户规格的 4 行) -->
                    <section class="expand-section">
                      <h4 class="expand-section-title">📚 专业信息</h4>
                      <div class="space-y-1">
                        <!-- Row 1: 所含专业, 门类/类, 选科要求 -->
                        <div class="major-row major-row-3">
                          <div><b class="info-label">所含专业</b><span class="expand-wrap">{{ (p.containedMajors || []).join('、') || '—' }}</span></div>
                          <div><b class="info-label">门类/类</b><span>{{ p.majorCategory || '—' }} / {{ p.majorClass || '—' }}</span></div>
                          <div><b class="info-label">选科要求</b><span>{{ p.subjectReq || p.subjectReq25 || '—' }}</span></div>
                        </div>
                        <!-- Row 2: 学科评估, 软科评估 -->
                        <div class="major-row major-row-2">
                          <div><b class="info-label">学科评估</b><span class="expand-wrap">{{ p.rankEval || p.rankEval25 || '—' }}</span></div>
                          <div><b class="info-label">软科评估</b><span class="expand-wrap">{{ p.rankSoftware || '—' }}</span></div>
                        </div>
                        <!-- Row 3: 专业保研率, 软科硕士 -->
                        <div class="major-row major-row-2">
                          <div><b class="info-label">专业保研率</b><span class="expand-wrap">{{ p.baoyanDetail || '—' }}</span></div>
                          <div><b class="info-label">软科硕士</b><span class="expand-wrap">{{ p.rankMaster || '—' }}</span></div>
                        </div>
                        <!-- Row 4: 备注 -->
                        <div class="major-row" v-if="p.remarks">
                          <div><b class="info-label text-amber-700">📌 备注</b><span class="expand-wrap text-amber-800">{{ p.remarks }}</span></div>
                        </div>
                      </div>
                    </section>

                    <!-- 25 vs 26 对比 (含变化列, rowspan=2) -->
                    <section class="expand-section">
                      <h4 class="expand-section-title">
                        📊 25 vs 26 对比
                        <span v-if="p.refSource" class="ml-3 font-normal text-xs text-slate-500">
                          (参考来源: {{ p.refSource }})
                        </span>
                      </h4>
                      <table class="expand-table compare-table">
                        <colgroup>
                          <col style="width: 160px">
                          <col style="width: 32px">
                          <col style="width: 28%">
                          <col style="width: 50px">
                          <col style="width: 50px">
                          <col style="width: 60px">
                          <col style="width: 60px">
                          <col style="width: 60px">
                          <col style="width: 60px">
                          <col style="width: 70px">
                        </colgroup>
                        <thead>
                          <tr>
                            <th class="text-left">变化</th>
                            <th>年</th><th class="text-left">专业名</th><th>计划</th><th>学制</th><th>学费</th>
                            <th>分数</th><th>位次</th><th>线差</th><th>平均位次</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr class="row-26">
                            <td rowspan="2" class="diff-cell text-left">
                              <template v-if="p.isStopped">
                                <span class="badge-stop">停招</span>
                              </template>
                              <template v-else-if="p.diffStructured && p.diffStructured.length">
                                <span class="font-bold text-orange-700 block mb-1">{{ p.diffSummary || '变化' }}</span>
                                <ul class="space-y-0.5 text-[10px] text-slate-600">
                                  <li v-for="(d, di) in p.diffStructured" :key="di">
                                    <template v-if="d.type==='rename'">
                                      <span class="text-amber-700">改名</span>
                                      <span v-if="!d.prefixSame" class="text-amber-700"> {{ d.oldPrefix }}→{{ d.newPrefix }}</span>
                                      <div v-if="(d.added || []).length" class="text-green-700 ml-2">＋{{ (d.added || []).join('、') }}</div>
                                      <div v-if="(d.removed || []).length" class="text-red-700 ml-2">−{{ (d.removed || []).join('、') }}</div>
                                    </template>
                                    <template v-else-if="d.type==='num'">
                                      人数 <span :class="d.delta<0?'text-red-700':'text-green-700'">{{ d.delta>0?'+':'' }}{{ d.delta }}</span>
                                    </template>
                                    <template v-else-if="d.type==='tuition'">
                                      学费 {{ d.from }}→{{ d.to }}
                                    </template>
                                    <template v-else-if="d.type==='new'">
                                      <span class="text-red-600">新增</span>
                                    </template>
                                    <template v-else>
                                      <span class="text-slate-500 italic">其它: {{ d.text }}</span>
                                    </template>
                                  </li>
                                </ul>
                              </template>
                              <template v-else>
                                <span class="text-slate-400">不变</span>
                              </template>
                            </td>
                            <th>26</th>
                            <td v-if="p.isStopped" colspan="7" class="text-slate-400 italic text-center">—— 已停招 ——</td>
                            <template v-else>
                              <td class="text-left expand-wrap">{{ p.majorName26 || '—' }}</td>
                              <td>{{ p.enrollNum26 || '—' }}</td>
                              <td>{{ fmtDuration(p) || '—' }}</td>
                              <td>{{ p.tuition || '—' }}</td>
                              <td><b class="text-blue-700">{{ p.ref25Score || '—' }}</b><span class="text-[10px] text-slate-400">(参考)</span></td>
                              <td>{{ p.ref25Rank || '—' }}</td>
                              <td>{{ p.ref25LineDiff || '—' }}</td>
                              <td>{{ p.avgRank || '—' }}</td>
                            </template>
                          </tr>
                          <tr class="row-25">
                            <th>25</th>
                            <td class="text-left expand-wrap">{{ p.majorName25 || '—' }}</td>
                            <td>{{ p.enrollNum25 || '—' }}</td>
                            <td>{{ formatDur25(p) || '—' }}</td>
                            <td>{{ p.tuition25 || '—' }}</td>
                            <td><b>{{ p.score25 || '—' }}</b><span class="text-[10px] text-slate-400">(实际)</span></td>
                            <td>{{ p.rank25 || '—' }}</td>
                            <td>{{ p.lineDiff25 || '—' }}</td>
                            <td>—</td>
                          </tr>
                          <tr v-for="y in ['24','23','22']" :key="y" v-if="p.history && p.history[y]" class="row-history">
                            <td></td>
                            <th>{{ y }}</th>
                            <td colspan="2" class="text-slate-400 text-left text-[10px]">{{ p.history[y].num }} 人</td>
                            <td>—</td>
                            <td>—</td>
                            <td>{{ p.history[y].score }}</td>
                            <td>{{ p.history[y].rank }}</td>
                            <td>{{ p.history[y].lineDiff }}</td>
                            <td>—</td>
                          </tr>
                        </tbody>
                      </table>
                    </section>

                    <!-- 预测 (1 行 inline) -->
                    <section class="expand-section">
                      <h4 class="expand-section-title">🔮 预测</h4>
                      <div class="info-line">
                        <span><b>预测分数</b> {{ p.predict?.score || '—' }}</span>
                        <span><b>预测位次</b> {{ p.predict?.rank || '—' }}</span>
                        <span><b>线差预测分</b> {{ p.predict?.lineScore || '—' }}</span>
                        <span class="flex-1"><b>趋势</b> {{ p.predict?.trend || '—' }}</span>
                      </div>
                    </section>

                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- 分页 -->
      <div v-if="totalPages > 1" class="flex justify-center items-center gap-2 mt-4">
        <button @click="$emit('page-change', currentPage-1)"
                :disabled="currentPage <= 1"
                class="px-2 py-1 border rounded disabled:opacity-30">‹</button>
        <span class="text-sm">{{ currentPage }} / {{ totalPages }}</span>
        <button @click="$emit('page-change', currentPage+1)"
                :disabled="currentPage >= totalPages"
                class="px-2 py-1 border rounded disabled:opacity-30">›</button>
      </div>
    </div>
  `,
};

// 详情弹窗 (右侧抽屉)
const DetailDrawer = {
  components: { TierBadge, ConfBadge },
  props: ["plan", "scoreRank", "compareSet", "favorites"],
  emits: ["close", "toggle-compare", "toggle-favorite"],
  setup(props) {
    const chartRef = ref(null);
    let chart = null;
    function renderChart() {
      if (!chartRef.value || !props.plan) return;
      const data = {
        labels: ["2022", "2023", "2024", "2025"],
        datasets: [
          {
            label: "最低分",
            data: ["22", "23", "24"].map(y => props.plan.history?.[y]?.score ?? null)
                  .concat([props.plan.score25 ?? null]),
            borderColor: "#2563eb",
            backgroundColor: "#bfdbfe",
            yAxisID: 'y1',
          },
          {
            label: "最低位次",
            data: ["22", "23", "24"].map(y => props.plan.history?.[y]?.rank ?? null)
                  .concat([props.plan.rank25 ?? null]),
            borderColor: "#dc2626",
            backgroundColor: "#fecaca",
            yAxisID: 'y2',
          },
        ],
      };
      if (chart) chart.destroy();
      chart = new Chart(chartRef.value, {
        type: 'line',
        data,
        options: {
          responsive: true,
          plugins: { legend: { position: 'top' } },
          scales: {
            y1: { type: 'linear', position: 'left', title: { display: true, text: '最低分' }},
            y2: { type: 'linear', position: 'right', title: { display: true, text: '最低位次' },
                  reverse: true, grid: { drawOnChartArea: false } },
          },
        },
      });
    }
    onMounted(renderChart);
    watch(() => props.plan, renderChart);
    onUnmounted(() => chart && chart.destroy());
    return { chartRef };
  },
  template: `
    <div class="detail-drawer">
      <div class="sticky top-0 bg-white border-b z-10 px-4 py-3 flex items-center justify-between">
        <h2 class="font-bold text-lg">招生计划详情</h2>
        <button @click="$emit('close')" class="text-2xl leading-none">×</button>
      </div>
      <div class="p-4 space-y-4">
        <!-- 学校 -->
        <div>
          <div class="flex items-center gap-2 mb-1">
            <tier-badge :tag="plan.schoolTag"></tier-badge>
            <h3 class="font-bold text-xl">{{ plan.schoolName }}</h3>
          </div>
          <div class="text-sm text-slate-600 flex flex-wrap gap-x-3">
            <span>{{ plan.province }} {{ plan.city }} ({{ plan.cityTier }})</span>
            <span v-if="plan.schoolType">{{ plan.schoolType }}</span>
            <span v-if="plan.schoolRank">学校排名 {{ plan.schoolRank }}</span>
            <span v-if="plan.managing">{{ plan.managing }}</span>
          </div>
          <div class="text-sm text-slate-600 flex flex-wrap gap-x-3 mt-1">
            <span v-if="plan.schoolBaoyan">校保研率: {{ (plan.schoolBaoyan*100).toFixed(1) }}%</span>
            <span v-if="plan.schoolUpgrade">校升学率: {{ (plan.schoolUpgrade*100).toFixed(1) }}%</span>
            <span v-if="plan.hasBaoyan">保研资格: {{ plan.hasBaoyan }}</span>
          </div>
        </div>

        <!-- 26 招生 -->
        <div class="border-t pt-3">
          <h4 class="font-bold text-base mb-2">2026 招生</h4>
          <div class="text-base font-medium">
            {{ plan.majorName26 || '—' }}
            <span v-if="plan.isStopped" class="text-xs px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded">停招</span>
            <span v-if="plan.isNew==='新增'" class="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 rounded">新增</span>
            <span v-if="plan.isMidOutside" class="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">中外合作</span>
          </div>
          <table class="compact-table w-full mt-2">
            <tbody>
              <tr><th class="w-32">门类 / 专业类</th><td>{{ plan.majorCategory }} / {{ plan.majorClass }}</td></tr>
              <tr v-if="plan.containedMajors?.length"><th>所含专业</th><td>{{ plan.containedMajors.join('、') }}</td></tr>
              <tr v-if="plan.rankEval"><th>学科评估</th><td>{{ plan.rankEval }}</td></tr>
              <tr v-if="plan.rankSoftware"><th>软科专业排名</th><td>{{ plan.rankSoftware }}</td></tr>
              <tr v-if="plan.rankMaster"><th>软科硕士学科</th><td>{{ plan.rankMaster }}</td></tr>
              <tr v-if="plan.baoyanDetail"><th>专业保研率</th><td>{{ plan.baoyanDetail }}</td></tr>
              <tr v-if="plan.remarks"><th>专业备注</th><td class="text-amber-700">{{ plan.remarks }}</td></tr>
              <tr><th>选科要求</th><td>{{ plan.subjectReq || '—' }}</td></tr>
              <tr><th>学制 / 学费</th><td>{{ plan.duration || '—' }} / ¥{{ plan.tuition || '—' }}</td></tr>
              <tr><th>计划数</th><td>{{ plan.enrollNum26 || '—' }} 人</td></tr>
              <tr v-if="plan.diffSummary || plan.diff">
                <th>26变化</th>
                <td>
                  <div v-if="plan.diffSummary" class="font-bold text-orange-700">{{ plan.diffSummary }}</div>
                  <ul v-if="plan.diffStructured && plan.diffStructured.length" class="mt-1 space-y-1 text-xs">
                    <li v-for="(d, di) in plan.diffStructured" :key="di">
                      <template v-if="d.type==='rename'">
                        <b class="text-amber-700">改名:</b>
                        <span v-if="d.prefixSame" class="text-slate-500">(大类名未变: {{ d.oldPrefix }})</span>
                        <span v-else class="text-amber-700">{{ d.oldPrefix }} → {{ d.newPrefix }}</span>
                        <div v-if="(d.added || []).length" class="ml-3 text-green-700">＋ 添加 ({{ (d.added || []).length }}): {{ (d.added || []).join('、') }}</div>
                        <div v-if="(d.removed || []).length" class="ml-3 text-red-700">− 删除 ({{ (d.removed || []).length }}): {{ (d.removed || []).join('、') }}</div>
                        <div v-if="(d.kept || []).length" class="ml-3 text-slate-500">= 保留 ({{ (d.kept || []).length }}): {{ (d.kept || []).join('、') }}</div>
                      </template>
                      <template v-else-if="d.type==='num'">
                        <b>招生人数:</b>
                        <span :class="d.delta<0?'text-red-700':'text-green-700'">{{ d.delta>0?'+':'' }}{{ d.delta }}</span>
                      </template>
                      <template v-else-if="d.type==='tuition'">
                        <b>学费:</b> {{ d.from }} → {{ d.to }}
                      </template>
                      <template v-else-if="d.type==='new'"><b class="text-red-600">新增:</b> {{ d.text }}</template>
                      <template v-else-if="d.type==='stopped'"><b class="text-slate-600">停招:</b> {{ d.text }}</template>
                      <template v-else><span class="text-slate-500 italic">其它:</span> {{ d.text }}</template>
                    </li>
                  </ul>
                  <div v-else-if="plan.diff" class="text-xs text-slate-600 mt-1">{{ plan.diff }}</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 25 参考 -->
        <div class="border-t pt-3" v-if="!plan.isStopped">
          <h4 class="font-bold text-base mb-2">25 参考分数 <conf-badge :conf="plan.refConfidence"></conf-badge></h4>
          <table class="compact-table w-full">
            <tbody>
              <tr><th class="w-32">参考最低分</th><td class="font-bold text-blue-700">{{ plan.ref25Score }} 分</td></tr>
              <tr><th>参考最低位次</th><td class="font-bold text-blue-700">{{ plan.ref25Rank }} 名</td></tr>
              <tr><th>参考线差</th><td>{{ plan.ref25LineDiff }} 分</td></tr>
              <tr v-if="plan.refSource"><th>来源</th><td class="text-xs text-slate-600">{{ plan.refSource }}</td></tr>
            </tbody>
          </table>
        </div>

        <!-- 25 实际 (停招或对比) -->
        <div class="border-t pt-3" v-if="plan.score25">
          <h4 class="font-bold text-base mb-2">2025 实际录取</h4>
          <table class="compact-table w-full">
            <tbody>
              <tr v-if="plan.majorName25"><th class="w-32">25 招生专业</th><td>{{ plan.majorName25 }}</td></tr>
              <tr><th>25 最低分 / 位次 / 线差</th><td>{{ plan.score25 || '—' }} / {{ plan.rank25 || '—' }} / {{ plan.lineDiff25 || '—' }}</td></tr>
              <tr><th>25 计划 / 学费 / 学制</th><td>{{ plan.enrollNum25 || '—' }} 人 / ¥{{ plan.tuition25 || '—' }} / {{ plan.duration25 || '—' }}</td></tr>
              <tr v-if="plan.rankEval25"><th>25 学科评估</th><td>{{ plan.rankEval25 }}</td></tr>
              <tr v-if="plan.remarks25"><th>25 分流转专业</th><td>{{ plan.remarks25 }}</td></tr>
            </tbody>
          </table>
        </div>

        <!-- 历年录取 -->
        <div class="border-t pt-3" v-if="plan.history && (plan.history['24'] || plan.history['23'] || plan.history['22'])">
          <h4 class="font-bold text-base mb-2">历年录取</h4>
          <table class="compact-table w-full">
            <thead>
              <tr><th>年</th><th>人数</th><th>最低分</th><th>位次</th><th>线差</th></tr>
            </thead>
            <tbody>
              <template v-for="y in ['24','23','22']" :key="y">
                <tr v-if="plan.history && plan.history[y]">
                  <th>20{{ y }}</th>
                  <td>{{ plan.history[y].num }}</td>
                  <td>{{ plan.history[y].score }}</td>
                  <td>{{ plan.history[y].rank }}</td>
                  <td>{{ plan.history[y].lineDiff }}</td>
                </tr>
              </template>
              <tr>
                <th>2025</th>
                <td>{{ plan.enrollNum25 }}</td>
                <td>{{ plan.score25 }}</td>
                <td>{{ plan.rank25 }}</td>
                <td>{{ plan.lineDiff25 }}</td>
              </tr>
            </tbody>
          </table>
          <div class="mt-3"><canvas ref="chartRef" height="180"></canvas></div>
        </div>

        <!-- 预测 -->
        <div class="border-t pt-3" v-if="plan.predict">
          <h4 class="font-bold text-base mb-2">预测 (模型)</h4>
          <table class="compact-table w-full">
            <tbody>
              <tr><th class="w-32">预测分数 / 位次</th><td>{{ plan.predict.score || '—' }} / {{ plan.predict.rank || '—' }}</td></tr>
              <tr v-if="plan.predict.trend"><th>趋势</th><td>{{ plan.predict.trend }}</td></tr>
              <tr v-if="plan.predict.heat != null"><th>热度</th><td>{{ plan.predict.heat }}</td></tr>
            </tbody>
          </table>
        </div>

        <!-- 操作 -->
        <div class="border-t pt-3 flex gap-2">
          <button @click="$emit('toggle-favorite', plan.id)"
                  class="px-3 py-1.5 rounded border"
                  :class="favorites.has(plan.id) ? 'bg-rose-100 border-rose-300 text-rose-700' : 'hover:bg-slate-100'">
            {{ favorites.has(plan.id) ? '♥ 已收藏' : '♡ 收藏' }}
          </button>
          <button @click="$emit('toggle-compare', plan.id)"
                  class="px-3 py-1.5 rounded border"
                  :class="compareSet.has(plan.id) ? 'bg-amber-100 border-amber-300 text-amber-700' : 'hover:bg-slate-100'">
            {{ compareSet.has(plan.id) ? '✓ 在对比中' : '+ 加入对比' }}
          </button>
        </div>
      </div>
    </div>
  `,
};

// 对比栏
// 对比栏 (V7: 加数字差异高亮)
const CompareBar = {
  components: { TierBadge, ConfBadge },
  props: ["store", "plans"],
  setup(props) {
    // 取每个对比 plan 的值 (停招行用 25 字段)
    function val(p, key) {
      switch (key) {
        case "score":  return p.isStopped ? p.score25 : p.ref25Score;
        case "rank":   return p.isStopped ? p.rank25  : p.ref25Rank;
        case "tuition": return p.tuition ?? p.tuition25 ?? null;
        case "num":    return p.enrollNum26 ?? p.enrollNum25 ?? null;
        case "baoyan": return p.schoolBaoyan ?? null;
        case "schoolRank": return p.schoolRank ?? null;
      }
    }
    // direction: 'high-is-good' / 'low-is-good'
    // 计算每个 key 在所有对比 plan 里, 哪个是 best (绿), 哪个是 worst (红)
    const comparison = computed(() => {
      const ids = props.store.compareList;
      const planList = ids.map(id => props.plans[id]).filter(Boolean);
      if (planList.length < 2) return {};   // <2 不做高亮
      const fields = [
        { key: "score",      dir: "high" },   // 高分=好  (但对应录取门槛高=难考)
        { key: "rank",       dir: "low" },    // 位次小=好 (录取门槛高=难考)
        { key: "tuition",    dir: "low" },    // 学费低=好
        { key: "num",        dir: "high" },   // 计划多=好 (录取机会大)
        { key: "baoyan",     dir: "high" },   // 保研率高=好
        { key: "schoolRank", dir: "low" },    // 校排名低=好
      ];
      const result = {};
      for (const { key, dir } of fields) {
        const vals = planList.map(p => val(p, key)).filter(v => v != null);
        if (vals.length < 2) { result[key] = {}; continue; }
        const max = Math.max(...vals);
        const min = Math.min(...vals);
        result[key] = { best: dir === "high" ? max : min, worst: dir === "high" ? min : max };
      }
      return result;
    });
    function cellClass(p, key) {
      const v = val(p, key);
      const c = comparison.value[key];
      if (v == null || !c || c.best === c.worst) return "";
      if (v === c.best) return "compare-best";
      if (v === c.worst) return "compare-worst";
      return "";
    }
    return { val, cellClass };
  },
  template: `
    <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
      <div class="flex items-center justify-between mb-2">
        <h3 class="font-bold">📊 招生计划对比 ({{ store.compareList.length }}/4)
          <span class="text-xs font-normal text-slate-500 ml-2">绿=较优 / 红=较劣</span>
        </h3>
        <button @click="store.compareList.length = 0" class="text-sm text-slate-500 hover:underline">清空</button>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        <div v-for="id in store.compareList" :key="id" class="bg-white rounded p-2 text-sm relative">
          <button @click="store.compareList.splice(store.compareList.indexOf(id), 1)"
                  class="absolute top-1 right-1 text-slate-400 hover:text-red-500 text-lg leading-none">×</button>
          <template v-if="plans[id]">
            <div class="font-bold mb-1">
              <tier-badge :tag="plans[id].schoolTag"></tier-badge>
              {{ plans[id].schoolName }}
              <span v-if="plans[id].schoolRank" class="text-xs text-slate-400" :class="cellClass(plans[id], 'schoolRank')">#{{ plans[id].schoolRank }}</span>
            </div>
            <div class="text-xs text-slate-700 mb-1">{{ plans[id].majorName26 || plans[id].majorName25 }}</div>
            <div class="text-xs flex items-center gap-2 flex-wrap mt-1">
              <span>25 分</span>
              <b class="compare-cell" :class="cellClass(plans[id], 'score')">{{ val(plans[id], 'score') ?? '—' }}</b>
              <span>/ 位次</span>
              <b class="compare-cell" :class="cellClass(plans[id], 'rank')">{{ val(plans[id], 'rank') ?? '—' }}</b>
            </div>
            <div class="text-xs flex items-center gap-2 flex-wrap">
              <span>学费</span>
              <b class="compare-cell" :class="cellClass(plans[id], 'tuition')">¥{{ val(plans[id], 'tuition') ?? '—' }}</b>
              <span>· 计划</span>
              <b class="compare-cell" :class="cellClass(plans[id], 'num')">{{ val(plans[id], 'num') ?? '—' }}</b>
              <span>人</span>
            </div>
            <div class="text-xs" v-if="plans[id].schoolBaoyan">
              校保研率
              <b class="compare-cell" :class="cellClass(plans[id], 'baoyan')">{{ (plans[id].schoolBaoyan*100).toFixed(1) }}%</b>
            </div>
            <div class="text-xs" v-if="plans[id].rankEval || plans[id].rankEval25">
              评估: {{ plans[id].rankEval || plans[id].rankEval25 }}
            </div>
          </template>
        </div>
      </div>
    </div>
  `,
};

// 收藏栏
const FavoritesBar = {
  components: { TierBadge },
  props: ["store", "plans", "ui", "cwb"],
  emits: ["open-detail", "clear"],
  setup(props) {
    function exportFavCsv() {
      const ids = Array.from(props.store.favorites);
      const rows = ids.map(id => props.plans[id]).filter(Boolean);
      if (rows.length === 0) return;
      const cols = ["schoolName", "majorName26", "city", "schoolTag", "ref25Score",
                    "ref25Rank", "enrollNum26", "tuition", "subjectReq", "duration",
                    "rankEval", "remarks"];
      const head = ["学校","专业","城市","标签","25参考分","25参考位次","计划数","学费","选科","学制","学科评估","备注"];
      const csv = [head.join(","), ...rows.map(r => cols.map(c => JSON.stringify(r[c] ?? "")).join(","))].join("\n");
      const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `我的收藏_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
    // 3.16.2: 收藏配额计算
    function tierCounts() {
      if (!props.cwb) return null;
      const counts = { chong: 0, wen: 0, bao: 0, other: 0 };
      for (const id of props.store.favorites) {
        const p = props.plans[id];
        if (!p) continue;
        const t = planTier(p, props.cwb);
        if (t) counts[t]++;
        else counts.other++;
      }
      const targets = {
        chong: Math.round(props.ui.totalVolunteers * props.ui.ratioChong),
        wen:   Math.round(props.ui.totalVolunteers * props.ui.ratioWen),
        bao:   Math.round(props.ui.totalVolunteers * props.ui.ratioBao),
      };
      return { counts, targets };
    }
    // 3.16.3: 按档分组 CSV 导出
    function exportFavByTier() {
      const ids = Array.from(props.store.favorites);
      if (!ids.length) { alert("收藏为空"); return; }
      // 按 tier 分组
      const groups = { chong: [], wen: [], bao: [], other: [] };
      for (const id of ids) {
        const p = props.plans[id];
        if (!p) continue;
        const t = props.cwb ? planTier(p, props.cwb) : null;
        (groups[t] || groups.other).push(p);
      }
      const cols = ["schoolName", "majorName26", "majorName25", "city", "schoolTag",
                    "ref25Score", "ref25Rank", "score25", "rank25",
                    "enrollNum26", "tuition", "subjectReq", "duration",
                    "rankEval", "rankSoftware", "baoyanDetail", "remarks", "diffSummary"];
      const head = ["学校","26招生专业","25招生专业","城市","标签",
                    "25参考分","25参考位次","25实际分","25实际位次",
                    "26计划数","学费","选科","学制","学科评估","软科评级","保研率","备注","变化"];
      const esc = v => {
        if (v == null) return "";
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      };
      const lines = ["档,序号," + head.join(",")];
      const labels = { chong: "冲档", wen: "稳档", bao: "保档", other: "未分类" };
      for (const tier of ["chong", "wen", "bao", "other"]) {
        const g = groups[tier];
        if (!g.length) continue;
        lines.push(`${labels[tier]} (${g.length} 条):`);
        g.forEach((p, i) => {
          lines.push(`${labels[tier]},${i + 1},` + cols.map(c => esc(p[c])).join(","));
        });
      }
      const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `志愿单_按档分组_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
    return { exportFavCsv, exportFavByTier, tierCounts, planTier };
  },
  template: `
    <div class="bg-rose-50 border border-rose-200 rounded-lg p-3 mb-4">
      <div class="flex items-center justify-between mb-2">
        <h3 class="font-bold">♥ 我的收藏 ({{ store.favorites.size }})</h3>
        <div class="flex gap-2">
          <button @click="exportFavCsv" class="text-sm text-blue-600 hover:underline">导出 CSV</button>
          <button v-if="cwb" @click="exportFavByTier" class="text-sm text-amber-600 hover:underline">按档导出</button>
          <button @click="$emit('clear')" class="text-sm text-slate-500 hover:underline">清空</button>
        </div>
      </div>
      <!-- 3.16.2: 配额提示 -->
      <div v-if="cwb && tierCounts()" class="flex gap-3 mb-2 text-xs flex-wrap">
        <template v-for="tier in ['chong', 'wen', 'bao']" :key="tier">
          <span class="quota-chip" :class="['quota-'+tier,
                tierCounts().counts[tier] >= tierCounts().targets[tier] ? 'quota-ok' :
                tierCounts().counts[tier] === 0 ? 'quota-empty' : 'quota-warn']">
            {{ tier === 'chong' ? '冲' : tier === 'wen' ? '稳' : '保' }}
            <b>{{ tierCounts().counts[tier] }}/{{ tierCounts().targets[tier] }}</b>
            <span v-if="tierCounts().counts[tier] >= tierCounts().targets[tier]">✓</span>
            <span v-else-if="tierCounts().counts[tier] === 0">✗</span>
            <span v-else>⚠</span>
          </span>
        </template>
        <span class="quota-chip quota-other" v-if="tierCounts().counts.other > 0">
          未分类 <b>{{ tierCounts().counts.other }}</b>
        </span>
      </div>
      <div v-if="store.favorites.size === 0" class="text-sm text-slate-400">
        点击卡片右上方 ♥ 收藏感兴趣的招生计划
      </div>
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        <template v-for="id in Array.from(store.favorites)" :key="id">
          <div v-if="plans[id]"
               class="bg-white rounded p-2 text-sm cursor-pointer hover:shadow"
               :class="cwb && planTier(plans[id], cwb) ? 'border-l-4 tier-border-'+planTier(plans[id], cwb) : ''"
               @click="$emit('open-detail', plans[id])">
            <div class="font-bold">
              <tier-badge :tag="plans[id].schoolTag"></tier-badge>
              {{ plans[id].schoolName }}
            </div>
            <div class="text-xs text-slate-700">{{ plans[id].majorName26 || plans[id].majorName25 }}</div>
            <div class="text-xs text-blue-700">
              {{ plans[id].isStopped ? plans[id].score25 : plans[id].ref25Score }} 分
              / {{ plans[id].isStopped ? plans[id].rank25 : plans[id].ref25Rank }} 名
            </div>
          </div>
        </template>
      </div>
    </div>
  `,
};

// === 排序设置 modal ===
const PrioritySettings = {
  props: ["priority", "overrides", "filters"],
  emits: ["close", "save", "reset"],
  setup(props, { emit }) {
    const activeTab = ref("schools");
    const tabs = [
      { key: "schools",      label: "学校",   nameKey: "name", filterKey: "schoolPriorityRange", mode: "range" },
      { key: "cities",       label: "城市",   nameKey: "city", filterKey: "cityPriorityMax",     mode: "max" },
      { key: "majorClasses", label: "专业类", nameKey: "name", filterKey: "majorClassPriorityMax", mode: "max" },
    ];

    // 编辑中的列表 (复制原 priority 数据 + 应用现有 override)
    const editing = reactive({ schools: [], cities: [], majorClasses: [] });
    function initEditing() {
      if (!props.priority) return;
      for (const tab of tabs) {
        const items = props.priority[tab.key] || [];
        const ov = props.overrides[tab.key];
        if (ov && ov.length) {
          const m = new Map(items.map(it => [it[tab.nameKey], it]));
          const ordered = ov.map(n => m.get(n)).filter(Boolean);
          const used = new Set(ov);
          for (const it of items) if (!used.has(it[tab.nameKey])) ordered.push(it);
          editing[tab.key] = ordered;
        } else {
          editing[tab.key] = [...items].sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999));
        }
      }
    }
    initEditing();
    watch(() => props.priority, initEditing);

    const currentTab = computed(() => tabs.find(t => t.key === activeTab.value));
    const currentItems = computed(() => editing[activeTab.value]);
    const currentTopN = computed(() => {
      const t = currentTab.value;
      if (!t) return 0;
      if (t.mode === "range") {
        // 学校用第二端值作为 top N (默认 18)
        return props.filters[t.filterKey]?.[1] || 18;
      }
      return props.filters[t.filterKey] || 0;
    });

    function move(idx, delta) {
      const arr = editing[activeTab.value];
      const j = idx + delta;
      if (j < 0 || j >= arr.length) return;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
    }
    function moveToTop(idx) {
      const arr = editing[activeTab.value];
      if (idx > 0) {
        const [item] = arr.splice(idx, 1);
        arr.unshift(item);
      }
    }
    function moveToBottom(idx) {
      const arr = editing[activeTab.value];
      if (idx < arr.length - 1) {
        const [item] = arr.splice(idx, 1);
        arr.push(item);
      }
    }
    function moveToPosition(idx) {
      const arr = editing[activeTab.value];
      const target = prompt(`把 "${arr[idx][currentTab.value.nameKey]}" 移到第几位? (1-${arr.length})`, idx + 1);
      const n = parseInt(target, 10);
      if (!n || n < 1 || n > arr.length) return;
      const [item] = arr.splice(idx, 1);
      arr.splice(n - 1, 0, item);
    }
    function resetTab() {
      if (!confirm(`重置 "${currentTab.value.label}" 排序为默认?`)) return;
      const items = props.priority[activeTab.value] || [];
      editing[activeTab.value] = [...items].sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999));
    }
    function save() {
      const out = {};
      for (const tab of tabs) {
        out[tab.key] = editing[tab.key].map(it => it[tab.nameKey]);
      }
      emit("save", out);
    }
    function chipSubLabel(item, tabKey) {
      if (tabKey === "schools") return `[${(item.tag || '').split('/')[0]}] ${item.city} · 排名 ${item.rank}`;
      if (tabKey === "cities") return ``;
      if (tabKey === "majorClasses") return `[${item.category}]`;
      return "";
    }
    return { tabs, activeTab, editing, currentTab, currentItems, currentTopN,
             move, moveToTop, moveToBottom, moveToPosition, resetTab, save, chipSubLabel };
  },
  template: `
    <div class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
         @click.self="$emit('close')">
      <div class="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div class="flex items-center justify-between p-3 border-b">
          <h3 class="font-bold text-lg">⚙ 排序设置</h3>
          <button @click="$emit('close')" class="text-2xl leading-none text-slate-400 hover:text-red-500">×</button>
        </div>
        <!-- Tabs -->
        <div class="flex border-b">
          <button v-for="t in tabs" :key="t.key"
                  @click="activeTab = t.key"
                  class="px-4 py-2 text-sm border-b-2"
                  :class="activeTab === t.key ? 'border-blue-600 text-blue-600 font-bold' : 'border-transparent text-slate-500 hover:bg-slate-50'">
            {{ t.label }} ({{ editing[t.key].length }})
          </button>
        </div>
        <!-- 列表 -->
        <div class="flex-1 overflow-y-auto p-3">
          <div class="text-xs text-slate-500 mb-2">
            当前 Top {{ currentTopN }} 在分隔线之上。点击 ↑/↓ 调整顺序, 或点击序号 # 跳位。
            <button @click="resetTab" class="ml-2 text-amber-600 hover:underline">重置当前 tab 为默认</button>
          </div>
          <div class="space-y-0.5">
            <template v-for="(item, idx) in currentItems" :key="item[currentTab.nameKey] + idx">
              <!-- 分隔线 -->
              <div v-if="idx === currentTopN" class="text-center text-xs text-slate-400 my-2 border-t pt-1">
                ── Top {{ currentTopN }} 分隔线 ──
              </div>
              <div class="priority-row flex items-center gap-2 p-1.5 hover:bg-slate-50 border-b">
                <button @click="moveToPosition(idx)"
                        class="w-10 text-right text-xs text-slate-500 hover:text-blue-600"
                        title="点击跳位">#{{ idx + 1 }}</button>
                <span class="flex-1 text-sm">
                  {{ item[currentTab.nameKey] }}
                  <span class="text-xs text-slate-400 ml-2">{{ chipSubLabel(item, currentTab.key) }}</span>
                </span>
                <button @click="moveToTop(idx)" :disabled="idx === 0"
                        class="px-1 disabled:opacity-30 hover:bg-blue-50" title="置顶">⇈</button>
                <button @click="move(idx, -1)" :disabled="idx === 0"
                        class="px-1 disabled:opacity-30 hover:bg-blue-50" title="上移">↑</button>
                <button @click="move(idx, 1)" :disabled="idx === currentItems.length - 1"
                        class="px-1 disabled:opacity-30 hover:bg-blue-50" title="下移">↓</button>
                <button @click="moveToBottom(idx)" :disabled="idx === currentItems.length - 1"
                        class="px-1 disabled:opacity-30 hover:bg-blue-50" title="置底">⇊</button>
              </div>
            </template>
          </div>
        </div>
        <!-- Footer -->
        <div class="flex items-center justify-between p-3 border-t">
          <button @click="$emit('reset')" class="text-sm text-red-500 hover:underline">重置全部默认</button>
          <div class="flex gap-2">
            <button @click="$emit('close')" class="px-3 py-1 border rounded text-sm hover:bg-slate-100">取消</button>
            <button @click="save" class="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">保存并应用</button>
          </div>
        </div>
      </div>
    </div>
  `,
};

// ========== 主 App ==========

createApp({
  components: {
    ScoreTool, FilterPanel, ResultList, PlanCard, DetailDrawer, CompareBar, FavoritesBar,
    PrioritySettings,
  },
  setup() {
    const loading = ref(true);
    const loadingMsg = ref("");
    const loadingPct = ref(0);
    const scoreRank = ref(null);
    const meta = ref(null);
    const priority = ref(null);
    const currentPage = ref(1);

    // 加载数据
    async function load() {
      loading.value = true;
      const t = "?_t=" + Date.now();  // bust cache (Item 4 刷新)
      loadingMsg.value = "下载 plans.json (约 15MB)...";
      loadingPct.value = 10;
      const r1 = await fetch("data/plans.json" + t);
      loadingPct.value = 30;
      store.allPlans = await r1.json();
      loadingPct.value = 50;

      loadingMsg.value = "下载 score_rank.json...";
      const r2 = await fetch("data/score_rank.json" + t);
      scoreRank.value = await r2.json();
      loadingPct.value = 70;

      loadingMsg.value = "下载 priority.json...";
      const r3 = await fetch("data/priority.json" + t);
      priority.value = await r3.json();
      loadingPct.value = 85;

      loadingMsg.value = "下载 meta.json...";
      const r4 = await fetch("data/meta.json" + t);
      meta.value = await r4.json();
      loadingPct.value = 100;

      console.log(`Loaded ${store.allPlans.length} plans, ${priority.value.schools.length} schools, ${priority.value.cities.length} cities, ${priority.value.majorClasses.length} major classes`);
      loading.value = false;
    }
    onMounted(load);

    // Mobile: 默认卡片视图 + 默认侧栏收起 (首次加载, 不覆盖已存的 layout)
    onMounted(() => {
      if (isMobile()) {
        if (!layoutInit.sidebarCollapsed && layoutInit.sidebarCollapsed !== false) {
          store.sidebarCollapsed = true;
        }
        if (store.viewMode === "table") store.viewMode = "list";
      }
    });

    // P2.2: URL hash 同步 (filters → hash, 双向)
    let hashUpdating = false;
    function applyHash() {
      const h = location.hash.replace(/^#/, "");
      if (!h) return;
      const obj = decodeHash(h);
      if (!obj) return;
      hashUpdating = true;
      Object.assign(store.filters, deserializeFilters(obj));
      setTimeout(() => { hashUpdating = false; }, 100);
    }
    // 启动后等数据加载完, 应用一次
    watch(() => loading.value, isLoading => {
      if (!isLoading) applyHash();
    });
    // filters 改变 → 更新 hash (debounce 500ms)
    let hashTimer = null;
    watch(() => store.filters, () => {
      if (hashUpdating) return;
      clearTimeout(hashTimer);
      hashTimer = setTimeout(() => {
        const encoded = encodeHash(serializeFilters(store.filters));
        history.replaceState(null, "", "#" + encoded);
      }, 500);
    }, { deep: true });
    // 用户手动改 hash (e.g. 粘贴链接) → 应用
    window.addEventListener("hashchange", applyHash);

    function copyShareLink() {
      const url = location.href;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(
          () => alert("链接已复制!\n" + (url.length > 100 ? url.slice(0, 100) + "..." : url)),
          () => alert("复制失败, 请手动复制 URL")
        );
      } else {
        prompt("复制此链接:", url);
      }
    }

    // Item 4 (V4): 刷新按钮 — 静默重新加载, 不全屏 loading, 不动 filters
    async function reloadData() {
      try {
        const t = "?_t=" + Date.now();
        const [r1, r2, r3, r4] = await Promise.all([
          fetch("data/plans.json" + t),
          fetch("data/score_rank.json" + t),
          fetch("data/priority.json" + t),
          fetch("data/meta.json" + t),
        ]);
        store.allPlans = await r1.json();
        scoreRank.value = await r2.json();
        priority.value = await r3.json();
        meta.value = await r4.json();
        console.log("Data refreshed.");
      } catch (e) {
        console.error("Refresh failed:", e);
        alert("刷新失败: " + e.message);
      }
    }

    // Item 11: 列设置 panel 点空白处收起
    function onDocMouseDown(ev) {
      const panel = document.querySelector(".col-settings-panel");
      if (panel && !panel.contains(ev.target)) {
        ui.showColSettings = false;
      }
    }
    watch(() => ui.showColSettings, (on) => {
      if (on) document.addEventListener("mousedown", onDocMouseDown);
      else document.removeEventListener("mousedown", onDocMouseDown);
    });

    // 冲稳保区间 (响应顶部分数 + 等位基准)
    const cwb = computed(() =>
      scoreRank.value ? computeChongWenBao(ui.myScore, scoreRank.value, ui.equivSource) : null);

    // 监听 cwb 变化 → 自动填充 3 段范围 (用户没手改时)
    watch(cwb, (val) => {
      if (!val) return;
      const r = val.ranges;
      store.filters.scoreRanges = [
        { tier: "chong", low: r.chong.scoreLow, high: r.chong.scoreHigh },
        { tier: "wen",   low: r.wen.scoreLow,   high: r.wen.scoreHigh },
        { tier: "bao",   low: r.bao.scoreLow,   high: r.bao.scoreHigh },
      ];
      // 位次范围只在用户启用时有意义, 但先填好
      if (r.chong.rankLow != null) {
        store.filters.rankRanges = [
          { tier: "chong", low: r.chong.rankLow, high: r.chong.rankHigh },
          { tier: "wen",   low: r.wen.rankLow,   high: r.wen.rankHigh },
          { tier: "bao",   low: r.bao.rankLow,   high: r.bao.rankHigh },
        ];
      }
    });

    // 排序后的 priority 数据 (overrides 优先, 否则用 priority.json 默认 sort 字段)
    const sortedPriority = computed(() => {
      if (!priority.value) return null;
      const ov = store.priorityOverrides || {};
      function applyOv(items, override, nameKey) {
        if (!override || !override.length) {
          // 默认: 按 sort 字段升序 (priority.json 已基本按 sort 排, 但显式保险)
          return [...items].sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999));
        }
        // override 是名字数组, 按这个顺序; 未在 override 中的追加末尾
        const m = new Map(items.map(it => [it[nameKey], it]));
        const ordered = override.map(n => m.get(n)).filter(Boolean);
        const used = new Set(override);
        for (const it of items) if (!used.has(it[nameKey])) ordered.push(it);
        return ordered;
      }
      return {
        schools: applyOv(priority.value.schools, ov.schools, "name"),
        cities:  applyOv(priority.value.cities, ov.cities, "city"),
        majorClasses: applyOv(priority.value.majorClasses, ov.majorClasses, "name"),
      };
    });

    // V5 bug fix + V7: 用 sortedPriority 的索引位置 (而非 sort 字段) 算 allowed 集合
    const allowedSets = computed(() => {
      if (!sortedPriority.value) return null;
      const f = store.filters;
      const sp = sortedPriority.value;
      // 学校: 双端范围 → 取 sp.schools 的 [lo-1, hi) 索引切片
      const sLo = Math.max(0, (f.schoolPriorityRange[0] || 1) - 1);
      const sHi = f.schoolPriorityRange[1] || sp.schools.length;
      return {
        schools: new Set(sp.schools.slice(sLo, sHi).map(s => s.name)),
        cities:  new Set(sp.cities.slice(0, f.cityPriorityMax).map(c => c.city)),
        majorClasses: new Set(sp.majorClasses.slice(0, f.majorClassPriorityMax).map(c => c.name)),
      };
    });
    // 筛选 / 排序
    const filtered = computed(() => applyFilters(store.allPlans, store.filters, allowedSets.value));
    // 自动补全候选池: 应用其他筛选条件, 但清空关键词维度 (Item 7 第3轮)
    const keywordCandidatePool = computed(() => {
      const f = {
        ...store.filters,
        keyword: "",
        pickedSchool: null,
        pickedMajorClass: null,
        pickedMajorName: null,
      };
      return applyFilters(store.allPlans, f, allowedSets.value);
    });
    const sorted = computed(() => applySort(filtered.value, store.sortKeys));
    const paged = computed(() => {
      // voluntary 视图: 用志愿单 array 作为数据源 (按用户志愿顺序)
      if (store.viewMode === "voluntary") {
        const m = planByIdMap.value;
        return store.voluntary.map(id => m[id]).filter(Boolean);
      }
      if (!store.pageSize) return sorted.value;
      const start = (currentPage.value - 1) * store.pageSize;
      return sorted.value.slice(start, start + store.pageSize);
    });

    // 筛选变化 -> 重置到第一页
    watch(filtered, () => { currentPage.value = 1; });

    // 3.16.1: 三栏目标志愿数
    const paneTargets = computed(() => ({
      chong: Math.round(ui.totalVolunteers * ui.ratioChong),
      wen:   Math.round(ui.totalVolunteers * ui.ratioWen),
      bao:   Math.round(ui.totalVolunteers * ui.ratioBao),
    }));
    // 志愿单各档计数 (供 voluntary 视图顶部显示)
    const voluntaryTierCounts = computed(() => {
      const c = { chong: 0, wen: 0, bao: 0 };
      if (!cwb.value) return c;
      const m = planByIdMap.value;
      for (const id of store.voluntary) {
        const p = m[id];
        if (!p) continue;
        const t = planTier(p, cwb.value);
        if (t) c[t]++;
      }
      return c;
    });
    // 志愿单按档导出
    function exportVoluntaryByTier() {
      if (!store.voluntary.length) { alert("志愿单为空"); return; }
      const m = planByIdMap.value;
      const cols = ["schoolName", "majorName26", "majorName25", "city", "schoolTag",
                    "ref25Score", "ref25Rank", "score25", "rank25",
                    "enrollNum26", "tuition", "subjectReq", "duration",
                    "rankEval", "rankSoftware", "baoyanDetail", "remarks", "diffSummary"];
      const head = ["学校","26招生专业","25招生专业","城市","标签",
                    "25参考分","25参考位次","25实际分","25实际位次",
                    "26计划数","学费","选科","学制","学科评估","软科评级","保研率","备注","变化"];
      const esc = v => {
        if (v == null) return "";
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      };
      // 按 tier 分组, 但保持志愿单内顺序
      const groups = { chong: [], wen: [], bao: [], other: [] };
      const orderMap = new Map();
      store.voluntary.forEach((id, i) => orderMap.set(id, i + 1));
      for (const id of store.voluntary) {
        const p = m[id];
        if (!p) continue;
        const t = cwb.value ? planTier(p, cwb.value) : null;
        (groups[t] || groups.other).push({ p, idx: orderMap.get(id) });
      }
      const lines = ["档,志愿序号," + head.join(",")];
      const labels = { chong: "冲档", wen: "稳档", bao: "保档", other: "未分类" };
      for (const tier of ["chong", "wen", "bao", "other"]) {
        const g = groups[tier];
        if (!g.length) continue;
        lines.push(`${labels[tier]} (${g.length} 条):`);
        for (const { p, idx } of g) {
          lines.push(`${labels[tier]},#${idx},` + cols.map(c => esc(p[c])).join(","));
        }
      }
      const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `志愿单_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }

    // 当前筛后各档计数 (供表格头显示)
    const filteredTierCounts = computed(() => {
      const c = { chong: 0, wen: 0, bao: 0 };
      if (!cwb.value) return c;
      for (const p of filtered.value) {
        const t = planTier(p, cwb.value);
        if (t) c[t]++;
      }
      return c;
    });

    // tier 映射 (id -> 'chong'|'wen'|'bao'|null)
    const tierMap = computed(() => {
      const m = new Map();
      if (!cwb.value) return m;
      for (const p of paged.value) {
        const t = planTier(p, cwb.value);
        if (t) m.set(p.id, t);
      }
      return m;
    });

    // id -> plan 映射 (供对比 / 收藏 用)
    const planByIdMap = computed(() => {
      const m = {};
      for (const p of store.allPlans) m[p.id] = p;
      return m;
    });

    const compareIdSet = computed(() => new Set(store.compareList));

    // 操作
    function openDetail(plan) { ui.detailPlan = plan; }
    function toggleCompare(id) {
      const i = store.compareList.indexOf(id);
      if (i >= 0) store.compareList.splice(i, 1);
      else if (store.compareList.length < 4) store.compareList.push(id);
      else alert("对比最多 4 项");
    }
    function toggleFavorite(id) {
      if (store.favorites.has(id)) store.favorites.delete(id);
      else store.favorites.add(id);
      store.favorites = new Set(store.favorites);
    }
    // 志愿单操作
    const voluntarySet = computed(() => new Set(store.voluntary));
    function isInVoluntary(id) { return voluntarySet.value.has(id); }
    function voluntaryIndex(id) {
      const i = store.voluntary.indexOf(id);
      return i >= 0 ? i + 1 : 0;
    }
    function toggleVoluntary(id) {
      const i = store.voluntary.indexOf(id);
      if (i >= 0) store.voluntary.splice(i, 1);
      else store.voluntary.push(id);
    }
    function moveVoluntaryUp(id) {
      const i = store.voluntary.indexOf(id);
      if (i > 0) {
        const arr = [...store.voluntary];
        [arr[i-1], arr[i]] = [arr[i], arr[i-1]];
        store.voluntary = arr;
      }
    }
    function moveVoluntaryDown(id) {
      const i = store.voluntary.indexOf(id);
      if (i >= 0 && i < store.voluntary.length - 1) {
        const arr = [...store.voluntary];
        [arr[i+1], arr[i]] = [arr[i], arr[i+1]];
        store.voluntary = arr;
      }
    }
    function moveVoluntaryToTop(id) {
      const i = store.voluntary.indexOf(id);
      if (i > 0) {
        const arr = [...store.voluntary];
        const [item] = arr.splice(i, 1);
        arr.unshift(item);
        store.voluntary = arr;
      }
    }
    function moveVoluntaryToBottom(id) {
      const i = store.voluntary.indexOf(id);
      if (i >= 0 && i < store.voluntary.length - 1) {
        const arr = [...store.voluntary];
        const [item] = arr.splice(i, 1);
        arr.push(item);
        store.voluntary = arr;
      }
    }
    function clearVoluntary() {
      if (confirm(`确认清空当前志愿单 (${store.voluntary.length} 项)?`)) {
        store.voluntary = [];
      }
    }
    function toggleExpand(id) {
      // V4 Item 8: 单展开模式. 点击其他行自动关闭当前展开行.
      const wasOpen = store.expandedRows.has(id);
      store.expandedRows = wasOpen ? new Set() : new Set([id]);
    }
    function saveFavorites() { saveLS(LS_KEY_FAV, Array.from(store.favorites)); }
    function resetFilters() {
      Object.assign(store.filters, initialFilters());
      // 重置后再次填充 cwb 范围
      if (cwb.value) {
        const r = cwb.value.ranges;
        store.filters.scoreRanges = [
          { tier: "chong", low: r.chong.scoreLow, high: r.chong.scoreHigh },
          { tier: "wen",   low: r.wen.scoreLow,   high: r.wen.scoreHigh },
          { tier: "bao",   low: r.bao.scoreLow,   high: r.bao.scoreHigh },
        ];
      }
    }

    // P2.1: 筛选预设管理
    function savePreset() {
      const name = prompt("预设名 (e.g. 我的稳档):");
      if (!name) return;
      const filters = JSON.parse(JSON.stringify(serializeFilters(store.filters)));
      const existing = store.presets.findIndex(p => p.name === name);
      if (existing >= 0) {
        if (!confirm(`"${name}" 已存在, 覆盖?`)) return;
        store.presets[existing].filters = filters;
      } else {
        store.presets.push({ name, filters });
      }
      store.presets = [...store.presets];   // trigger watch
    }
    function loadPreset(idx) {
      const p = store.presets[idx];
      if (!p) return;
      Object.assign(store.filters, deserializeFilters(p.filters));
    }
    function deletePreset(idx) {
      if (!confirm(`删除预设 "${store.presets[idx]?.name}"?`)) return;
      store.presets.splice(idx, 1);
      store.presets = [...store.presets];
    }
    function renamePreset(idx) {
      const old = store.presets[idx]?.name;
      const name = prompt("新名:", old);
      if (!name || name === old) return;
      store.presets[idx].name = name;
      store.presets = [...store.presets];
    }

    // 冲稳保 应用到筛选 (单档 toggle)
    // 当前若已经只是该档 → 还原 3 档全有; 否则切到单档
    function onApplyTier(tier, range) {
      const isCurrentlyOnly = store.filters.scoreRanges.length === 1
        && store.filters.scoreRanges[0].tier === tier;
      if (isCurrentlyOnly && cwb.value) {
        const r = cwb.value.ranges;
        store.filters.scoreRanges = [
          { tier: "chong", low: r.chong.scoreLow, high: r.chong.scoreHigh },
          { tier: "wen",   low: r.wen.scoreLow,   high: r.wen.scoreHigh },
          { tier: "bao",   low: r.bao.scoreLow,   high: r.bao.scoreHigh },
        ];
        if (r.chong.rankLow != null) {
          store.filters.rankRanges = [
            { tier: "chong", low: r.chong.rankLow, high: r.chong.rankHigh },
            { tier: "wen",   low: r.wen.rankLow,   high: r.wen.rankHigh },
            { tier: "bao",   low: r.bao.rankLow,   high: r.bao.rankHigh },
          ];
        }
      } else {
        store.filters.scoreRanges = [{ tier, low: range.scoreLow, high: range.scoreHigh }];
        store.filters.enableScoreRange = true;
        if (range.rankLow != null) {
          store.filters.rankRanges = [{ tier, low: range.rankLow, high: range.rankHigh }];
        }
      }
      currentPage.value = 1;
    }
    // 比例调节
    const ratioSumOk = computed(() => {
      const sum = ui.ratioChong + ui.ratioWen + ui.ratioBao;
      return Math.abs(sum - 1.0) < 0.005;     // 允许 ±0.5% 浮点误差
    });
    function resetRatios() {
      ui.ratioChong = 0.25;
      ui.ratioWen = 0.45;
      ui.ratioBao = 0.30;
      ui.totalVolunteers = 112;
    }
    // 点击空白处关闭 比例 popover
    function onRatioDocMouseDown(ev) {
      const panel = document.querySelector(".ratio-popover");
      if (panel && !panel.contains(ev.target)) ui.showRatioPanel = false;
    }
    watch(() => ui.showRatioPanel, on => {
      if (on) document.addEventListener("mousedown", onRatioDocMouseDown);
      else document.removeEventListener("mousedown", onRatioDocMouseDown);
    });

    // 当前单档激活状态 (头部按钮高亮用)
    const activeTier = computed(() => {
      if (store.filters.scoreRanges.length !== 1) return null;
      return store.filters.scoreRanges[0].tier;
    });

    // ===== 列管理 (Items 6.2 / 6.3) =====
    // 默认隐藏一些列; 用户也可手动改
    if (!layoutInit.hiddenColumns) {
      for (const k of DEFAULT_HIDDEN_COLS) store.hiddenColumns.add(k);
    }

    const allColumns = COLUMNS;
    // 按 columnOrder 排序; 没有 columnOrder 时按 COLUMNS 默认; 过滤掉 hiddenColumns
    const visibleColumns = computed(() => {
      const orderMap = new Map();
      const ord = store.columnOrder || COLUMNS.map(c => c.key);
      ord.forEach((k, i) => orderMap.set(k, i));
      // 任何未在 ord 中的 (新加的列) 追加到末尾
      const result = [...COLUMNS];
      result.sort((a, b) => {
        const ai = orderMap.has(a.key) ? orderMap.get(a.key) : 999;
        const bi = orderMap.has(b.key) ? orderMap.get(b.key) : 999;
        return ai - bi;
      });
      return result.filter(c => !store.hiddenColumns.has(c.key));
    });
    function toggleColumn(key) {
      const s = new Set(store.hiddenColumns);
      if (s.has(key)) s.delete(key);
      else s.add(key);
      store.hiddenColumns = s;
    }
    function resetColumns() {
      store.hiddenColumns = new Set(DEFAULT_HIDDEN_COLS);
      store.columnOrder = null;
      store.columnWidths = {};
    }
    // 列宽变化 → 存到 store (持久化)
    function onColResize({ key, width }) {
      store.columnWidths = { ...store.columnWidths, [key]: width };
    }
    // 排序设置 modal handlers
    function savePriorityOverrides(out) {
      store.priorityOverrides = out;
      ui.showPrioritySettings = false;
    }
    function resetPriorityOverrides() {
      if (!confirm("重置所有优先次序为默认 (priority.json 自带顺序)?")) return;
      store.priorityOverrides = { schools: null, cities: null, majorClasses: null };
      ui.showPrioritySettings = false;
    }
    function onColDrop({ from, to }) {
      const order = store.columnOrder || COLUMNS.map(c => c.key);
      const next = [...order];
      const fi = next.indexOf(from), ti = next.indexOf(to);
      if (fi < 0 || ti < 0) return;
      next.splice(fi, 1);
      next.splice(ti, 0, from);
      store.columnOrder = next;
    }

    // ===== 排序 (Item 6.1) =====
    function onSortCol(field) {
      const arr = [...store.sortKeys];
      const i = arr.findIndex(k => k.field === field);
      if (i < 0) {
        arr.push({ field, dir: "asc" });
      } else if (arr[i].dir === "asc") {
        arr[i] = { field, dir: "desc" };
      } else {
        arr.splice(i, 1);
      }
      store.sortKeys = arr;
    }
    function sortFieldLabel(field) { return SORT_FIELD_LABEL[field] || field; }
    function toggleSortDir(i) {
      const arr = [...store.sortKeys];
      arr[i] = { ...arr[i], dir: arr[i].dir === "asc" ? "desc" : "asc" };
      store.sortKeys = arr;
    }
    function removeSortKey(i) {
      const arr = [...store.sortKeys];
      arr.splice(i, 1);
      store.sortKeys = arr;
    }
    let sortDragIndex = -1;
    function onSortDragStart(i) { sortDragIndex = i; }
    function onSortDrop(i) {
      if (sortDragIndex < 0 || sortDragIndex === i) return;
      const arr = [...store.sortKeys];
      const [m] = arr.splice(sortDragIndex, 1);
      arr.splice(i, 0, m);
      store.sortKeys = arr;
      sortDragIndex = -1;
    }

    // CSV 导出
    function exportCsv() {
      const cols = ["schoolName", "majorName26", "majorName25", "city", "province", "schoolTag",
                    "ref25Score", "ref25Rank", "score25", "rank25",
                    "enrollNum26", "tuition", "subjectReq", "duration",
                    "rankEval", "rankSoftware", "baoyanDetail", "remarks", "diff"];
      const head = ["学校","26招生专业","25招生专业","城市","省","标签",
                    "25参考分","25参考位次","25实际分","25实际位次",
                    "26计划数","学费","选科","学制","学科评估","软科评级","保研率","备注","变化"];
      const data = filtered.value;
      const csv = [head.join(","), ...data.map(r => cols.map(c => {
        const v = r[c];
        if (v == null) return "";
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      }).join(","))].join("\n");
      const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `招生计划_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }

    function toggleDark() {
      ui.dark = !ui.dark;
      document.documentElement.classList.toggle("dark", ui.dark);
    }

    // 3.18: 截图
    async function takeScreenshot() {
      if (!window.html2canvas) { alert("截图库未加载"); return; }
      ui.screenshotting = true;
      // 加 screenshot-mode class, 触发 CSS 临时调整 (隐藏 sticky / 滚动展开等)
      document.body.classList.add("screenshot-mode");
      // 让表格容器展开到完整高度 (不裁剪)
      const tbl = document.querySelector(".table-scroll");
      const oldMax = tbl?.style.maxHeight;
      const oldOver = tbl?.style.overflow;
      if (tbl) {
        tbl.style.maxHeight = "none";
        tbl.style.overflow = "visible";
      }
      await new Promise(r => setTimeout(r, 100));
      try {
        const target = document.querySelector("main");
        const canvas = await html2canvas(target, {
          backgroundColor: ui.dark ? "#0f172a" : "#ffffff",
          scale: window.devicePixelRatio || 1,
          windowWidth: document.documentElement.scrollWidth,
          windowHeight: document.documentElement.scrollHeight,
          useCORS: true,
          ignoreElements: el => el.classList?.contains("no-screenshot"),
        });
        const link = document.createElement("a");
        link.download = `志愿表_${new Date().toISOString().slice(0, 10)}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      } catch (e) {
        console.error(e);
        alert("截图失败: " + e.message);
      } finally {
        if (tbl) {
          tbl.style.maxHeight = oldMax;
          tbl.style.overflow = oldOver;
        }
        document.body.classList.remove("screenshot-mode");
        ui.screenshotting = false;
      }
    }

    // 打印 - 触发原生打印, CSS @media print 处理样式
    function printPage() { window.print(); }

    return {
      store, ui, loading, loadingMsg, loadingPct,
      scoreRank, meta, priority, currentPage, cwb, tierMap, paneTargets, activeTier, filteredTierCounts,
      ratioSumOk, resetRatios,
      filtered, sorted, paged, planByIdMap, compareIdSet, keywordCandidatePool,
      openDetail, toggleCompare, toggleFavorite, toggleExpand, saveFavorites,
      voluntarySet, isInVoluntary, voluntaryIndex, toggleVoluntary,
      moveVoluntaryUp, moveVoluntaryDown, moveVoluntaryToTop, moveVoluntaryToBottom, clearVoluntary,
      voluntaryTierCounts, exportVoluntaryByTier,
      resetFilters, onApplyTier, reloadData,
      exportCsv, toggleDark,
      savePreset, loadPreset, deletePreset, renamePreset, copyShareLink,
      takeScreenshot, printPage,
      // Items 6.x: 排序 / 列设置
      visibleColumns, allColumns, toggleColumn, resetColumns, onColDrop, onColResize,
      savePriorityOverrides, resetPriorityOverrides,
      onSortCol, sortFieldLabel, toggleSortDir, removeSortKey,
      onSortDragStart, onSortDrop,
    };
  },
}).mount("#app");
