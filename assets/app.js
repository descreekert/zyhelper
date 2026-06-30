// 2026 物理类志愿填报助手 - Vue 3 单文件应用
// 数据文件: data/plans.json, data/score_rank.json, data/meta.json

const { createApp, ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } = Vue;

// ========== 工具函数 ==========

const LS_KEY_FAV   = "zyhelper_favorites_v1";
const LS_KEY_VOL   = "zyhelper_voluntary_v1";        // 旧 (单列表)
const LS_KEY_VOL_LISTS = "zyhelper_voluntary_lists_v2";  // 新 (多列表 {name: ids[]})
const LS_KEY_VOL_ACTIVE = "zyhelper_voluntary_active_v2";
const LS_KEY_VOL_PINNED = "zyhelper_voluntary_pinned_v1";   // {name: id[]}  确认锁定
const LS_KEY_VOL_PENDING = "zyhelper_voluntary_pending_v1"; // {name: id[]}  待确认
const LS_KEY_VOL_BACKUP = "zyhelper_voluntary_backup_v1";   // {name: {ids: id[], pinned: id[]}}  编辑前快照 (撤销用)
const LS_KEY_PRIORITY_OVR = "zyhelper_priority_overrides_v1";
const LS_KEY_PLAN_OVR = "zyhelper_plan_overrides_v1";
const LS_KEY_PRESET= "zyhelper_presets_v2";   // v2: 含 subjects + allowed 关键词维度
const LS_KEY_UI    = "zyhelper_ui_v1";
const LS_KEY_TRANSFER_TARGETS = "zyhelper_transfer_targets_v1";  // 目标专业列表 (无需转)
const LS_KEY_TRANSFER_ACCEPTS = "zyhelper_transfer_accepts_v1";  // 可接受转专业列表
const LS_KEY_CWB_RANGES = "zyhelper_cwb_ranges_v1";              // 冲稳保 段偏移
const DEFAULT_CWB_RANGES = {
  chong: { lo: 6,   hi: 20 },
  wen:   { lo: -5,  hi: 5  },
  bao:   { lo: -20, hi: -6 },
};

// 默认: 用户最初输入的两份清单 (可在 UI 编辑覆盖)
const DEFAULT_TRANSFER_TARGETS = [
  "电子信息工程","电子信息科学与技术","电子科学与技术","微电子科学与工程",
  "数据科学与大数据技术","大数据管理与应用","集成电路设计与集成系统","人工智能","软件工程",
  "计算机科学与技术","物联网工程","自动化","通信工程",
  "机械工程","机械设计制造及其自动化","机械电子工程",
  "光电信息科学与工程","测控技术与仪器",
  "智能科学与技术","智能制造工程","机器人工程","车辆工程","交通运输",
  "智能车辆工程","智慧交通","未来机器人","交叉工程",
];
const DEFAULT_TRANSFER_ACCEPTS = [
  "数学与应用数学","大气科学","能源与动力工程","新能源科学与工程",
];

// 从专业名解析出 含 "(A、B、C)" 或 "[A,B,C]" 形式的子专业 list.
// 若名字没有括号 (单专业), 返回该主名本身.
//   "自动化类(自动化、工业智能、电子科学与技术)" → ["自动化", "工业智能", "电子科学与技术"]
//   "机械设计制造及其自动化"                   → ["机械设计制造及其自动化"]
//   "工科试验班(A、B)[X、Y]"                  → ["A","B","X","Y"] (取所有顶层括号)
function extractMajorsFromName(name) {
  if (!name) return [];
  const out = [];
  const s = String(name).replace(/，/g, ",").replace(/\s+/g, "");
  // 找所有顶层 () 或 [] 内的内容
  let depth = 0, buf = "", inside = false;
  const innerSegs = [];
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "（" || ch === "［") {
      if (depth === 0) { inside = true; buf = ""; }
      else if (inside) buf += ch;
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "）" || ch === "］") {
      depth--;
      if (depth === 0 && inside) {
        innerSegs.push(buf);
        inside = false; buf = "";
      } else if (inside) buf += ch;
    } else if (inside) {
      buf += ch;
    }
  }
  if (innerSegs.length === 0) {
    // 无括号: 单专业, 返回主名
    return [s];
  }
  // 拆分每段, 按 顿号 / 逗号
  for (const seg of innerSegs) {
    for (const part of seg.split(/[、,]/)) {
      const p = part.trim();
      if (p) out.push(p);
    }
  }
  return out.length ? out : [s];
}

// 取 专业名 第一个括号前的主名 (规范化空格 + 全角逗号)
function mainNameOf(name) {
  if (!name) return "";
  return String(name).replace(/，/g, ",").replace(/\s+/g, "").split(/[(\[（［]/)[0];
}

// 给一个 plan 计算 "转专业风险" 标签:
//   - ok    单专业在目标内 / 大类含任一目标
//   - warn  单专业仅在可接受内 / 大类无目标但含任一可接受
//   - error 全部都不在目标 + 可接受 范围
function classifyTransfer(plan, targetSet, acceptSet) {
  if (!plan) return { level: "error", matchedTargets: [], matchedAccepts: [], majors: [] };
  const name = plan.majorName26 || plan.majorName25 || "";
  // 步骤 1: 若 主名 (括号前) 本身就是 目标/可接受 专业, 直接认定为单专业.
  //   防止 "数据科学与大数据技术(大类招生,项目选拔进入,分流时专业任选)" 这类
  //   描述性括号被误解析成 ["大类招生","项目选拔进入","分流时专业任选"].
  //   也覆盖 "车辆工程(...试点班)" 等 qualifier 括号.
  const main = mainNameOf(name);
  if (main) {
    if (targetSet.has(main)) {
      return { level: "ok", matchedTargets: [main], matchedAccepts: [], majors: [main] };
    }
    if (acceptSet.has(main)) {
      return { level: "warn", matchedTargets: [], matchedAccepts: [main], majors: [main] };
    }
  }
  // 步骤 2: 主名不在清单 (典型 大类: 电子信息类 / 自动化类), 走 子专业列表
  let majors = [];
  if (Array.isArray(plan.containedMajors) && plan.containedMajors.length) {
    majors = plan.containedMajors.slice();
  } else {
    majors = extractMajorsFromName(name);
  }
  const normed = majors.map(m => (m || "").replace(/\s+/g, "").trim()).filter(Boolean);
  const matchedTargets = normed.filter(m => targetSet.has(m));
  const matchedAccepts = normed.filter(m => acceptSet.has(m));
  let level;
  if (matchedTargets.length > 0) level = "ok";
  else if (matchedAccepts.length > 0) level = "warn";
  else level = "error";
  return { level, matchedTargets, matchedAccepts, majors };
}

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

// V9: 录取率算法 — 用户位次 vs plan 历史位次 + 专业热度调整
// 返回 { prob, isUncertain, heat, reason? }
//   prob: 0-1 (null 表示无法估算)
//   isUncertain: true 时是 "新增" 或 "数据缺失"
//   heat: 热度档 (0-7, 高=热)
function majorHeat(plan) {
  if (!plan) return { idx: 0, pct: 0, name: "其他" };
  const text = [
    plan.majorName26 || "", plan.majorName25 || "",
    ...(plan.containedMajors || []), plan.majorClass || "",
  ].join(" ");
  if (/电子信息|集成电路|通信工程|微电子|物联网|电子科学/.test(text)) return { idx: 7, pct: -0.04, name: "电子信息" };
  if (/计算机|软件工程|数据科学与大数据|网络空间|人工智能|数字媒体|信息安全|信息工程/.test(text)) return { idx: 6, pct: -0.03, name: "计算机" };
  if (/自动化|智能科学|控制科学/.test(text)) return { idx: 5, pct: -0.015, name: "自动化" };
  if (/机械|智能制造|工业工程/.test(text)) return { idx: 4, pct: -0.005, name: "机械" };
  if (/统计|大数据/.test(text)) return { idx: 3, pct: 0, name: "统计/大数据" };
  if (/车辆/.test(text)) return { idx: 2, pct: 0.005, name: "车辆" };
  if (/能源|动力工程|新能源/.test(text)) return { idx: 1, pct: 0.01, name: "能动" };
  return { idx: 0, pct: 0, name: "其他" };
}
// ctx: { userRank25, scoreRank, supplyMap }
//   userRank25: 用户 25 等位位次
//   scoreRank: 完整 scoreRank 对象
//   supplyMap: Map<score25, { enroll26, cnt26, ratio }>
//     ratio = enroll26 / cnt26 — 该 25 等位分对应的 26 总招生 / 26 同分人数
//     ratio > 0.85 → 供给充足, 录取率 +10pp
//     ratio ∈ [0.5, 0.85] → 中等, +5pp
//     ratio < 0.5 → 紧张, 不变
function applySupplyAdj(prob, supply) {
  if (!supply) return { prob, adj: 0 };
  let adj = 0;
  if (supply.ratio > 0.85) adj = 0.10;
  else if (supply.ratio > 0.5) adj = 0.05;
  const p = Math.max(0.02, Math.min(0.98, prob + adj));
  return { prob: p, adj };
}
function computeAdmitProb(plan, ctx) {
  if (!plan) return { prob: null, isUncertain: true };
  if (typeof ctx === "number") ctx = { userRank25: ctx };
  ctx = ctx || {};
  const userRank25 = ctx.userRank25;
  const sr = ctx.scoreRank;
  const SCALE = 1500, BIAS = 0.4;
  // 新增专业: 用 plan 自己的 25 分 + 5 (粗估录取线上浮 5 分)
  if (plan.isNew === "新增") {
    const planScore25 = plan.ref25Score || plan.score25 || null;
    if (!planScore25 || !userRank25 || !sr) {
      return { prob: null, isUncertain: true, reason: "新增", heat: majorHeat(plan), isEstimated: true };
    }
    const proxyRank = rank25FromScore25(planScore25 + 5, sr);
    if (!proxyRank) return { prob: null, isUncertain: true, reason: "新增-位次查不到", heat: majorHeat(plan), isEstimated: true };
    const heat = majorHeat(plan);
    const heatPct = ctx.ignoreHeat ? 0 : heat.pct;
    const effPlanRank = proxyRank * (1 + heatPct);
    const diff = effPlanRank - userRank25;
    const probBase = 1 / (1 + Math.exp(-diff / SCALE - BIAS));
    const supply = ctx.supplyMap?.get(planScore25);
    const { prob, adj } = applySupplyAdj(probBase, supply);
    return {
      prob, probBase, supplyAdj: adj, supply,
      isUncertain: false, isEstimated: true,
      heat, heatApplied: !ctx.ignoreHeat,
      refRank: proxyRank, ref25: planScore25, effPlanRank, diff,
    };
  }
  const r25  = plan.ref25Rank || plan.rank25 || null;
  const ravg = plan.avgRank || null;
  let refRank = null;
  if (r25 && ravg) refRank = Math.round((r25 + ravg) / 2);
  else refRank = r25 || ravg;
  if (!refRank || !userRank25) {
    return { prob: null, isUncertain: true, reason: "位次缺失", heat: majorHeat(plan) };
  }
  const heat = majorHeat(plan);
  const heatPct = ctx.ignoreHeat ? 0 : heat.pct;
  const effPlanRank = refRank * (1 + heatPct);
  const diff = effPlanRank - userRank25;
  const probBase = 1 / (1 + Math.exp(-diff / SCALE - BIAS));
  const planScore25 = plan.ref25Score || plan.score25 || null;
  const supply = planScore25 ? ctx.supplyMap?.get(planScore25) : null;
  const { prob, adj } = applySupplyAdj(probBase, supply);
  return {
    prob, probBase, supplyAdj: adj, supply,
    isUncertain: false, heat, heatApplied: !ctx.ignoreHeat,
    refRank, ref25: r25, avgRank: ravg, effPlanRank, diff,
  };
}

// 5 档颜色: 80+ 深绿 / 60-79 蓝绿 / 50-59 浅黄 / 35-49 橙 / <35 红
function probColorClass(prob) {
  if (prob == null) return "text-slate-400";
  if (prob >= 0.80) return "text-green-700 font-bold";
  if (prob >= 0.60) return "text-emerald-600 font-bold";
  if (prob >= 0.50) return "text-yellow-600 font-bold";
  if (prob >= 0.35) return "text-orange-600 font-bold";
  return "text-red-600 font-bold";
}
if (typeof window !== "undefined") window.probColorClass = probColorClass;

// V9: 26 分数 → 25 等位分 (志愿分析用. equivFromScore25 的反函数)
function equiv25FromScore26(score26, scoreRank) {
  if (!score26 || !scoreRank) return null;
  const eq = scoreRank.equivalent || [];
  for (const r of eq) if (r.score26 === score26) return r.score25;
  // 兜底: 26score → 26rank → 25 一分一段反查同位次 25score
  const r26 = rank26FromScore26(score26, scoreRank);
  if (r26 == null) return null;
  const osr25 = scoreRank.oneScoreOneRank?.["2025"];
  if (!osr25) return null;
  for (const [s, , cum] of osr25) if (cum >= r26) return s;
  return null;
}

// 25 分数 → 26 等位分 + 26 等位次
// 优先查 equivalent 表 (人工/精确); 不在范围则用 25 一分一段 + 26 一分一段 反查
function equivFromScore25(score25, scoreRank) {
  if (!score25 || !scoreRank) return { score26: null, rank26: null };
  const eq = scoreRank.equivalent || [];
  for (const r of eq) {
    if (r.score25 === score25) return { score26: r.score26, rank26: r.rank26 };
  }
  // 兜底: 25rank → 26 同位次的 score → 该 26 score 的 rank
  const r25 = rank25FromScore25(score25, scoreRank);
  if (r25 == null) return { score26: null, rank26: null };
  const s26 = score26FromRank26(r25, scoreRank);
  if (s26 == null) return { score26: null, rank26: null };
  const r26 = rank26FromScore26(s26, scoreRank);
  return { score26: s26, rank26: r26 };
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
function computeChongWenBao(score26, scoreRank, equivSource = "25", cwbCfg = null) {
  if (!score26) return null;
  const { score: Y, rank: equivRank } = equivFromScore26(score26, scoreRank, equivSource);
  if (Y == null) return null;
  // 冲稳保段偏移 (相对 25 等位分): 默认 +6/+20/-5/+5/-20/-6, 可在 ⚙ 设置 改
  const cfg = cwbCfg || DEFAULT_CWB_RANGES;
  const ranges = {
    chong: { scoreLow: Y + cfg.chong.lo, scoreHigh: Y + cfg.chong.hi, label: "冲" },
    wen:   { scoreLow: Y + cfg.wen.lo,   scoreHigh: Y + cfg.wen.hi,   label: "稳" },
    bao:   { scoreLow: Y + cfg.bao.lo,   scoreHigh: Y + cfg.bao.hi,   label: "保" },
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

// 判断 plan 落入哪档 (冲/稳/保/null) - 严格版 (用于主表/三栏的着色)
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
// 放宽版 (用于志愿单视图): 每个 plan 都归一档, 超出 冲档高分仍归冲, 低于保档低分仍归保
function planTierRelaxed(plan, cwb) {
  if (!cwb) return null;
  const s = plan.isStopped ? plan.score25 : plan.ref25Score;
  if (s == null) return null;
  const R = cwb.ranges;
  if (s >= R.chong.scoreLow) return "chong";
  if (s >= R.wen.scoreLow)   return "wen";
  return "bao";
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
  { key: "majorCode", label: "专业代码", width: 50, sortable: false },
  { key: "major",   label: "专业",     width: 240, sortable: false },
  { key: "num",     label: "计划",     width: 50,  sortable: true,  sortField: "enrollNum26" },
  { key: "dur",     label: "学制",     width: 40,  sortable: false },
  { key: "tuition", label: "学费",     width: 60,  sortable: true,  sortField: "tuition" },
  { key: "diff",    label: "变化",     width: 100, sortable: false },
  { key: "score",   label: "分数 25/26",   width: 100, sortable: true,  sortField: "ref25Score" },
  { key: "rank",    label: "位次 25/26",   width: 120, sortable: true,  sortField: "ref25Rank" },
  { key: "admitProb", label: "录取率", width: 70, sortable: false },
  { key: "transfer", label: "转专业", width: 60, sortable: false },
  { key: "conf",    label: "可信度",   width: 60,  sortable: true,  sortField: "refConfidence" },
  { key: "eval",    label: "学科评估", width: 130, sortable: false },
  { key: "soft",    label: "软科评级", width: 90,  sortable: false },
  { key: "remarks", label: "专业备注", width: 200, sortable: false },
  { key: "baoyan",  label: "专业保研", width: 140, sortable: false },
  { key: "sp",      label: "校优",     width: 50,  sortable: true,  sortField: "schoolPriority" },
  { key: "mp",      label: "类优",     width: 50,  sortable: true,  sortField: "majorPriority" },
  { key: "actions", label: "",         width: 130, sortable: false, fixed: true },
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
    if (f.onlyNew && p.isNew !== "新增") continue;

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
  // 专业优先 (单端, 仅展示用; 默认值大, 不主动过滤)
  majorPriorityMax: 50,
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
  onlyNew: false,                 // 只看 26 新增专业
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
  // 志愿单 (多列表): { 列表名: [ids] }
  voluntaryLists: (() => {
    const newFormat = loadLS(LS_KEY_VOL_LISTS, null);
    if (newFormat && Object.keys(newFormat).length) return newFormat;
    // 迁移: 旧单列表 → "默认"
    const oldSingle = loadLS(LS_KEY_VOL, null);
    const oldFav = loadLS(LS_KEY_FAV, []);
    return { "默认": oldSingle || oldFav || [] };
  })(),
  activeVoluntaryName: loadLS(LS_KEY_VOL_ACTIVE, "默认"),
  // V9: 志愿排序锁定 (按列表名 keyed). pinned = 用户确认锁定; pending = 待确认.
  // 锁定/待确认的项保留当前数组位置, 其余按 26 等位次升序填充空位.
  // backup = 第一次 move 时快照 (整数组 + 当时 pinned), 撤销全部时回滚.
  voluntaryPinned:  loadLS(LS_KEY_VOL_PINNED, {}),
  voluntaryPending: loadLS(LS_KEY_VOL_PENDING, {}),
  voluntaryBackup:  loadLS(LS_KEY_VOL_BACKUP, {}),
  // 用户自定义排序覆盖 (null = 用 priority.json 默认; Array<name> = 自定义顺序)
  priorityOverrides: loadLS(LS_KEY_PRIORITY_OVR, { schools: null, cities: null, majorClasses: null, majors: null }),
  cwbRanges: (() => {
    const v = loadLS(LS_KEY_CWB_RANGES, null);
    return v && v.chong && v.wen && v.bao ? v : JSON.parse(JSON.stringify(DEFAULT_CWB_RANGES));
  })(),
  transferTargets: (() => {
    const lst = loadLS(LS_KEY_TRANSFER_TARGETS, DEFAULT_TRANSFER_TARGETS.slice());
    let migrated = false;
    // 一次性迁移 1: 旧的错误名 "微电子科学与技术" → 正确 "微电子科学与工程"
    const out = lst.map(s => {
      if (s === "微电子科学与技术") { migrated = true; return "微电子科学与工程"; }
      return s;
    });
    // 一次性迁移 2: 补全后期新增的默认目标专业 (如 "机械设计制造及其自动化")
    // 仅当用户的列表里 缺这些后期补默认项 时追加, 不影响用户自己增删的别的项.
    const POST_ADDED_DEFAULTS = ["机械设计制造及其自动化", "物联网工程", "机械电子工程", "电子信息科学与技术", "大数据管理与应用"];
    const have = new Set(out);
    for (const m of POST_ADDED_DEFAULTS) {
      if (!have.has(m)) { out.push(m); migrated = true; }
    }
    if (migrated) saveLS(LS_KEY_TRANSFER_TARGETS, out);
    return out;
  })(),
  transferAccepts: loadLS(LS_KEY_TRANSFER_ACCEPTS, DEFAULT_TRANSFER_ACCEPTS.slice()),
  // 用户手动修改的 plan 字段 (e.g. ref25Score) — { [planId]: { ref25Score, ref25Rank } }
  planOverrides: loadLS(LS_KEY_PLAN_OVR, {}),
  compareList: [],
  expandedRows: new Set(),           // 主表/list/pane
  expandedRowsVol: new Set(),        // voluntary 独立
  expandedRecommend: new Set(),      // 聚合表 (key: schoolName)
  // 每视图独立的关键词筛选 (V8: 用户希望 voluntary/recommend 表也能用 keyword)
  voluntaryKeyword:  { keyword: "", pickedSchool: null, pickedMajorClass: null, pickedMajorName: null },
  recommendKeyword:  { keyword: "", pickedSchool: null, pickedMajorClass: null, pickedMajorName: null },
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
  showImportMenu: false,
  showExportMenu: false,
  showPrioritySettings: false,
  settingsInitialTab: null,        // 'schools' / 'transfer' / 'refine' / 'ratio' / 'cwbseg' / null
  showVoluntaryAnalysis: false,
  analysisAnchor25: null,        // 用户手调 25 等位分 (null = 自动)
  analysisAnchorRank26: null,    // 用户手调 26 实际位次 (null = 用 myRank, 用户提到"按 8150 作实际预测")
  analysisExpandedSchools: [],   // 学校行展开 id 列表
  analysisExpandedScores: [],    // 一分一段行展开 (25 score) 列表
  analysisExpandedTiers: [],     // 冲稳保卡片展开 ['chong','wen','bao','out']
  analysisExpandedEnrollScores: [],  // 招生维度分数展开 (25 score list)
  analysisExpandedMajors: [],    // 报考专业行展开 (mainName 列表)
  analysisExpandedCities: [],    // 城市行展开
  analysisIgnoreHeat: false,     // 分析页: 录取率忽略专业热度调整
  samePosPct: 50,                // 同分组位置 (0=上 100=下, 默认 中)
  useRefinedQuery: false,        // 主查询 / 冲稳保 使用 修正后位次
  detailPlan: null,
  myScore: 0,
  myRank: 0,
  totalVolunteers: 112,
  ratioChong: 0.25,
  ratioWen: 0.45,
  ratioBao: 0.30,
  equivSource: "25",                  // '25' | '24' | '23' | 'avg'
  screenshotting: false,
  moveBoundaryNote: null,             // V9: 单条移动遇 📌 边界的 transient 提示
  _noteTimer: null,
  ...loadLS(LS_KEY_UI, {}),
});

// 迁移 v23: 清除 旧"一键应用" 留下的 analysisAnchor25 / analysisAnchorRank26 (现在由 useRefinedQuery + rankRefine 接管)
// 没这个清理, 切换 用修正位次 toggle OFF 时, 旧 LS 值会 override autoAnchor, 看上去"没变化"
if (!loadLS("zyhelper_migrated_v23", false)) {
  ui.analysisAnchor25 = null;
  ui.analysisAnchorRank26 = null;
  saveLS("zyhelper_migrated_v23", true);
}

// 切换 useRefinedQuery 时 顺手清掉手调 anchor/rank, 避免上次留下的值挡道
watch(() => ui.useRefinedQuery, () => {
  ui.analysisAnchor25 = null;
  ui.analysisAnchorRank26 = null;
});

watch(() => Array.from(store.favorites), v => saveLS(LS_KEY_FAV, v));
watch(() => store.voluntaryLists, v => saveLS(LS_KEY_VOL_LISTS, v), { deep: true });
watch(() => store.voluntaryPinned,  v => saveLS(LS_KEY_VOL_PINNED, v),  { deep: true });
watch(() => store.voluntaryPending, v => saveLS(LS_KEY_VOL_PENDING, v), { deep: true });
watch(() => store.voluntaryBackup,  v => saveLS(LS_KEY_VOL_BACKUP, v),  { deep: true });
watch(() => store.activeVoluntaryName, v => saveLS(LS_KEY_VOL_ACTIVE, v));
// 保证 active 名字总是 valid (lists 为空时建一个 "默认")
if (!store.voluntaryLists || !Object.keys(store.voluntaryLists).length) {
  store.voluntaryLists = { "默认": [] };
}
if (!store.voluntaryLists[store.activeVoluntaryName]) {
  store.activeVoluntaryName = Object.keys(store.voluntaryLists)[0];
}
watch(() => store.priorityOverrides, v => saveLS(LS_KEY_PRIORITY_OVR, v), { deep: true });
watch(() => store.planOverrides, v => saveLS(LS_KEY_PLAN_OVR, v), { deep: true });
watch(() => store.transferTargets, v => saveLS(LS_KEY_TRANSFER_TARGETS, v), { deep: true });
watch(() => store.transferAccepts, v => saveLS(LS_KEY_TRANSFER_ACCEPTS, v), { deep: true });
watch(() => store.cwbRanges, v => saveLS(LS_KEY_CWB_RANGES, v), { deep: true });
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
    // 完整 items (用于下拉添加 — 包含 inRange 之外的)
    allItems: Array,         // 全部条目, 默认同 items
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

    // + 号手动添加 tag (在 inRange 之外, 加进 selected Set)
    const showAddPopover = ref(false);
    const addSearch = ref("");
    const extraItems = computed(() => {
      // selected 中但不在 inRange 的 (用户手动加的)
      if (!props.selected) return [];
      const inSet = new Set(inRange.value.map(i => i.name));
      return (props.allItems || props.items).filter(i =>
        props.selected.has(i.name) && !inSet.has(i.name)
      );
    });
    const addCandidates = computed(() => {
      const all = props.allItems || props.items;
      const inRangeNames = new Set(inRange.value.map(i => i.name));
      const inSelected = props.selected || new Set();
      const kw = addSearch.value.toLowerCase().trim();
      return all.filter(i =>
        !inRangeNames.has(i.name) && !inSelected.has(i.name) &&
        (!kw || i.name.toLowerCase().includes(kw))
      ).slice(0, 50);
    });
    function addExtraItem(item) {
      let set = props.selected;
      if (set == null) {
        set = new Set(inRange.value.map(i => i.name));
      }
      const next = new Set(set);
      next.add(item.name);
      emit("update:selected", next);
      addSearch.value = "";
    }

    return { expanded, inRange, isActive, toggle, reset, applyPreset, isActivePreset, selectedCount,
             showAddPopover, addSearch, extraItems, addCandidates, addExtraItem };
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
        <div class="chip-row max-h-64 overflow-y-auto relative">
          <span v-for="item in inRange" :key="item.name"
                class="chip" :class="{ active: isActive(item) }"
                :title="chipSub ? chipSub(item) : ''"
                @click="toggle(item)">
            {{ chipLabel ? chipLabel(item) : item.name }}
          </span>
          <!-- 手动添加的 chip (绿色边框区分) -->
          <span v-for="item in extraItems" :key="'extra-'+item.name"
                class="chip active extra-chip"
                :title="(chipSub ? chipSub(item) : '') + ' (手动添加)'"
                @click="toggle(item)">
            {{ chipLabel ? chipLabel(item) : item.name }} ★
          </span>
          <!-- + 号手动添加 -->
          <span class="relative">
            <button @click="showAddPopover = !showAddPopover"
                    class="chip-add" title="添加超出范围的 tag">+</button>
            <div v-if="showAddPopover"
                 class="absolute left-0 top-7 z-30 bg-white border rounded shadow-lg w-72 p-2"
                 @click.stop>
              <input v-model="addSearch" placeholder="搜索 (从所有 排序 中选)"
                     class="w-full border rounded px-2 py-1 text-xs mb-1">
              <div class="max-h-60 overflow-y-auto">
                <div v-if="!addCandidates.length" class="text-xs text-slate-400 py-2 text-center">
                  无候选 (可能都已在当前范围内)
                </div>
                <div v-for="item in addCandidates" :key="item.name"
                     @click="addExtraItem(item); showAddPopover = false"
                     class="px-2 py-1 text-xs cursor-pointer hover:bg-blue-50 rounded">
                  {{ chipLabel ? chipLabel(item) : item.name }}
                  <span v-if="chipSub" class="text-slate-400 ml-1">{{ chipSub(item) }}</span>
                </div>
              </div>
              <div class="flex justify-end mt-1">
                <button @click="showAddPopover = false" class="text-xs text-slate-500 hover:underline">关闭</button>
              </div>
            </div>
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

      <!-- 开关 (2 列布局) -->
      <div class="filter-section pt-2">
        <div class="grid grid-cols-2 gap-x-2 gap-y-1">
          <label class="flex items-center gap-2 text-xs">
            <input type="checkbox" v-model="store.filters.includeStopped">
            <span>含停招</span>
          </label>
          <label class="flex items-center gap-2 text-xs">
            <input type="checkbox" v-model="store.filters.includeMidOutside">
            <span>含中外合作</span>
          </label>
          <label class="flex items-center gap-2 text-xs">
            <input type="checkbox" v-model="store.filters.refRequired">
            <span>仅有 25 参考</span>
          </label>
          <label class="flex items-center gap-2 text-xs">
            <input type="checkbox" v-model="store.filters.onlyNew">
            <span>只看新增</span>
          </label>
        </div>
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
          "voluntary", "voluntarySet", "columnWidths", "planOverrides",
          "recommendData", "scoreRank",
          "pinnedSet", "pendingSet", "backupPinnedSet", "selectedVolIds", "admitProbFn", "transferFn"],
  emits: ["page-change", "open-detail", "toggle-compare", "toggle-favorite", "toggle-expand",
          "sort-col", "col-drop", "col-resize",
          "toggle-voluntary", "vol-up", "vol-down", "vol-top", "vol-bottom",
          "vol-confirm-pin", "vol-cancel-pending", "vol-unpin", "vol-pin-at-current",
          "vol-select", "vol-clear-selection", "vol-move-selection",
          "vol-confirm-all", "vol-cancel-all",
          "edit-score", "revert-score"],
  setup(props, { emit }) {
    function fmtDuration(p) { return formatDuration(p.duration || p.duration25); }
    function formatDur25(p) { return formatDuration(p.duration25 || p.duration); }
    function volIdx(id) {
      const i = props.voluntary?.indexOf(id);
      return (i !== undefined && i >= 0) ? i + 1 : 0;
    }
    // hover 仅在真正截断的 cell 上展开 (JS 检测 scrollWidth > clientWidth)
    onMounted(() => {
      document.addEventListener("mouseover", (ev) => {
        const td = ev.target.closest?.(".resizable-table td.truncate");
        if (td && !td.dataset.truncated) {
          td.dataset.truncated = (td.scrollWidth > td.clientWidth) ? "1" : "0";
        }
      });
      document.addEventListener("mouseout", (ev) => {
        const td = ev.target.closest?.(".resizable-table td.truncate");
        // 离开时清掉, 下次重新检测 (因列宽可变)
        if (td && ev.relatedTarget && !td.contains(ev.relatedTarget)) {
          delete td.dataset.truncated;
        }
      });
    });

    // 双击 编辑 25 参考分
    const editingScore = ref(null);   // plan id
    const editingValue = ref("");
    function startEditScore(p, ev) {
      ev.stopPropagation();
      editingScore.value = p.id;
      editingValue.value = (p.isStopped ? p.score25 : p.ref25Score) || "";
      nextTick(() => {
        const inp = ev.target.closest("td")?.querySelector("input");
        inp?.focus();
        inp?.select();
      });
    }
    function commitEditScore() {
      if (editingScore.value == null) return;
      emit("edit-score", { id: editingScore.value, score: editingValue.value });
      editingScore.value = null;
    }
    function cancelEditScore() { editingScore.value = null; }
    function isEdited(p) {
      return props.planOverrides && props.planOverrides[p.id];
    }
    function rowTier(p) {
      return props.tierMap ? (props.tierMap.get(p.id) || null) : null;
    }
    function isExpanded(id) { return props.expandedRows && props.expandedRows.has(id); }
    // 25 → 26 等位分缓存 (避免每行渲染都重算)
    const equivCache = new Map();
    function getEquiv(score25) {
      if (score25 == null) return { score26: null, rank26: null };
      if (equivCache.has(score25)) return equivCache.get(score25);
      const v = equivFromScore25(score25, props.scoreRank);
      equivCache.set(score25, v);
      return v;
    }
    function score25Of(p) { return p.isStopped ? p.score25 : p.ref25Score; }
    function rank25Of(p) { return p.isStopped ? p.rank25 : p.ref25Rank; }
    function score26Of(p) { return getEquiv(score25Of(p)).score26; }
    function rank26Of(p) { return getEquiv(score25Of(p)).rank26; }
    // V9: 锁定 / 待确认 状态查询
    function getAdmit(p) { return props.admitProbFn ? props.admitProbFn(p) : null; }
    function getTransfer(p) { return props.transferFn ? props.transferFn(p) : null; }
    function isPinned(id) { return props.pinnedSet && props.pinnedSet.has(id); }
    function isPending(id) { return props.pendingSet && props.pendingSet.has(id); }
    function wasPinned(id) { return props.backupPinnedSet && props.backupPinnedSet.has(id); }
    function isSelected(id) { return props.selectedVolIds && props.selectedVolIds.has(id); }
    function selectedCount() { return props.selectedVolIds ? props.selectedVolIds.size : 0; }
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
        case "majorCode": return p.majorCode26 || "—";
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
             paneLists, paneCounts, volIdx,
             score25Of, rank25Of, score26Of, rank26Of,
             isPinned, isPending, wasPinned, isSelected, selectedCount, getAdmit, getTransfer,
             editingScore, editingValue, startEditScore, commitEditScore, cancelEditScore, isEdited };
  },
  computed: {
    totalPages() {
      if (!this.pageSize) return 1;
      return Math.ceil(this.total / this.pageSize);
    },
  },
  template: `
    <div>
      <div v-if="plans.length === 0 && viewMode==='voluntary'" class="text-center text-slate-400 py-16">
        <div class="text-4xl mb-2">📋</div>
        <div>志愿单为空</div>
        <div class="text-sm mt-1">回到查询页, 点击"+志愿"加入招生计划</div>
      </div>
      <div v-else-if="plans.length === 0" class="text-center text-slate-400 py-16">
        <div class="text-4xl mb-2">🤔</div>
        <div>未找到符合条件的招生计划</div>
        <div class="text-sm mt-1">尝试调整左侧筛选条件</div>
      </div>

      <!-- 推荐视图: 学校+专业类聚合 -->
      <div v-else-if="viewMode==='recommend'" class="overflow-x-auto">
        <div v-if="!recommendData || !recommendData.length" class="text-center text-slate-400 py-16">
          <div class="text-4xl mb-2">🎯</div>
          <div>{{ cwb ? '没有符合条件的推荐 (请放宽筛选)' : '请先在顶部输入 26 分数' }}</div>
        </div>
        <table v-else class="resizable-table recommend-table w-full bg-white border text-xs">
          <thead>
            <tr>
              <th style="width:38px">档</th>
              <th style="width:90px">城市</th>
              <th style="width:220px">学校</th>
              <th>专业类列表</th>
              <th style="width:60px" title="计划总数">人数</th>
              <th style="width:340px" title="格式: 25分/26等位 · 25位次/26等位 (最高 | 最低 | 平均)">分数 25/26 · 位次 25/26 (最高 | 最低 | 平均)</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(g, gi) in recommendData" :key="gi">
              <tr :class="[g.tier ? 'tier-row-'+g.tier : '', isExpanded(g.schoolName) ? 'main-row-expanded' : '', 'cursor-pointer']"
                  @click="$emit('toggle-expand', g.schoolName)">
                <td class="text-center">
                  <span v-if="g.tier" class="tier-cell" :class="'tier-cell-'+g.tier">
                    {{ g.tier==='chong' ? '冲' : g.tier==='wen' ? '稳' : '保' }}
                  </span>
                </td>
                <td>{{ g.city }}</td>
                <td>
                  <span class="text-slate-400 mr-1 text-[10px]">{{ isExpanded(g.schoolName) ? '▾' : '▸' }}</span>
                  <tier-badge :tag="g.schoolTag"></tier-badge>
                  <span class="ml-1 font-bold">{{ g.schoolName }}</span>
                  <span v-if="g.schoolRank" class="text-slate-400 ml-1 text-[10px]">#{{ g.schoolRank }}</span>
                </td>
                <td class="recommend-classes">
                  <span v-for="(c, ci) in g.majorClasses" :key="ci">
                    {{ c }}<span v-if="ci < g.majorClasses.length - 1" class="text-slate-400 mx-1">｜</span>
                  </span>
                </td>
                <td class="text-center font-bold">{{ g.totalEnroll }}</td>
                <td class="text-center recommend-stats">
                  <span class="text-blue-700 font-bold">{{ g.topScore }}<span class="text-slate-400 font-normal">/{{ g.topScore26 ?? '—' }}</span> · {{ g.topRank ?? '—' }}<span class="text-slate-400 font-normal">/{{ g.topRank26 ?? '—' }}</span></span>
                  <span class="text-slate-400 mx-1">｜</span>
                  <span>{{ g.botScore }}<span class="text-slate-400">/{{ g.botScore26 ?? '—' }}</span> · {{ g.botRank ?? '—' }}<span class="text-slate-400">/{{ g.botRank26 ?? '—' }}</span></span>
                  <span class="text-slate-400 mx-1">｜</span>
                  <span class="text-slate-500">{{ g.avgScore }}<span class="text-slate-400">/{{ g.avgScore26 ?? '—' }}</span> · {{ g.avgRank ?? '—' }}<span class="text-slate-400">/{{ g.avgRank26 ?? '—' }}</span></span>
                </td>
              </tr>
              <tr v-if="isExpanded(g.schoolName)" class="expanded-row">
                <td colspan="6" class="p-0">
                  <table class="w-full text-xs recommend-detail-table">
                    <thead>
                      <tr class="bg-slate-100 text-slate-600">
                        <th class="px-2 py-1 text-left">专业类</th>
                        <th class="px-2 py-1 text-left">专业 (26 / 25)</th>
                        <th class="px-2 py-1 text-center" style="width:50px">招生</th>
                        <th class="px-2 py-1 text-center" style="width:160px">分数 25/26 · 位次 25/26</th>
                        <th class="px-2 py-1 text-center" style="width:60px">学费</th>
                        <th class="px-2 py-1 text-center" style="width:60px">学制</th>
                        <th class="px-2 py-1 text-center" style="width:80px">状态</th>
                        <th class="px-2 py-1 text-center" style="width:90px">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="p in g.plans" :key="p.id" class="border-t">
                        <td class="px-2 py-1">{{ p.majorClass || p.majorClass25 || '—' }}</td>
                        <td class="px-2 py-1">
                          <div>{{ p.majorName26 || p.majorName25 || '—' }}</div>
                          <div v-if="p.majorName25 && p.majorName26 && p.majorName25 !== p.majorName26" class="text-slate-400 text-[10px]">25: {{ p.majorName25 }}</div>
                        </td>
                        <td class="px-2 py-1 text-center">{{ p.enrollNum26 || p.enrollNum25 || '—' }}</td>
                        <td class="px-2 py-1 text-center">
                          <span class="font-bold">{{ score25Of(p) ?? '—' }}</span><span class="text-slate-400">/{{ score26Of(p) ?? '—' }}</span>
                          <span class="text-slate-400 mx-0.5">·</span>
                          <span>{{ rank25Of(p) ?? '—' }}</span><span class="text-slate-400">/{{ rank26Of(p) ?? '—' }}</span>
                        </td>
                        <td class="px-2 py-1 text-center">{{ p.tuition || p.tuition25 || '—' }}</td>
                        <td class="px-2 py-1 text-center">{{ formatDur25(p) || '—' }}</td>
                        <td class="px-2 py-1 text-center">
                          <span v-if="p.isStopped" class="text-red-500">停招</span>
                          <span v-else class="text-slate-500">{{ p.refConfidence || '—' }}</span>
                        </td>
                        <td class="px-2 py-1 text-center" @click.stop>
                          <button class="text-blue-600 hover:underline mr-1"
                                  @click="$emit('open-detail', p)">详情</button>
                          <button class="text-amber-600 hover:underline"
                                  :class="voluntarySet?.has(p.id) ? 'opacity-40' : ''"
                                  @click="$emit('toggle-voluntary', p.id)">
                            {{ voluntarySet?.has(p.id) ? '✓' : '+志' }}
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
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
      <!-- voluntary mode: 同表格但加 # 和 操作 列, 表头不可 sort/drag (但可 resize) -->
      <div v-else class="table-scroll">
        <table class="resizable-table w-full bg-white border text-xs">
          <thead>
            <tr>
              <!-- voluntary: 序号列 -->
              <th v-if="viewMode==='voluntary'" style="width:40px" class="text-center">#</th>
              <!-- voluntary: 操作列表头. 移动按钮在前, ✓↩ 在后. 支持多选 -->
              <th v-if="viewMode==='voluntary'" style="width:220px" class="text-center vol-actions-header">
                <!-- 选中行: 移动按钮 (作用于全部选中行) -->
                <template v-if="selectedCount() > 0">
                  <span class="text-xs text-blue-600 mr-1"
                        :title="selectedCount() === 1 ? '操作选中行' : '操作选中的 ' + selectedCount() + ' 行 (整块平移)'">
                    ▶ <span v-if="selectedCount() > 1" class="font-bold">{{ selectedCount() }}</span>
                  </span>
                  <button @click.stop="$emit('vol-move-selection', 'top')"
                          class="px-1 hover:bg-blue-100 rounded"
                          :title="selectedCount() === 1 ? '选中行 → 顶部 (智能: 锁定项→#1, 非锁定项→上方第一个锁定行下面)' : '整块选中 → 顶部'">⇈</button>
                  <button @click.stop="$emit('vol-move-selection', 'up')"
                          class="px-1 hover:bg-blue-100 rounded"
                          :title="selectedCount() === 1 ? '选中行 ↑ 上移一格' : '整块选中 ↑ 上移一格'">↑</button>
                  <button @click.stop="$emit('vol-move-selection', 'down')"
                          class="px-1 hover:bg-blue-100 rounded"
                          :title="selectedCount() === 1 ? '选中行 ↓ 下移一格' : '整块选中 ↓ 下移一格'">↓</button>
                  <button @click.stop="$emit('vol-move-selection', 'bottom')"
                          class="px-1 hover:bg-blue-100 rounded"
                          :title="selectedCount() === 1 ? '选中行 → 底部 (智能: 锁定项→最后一个锁定项下面, 非锁定项→下方第一个锁定行上面)' : '整块选中 → 底部'">⇊</button>
                  <button @click.stop="$emit('vol-clear-selection')"
                          class="ml-0.5 px-1 text-slate-400 hover:text-red-500 text-xs"
                          title="取消选中">×</button>
                </template>
                <!-- 编辑会话: 全部确认 / 全部撤销 (放后面, 避免按钮位移导致误操作) -->
                <template v-if="pendingSet && pendingSet.size > 0">
                  <span v-if="selectedCount() > 0" class="text-slate-300 mx-0.5">|</span>
                  <button @click.stop="$emit('vol-confirm-all')"
                          class="px-1.5 text-green-700 hover:bg-green-100 rounded font-bold"
                          title="全部确认: 把所有 ⏳ 升级为 📌 锁定">✓</button>
                  <button @click.stop="$emit('vol-cancel-all')"
                          class="px-1.5 text-amber-700 hover:bg-amber-100 rounded"
                          title="全部撤销: 数组+pinned 完整回滚到编辑前">↩</button>
                </template>
                <span v-if="!(pendingSet && pendingSet.size > 0) && selectedCount() === 0"
                      class="text-xs text-slate-400" title="点 # 选中 (Ctrl+点 多选, Shift+点 范围)">操作 (点 # 选中)</span>
              </th>
              <th v-for="c in columns" :key="c.key"
                  :class="['col-'+c.key, c.fixed ? 'fixed-col' : '']"
                  :style="{ width: colWidth(c) + 'px' }"
                  @dragover.prevent
                  @drop="viewMode !== 'voluntary' && onColDrop(c)">
                <!-- 拖动手柄 (左) - voluntary 不显示 -->
                <span v-if="!c.fixed && viewMode !== 'voluntary'" class="th-drag"
                      draggable="true"
                      @dragstart="onColDragStart(c, $event)"
                      title="拖动调整列顺序">⠿</span>
                <!-- 表头文字 (中) - voluntary 不点击排序 -->
                <span class="th-text" :class="(c.sortable && viewMode !== 'voluntary') ? 'sortable' : ''"
                      @click.stop="c.sortable && viewMode !== 'voluntary' && $emit('sort-col', c.sortField)">{{ c.label }}</span>
                <span v-if="sortIndicator(c) && viewMode !== 'voluntary'" class="sort-indicator">
                  {{ sortIndicator(c).dir === 'desc' ? '↓' : '↑' }}<sub>{{ sortIndicator(c).idx }}</sub>
                </span>
                <!-- 列宽 resize 手柄 (右) - 两种模式都可 -->
                <span v-if="!c.fixed" class="th-resize"
                      @mousedown.stop="startResize(c, $event)"
                      title="拖动调整列宽"></span>
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(p, idx) in plans" :key="p.id">
              <tr class="hover:bg-slate-50 cursor-pointer"
                  :class="[rowTier(p) ? 'tier-row-'+rowTier(p) : '', isExpanded(p.id) ? 'main-row-expanded' : '',
                           viewMode==='voluntary' && isSelected(p.id) ? 'vol-row-selected' : '']"
                  :data-vol-row-id="viewMode==='voluntary' ? p.id : null"
                  @click="$emit('toggle-expand', p.id)">
                <!-- voluntary: 序号列 (可点选中) + 锁定状态 -->
                <!-- 图标含义:
                     📌 (蓝)  = 已确认锁定
                     📌 (黄)  = 原本锁定, 编辑期间暂为待确认 (✓ 全部确认即恢复 📌)
                     ⏳ (黄)  = 本次编辑刚移动的, 原本未锁定
                -->
                <th v-if="viewMode==='voluntary'" class="vol-num-cell text-center cursor-pointer"
                    :class="[
                      isPinned(p.id) ? 'bg-blue-50' : isPending(p.id) ? 'bg-amber-50' : '',
                      isSelected(p.id) ? 'ring-2 ring-blue-500 ring-inset bg-blue-100' : 'hover:bg-blue-50'
                    ]"
                    title="单击选中 / Ctrl+点 多选切换 / Shift+点 范围选 / 再点同行取消"
                    @click.stop="$emit('vol-select', { id: p.id, ctrl: $event.ctrlKey, meta: $event.metaKey, shift: $event.shiftKey })">
                  <span v-if="isSelected(p.id)" class="text-blue-700 font-bold">▶</span>
                  {{ idx + 1 }}
                  <span v-if="isPinned(p.id)" class="text-blue-600" title="已锁定 (不参与自动排序)">📌</span>
                  <template v-else-if="isPending(p.id)">
                    <span v-if="wasPinned(p.id)" class="text-amber-600"
                          title="原本锁定 — 编辑期间暂为待确认, ✓ 全部确认即恢复锁定">📌</span>
                    <span v-else class="text-amber-600"
                          title="本次编辑刚移动 — ✓ 全部确认即锁定到当前位置, ↩ 全部撤销则丢弃">⏳</span>
                  </template>
                </th>
                <!-- voluntary: 行内操作 = 单行细粒度. 移动+全局✓↩ 在表头 -->
                <!-- 三档状态 (不同图标, 一眼可辨):
                     🔓  = 当前 pinned, 点击解锁
                     ↶  = pending + 原本就 pinned, 点击撤销该行变动 → 恢复原 📌
                     📌  = pending+原本非pinned OR 完全空闲, 点击锁定到当前位置
                -->
                <td v-if="viewMode==='voluntary'" class="text-center vol-actions">
                  <button v-if="isPinned(p.id)" @click.stop="$emit('vol-unpin', p.id)"
                          class="px-1 text-blue-600 hover:text-blue-800" title="🔓 解锁本行 (重新参与自动排序)">🔓</button>
                  <button v-else-if="isPending(p.id) && wasPinned(p.id)"
                          @click.stop="$emit('vol-cancel-pending', p.id)"
                          class="px-1 text-amber-600 hover:text-amber-800"
                          title="↶ 撤销本行的位置变动 → 恢复原 📌 锁定 (其它 ⏳ 不受影响)">↶</button>
                  <button v-else @click.stop="$emit('vol-pin-at-current', p.id)"
                          class="px-1 text-slate-400 hover:text-blue-600"
                          :title="isPending(p.id) ? '📌 单独锁定本行到当前位置 (其它 ⏳ 不动)' : '📌 锁定本行到当前位置'">📌</button>
                  <button @click.stop="$emit('toggle-voluntary', p.id)"
                          class="px-1 text-red-500 hover:text-red-700" title="移除">✕</button>
                  <button @click.stop="$emit('open-detail', p)"
                          class="px-1 text-blue-500 hover:underline" title="详情">详</button>
                </td>
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
                  <td v-else-if="c.key==='score'" :class="['col-'+c.key, 'font-bold text-blue-700 text-right cursor-text', isEdited(p) ? 'cell-edited' : '']"
                      :title="isEdited(p) ? '已手动修改 (双击重编辑, ↩ 恢复原始)' : '双击编辑 25 参考分 · 斜杠后是 26 等位分'"
                      @click.stop
                      @dblclick.stop="startEditScore(p, $event)">
                    <template v-if="editingScore === p.id">
                      <input type="number" v-model="editingValue"
                             @blur="commitEditScore"
                             @keydown.enter="commitEditScore"
                             @keydown.esc="cancelEditScore"
                             @click.stop
                             class="w-16 px-1 text-right border rounded bg-yellow-50">
                    </template>
                    <template v-else>
                      <span>{{ score25Of(p) ?? '—' }}</span><span v-if="isEdited(p)" class="text-amber-500 text-xs">*</span>
                      <span class="text-slate-400 font-normal mx-0.5">/</span>
                      <span class="text-slate-500 font-normal">{{ score26Of(p) ?? '—' }}</span>
                      <button v-if="isEdited(p)" @click.stop="$emit('revert-score', p.id)"
                              class="ml-1 text-xs text-blue-500 hover:text-blue-700"
                              title="恢复原始值">↩</button>
                    </template>
                  </td>
                  <td v-else-if="c.key==='rank'" :class="['col-'+c.key, 'text-right']">
                    <span>{{ rank25Of(p) ?? '—' }}</span>
                    <span class="text-slate-400 mx-0.5">/</span>
                    <span class="text-slate-500">{{ rank26Of(p) ?? '—' }}</span>
                  </td>
                  <td v-else-if="c.key==='admitProb'" :class="['col-'+c.key, 'text-center']">
                    <template v-if="getAdmit(p)">
                      <template v-if="getAdmit(p).prob != null">
                        <span :class="getAdmit(p).prob >= 0.7 ? 'text-green-700 font-bold' : getAdmit(p).prob >= 0.4 ? 'text-amber-700 font-bold' : 'text-red-600 font-bold'"
                              :title="(getAdmit(p).isEstimated ? '[新增, 按 anchor+5 分位次估] ' : '') +
                                       '热度: ' + (getAdmit(p).heat ? getAdmit(p).heat.name : '—') +
                                       ' | 参考位次 ' + (getAdmit(p).refRank ?? '?') +
                                       (getAdmit(p).isEstimated ? ' (估)' : ' (25=' + (getAdmit(p).ref25 ?? '?') + ' 平均=' + (getAdmit(p).avgRank ?? '?') + ')') +
                                       ' | 有效位次 ' + (getAdmit(p).effPlanRank ? Math.round(getAdmit(p).effPlanRank) : '?') +
                                       ' | diff ' + (getAdmit(p).diff != null ? (getAdmit(p).diff > 0 ? '+' + getAdmit(p).diff.toFixed(0) : getAdmit(p).diff.toFixed(0)) : '?')">
                          {{ (getAdmit(p).prob * 100).toFixed(0) }}%<span v-if="getAdmit(p).isEstimated" class="text-[9px] text-amber-600 ml-0.5">(估)</span>
                        </span>
                        <span v-if="getAdmit(p).heat && getAdmit(p).heat.idx >= 4" class="ml-0.5 text-[9px]"
                              :class="getAdmit(p).heat.idx >= 6 ? 'text-red-500' : 'text-amber-500'"
                              :title="getAdmit(p).heat.name">🔥</span>
                      </template>
                      <span v-else class="text-slate-400" title="新增专业, 无 25 参考">新?</span>
                    </template>
                    <span v-else class="text-slate-300">—</span>
                  </td>
                  <td v-else-if="c.key==='transfer'" :class="['col-'+c.key, 'text-center']">
                    <template v-if="getTransfer(p)">
                      <span v-if="getTransfer(p).level === 'ok'"
                            class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700"
                            :title="'目标命中: ' + getTransfer(p).matchedTargets.join('、')">✓ OK</span>
                      <span v-else-if="getTransfer(p).level === 'warn'"
                            class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700"
                            :title="'需转专业 (大类含): ' + getTransfer(p).matchedAccepts.join('、')">⚠ 需转</span>
                      <span v-else
                            class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700"
                            :title="'所含专业全部不在 目标 / 可接受 范围: ' + (getTransfer(p).majors || []).join('、')">✗ 错</span>
                    </template>
                    <span v-else class="text-slate-300">—</span>
                  </td>
                  <td v-else-if="c.key==='tuition'" :class="['col-'+c.key, 'text-right']">{{ cellValue(p, c.key) }}</td>
                  <td v-else-if="c.key==='conf'" :class="'col-'+c.key"><conf-badge :conf="cellValue(p, c.key)"></conf-badge></td>
                  <td v-else-if="c.key==='num' || c.key==='dur' || c.key==='sp' || c.key==='mp'"
                      :class="['col-'+c.key, 'text-center']">{{ cellValue(p, c.key) }}</td>
                  <td v-else-if="c.key==='actions'" :class="'col-'+c.key">
                    <!-- voluntary 模式下 actions 列不渲染 (操作已在前置列) -->
                    <template v-if="viewMode !== 'voluntary'">
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
                    </template>
                  </td>
                  <td v-else :class="['col-'+c.key, 'truncate']" :title="cellValue(p, c.key)">{{ cellValue(p, c.key) }}</td>
                </template>
              </tr>
              <!-- 展开行 V5 (Item 7: 紧凑 + 变化合并 25vs26 + 预测 1 行) -->
              <tr v-if="isExpanded(p.id)" class="expanded-row">
                <td :colspan="columns.length + (viewMode==='voluntary' ? 2 : 0)" class="bg-slate-50 p-3">
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
                              <td><b class="text-blue-700">{{ score26Of(p) ?? '—' }}</b><span class="text-[10px] text-slate-400">(等位)</span></td>
                              <td>{{ rank26Of(p) ?? '—' }}</td>
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

    // V9: 25 参考分 → 26 等位分/等位次
    const equiv26 = computed(() => {
      const p = props.plan;
      if (!p || !props.scoreRank) return { score26: null, rank26: null };
      const s25 = p.isStopped ? p.score25 : p.ref25Score;
      return equivFromScore25(s25, props.scoreRank);
    });
    return { chartRef, equiv26 };
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
              <tr><th class="w-32">参考最低分</th><td><b class="text-blue-700">{{ plan.ref25Score }}</b> 分 <span class="text-slate-400 ml-2">→ 26 等位 <b class="text-slate-700">{{ equiv26.score26 ?? '—' }}</b> 分</span></td></tr>
              <tr><th>参考最低位次</th><td><b class="text-blue-700">{{ plan.ref25Rank }}</b> 名 <span class="text-slate-400 ml-2">→ 26 等位 <b class="text-slate-700">{{ equiv26.rank26 ?? '—' }}</b> 名</span></td></tr>
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
  props: ["priority", "overrides", "filters", "transferTargets", "transferAccepts", "samePosPct",
          "totalVolunteers", "ratioChong", "ratioWen", "ratioBao", "cwbRanges", "rankRefine",
          "initialTab"],
  emits: ["close", "save", "reset",
          "update-transfer-targets", "update-transfer-accepts", "reset-transfer-lists",
          "set-pos",
          "update:totalVolunteers", "update:ratioChong", "update:ratioWen", "update:ratioBao",
          "update-cwb-ranges", "reset-cwb-ranges"],
  setup(props, { emit }) {
    const activeTab = ref(props.initialTab || "schools");
    watch(() => props.initialTab, v => { if (v) activeTab.value = v; });
    const tabs = [
      { key: "schools",      label: "🏫 学校",   nameKey: "name", filterKey: "schoolPriorityRange", mode: "range", group: "priority" },
      { key: "cities",       label: "🏙 城市",   nameKey: "city", filterKey: "cityPriorityMax",     mode: "max",   group: "priority" },
      { key: "majorClasses", label: "📚 专业类", nameKey: "name", filterKey: "majorClassPriorityMax", mode: "max", group: "priority" },
      { key: "majors",       label: "🔖 专业",   nameKey: "name", filterKey: "majorPriorityMax",     mode: "max", group: "priority" },
      { key: "ratio",        label: "📊 志愿分布",  group: "config" },
      { key: "cwbseg",       label: "📐 冲稳保段",  group: "config" },
      { key: "transfer",     label: "🎓 转专业",   group: "config" },
      { key: "refine",       label: "🎯 位次精修", group: "config" },
    ];
    // 转专业 编辑文本
    const targetText = ref((props.transferTargets || []).join("\n"));
    const acceptText = ref((props.transferAccepts || []).join("\n"));
    watch(() => props.transferTargets, v => { targetText.value = (v || []).join("\n"); });
    watch(() => props.transferAccepts, v => { acceptText.value = (v || []).join("\n"); });
    function saveTargets() {
      const lst = targetText.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      emit("update-transfer-targets", lst);
    }
    function saveAccepts() {
      const lst = acceptText.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      emit("update-transfer-accepts", lst);
    }

    // 编辑中的列表 (复制原 priority 数据 + 应用现有 override)
    const editing = reactive({ schools: [], cities: [], majorClasses: [], majors: [] });
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
    // V9: 分隔线按 sort 值 (而非数组位置) 切.
    // 第一个 sort > topN 的索引; 没有 override 时与 web app 实际过滤 (sort ≤ topN) 一致.
    const topNBreakIdx = computed(() => {
      const arr = currentItems.value;
      const top = currentTopN.value;
      if (!arr || !arr.length || !top) return 0;
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i].sort;
        if (s == null || s > top) return i;
      }
      return arr.length;
    });
    // 是否存在持久化的自定义 override (用户手动调过顺序; 此时显示顺序 ≠ priority.json sort)
    const hasOverride = computed(() => {
      const ov = props.overrides[activeTab.value];
      return Array.isArray(ov) && ov.length > 0;
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
      if (tabKey === "schools") return `[${(item.tag || '').split('/')[0]}] ${item.city} · 软科 ${item.rank}`;
      if (tabKey === "cities") return ``;
      if (tabKey === "majorClasses") return `[${item.category}]`;
      if (tabKey === "majors") return `[${item.category}/${item.majorClass}] ${item.code || ''}`;
      return "";
    }
    return { tabs, activeTab, editing, currentTab, currentItems, currentTopN,
             topNBreakIdx, hasOverride,
             move, moveToTop, moveToBottom, moveToPosition, resetTab, save, chipSubLabel,
             targetText, acceptText, saveTargets, saveAccepts };
  },
  template: `
    <div class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
         @click.self="$emit('close')">
      <div class="bg-white rounded-lg shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        <div class="flex items-center justify-between p-3 border-b">
          <h3 class="font-bold text-lg">⚙ 设置</h3>
          <button @click="$emit('close')" class="text-2xl leading-none text-slate-400 hover:text-red-500">×</button>
        </div>
        <!-- Tabs (含 排序 group + 配置 group); flex-wrap 保证窄屏所有 tab 都可见 -->
        <div class="flex flex-wrap border-b flex-shrink-0">
          <button v-for="t in tabs" :key="t.key"
                  @click="activeTab = t.key"
                  class="px-3 py-2 text-sm border-b-2 whitespace-nowrap flex-shrink-0"
                  :class="activeTab === t.key ? 'border-blue-600 text-blue-600 font-bold bg-blue-50' : 'border-transparent text-slate-500 hover:bg-slate-50'">
            {{ t.label }}<span v-if="t.group==='priority'"> ({{ editing[t.key].length }})</span>
          </button>
        </div>
        <!-- 主体 (按 tab group 分支渲染) -->
        <div class="flex-1 overflow-y-auto p-3">
          <!-- ====== priority tabs (学校/城市/专业类/专业 排序) ====== -->
          <template v-if="currentTab && currentTab.group === 'priority'">
            <div class="text-xs text-slate-500 mb-2">
              当前 sort ≤ {{ currentTopN }} 在分隔线之上 (V9: 按学校排序值过滤, 含并列档).
              点击 ↑/↓ 调整顺序, 或点击序号 # 跳位。
              <button @click="resetTab" class="ml-2 text-amber-600 hover:underline">重置当前 tab 为默认</button>
            </div>
            <div v-if="hasOverride" class="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded p-2 mb-2">
              ⚠ 当前显示的是<b>你之前手动保存的自定义排序</b>, 不是 priority.json 最新基础数据.
              如果想看到最新的并列档位 (1,1,1 / 2,2 / 3,3,3...), 点击右上"重置当前 tab 为默认".
            </div>
            <div class="space-y-0.5">
              <template v-for="(item, idx) in currentItems" :key="item[currentTab.nameKey] + idx">
                <div v-if="idx === topNBreakIdx" class="text-center text-xs text-slate-400 my-2 border-t pt-1">
                  ── sort ≤ {{ currentTopN }} 分隔线 ({{ topNBreakIdx }} 项) ──
                </div>
                <div class="priority-row flex items-center gap-2 p-1.5 hover:bg-slate-50 border-b">
                  <button @click="moveToPosition(idx)"
                          class="w-10 text-right text-xs text-slate-500 hover:text-blue-600"
                          title="点击跳位">#{{ idx + 1 }}</button>
                  <span v-if="item.sort != null"
                        class="text-[10px] px-1.5 rounded bg-blue-100 text-blue-700 font-mono"
                        :title="'学校排序值 ' + item.sort">{{ item.sort }}</span>
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
          </template>

          <!-- ====== 志愿分布 比例 tab ====== -->
          <template v-else-if="activeTab === 'ratio'">
            <div class="text-xs text-slate-500 mb-3">
              <b>志愿分布 比例</b> 用于推荐 + 顶部"冲稳保占比" 显示. 比例之和需等于 100%.
            </div>
            <div class="border rounded p-4 bg-slate-50 space-y-3 text-sm max-w-md">
              <label class="flex items-center justify-between">
                <span class="font-bold w-24">总志愿数:</span>
                <input type="number" :value="totalVolunteers" min="1" max="200"
                       @input="$emit('update:totalVolunteers', +$event.target.value || 1)"
                       class="w-24 border rounded px-2 py-1 text-center font-bold text-blue-700">
              </label>
              <div class="space-y-2 pt-2 border-t">
                <label class="flex items-center justify-between">
                  <span class="text-red-700 font-bold w-12">冲 %</span>
                  <input type="number" :value="Math.round(ratioChong*100)" min="0" max="100"
                         @input="$emit('update:ratioChong', (+$event.target.value || 0)/100)"
                         class="w-20 border rounded px-2 py-1 text-center">
                  <span class="text-slate-500 ml-3 w-20 text-right">{{ Math.round(totalVolunteers * ratioChong) }} 个</span>
                </label>
                <label class="flex items-center justify-between">
                  <span class="text-amber-700 font-bold w-12">稳 %</span>
                  <input type="number" :value="Math.round(ratioWen*100)" min="0" max="100"
                         @input="$emit('update:ratioWen', (+$event.target.value || 0)/100)"
                         class="w-20 border rounded px-2 py-1 text-center">
                  <span class="text-slate-500 ml-3 w-20 text-right">{{ Math.round(totalVolunteers * ratioWen) }} 个</span>
                </label>
                <label class="flex items-center justify-between">
                  <span class="text-green-700 font-bold w-12">保 %</span>
                  <input type="number" :value="Math.round(ratioBao*100)" min="0" max="100"
                         @input="$emit('update:ratioBao', (+$event.target.value || 0)/100)"
                         class="w-20 border rounded px-2 py-1 text-center">
                  <span class="text-slate-500 ml-3 w-20 text-right">{{ Math.round(totalVolunteers * ratioBao) }} 个</span>
                </label>
              </div>
              <div class="text-xs pt-2 border-t"
                   :class="Math.round((ratioChong+ratioWen+ratioBao)*100)===100 ? 'text-green-700' : 'text-red-600 font-bold'">
                合计 {{ Math.round((ratioChong+ratioWen+ratioBao)*100) }}%
                <span v-if="Math.round((ratioChong+ratioWen+ratioBao)*100)!==100">⚠ 应为 100%</span>
              </div>
              <div class="text-[10px] text-slate-400 pt-1">默认: 总 112 项 (辽宁物理类常见), 冲 25% / 稳 45% / 保 30%</div>
            </div>
          </template>

          <!-- ====== 冲稳保 段偏移 tab ====== -->
          <template v-else-if="activeTab === 'cwbseg'">
            <div class="text-xs text-slate-500 mb-3">
              <b>冲稳保 分数段偏移</b> (相对 25 等位分): 用于 顶部志愿分布 chips / 主表 tier 着色 /
              分析页 划档 / 录取率算法. 修改立即生效.
              <button @click="$emit('reset-cwb-ranges')" class="ml-2 text-amber-600 hover:underline">重置默认</button>
            </div>
            <div class="border rounded p-4 bg-slate-50 space-y-3 text-sm max-w-md">
              <div class="space-y-2">
                <div class="flex items-center gap-2">
                  <span class="font-bold w-12 text-red-700">冲档</span>
                  <span class="text-slate-500">: 25 等位分 +</span>
                  <input type="number" :value="cwbRanges.chong.lo"
                         @input="$emit('update-cwb-ranges', {...cwbRanges, chong:{...cwbRanges.chong, lo:+$event.target.value || 0}})"
                         class="w-16 border rounded px-2 py-1 text-center">
                  <span>~</span>
                  <input type="number" :value="cwbRanges.chong.hi"
                         @input="$emit('update-cwb-ranges', {...cwbRanges, chong:{...cwbRanges.chong, hi:+$event.target.value || 0}})"
                         class="w-16 border rounded px-2 py-1 text-center">
                </div>
                <div class="flex items-center gap-2">
                  <span class="font-bold w-12 text-amber-700">稳档</span>
                  <span class="text-slate-500">: 25 等位分 +</span>
                  <input type="number" :value="cwbRanges.wen.lo"
                         @input="$emit('update-cwb-ranges', {...cwbRanges, wen:{...cwbRanges.wen, lo:+$event.target.value || 0}})"
                         class="w-16 border rounded px-2 py-1 text-center">
                  <span>~</span>
                  <input type="number" :value="cwbRanges.wen.hi"
                         @input="$emit('update-cwb-ranges', {...cwbRanges, wen:{...cwbRanges.wen, hi:+$event.target.value || 0}})"
                         class="w-16 border rounded px-2 py-1 text-center">
                </div>
                <div class="flex items-center gap-2">
                  <span class="font-bold w-12 text-green-700">保档</span>
                  <span class="text-slate-500">: 25 等位分 +</span>
                  <input type="number" :value="cwbRanges.bao.lo"
                         @input="$emit('update-cwb-ranges', {...cwbRanges, bao:{...cwbRanges.bao, lo:+$event.target.value || 0}})"
                         class="w-16 border rounded px-2 py-1 text-center">
                  <span>~</span>
                  <input type="number" :value="cwbRanges.bao.hi"
                         @input="$emit('update-cwb-ranges', {...cwbRanges, bao:{...cwbRanges.bao, hi:+$event.target.value || 0}})"
                         class="w-16 border rounded px-2 py-1 text-center">
                </div>
              </div>
              <div class="text-xs text-slate-500 pt-2 border-t">
                默认 ( 推荐): 冲 <b>+6 ~ +20</b> / 稳 <b>-5 ~ +5</b> / 保 <b>-20 ~ -6</b>
              </div>
              <div class="text-[10px] text-slate-400">
                语义: 例 25 等位分=618, 冲 +6~+20 → 把 25 等位分在 624-638 的志愿当作"冲".
              </div>
            </div>
          </template>

          <!-- ====== 转专业 tab ====== -->
          <template v-else-if="activeTab === 'transfer'">
            <div class="text-xs text-slate-500 mb-2">
              <b>转专业风险扫描</b> 用这两个清单判断每个志愿:
              单专业/大类含任一<b class="text-green-700">目标</b> → ✓ OK;
              否则含任一<b class="text-amber-700">可接受</b> → ⚠ 需转;
              都没有 → ✗ 错.
              <button @click="$emit('reset-transfer-lists')" class="ml-2 text-amber-600 hover:underline">重置默认</button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div class="text-xs font-bold text-green-700 mb-1">目标专业 (无需转, {{ targetText.split('\\n').filter(x=>x.trim()).length }} 个)</div>
                <textarea v-model="targetText" @blur="saveTargets" rows="18"
                          class="w-full border rounded text-xs p-2 font-mono"
                          placeholder="每行一个专业名"></textarea>
                <div class="text-[10px] text-slate-400 mt-1">每行一个专业名, 失焦自动保存. 名字需与"招生专业 / 所含专业"列完全一致.</div>
              </div>
              <div>
                <div class="text-xs font-bold text-amber-700 mb-1">可接受转入 (录取后可转过去, {{ acceptText.split('\\n').filter(x=>x.trim()).length }} 个)</div>
                <textarea v-model="acceptText" @blur="saveAccepts" rows="18"
                          class="w-full border rounded text-xs p-2 font-mono"
                          placeholder="每行一个专业名"></textarea>
                <div class="text-[10px] text-slate-400 mt-1">大类志愿中若有此列专业, 标为"需转".</div>
              </div>
            </div>
          </template>

          <!-- ====== 位次精修 tab ====== -->
          <template v-else-if="activeTab === 'refine'">
            <div class="text-xs text-slate-500 mb-3">
              <b>位次精修</b> 把 26 同分组位置 + 上方扩招 综合,推出更准确的 25 等位分 / 位次.
              主查询 / 分析 任一开启"用修正位次"即生效.
            </div>
            <div v-if="!rankRefine" class="text-amber-600 text-sm border rounded p-3 bg-amber-50">
              请先在顶部填 26 分数 (有志愿单更佳),才能算位次精修.
            </div>
            <div v-else class="border rounded p-4 bg-slate-50 space-y-3 text-sm">
              <!-- Step 1 -->
              <div>
                <div class="font-bold text-slate-600 mb-2">Step 1 — 同分位置</div>
                <div class="flex items-center gap-2 pl-3">
                  <button @click="$emit('set-pos', 0)" class="px-2 py-1 border rounded text-xs"
                          :class="samePosPct==0 ? 'bg-blue-500 text-white' : 'bg-white'">上</button>
                  <input type="range" min="0" max="100" step="1" :value="samePosPct"
                         @input="$emit('set-pos', +$event.target.value)" class="flex-1 accent-blue-500"/>
                  <button @click="$emit('set-pos', 50)" class="px-2 py-1 border rounded text-xs"
                          :class="samePosPct==50 ? 'bg-blue-500 text-white' : 'bg-white'">中</button>
                  <button @click="$emit('set-pos', 100)" class="px-2 py-1 border rounded text-xs"
                          :class="samePosPct==100 ? 'bg-blue-500 text-white' : 'bg-white'">下</button>
                  <span class="font-bold text-blue-600 w-14 text-right">{{ samePosPct }}%</span>
                </div>
                <div class="text-xs text-slate-600 mt-1 pl-3">
                  26 同分 <b>{{rankRefine.cnt26}}</b> 人 → 26 位次 <b class="text-blue-700">{{rankRefine.R26}}</b>
                  → 反查 25 等位 <b class="text-purple-700">{{rankRefine.Y0}}</b> / 位次 <b>{{rankRefine.R25_0}}</b>
                </div>
                <div class="text-[10px] text-slate-400 mt-1 pl-3">
                  0% (上)=同分最强 · 50% (中,默认)=平均 · 100% (下)=同分最弱 (最保守)
                </div>
              </div>

              <!-- Step 2 -->
              <div class="pt-3 border-t">
                <div class="font-bold text-slate-600 mb-2">Step 2 — 上方扩招 (effective_ref25 ≥ {{rankRefine.Y0}}, {{rankRefine.nPlanAbove}} plan)</div>
                <div class="pl-3 space-y-1 text-xs">
                  <div>
                    ✓ 目标+可接受 ({{rankRefine.cntA}} plan):
                    <b :class="rankRefine.sumA >= 0 ? 'text-red-600' : 'text-green-600'">{{rankRefine.sumA >= 0 ? '+' : ''}}{{rankRefine.sumA}}</b> 名额
                    <span v-if="rankRefine.sumA_zwhz" class="text-[10px] text-slate-500">(含高分中外合作 {{rankRefine.sumA_zwhz >= 0 ? '+' : ''}}{{rankRefine.sumA_zwhz}})</span>
                    × 1.0
                  </div>
                  <div>
                    ⚪ 其他专业 ({{rankRefine.cntB}} plan):
                    <span>{{rankRefine.sumB >= 0 ? '+' : ''}}{{rankRefine.sumB}}</span> × 0.2 =
                    <b>{{(rankRefine.sumB * 0.2).toFixed(0)}}</b>
                  </div>
                  <div class="font-bold pt-1">
                    上方累计 →
                    <span :class="rankRefine.totalShift >= 0 ? 'text-green-700' : 'text-red-600'">
                      位次 {{rankRefine.totalShift >= 0 ? '-' + rankRefine.totalShift.toFixed(0) : '+' + (-rankRefine.totalShift).toFixed(0)}}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Step 3 -->
              <div class="pt-3 border-t">
                <div>
                  <b class="text-slate-700">修正后:</b>
                  25 等位 <b class="text-purple-700">{{rankRefine.Y_final}}</b>
                  / 位次 <b class="text-purple-700">{{rankRefine.R25_final}}</b>
                </div>
              </div>
              <div class="text-[10px] text-slate-400">
                说明: 中外合作 plan 用 effective_ref25 = ref25 -15 (民族班 -10);
                修正口径 = 目标+可接受 × 1.0 + 其他 × 0.2.
                顶部 "🎯 用修正位次" 开启时, 主查询 / 左侧筛选 / 分析 全部自动用 修正后值.
              </div>
            </div>
          </template>
        </div>
        <!-- Footer (priority tabs 才显 保存按钮; 其它 tabs 自动保存) -->
        <div class="flex items-center justify-between p-3 border-t">
          <button v-if="currentTab && currentTab.group === 'priority'"
                  @click="$emit('reset')" class="text-sm text-red-500 hover:underline">重置全部排序默认</button>
          <span v-else class="text-xs text-slate-400">该 tab 改动自动保存</span>
          <div class="flex gap-2">
            <button @click="$emit('close')" class="px-3 py-1 border rounded text-sm hover:bg-slate-100">关闭</button>
            <button v-if="currentTab && currentTab.group === 'priority'"
                    @click="save" class="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">保存排序</button>
          </div>
        </div>
      </div>
    </div>
  `,
};

// V9: 志愿分析 (普通视图 + 兼容 modal). prop.embedded=true 时去掉 modal 外壳
const VoluntaryAnalysis = {
  props: ["analysis", "listName", "anchorOverride", "rankOverride", "expandedSchools", "expandedScores", "expandedTiers", "expandedEnrollScores", "expandedMajors", "expandedCities", "embedded",
          "targets", "accepts", "ignoreHeat", "rankRefine", "samePosPct", "useRefinedQuery"],
  emits: ["close", "set-anchor", "set-rank", "toggle-school", "toggle-score", "toggle-tier", "toggle-enroll-score", "toggle-major", "toggle-city",
          "update-targets", "update-accepts", "reset-transfer-lists", "toggle-ignore-heat",
          "set-pos"],
  setup(props, { emit }) {
    const maxScoreCount = computed(() => {
      if (!props.analysis) return 1;
      return Math.max(1, ...props.analysis.byScore.map(r => r.count));
    });
    const maxSchoolCount = computed(() => {
      if (!props.analysis) return 1;
      return Math.max(1, ...props.analysis.bySchool.map(r => r.count));
    });
    // 合并连续空分行: 多个 count=0 折成一行 (例: "631 - 629 共 3 分无志愿")
    const byScoreCompact = computed(() => {
      if (!props.analysis) return [];
      const out = [];
      let gap = null;
      const flush = () => {
        if (!gap) return;
        const len = gap.from - gap.to + 1;
        out.push({ type: "gap", from: gap.from, to: gap.to, len, tiers: gap.tiers });
        gap = null;
      };
      // byScore 是 score 降序 (hi → lo)
      for (const r of props.analysis.byScore) {
        if (r.count === 0) {
          if (!gap) gap = { from: r.score, to: r.score, tiers: new Set() };
          gap.to = r.score;  // 越往后越小
          gap.tiers.add(r.tier);
        } else {
          flush();
          out.push({ type: "row", data: r });
        }
      }
      flush();
      return out;
    });
    const anchorInput = ref("");
    const rankInput = ref("");
    const ecBucket = ref("b20");   // 招生变化 区间宽度: b20 / b10 / all
    const ecExpanded = reactive({});  // {i: bool}
    const currentEnrollChange = computed(() => {
      if (!props.analysis) return [];
      if (ecBucket.value === "b20") return props.analysis.enrollChangeBucket20 || [];
      if (ecBucket.value === "b10") return props.analysis.enrollChangeBucket10 || [];
      return props.analysis.enrollChangeByScore25 || [];
    });
    const totalEnroll25 = computed(() => (props.analysis?.enrollChangeByScore25 || []).reduce((s, r) => s + r.n25, 0));
    const totalEnroll26 = computed(() => (props.analysis?.enrollChangeByScore25 || []).reduce((s, r) => s + r.n26, 0));

    // 按学校 招生变化 — filter / sort / 展开
    const ecSchoolSort = ref("abs");      // abs / inc / dec / rank
    const ecSchoolTier = ref("all");      // all / 985 / 211 / 双一流 / 省重点
    const ecSchoolKw = ref("");
    const schEcExpanded = reactive({});
    const filteredSchoolEc = computed(() => {
      const src = props.analysis?.enrollChangeBySchool || [];
      if (!src.length) return [];
      const kw = ecSchoolKw.value.trim().toLowerCase();
      let list = src.filter(r => {
        if (ecSchoolTier.value !== "all" && !(r.schoolTag || "").includes(ecSchoolTier.value)) return false;
        if (kw) {
          const hay = (r.schoolName + " " + (r.city || "")).toLowerCase();
          if (!hay.includes(kw)) return false;
        }
        return true;
      });
      const sk = ecSchoolSort.value;
      if (sk === "abs") list = list.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (a.schoolRank - b.schoolRank));
      else if (sk === "inc") list = list.slice().sort((a, b) => b.delta - a.delta);
      else if (sk === "dec") list = list.slice().sort((a, b) => a.delta - b.delta);
      else if (sk === "rank") list = list.slice().sort((a, b) => a.schoolRank - b.schoolRank);
      return list;
    });
    const schoolEcSum = computed(() => {
      const list = filteredSchoolEc.value;
      const n25 = list.reduce((s, r) => s + r.n25, 0);
      const n26 = list.reduce((s, r) => s + r.n26, 0);
      return { n25, n26, delta: n26 - n25 };
    });
    watch(() => props.analysis, (a) => {
      if (a) {
        anchorInput.value = String(a.anchor25 || "");
        rankInput.value = String(a.userRank26 || "");
      }
    }, { immediate: true });
    function commitAnchor() {
      const v = parseInt(anchorInput.value, 10);
      emit("set-anchor", v > 0 ? v : null);
    }
    function resetAnchor() {
      anchorInput.value = String(props.analysis?.autoAnchor25 || "");
      emit("set-anchor", null);
    }
    function commitRank() {
      const v = parseInt(rankInput.value, 10);
      emit("set-rank", v > 0 ? v : null);
    }
    function resetRank() {
      rankInput.value = String(props.analysis?.myRank26 || "");
      emit("set-rank", null);
    }
    return { maxScoreCount, maxSchoolCount, byScoreCompact,
             anchorInput, commitAnchor, resetAnchor,
             rankInput, commitRank, resetRank,
             ecBucket, ecExpanded, currentEnrollChange, totalEnroll25, totalEnroll26,
             ecSchoolSort, ecSchoolTier, ecSchoolKw, schEcExpanded, filteredSchoolEc, schoolEcSum };
  },
  template: `
    <div :class="embedded ? 'bg-white rounded shadow border text-sm' : 'fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4'"
         @click.self="!embedded && $emit('close')">
      <div :class="embedded ? '' : 'bg-white rounded-lg shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col text-sm'">
        <div class="flex items-center justify-between p-3 border-b">
          <h3 class="font-bold text-lg">📊 志愿分析 — {{ listName }}</h3>
          <button v-if="!embedded" @click="$emit('close')" class="text-2xl leading-none text-slate-400 hover:text-red-500">×</button>
          <button v-else @click="$emit('close')" class="text-sm px-2 py-1 border rounded hover:bg-slate-100" title="返回志愿表">← 返回志愿</button>
        </div>
        <div v-if="!analysis" :class="embedded ? 'p-8 text-center' : 'flex-1 flex items-center justify-center'" class="text-slate-400 py-12">
          请先在顶部输入 26 分数, 且志愿单不为空
        </div>
        <div v-else :class="embedded ? 'p-4 space-y-4' : 'flex-1 overflow-y-auto p-4 space-y-4'">
          <!-- 总览 + anchor 调整 -->
          <section>
            <div class="text-xs text-slate-500 mb-1">总览 (统计基于 plan.25 参考分)</div>
            <div class="flex flex-wrap items-center gap-4 text-sm bg-slate-50 rounded p-2">
              <span>26 分数: <b class="text-blue-600">{{ analysis.my26 }}</b></span>
              <span title="自动从 26 分数转出 25 等位分; 可手调">
                25 等位:
                <input type="number" v-model="anchorInput" @change="commitAnchor" @blur="commitAnchor"
                       class="w-16 border rounded px-1 py-0.5 text-center font-bold text-blue-700">
                <button @click="resetAnchor" class="ml-1 text-xs text-slate-400 hover:text-blue-600" title="自动 (= {{ analysis.autoAnchor25 }})">⟲</button>
              </span>
              <span title="加权录取比率用. 默认 = 输入框里的 myRank, 可调 (例 8324→8150)">
                25 等位位次:
                <input type="number" v-model="rankInput" @change="commitRank" @blur="commitRank"
                       class="w-20 border rounded px-1 py-0.5 text-center font-bold text-purple-700">
                <button @click="resetRank" class="ml-1 text-xs text-slate-400 hover:text-purple-600" title="自动 (= myRank {{ analysis.myRank26 }})">⟲</button>
              </span>
              <!-- 用修正位次 启用时 显示状态 -->
              <span v-if="useRefinedQuery && rankRefine"
                    class="flex items-center gap-1 px-2 py-1 rounded text-xs bg-purple-50 border border-purple-300 text-purple-700">
                <span class="font-bold">🎯 已用修正位次</span>
                <span>(同分 {{samePosPct}}%)</span>
              </span>
              <span>志愿: <b class="text-blue-600">{{ analysis.total }}</b> 项</span>
              <span>26 计划: <b class="text-blue-600">{{ analysis.totalEnroll }}</b> 人</span>
              <label class="flex items-center gap-1 cursor-pointer ml-3 text-slate-600"
                     title="勾选: 录取率算法忽略专业热度 (电子信息/计算机 等热度调整)">
                <input type="checkbox" :checked="ignoreHeat" @change="$emit('toggle-ignore-heat', $event.target.checked)"
                       class="cursor-pointer">
                <span>🔥 忽略专业热度</span>
              </label>
            </div>

          </div>
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-2 text-xs">
              <div v-for="k in ['chong','wen','bao','out']" :key="k"
                   :class="[
                     'border rounded p-2 cursor-pointer',
                     k==='chong' ? 'bg-red-50 border-red-200' :
                     k==='wen'   ? 'bg-amber-50 border-amber-200' :
                     k==='bao'   ? 'bg-green-50 border-green-200' :
                                   'bg-slate-100 border-slate-200',
                     expandedTiers.includes(k) ? 'ring-2 ring-offset-1' : ''
                   ]"
                   @click="$emit('toggle-tier', k)">
                <div class="flex justify-between items-center">
                  <span :class="{ chong: 'text-red-700', wen: 'text-amber-700', bao: 'text-green-700', out: 'text-slate-600' }[k]" class="font-bold">
                    {{ {chong:'冲',wen:'稳',bao:'保',out:'范围外'}[k] }}
                    <span v-if="k !== 'out'" class="font-normal text-[10px] text-slate-500">[{{ analysis.ranges[k].lo }}-{{ analysis.ranges[k].hi }}]</span>
                  </span>
                  <span class="text-slate-400 text-xs">{{ expandedTiers.includes(k) ? '▾' : '▸' }}</span>
                </div>
                <div class="mt-1">
                  <b>{{ analysis.tiers[k].items.length }}</b> 项
                  <span v-if="analysis.tiers[k].newItems.length"
                        :class="k==='chong'?'text-red-600':k==='wen'?'text-amber-700':k==='bao'?'text-green-700':'text-slate-500'"
                        title="新增专业 (无 25 年参考, 录取概率不确定)">
                    (确定 {{ analysis.tiers[k].confirmedItems.length }} · <b class="underline decoration-dotted">新 {{ analysis.tiers[k].newItems.length }}</b>)
                  </span>
                </div>
                <div>26招 <b>{{ analysis.tiers[k].enroll }}</b><span v-if="analysis.tiers[k].newEnroll" class="text-[10px] text-slate-500"> (新{{ analysis.tiers[k].newEnroll }})</span> / 同分 {{ analysis.tiers[k].cnt26 || '?' }}</div>
              </div>
            </div>

            <!-- tier 展开详细表 -->
            <div v-for="k in ['chong','wen','bao','out']" :key="'exp-'+k"
                 v-show="expandedTiers.includes(k) && analysis.tiers[k].items.length"
                 class="mt-2 border rounded bg-white">
              <div class="px-3 py-1.5 text-xs font-bold flex justify-between items-center"
                   :class="k==='chong'?'bg-red-50 text-red-700':k==='wen'?'bg-amber-50 text-amber-700':k==='bao'?'bg-green-50 text-green-700':'bg-slate-100 text-slate-700'">
                <span>{{ {chong:'冲',wen:'稳',bao:'保',out:'范围外'}[k] }}档详细 ({{ analysis.tiers[k].items.length }} 项)</span>
                <button @click.stop="$emit('toggle-tier', k)" class="text-slate-400 hover:text-slate-600">收起 ×</button>
              </div>
              <table class="w-full text-[11px]">
                <thead class="bg-slate-100">
                  <tr>
                    <th class="px-2 py-1 text-left w-8">标识</th>
                    <th class="px-2 py-1 text-left">学校</th>
                    <th class="px-2 py-1 text-left w-16">城市</th>
                    <th class="px-2 py-1 text-left">26 招生专业 (含热度)</th>
                    <th class="px-2 py-1 text-center w-14">25 分/位</th>
                    <th class="px-2 py-1 text-center w-12">26 计划</th>
                    <th class="px-2 py-1 text-center w-12">学费</th>
                    <th class="px-2 py-1 text-center w-12" title="算法: 位次 sigmoid × 热度调整">录取率</th>
                  </tr>
                </thead>
                <tbody>
                  <!-- 确定 -->
                  <tr v-for="it in analysis.tiers[k].confirmedItems" :key="it.id" class="border-t"
                      :class="it.plan.isNew==='新增' ? 'bg-yellow-50/50' : ''">
                    <td class="px-2 py-0.5">
                      <span v-if="it.plan.isNew==='新增'" class="badge-new">新</span>
                      <span v-else-if="it.plan.diff" class="badge-diff" title="25 vs 26 有变化">变</span>
                    </td>
                    <td class="px-2 py-0.5">{{ it.plan.schoolName }}</td>
                    <td class="px-2 py-0.5">{{ it.plan.city || '—' }}</td>
                    <td class="px-2 py-0.5">
                      <span v-if="it.plan.isNew==='新增'" class="badge-new">新</span>
                      <span v-else-if="it.plan.diff" class="badge-diff" :title="it.plan.diff">变</span>
                      {{ it.plan.majorName26 || it.plan.majorName25 || '—' }}
                      <span v-if="it.admit && it.admit.heat && it.admit.heat.idx >= 4"
                            class="ml-1 text-[10px] px-1 rounded"
                            :class="it.admit.heat.idx >= 6 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'"
                            :title="'热度: ' + it.admit.heat.name">🔥{{ it.admit.heat.name }}</span>
                    </td>
                    <td class="px-2 py-0.5 text-center"><b>{{ it.score25 || '—' }}</b>/{{ it.rank25 || '—' }}</td>
                    <td class="px-2 py-0.5 text-center">{{ it.enroll || '—' }}</td>
                    <td class="px-2 py-0.5 text-center">{{ it.plan.tuition || '—' }}</td>
                    <td class="px-2 py-0.5 text-center">
                      <span v-if="it.admit && it.admit.prob != null"
                            :class="probColorClass(it.admit.prob)">
                        {{ (it.admit.prob * 100).toFixed(0) }}%
                      </span>
                      <span v-else class="text-slate-300">—</span>
                    </td>
                  </tr>
                  <!-- 不确定 (新增) -->
                  <tr v-if="analysis.tiers[k].newItems.length" class="bg-yellow-50 border-t border-yellow-200">
                    <td colspan="8" class="px-2 py-1 text-yellow-800 text-xs font-bold">
                      ⚠ 不确定 — {{ analysis.tiers[k].newItems.length }} 个新增专业 (无 25 年参考, 录取概率不可靠)
                    </td>
                  </tr>
                  <tr v-for="it in analysis.tiers[k].newItems" :key="'n-'+it.id" class="border-t bg-yellow-50/50">
                    <td class="px-2 py-0.5"><span class="badge-new">新</span></td>
                    <td class="px-2 py-0.5">{{ it.plan.schoolName }}</td>
                    <td class="px-2 py-0.5">{{ it.plan.city || '—' }}</td>
                    <td class="px-2 py-0.5">
                      <span class="badge-new">新</span>
                      {{ it.plan.majorName26 || it.plan.majorName25 || '—' }}
                      <span v-if="it.admit && it.admit.heat && it.admit.heat.idx >= 4"
                            class="ml-1 text-[10px] px-1 rounded"
                            :class="it.admit.heat.idx >= 6 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'">🔥{{ it.admit.heat.name }}</span>
                    </td>
                    <td class="px-2 py-0.5 text-center"><b>{{ it.score25 || '—' }}</b>/{{ it.rank25 || '—' }}</td>
                    <td class="px-2 py-0.5 text-center">{{ it.enroll || '—' }}</td>
                    <td class="px-2 py-0.5 text-center">{{ it.plan.tuition || '—' }}</td>
                    <td class="px-2 py-0.5 text-center">
                      <span v-if="it.admit && it.admit.prob != null"
                            :class="probColorClass(it.admit.prob)"
                            title="按 25 等位分+5 分位次粗估">
                        {{ (it.admit.prob * 100).toFixed(0) }}%<span class="text-[9px] text-amber-600 ml-0.5">(估)</span>
                      </span>
                      <span v-else class="text-slate-400">新?</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="text-[10px] text-slate-400 mt-1">
              本分析规则: 冲 +6~+20 / 稳 -5~+5 / 保 -20~-6 (相对 25 等位分).
              录取比率 = 招生人数 (志愿单内 26 计划) / 同分人数 (26 一分一段, 按 25→26 等位映射)
            </div>
          </section>

          <!-- 录取候选 Top 汇总 (各档 Top 3 + 多阈值 Top 5) -->
          <section>
            <admit-top-summary :analysis="analysis"></admit-top-summary>
          </section>

          <!-- 转专业风险分析 -->
          <section>
            <transfer-risk-section :analysis="analysis" :targets="targets" :accepts="accepts"
                                   @update-targets="$emit('update-targets', $event)"
                                   @update-accepts="$emit('update-accepts', $event)"
                                   @reset-lists="$emit('reset-transfer-lists')"></transfer-risk-section>
          </section>

          <!-- 录取趋势图 (按志愿顺序 + 阈值首达点) -->
          <section>
            <admit-trend-chart :items="analysis.items"></admit-trend-chart>
          </section>

          <!-- 占比柱 -->
          <section>
            <div class="text-xs text-slate-500 mb-1">冲稳保占比 (项数)</div>
            <div class="flex h-7 rounded overflow-hidden text-xs text-white font-bold">
              <div v-if="analysis.tiers.chong.items.length" class="bg-red-500 flex items-center justify-center"
                   :style="{ flex: analysis.tiers.chong.items.length }">冲 {{ analysis.tiers.chong.items.length }}</div>
              <div v-if="analysis.tiers.wen.items.length" class="bg-amber-500 flex items-center justify-center"
                   :style="{ flex: analysis.tiers.wen.items.length }">稳 {{ analysis.tiers.wen.items.length }}</div>
              <div v-if="analysis.tiers.bao.items.length" class="bg-green-500 flex items-center justify-center"
                   :style="{ flex: analysis.tiers.bao.items.length }">保 {{ analysis.tiers.bao.items.length }}</div>
              <div v-if="analysis.tiers.out.items.length" class="bg-slate-400 flex items-center justify-center"
                   :style="{ flex: analysis.tiers.out.items.length }">外 {{ analysis.tiers.out.items.length }}</div>
            </div>
          </section>

          <!-- 按分数 + 按学校 并排 (PC) / 上下 (mobile), 都不滚动完整显示 -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <!-- 按分数 (含 gap, 含录取比率) -->
          <section>
            <div class="text-xs text-slate-500 mb-1">
              每个 25 参考分 (含空档, 共 {{ analysis.byScore.length }} 分) — <b>同分</b>(26)按 25→26 等位映射查 2026 一分一段
            </div>
            <div class="border rounded bg-white overflow-hidden">
              <table class="w-full text-xs analysis-score-table">
                <thead>
                  <tr class="bg-slate-100 border-b-2 border-slate-300">
                    <th class="px-2 py-1.5 text-left w-12">25 分</th>
                    <th class="px-2 py-1.5 text-center w-8">档</th>
                    <th class="px-2 py-1.5 text-center w-12" title="25 一分一段累计位次">25位次</th>
                    <th class="px-2 py-1.5 text-center w-14" title="该 25 等位分 - 你的 25 等位分 (正=上冲, 负=下保)">Δ分</th>
                    <th class="px-2 py-1.5 text-center w-14" title="你的 25 等位分位次 - 该 25 等位分位次 (正=上冲, 负=下保)">Δ位次</th>
                    <th class="px-2 py-1.5 text-center w-8">N</th>
                    <th class="px-2 py-1.5 text-center w-12">26招生</th>
                    <th class="px-2 py-1.5 text-center w-12" title="26 同分人数 (一分一段本分人数)">26同分</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="(item, ii) in byScoreCompact" :key="ii">
                    <!-- 折叠空档 -->
                    <tr v-if="item.type === 'gap'" class="border-b border-slate-200 bg-slate-50/60 text-slate-400 italic">
                      <td colspan="8" class="px-3 py-1 text-center">
                        <template v-if="item.len === 1">{{ item.from }} 分: 无志愿</template>
                        <template v-else>{{ item.from }} - {{ item.to }} ({{ item.len }} 分) 无志愿</template>
                      </td>
                    </tr>
                    <!-- 数据行 -->
                    <template v-else>
                    <tr :class="[
                          'border-b border-slate-200 cursor-pointer transition-colors',
                          {chong:'tier-row-chong', wen:'tier-row-wen', bao:'tier-row-bao'}[item.data.tier] || '',
                          expandedScores.includes(item.data.score) ? 'bg-blue-50' : 'hover:bg-slate-50'
                        ]"
                        @click="$emit('toggle-score', item.data.score)">
                      <td class="px-2 py-1.5 font-bold">
                        <span class="text-slate-400 mr-1">{{ expandedScores.includes(item.data.score) ? '▾' : '▸' }}</span>
                        {{ item.data.score }}
                      </td>
                      <td class="px-2 py-1.5 text-center">
                        <span class="inline-block px-1.5 rounded text-white text-[10px] font-bold"
                              :class="item.data.tier==='chong'?'bg-red-500':item.data.tier==='wen'?'bg-amber-500':item.data.tier==='bao'?'bg-green-500':'bg-slate-400'">
                          {{ {chong:'冲',wen:'稳',bao:'保',out:'外'}[item.data.tier] }}
                        </span>
                      </td>
                      <td class="px-2 py-1.5 text-center text-slate-600">{{ item.data.rank25 ?? '—' }}</td>
                      <td class="px-2 py-1.5 text-center font-mono">
                        <span v-if="item.data.deltaScore != null"
                              :class="item.data.deltaScore > 0 ? 'text-red-600 font-bold' : item.data.deltaScore < 0 ? 'text-green-700 font-bold' : 'text-amber-700 font-bold'">
                          {{ item.data.deltaScore > 0 ? '↑+' + item.data.deltaScore : item.data.deltaScore < 0 ? '↓' + item.data.deltaScore : '— 0' }}
                        </span>
                        <span v-else class="text-slate-300">—</span>
                      </td>
                      <td class="px-2 py-1.5 text-center font-mono">
                        <span v-if="item.data.deltaRank != null"
                              :class="item.data.deltaRank > 0 ? 'text-red-600 font-bold' : item.data.deltaRank < 0 ? 'text-green-700 font-bold' : 'text-amber-700 font-bold'">
                          {{ item.data.deltaRank > 0 ? '↑+' + item.data.deltaRank : item.data.deltaRank < 0 ? '↓' + item.data.deltaRank : '— 0' }}
                        </span>
                        <span v-else class="text-slate-300">—</span>
                      </td>
                      <td class="px-2 py-1.5 text-center font-bold">{{ item.data.count }}</td>
                      <td class="px-2 py-1.5 text-center font-bold text-blue-700">{{ item.data.enroll }}</td>
                      <td class="px-2 py-1.5 text-center text-slate-600">{{ item.data.cnt26 ?? '—' }}</td>
                    </tr>
                    <tr v-if="expandedScores.includes(item.data.score)" class="bg-slate-50 border-b border-slate-300">
                      <td colspan="8" class="px-2 py-1">
                        <table class="w-full text-[11px] bg-white border rounded">
                          <thead>
                            <tr class="bg-slate-100">
                              <th class="px-2 py-1 text-left">学校</th>
                              <th class="px-2 py-1 text-left">城市</th>
                              <th class="px-2 py-1 text-left">26 招生专业</th>
                              <th class="px-2 py-1 text-center w-14">25 分/位</th>
                              <th class="px-2 py-1 text-center w-12">26 计划</th>
                              <th class="px-2 py-1 text-center w-12">学费</th>
                              <th class="px-2 py-1 text-center w-12">录取率</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="it in item.data.items" :key="it.id" class="border-t"
                                :class="it.plan.isNew==='新增' ? 'bg-yellow-50/50' : ''">
                              <td class="px-2 py-0.5">{{ it.plan.schoolName }}</td>
                              <td class="px-2 py-0.5">{{ it.plan.city || '—' }}</td>
                              <td class="px-2 py-0.5">
                                <span v-if="it.plan.isNew==='新增'" class="badge-new">新</span>
                                <span v-else-if="it.plan.diff" class="badge-diff" :title="it.plan.diff">变</span>
                                {{ it.plan.majorName26 || it.plan.majorName25 || '—' }}
                                <span v-if="it.admit && it.admit.heat && it.admit.heat.idx >= 4"
                                      class="ml-1 text-[10px] px-1 rounded"
                                      :class="it.admit.heat.idx >= 6 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'">🔥{{ it.admit.heat.name }}</span>
                              </td>
                              <td class="px-2 py-0.5 text-center"><b>{{ it.score25 || '—' }}</b>/{{ it.rank25 || '—' }}</td>
                              <td class="px-2 py-0.5 text-center">{{ it.enroll || '—' }}</td>
                              <td class="px-2 py-0.5 text-center">{{ it.plan.tuition || '—' }}</td>
                              <td class="px-2 py-0.5 text-center">
                                <span v-if="it.admit && it.admit.prob != null"
                                      :class="probColorClass(it.admit.prob)">
                                  {{ (it.admit.prob * 100).toFixed(0) }}%<span v-if="it.admit.isEstimated" class="text-[9px] text-amber-600 ml-0.5">(估)</span>
                                </span>
                                <span v-else class="text-slate-400">新?</span>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                    </template><!-- /row -->
                  </template><!-- /v-for byScoreCompact -->
                </tbody>
              </table>
            </div>
          </section>

          <!-- 按学校 (可展开) -->
          <section>
            <div class="text-xs text-slate-500 mb-1">每所学校 ({{ analysis.bySchool.length }} 所) — 点行展开详情</div>
            <div class="border rounded bg-white">
              <table class="w-full text-xs">
                <thead class="sticky top-0 bg-slate-100">
                  <tr>
                    <th class="px-2 py-1 text-left">学校</th>
                    <th class="px-2 py-1 text-center w-10">N</th>
                    <th class="px-2 py-1 text-center w-12">26计划</th>
                    <th class="px-2 py-1 text-center w-8 text-red-600">冲</th>
                    <th class="px-2 py-1 text-center w-8 text-amber-600">稳</th>
                    <th class="px-2 py-1 text-center w-8 text-green-600">保</th>
                    <th class="px-2 py-1 text-center w-16" title="该校所有志愿录取率的最大值, 近似为'被该校录取的概率'">校录取率</th>
                    <th class="px-2 py-1 text-left">分布</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="s in analysis.bySchool" :key="s.name">
                    <tr class="border-t hover:bg-slate-50 cursor-pointer"
                        @click="$emit('toggle-school', s.name)">
                      <td class="px-2 py-0.5">
                        <span class="text-slate-400 mr-1">{{ expandedSchools.includes(s.name) ? '▾' : '▸' }}</span>
                        {{ s.name }}
                      </td>
                      <td class="px-2 py-0.5 text-center font-bold">{{ s.count }}</td>
                      <td class="px-2 py-0.5 text-center">{{ s.enroll }}</td>
                      <td class="px-2 py-0.5 text-center text-red-600">{{ s.tiers.chong || '-' }}</td>
                      <td class="px-2 py-0.5 text-center text-amber-600">{{ s.tiers.wen || '-' }}</td>
                      <td class="px-2 py-0.5 text-center text-green-600">{{ s.tiers.bao || '-' }}</td>
                      <td class="px-2 py-0.5 text-center font-bold"
                          :class="probColorClass(s.maxAdmitProb)"
                          :title="s.maxAdmitItem ? ('最高: ' + (s.maxAdmitItem.plan.majorName26 || s.maxAdmitItem.plan.majorName25)) : ''">
                        <span v-if="s.maxAdmitProb != null">{{ (s.maxAdmitProb*100).toFixed(0) }}%</span>
                        <span v-else class="text-slate-300">—</span>
                      </td>
                      <td class="px-2 py-0.5">
                        <div class="flex h-3 rounded overflow-hidden" :style="{ width: (s.count / maxSchoolCount * 100) + '%', minWidth: '8px' }">
                          <div v-if="s.tiers.chong" class="bg-red-400" :style="{ flex: s.tiers.chong }"></div>
                          <div v-if="s.tiers.wen" class="bg-amber-400" :style="{ flex: s.tiers.wen }"></div>
                          <div v-if="s.tiers.bao" class="bg-green-400" :style="{ flex: s.tiers.bao }"></div>
                          <div v-if="s.tiers.out" class="bg-slate-400" :style="{ flex: s.tiers.out }"></div>
                        </div>
                      </td>
                    </tr>
                    <tr v-if="expandedSchools.includes(s.name)" class="bg-slate-50">
                      <td colspan="8" class="px-2 py-1">
                        <table class="w-full text-[11px] bg-white border rounded">
                          <thead>
                            <tr class="bg-slate-100">
                              <th class="px-2 py-1 text-left">城市</th>
                              <th class="px-2 py-1 text-left">26 招生专业</th>
                              <th class="px-2 py-1 text-center w-12">档</th>
                              <th class="px-2 py-1 text-center w-16">25 分/位</th>
                              <th class="px-2 py-1 text-center w-12">26 计划</th>
                              <th class="px-2 py-1 text-center w-12">学费</th>
                              <th class="px-2 py-1 text-center w-12">录取率</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="it in s.items" :key="it.id" class="border-t"
                                :class="it.plan.isNew==='新增' ? 'bg-yellow-50/50' : ''">
                              <td class="px-2 py-0.5">{{ it.plan.city || '—' }}</td>
                              <td class="px-2 py-0.5">
                                <span v-if="it.plan.isNew==='新增'" class="badge-new">新</span>
                                <span v-else-if="it.plan.diff" class="badge-diff" :title="it.plan.diff">变</span>
                                {{ it.plan.majorName26 || it.plan.majorName25 || '—' }}
                                <span v-if="it.admit && it.admit.heat && it.admit.heat.idx >= 4"
                                      class="ml-1 text-[10px] px-1 rounded"
                                      :class="it.admit.heat.idx >= 6 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'">🔥{{ it.admit.heat.name }}</span>
                              </td>
                              <td class="px-2 py-0.5 text-center">
                                <span v-if="analysis.ranges.chong.lo <= it.score25 && it.score25 <= analysis.ranges.chong.hi" class="text-red-600">冲</span>
                                <span v-else-if="analysis.ranges.wen.lo <= it.score25 && it.score25 <= analysis.ranges.wen.hi" class="text-amber-600">稳</span>
                                <span v-else-if="analysis.ranges.bao.lo <= it.score25 && it.score25 <= analysis.ranges.bao.hi" class="text-green-600">保</span>
                                <span v-else class="text-slate-400">外</span>
                              </td>
                              <td class="px-2 py-0.5 text-center"><b>{{ it.score25 || '—' }}</b>/{{ it.rank25 || '—' }}</td>
                              <td class="px-2 py-0.5 text-center">{{ it.enroll || '—' }}</td>
                              <td class="px-2 py-0.5 text-center">{{ it.plan.tuition || '—' }}</td>
                              <td class="px-2 py-0.5 text-center">
                                <span v-if="it.admit && it.admit.prob != null"
                                      :class="probColorClass(it.admit.prob)">
                                  {{ (it.admit.prob * 100).toFixed(0) }}%<span v-if="it.admit.isEstimated" class="text-[9px] text-amber-600 ml-0.5">(估)</span>
                                </span>
                                <span v-else class="text-slate-400">新?</span>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </section>
          </div><!-- /grid: 按分数 + 按学校 -->

          <!-- 按 报考专业 + 城市 聚合 并排 -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <!-- 按 报考专业 聚合 -->
          <section v-if="analysis.byMajor && analysis.byMajor.length">
            <div class="text-xs text-slate-500 mb-1">每个报考专业 ({{ analysis.byMajor.length }} 个) — 点行展开详情. 主名收敛 (机械设计制造及其自动化(卓越) → 机械设计制造及其自动化)</div>
            <div class="border rounded bg-white">
              <table class="w-full text-xs">
                <thead class="sticky top-0 bg-slate-100">
                  <tr>
                    <th class="px-2 py-1 text-left">报考专业</th>
                    <th class="px-2 py-1 text-center w-12">分类</th>
                    <th class="px-2 py-1 text-center w-10">N</th>
                    <th class="px-2 py-1 text-center w-12">学校</th>
                    <th class="px-2 py-1 text-center w-12">26计划</th>
                    <th class="px-2 py-1 text-center w-8 text-red-600">冲</th>
                    <th class="px-2 py-1 text-center w-8 text-amber-600">稳</th>
                    <th class="px-2 py-1 text-center w-8 text-green-600">保</th>
                    <th class="px-2 py-1 text-center w-16" title="该主名所有志愿录取率最大值">最佳录取率</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="m in analysis.byMajor" :key="m.name">
                    <tr class="border-t hover:bg-slate-50 cursor-pointer"
                        @click="$emit('toggle-major', m.name)">
                      <td class="px-2 py-0.5">
                        <span class="text-slate-400 mr-1">{{ expandedMajors.includes(m.name) ? '▾' : '▸' }}</span>
                        {{ m.name }}
                      </td>
                      <td class="px-2 py-0.5 text-center">
                        <span v-if="m.inTarget" class="text-[9px] px-1 rounded bg-green-100 text-green-700 font-bold" title="目标专业">✓</span>
                        <span v-else-if="m.inAccept" class="text-[9px] px-1 rounded bg-amber-100 text-amber-700 font-bold" title="可接受转专业">⚠</span>
                        <span v-else class="text-[9px] px-1 rounded bg-slate-100 text-slate-500" title="不在目标/可接受清单 (可能是大类)">·</span>
                      </td>
                      <td class="px-2 py-0.5 text-center font-bold">{{ m.count }}</td>
                      <td class="px-2 py-0.5 text-center">{{ m.schoolCount }}</td>
                      <td class="px-2 py-0.5 text-center">{{ m.enroll }}</td>
                      <td class="px-2 py-0.5 text-center text-red-600">{{ m.tiers.chong || '-' }}</td>
                      <td class="px-2 py-0.5 text-center text-amber-600">{{ m.tiers.wen || '-' }}</td>
                      <td class="px-2 py-0.5 text-center text-green-600">{{ m.tiers.bao || '-' }}</td>
                      <td class="px-2 py-0.5 text-center font-bold"
                          :class="probColorClass(m.maxAdmitProb)"
                          :title="m.maxAdmitItem ? ('最高: ' + m.maxAdmitItem.plan.schoolName) : ''">
                        <span v-if="m.maxAdmitProb != null">{{ (m.maxAdmitProb*100).toFixed(0) }}%</span>
                        <span v-else class="text-slate-300">—</span>
                      </td>
                    </tr>
                    <tr v-if="expandedMajors.includes(m.name)" class="bg-slate-50">
                      <td colspan="9" class="px-2 py-1">
                        <table class="w-full text-[11px] bg-white border rounded">
                          <thead>
                            <tr class="bg-slate-100">
                              <th class="px-2 py-1 text-left w-8">档</th>
                              <th class="px-2 py-1 text-left">学校</th>
                              <th class="px-2 py-1 text-left">26 招生专业 (完整名)</th>
                              <th class="px-2 py-1 text-center w-16">25 分/位</th>
                              <th class="px-2 py-1 text-center w-12">26 计划</th>
                              <th class="px-2 py-1 text-center w-12">录取率</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="it in m.items" :key="it.id" class="border-t"
                                :class="it.plan.isNew==='新增' ? 'bg-yellow-50/50' : ''">
                              <td class="px-2 py-0.5 text-center">
                                <span v-if="analysis.ranges.chong.lo <= it.score25 && it.score25 <= analysis.ranges.chong.hi" class="text-red-600 font-bold">冲</span>
                                <span v-else-if="analysis.ranges.wen.lo <= it.score25 && it.score25 <= analysis.ranges.wen.hi" class="text-amber-600 font-bold">稳</span>
                                <span v-else-if="analysis.ranges.bao.lo <= it.score25 && it.score25 <= analysis.ranges.bao.hi" class="text-green-600 font-bold">保</span>
                                <span v-else class="text-slate-400">外</span>
                              </td>
                              <td class="px-2 py-0.5">{{ it.plan.schoolName }}</td>
                              <td class="px-2 py-0.5">
                                <span v-if="it.plan.isNew==='新增'" class="badge-new">新</span>
                                <span v-else-if="it.plan.diff" class="badge-diff" :title="it.plan.diff">变</span>
                                {{ it.plan.majorName26 || it.plan.majorName25 }}
                              </td>
                              <td class="px-2 py-0.5 text-center"><b>{{ it.score25 || '—' }}</b>/{{ it.rank25 || '—' }}</td>
                              <td class="px-2 py-0.5 text-center">{{ it.enroll || '—' }}</td>
                              <td class="px-2 py-0.5 text-center font-bold"
                                  :class="probColorClass(it.admit?.prob)">
                                <span v-if="it.admit?.prob != null">{{ (it.admit.prob*100).toFixed(0) }}%</span>
                                <span v-else class="text-slate-400">—</span>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </section>

          <!-- 按 城市 聚合 -->
          <section v-if="analysis.byCity && analysis.byCity.length">
            <div class="text-xs text-slate-500 mb-1">每个城市 ({{ analysis.byCity.length }} 个) — 点行展开详情</div>
            <div class="border rounded bg-white">
              <table class="w-full text-xs">
                <thead class="sticky top-0 bg-slate-100">
                  <tr>
                    <th class="px-2 py-1 text-left">城市</th>
                    <th class="px-2 py-1 text-center w-10">N</th>
                    <th class="px-2 py-1 text-center w-12">学校</th>
                    <th class="px-2 py-1 text-center w-12">26计划</th>
                    <th class="px-2 py-1 text-center w-8 text-red-600">冲</th>
                    <th class="px-2 py-1 text-center w-8 text-amber-600">稳</th>
                    <th class="px-2 py-1 text-center w-8 text-green-600">保</th>
                    <th class="px-2 py-1 text-center w-16" title="该城市所有志愿录取率最大值">最佳录取率</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="c in analysis.byCity" :key="c.name">
                    <tr class="border-t hover:bg-slate-50 cursor-pointer"
                        @click="$emit('toggle-city', c.name)">
                      <td class="px-2 py-0.5">
                        <span class="text-slate-400 mr-1">{{ expandedCities.includes(c.name) ? '▾' : '▸' }}</span>
                        {{ c.name }}
                      </td>
                      <td class="px-2 py-0.5 text-center font-bold">{{ c.count }}</td>
                      <td class="px-2 py-0.5 text-center">{{ c.schoolCount }}</td>
                      <td class="px-2 py-0.5 text-center">{{ c.enroll }}</td>
                      <td class="px-2 py-0.5 text-center text-red-600">{{ c.tiers.chong || '-' }}</td>
                      <td class="px-2 py-0.5 text-center text-amber-600">{{ c.tiers.wen || '-' }}</td>
                      <td class="px-2 py-0.5 text-center text-green-600">{{ c.tiers.bao || '-' }}</td>
                      <td class="px-2 py-0.5 text-center font-bold"
                          :class="probColorClass(c.maxAdmitProb)"
                          :title="c.maxAdmitItem ? ('最高: ' + c.maxAdmitItem.plan.schoolName + ' · ' + (c.maxAdmitItem.plan.majorName26 || c.maxAdmitItem.plan.majorName25)) : ''">
                        <span v-if="c.maxAdmitProb != null">{{ (c.maxAdmitProb*100).toFixed(0) }}%</span>
                        <span v-else class="text-slate-300">—</span>
                      </td>
                    </tr>
                    <tr v-if="expandedCities.includes(c.name)" class="bg-slate-50">
                      <td colspan="8" class="px-2 py-1">
                        <table class="w-full text-[11px] bg-white border rounded">
                          <thead>
                            <tr class="bg-slate-100">
                              <th class="px-2 py-1 text-left w-8">档</th>
                              <th class="px-2 py-1 text-left">学校</th>
                              <th class="px-2 py-1 text-left">26 招生专业</th>
                              <th class="px-2 py-1 text-center w-16">25 分/位</th>
                              <th class="px-2 py-1 text-center w-12">26 计划</th>
                              <th class="px-2 py-1 text-center w-12">录取率</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="it in c.items" :key="it.id" class="border-t"
                                :class="it.plan.isNew==='新增' ? 'bg-yellow-50/50' : ''">
                              <td class="px-2 py-0.5 text-center">
                                <span v-if="analysis.ranges.chong.lo <= it.score25 && it.score25 <= analysis.ranges.chong.hi" class="text-red-600 font-bold">冲</span>
                                <span v-else-if="analysis.ranges.wen.lo <= it.score25 && it.score25 <= analysis.ranges.wen.hi" class="text-amber-600 font-bold">稳</span>
                                <span v-else-if="analysis.ranges.bao.lo <= it.score25 && it.score25 <= analysis.ranges.bao.hi" class="text-green-600 font-bold">保</span>
                                <span v-else class="text-slate-400">外</span>
                              </td>
                              <td class="px-2 py-0.5">{{ it.plan.schoolName }}</td>
                              <td class="px-2 py-0.5">
                                <span v-if="it.plan.isNew==='新增'" class="badge-new">新</span>
                                <span v-else-if="it.plan.diff" class="badge-diff" :title="it.plan.diff">变</span>
                                {{ it.plan.majorName26 || it.plan.majorName25 }}
                              </td>
                              <td class="px-2 py-0.5 text-center"><b>{{ it.score25 || '—' }}</b>/{{ it.rank25 || '—' }}</td>
                              <td class="px-2 py-0.5 text-center">{{ it.enroll || '—' }}</td>
                              <td class="px-2 py-0.5 text-center font-bold"
                                  :class="probColorClass(it.admit?.prob)">
                                <span v-if="it.admit?.prob != null">{{ (it.admit.prob*100).toFixed(0) }}%</span>
                                <span v-else class="text-slate-400">—</span>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </section>
          </div><!-- /grid: 报考专业 + 城市 -->

          <!-- 招生维度聚合 + 25→26 招生变化 并排 -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <!-- 招生维度聚合 (2026 全体 plans, 不限志愿单) -->
          <section v-if="analysis.enrollByScore25 && analysis.enrollByScore25.length">
            <div class="text-xs text-slate-500 mb-1">
              📊 招生维度聚合 — 2026 年所有学校在冲稳保各 25 分的总招生 (点行展开看具体学校/专业)
            </div>
            <div class="border rounded bg-white overflow-hidden">
              <table class="w-full text-xs analysis-score-table">
                <thead>
                  <tr class="bg-slate-100 border-b-2 border-slate-300">
                    <th class="px-2 py-1.5 text-left w-12">25 分</th>
                    <th class="px-2 py-1.5 text-center w-8">档</th>
                    <th class="px-2 py-1.5 text-center w-12">→26</th>
                    <th class="px-2 py-1.5 text-center w-14">2026 总招生</th>
                    <th class="px-2 py-1.5 text-center w-12">学校数</th>
                    <th class="px-2 py-1.5 text-left">说明</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="r in analysis.enrollByScore25" :key="'enr-' + r.score25">
                    <tr v-if="r.enroll > 0"
                        :class="[
                          'border-b border-slate-200 cursor-pointer transition-colors',
                          {chong:'tier-row-chong', wen:'tier-row-wen', bao:'tier-row-bao'}[r.tier] || '',
                          expandedEnrollScores.includes(r.score25) ? 'bg-blue-50' : 'hover:bg-slate-50'
                        ]"
                        @click="$emit('toggle-enroll-score', r.score25)">
                      <td class="px-2 py-1.5 font-bold">
                        <span class="text-slate-400 mr-1">{{ expandedEnrollScores.includes(r.score25) ? '▾' : '▸' }}</span>
                        {{ r.score25 }}
                      </td>
                      <td class="px-2 py-1.5 text-center">
                        <span class="inline-block px-1.5 rounded text-white text-[10px] font-bold"
                              :class="r.tier==='chong'?'bg-red-500':r.tier==='wen'?'bg-amber-500':r.tier==='bao'?'bg-green-500':'bg-slate-400'">
                          {{ {chong:'冲',wen:'稳',bao:'保',out:'外'}[r.tier] }}
                        </span>
                      </td>
                      <td class="px-2 py-1.5 text-center text-slate-600">{{ r.equiv26 ?? '—' }}</td>
                      <td class="px-2 py-1.5 text-center font-bold text-blue-700">{{ r.enroll }}</td>
                      <td class="px-2 py-1.5 text-center">{{ r.schools }}</td>
                      <td class="px-2 py-1.5 text-slate-500">{{ r.plans.length }} 个专业组</td>
                    </tr>
                    <tr v-if="r.enroll > 0 && expandedEnrollScores.includes(r.score25)" class="bg-slate-50 border-b border-slate-300">
                      <td colspan="6" class="px-2 py-1">
                        <table class="w-full text-[11px] bg-white border rounded">
                          <thead>
                            <tr class="bg-slate-100">
                              <th class="px-2 py-1 text-left">学校</th>
                              <th class="px-2 py-1 text-left">城市</th>
                              <th class="px-2 py-1 text-left">26 招生专业</th>
                              <th class="px-2 py-1 text-center w-14">25 分/位</th>
                              <th class="px-2 py-1 text-center w-12">26 计划</th>
                              <th class="px-2 py-1 text-center w-12">学费</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="p in r.plans" :key="p.id" class="border-t"
                                :class="p.isNew==='新增' ? 'bg-yellow-50/50' : ''">
                              <td class="px-2 py-0.5">{{ p.schoolName }}</td>
                              <td class="px-2 py-0.5">{{ p.city || '—' }}</td>
                              <td class="px-2 py-0.5">
                                <span v-if="p.isNew==='新增'" class="badge-new">新</span>
                                <span v-else-if="p.diff" class="badge-diff" :title="p.diff">变</span>
                                {{ p.majorName26 || p.majorName25 || '—' }}
                              </td>
                              <td class="px-2 py-0.5 text-center"><b>{{ p.isStopped ? p.score25 : p.ref25Score }}</b>/{{ p.isStopped ? p.rank25 : p.ref25Rank }}</td>
                              <td class="px-2 py-0.5 text-center">{{ p.enrollNum26 || '—' }}</td>
                              <td class="px-2 py-0.5 text-center">{{ p.tuition || '—' }}</td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </section>

          <!-- 25→26 招生变化 (独立 section) -->
          <section v-if="analysis.enrollChangeByScore25 && analysis.enrollChangeByScore25.length" class="overflow-hidden">
            <div class="text-xs text-slate-500 mb-1">
              📈 25→26 招生变化 (按 25 等位分 分段)
              <span class="ml-2">
                <button @click="ecBucket='b20'" class="px-1.5 py-0.5 rounded text-[10px]" :class="ecBucket==='b20' ? 'bg-blue-500 text-white' : 'bg-slate-100'">20 分</button>
                <button @click="ecBucket='b10'" class="px-1.5 py-0.5 rounded text-[10px]" :class="ecBucket==='b10' ? 'bg-blue-500 text-white' : 'bg-slate-100'">10 分</button>
                <button @click="ecBucket='all'" class="px-1.5 py-0.5 rounded text-[10px]" :class="ecBucket==='all' ? 'bg-blue-500 text-white' : 'bg-slate-100'">1 分</button>
              </span>
              <span class="ml-2 text-slate-400">含 你的 25 等位分 ({{analysis.anchor25}}) 的段 紫底</span>
            </div>
            <div class="border rounded bg-white" style="max-height:420px;overflow-y:auto">
              <table class="w-full text-[11px]">
                <thead class="sticky top-0 bg-slate-100 z-10">
                  <tr>
                    <th class="px-1 py-1 w-6"></th>
                    <th class="px-1 py-1 text-center">25 等位段</th>
                    <th class="px-1 py-1 text-center">25 招</th>
                    <th class="px-1 py-1 text-center">26 招</th>
                    <th class="px-1 py-1 text-center">Δ 总</th>
                    <th class="px-1 py-1 text-center" title="目标+可接受">Δ 目</th>
                    <th class="px-1 py-1 text-center" title="中外合作">Δ 中外</th>
                    <th class="px-1 py-1 text-center" title="其他">Δ 其他</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="(r, i) in currentEnrollChange" :key="ecBucket+'-'+(r.lo ?? r.score25)">
                    <tr :class="(r.containsAnchor || r.score25 === analysis.anchor25) ? 'bg-purple-50' : ((r.lo ?? r.score25) >= analysis.anchor25 ? 'bg-blue-50' : '')">
                      <td class="border-t px-1 py-0.5 text-center cursor-pointer text-slate-400"
                          @click="ecExpanded[i] ? (ecExpanded[i]=false) : (ecExpanded[i]=true)">
                        {{ ecExpanded[i] ? '▾' : '▸' }}
                      </td>
                      <td class="border-t px-1 py-0.5 text-center font-bold">
                        <span v-if="r.lo != null">{{r.lo}}-{{r.hi}}</span>
                        <span v-else>{{r.score25}}</span>
                      </td>
                      <td class="border-t px-1 py-0.5 text-center">{{r.n25 || '—'}}</td>
                      <td class="border-t px-1 py-0.5 text-center">{{r.n26 || '—'}}</td>
                      <td class="border-t px-1 py-0.5 text-center font-bold"
                          :class="r.delta > 0 ? 'text-red-600' : r.delta < 0 ? 'text-green-700' : 'text-slate-400'">
                        {{ r.delta > 0 ? '+' + r.delta : r.delta || '0' }}
                      </td>
                      <td class="border-t px-1 py-0.5 text-center">{{ r.delta_target > 0 ? '+' + r.delta_target : r.delta_target || '0' }}</td>
                      <td class="border-t px-1 py-0.5 text-center text-slate-500">{{ r.delta_zwhz > 0 ? '+' + r.delta_zwhz : r.delta_zwhz || '0' }}</td>
                      <td class="border-t px-1 py-0.5 text-center text-slate-400">{{ r.delta_other > 0 ? '+' + r.delta_other : r.delta_other || '0' }}</td>
                    </tr>
                    <tr v-if="ecExpanded[i]" class="bg-slate-50">
                      <td colspan="8" class="border-t px-2 py-1">
                        <table class="w-full text-[10px]">
                          <thead><tr class="bg-slate-100">
                            <th class="px-1 py-0.5 text-left">学校 · 专业</th>
                            <th class="px-1 py-0.5 text-center w-8">25</th>
                            <th class="px-1 py-0.5 text-center w-8">26</th>
                            <th class="px-1 py-0.5 text-center w-8">Δ</th>
                            <th class="px-1 py-0.5 text-center w-10">标</th>
                          </tr></thead>
                          <tbody>
                            <template v-for="pl in (r.rows ? r.rows.flatMap(rr => rr.plans) : r.plans)" :key="'pl-'+pl.schoolName+'-'+pl.majorName">
                              <tr class="border-t">
                                <td class="px-1 py-0.5"><b>{{pl.schoolName}}</b> <span class="text-slate-500">· {{pl.majorName}}</span></td>
                                <td class="px-1 py-0.5 text-center">{{pl.n25 || '—'}}</td>
                                <td class="px-1 py-0.5 text-center">{{pl.n26 || '—'}}</td>
                                <td class="px-1 py-0.5 text-center font-bold"
                                    :class="pl.delta > 0 ? 'text-red-600' : pl.delta < 0 ? 'text-green-700' : 'text-slate-400'">
                                  {{pl.delta > 0 ? '+' + pl.delta : pl.delta || '0'}}
                                </td>
                                <td class="px-1 py-0.5 text-center text-[9px]">
                                  <span v-if="pl.isNew" class="text-red-600 mr-0.5">新</span>
                                  <span v-if="pl.isStopped" class="text-slate-500 mr-0.5">停</span>
                                  <span v-if="pl.isZ" class="text-blue-600 mr-0.5">外</span>
                                  <span v-if="pl.isTarget" class="text-green-700">目</span>
                                </td>
                              </tr>
                            </template>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
            <div class="text-[10px] text-slate-400 mt-1">
              合计: 25 招 {{ totalEnroll25 }} → 26 招 {{ totalEnroll26 }}
              (Δ {{ totalEnroll26 - totalEnroll25 > 0 ? '+' : '' }}{{ totalEnroll26 - totalEnroll25 }})
              · 标: 新=新增 / 停=停招 / 外=中外合作 / 目=目标专业
            </div>
          </section>
          </div><!-- /grid: 招生维度 + 招生变化 -->

          <!-- 🏫 按学校 25→26 招生变化 (985/211/双一流/省重点) -->
          <section v-if="analysis.enrollChangeBySchool && analysis.enrollChangeBySchool.length" class="overflow-hidden">
            <div class="text-xs text-slate-500 mb-1 flex items-center flex-wrap gap-2">
              <span>🏫 25→26 按学校 招生变化 <span class="text-slate-400">(985 / 211 / 双一流 / 省重点; 共 {{analysis.enrollChangeBySchool.length}} 所)</span></span>
              <span class="ml-2">排序:
                <button @click="ecSchoolSort='abs'" class="px-1.5 py-0.5 rounded text-[10px]" :class="ecSchoolSort==='abs' ? 'bg-blue-500 text-white' : 'bg-slate-100'">|Δ| 降</button>
                <button @click="ecSchoolSort='inc'" class="px-1.5 py-0.5 rounded text-[10px]" :class="ecSchoolSort==='inc' ? 'bg-blue-500 text-white' : 'bg-slate-100'">扩招</button>
                <button @click="ecSchoolSort='dec'" class="px-1.5 py-0.5 rounded text-[10px]" :class="ecSchoolSort==='dec' ? 'bg-blue-500 text-white' : 'bg-slate-100'">缩招</button>
                <button @click="ecSchoolSort='rank'" class="px-1.5 py-0.5 rounded text-[10px]" :class="ecSchoolSort==='rank' ? 'bg-blue-500 text-white' : 'bg-slate-100'">软科</button>
              </span>
              <span class="ml-2">档:
                <button @click="ecSchoolTier='all'" class="px-1.5 py-0.5 rounded text-[10px]" :class="ecSchoolTier==='all' ? 'bg-blue-500 text-white' : 'bg-slate-100'">全部</button>
                <button @click="ecSchoolTier='985'" class="px-1.5 py-0.5 rounded text-[10px]" :class="ecSchoolTier==='985' ? 'bg-blue-500 text-white' : 'bg-slate-100'">985</button>
                <button @click="ecSchoolTier='211'" class="px-1.5 py-0.5 rounded text-[10px]" :class="ecSchoolTier==='211' ? 'bg-blue-500 text-white' : 'bg-slate-100'">211</button>
                <button @click="ecSchoolTier='双一流'" class="px-1.5 py-0.5 rounded text-[10px]" :class="ecSchoolTier==='双一流' ? 'bg-blue-500 text-white' : 'bg-slate-100'">双一流</button>
                <button @click="ecSchoolTier='省重点'" class="px-1.5 py-0.5 rounded text-[10px]" :class="ecSchoolTier==='省重点' ? 'bg-blue-500 text-white' : 'bg-slate-100'">省重点</button>
              </span>
              <input v-model="ecSchoolKw" placeholder="🔍 学校名/城市" class="border rounded px-2 py-0.5 text-[11px] w-32">
              <span class="ml-auto text-[10px] text-slate-400">显示 {{ filteredSchoolEc.length }} 所 / 合计 25 招 {{schoolEcSum.n25}} → 26 招 {{schoolEcSum.n26}} (Δ {{schoolEcSum.delta > 0 ? '+' : ''}}{{schoolEcSum.delta}})</span>
            </div>
            <div class="border rounded bg-white" style="max-height:480px;overflow-y:auto">
              <table class="w-full text-[11px]">
                <thead class="sticky top-0 bg-slate-100 z-10">
                  <tr>
                    <th class="px-1 py-1 w-6"></th>
                    <th class="px-1 py-1 text-center w-8">#</th>
                    <th class="px-1 py-1 text-left">学校</th>
                    <th class="px-1 py-1 text-center">城市</th>
                    <th class="px-1 py-1 text-center" title="985/211/双一流/省重点">档</th>
                    <th class="px-1 py-1 text-center" title="软科排名">软科</th>
                    <th class="px-1 py-1 text-center">25 招</th>
                    <th class="px-1 py-1 text-center">26 招</th>
                    <th class="px-1 py-1 text-center">Δ</th>
                    <th class="px-1 py-1 text-center">Δ%</th>
                    <th class="px-1 py-1 text-center" title="25/26 招生专业条目数">25/26 条</th>
                    <th class="px-1 py-1 text-center" title="新增 / 停招 / 中外合作">新/停/外</th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="(r, i) in filteredSchoolEc" :key="'sch-ec-'+r.schoolName">
                    <tr :class="r.delta > 0 ? 'hover:bg-red-50' : r.delta < 0 ? 'hover:bg-green-50' : 'hover:bg-slate-50'">
                      <td class="border-t px-1 py-0.5 text-center cursor-pointer text-slate-400"
                          @click="schEcExpanded[r.schoolName] ? (schEcExpanded[r.schoolName]=false) : (schEcExpanded[r.schoolName]=true)">
                        {{ schEcExpanded[r.schoolName] ? '▾' : '▸' }}
                      </td>
                      <td class="border-t px-1 py-0.5 text-center text-slate-500">{{ i+1 }}</td>
                      <td class="border-t px-1 py-0.5"><b>{{r.schoolName}}</b></td>
                      <td class="border-t px-1 py-0.5 text-center text-slate-500">{{r.city || '—'}}</td>
                      <td class="border-t px-1 py-0.5 text-center text-[10px]">
                        <span v-if="(r.schoolTag||'').includes('985')" class="text-red-600 font-bold">985</span>
                        <span v-else-if="(r.schoolTag||'').includes('211')" class="text-orange-600 font-bold">211</span>
                        <span v-else-if="(r.schoolTag||'').includes('双一流')" class="text-purple-600 font-bold">双一流</span>
                        <span v-else-if="(r.schoolTag||'').includes('省重点')" class="text-blue-600">省重点</span>
                      </td>
                      <td class="border-t px-1 py-0.5 text-center text-slate-500">{{ r.schoolRank < 9999 ? r.schoolRank : '—' }}</td>
                      <td class="border-t px-1 py-0.5 text-center">{{r.n25 || '—'}}</td>
                      <td class="border-t px-1 py-0.5 text-center">{{r.n26 || '—'}}</td>
                      <td class="border-t px-1 py-0.5 text-center font-bold"
                          :class="r.delta > 0 ? 'text-red-600' : r.delta < 0 ? 'text-green-700' : 'text-slate-400'">
                        {{ r.delta > 0 ? '+' + r.delta : r.delta || '0' }}
                      </td>
                      <td class="border-t px-1 py-0.5 text-center text-[10px]"
                          :class="r.delta > 0 ? 'text-red-500' : r.delta < 0 ? 'text-green-600' : 'text-slate-400'">
                        {{ r.n25 > 0 ? (r.deltaPct >= 0 ? '+' : '') + (r.deltaPct * 100).toFixed(0) + '%' : (r.n26 > 0 ? '新' : '—') }}
                      </td>
                      <td class="border-t px-1 py-0.5 text-center text-slate-500">{{r.cnt25}}/{{r.cnt26}}</td>
                      <td class="border-t px-1 py-0.5 text-center text-[10px]">
                        <span v-if="r.cntNew" class="text-red-600 mr-1">{{r.cntNew}}新</span>
                        <span v-if="r.cntStopped" class="text-slate-500 mr-1">{{r.cntStopped}}停</span>
                        <span v-if="r.cntZwhz" class="text-blue-600">{{r.cntZwhz}}外</span>
                        <span v-if="!r.cntNew && !r.cntStopped && !r.cntZwhz" class="text-slate-300">—</span>
                      </td>
                    </tr>
                    <tr v-if="schEcExpanded[r.schoolName]" class="bg-slate-50">
                      <td colspan="12" class="border-t px-2 py-1">
                        <table class="w-full text-[10px]">
                          <thead><tr class="bg-slate-100">
                            <th class="px-1 py-0.5 text-left">专业</th>
                            <th class="px-1 py-0.5 text-center w-12">代号</th>
                            <th class="px-1 py-0.5 text-center w-10">25</th>
                            <th class="px-1 py-0.5 text-center w-10">26</th>
                            <th class="px-1 py-0.5 text-center w-12">Δ</th>
                            <th class="px-1 py-0.5 text-center w-12">标</th>
                          </tr></thead>
                          <tbody>
                            <tr v-for="pl in [...r.plans].sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta))" :key="'spl-'+pl.majorCode+'-'+pl.majorName" class="border-t">
                              <td class="px-1 py-0.5">{{pl.majorName}}</td>
                              <td class="px-1 py-0.5 text-center text-slate-500">{{pl.majorCode || '—'}}</td>
                              <td class="px-1 py-0.5 text-center">{{pl.n25 || '—'}}</td>
                              <td class="px-1 py-0.5 text-center">{{pl.n26 || '—'}}</td>
                              <td class="px-1 py-0.5 text-center font-bold"
                                  :class="pl.delta > 0 ? 'text-red-600' : pl.delta < 0 ? 'text-green-700' : 'text-slate-400'">
                                {{pl.delta > 0 ? '+' + pl.delta : pl.delta || '0'}}
                              </td>
                              <td class="px-1 py-0.5 text-center text-[9px]">
                                <span v-if="pl.isNew" class="text-red-600 mr-0.5">新</span>
                                <span v-if="pl.isStopped" class="text-slate-500 mr-0.5">停</span>
                                <span v-if="pl.isZ" class="text-blue-600">外</span>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
            <div class="text-[10px] text-slate-400 mt-1">
              📌 仅含 985 / 211 / 双一流 / 省重点 学校.
              扩招 = Δ 为正 (招生数增加); 缩招 = Δ 为负.
              "标" 列: 新=新增专业 / 停=停招专业 / 外=中外合作办学.
              点 ▸ 展开该校所有专业明细 (按 |Δ| 降序).
            </div>
          </section>

          <!-- Insights -->
          <section v-if="analysis.insights.length">
            <div class="text-xs text-slate-500 mb-1">💡 建议 ({{ analysis.insights.length }})</div>
            <ul class="space-y-1">
              <li v-for="(t, i) in analysis.insights" :key="i"
                  class="text-sm px-2 py-1 rounded border"
                  :class="t.level==='danger' ? 'bg-red-50 border-red-200 text-red-800' :
                          t.level==='warn'   ? 'bg-amber-50 border-amber-200 text-amber-800' :
                                               'bg-blue-50 border-blue-200 text-blue-800'">
                {{ t.text }}
              </li>
            </ul>
          </section>
          <section v-else>
            <div class="text-sm text-green-700 bg-green-50 border border-green-200 px-3 py-2 rounded">
              ✓ 没有发现明显异常 (冲稳保配比、分布、扎堆等)
            </div>
          </section>
        </div>
      </div>
    </div>
  `,
};

// V9: 志愿 + 分析 PDF 报告 (window.print + @media print css)
const VoluntaryReport = {
  props: ["analysis", "listName", "voluntary", "planById", "admitProbFn", "scoreRank", "supplyMap", "targets", "accepts"],
  emits: ["close"],
  setup(props) {
    const todayStr = computed(() => new Date().toISOString().slice(0, 10));
    const items = computed(() => {
      // 按志愿顺序 (voluntary array), 不动顺序
      if (!props.voluntary || !props.planById) return [];
      return props.voluntary.map((id, i) => {
        const p = props.planById[id];
        if (!p) return null;
        const s25 = p.isStopped ? p.score25 : p.ref25Score;
        const r25 = p.isStopped ? p.rank25 : p.ref25Rank;
        return {
          idx: i + 1, id, plan: p, score25: s25, rank25: r25,
          enroll: p.enrollNum26 || p.enrollNum25 || 0,
          admit: props.admitProbFn ? props.admitProbFn(p) : null,
        };
      }).filter(Boolean);
    });
    const summary = computed(() => {
      const a = props.analysis;
      if (!a || !items.value.length) return null;
      const tt = items.value;
      const its = tt.map(it => ({ ...it }));
      // 按档分组
      const byTier = { chong: [], wen: [], bao: [], out: [] };
      const tierOf = (s) => {
        if (s == null) return "out";
        if (s >= a.ranges.chong.lo && s <= a.ranges.chong.hi) return "chong";
        if (s >= a.ranges.wen.lo   && s <= a.ranges.wen.hi)   return "wen";
        if (s >= a.ranges.bao.lo   && s <= a.ranges.bao.hi)   return "bao";
        return "out";
      };
      for (const it of its) byTier[tierOf(it.score25)].push(it);
      // 各档 top 3 by admit prob (排除 isNew)
      const topByTier = {};
      for (const k of ["chong", "wen", "bao"]) {
        const list = byTier[k].filter(it => it.admit && it.admit.prob != null)
                              .sort((x, y) => (y.admit.prob - x.admit.prob));
        topByTier[k] = list.slice(0, 3);
      }
      // 学校多样性
      const schoolMap = new Map();
      for (const it of its) {
        const n = it.plan.schoolName;
        schoolMap.set(n, (schoolMap.get(n) || 0) + 1);
      }
      const schoolTopN = [...schoolMap.entries()].sort((x, y) => y[1] - x[1]);
      // 热度
      const heatCount = { 电子信息: 0, 计算机: 0, 自动化: 0, 机械: 0, "统计/大数据": 0, 车辆: 0, 能动: 0, 其他: 0 };
      let newCount = 0;
      for (const it of its) {
        if (it.plan.isNew === "新增") { newCount++; continue; }
        const h = it.admit?.heat?.name || "其他";
        heatCount[h] = (heatCount[h] || 0) + 1;
      }
      // 分数范围
      const scores = its.map(it => it.score25).filter(Boolean).sort((x, y) => y - x);
      // 推荐比例对比
      const N = its.length || 1;
      const cR = byTier.chong.length / N;
      const wR = byTier.wen.length / N;
      const bR = byTier.bao.length / N;
      // 风险评估
      const risks = [];
      if (!byTier.bao.length) risks.push("⚠ 保档为空 — 极高风险, 必须补充保底志愿");
      if (cR > 0.4) risks.push(`⚠ 冲档占比 ${(cR*100).toFixed(0)}% 偏高 (推荐 25%)`);
      if (bR < 0.2) risks.push(`⚠ 保档占比 ${(bR*100).toFixed(0)}% 偏低 (推荐 30%)`);
      if (newCount > 0) risks.push(`⚠ ${newCount} 个新增专业, 录取概率不可靠, 谨慎填报`);
      const heavySchool = schoolTopN.filter(([, c]) => c >= 5);
      if (heavySchool.length) risks.push(`⚠ 单校扎堆: ${heavySchool.map(([n, c]) => `${n}(${c})`).join("、")}`);
      // 各档录取率统计 (除新增外的均值)
      const avgProb = {};
      for (const k of ["chong", "wen", "bao"]) {
        const ps = byTier[k].map(it => it.admit?.prob).filter(p => p != null);
        avgProb[k] = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
      }
      // 多档阈值的 Top 5 录取候选 (按 平行志愿 顺序, 首 5 个 prob >= T)
      const THRESHOLDS = [0.45, 0.50, 0.60, 0.70];
      const topByThreshold = [];
      for (const T of THRESHOLDS) {
        const hits = its.filter(it => it.admit?.prob != null && it.admit.prob >= T).slice(0, 5);
        topByThreshold.push({
          threshold: T,
          items: hits.map((it, i) => ({
            ...it,
            idx: its.indexOf(it) + 1,  // 该项在志愿单中的原始序号
          })),
        });
      }
      return {
        byTier, topByTier, schoolTopN, heatCount, newCount,
        scoreMax: scores[0], scoreMin: scores[scores.length-1],
        ratios: { chong: cR, wen: wR, bao: bR },
        avgProb,
        topByThreshold,
        risks, N: items.value.length,
      };
    });
    // 按分数分组志愿 (含 gap 不显示在报告中, 只列有志愿的分数)
    const itemsByScore = computed(() => {
      const m = new Map();
      for (const it of items.value) {
        if (it.score25 == null) continue;
        if (!m.has(it.score25)) m.set(it.score25, []);
        m.get(it.score25).push(it);
      }
      return [...m.entries()].sort((a, b) => b[0] - a[0])
        .map(([s, list]) => ({ score25: s, items: list }));
    });
    // 按学校分组
    const itemsBySchool = computed(() => {
      const m = new Map();
      for (const it of items.value) {
        const n = it.plan.schoolName;
        if (!m.has(n)) m.set(n, []);
        m.get(n).push(it);
      }
      return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .map(([n, list]) => ({ school: n, items: list }));
    });
    const itemsByMajor = computed(() => {
      const m = new Map();
      for (const it of items.value) {
        const full = it.plan.majorName26 || it.plan.majorName25 || "(未知)";
        const n = mainNameOf(full) || full;
        if (!m.has(n)) m.set(n, []);
        m.get(n).push(it);
      }
      return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .map(([n, list]) => ({ major: n, items: list }));
    });
    const itemsByCity = computed(() => {
      const m = new Map();
      for (const it of items.value) {
        const c = it.plan.city || "(未知)";
        if (!m.has(c)) m.set(c, []);
        m.get(c).push(it);
      }
      return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .map(([c, list]) => ({ city: c, items: list }));
    });
    function printReport() {
      window.print();
    }
    function tierLabel(s) {
      const a = props.analysis;
      if (!a || s == null) return "—";
      if (s >= a.ranges.chong.lo && s <= a.ranges.chong.hi) return "冲";
      if (s >= a.ranges.wen.lo   && s <= a.ranges.wen.hi)   return "稳";
      if (s >= a.ranges.bao.lo   && s <= a.ranges.bao.hi)   return "保";
      return "外";
    }
    function fmtProb(admit) {
      if (!admit || admit.prob == null) return "—";
      return (admit.prob * 100).toFixed(0) + "%";
    }
    // 招生维度查询 (从 analysis.enrollByScore25 索引)
    const enrollScoreMap = computed(() => {
      const m = new Map();
      if (props.analysis?.enrollByScore25) {
        for (const r of props.analysis.enrollByScore25) m.set(r.score25, r);
      }
      return m;
    });
    function enrollAtScore(s) { return enrollScoreMap.value.get(s) || null; }
    function schoolsAtScore(s) {
      const r = enrollScoreMap.value.get(s);
      if (!r) return "";
      const names = [...new Set(r.plans.map(p => p.schoolName))];
      return names.slice(0, 8).join("、") + (names.length > 8 ? ` 等 ${names.length} 所` : "");
    }
    function itemsAtScore(s) {
      return items.value.filter(it => it.score25 === s);
    }
    function supplyRatioAt(s) {
      const r = props.supplyMap?.get(s);
      return r ? r.ratio : null;
    }
    // 校录取率 = 该校所有志愿中 录取率最大值
    function schoolMaxProb(g) {
      let m = null;
      for (const it of (g.items || [])) {
        const p = it.admit?.prob;
        if (p == null) continue;
        if (m == null || p > m) m = p;
      }
      return m;
    }
    function majorMaxProb(g) {
      let m = null;
      for (const it of (g.items || [])) {
        const p = it.admit?.prob;
        if (p == null) continue;
        if (m == null || p > m) m = p;
      }
      return m;
    }
    function majorSchoolCount(g) {
      const s = new Set();
      for (const it of (g.items || [])) s.add(it.plan.schoolName);
      return s.size;
    }
    function cityMaxProb(g) {
      let m = null;
      for (const it of (g.items || [])) {
        const p = it.admit?.prob;
        if (p == null) continue;
        if (m == null || p > m) m = p;
      }
      return m;
    }
    function citySchoolCount(g) {
      const s = new Set();
      for (const it of (g.items || [])) s.add(it.plan.schoolName);
      return s.size;
    }
    return { todayStr, items, summary, itemsByScore, itemsBySchool, itemsByMajor, itemsByCity,
             enrollAtScore, schoolsAtScore, itemsAtScore, supplyRatioAt, schoolMaxProb,
             majorMaxProb, majorSchoolCount, cityMaxProb, citySchoolCount,
             printReport, tierLabel, fmtProb };
  },
  template: `
    <div class="voluntary-report">
      <div class="report-toolbar no-print bg-white border-b p-3 sticky top-0 z-10 flex items-center gap-3">
        <button @click="$emit('close')" class="text-sm px-2 py-1 border rounded hover:bg-slate-100">← 返回</button>
        <h3 class="font-bold text-base flex-1">📄 志愿报告 — {{ listName }}</h3>
        <button @click="printReport" class="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 font-bold">🖨 打印 / 保存 PDF</button>
      </div>
      <div v-if="!analysis || !items.length" class="p-8 text-center text-slate-400">
        志愿单为空, 或缺少分数. 请先填好志愿 + 设置 26 分数.
      </div>
      <div v-else class="report-content p-6 mx-auto max-w-5xl bg-white">
        <!-- 头部 -->
        <header class="text-center mb-6 pb-3 border-b-2 border-slate-300">
          <h1 class="text-2xl font-bold">2026 年高考志愿报告</h1>
          <div class="text-sm text-slate-600 mt-1">{{ listName }} · {{ todayStr }}</div>
          <div class="mt-2 inline-flex gap-6 text-sm">
            <span>26 分: <b class="text-blue-600">{{ analysis.my26 }}</b></span>
            <span>25 等位: <b class="text-blue-600">{{ analysis.anchor25 }}</b></span>
            <span>26 真实位次: <b class="text-blue-600">{{ analysis.myRank26 }}</b></span>
            <span v-if="analysis.userRank26 !== analysis.myRank26">26 预测位次: <b class="text-purple-700">{{ analysis.userRank26 }}</b> (手调)</span>
            <span>总志愿: <b class="text-blue-600">{{ items.length }}</b> 项</span>
            <span>26 计划总: <b class="text-blue-600">{{ analysis.totalEnroll }}</b> 人</span>
          </div>
        </header>

        <!-- 1. 总结与建议 -->
        <section v-if="summary" class="mb-6">
          <h2 class="text-lg font-bold mb-2 bg-blue-50 px-2 py-1 border-l-4 border-blue-600">1. 总结与建议</h2>
          <div class="text-sm space-y-2">
            <div>
              <b>填报分数范围:</b> 25 等位分 [{{ summary.scoreMin }} - {{ summary.scoreMax }}]
              ({{ summary.scoreMax - summary.scoreMin }} 分跨度) | 25 等位分 {{ analysis.anchor25 }} 分
            </div>
            <div>
              <b>冲稳保结构:</b>
              冲 {{ analysis.tiers.chong.items.length }} ({{ (summary.ratios.chong*100).toFixed(0) }}%) ·
              稳 {{ analysis.tiers.wen.items.length }} ({{ (summary.ratios.wen*100).toFixed(0) }}%) ·
              保 {{ analysis.tiers.bao.items.length }} ({{ (summary.ratios.bao*100).toFixed(0) }}%)
              <span class="text-slate-500 ml-2">(推荐: 25%/45%/30%)</span>
            </div>
            <div v-if="summary.avgProb.chong != null || summary.avgProb.wen != null || summary.avgProb.bao != null">
              <b>平均录取率:</b>
              <span v-if="summary.avgProb.chong != null" class="text-red-700">冲 {{ (summary.avgProb.chong*100).toFixed(0) }}%</span>
              <span v-if="summary.avgProb.wen != null" class="ml-3 text-amber-700">稳 {{ (summary.avgProb.wen*100).toFixed(0) }}%</span>
              <span v-if="summary.avgProb.bao != null" class="ml-3 text-green-700">保 {{ (summary.avgProb.bao*100).toFixed(0) }}%</span>
            </div>
            <div>
              <b>学校多样性:</b> 涉及 {{ summary.schoolTopN.length }} 所学校
              <span v-if="summary.schoolTopN[0]" class="text-slate-600">
                ; Top 3: {{ summary.schoolTopN.slice(0, 3).map(([n, c]) => n + '(' + c + ')').join('、') }}
              </span>
            </div>
            <div>
              <b>专业热度:</b>
              <span v-for="(c, name) in summary.heatCount" :key="name" v-show="c">
                {{ name }} {{ c }};
              </span>
              <span v-if="summary.newCount" class="text-amber-700">新增 {{ summary.newCount }}</span>
            </div>
            <div v-if="summary.risks.length" class="mt-2 p-2 bg-red-50 border border-red-200 rounded">
              <b class="text-red-700">风险提示:</b>
              <ul class="ml-4 mt-1">
                <li v-for="r in summary.risks" :key="r">{{ r }}</li>
              </ul>
            </div>
          </div>
          <div class="mt-4">
            <admit-top-summary :analysis="analysis"></admit-top-summary>
          </div>
        </section>

        <!-- 2. 录取趋势图 -->
        <section class="mb-6 page-break-inside-avoid">
          <h2 class="text-lg font-bold mb-2 bg-blue-50 px-2 py-1 border-l-4 border-blue-600">2. 录取趋势图 (按志愿顺序 + 阈值首达点)</h2>
          <admit-trend-chart :items="analysis.items" :height="260" :compact="true"></admit-trend-chart>
        </section>

        <!-- 3. 完整志愿表 -->
        <section class="mb-6 page-break-before">
          <h2 class="text-lg font-bold mb-2 bg-blue-50 px-2 py-1 border-l-4 border-blue-600">3. 完整志愿表 (按填报顺序)</h2>
          <table class="w-full text-[10px] border-collapse">
            <thead>
              <tr class="bg-slate-100">
                <th class="border px-1 py-1">#</th>
                <th class="border px-1 py-1">档</th>
                <th class="border px-1 py-1 text-left">学校</th>
                <th class="border px-1 py-1">城市</th>
                <th class="border px-1 py-1 text-left">26 招生专业</th>
                <th class="border px-1 py-1">25 分/位</th>
                <th class="border px-1 py-1">26 计划</th>
                <th class="border px-1 py-1">学费</th>
                <th class="border px-1 py-1">录取率</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="it in items" :key="it.id" :class="it.plan.isNew==='新增'?'bg-yellow-50':''">
                <td class="border px-1 py-0.5 text-center">{{ it.idx }}</td>
                <td class="border px-1 py-0.5 text-center">{{ tierLabel(it.score25) }}</td>
                <td class="border px-1 py-0.5">{{ it.plan.schoolName }}</td>
                <td class="border px-1 py-0.5 text-center">{{ it.plan.city }}</td>
                <td class="border px-1 py-0.5">
                  <span v-if="it.plan.isNew==='新增'" class="text-red-600 font-bold">[新]</span>
                  <span v-else-if="it.plan.diff" class="text-amber-700">[变]</span>
                  {{ it.plan.majorName26 || it.plan.majorName25 }}
                  <span v-if="it.admit?.heat?.idx >= 4" class="ml-0.5 text-[8px] px-0.5 rounded"
                        :class="it.admit.heat.idx >= 6 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'">🔥{{ it.admit.heat.name }}</span>
                </td>
                <td class="border px-1 py-0.5 text-center">{{ it.score25 }}/{{ it.rank25 }}</td>
                <td class="border px-1 py-0.5 text-center">{{ it.enroll }}</td>
                <td class="border px-1 py-0.5 text-center">{{ it.plan.tuition }}</td>
                <td class="border px-1 py-0.5 text-center font-bold"
                    :class="probColorClass(it.admit?.prob)">
                  {{ fmtProb(it.admit) }}<span v-if="it.admit?.isEstimated" class="text-[9px] text-amber-600">(估)</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- 4. 志愿详情 (每条 + 完整信息) -->
        <section class="mb-6 page-break-before">
          <h2 class="text-lg font-bold mb-2 bg-blue-50 px-2 py-1 border-l-4 border-blue-600">4. 志愿详情</h2>
          <div v-for="it in items" :key="it.id" class="mb-3 p-2 border rounded text-xs page-break-inside-avoid"
               :class="it.plan.isNew==='新增'?'bg-yellow-50 border-yellow-300':''">
            <div class="font-bold flex items-center justify-between">
              <span>#{{ it.idx }} [{{ tierLabel(it.score25) }}]
                <span v-if="it.plan.isNew==='新增'" class="text-red-600 text-xs px-1 bg-red-50 rounded">新</span>
                <span v-else-if="it.plan.diff" class="text-amber-700 text-xs px-1 bg-amber-50 rounded">变</span>
                {{ it.plan.schoolName }} · {{ it.plan.majorName26 || it.plan.majorName25 }}
                <span v-if="it.admit?.heat?.idx >= 4" class="ml-1 text-[10px] px-1 rounded"
                      :class="it.admit.heat.idx >= 6 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'">🔥{{ it.admit.heat.name }}</span>
              </span>
              <span class="text-sm"
                    :class="probColorClass(it.admit?.prob)">
                录取率 {{ fmtProb(it.admit) }}<span v-if="it.admit?.isEstimated" class="text-[10px] text-amber-600 ml-0.5">(估)</span>
              </span>
            </div>
            <div class="grid grid-cols-4 gap-1 mt-1 text-[11px]">
              <div><b>城市:</b> {{ it.plan.city || '—' }}</div>
              <div><b>类型:</b> {{ it.plan.schoolType || '—' }} {{ it.plan.schoolTag || '' }}</div>
              <div><b>学制:</b> {{ it.plan.duration || '—' }}</div>
              <div><b>学费:</b> {{ it.plan.tuition || '—' }} 元/年</div>
              <div><b>26 计划:</b> {{ it.enroll }} 人</div>
              <div><b>25 分/位:</b> {{ it.score25 }} / {{ it.rank25 }}</div>
              <div><b>平均位次:</b> {{ it.plan.avgRank || '—' }}</div>
              <div><b>选科:</b> {{ it.plan.subjectReq || '—' }}</div>
              <div v-if="it.plan.containedMajors?.length" class="col-span-4"><b>所含专业:</b> {{ it.plan.containedMajors.join('、') }}</div>
              <div v-if="it.plan.rankEval" class="col-span-2"><b>学科评估:</b> {{ it.plan.rankEval }}</div>
              <div v-if="it.plan.rankSoftware" class="col-span-2"><b>软科评级:</b> {{ it.plan.rankSoftware }}</div>
              <div v-if="it.plan.baoyanDetail" class="col-span-4"><b>专业保研:</b> {{ it.plan.baoyanDetail }}</div>
              <div v-if="it.plan.remarks" class="col-span-4"><b>备注:</b> {{ it.plan.remarks }}</div>
              <div v-if="it.plan.diff" class="col-span-4 text-amber-700"><b>25 → 26 变化:</b> {{ it.plan.diff }}</div>
            </div>
          </div>
        </section>

        <!-- 5. 分析总览 + 冲稳保占比 -->
        <section class="mb-6 page-break-before">
          <h2 class="text-lg font-bold mb-2 bg-blue-50 px-2 py-1 border-l-4 border-blue-600">5. 分析总览</h2>
          <div class="grid grid-cols-4 gap-2 text-xs">
            <div v-for="k in ['chong','wen','bao','out']" :key="k"
                 :class="k==='chong'?'bg-red-50 border-red-200':k==='wen'?'bg-amber-50 border-amber-200':k==='bao'?'bg-green-50 border-green-200':'bg-slate-100'"
                 class="border rounded p-2">
              <div class="font-bold">{{ {chong:'冲',wen:'稳',bao:'保',out:'范围外'}[k] }}
                <span v-if="k!=='out'" class="font-normal text-[10px]">[{{ analysis.ranges[k].lo }}-{{ analysis.ranges[k].hi }}]</span>
              </div>
              <div>{{ analysis.tiers[k].items.length }} 项
                <span v-if="analysis.tiers[k].newItems.length" class="text-[10px]">(新 {{ analysis.tiers[k].newItems.length }})</span>
              </div>
              <div>26招 {{ analysis.tiers[k].enroll }} / 同分 {{ analysis.tiers[k].cnt26 || '?' }}</div>
            </div>
          </div>
        </section>

        <!-- 6. 冲稳保详情 -->
        <template v-for="k in ['chong','wen','bao']" :key="'tier-'+k">
        <section v-if="analysis.tiers[k].items.length"
                 class="mb-6 page-break-before">
          <h2 class="text-lg font-bold mb-2 px-2 py-1 border-l-4"
              :class="k==='chong'?'bg-red-50 border-red-600 text-red-800':k==='wen'?'bg-amber-50 border-amber-600 text-amber-800':'bg-green-50 border-green-600 text-green-800'">
            6.{{ ['chong','wen','bao'].indexOf(k)+1 }} {{ {chong:'冲',wen:'稳',bao:'保'}[k] }}档详细 ({{ analysis.tiers[k].items.length }} 项)
          </h2>
          <table class="w-full text-[10px] border-collapse">
            <thead><tr class="bg-slate-100">
              <th class="border px-1 py-1">标识</th>
              <th class="border px-1 py-1 text-left">学校</th>
              <th class="border px-1 py-1 text-left">26 招生专业</th>
              <th class="border px-1 py-1">25 分/位</th>
              <th class="border px-1 py-1">26 计划</th>
              <th class="border px-1 py-1">录取率</th>
            </tr></thead>
            <tbody>
              <tr v-for="it in analysis.tiers[k].items" :key="it.id"
                  :class="it.plan.isNew==='新增'?'bg-yellow-50':''">
                <td class="border px-1 py-0.5 text-center">
                  <span v-if="it.plan.isNew==='新增'" class="text-red-600">新</span>
                  <span v-else-if="it.plan.diff" class="text-amber-700">变</span>
                </td>
                <td class="border px-1 py-0.5">{{ it.plan.schoolName }}</td>
                <td class="border px-1 py-0.5">
                  {{ it.plan.majorName26 || it.plan.majorName25 }}
                  <span v-if="admitProbFn(it.plan)?.heat?.idx >= 4" class="ml-0.5 text-[8px] px-0.5 rounded"
                        :class="admitProbFn(it.plan).heat.idx >= 6 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'">🔥{{ admitProbFn(it.plan).heat.name }}</span>
                </td>
                <td class="border px-1 py-0.5 text-center">{{ it.score25 || '—' }}/{{ it.rank25 || '—' }}</td>
                <td class="border px-1 py-0.5 text-center">{{ it.enroll }}</td>
                <td class="border px-1 py-0.5 text-center font-bold"
                    :class="probColorClass(admitProbFn(it.plan)?.prob)">
                  {{ fmtProb(admitProbFn(it.plan)) }}<span v-if="admitProbFn(it.plan)?.isEstimated" class="text-[9px] text-amber-600">(估)</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
        </template><!-- /v-for tier -->

        <!-- 7. 分数总览 (沿用分析页 byScore 样式, 加 26 总招生 + 你填报的学校) -->
        <section class="mb-6 page-break-before">
          <h2 class="text-lg font-bold mb-2 bg-blue-50 px-2 py-1 border-l-4 border-blue-600">7. 分数总览 (按 25 分聚合)</h2>
          <table class="w-full text-[10px] border-collapse analysis-score-table">
            <thead><tr class="bg-slate-100">
              <th class="border px-1 py-1">25 分</th>
              <th class="border px-1 py-1">档</th>
              <th class="border px-1 py-1">25位次</th>
              <th class="border px-1 py-1">Δ分</th>
              <th class="border px-1 py-1">Δ位次</th>
              <th class="border px-1 py-1">你的 N</th>
              <th class="border px-1 py-1">你的招生</th>
              <th class="border px-1 py-1">26 全体招生</th>
              <th class="border px-1 py-1">26 同分</th>
              <th class="border px-1 py-1">供给率</th>
              <th class="border px-1 py-1">学校</th>
            </tr></thead>
            <tbody>
              <template v-for="r in analysis.byScore" :key="'pdf-bs-'+r.score">
              <tr v-if="r.count > 0"
                  :class="r.tier === 'chong' ? 'tier-row-chong' : r.tier === 'wen' ? 'tier-row-wen' : r.tier === 'bao' ? 'tier-row-bao' : ''">
                <td class="border px-1 py-0.5 text-center font-bold">{{ r.score }}</td>
                <td class="border px-1 py-0.5 text-center">
                  <span class="inline-block px-1 rounded text-white text-[9px] font-bold"
                        :class="r.tier==='chong'?'bg-red-500':r.tier==='wen'?'bg-amber-500':r.tier==='bao'?'bg-green-500':'bg-slate-400'">
                    {{ {chong:'冲',wen:'稳',bao:'保',out:'外'}[r.tier] }}
                  </span>
                </td>
                <td class="border px-1 py-0.5 text-center">{{ r.rank25 ?? '—' }}</td>
                <td class="border px-1 py-0.5 text-center"
                    :class="r.deltaScore > 0 ? 'text-red-600 font-bold' : r.deltaScore < 0 ? 'text-green-700 font-bold' : 'text-amber-700'">
                  {{ r.deltaScore > 0 ? '↑+' + r.deltaScore : r.deltaScore < 0 ? '↓' + r.deltaScore : '0' }}
                </td>
                <td class="border px-1 py-0.5 text-center"
                    :class="r.deltaRank > 0 ? 'text-red-600 font-bold' : r.deltaRank < 0 ? 'text-green-700 font-bold' : 'text-amber-700'">
                  {{ r.deltaRank > 0 ? '↑+' + r.deltaRank : r.deltaRank < 0 ? '↓' + r.deltaRank : '0' }}
                </td>
                <td class="border px-1 py-0.5 text-center font-bold">{{ r.count }}</td>
                <td class="border px-1 py-0.5 text-center">{{ r.enroll }}</td>
                <td class="border px-1 py-0.5 text-center text-blue-700 font-bold">{{ enrollAtScore(r.score)?.enroll || 0 }}</td>
                <td class="border px-1 py-0.5 text-center">{{ r.cnt26 ?? '—' }}</td>
                <td class="border px-1 py-0.5 text-center"
                    :class="supplyRatioAt(r.score) >= 0.85 ? 'text-green-700 font-bold' : supplyRatioAt(r.score) >= 0.5 ? 'text-amber-700 font-bold' : supplyRatioAt(r.score) != null ? 'text-red-600' : 'text-slate-400'">
                  {{ supplyRatioAt(r.score) != null ? (supplyRatioAt(r.score) * 100).toFixed(0) + '%' : '—' }}
                </td>
                <td class="border px-1 py-0.5">{{ schoolsAtScore(r.score) }}</td>
              </tr>
              </template>
            </tbody>
          </table>
        </section>

        <!-- 8. 分数详情 (你填报的志愿 + 该分全体招生学校) -->
        <section class="mb-6 page-break-before">
          <h2 class="text-lg font-bold mb-2 bg-blue-50 px-2 py-1 border-l-4 border-blue-600">8. 分数详情 — 你的志愿 + 2026 全体招生来源</h2>
          <template v-for="r in analysis.byScore" :key="'pdf-sd-'+r.score">
          <div v-if="r.count > 0" class="mb-4 page-break-inside-avoid">
            <div class="font-bold text-sm px-2 py-1 border-l-4"
                 :class="r.tier === 'chong' ? 'bg-red-50 border-red-500' : r.tier === 'wen' ? 'bg-amber-50 border-amber-500' : r.tier === 'bao' ? 'bg-green-50 border-green-500' : 'bg-slate-100 border-slate-400'">
              25 分 {{ r.score }} [{{ {chong:'冲',wen:'稳',bao:'保',out:'外'}[r.tier] }}] · 25位次 {{ r.rank25 ?? '—' }}
              <span v-if="r.deltaScore != null">· Δ {{ r.deltaScore > 0 ? '↑+' + r.deltaScore : r.deltaScore < 0 ? '↓' + r.deltaScore : '0' }}分</span>
              <span v-if="r.deltaRank != null">/{{ r.deltaRank > 0 ? '↑+' + r.deltaRank : r.deltaRank < 0 ? '↓' + r.deltaRank : '0' }}位</span>
              · 你填报 <b>{{ r.count }}</b> 项 ({{ r.enroll }} 人) · 2026 全体招生 <b class="text-blue-700">{{ enrollAtScore(r.score)?.enroll || 0 }}</b> 人 ({{ enrollAtScore(r.score)?.plans.length || 0 }} 个专业) · 26 同分 <b class="text-slate-700">{{ r.cnt26 ?? '?' }}</b> 人
              <span v-if="supplyRatioAt(r.score) != null" class="text-[10px]"
                    :class="supplyRatioAt(r.score) >= 0.85 ? 'text-green-700' : supplyRatioAt(r.score) >= 0.5 ? 'text-amber-700' : 'text-red-600'">
                (供给率 {{ (supplyRatioAt(r.score)*100).toFixed(0) }}%)
              </span>
            </div>
            <!-- 你的志愿 -->
            <div class="mt-1 text-[10px] text-slate-600">📋 你已填报:</div>
            <table class="w-full text-[10px] border-collapse">
              <tbody>
                <tr v-for="it in itemsAtScore(r.score)" :key="'mine-'+it.id"
                    :class="it.plan.isNew==='新增' ? 'bg-yellow-50' : ''">
                  <td class="border px-1 py-0.5 text-center w-8">#{{ it.idx }}</td>
                  <td class="border px-1 py-0.5">{{ it.plan.schoolName }}</td>
                  <td class="border px-1 py-0.5">
                    <span v-if="it.plan.isNew==='新增'" class="text-red-600 font-bold">[新]</span>
                    <span v-else-if="it.plan.diff" class="text-amber-700">[变]</span>
                    {{ it.plan.majorName26 || it.plan.majorName25 }}
                    <span v-if="it.admit?.heat?.idx >= 4" class="ml-1 text-[9px] px-1 rounded"
                          :class="it.admit.heat.idx >= 6 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'">🔥{{ it.admit.heat.name }}</span>
                  </td>
                  <td class="border px-1 py-0.5 text-center w-12">{{ it.enroll }}人</td>
                  <td class="border px-1 py-0.5 text-center w-14 font-bold"
                      :class="probColorClass(it.admit?.prob)">
                    {{ fmtProb(it.admit) }}<span v-if="it.admit?.isEstimated" class="text-[9px] text-amber-600">(估)</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <!-- 该分 2026 全体招生 -->
            <div v-if="enrollAtScore(r.score) && enrollAtScore(r.score).plans.length" class="mt-2 text-[10px] text-slate-600">📊 2026 该分全体招生来源 ({{ enrollAtScore(r.score).plans.length }} 个专业, {{ enrollAtScore(r.score).enroll }} 人):</div>
            <table v-if="enrollAtScore(r.score) && enrollAtScore(r.score).plans.length" class="w-full text-[10px] border-collapse">
              <tbody>
                <tr v-for="p in enrollAtScore(r.score).plans" :key="'enr-'+p.id"
                    :class="p.isNew==='新增' ? 'bg-yellow-50' : ''">
                  <td class="border px-1 py-0.5">{{ p.schoolName }}</td>
                  <td class="border px-1 py-0.5">{{ p.city || '—' }}</td>
                  <td class="border px-1 py-0.5">
                    <span v-if="p.isNew==='新增'" class="text-red-600">[新]</span>
                    {{ p.majorName26 || p.majorName25 }}
                  </td>
                  <td class="border px-1 py-0.5 text-center w-12">{{ p.enrollNum26 }}人</td>
                </tr>
              </tbody>
            </table>
          </div>
          </template>
        </section>

        <!-- 9. 学校总览 -->
        <section class="mb-6 page-break-before">
          <h2 class="text-lg font-bold mb-2 bg-blue-50 px-2 py-1 border-l-4 border-blue-600">9. 学校总览 ({{ itemsBySchool.length }} 所学校)</h2>
          <table class="w-full text-[10px] border-collapse">
            <thead><tr class="bg-slate-100">
              <th class="border px-1 py-1 text-left">学校</th>
              <th class="border px-1 py-1">N 项</th>
              <th class="border px-1 py-1">26 招生</th>
              <th class="border px-1 py-1">冲</th>
              <th class="border px-1 py-1">稳</th>
              <th class="border px-1 py-1">保</th>
              <th class="border px-1 py-1">校录取率</th>
            </tr></thead>
            <tbody>
              <tr v-for="g in itemsBySchool" :key="g.school">
                <td class="border px-1 py-0.5">{{ g.school }}</td>
                <td class="border px-1 py-0.5 text-center font-bold">{{ g.items.length }}</td>
                <td class="border px-1 py-0.5 text-center">{{ g.items.reduce((s, i) => s + i.enroll, 0) }}</td>
                <td class="border px-1 py-0.5 text-center text-red-600">{{ g.items.filter(i => tierLabel(i.score25)==='冲').length || '-' }}</td>
                <td class="border px-1 py-0.5 text-center text-amber-700">{{ g.items.filter(i => tierLabel(i.score25)==='稳').length || '-' }}</td>
                <td class="border px-1 py-0.5 text-center text-green-700">{{ g.items.filter(i => tierLabel(i.score25)==='保').length || '-' }}</td>
                <td class="border px-1 py-0.5 text-center font-bold" :class="probColorClass(schoolMaxProb(g))">
                  <span v-if="schoolMaxProb(g) != null">{{ (schoolMaxProb(g)*100).toFixed(0) }}%</span>
                  <span v-else class="text-slate-300">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- 10. 学校详情 -->
        <section class="mb-6 page-break-before">
          <h2 class="text-lg font-bold mb-2 bg-blue-50 px-2 py-1 border-l-4 border-blue-600">10. 学校详情 — 每校志愿列表</h2>
          <div v-for="g in itemsBySchool" :key="'ss-'+g.school" class="mb-3 page-break-inside-avoid">
            <div class="font-bold text-sm bg-slate-100 px-2 py-1">
              {{ g.school }} · {{ g.items.length }} 项 · 26 招生 {{ g.items.reduce((s, i) => s + i.enroll, 0) }} 人
            </div>
            <table class="w-full text-[10px] border-collapse">
              <tbody>
                <tr v-for="it in g.items" :key="it.id" :class="it.plan.isNew==='新增'?'bg-yellow-50':''">
                  <td class="border px-1 py-0.5 text-center w-8">#{{ it.idx }}</td>
                  <td class="border px-1 py-0.5 text-center w-8">{{ tierLabel(it.score25) }}</td>
                  <td class="border px-1 py-0.5">{{ it.plan.majorName26 || it.plan.majorName25 }}</td>
                  <td class="border px-1 py-0.5 text-center w-16">{{ it.score25 }}/{{ it.rank25 }}</td>
                  <td class="border px-1 py-0.5 text-center w-10">{{ it.enroll }}人</td>
                  <td class="border px-1 py-0.5 text-center w-12 font-bold"
                      :class="probColorClass(it.admit?.prob)">
                    {{ fmtProb(it.admit) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 11. 报考专业总览 -->
        <section class="mb-6 page-break-before">
          <h2 class="text-lg font-bold mb-2 bg-blue-50 px-2 py-1 border-l-4 border-blue-600">11. 报考专业总览 ({{ itemsByMajor.length }} 个专业)</h2>
          <div class="text-[10px] text-slate-500 mb-1">主名收敛: 例 "机械设计制造及其自动化(教育部卓越)" 与 "机械设计制造及其自动化" 算同一专业</div>
          <table class="w-full text-[10px] border-collapse">
            <thead><tr class="bg-slate-100">
              <th class="border px-1 py-1 text-left">报考专业 (主名)</th>
              <th class="border px-1 py-1">N 项</th>
              <th class="border px-1 py-1">学校</th>
              <th class="border px-1 py-1">26 招生</th>
              <th class="border px-1 py-1">冲</th>
              <th class="border px-1 py-1">稳</th>
              <th class="border px-1 py-1">保</th>
              <th class="border px-1 py-1">最佳录取率</th>
            </tr></thead>
            <tbody>
              <tr v-for="g in itemsByMajor" :key="g.major">
                <td class="border px-1 py-0.5">{{ g.major }}</td>
                <td class="border px-1 py-0.5 text-center font-bold">{{ g.items.length }}</td>
                <td class="border px-1 py-0.5 text-center">{{ majorSchoolCount(g) }}</td>
                <td class="border px-1 py-0.5 text-center">{{ g.items.reduce((s, i) => s + i.enroll, 0) }}</td>
                <td class="border px-1 py-0.5 text-center text-red-600">{{ g.items.filter(i => tierLabel(i.score25)==='冲').length || '-' }}</td>
                <td class="border px-1 py-0.5 text-center text-amber-700">{{ g.items.filter(i => tierLabel(i.score25)==='稳').length || '-' }}</td>
                <td class="border px-1 py-0.5 text-center text-green-700">{{ g.items.filter(i => tierLabel(i.score25)==='保').length || '-' }}</td>
                <td class="border px-1 py-0.5 text-center font-bold" :class="probColorClass(majorMaxProb(g))">
                  <span v-if="majorMaxProb(g) != null">{{ (majorMaxProb(g)*100).toFixed(0) }}%</span>
                  <span v-else class="text-slate-300">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- 12. 报考专业详情 -->
        <section class="mb-6 page-break-before">
          <h2 class="text-lg font-bold mb-2 bg-blue-50 px-2 py-1 border-l-4 border-blue-600">12. 报考专业详情 — 每专业 志愿列表</h2>
          <div v-for="g in itemsByMajor" :key="'mm-'+g.major" class="mb-3 page-break-inside-avoid">
            <div class="font-bold text-sm bg-slate-100 px-2 py-1">
              {{ g.major }} · {{ g.items.length }} 项 · 涉及 {{ majorSchoolCount(g) }} 校 · 26 招生 {{ g.items.reduce((s, i) => s + i.enroll, 0) }} 人
            </div>
            <table class="w-full text-[10px] border-collapse">
              <tbody>
                <tr v-for="it in g.items" :key="it.id" :class="it.plan.isNew==='新增'?'bg-yellow-50':''">
                  <td class="border px-1 py-0.5 text-center w-8">{{ tierLabel(it.score25) }}</td>
                  <td class="border px-1 py-0.5">{{ it.plan.schoolName }}</td>
                  <td class="border px-1 py-0.5">{{ it.plan.majorName26 || it.plan.majorName25 }}</td>
                  <td class="border px-1 py-0.5 text-center w-16">{{ it.score25 }}/{{ it.rank25 }}</td>
                  <td class="border px-1 py-0.5 text-center w-10">{{ it.enroll }}人</td>
                  <td class="border px-1 py-0.5 text-center w-12 font-bold"
                      :class="probColorClass(it.admit?.prob)">
                    {{ fmtProb(it.admit) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 13. 城市总览 -->
        <section class="mb-6 page-break-before">
          <h2 class="text-lg font-bold mb-2 bg-blue-50 px-2 py-1 border-l-4 border-blue-600">13. 城市总览 ({{ itemsByCity.length }} 个城市)</h2>
          <table class="w-full text-[10px] border-collapse">
            <thead><tr class="bg-slate-100">
              <th class="border px-1 py-1 text-left">城市</th>
              <th class="border px-1 py-1">N 项</th>
              <th class="border px-1 py-1">学校</th>
              <th class="border px-1 py-1">26 招生</th>
              <th class="border px-1 py-1">冲</th>
              <th class="border px-1 py-1">稳</th>
              <th class="border px-1 py-1">保</th>
              <th class="border px-1 py-1">最佳录取率</th>
            </tr></thead>
            <tbody>
              <tr v-for="g in itemsByCity" :key="g.city">
                <td class="border px-1 py-0.5">{{ g.city }}</td>
                <td class="border px-1 py-0.5 text-center font-bold">{{ g.items.length }}</td>
                <td class="border px-1 py-0.5 text-center">{{ citySchoolCount(g) }}</td>
                <td class="border px-1 py-0.5 text-center">{{ g.items.reduce((s, i) => s + i.enroll, 0) }}</td>
                <td class="border px-1 py-0.5 text-center text-red-600">{{ g.items.filter(i => tierLabel(i.score25)==='冲').length || '-' }}</td>
                <td class="border px-1 py-0.5 text-center text-amber-700">{{ g.items.filter(i => tierLabel(i.score25)==='稳').length || '-' }}</td>
                <td class="border px-1 py-0.5 text-center text-green-700">{{ g.items.filter(i => tierLabel(i.score25)==='保').length || '-' }}</td>
                <td class="border px-1 py-0.5 text-center font-bold" :class="probColorClass(cityMaxProb(g))">
                  <span v-if="cityMaxProb(g) != null">{{ (cityMaxProb(g)*100).toFixed(0) }}%</span>
                  <span v-else class="text-slate-300">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- 14. 城市详情 -->
        <section class="mb-6 page-break-before">
          <h2 class="text-lg font-bold mb-2 bg-blue-50 px-2 py-1 border-l-4 border-blue-600">14. 城市详情 — 每城市 志愿列表</h2>
          <div v-for="g in itemsByCity" :key="'cc-'+g.city" class="mb-3 page-break-inside-avoid">
            <div class="font-bold text-sm bg-slate-100 px-2 py-1">
              {{ g.city }} · {{ g.items.length }} 项 · 涉及 {{ citySchoolCount(g) }} 校 · 26 招生 {{ g.items.reduce((s, i) => s + i.enroll, 0) }} 人
            </div>
            <table class="w-full text-[10px] border-collapse">
              <tbody>
                <tr v-for="it in g.items" :key="it.id" :class="it.plan.isNew==='新增'?'bg-yellow-50':''">
                  <td class="border px-1 py-0.5 text-center w-8">{{ tierLabel(it.score25) }}</td>
                  <td class="border px-1 py-0.5">{{ it.plan.schoolName }}</td>
                  <td class="border px-1 py-0.5">{{ it.plan.majorName26 || it.plan.majorName25 }}</td>
                  <td class="border px-1 py-0.5 text-center w-16">{{ it.score25 }}/{{ it.rank25 }}</td>
                  <td class="border px-1 py-0.5 text-center w-10">{{ it.enroll }}人</td>
                  <td class="border px-1 py-0.5 text-center w-12 font-bold"
                      :class="probColorClass(it.admit?.prob)">
                    {{ fmtProb(it.admit) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- 15. 25→26 招生变化 (按 25 等位分 20 分区间) -->
        <section v-if="analysis.enrollChangeBucket20 && analysis.enrollChangeBucket20.length"
                 class="mb-6 page-break-before">
          <h2 class="text-lg font-bold mb-2 bg-blue-50 px-2 py-1 border-l-4 border-blue-600">15. 25→26 招生变化 (20 分区间, 含 anchor 段加灰底)</h2>
          <div class="text-[10px] text-slate-500 mb-1">
            合计: 25 招 {{ analysis.enrollChangeByScore25.reduce((s,r)=>s+r.n25,0) }} → 26 招 {{ analysis.enrollChangeByScore25.reduce((s,r)=>s+r.n26,0) }}
            · 你的 25 等位分 {{ analysis.anchor25 }}
          </div>
          <table class="w-full text-[10px] border-collapse">
            <thead><tr class="bg-slate-100">
              <th class="border px-1 py-1">25 等位段</th>
              <th class="border px-1 py-1">25 招</th>
              <th class="border px-1 py-1">26 招</th>
              <th class="border px-1 py-1">Δ 总</th>
              <th class="border px-1 py-1" title="目标+可接受">Δ 目标</th>
              <th class="border px-1 py-1" title="中外合作">Δ 中外</th>
              <th class="border px-1 py-1" title="其他">Δ 其他</th>
            </tr></thead>
            <tbody>
              <tr v-for="r in analysis.enrollChangeBucket20" :key="'ec20-'+r.lo"
                  :class="r.containsAnchor ? 'bg-purple-50' : (r.lo >= analysis.anchor25 ? 'bg-slate-100' : '')">
                <td class="border px-1 py-0.5 text-center font-bold">{{ r.lo }}-{{ r.hi }}</td>
                <td class="border px-1 py-0.5 text-center">{{ r.n25 || '—' }}</td>
                <td class="border px-1 py-0.5 text-center">{{ r.n26 || '—' }}</td>
                <td class="border px-1 py-0.5 text-center font-bold"
                    :class="r.delta > 0 ? 'text-red-600' : r.delta < 0 ? 'text-green-700' : ''">{{ r.delta > 0 ? '+' + r.delta : r.delta || '0' }}</td>
                <td class="border px-1 py-0.5 text-center">{{ r.delta_target > 0 ? '+' + r.delta_target : r.delta_target || '0' }}</td>
                <td class="border px-1 py-0.5 text-center">{{ r.delta_zwhz > 0 ? '+' + r.delta_zwhz : r.delta_zwhz || '0' }}</td>
                <td class="border px-1 py-0.5 text-center text-slate-500">{{ r.delta_other > 0 ? '+' + r.delta_other : r.delta_other || '0' }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- 16. 按学校 25→26 招生变化 (985/211/双一流/省重点, |Δ| Top 30) -->
        <section v-if="analysis.enrollChangeBySchool && analysis.enrollChangeBySchool.length"
                 class="mb-6 page-break-before">
          <h2 class="text-lg font-bold mb-2 bg-blue-50 px-2 py-1 border-l-4 border-blue-600">16. 按学校 25→26 招生变化 (985 / 211 / 双一流 / 省重点, |Δ| Top 30)</h2>
          <div class="text-xs text-slate-500 mb-1">
            共 {{ analysis.enrollChangeBySchool.length }} 所重点校;
            合计 25 招 {{ analysis.enrollChangeBySchool.reduce((s,r)=>s+r.n25,0) }} → 26 招 {{ analysis.enrollChangeBySchool.reduce((s,r)=>s+r.n26,0) }}
            (Δ {{ (analysis.enrollChangeBySchool.reduce((s,r)=>s+r.delta,0) > 0 ? '+' : '') + analysis.enrollChangeBySchool.reduce((s,r)=>s+r.delta,0) }})
          </div>
          <table class="w-full text-[10px] border-collapse">
            <thead><tr class="bg-slate-100">
              <th class="border px-1 py-1 w-6">#</th>
              <th class="border px-1 py-1">学校</th>
              <th class="border px-1 py-1 w-12">城市</th>
              <th class="border px-1 py-1 w-12">档</th>
              <th class="border px-1 py-1 w-10">软科</th>
              <th class="border px-1 py-1 w-10">25 招</th>
              <th class="border px-1 py-1 w-10">26 招</th>
              <th class="border px-1 py-1 w-10">Δ</th>
              <th class="border px-1 py-1 w-10">Δ%</th>
              <th class="border px-1 py-1 w-12">25/26 条</th>
              <th class="border px-1 py-1">新/停/外</th>
            </tr></thead>
            <tbody>
              <tr v-for="(r, i) in analysis.enrollChangeBySchool.slice(0, 30)" :key="'pdf-sch-ec-'+r.schoolName">
                <td class="border px-1 py-0.5 text-center">{{ i+1 }}</td>
                <td class="border px-1 py-0.5"><b>{{r.schoolName}}</b></td>
                <td class="border px-1 py-0.5 text-center">{{r.city || '—'}}</td>
                <td class="border px-1 py-0.5 text-center">
                  <span v-if="(r.schoolTag||'').includes('985')">985</span>
                  <span v-else-if="(r.schoolTag||'').includes('211')">211</span>
                  <span v-else-if="(r.schoolTag||'').includes('双一流')">双一流</span>
                  <span v-else-if="(r.schoolTag||'').includes('省重点')">省</span>
                </td>
                <td class="border px-1 py-0.5 text-center">{{ r.schoolRank < 9999 ? r.schoolRank : '—' }}</td>
                <td class="border px-1 py-0.5 text-center">{{r.n25 || '—'}}</td>
                <td class="border px-1 py-0.5 text-center">{{r.n26 || '—'}}</td>
                <td class="border px-1 py-0.5 text-center font-bold"
                    :class="r.delta > 0 ? 'text-red-600' : r.delta < 0 ? 'text-green-700' : ''">
                  {{ r.delta > 0 ? '+' + r.delta : r.delta || '0' }}
                </td>
                <td class="border px-1 py-0.5 text-center"
                    :class="r.delta > 0 ? 'text-red-500' : r.delta < 0 ? 'text-green-600' : ''">
                  {{ r.n25 > 0 ? (r.deltaPct >= 0 ? '+' : '') + (r.deltaPct * 100).toFixed(0) + '%' : (r.n26 > 0 ? '新' : '—') }}
                </td>
                <td class="border px-1 py-0.5 text-center">{{r.cnt25}}/{{r.cnt26}}</td>
                <td class="border px-1 py-0.5 text-center text-[9px]">
                  <span v-if="r.cntNew" class="text-red-600 mr-1">{{r.cntNew}}新</span>
                  <span v-if="r.cntStopped" class="text-slate-500 mr-1">{{r.cntStopped}}停</span>
                  <span v-if="r.cntZwhz" class="text-blue-600">{{r.cntZwhz}}外</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="text-[9px] text-slate-400 mt-1">仅含 985 / 211 / 双一流 / 省重点 学校; 按 |Δ| 降序前 30. 更全数据见 web app 分析页.</div>
        </section>

        <!-- 17. 转专业风险扫描 -->
        <section class="mb-6 page-break-before">
          <h2 class="text-lg font-bold mb-2 bg-blue-50 px-2 py-1 border-l-4 border-blue-600">17. 转专业风险扫描</h2>
          <transfer-risk-section :analysis="analysis" :targets="targets" :accepts="accepts" :compact="true"></transfer-risk-section>
        </section>
      </div>
    </div>
  `,
};

// ========== 转专业风险分析 ==========
// 把志愿单按"目标专业 / 可接受转专业 / 不在范围"三档分类.
// 同时提供可编辑的两份清单 (文本框 paste, 每行一个专业名), 自动持久化.
const TransferRiskSection = {
  props: ["analysis", "targets", "accepts", "compact"],
  emits: ["update-targets", "update-accepts", "reset-lists"],
  setup(props, { emit }) {
    const expanded = ref({ ok: false, warn: true, error: true });
    const showEditor = ref(false);
    const targetText = ref((props.targets || []).join("\n"));
    const acceptText = ref((props.accepts || []).join("\n"));
    watch(() => props.targets, v => { targetText.value = (v || []).join("\n"); });
    watch(() => props.accepts, v => { acceptText.value = (v || []).join("\n"); });
    function saveTargets() {
      const lst = targetText.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      emit("update-targets", lst);
    }
    function saveAccepts() {
      const lst = acceptText.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      emit("update-accepts", lst);
    }
    const summary = computed(() => {
      const s = props.analysis?.transferSummary || { ok: [], warn: [], error: [] };
      return {
        ok: s.ok || [], warn: s.warn || [], error: s.error || [],
        total: (s.ok?.length || 0) + (s.warn?.length || 0) + (s.error?.length || 0),
      };
    });
    return { expanded, showEditor, targetText, acceptText, saveTargets, saveAccepts, summary };
  },
  template: `
    <div class="transfer-risk">
      <div class="flex items-center justify-between mb-1">
        <div class="text-sm font-bold">
          🎓 转专业风险扫描
          <span class="text-xs text-slate-500 font-normal ml-1">
            (目标 {{ (targets || []).length }} 个 / 可接受 {{ (accepts || []).length }} 个)
          </span>
        </div>
        <div v-if="!compact" class="flex gap-2 text-xs">
          <button @click="showEditor = !showEditor" class="text-blue-600 hover:underline">
            {{ showEditor ? '收起编辑' : '✎ 编辑清单' }}
          </button>
          <button @click="$emit('reset-lists')" class="text-slate-400 hover:text-red-500" title="重置为默认清单">⟲ 默认</button>
        </div>
      </div>

      <!-- 清单编辑 (分析页 互动模式) -->
      <div v-if="!compact && showEditor" class="mb-3 grid grid-cols-1 md:grid-cols-2 gap-3 border rounded p-3 bg-slate-50">
        <div>
          <div class="text-xs font-bold text-green-700 mb-1">目标专业 (无需转专业)</div>
          <textarea v-model="targetText" @blur="saveTargets" rows="10"
                    class="w-full border rounded text-xs p-1.5 font-mono"
                    placeholder="每行一个专业名"></textarea>
          <div class="text-[10px] text-slate-400 mt-1">每行一个专业名, 失焦自动保存. 名字需与 csv 中"招生专业 / 所含专业"列完全一致.</div>
        </div>
        <div>
          <div class="text-xs font-bold text-amber-700 mb-1">可接受转入 (录取后可转过去)</div>
          <textarea v-model="acceptText" @blur="saveAccepts" rows="10"
                    class="w-full border rounded text-xs p-1.5 font-mono"
                    placeholder="每行一个专业名"></textarea>
          <div class="text-[10px] text-slate-400 mt-1">大类志愿中若有此列专业, 标为"需转".</div>
        </div>
      </div>

      <!-- 清单只读 (PDF compact 模式) -->
      <div v-if="compact" class="mb-3 grid grid-cols-1 md:grid-cols-2 gap-3 border rounded p-2 bg-slate-50 text-[10px] leading-snug">
        <div>
          <div class="font-bold text-green-700 mb-1">✓ 目标专业 (无需转, 共 {{(targets || []).length}} 个)</div>
          <div class="text-slate-700">{{ (targets || []).join('、') || '(空)' }}</div>
        </div>
        <div>
          <div class="font-bold text-amber-700 mb-1">⚠ 可接受转入 (共 {{(accepts || []).length}} 个)</div>
          <div class="text-slate-700">{{ (accepts || []).join('、') || '(空)' }}</div>
        </div>
      </div>

      <!-- 3 张汇总卡 -->
      <div class="grid grid-cols-3 gap-2 text-xs mb-2">
        <div class="border rounded p-2 cursor-pointer transition"
             :class="expanded.ok ? 'bg-green-100 border-green-400' : 'bg-green-50 border-green-200'"
             @click="expanded.ok = !expanded.ok">
          <div class="flex items-center justify-between">
            <span class="font-bold text-green-700">✓ 无需转 {{ summary.ok.length }}</span>
            <span class="text-slate-400">{{ expanded.ok ? '▾' : '▸' }}</span>
          </div>
          <div class="text-[10px] text-green-700 mt-0.5">含至少 1 个目标专业</div>
        </div>
        <div class="border rounded p-2 cursor-pointer transition"
             :class="expanded.warn ? 'bg-amber-100 border-amber-400' : 'bg-amber-50 border-amber-200'"
             @click="expanded.warn = !expanded.warn">
          <div class="flex items-center justify-between">
            <span class="font-bold text-amber-700">⚠ 需转 {{ summary.warn.length }}</span>
            <span class="text-slate-400">{{ expanded.warn ? '▾' : '▸' }}</span>
          </div>
          <div class="text-[10px] text-amber-700 mt-0.5">无目标, 但可转入</div>
        </div>
        <div class="border rounded p-2 cursor-pointer transition"
             :class="expanded.error ? 'bg-red-100 border-red-400' : 'bg-red-50 border-red-200'"
             @click="expanded.error = !expanded.error">
          <div class="flex items-center justify-between">
            <span class="font-bold text-red-700">✗ 不在范围 {{ summary.error.length }}</span>
            <span class="text-slate-400">{{ expanded.error ? '▾' : '▸' }}</span>
          </div>
          <div class="text-[10px] text-red-700 mt-0.5">无目标也无可接受</div>
        </div>
      </div>

      <!-- 详情 (展开后 表格) -->
      <template v-for="level in ['error','warn','ok']" :key="'tr-'+level">
        <div v-if="expanded[level] && summary[level].length" class="mb-2">
          <div class="text-xs font-bold mb-1"
               :class="level==='ok' ? 'text-green-700' : level==='warn' ? 'text-amber-700' : 'text-red-700'">
            {{ level==='ok' ? '✓ 无需转专业' : level==='warn' ? '⚠ 需转专业' : '✗ 不在范围 (高风险)' }} ({{summary[level].length}} 项)
          </div>
          <table class="w-full text-[11px] border-collapse">
            <thead><tr class="bg-slate-100">
              <th class="border px-2 py-1 text-center w-10">序号</th>
              <th class="border px-2 py-1 text-left">学校</th>
              <th class="border px-2 py-1 text-left">26 专业</th>
              <th class="border px-2 py-1 text-left">所含专业</th>
              <th class="border px-2 py-1 text-left w-32">命中</th>
            </tr></thead>
            <tbody>
              <tr v-for="it in summary[level]" :key="'tr'+level+it.id" class="border-t">
                <td class="border px-2 py-1 text-center">#{{ analysis.items.indexOf(it) + 1 }}</td>
                <td class="border px-2 py-1">{{ it.plan.schoolName }}</td>
                <td class="border px-2 py-1">{{ it.plan.majorName26 || it.plan.majorName25 }}</td>
                <td class="border px-2 py-1 text-slate-600">{{ (it.transfer?.majors || []).join('、') || '—' }}</td>
                <td class="border px-2 py-1">
                  <span v-if="level==='ok'" class="text-green-700">{{ it.transfer.matchedTargets.join('、') }}</span>
                  <span v-else-if="level==='warn'" class="text-amber-700">{{ it.transfer.matchedAccepts.join('、') }}</span>
                  <span v-else class="text-slate-400 text-[10px]">无</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  `,
};

// ========== 录取候选 Top 汇总 (各档 Top 3 + 多阈值 Top 5) ==========
// 复用于 分析页 + PDF. 接 analysis (含 topByTier + topByThreshold).
const AdmitTopSummary = {
  props: ["analysis"],
  setup(props) {
    const tierMeta = { chong: { label: "冲", color: "red" }, wen: { label: "稳", color: "amber" }, bao: { label: "保", color: "green" } };
    function shortMajor(it) {
      const s = it.plan?.majorName26 || it.plan?.majorName25 || "";
      return s.length > 22 ? s.slice(0, 22) + "…" : s;
    }
    // Δ 格式化: +N分/+M位次 (+ 冲, - 保, byScore convention).
    // 颜色: 都正→红 (冲), 都负→绿 (保), 混合→琥珀 (跨档).
    function fmtDelta(it) {
      const d = it?.delta; if (!d || (d.score == null && d.rank == null)) return null;
      const s = d.score, r = d.rank;
      const fs = s != null ? (s > 0 ? `+${s}` : String(s)) : "·";
      const fr = r != null ? (r > 0 ? `+${r}` : String(r)) : "·";
      let cls = "text-slate-500";
      if (s != null && r != null) {
        if (s > 0 && r > 0) cls = "text-red-600";        // 冲
        else if (s < 0 && r < 0) cls = "text-green-700"; // 保
        else if (s !== 0 || r !== 0) cls = "text-amber-600"; // 混
      }
      return { text: `${fs}分 / ${fr}位`, cls };
    }
    return { tierMeta, shortMajor, fmtDelta };
  },
  template: `
    <div class="admit-top-summary space-y-3">
      <!-- 各档 Top 3 -->
      <div>
        <div class="text-sm font-bold mb-1.5">🏆 各档录取率 Top 3</div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div v-for="k in ['chong','wen','bao']" :key="'tt'+k"
               class="border rounded p-2"
               :class="k==='chong'?'border-red-200 bg-red-50/40':k==='wen'?'border-amber-200 bg-amber-50/40':'border-green-200 bg-green-50/40'">
            <div class="font-bold text-xs mb-1"
                 :class="k==='chong'?'text-red-700':k==='wen'?'text-amber-700':'text-green-700'">
              {{ tierMeta[k].label }}档 <span class="text-slate-400 font-normal">({{ analysis.topByTier[k].length }})</span>
            </div>
            <ol v-if="analysis.topByTier[k].length" class="text-[11px] space-y-1">
              <li v-for="(it, i) in analysis.topByTier[k]" :key="it.id" class="flex items-start gap-1.5">
                <span class="font-bold w-3 text-slate-500">{{ i+1 }}.</span>
                <span class="flex-1 leading-tight">
                  <b>{{ it.plan.schoolName }}</b><br/>
                  <span class="text-slate-600 text-[10px]">{{ shortMajor(it) }}</span>
                </span>
                <span class="shrink-0 text-right leading-tight">
                  <b :class="probColorClass(it.admit?.prob)">
                    {{ (it.admit.prob*100).toFixed(0) }}%<span v-if="it.admit.isEstimated" class="text-[9px] text-amber-600">(估)</span>
                  </b>
                  <div v-if="fmtDelta(it)" class="text-[9px] mt-0.5" :class="fmtDelta(it).cls">{{ fmtDelta(it).text }}</div>
                </span>
              </li>
            </ol>
            <div v-else class="text-[10px] text-slate-400">该档无志愿</div>
          </div>
        </div>
      </div>

      <!-- 多阈值 Top 5 -->
      <div>
        <div class="text-sm font-bold mb-1.5">🎯 按阈值最可能录取的次序 Top 5
          <span class="text-[10px] text-slate-500 font-normal">(平行志愿首 5 个 prob ≥ 阈值, 按填报序)</span>
        </div>
        <table class="w-full text-[11px] border-collapse">
          <thead><tr class="bg-slate-100">
            <th class="border px-1.5 py-1 text-center w-12">阈值</th>
            <th class="border px-1.5 py-1 text-left">1</th>
            <th class="border px-1.5 py-1 text-left">2</th>
            <th class="border px-1.5 py-1 text-left">3</th>
            <th class="border px-1.5 py-1 text-left">4</th>
            <th class="border px-1.5 py-1 text-left">5</th>
          </tr></thead>
          <tbody>
            <tr v-for="b in analysis.topByThreshold" :key="'tb'+b.threshold" class="border-t align-top">
              <td class="border px-1.5 py-1 text-center font-bold bg-blue-50 text-blue-700 align-middle">≥{{ (b.threshold*100).toFixed(0) }}%</td>
              <template v-for="i in 5" :key="'tc'+b.threshold+i">
                <td class="border px-1.5 py-1 leading-tight" style="min-width:120px">
                  <template v-if="b.items[i-1]">
                    <div class="flex items-center justify-between gap-1">
                      <span class="text-orange-600 font-bold text-[10px]">#{{ b.items[i-1].idx }}</span>
                      <b class="text-[11px]" :class="probColorClass(b.items[i-1].admit?.prob)">
                        {{ (b.items[i-1].admit.prob*100).toFixed(0) }}%<span v-if="b.items[i-1].admit.isEstimated" class="text-[9px] text-amber-600">(估)</span>
                      </b>
                    </div>
                    <div class="font-bold text-[11px]">{{ b.items[i-1].plan.schoolName }}</div>
                    <div class="text-slate-600 text-[10px]">{{ shortMajor(b.items[i-1]) }}</div>
                    <div v-if="fmtDelta(b.items[i-1])" class="text-[9px] mt-0.5" :class="fmtDelta(b.items[i-1]).cls">{{ fmtDelta(b.items[i-1]).text }}</div>
                  </template>
                  <span v-else class="text-slate-300 text-[10px]">—</span>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
};

// ========== 录取趋势图 (按志愿顺序的录取概率折线 + 阈值首达点) ==========
// 用于分析页 + PDF 报告. 纯 SVG, 无外部依赖.
const AdmitTrendChart = {
  props: {
    items: { type: Array, required: true },   // 来自 analysis.items, 每项含 admit.prob
    height: { type: Number, default: 280 },
    compact: { type: Boolean, default: false }, // PDF 用紧凑布局
  },
  setup(props) {
    const W = 800;
    const padL = 36, padR = 14, padT = 14, padB = 32;
    const thresholds = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95];

    const points = computed(() => {
      return (props.items || [])
        .map((it, i) => {
          const p = it.plan || {};
          return {
            idx: i + 1,
            probPct: it.admit?.prob != null ? Math.round(it.admit.prob * 100) : null,
            schoolName: p.schoolName || "",
            majorName: p.majorName26 || p.majorName25 || "",
            city: p.city || "",
            score25: it.score25 ?? null,
            rank25: it.rank25 ?? null,
            avgRank: p.avgRank ?? null,
            enroll26: it.enroll ?? p.enrollNum26 ?? null,
            tuition: p.tuition ?? null,
            isNew: p.isNew === "新增",
            heat: it.admit?.heat || null,
            isEst: !!it.admit?.isEstimated,
            delta: it.delta || null,    // {score, rank} vs anchor (+ 冲, - 保)
            // name 兼容旧用法
            name: (p.schoolName || "") + " · " + (p.majorName26 || p.majorName25 || ""),
          };
        })
        .filter(p => p.probPct != null);
    });

    function xScale(idx, N) {
      if (N <= 1) return padL + (W - padL - padR) / 2;
      return padL + (idx - 1) / (N - 1) * (W - padL - padR);
    }
    function yScale(v) {
      return padT + (100 - v) / 100 * (props.height - padT - padB);
    }

    const linePath = computed(() => {
      const pts = points.value, N = pts.length;
      if (!N) return "";
      return pts.map((p, i) => {
        const x = xScale(p.idx, N).toFixed(1);
        const y = yScale(p.probPct).toFixed(1);
        return (i === 0 ? "M" : "L") + x + "," + y;
      }).join(" ");
    });

    const fillPath = computed(() => {
      const pts = points.value, N = pts.length;
      if (!N) return "";
      const top = pts.map((p, i) => {
        const x = xScale(p.idx, N).toFixed(1);
        const y = yScale(p.probPct).toFixed(1);
        return (i === 0 ? "M" : "L") + x + "," + y;
      }).join(" ");
      const yBot = yScale(0).toFixed(1);
      const xL = xScale(pts[N - 1].idx, N).toFixed(1);
      const xF = xScale(pts[0].idx, N).toFixed(1);
      return top + ` L${xL},${yBot} L${xF},${yBot} Z`;
    });

    const thresholdHits = computed(() => {
      const pts = points.value, N = pts.length;
      const out = [];
      for (const T of thresholds) {
        const i = pts.findIndex(p => p.probPct >= T);
        if (i < 0) continue;
        const p = pts[i];
        out.push({
          threshold: T,
          ...p,
          x: xScale(p.idx, N), y: yScale(p.probPct),
        });
      }
      return out;
    });

    // ---- 用户选定的阈值 (互动). PDF compact 模式锁定 50 ----
    const selectedThreshold = ref(50);
    const effectiveThreshold = computed(() =>
      props.compact ? 50 : selectedThreshold.value);
    function setThreshold(v) {
      if (props.compact) return;
      v = Math.max(0, Math.min(99, Math.round(+v)));
      selectedThreshold.value = v;
    }
    function onYAxisClick(y) {
      if (props.compact) return;
      setThreshold(y);
    }
    function onHistClick(loBucket) {
      if (props.compact) return;
      setThreshold(loBucket);
    }
    // 点击 SVG 内任意 Y 位置 → 精确设阈值 (任意 %)
    function onSvgClickThreshold(e) {
      if (props.compact) return;
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      if (rect.height === 0) return;
      const yPx = e.clientY - rect.top;
      const vbY = yPx / rect.height * props.height;
      // reverse: v = 100 - (vbY - padT) / (height-padT-padB) * 100
      const v = 100 - (vbY - padT) / Math.max(1, props.height - padT - padB) * 100;
      setThreshold(v);
    }

    // 概率分布 (每 10% 一桶, 0-9/10-19/.../90-100)
    const probDistribution = computed(() => {
      const buckets = [];
      for (let i = 0; i < 10; i++) {
        buckets.push({
          lo: i * 10,
          hi: i === 9 ? 100 : (i + 1) * 10 - 1,
          count: 0,
          // 颜色 跟 5 档 probColorClass 大致对齐
          color: i >= 8 ? "#15803d" :        // 80+ 深绿
                 i >= 6 ? "#059669" :        // 60-79 蓝绿
                 i === 5 ? "#ca8a04" :       // 50-59 浅黄
                 i >= 3 ? "#ea580c" :        // 30-49 橙
                          "#dc2626",         // 0-29 红
        });
      }
      for (const p of points.value) {
        let i = Math.floor(p.probPct / 10);
        if (i >= 10) i = 9;
        if (i < 0) i = 0;
        buckets[i].count++;
      }
      return buckets;
    });
    const distMax = computed(() =>
      Math.max(1, ...probDistribution.value.map(b => b.count)));

    // 阈值表: 列出 概率 >= effectiveThreshold 的志愿 (按志愿顺序)
    // 互动模式下阈值随 selectedThreshold 变, PDF 模式固定 50.
    const qualifyingPlans = computed(() => {
      const T = effectiveThreshold.value;
      const pts = points.value;
      const firstHitIdx = new Map();  // idx → 最高首达阈值
      for (const h of thresholdHits.value) {
        const prev = firstHitIdx.get(h.idx) || 0;
        if (h.threshold > prev) firstHitIdx.set(h.idx, h.threshold);
      }
      return pts.filter(p => p.probPct >= T).map(p => ({
        ...p,
        firstHitThreshold: firstHitIdx.get(p.idx) || null,
      }));
    });

    // 同 idx 多阈值合并为一个 dot, 标签取最大阈值
    const chartDots = computed(() => {
      const m = new Map();
      for (const h of thresholdHits.value) {
        if (!m.has(h.idx) || m.get(h.idx).threshold < h.threshold) {
          m.set(h.idx, h);
        }
      }
      return [...m.values()];
    });

    const xLabels = computed(() => {
      const pts = points.value, N = pts.length;
      if (!N) return [];
      const step = N > 80 ? 10 : N > 40 ? 5 : N > 16 ? 2 : 1;
      const out = [];
      for (let i = 0; i < N; i++) {
        if (i === 0 || (i + 1) % step === 0 || i === N - 1) {
          out.push({ idx: pts[i].idx, x: xScale(pts[i].idx, N) });
        }
      }
      return out;
    });

    const yGrid = [0, 20, 40, 60, 80, 100];

    // ---- 互动: hover 显示具体志愿 (PDF 用 compact=true 关掉) ----
    const svgRef = ref(null);
    const hoverIdx = ref(null);
    const hoverPx = ref({ x: 0, y: 0 });   // 鼠标在 svg 内的像素坐标
    function onMove(e) {
      if (props.compact) return;
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const xPx = e.clientX - rect.left;
      const yPx = e.clientY - rect.top;
      const N = points.value.length;
      if (!N || rect.width === 0) return;
      // pixel → viewBox X → idx
      const vbX = xPx / rect.width * W;
      let idx = Math.round((vbX - padL) / Math.max(1, W - padL - padR) * (N - 1) + 1);
      idx = Math.max(1, Math.min(N, idx));
      hoverIdx.value = idx;
      hoverPx.value = { x: xPx, y: yPx, rectW: rect.width, rectH: rect.height };
    }
    function onLeave() { hoverIdx.value = null; }

    const hoverPoint = computed(() => {
      const i = hoverIdx.value;
      if (i == null) return null;
      const pts = points.value, N = pts.length;
      const p = pts[i - 1];
      if (!p) return null;
      // hit threshold info (if this idx is a 阈值首达点)
      const allHits = thresholdHits.value.filter(h => h.idx === p.idx).map(h => h.threshold);
      return {
        ...p,
        x: xScale(p.idx, N),
        y: yScale(p.probPct),
        hitThresholds: allHits,
      };
    });

    // tooltip pixel 位置 (相对 svg container)
    const tipStyle = computed(() => {
      if (!hoverPoint.value || !hoverPx.value.rectW) return { display: "none" };
      const xPx = hoverPoint.value.x / W * hoverPx.value.rectW;
      const yPx = hoverPoint.value.y / props.height * hoverPx.value.rectH;
      const TIP_W = 240;
      let left = xPx + 14;
      if (left + TIP_W > hoverPx.value.rectW) left = xPx - TIP_W - 14;
      if (left < 4) left = 4;
      let top = yPx - 60;
      if (top < 4) top = yPx + 14;
      return { left: left + "px", top: top + "px" };
    });

    return { W, padL, padR, padT, padB, points, linePath, fillPath,
             thresholdHits, qualifyingPlans, chartDots, xLabels, yGrid, yScale,
             probDistribution, distMax,
             selectedThreshold, effectiveThreshold, setThreshold, onYAxisClick, onHistClick, onSvgClickThreshold,
             svgRef, hoverIdx, hoverPoint, tipStyle, onMove, onLeave };
  },
  template: `
    <div class="admit-trend-chart">
      <div v-if="!points.length" class="text-center text-slate-400 py-6 text-xs border rounded bg-slate-50">
        无可用录取概率数据 (请输入 26 分数, 且志愿单非空)
      </div>
      <div v-else>
        <div class="flex items-center justify-between mb-1.5 text-xs text-slate-600">
          <span class="font-bold text-sm">📈 录取趋势 — 按志愿顺序 (共 {{ points.length }} 项)</span>
          <span class="flex items-center gap-3">
            <span class="flex items-center gap-1"><span class="inline-block w-5 h-0.5 bg-orange-500"></span>录取概率</span>
            <span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-full bg-green-500"></span>阈值首达点</span>
            <span v-if="!compact" class="flex items-center gap-1"><span class="inline-block w-5 h-0.5 bg-blue-500" style="border-top:1px dashed #3b82f6"></span>当前阈值</span>
          </span>
        </div>

        <!-- 概率分布 直方图 (上方; 互动模式下点击柱设阈值) -->
        <div class="mb-2 border rounded p-2 bg-slate-50">
          <div class="text-xs text-slate-600 font-bold mb-1.5">
            📊 概率分布 (按 10% 分桶)
            <span v-if="!compact" class="text-[10px] text-slate-400 font-normal ml-1">— 点击柱设阈值</span>
          </div>
          <div class="flex items-end gap-1 h-16 px-1">
            <div v-for="b in probDistribution" :key="'h'+b.lo"
                 class="flex-1 flex flex-col items-center justify-end relative"
                 :class="!compact ? 'cursor-pointer hover:opacity-80' : ''"
                 @click="onHistClick(b.lo)"
                 :title="b.lo+'-'+b.hi+'%: '+b.count+' 项'">
              <span class="text-[10px] font-bold mb-0.5" :style="{color: b.color}">{{b.count || ''}}</span>
              <div class="w-full rounded-t transition-all"
                   :style="{height: (b.count/distMax*100)+'%', minHeight: b.count ? '3px' : '0', background: b.color, opacity: b.count ? (!compact && effectiveThreshold === b.lo ? 1 : (b.count ? 0.8 : 0.15)) : 0.12, outline: !compact && effectiveThreshold === b.lo ? '2px solid #3b82f6' : 'none'}"></div>
            </div>
          </div>
          <div class="flex gap-1 mt-1 px-1">
            <span v-for="b in probDistribution" :key="'l'+b.lo" class="flex-1 text-center text-[9px] text-slate-500">{{b.lo}}-{{b.hi}}</span>
          </div>
        </div>
        <div class="relative">
          <svg :viewBox="'0 0 ' + W + ' ' + height" class="w-full bg-white border rounded"
               :class="compact ? '' : 'cursor-crosshair'"
               preserveAspectRatio="xMidYMid meet"
               :style="{minHeight: height+'px'}"
               @mousemove="onMove" @mouseleave="onLeave" @click="onSvgClickThreshold">
            <defs>
              <linearGradient id="admit-trend-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#f97316" stop-opacity="0.4"/>
                <stop offset="100%" stop-color="#f97316" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <g>
              <line v-for="y in yGrid" :key="'g'+y"
                    :x1="padL" :x2="W-padR" :y1="yScale(y)" :y2="yScale(y)"
                    stroke="#e2e8f0" stroke-dasharray="2,3"/>
              <text v-for="y in yGrid" :key="'l'+y"
                    :x="padL-5" :y="yScale(y)+3" text-anchor="end" font-size="10"
                    :fill="!compact && effectiveThreshold === y ? '#3b82f6' : '#94a3b8'"
                    :font-weight="!compact && effectiveThreshold === y ? 'bold' : 'normal'"
                    :style="!compact ? 'cursor:pointer' : ''"
                    @click="onYAxisClick(y)">{{y}}</text>
            </g>
            <path :d="fillPath" fill="url(#admit-trend-grad)"/>
            <path :d="linePath" stroke="#f97316" stroke-width="1.5" fill="none"/>
            <g>
              <text v-for="t in xLabels" :key="'x'+t.idx"
                    :x="t.x" :y="height-10" text-anchor="middle" font-size="9" fill="#94a3b8">#{{t.idx}}</text>
            </g>
            <g v-for="h in chartDots" :key="'h'+h.idx">
              <line :x1="h.x" :x2="h.x" :y1="h.y" :y2="yScale(0)" stroke="#84cc16" stroke-dasharray="2,2" stroke-width="0.8" opacity="0.4"/>
              <circle :cx="h.x" :cy="h.y" r="5" fill="#84cc16" stroke="white" stroke-width="1.5"/>
              <text :x="h.x" :y="h.y-9" text-anchor="middle" font-size="9" font-weight="bold" fill="#3f6212">≥{{h.threshold}}%</text>
            </g>
            <!-- 当前阈值 横线 + 角标 (互动模式) -->
            <g v-if="!compact" style="pointer-events:none">
              <line :x1="padL" :x2="W-padR" :y1="yScale(effectiveThreshold)" :y2="yScale(effectiveThreshold)"
                    stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.85"/>
              <rect :x="W-padR-50" :y="yScale(effectiveThreshold)-9" width="48" height="16" rx="3" fill="#3b82f6"/>
              <text :x="W-padR-26" :y="yScale(effectiveThreshold)+3" text-anchor="middle" font-size="10" fill="white" font-weight="bold">≥{{effectiveThreshold}}%</text>
            </g>
            <!-- hover indicator (互动) -->
            <g v-if="hoverPoint && !compact" style="pointer-events:none">
              <line :x1="hoverPoint.x" :x2="hoverPoint.x" :y1="padT" :y2="height-padB"
                    stroke="#475569" stroke-dasharray="3,3" stroke-width="0.8" opacity="0.6"/>
              <circle :cx="hoverPoint.x" :cy="hoverPoint.y" r="7" fill="white" stroke="#f97316" stroke-width="2"/>
              <circle :cx="hoverPoint.x" :cy="hoverPoint.y" r="2.5" fill="#f97316"/>
            </g>
          </svg>
          <!-- hover tooltip (HTML overlay) -->
          <div v-if="hoverPoint && !compact"
               class="absolute pointer-events-none bg-slate-800 text-white rounded shadow-lg px-2.5 py-1.5 z-10 leading-tight"
               :style="tipStyle">
            <div class="font-bold text-sm whitespace-nowrap">
              <span class="text-orange-300">#{{hoverPoint.idx}}</span>
              <span class="ml-2" :class="hoverPoint.probPct >= 80 ? 'text-green-300' : hoverPoint.probPct >= 60 ? 'text-emerald-300' : hoverPoint.probPct >= 50 ? 'text-yellow-300' : hoverPoint.probPct >= 35 ? 'text-orange-300' : 'text-red-300'">
                {{hoverPoint.probPct}}%
              </span>
              <span v-if="hoverPoint.isEst" class="text-amber-300 text-[10px] ml-1">(估)</span>
              <span v-if="hoverPoint.isNew" class="text-yellow-300 text-[10px] ml-1 bg-yellow-500/20 rounded px-1">新</span>
              <span v-if="hoverPoint.hitThresholds && hoverPoint.hitThresholds.length"
                    class="ml-2 text-[10px] bg-green-600/40 text-green-200 rounded px-1">
                ≥{{Math.max(...hoverPoint.hitThresholds)}}% 首达
              </span>
            </div>
            <div class="text-[11px] text-slate-100 mt-1 font-bold" style="max-width:260px;white-space:normal">
              {{hoverPoint.schoolName}}
              <span v-if="hoverPoint.city" class="text-[10px] text-slate-300 font-normal ml-1">[{{hoverPoint.city}}]</span>
            </div>
            <div class="text-[11px] text-slate-200" style="max-width:260px;white-space:normal">
              {{hoverPoint.majorName}}
              <span v-if="hoverPoint.heat && hoverPoint.heat.idx >= 4" class="text-[9px] ml-1 px-1 rounded"
                    :class="hoverPoint.heat.idx >= 6 ? 'bg-red-500/40 text-red-100' : 'bg-amber-500/40 text-amber-100'">🔥{{hoverPoint.heat.name}}</span>
            </div>
            <div class="text-[11px] text-slate-300 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              <span v-if="hoverPoint.score25">25 分 <b class="text-white">{{hoverPoint.score25}}</b><span v-if="hoverPoint.delta?.score != null"
                    :class="hoverPoint.delta.score > 0 ? 'text-red-300' : hoverPoint.delta.score < 0 ? 'text-green-300' : 'text-slate-400'">
                ({{ hoverPoint.delta.score > 0 ? '+' : '' }}{{ hoverPoint.delta.score }})</span></span>
              <span v-if="hoverPoint.rank25">25 位 <b class="text-white">{{hoverPoint.rank25}}</b><span v-if="hoverPoint.delta?.rank != null"
                    :class="hoverPoint.delta.rank > 0 ? 'text-red-300' : hoverPoint.delta.rank < 0 ? 'text-green-300' : 'text-slate-400'">
                ({{ hoverPoint.delta.rank > 0 ? '+' : '' }}{{ hoverPoint.delta.rank }})</span></span>
              <span v-if="hoverPoint.avgRank && hoverPoint.avgRank !== hoverPoint.rank25">平均位 <b class="text-white">{{hoverPoint.avgRank}}</b></span>
              <span v-if="hoverPoint.enroll26">26 计划 <b class="text-white">{{hoverPoint.enroll26}}</b></span>
              <span v-if="hoverPoint.tuition">学费 <b class="text-white">¥{{hoverPoint.tuition}}</b></span>
            </div>
            <div v-if="hoverPoint.delta?.score != null || hoverPoint.delta?.rank != null"
                 class="text-[10px] text-slate-400 mt-0.5 italic">
              Δ vs 你的 anchor — 正 = 上冲, 负 = 下保
            </div>
          </div>
        </div>
        <!-- 阈值滑杆 (互动模式) -->
        <div v-if="!compact" class="mt-2 px-1 flex items-center gap-3">
          <span class="text-xs text-slate-500 whitespace-nowrap">阈值滑动:</span>
          <input type="range" min="0" max="99" step="1"
                 :value="selectedThreshold"
                 @input="setThreshold(+$event.target.value)"
                 class="flex-1 accent-blue-500"
                 :title="'按住 ←/→ 微调 1%, Shift+←/→ 跳 5%, 0-99 任意值'"/>
          <span class="text-sm font-bold text-blue-600 min-w-16 text-center bg-blue-50 rounded px-2 py-0.5">≥ {{selectedThreshold}}%</span>
          <button v-if="selectedThreshold !== 50" @click="setThreshold(50)"
                  class="text-[10px] text-slate-400 hover:text-blue-600">重置 50%</button>
        </div>

        <div class="text-xs text-slate-600 mt-3 mb-1 flex items-center justify-between">
          <span><b>≥ {{effectiveThreshold}}% 录取概率志愿全列表</b> (<span class="text-blue-600 font-bold">{{qualifyingPlans.length}}</span> / {{points.length}} 项)</span>
          <span v-if="!compact" class="text-[10px] text-slate-400">点击 概率分布 柱 / Y 轴数字 / 拖动 滑杆 调整阈值</span>
        </div>
        <table class="w-full text-[11px] border-collapse">
          <thead><tr class="bg-slate-100">
            <th class="border px-2 py-1 text-center w-10">序号</th>
            <th class="border px-2 py-1 text-left">学校</th>
            <th class="border px-2 py-1 text-left">26 专业</th>
            <th class="border px-2 py-1 text-center w-20">25 分/位次</th>
            <th class="border px-2 py-1 text-center w-12">平均位</th>
            <th class="border px-2 py-1 text-center w-12">26 计划</th>
            <th class="border px-2 py-1 text-center w-14">概率</th>
            <th class="border px-2 py-1 text-center w-16">阈值首达</th>
          </tr></thead>
          <tbody>
            <tr v-for="h in qualifyingPlans" :key="'qp'+h.idx" class="border-t"
                :class="h.isNew ? 'bg-yellow-50' : ''">
              <td class="border px-2 py-1 text-center font-bold">#{{h.idx}}</td>
              <td class="border px-2 py-1">
                <span v-if="h.isNew" class="text-red-600 text-[9px] font-bold mr-0.5">新</span>
                {{h.schoolName}}
                <span v-if="h.city" class="text-[9px] text-slate-500 ml-0.5">{{h.city}}</span>
              </td>
              <td class="border px-2 py-1">
                {{h.majorName}}
                <span v-if="h.heat && h.heat.idx >= 4" class="ml-0.5 text-[9px] px-1 rounded"
                      :class="h.heat.idx >= 6 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'">🔥{{h.heat.name}}</span>
              </td>
              <td class="border px-2 py-1 text-center">
                <span v-if="h.score25"><b>{{h.score25}}</b>/{{h.rank25 || '?'}}</span>
                <span v-else class="text-slate-400">—</span>
              </td>
              <td class="border px-2 py-1 text-center text-slate-600">{{h.avgRank || '—'}}</td>
              <td class="border px-2 py-1 text-center">{{h.enroll26 || '—'}}</td>
              <td class="border px-2 py-1 text-center font-bold" :class="probColorClass(h.probPct/100)">
                {{h.probPct}}%<span v-if="h.isEst" class="text-[9px] text-amber-600 ml-0.5">(估)</span>
              </td>
              <td class="border px-2 py-1 text-center">
                <span v-if="h.firstHitThreshold" class="inline-block bg-green-100 text-green-800 font-bold rounded px-1 text-[10px]">
                  ≥{{h.firstHitThreshold}}%
                </span>
                <span v-else class="text-slate-300">—</span>
              </td>
            </tr>
            <tr v-if="!qualifyingPlans.length"><td colspan="8" class="border px-2 py-2 text-center text-slate-400">无志愿达到 50% 阈值 — 建议补充更稳的志愿</td></tr>
          </tbody>
        </table>
        <div class="text-[10px] text-slate-400 mt-1 leading-snug">
          解读: 平行志愿按 #1 → #{{points.length}} 顺序投档,
          一旦命中即录取该志愿. 表内每行的 "实际概率" 是该阈值下你最有把握命中的志愿.
          高阈值更保守 (优先保底); 低阈值更激进 (优先冲刺).
        </div>
      </div>
    </div>
  `,
};

// ========== 主 App ==========

const __app = createApp({
  components: {
    ScoreTool, FilterPanel, ResultList, PlanCard, DetailDrawer, CompareBar, FavoritesBar,
    PrioritySettings, KeywordAutocomplete, VoluntaryAnalysis, VoluntaryReport,
  },
  setup() {
    const loading = ref(true);
    const loadingMsg = ref("");
    const loadingPct = ref(0);
    const scoreRank = ref(null);
    const meta = ref(null);
    const priority = ref(null);
    const currentPage = ref(1);

    // 保存每条 plan 原始字段 (load 时快照, 用于"恢复默认")
    const planOriginals = new Map();

    // 加载数据
    async function load() {
      loading.value = true;
      const t = "?_t=" + Date.now();  // bust cache (Item 4 刷新)
      loadingMsg.value = "下载 plans.json (约 15MB)...";
      loadingPct.value = 10;
      const r1 = await fetch("data/plans.json" + t);
      loadingPct.value = 30;
      const plans = await r1.json();
      // 先快照原始值 (在 override 应用之前)
      planOriginals.clear();
      for (const p of plans) {
        planOriginals.set(p.id, { ref25Score: p.ref25Score, ref25Rank: p.ref25Rank });
      }
      // 应用 planOverrides (用户手动修改的字段)
      const ov = store.planOverrides || {};
      for (const p of plans) {
        const o = ov[p.id];
        if (o) Object.assign(p, o);
      }
      store.allPlans = plans;
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

    // 修正后等价 26 分 (用 rankRefine.R25_final 反查 osr26 同位次的 score)
    // 给 主查询 / 冲稳保 / 顶部位次显示 提供"修正后等价 26 输入"
    const refinedScore26 = computed(() => {
      const r = rankRefine.value;
      if (!r || !scoreRank.value) return null;
      const osr26 = scoreRank.value.oneScoreOneRank?.["2026"] || [];
      for (const [s, _c, cu] of osr26) {
        if (cu >= r.R25_final) return s;
      }
      return osr26.length ? osr26[osr26.length - 1][0] : null;
    });
    // 主查询 用的 26 分: 默认 ui.myScore (原始); toggle on 时 用 refinedScore26
    const queryScore26 = computed(() =>
      (ui.useRefinedQuery && refinedScore26.value != null) ? refinedScore26.value : ui.myScore);

    // 冲稳保区间 (响应顶部分数 + 等位基准 + 修正开关)
    // 启用 useRefinedQuery + rankRefine 时: 直接以 rankRefine.Y_final 为 anchor25, 不走 equivFromScore26 round-trip
    const cwb = computed(() => {
      if (!scoreRank.value) return null;
      const useRefined = ui.useRefinedQuery && rankRefine.value && rankRefine.value.Y_final != null;
      if (useRefined) {
        const Y = rankRefine.value.Y_final;
        const cfg = store.cwbRanges || DEFAULT_CWB_RANGES;
        const ranges = {
          chong: { scoreLow: Y + cfg.chong.lo, scoreHigh: Y + cfg.chong.hi, label: "冲" },
          wen:   { scoreLow: Y + cfg.wen.lo,   scoreHigh: Y + cfg.wen.hi,   label: "稳" },
          bao:   { scoreLow: Y + cfg.bao.lo,   scoreHigh: Y + cfg.bao.hi,   label: "保" },
        };
        for (const k of Object.keys(ranges)) {
          const r = ranges[k];
          r.rankHigh = rank25FromScore25(r.scoreLow,  scoreRank.value);
          r.rankLow  = rank25FromScore25(r.scoreHigh, scoreRank.value);
        }
        if (ranges.chong.rankHigh && ranges.wen.rankLow && ranges.chong.rankHigh < ranges.wen.rankLow - 1) ranges.chong.rankHigh = ranges.wen.rankLow - 1;
        if (ranges.wen.rankHigh && ranges.bao.rankLow && ranges.wen.rankHigh < ranges.bao.rankLow - 1) ranges.wen.rankHigh = ranges.bao.rankLow - 1;
        return { equivScore25: Y, equivRank25: rankRefine.value.R25_final, ranges };
      }
      return computeChongWenBao(queryScore26.value, scoreRank.value, ui.equivSource, store.cwbRanges);
    });

    // 监听 cwb 变化 → 自动填充 3 段范围 (用户没手改时)
    // 用 snapshot 比对: 当前值 === 上次填的值 → 视为"未手改", 覆盖; 否则尊重用户手改, 跳过.
    // 注意 LS 持久化已经会恢复上次保存的 scoreRanges, 但那也是"上次自动填", 不是用户手改 — 用首帧 force-sync 覆盖.
    let lastAutoScoreRanges = null;
    let lastAutoRankRanges  = null;
    let cwbFirstFire = true;
    function sameRanges(a, b) {
      if (!a || !b || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (a[i].tier !== b[i].tier || a[i].low !== b[i].low || a[i].high !== b[i].high) return false;
      }
      return true;
    }
    watch(cwb, (val) => {
      if (!val) return;
      const r = val.ranges;
      const nextScore = [
        { tier: "chong", low: r.chong.scoreLow, high: r.chong.scoreHigh },
        { tier: "wen",   low: r.wen.scoreLow,   high: r.wen.scoreHigh },
        { tier: "bao",   low: r.bao.scoreLow,   high: r.bao.scoreHigh },
      ];
      // 首次 fire (页面加载后) → 强制覆盖 (LS 的旧值视为旧 auto-fill);
      // 后续 fire → 若当前 === 上次自动填, 覆盖; 否则尊重手改.
      const scoreUnchanged = cwbFirstFire
        ? true
        : !lastAutoScoreRanges
          ? (!store.filters.scoreRanges || !store.filters.scoreRanges.length)
          : sameRanges(store.filters.scoreRanges, lastAutoScoreRanges);
      if (scoreUnchanged) {
        store.filters.scoreRanges = nextScore;
        lastAutoScoreRanges = nextScore.map(x => ({ ...x }));
      }
      if (r.chong.rankLow != null) {
        const nextRank = [
          { tier: "chong", low: r.chong.rankLow, high: r.chong.rankHigh },
          { tier: "wen",   low: r.wen.rankLow,   high: r.wen.rankHigh },
          { tier: "bao",   low: r.bao.rankLow,   high: r.bao.rankHigh },
        ];
        const rankUnchanged = cwbFirstFire
          ? true
          : !lastAutoRankRanges
            ? (!store.filters.rankRanges || !store.filters.rankRanges.length)
            : sameRanges(store.filters.rankRanges, lastAutoRankRanges);
        if (rankUnchanged) {
          store.filters.rankRanges = nextRank;
          lastAutoRankRanges = nextRank.map(x => ({ ...x }));
        }
      }
      cwbFirstFire = false;
    }, { immediate: true });

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
        majors:  applyOv(priority.value.majors || [], ov.majors, "name"),
      };
    });

    // V9: 改用 'sort' 字段值过滤 (而非数组下标位置), 与 PriorityFilter 的 inRange 一致.
    // 用户在排名 sheet 用并列 (1,1,1...) 标同档, 必须按 sort 值才能正确包含所有并列项.
    // 合并用户手动 + 添加的 selectedSchools/Cities/MajorClasses (允许超出 range 的项).
    const allowedSets = computed(() => {
      if (!sortedPriority.value) return null;
      const f = store.filters;
      const sp = sortedPriority.value;
      const sLo = f.schoolPriorityRange[0] || 1;
      const sHi = f.schoolPriorityRange[1] || 99999;
      const schools = new Set(
        sp.schools.filter(s => s.sort != null && s.sort >= sLo && s.sort <= sHi)
                  .map(s => s.name)
      );
      if (f.selectedSchools && f.selectedSchools.size) {
        for (const n of f.selectedSchools) schools.add(n);
      }
      const cityMax = f.cityPriorityMax || 99999;
      const cities = new Set(
        sp.cities.filter(c => c.sort != null && c.sort <= cityMax).map(c => c.city)
      );
      if (f.selectedCities && f.selectedCities.size) {
        for (const n of f.selectedCities) cities.add(n);
      }
      const classMax = f.majorClassPriorityMax || 99999;
      const majorClasses = new Set(
        sp.majorClasses.filter(c => c.sort != null && c.sort <= classMax).map(c => c.name)
      );
      if (f.selectedMajorClasses && f.selectedMajorClasses.size) {
        for (const n of f.selectedMajorClasses) majorClasses.add(n);
      }
      return { schools, cities, majorClasses };
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
      // voluntary 视图: 用志愿单 array 作为数据源 + 应用 voluntaryKeyword
      if (store.viewMode === "voluntary") {
        const m = planByIdMap.value;
        let arr = voluntary.value.map(id => m[id]).filter(Boolean);
        arr = applyKeywordFilter(arr, store.voluntaryKeyword);
        // V9: 顶部冲稳保 tag 也筛志愿表 (与主表/聚合表一致)
        if (activeTier.value && cwb.value) {
          arr = arr.filter(p => planTierRelaxed(p, cwb.value) === activeTier.value);
        }
        return arr;
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
      for (const id of voluntary.value) {
        const p = m[id];
        if (!p) continue;
        const t = planTier(p, cwb.value);
        if (t) c[t]++;
      }
      return c;
    });
    // V9: 志愿分析
    // 锚点: 用户 25 等位分 (从 myScore 26 自动转, 也可在 modal 手调 ui.analysisAnchor25)
    // tier 规则 (用 plan.ref25Score 比 anchor25):
    //   冲: 25 等位分 +6 ~ +20
    //   稳: anchor25 -5 ~ +5
    //   保: anchor25 -20 ~ -6
    // 同时统计 26 计划人数 (enrollNum26 || enrollNum25)
    const voluntaryAnalysis = computed(() => {
      if (!scoreRank.value || !ui.myScore) return null;
      const autoAnchor = equiv25FromScore26(ui.myScore, scoreRank.value);
      // anchor25 优先级:
      //   1. ui.useRefinedQuery 开 + rankRefine 有效 → 用 rankRefine.Y_final (修正后)
      //   2. ui.analysisAnchor25 (用户手调)
      //   3. autoAnchor (默认从 26 分自动算)
      const refined = rankRefine.value;
      let anchor25;
      if (ui.useRefinedQuery && refined && refined.Y_final) {
        anchor25 = refined.Y_final;
      } else if (ui.analysisAnchor25 && ui.analysisAnchor25 > 0) {
        anchor25 = ui.analysisAnchor25;
      } else {
        anchor25 = autoAnchor;
      }
      if (!anchor25) return null;
      const m = planByIdMap.value;
      const items = [];
      for (const id of voluntary.value) {
        const p = m[id];
        if (!p) continue;
        const s25 = p.isStopped ? (p.score25 ?? null) : (p.ref25Score ?? null);
        const r25 = p.isStopped ? (p.rank25 ?? null) : (p.ref25Rank ?? null);
        const enroll = p.enrollNum26 || p.enrollNum25 || 0;
        items.push({ id, plan: p, score25: s25, rank25: r25, enroll });
      }
      // 冲稳保段偏移 (与主查询 / cwb 一致, 来自 store.cwbRanges, 默认 +6/+20/-5/+5/-20/-6)
      const cfg = store.cwbRanges || DEFAULT_CWB_RANGES;
      const ranges = {
        chong: { lo: anchor25 + cfg.chong.lo,  hi: anchor25 + cfg.chong.hi },
        wen:   { lo: anchor25 + cfg.wen.lo,    hi: anchor25 + cfg.wen.hi   },
        bao:   { lo: anchor25 + cfg.bao.lo,    hi: anchor25 + cfg.bao.hi   },
      };
      const tierOf = (s) => {
        if (s == null) return "out";
        if (s >= ranges.chong.lo && s <= ranges.chong.hi) return "chong";
        if (s >= ranges.wen.lo   && s <= ranges.wen.hi)   return "wen";
        if (s >= ranges.bao.lo   && s <= ranges.bao.hi)   return "bao";
        return "out";
      };
      const tiers = {
        chong: { items: [], enroll: 0, cnt26: 0, newItems: [], confirmedItems: [], newEnroll: 0, changedCount: 0 },
        wen:   { items: [], enroll: 0, cnt26: 0, newItems: [], confirmedItems: [], newEnroll: 0, changedCount: 0 },
        bao:   { items: [], enroll: 0, cnt26: 0, newItems: [], confirmedItems: [], newEnroll: 0, changedCount: 0 },
        out:   { items: [], enroll: 0, cnt26: 0, newItems: [], confirmedItems: [], newEnroll: 0, changedCount: 0 },
      };
      let totalEnroll = 0;
      for (const it of items) {
        const t = tierOf(it.score25);
        tiers[t].items.push(it);
        tiers[t].enroll += it.enroll;
        totalEnroll += it.enroll;
        // "不确定" = 新增专业 (无 25 历史参考); "变化" = 有改动 (仍有参考)
        const isNew = it.plan.isNew === "新增";
        const isChanged = !!it.plan.diff && !isNew;
        if (isNew) {
          tiers[t].newItems.push(it);
          tiers[t].newEnroll += it.enroll;
        } else {
          tiers[t].confirmedItems.push(it);
        }
        if (isChanged) tiers[t].changedCount++;
      }
      // 按分数分布 (含 gap)
      const scoreMap = new Map();   // score → { count, enroll, items }
      for (const it of items) {
        if (it.score25 == null) continue;
        const r = scoreMap.get(it.score25) || { count: 0, enroll: 0, items: [] };
        r.count++; r.enroll += it.enroll;
        r.items.push(it);
        scoreMap.set(it.score25, r);
      }
      const lo = Math.min(ranges.bao.lo, ...[...scoreMap.keys(), Infinity]);
      const hi = Math.max(ranges.chong.hi, ...[...scoreMap.keys(), -Infinity]);
      // 用于查 2026 一分一段 本分人数 + 累计人数 (按 26 score)
      const osr26 = scoreRank.value?.oneScoreOneRank?.["2026"];
      const cnt26Map = new Map();    // 26 score → 本分人数
      const cum26Map = new Map();    // 26 score → 累计人数
      if (osr26) for (const [sc, cnt, cum] of osr26) {
        cnt26Map.set(sc, cnt);
        cum26Map.set(sc, cum);
      }
      // 用户 26 位次 anchor (可手调, 例: 用户 myRank=8324 但想用 8150 做实际预测)
      // 优先级: useRefinedQuery → rankRefine.R25_final / analysisAnchorRank26 / ui.myRank
      let userRank26;
      if (ui.useRefinedQuery && refined && refined.R25_final) {
        userRank26 = refined.R25_final;
      } else if (ui.analysisAnchorRank26 && ui.analysisAnchorRank26 > 0) {
        userRank26 = ui.analysisAnchorRank26;
      } else {
        userRank26 = ui.myRank;
      }
      // anchor 的 25 位次 (用于 Δ 计算 + admit prob)
      // useRefinedQuery 启用 + rankRefine 可用 → 直接用 R25_final (与 cwb / userRank25Anchor 保持一致)
      const anchorRank25 = (ui.useRefinedQuery && refined && refined.R25_final != null)
        ? refined.R25_final
        : rank25FromScore25(anchor25, scoreRank.value);
      const byScore = [];
      for (let s = hi; s >= lo; s--) {
        const r = scoreMap.get(s) || { count: 0, enroll: 0, items: [] };
        const eq = equivFromScore25(s, scoreRank.value);
        const cnt26 = (eq.score26 != null) ? (cnt26Map.get(eq.score26) ?? null) : null;
        const cum26 = (eq.score26 != null) ? (cum26Map.get(eq.score26) ?? null) : null;
        const ratio = (r.enroll > 0 && cnt26 > 0) ? r.enroll / cnt26 : null;
        // 加权同分: 用户在 S26 内的"竞争对手数"
        //   累计 X = cum26; 本分 N = cnt26; 用户位次 R = userRank26
        //   R ≤ X - N  (用户超越该分)        → 加权 = 1 (录取近似 100%)
        //   X-N < R ≤ X (用户与该分同分)     → 加权 = R - (X - N)
        //   R > X      (用户低于该分)         → 加权 = N (全员竞争)
        let weightedCnt = null, weightedRatio = null;
        if (cnt26 != null && cum26 != null && userRank26 > 0) {
          const start = cum26 - cnt26;
          if (userRank26 <= start) weightedCnt = 1;
          else if (userRank26 <= cum26) weightedCnt = Math.max(1, userRank26 - start);
          else weightedCnt = cnt26;
          if (r.enroll > 0) weightedRatio = r.enroll / weightedCnt;
        }
        const tier = tierOf(s);
        // 25 年口径 Δ: row.score 与 anchor25 的差; row 25 位次 与 anchor 25 位次的差
        // 约定 正=上冲 (分高/位次更靠前); 负=下保 (分低/位次更靠后)
        const rowRank25 = rank25FromScore25(s, scoreRank.value);
        const deltaScore = anchor25 != null ? (s - anchor25) : null;
        const deltaRank  = (anchorRank25 != null && rowRank25 != null) ? (anchorRank25 - rowRank25) : null;
        byScore.push({
          score: s, count: r.count, enroll: r.enroll, items: r.items, tier,
          equiv26: eq.score26, equiv26Rank: eq.rank26,
          cnt26, cum26, weightedCnt, ratio, weightedRatio,
          rank25: rowRank25, deltaScore, deltaRank,
        });
        if (tier !== "out" && cnt26 != null) {
          tiers[tier].cnt26 += cnt26;
          if (weightedCnt != null) tiers[tier].weightedCnt = (tiers[tier].weightedCnt || 0) + weightedCnt;
        }
      }
      for (const k of ["chong", "wen", "bao", "out"]) {
        const t = tiers[k];
        t.ratio = (t.enroll > 0 && t.cnt26 > 0) ? t.enroll / t.cnt26 : null;
        t.weightedRatio = (t.enroll > 0 && t.weightedCnt > 0) ? t.enroll / t.weightedCnt : null;
      }
      // 按学校
      const schoolMap = new Map();
      for (const it of items) {
        const k = it.plan.schoolName;
        if (!schoolMap.has(k)) schoolMap.set(k, {
          name: k, count: 0, enroll: 0,
          tiers: { chong: 0, wen: 0, bao: 0, out: 0 },
          items: [],
        });
        const row = schoolMap.get(k);
        row.count++;
        row.enroll += it.enroll;
        row.tiers[tierOf(it.score25)]++;
        row.items.push(it);
      }
      const bySchool = Array.from(schoolMap.values()).sort((a, b) =>
        b.count - a.count || a.name.localeCompare(b.name));
      // Insights
      const insights = [];
      const total = items.length;
      if (paneTargets.value && total >= 10) {
        const tt = paneTargets.value;
        ["chong", "wen", "bao"].forEach(k => {
          const lbl = { chong: "冲", wen: "稳", bao: "保" }[k];
          const a = tiers[k].items.length;
          const t = tt[k] || 0;
          if (t > 0) {
            if (a < Math.max(1, Math.round(t * 0.6))) {
              insights.push({ level: "warn", text: `${lbl} 档 ${a} 项, 明显低于目标 ${t}, 建议补 ${t - a} 项` });
            } else if (a > Math.round(t * 1.4)) {
              insights.push({ level: "info", text: `${lbl} 档 ${a} 项, 超目标 ${t}, 可酌情删减` });
            }
          }
        });
      }
      if (tiers.out.items.length) {
        insights.push({ level: "warn", text: `${tiers.out.items.length} 项不在 冲/稳/保 任何范围 (按本分析规则); 考虑剔除或调整` });
      }
      // 分数 gap
      let gapStart = null, gaps = [];
      for (const r of byScore) {
        if (r.count === 0) { if (gapStart == null) gapStart = r.score; }
        else { if (gapStart != null) {
            const len = gapStart - r.score;
            if (len >= 3) gaps.push({ from: gapStart, to: r.score + 1, len });
            gapStart = null;
        }}
      }
      if (gaps.length) {
        const top = gaps.slice(0, 3).map(g => `${g.to}-${g.from} (${g.len} 分空白)`).join("、");
        insights.push({ level: "info", text: `分数空档: ${top}; 可考虑补志愿填空` });
      }
      const heavy = bySchool.filter(s => s.count >= 5);
      if (heavy.length) {
        insights.push({ level: "warn", text: `单校扎堆: ${heavy.map(s => `${s.name}(${s.count})`).join("、")}; 单校录取被限,建议分散` });
      }
      if (total < 30) insights.push({ level: "warn", text: `志愿总数 ${total} 偏少; 辽宁物理类常见 80-112` });
      else if (total > 120) insights.push({ level: "info", text: `志愿总数 ${total} 偏多; 注意每条质量` });
      if (tiers.chong.items.length > tiers.bao.items.length * 2 && tiers.bao.items.length > 0) {
        insights.push({ level: "warn", text: `冲 ${tiers.chong.items.length} > 保 ${tiers.bao.items.length} × 2, 风险偏高, 建议加保档` });
      }
      if (!tiers.bao.items.length && total > 0) {
        insights.push({ level: "danger", text: `保档为空! 极高风险, 必须补充保底志愿` });
      }
      // 计划人数维度
      if (totalEnroll && tiers.bao.enroll < totalEnroll * 0.15) {
        insights.push({ level: "warn", text: `保档 26 计划人数仅 ${tiers.bao.enroll} (占 ${(tiers.bao.enroll/totalEnroll*100).toFixed(0)}%), 保底名额偏少` });
      }
      // 给每个 item 算 录取率 + 转专业风险 + Δ (vs anchor)
      const _tSet = transferTargetSet.value;
      const _aSet = transferAcceptSet.value;
      for (const it of items) {
        it.admit = computeAdmitProb(it.plan, { userRank25: anchorRank25, scoreRank: scoreRank.value, supplyMap: supplyMap.value, ignoreHeat: !!ui.analysisIgnoreHeat });
        it.transfer = classifyTransfer(it.plan, _tSet, _aSet);
        // Δ 用 byScore 同 convention: + = 冲 (plan 比你强), - = 保 (plan 比你弱)
        //   Δ分   = plan ref25Score - anchor25
        //   Δ位次 = anchor25 位次 - plan ref25Rank
        it.delta = {
          score: (it.score25 != null && anchor25 != null) ? (it.score25 - anchor25) : null,
          rank:  (it.rank25 != null && anchorRank25 != null) ? (anchorRank25 - it.rank25) : null,
        };
      }
      // 转专业 汇总
      const transferSummary = { ok: [], warn: [], error: [] };
      for (const it of items) {
        if (it.transfer && transferSummary[it.transfer.level]) {
          transferSummary[it.transfer.level].push(it);
        }
      }
      // bySchool 加 maxAdmitProb (该校所有志愿中预测录取率的最大值)
      // 含 (估) 也算; 没有 admit.prob 的项跳过. 用于"被该校录取的概率"近似.
      for (const s of bySchool) {
        let maxP = null, maxIt = null;
        for (const it of s.items) {
          const p = it.admit?.prob;
          if (p == null) continue;
          if (maxP == null || p > maxP) { maxP = p; maxIt = it; }
        }
        s.maxAdmitProb = maxP;
        s.maxAdmitItem = maxIt;
      }
      // 各档 录取率 Top 3 (排除 prob 为空)
      const topByTier = {};
      for (const k of ["chong", "wen", "bao"]) {
        const list = (tiers[k].items || []).filter(it => it.admit?.prob != null)
          .sort((a, b) => b.admit.prob - a.admit.prob);
        topByTier[k] = list.slice(0, 3);
      }
      // 多阈值最有可能录取的 Top 5 (平行志愿首 N 个 prob >= 阈值, 含原序号)
      const TOPN_THRESHOLDS = [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80];
      const topByThreshold = TOPN_THRESHOLDS.map(T => ({
        threshold: T,
        items: items
          .map((it, i) => ({ ...it, idx: i + 1 }))
          .filter(it => it.admit?.prob != null && it.admit.prob >= T)
          .slice(0, 5),
      }));

      // 按 城市 聚合
      const cityMap = new Map();
      for (const it of items) {
        const c = it.plan.city || "(未知)";
        if (!cityMap.has(c)) cityMap.set(c, {
          name: c, count: 0, enroll: 0,
          tiers: { chong: 0, wen: 0, bao: 0, out: 0 },
          schools: new Set(),
          items: [],
        });
        const row = cityMap.get(c);
        row.count++;
        row.enroll += it.enroll;
        row.tiers[tierOf(it.score25)]++;
        row.schools.add(it.plan.schoolName);
        row.items.push(it);
      }
      const byCity = Array.from(cityMap.values()).sort((a, b) =>
        b.count - a.count || a.name.localeCompare(b.name));
      for (const r of byCity) {
        r.schoolCount = r.schools.size;
        delete r.schools;
        let maxP = null, maxIt = null;
        for (const it of r.items) {
          const p = it.admit?.prob;
          if (p == null) continue;
          if (maxP == null || p > maxP) { maxP = p; maxIt = it; }
        }
        r.maxAdmitProb = maxP;
        r.maxAdmitItem = maxIt;
      }

      // 按 报考专业 聚合 (用 mainName 收敛同主名不同备注变体)
      const majorMap = new Map();
      for (const it of items) {
        const fullName = it.plan.majorName26 || it.plan.majorName25 || "(未知)";
        const mn = mainNameOf(fullName) || fullName;
        if (!majorMap.has(mn)) majorMap.set(mn, {
          name: mn,
          count: 0, enroll: 0,
          tiers: { chong: 0, wen: 0, bao: 0, out: 0 },
          schools: new Set(),
          items: [],
        });
        const row = majorMap.get(mn);
        row.count++;
        row.enroll += it.enroll;
        row.tiers[tierOf(it.score25)]++;
        row.schools.add(it.plan.schoolName);
        row.items.push(it);
      }
      const byMajor = Array.from(majorMap.values()).sort((a, b) =>
        b.count - a.count || a.name.localeCompare(b.name));
      for (const r of byMajor) {
        r.schoolCount = r.schools.size;
        delete r.schools;
        let maxP = null, maxIt = null;
        for (const it of r.items) {
          const p = it.admit?.prob;
          if (p == null) continue;
          if (maxP == null || p > maxP) { maxP = p; maxIt = it; }
        }
        r.maxAdmitProb = maxP;
        r.maxAdmitItem = maxIt;
        // 该主名 转专业类别 (取主名直接 vs target/accept)
        r.inTarget = transferTargetSet.value.has(r.name);
        r.inAccept = !r.inTarget && transferAcceptSet.value.has(r.name);
      }
      // V9: 招生维度分数聚合 (全 2026 plans, 在冲稳保整体范围内 [bao.lo, chong.hi])
      // 例: 25 分 618, 今年所有学校在 618 上招的总计划 + 来源 plans
      const allLo = ranges.bao.lo, allHi = ranges.chong.hi;
      const enrollMap = new Map();
      for (const p of store.allPlans) {
        const s25 = p.isStopped ? p.score25 : p.ref25Score;
        if (s25 == null || s25 < allLo || s25 > allHi) continue;
        const enroll = p.enrollNum26 || 0;
        if (!enroll) continue;
        if (!enrollMap.has(s25)) enrollMap.set(s25, { enroll: 0, plans: [], schools: new Set() });
        const r = enrollMap.get(s25);
        r.enroll += enroll;
        r.plans.push(p);
        r.schools.add(p.schoolName);
      }
      const enrollByScore25 = [];
      for (let s = allHi; s >= allLo; s--) {
        const r = enrollMap.get(s);
        const eq = equivFromScore25(s, scoreRank.value);
        enrollByScore25.push({
          score25: s,
          tier: tierOf(s),
          equiv26: eq.score26,
          enroll: r?.enroll || 0,
          schools: r ? r.schools.size : 0,
          plans: r?.plans || [],
        });
      }
      // 25→26 招生人数 变化 (按 25 等位分 1 分一档 + 区间聚合)
      // 每档: 25/26 名额, Δ总/中外/目标/其他, 含 plans 明细 (可展开)
      const enrollChangeMap = new Map();
      for (const p of store.allPlans) {
        const s25 = p.ref25Score ?? p.score25;
        if (s25 == null) continue;
        const n25 = p.enrollNum25 || 0;
        const n26 = p.enrollNum26 || 0;
        if (!n25 && !n26) continue;
        if (!enrollChangeMap.has(s25)) {
          enrollChangeMap.set(s25, {
            score25: s25, n25: 0, n26: 0,
            n25_zwhz: 0, n26_zwhz: 0,
            n25_target: 0, n26_target: 0,
            n25_other: 0, n26_other: 0,
            plans: [],
          });
        }
        const r = enrollChangeMap.get(s25);
        r.n25 += n25; r.n26 += n26;
        const isZ = (p.majorName26 || "").includes("中外合作办学");
        if (isZ) { r.n25_zwhz += n25; r.n26_zwhz += n26; }
        const tr = classifyTransfer(p, _tSet, _aSet);
        const cat = (tr.level === "ok" || tr.level === "warn") ? "target" : "other";
        if (cat === "target") { r.n25_target += n25; r.n26_target += n26; }
        else { r.n25_other += n25; r.n26_other += n26; }
        r.plans.push({
          schoolName: p.schoolName, majorName: p.majorName26 || p.majorName25,
          n25, n26, delta: n26 - n25,
          isZ, isTarget: cat === "target",
          isNew: p.isNew === "新增",
          isStopped: !!p.isStopped,
        });
      }
      const enrollChangeByScore25 = Array.from(enrollChangeMap.values())
        .map(r => ({
          ...r,
          delta: r.n26 - r.n25,
          delta_zwhz: r.n26_zwhz - r.n25_zwhz,
          delta_target: r.n26_target - r.n25_target,
          delta_other: r.n26_other - r.n25_other,
        }))
        .sort((a, b) => b.score25 - a.score25);

      // 区间聚合 (20 分一段, 与 anchor25 对齐)
      function bucketEnrollChange(rowsByScore, bucketSize, anchorScore) {
        const center = anchorScore || 600;
        const align = Math.floor(center / bucketSize) * bucketSize;
        const buckets = new Map();
        for (const r of rowsByScore) {
          const lo = Math.floor(r.score25 / bucketSize) * bucketSize;
          // 对齐到 anchor: 比如 anchor=618, bucket=20, align=600 → buckets at 600,620,640,...
          //   lo = floor(618/20)*20 = 600 — 618 落在 600-619 桶
          //   lo = floor(620/20)*20 = 620 — 620 落在 620-639 桶
          const key = lo;
          if (!buckets.has(key)) {
            buckets.set(key, {
              lo, hi: lo + bucketSize - 1,
              n25: 0, n26: 0,
              n25_zwhz: 0, n26_zwhz: 0,
              n25_target: 0, n26_target: 0,
              n25_other: 0, n26_other: 0,
              rows: [],
              containsAnchor: false,
            });
          }
          const b = buckets.get(key);
          b.n25 += r.n25; b.n26 += r.n26;
          b.n25_zwhz += r.n25_zwhz; b.n26_zwhz += r.n26_zwhz;
          b.n25_target += r.n25_target; b.n26_target += r.n26_target;
          b.n25_other += r.n25_other; b.n26_other += r.n26_other;
          b.rows.push(r);
          if (anchorScore != null && r.score25 === anchorScore) b.containsAnchor = true;
        }
        return Array.from(buckets.values())
          .map(b => ({
            ...b,
            delta: b.n26 - b.n25,
            delta_zwhz: b.n26_zwhz - b.n25_zwhz,
            delta_target: b.n26_target - b.n25_target,
            delta_other: b.n26_other - b.n25_other,
          }))
          .sort((a, b) => b.lo - a.lo);
      }
      const enrollChangeBucket20 = bucketEnrollChange(enrollChangeByScore25, 20, anchor25);
      const enrollChangeBucket10 = bucketEnrollChange(enrollChangeByScore25, 10, anchor25);

      // 按学校 25→26 招生变化 (仅 985/211/双一流/省重点)
      const TIER_KEYS = ["985", "211", "双一流", "省重点"];
      const isTargetTier = (tag) => {
        if (!tag) return false;
        return TIER_KEYS.some(k => tag.includes(k));
      };
      const schoolEcMap = new Map();
      for (const p of store.allPlans) {
        if (!isTargetTier(p.schoolTag)) continue;
        const n25 = p.enrollNum25 || 0;
        const n26 = p.enrollNum26 || 0;
        const key = p.schoolName;
        if (!schoolEcMap.has(key)) {
          schoolEcMap.set(key, {
            schoolName: key,
            schoolTag: p.schoolTag,
            city: p.city,
            schoolRank: p.schoolRank ?? 9999,
            n25: 0, n26: 0,
            cnt25: 0, cnt26: 0,
            cntNew: 0, cntStopped: 0, cntZwhz: 0,
            plans: [],
          });
        }
        const r = schoolEcMap.get(key);
        r.n25 += n25; r.n26 += n26;
        if (n25 > 0) r.cnt25++;
        if (n26 > 0) r.cnt26++;
        if (p.isNew === "新增") r.cntNew++;
        if (p.isStopped) r.cntStopped++;
        if ((p.majorName26 || "").includes("中外合作办学")) r.cntZwhz++;
        r.plans.push({
          majorCode: p.majorCode26,
          majorName: p.majorName26 || p.majorName25,
          n25, n26,
          delta: n26 - n25,
          isNew: p.isNew === "新增",
          isStopped: !!p.isStopped,
          isZ: (p.majorName26 || "").includes("中外合作办学"),
        });
      }
      const enrollChangeBySchool = Array.from(schoolEcMap.values())
        .map(r => ({
          ...r,
          delta: r.n26 - r.n25,
          deltaPct: r.n25 > 0 ? (r.n26 - r.n25) / r.n25 : (r.n26 > 0 ? 1 : 0),
        }))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (a.schoolRank - b.schoolRank));

      return {
        items, tiers, byScore, bySchool, byMajor, byCity, ranges, enrollByScore25,
        enrollChangeByScore25, enrollChangeBucket20, enrollChangeBucket10,
        enrollChangeBySchool,
        my26: ui.myScore, autoAnchor25: autoAnchor, anchor25, anchorRank25,
        myRank26: ui.myRank, userRank26,
        total, totalEnroll, insights, transferSummary,
        topByTier, topByThreshold,
      };
    });
    // 志愿单 HTML 导出 (志愿填报标准 6 列格式)
    async function exportVoluntaryHtml() {
      if (!voluntary.value.length) { alert("志愿单为空"); return; }
      let templateHtml;
      try {
        const resp = await fetch("assets/voluntary_template.html");
        templateHtml = await resp.text();
      } catch (e) {
        alert("无法加载导出模板: " + e.message);
        return;
      }
      const m = planByIdMap.value;
      const items = voluntary.value.map(id => m[id]).filter(Boolean);
      const dt = new Date();
      const dateStr = `${dt.getFullYear()}_${dt.getMonth()+1}_${dt.getDate()}_${dt.getHours()}_${dt.getMinutes()}_${dt.getSeconds()}`;
      const esc = s => String(s ?? "").replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
      // 解析模板, 替换 tbody 与 title
      const parser = new DOMParser();
      const doc = parser.parseFromString(templateHtml, "text/html");
      const tbody = doc.querySelector(".el-table__body-wrapper tbody");
      if (!tbody) { alert("模板格式不对"); return; }
      const TOTAL = 112;
      const buildRow = (i, p) => {
        const serial = i + 1;
        const sCode = p ? esc(p.schoolCode || '') : '';
        const sName = p ? esc(p.schoolName || '') : '';
        const mCode = p ? esc(p.majorCode26 || '') : '';
        const mName = p ? esc(p.majorName26 || p.majorName25 || '') : '';
        const rem   = p ? esc(p.remarks || '') : '';
        return `<tr class="el-table__row">`
          + `<td rowspan="1" colspan="1" class="el-table_6_column_42 is-center indexColumnStyle "><div class="cell">\n          ${serial}\n        </div></td>`
          + `<td rowspan="1" colspan="1" class="el-table_6_column_43 is-center  "><div class="cell"><!----> <div data-v-107f0f56="" class="" style="min-height: 23px;">\n            ${sCode}\n          </div> <!----></div></td>`
          + `<td rowspan="1" colspan="1" class="el-table_6_column_44 is-center  "><div class="cell">${sName}</div></td>`
          + `<td rowspan="1" colspan="1" class="el-table_6_column_45 is-center  "><div class="cell"><!----> <div data-v-107f0f56="" class="" style="min-height: 23px;">\n            ${mCode}\n          </div> <!----></div></td>`
          + `<td rowspan="1" colspan="1" class="el-table_6_column_46 is-center  "><div class="cell">${mName}</div></td>`
          + `<td rowspan="1" colspan="1" class="el-table_6_column_47 is-center  "><div class="cell el-tooltip" style="width: 185px;">${rem}</div></td>`
          + `</tr>`;
      };
      let rowsHtml = "";
      for (let i = 0; i < TOTAL; i++) rowsHtml += buildRow(i, items[i]);
      tbody.innerHTML = rowsHtml;
      // 序列化输出
      const out = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
      const blob = new Blob([out], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      const safeName = (store.activeVoluntaryName || "志愿").replace(/[\/\\:*?"<>|]/g, "_");
      a.download = `${safeName}_${dateStr}.html`;
      a.click();
      URL.revokeObjectURL(url);
    }

    // V9: JSON 导出 (含 plan id + 学校/专业 元数据 + pinned 列表; 可跨设备/版本导入)
    function exportVoluntaryJson() {
      if (!voluntary.value.length) { alert("志愿单为空"); return; }
      const m = planByIdMap.value;
      const data = {
        version: 1,
        name: store.activeVoluntaryName,
        exportedAt: new Date().toISOString().slice(0, 10),
        count: voluntary.value.length,
        plans: voluntary.value.map(id => {
          const p = m[id];
          return {
            id,
            schoolName: p?.schoolName ?? null,
            schoolCode: p?.schoolCode ?? null,
            majorName: p?.majorName26 || p?.majorName25 || null,
            ref25Score: p?.ref25Score ?? null,
          };
        }),
        pinned: [...pinnedIdsOfActive()],
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `志愿_${store.activeVoluntaryName}_${data.exportedAt}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }

    // V9: JSON 导入 (文件选择 → 解析 → 选 合并/替换/新建)
    function importVoluntaryJson() {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.onchange = async (ev) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        let data;
        try {
          const text = await file.text();
          data = JSON.parse(text);
        } catch (e) { alert("JSON 解析失败: " + e.message); return; }
        if (!data || !Array.isArray(data.plans)) {
          alert("格式不对: 缺少 plans 数组"); return;
        }
        // 匹配每个 plan: 优先 id, 兜底学校+专业
        const m = planByIdMap.value;
        const allPlans = store.allPlans;
        const matchedIds = [];
        const unmatched = [];
        for (const item of data.plans) {
          let id = null;
          if (item.id && m[item.id]) id = item.id;
          if (!id && item.schoolName && item.majorName) {
            const found = allPlans.find(p =>
              p.schoolName === item.schoolName &&
              (p.majorName26 === item.majorName || p.majorName25 === item.majorName));
            if (found) id = found.id;
          }
          if (id && !matchedIds.includes(id)) matchedIds.push(id);
          else if (!id) unmatched.push(`${item.schoolName || '?'} · ${item.majorName || '?'}`);
        }
        if (!matchedIds.length) {
          alert(`未匹配到任何 plan (${data.plans.length} 项全部缺失). 数据版本可能不一致.`);
          return;
        }
        const summary = `导入 "${data.name || '未命名'}" — 匹配 ${matchedIds.length} 项${unmatched.length ? `, 未匹配 ${unmatched.length} 项` : ''}.`
          + (unmatched.length ? `\n未匹配前几项:\n  ${unmatched.slice(0, 5).join('\n  ')}${unmatched.length > 5 ? '\n  ...' : ''}` : '')
          + `\n\n选择导入方式 (输入数字):\n  1. 合并到当前 "${store.activeVoluntaryName}" (去重)\n  2. 替换当前 "${store.activeVoluntaryName}"\n  3. 新建志愿单 "${data.name || '导入志愿'}"`;
        const mode = prompt(summary, "1");
        if (!mode) return;
        if (mode === "1") {
          const wasEmpty = voluntary.value.length === 0;
          const cur = [...voluntary.value];
          let added = 0;
          for (const id of matchedIds) {
            if (!cur.includes(id)) { cur.push(id); added++; }
          }
          voluntary.value = cur;
          if (wasEmpty) {
            // 空表 → 锁定源顺序
            setPinnedActive([...matchedIds]); setPendingActive([]); clearBackupActive();
            alert(`合并完成: 新增 ${added} 项 (源顺序已锁定 📌, 共 ${matchedIds.length} 项)`);
          } else {
            runAutoSort();
            alert(`合并完成: 新增 ${added} 项 (${matchedIds.length - added} 项已存在跳过), 按 26 等位次排序`);
          }
        } else if (mode === "2") {
          // 替换: 源顺序 + 全部锁定
          voluntary.value = [...matchedIds];
          setPinnedActive([...matchedIds]);
          setPendingActive([]);
          clearBackupActive();
          alert(`替换完成: ${matchedIds.length} 项 (源顺序已锁定 📌)`);
        } else if (mode === "3") {
          // 新建: 源顺序 + 全部锁定 (先 set pinned, 再切换 active 防止 watcher 自动重排)
          let name = data.name || '导入志愿';
          let i = 1;
          while (store.voluntaryLists[name]) { name = `${data.name || '导入志愿'} (${i++})`; }
          store.voluntaryPinned = { ...store.voluntaryPinned, [name]: [...matchedIds] };
          store.voluntaryLists  = { ...store.voluntaryLists, [name]: [...matchedIds] };
          store.activeVoluntaryName = name;
          alert(`新建志愿单 "${name}": ${matchedIds.length} 项 (源顺序已锁定 📌)`);
        } else {
          alert("取消导入");
        }
      };
      input.click();
    }

    // ---- 辽宁招生考试网 HTML 志愿表 导入 ----
    // 文件结构: 3 张 el-table 表 (普通本科 / 特殊批次 / 高校专项 等)
    // 每行 td 类似 `el-table_NNN_column_MMM` (列 id); thead 给出列名映射
    // 第 1 张表 院校 cells 跨 4 行 (rowspan=4), 续行只有 专业 cells; 第 2-3 张 1 行 1 项
    function parseLnVolHtml(htmlText) {
      const doc = new DOMParser().parseFromString(htmlText, "text/html");
      const out = [];
      const cellText = (td) => {
        if (!td) return "";
        // 院校代号/专业代号: 嵌套 <div style="min-height: 23px;"> 内
        const inner = td.querySelector('div.cell > div[style*="min-height"]');
        if (inner) {
          const t = inner.textContent.replace(/\s+/g, "").trim();
          if (t) return t;
        }
        const cell = td.querySelector("div.cell");
        return cell ? cell.textContent.replace(/\s+/g, " ").trim() : "";
      };
      const colKey = (el) => {
        const cls = (el.className || "").split(/\s+/);
        return cls.find(c => /^el-table_\d+_column_/.test(c)) || "";
      };
      const tables = doc.querySelectorAll(".el-table__body-wrapper table.el-table__body");
      for (const tbl of tables) {
        // header map: colKey → 标签 (序号/院校代号/院校名称/专业代号/专业名称/专业备注/专业服从志愿)
        const headerMap = {};
        const headerTbl = tbl.closest(".el-table")?.querySelector(".el-table__header-wrapper table.el-table__header");
        if (headerTbl) {
          headerTbl.querySelectorAll("thead > tr > th").forEach(th => {
            const k = colKey(th);
            const lbl = (th.querySelector("div.cell")?.textContent || "").trim();
            if (k && lbl) headerMap[k] = lbl;
          });
        }
        if (!Object.values(headerMap).some(v => v === "院校名称")) continue; // 非志愿表
        let curSchool = { code: "", name: "" };
        const rows = tbl.querySelectorAll("tbody > tr");
        for (const tr of rows) {
          const tds = [...tr.querySelectorAll("td")];
          const data = { 序号: "", 院校代号: "", 院校名称: "", 专业代号: "", 专业名称: "", 专业备注: "" };
          for (const td of tds) {
            const lbl = headerMap[colKey(td)];
            if (!lbl) continue;
            const v = cellText(td);
            if (v) data[lbl] = v;
          }
          if (data.院校代号) curSchool.code = data.院校代号;
          if (data.院校名称) curSchool.name = data.院校名称;
          if (!data.院校代号 && curSchool.code) data.院校代号 = curSchool.code;
          if (!data.院校名称 && curSchool.name) data.院校名称 = curSchool.name;
          // 跳过纯占位 (无院校无专业)
          if (!data.院校名称 || (!data.专业代号 && !data.专业名称)) continue;
          out.push({
            schoolCode: data.院校代号 || "",
            schoolName: data.院校名称 || "",
            majorCode:  data.专业代号 || "",
            majorName:  data.专业名称 || "",
            remarks:    data.专业备注 || "",
          });
        }
      }
      return out;
    }

    function matchLnEntries(entries) {
      const all = store.allPlans;
      const bySchoolName = new Map();
      for (const p of all) {
        if (!bySchoolName.has(p.schoolName)) bySchoolName.set(p.schoolName, []);
        bySchoolName.get(p.schoolName).push(p);
      }
      const matched = [];
      const unmatched = [];
      for (const e of entries) {
        const cands = bySchoolName.get(e.schoolName) || [];
        let found = null;
        // 1. 同校 + 院校代号 + 专业代号 全等
        if (e.schoolCode && e.majorCode) {
          found = cands.find(p => p.schoolCode === e.schoolCode && p.majorCode26 === e.majorCode);
        }
        // 2. 同校 + 专业代号 (代号是该校内唯一)
        if (!found && e.majorCode) {
          found = cands.find(p => p.majorCode26 === e.majorCode);
        }
        // 3. 同校 + 专业名 完全一致 (含 26 或 25 名)
        if (!found && e.majorName) {
          found = cands.find(p => p.majorName26 === e.majorName || p.majorName25 === e.majorName);
        }
        // 4. 同校 + 主名 完全一致 (mainName 收敛)
        if (!found && e.majorName) {
          const eMain = mainNameOf(e.majorName);
          if (eMain) {
            found = cands.find(p => mainNameOf(p.majorName26 || p.majorName25) === eMain);
          }
        }
        if (found) matched.push({ entry: e, plan: found });
        else unmatched.push(e);
      }
      return { matched, unmatched };
    }

    function importLnVolHtml() {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".html,.htm,text/html";
      input.onchange = async (ev) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        let entries;
        try {
          const text = await file.text();
          entries = parseLnVolHtml(text);
        } catch (e) { alert("HTML 解析失败: " + e.message); return; }
        if (!entries.length) { alert("未在 HTML 中找到志愿条目. 文件格式可能不对."); return; }
        const { matched, unmatched } = matchLnEntries(entries);
        if (!matched.length) {
          alert(`解析出 ${entries.length} 条志愿, 但 0 条在数据库中匹配. 可能学校名差异.\n例: ${entries.slice(0, 3).map(e => e.schoolName + ' · ' + e.majorName).join('\n  ')}`);
          return;
        }
        // 去重保持顺序
        const matchedIds = [];
        const seen = new Set();
        for (const m of matched) {
          if (!seen.has(m.plan.id)) { matchedIds.push(m.plan.id); seen.add(m.plan.id); }
        }
        const unmatchedTxt = unmatched.length
          ? `\n未匹配 ${unmatched.length} 项:\n  ${unmatched.slice(0, 8).map(e => `[${e.schoolCode || '?'}] ${e.schoolName} · ${e.majorName}`).join('\n  ')}${unmatched.length > 8 ? '\n  ...' : ''}`
          : '';
        const summary =
          `📥 辽宁 HTML 志愿表 导入\n` +
          `解析 ${entries.length} 条, 匹配 ${matched.length} 条 (去重后 ${matchedIds.length} 个 plan)${unmatchedTxt}\n\n` +
          `导入方式 (输入数字):\n` +
          `  1. 合并到当前 "${store.activeVoluntaryName}" (去重)\n` +
          `  2. 替换当前 "${store.activeVoluntaryName}"\n` +
          `  3. 新建志愿单 "${file.name.replace(/\.html?$/i, '')}"`;
        const mode = prompt(summary, "3");
        if (!mode) return;
        if (mode === "1") {
          const wasEmpty = voluntary.value.length === 0;
          const cur = [...voluntary.value];
          let added = 0;
          for (const id of matchedIds) if (!cur.includes(id)) { cur.push(id); added++; }
          voluntary.value = cur;
          if (wasEmpty) {
            setPinnedActive([...matchedIds]); setPendingActive([]); clearBackupActive();
            alert(`合并完成: 新增 ${added} 项 (源顺序已锁定 📌, ${matchedIds.length} 项)`);
          } else {
            alert(`合并完成: 新增 ${added} 项 (${matchedIds.length - added} 项已存在跳过)`);
          }
        } else if (mode === "2") {
          voluntary.value = [...matchedIds];
          setPinnedActive([...matchedIds]); setPendingActive([]); clearBackupActive();
          alert(`替换完成: ${matchedIds.length} 项 (源顺序已锁定 📌)`);
        } else if (mode === "3") {
          let name = file.name.replace(/\.html?$/i, "") || "辽宁导入";
          let i = 1;
          while (store.voluntaryLists[name]) { name = `${file.name.replace(/\.html?$/i, "")} (${i++})`; }
          store.voluntaryPinned = { ...store.voluntaryPinned, [name]: [...matchedIds] };
          store.voluntaryLists  = { ...store.voluntaryLists, [name]: [...matchedIds] };
          store.activeVoluntaryName = name;
          alert(`新建志愿单 "${name}": ${matchedIds.length} 项 (源顺序已锁定 📌)`);
        } else { alert("取消导入"); }
      };
      input.click();
    }

    // ---- CSV 导入 / 导出 ----
    // CSV 标准格式: 序号,院校代号,院校名称,专业代号,专业名称,专业备注
    function csvEscape(v) {
      const s = String(v ?? "");
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    function exportVoluntaryCsv() {
      const ids = voluntary.value;
      if (!ids.length) { alert("当前志愿单为空"); return; }
      const m = planByIdMap.value;
      const header = ["序号", "院校代号", "院校名称", "专业代号", "专业名称", "专业备注"];
      const rows = [header.join(",")];
      ids.forEach((id, i) => {
        const p = m[id]; if (!p) return;
        rows.push([
          i + 1, p.schoolCode || "", p.schoolName || "",
          p.majorCode26 || "", p.majorName26 || p.majorName25 || "", p.remarks || "",
        ].map(csvEscape).join(","));
      });
      const csv = "﻿" + rows.join("\n");   // BOM 防 Excel 乱码
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `志愿单_${store.activeVoluntaryName}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
    function parseCsvText(text) {
      // 简单 CSV 解析 (支持双引号转义)
      const rows = [];
      let row = [], cell = "", inQuote = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuote) {
          if (c === '"') {
            if (text[i+1] === '"') { cell += '"'; i++; }
            else inQuote = false;
          } else cell += c;
        } else {
          if (c === '"') inQuote = true;
          else if (c === ",") { row.push(cell); cell = ""; }
          else if (c === "\r") { /* skip */ }
          else if (c === "\n") { row.push(cell); cell = ""; rows.push(row); row = []; }
          else cell += c;
        }
      }
      if (cell || row.length) { row.push(cell); rows.push(row); }
      return rows.filter(r => r.some(c => c.trim()));
    }
    function importVoluntaryCsv() {
      const input = document.createElement("input");
      input.type = "file"; input.accept = ".csv,text/csv";
      input.onchange = async (ev) => {
        const file = ev.target.files?.[0]; if (!file) return;
        let rows;
        try {
          let text = await file.text();
          if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
          rows = parseCsvText(text);
        } catch (e) { alert("CSV 解析失败: " + e.message); return; }
        if (rows.length < 2) { alert("CSV 行数不足 (需含表头 + 数据)"); return; }
        const header = rows[0].map(s => s.trim());
        const idx = {};
        ["院校代号", "院校名称", "专业代号", "专业名称", "专业备注"].forEach(k => {
          const i = header.indexOf(k); if (i >= 0) idx[k] = i;
        });
        if (idx["院校名称"] == null || (idx["专业名称"] == null && idx["专业代号"] == null)) {
          alert("CSV 表头缺必要列: 院校名称 + (专业名称 或 专业代号)"); return;
        }
        const entries = rows.slice(1).map(r => ({
          schoolCode: idx["院校代号"] != null ? (r[idx["院校代号"]] || "").trim() : "",
          schoolName: (r[idx["院校名称"]] || "").trim(),
          majorCode:  idx["专业代号"] != null ? (r[idx["专业代号"]] || "").trim() : "",
          majorName:  idx["专业名称"] != null ? (r[idx["专业名称"]] || "").trim() : "",
          remarks:    idx["专业备注"] != null ? (r[idx["专业备注"]] || "").trim() : "",
        })).filter(e => e.schoolName && (e.majorName || e.majorCode));
        const { matched, unmatched } = matchLnEntries(entries);
        if (!matched.length) { alert(`解析 ${entries.length} 条, 0 匹配 (校名差异?)`); return; }
        const matchedIds = []; const seen = new Set();
        for (const m of matched) if (!seen.has(m.plan.id)) { matchedIds.push(m.plan.id); seen.add(m.plan.id); }
        const summary = `📥 CSV 志愿表 导入\n解析 ${entries.length} 条, 匹配 ${matched.length} 条 (去重 ${matchedIds.length})`
          + (unmatched.length ? `\n未匹配 ${unmatched.length}:\n  ${unmatched.slice(0,5).map(e=>e.schoolName+'·'+e.majorName).join('\n  ')}` : "")
          + `\n\n导入方式:\n  1. 合并到 "${store.activeVoluntaryName}"\n  2. 替换 "${store.activeVoluntaryName}"\n  3. 新建`;
        const mode = prompt(summary, "3"); if (!mode) return;
        if (mode === "1") {
          const wasEmpty = voluntary.value.length === 0;
          const cur = [...voluntary.value]; let added = 0;
          for (const id of matchedIds) if (!cur.includes(id)) { cur.push(id); added++; }
          voluntary.value = cur;
          if (wasEmpty) {
            setPinnedActive([...matchedIds]); setPendingActive([]); clearBackupActive();
            alert(`合并完成: 新增 ${added} (源顺序已锁定 📌)`);
          } else {
            alert(`合并完成: 新增 ${added}`);
          }
        } else if (mode === "2") {
          voluntary.value = [...matchedIds];
          setPinnedActive([...matchedIds]); setPendingActive([]); clearBackupActive();
          alert(`替换完成: ${matchedIds.length} (源顺序已锁定 📌)`);
        } else if (mode === "3") {
          let name = file.name.replace(/\.csv$/i, "") || "CSV 导入";
          let i = 1; while (store.voluntaryLists[name]) name = `${file.name.replace(/\.csv$/i,'')} (${i++})`;
          store.voluntaryPinned = { ...store.voluntaryPinned, [name]: [...matchedIds] };
          store.voluntaryLists  = { ...store.voluntaryLists, [name]: [...matchedIds] };
          store.activeVoluntaryName = name;
          alert(`新建 "${name}": ${matchedIds.length} (源顺序已锁定 📌)`);
        }
      };
      input.click();
    }

    // ---- 辽宁招生考试网 HTML 模板化 导出 ----
    // 复用 assets/templates/ln_official.html 或 ln_prepick.html 作为模板:
    // 解析 DOM → 清空所有 tbody → 把当前 voluntary 填到 "普通类本科批" (official)
    // 或 单表 (prepick) → 序列化并下载. 保留 学生信息块 / 表头 / 样式 等原汁原味.
    async function exportLnVolHtml(mode) {
      const ids = voluntary.value;
      if (!ids.length) { alert("当前志愿单为空"); return; }
      const m = planByIdMap.value;
      const plans = ids.map(id => m[id]).filter(Boolean);
      const tplUrl = mode === "official" ? "assets/templates/ln_official.html" : "assets/templates/ln_prepick.html";
      let tplText;
      try {
        const resp = await fetch(tplUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        tplText = await resp.text();
      } catch (e) { alert("加载模板失败: " + e.message); return; }
      const doc = new DOMParser().parseFromString(tplText, "text/html");

      // 找所有 .el-table__body tbody, 找出 "普通类本科批" 对应的 tbody (official),
      // 或 唯一 tbody (prepick)
      const tables = [...doc.querySelectorAll(".el-table")];
      // 各 table 上方 sibling 是其 h2 title (.confirm-voluntary-title 或 <h2>)
      function findTitleFor(tbl) {
        // 向上找最近的祖先有 h2 兄弟
        let cur = tbl;
        for (let i = 0; i < 10 && cur; i++) {
          cur = cur.parentElement;
          if (!cur) break;
          // 找前置兄弟 h2
          let sib = cur.previousElementSibling;
          while (sib) {
            if (sib.tagName === "H2") return sib.textContent.trim();
            const inner = sib.querySelector?.("h2");
            if (inner) return inner.textContent.trim();
            sib = sib.previousElementSibling;
          }
          // 或 cur 本身前面有 h2
          const inner = cur.querySelector?.("h2");
          if (inner) return inner.textContent.trim();
        }
        return "";
      }

      // 清空所有 tbody (作为基线 — 然后只填目标批次)
      for (const tbl of tables) {
        const tbody = tbl.querySelector("tbody");
        if (tbody) tbody.innerHTML = "";
      }

      // 选目标 table: official → 标题含 "本科批" 且不含 "提前/专科/高职" 的那张
      let targetTbl = null;
      if (mode === "official") {
        for (const tbl of tables) {
          const title = findTitleFor(tbl);
          if (/本科批/.test(title) && !/提前|专科|高职/.test(title)) { targetTbl = tbl; break; }
        }
      }
      if (!targetTbl) targetTbl = tables[0];   // fallback (prepick 只 1 张; official 找不到也兜底)
      if (!targetTbl) { alert("模板不含 el-table"); return; }

      // 拿 header colKey → 列名
      const colKey = (el) => ((el.className || "").split(/\s+/).find(c => /^el-table_\d+_column_/.test(c)) || "");
      const headerMap = {};   // label → colKey
      const headerTbl = targetTbl.querySelector(".el-table__header-wrapper table.el-table__header");
      if (headerTbl) {
        headerTbl.querySelectorAll("thead > tr > th").forEach(th => {
          const k = colKey(th);
          const lbl = (th.querySelector("div.cell")?.textContent || "").trim();
          if (k && lbl) headerMap[lbl] = k;
        });
      }
      // 拿 第一个 th 的 data-v-* (用于生成嵌套 div 的 data-v 属性, 视觉一致)
      const sampleTh = headerTbl?.querySelector("th");
      let dataVAttr = "";
      if (sampleTh) {
        for (const attr of sampleTh.attributes) {
          if (attr.name.startsWith("data-v-")) { dataVAttr = attr.name; break; }
        }
      }

      const tbody = targetTbl.querySelector("tbody");
      if (!tbody) { alert("目标表无 tbody"); return; }

      // 工具: 生成 cell 字符串
      const dataV = dataVAttr ? ` ${dataVAttr}=""` : "";
      function cellHtml(label, value, stripeClass) {
        const ck = headerMap[label] || "";
        const cls = `${ck} is-center ${stripeClass || ""}`.trim();
        // 院校代号/专业代号 用嵌套 div (与模板一致)
        if (label === "院校代号" || label === "专业代号") {
          return `<td rowspan="1" colspan="1" class="${cls}"><div class="cell"><!----> <div${dataV} class="" style="min-height: 23px;">${value || ""}</div> <!----></div></td>`;
        }
        if (label === "专业备注") {
          return `<td rowspan="1" colspan="1" class="${cls}"><div class="cell el-tooltip" style="width: 155px;">${value || ""}</div></td>`;
        }
        if (label === "专业服从志愿") {
          return `<td rowspan="1" colspan="1" class="${cls}"><div class="cell">服从</div></td>`;
        }
        return `<td rowspan="1" colspan="1" class="${cls}"><div class="cell">${value || ""}</div></td>`;
      }

      // 渲染行
      const orderedLabels = ["序号", "院校代号", "院校名称", "专业代号", "专业名称", "专业备注", "专业服从志愿"]
        .filter(lbl => headerMap[lbl]);
      let html = "";
      plans.forEach((p, i) => {
        const stripe = i % 2 === 1 ? "stripe" : "";
        let tr = `<tr class="el-table__row">`;
        for (const lbl of orderedLabels) {
          let v = "";
          switch (lbl) {
            case "序号":       v = String(i + 1); break;
            case "院校代号":   v = p.schoolCode || ""; break;
            case "院校名称":   v = p.schoolName || ""; break;
            case "专业代号":   v = p.majorCode26 || ""; break;
            case "专业名称":   v = p.majorName26 || p.majorName25 || ""; break;
            case "专业备注":   v = p.remarks || ""; break;
            case "专业服从志愿": v = "服从"; break;
          }
          tr += cellHtml(lbl, v, stripe);
        }
        tr += `</tr>`;
        html += tr;
      });
      tbody.innerHTML = html;

      // 序列化下载
      const out = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
      const blob = new Blob([out], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:T]/g, "_").slice(0, 19);
      a.download = `志愿_${store.activeVoluntaryName}_${mode === "official" ? "官网" : "预选"}_${stamp}.html`;
      a.click();
      URL.revokeObjectURL(url);
    }

    // V9: 从其它志愿单合并 (in-app)
    function mergeFromOtherList() {
      const others = Object.keys(store.voluntaryLists).filter(n => n !== store.activeVoluntaryName);
      if (!others.length) { alert("没有其它志愿单可合并"); return; }
      const lines = others.map((n, i) => `  ${i+1}. ${n} (${(store.voluntaryLists[n] || []).length} 项)`).join('\n');
      const choice = prompt(`合并到当前 "${store.activeVoluntaryName}". 选择源:\n${lines}\n\n输入序号 1-${others.length}:`, "1");
      if (!choice) return;
      const idx = parseInt(choice, 10);
      if (!idx || idx < 1 || idx > others.length) { alert("无效序号"); return; }
      const srcName = others[idx - 1];
      const srcIds = store.voluntaryLists[srcName] || [];
      const cur = [...voluntary.value];
      let added = 0;
      for (const id of srcIds) {
        if (!cur.includes(id)) { cur.push(id); added++; }
      }
      voluntary.value = cur;
      runAutoSort();
      alert(`从 "${srcName}" 合并到 "${store.activeVoluntaryName}":\n  新增 ${added} 项 (${srcIds.length - added} 项已存在)`);
    }

    // 志愿单 CSV 导出 (按当前表实际顺序, 不分档分组)
    // V9: 严格保留 voluntary.value 顺序 (含 pinned 锁定位 + 自动排序). 档作为一列.
    function exportVoluntaryByTier() {
      if (!voluntary.value.length) { alert("志愿单为空"); return; }
      const m = planByIdMap.value;
      const sr = scoreRank.value;
      const equiv = (s25) => s25 != null && sr ? equivFromScore25(s25, sr) : { score26: null, rank26: null };
      const pinSet = pinnedSet.value;
      const pendSet = pendingSet.value;
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
      const lockOf = (id) => pinSet.has(id) ? "📌 锁定" : pendSet.has(id) ? "⏳ 待确认" : "自动";
      const tierLabel = { chong: "冲", wen: "稳", bao: "保" };
      const lines = ["志愿序号,档,锁定状态,26等位分,26等位次," + head.join(",")];
      voluntary.value.forEach((id, i) => {
        const p = m[id];
        if (!p) return;
        const t = cwb.value ? planTier(p, cwb.value) : null;
        const e = equiv(p.isStopped ? p.score25 : p.ref25Score);
        lines.push(
          `#${i + 1},${esc(tierLabel[t] || "")},${esc(lockOf(id))},${esc(e.score26)},${esc(e.rank26)},`
          + cols.map(c => esc(p[c])).join(",")
        );
      });
      const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `志愿单_${store.activeVoluntaryName}_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }

    // 🎯 推荐 (按 校+专业类 聚合, 含停招, 不限校/市)
    const recommendData = computed(() => {
      if (!cwb.value || !priority.value) return [];
      // 推荐用 filter 但 override 部分字段 (硬编码, 不受用户切换影响)
      // 关键词部分用 recommendKeyword (推荐视图独立)
      const rk = store.recommendKeyword;
      const overriddenFilters = {
        ...store.filters,
        includeStopped: true,        // 含停招 (统计需完整)
        includeMidOutside: false,    // 严格不含中外合作 (低分会拉偏平均)
        tuitionMax: 20000,           // 学费 ≤ 2 万
        keyword: rk.keyword,
        pickedSchool: rk.pickedSchool,
        pickedMajorClass: rk.pickedMajorClass,
        pickedMajorName: rk.pickedMajorName,
      };
      // allowed 不限学校/城市, majorClasses 保留用户设置
      const baseAllowed = allowedSets.value;
      const overriddenAllowed = baseAllowed ? {
        schools: null,
        cities: null,
        majorClasses: baseAllowed.majorClasses,
      } : null;
      let plans = applyFilters(store.allPlans, overriddenFilters, overriddenAllowed);
      // 停招行 applyFilters 默认绕过专业类过滤 (因 26 无 class); 推荐模式严格要求,
      // 用 25 字段 (majorClass25) 再过滤一遍, 排除医学/心理 等不在 Top N 类的停招行
      const allowedCls = overriddenAllowed && overriddenAllowed.majorClasses;
      if (allowedCls) {
        plans = plans.filter(p => {
          if (!p.isStopped) return true;
          const cls = p.majorClass || p.majorClass25;
          return cls && allowedCls.has(cls);
        });
      }

      // 按学校聚合
      const groups = new Map();
      for (const p of plans) {
        const key = p.schoolName;
        if (!groups.has(key)) {
          groups.set(key, {
            schoolName: p.schoolName,
            schoolCode: p.schoolCode,
            schoolTag: p.schoolTag,
            schoolRank: p.schoolRank,
            city: p.city,
            province: p.province,
            cityTier: p.cityTier,
            majorClassSet: new Set(),
            plans: [],
          });
        }
        const g = groups.get(key);
        g.plans.push(p);
        const cls = p.majorClass || p.majorClass25;
        if (cls) g.majorClassSet.add(cls);
      }

      const result = [];
      for (const g of groups.values()) {
        const planScoreRank = g.plans.map(p => ({
          score: p.isStopped ? p.score25 : p.ref25Score,
          rank:  p.isStopped ? p.rank25  : p.ref25Rank,
        })).filter(x => x.score != null);
        if (!planScoreRank.length) continue;

        const totalEnroll = g.plans.reduce(
          (s, p) => s + (p.enrollNum26 || p.enrollNum25 || 0), 0);
        // 按分数排序找 top/bottom
        const sorted = [...planScoreRank].sort((a, b) => b.score - a.score);
        const top = sorted[0];        // 最高分 (录取门槛最高 = 最低位次)
        const bot = sorted[sorted.length - 1];   // 最低分 (录取门槛最低 = 最高位次)
        const avgScore = Math.round(planScoreRank.reduce((s, x) => s + x.score, 0) / planScoreRank.length);
        const ranks = planScoreRank.map(x => x.rank).filter(r => r != null);
        const avgRank = ranks.length ? Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length) : null;
        // tier 按 avgScore
        const tier = planTierRelaxed({ ref25Score: avgScore, isStopped: false }, cwb.value);
        // 专业类列表 (去重, 用 ｜ 分隔)
        const majorClasses = [...g.majorClassSet];
        // 子表行: 按 25 分降序
        const sortedPlans = [...g.plans].sort((a, b) => {
          const sa = a.isStopped ? (a.score25 ?? -1) : (a.ref25Score ?? -1);
          const sb = b.isStopped ? (b.score25 ?? -1) : (b.ref25Score ?? -1);
          return sb - sa;
        });
        // 26 等位分/位次 (基于 25 → 26 等位映射)
        const eqTop = equivFromScore25(top.score, scoreRank.value);
        const eqBot = equivFromScore25(bot.score, scoreRank.value);
        const eqAvg = equivFromScore25(avgScore, scoreRank.value);
        result.push({
          schoolName: g.schoolName,
          schoolCode: g.schoolCode,
          schoolTag: g.schoolTag,
          schoolRank: g.schoolRank,
          city: g.city,
          province: g.province,
          majorClasses,
          totalEnroll,
          planCount: g.plans.length,
          tier,
          // 25 分/位次
          topScore: top.score, topRank: top.rank,
          botScore: bot.score, botRank: bot.rank,
          avgScore, avgRank,
          // 26 等位分/位次
          topScore26: eqTop.score26, topRank26: eqTop.rank26,
          botScore26: eqBot.score26, botRank26: eqBot.rank26,
          avgScore26: eqAvg.score26, avgRank26: eqAvg.rank26,
          plans: sortedPlans,        // 展开行用
        });
      }
      // 排序: 按 avgScore desc
      result.sort((a, b) => b.avgScore - a.avgScore);
      return result;
    });

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

    // V9: 用户 25 等位位次 (录取率计算用)
    //   priority: useRefinedQuery → rankRefine.R25_final > ui.analysisAnchor25 (手调) > equiv25(myScore) auto
    const userRank25Anchor = computed(() => {
      const sr = scoreRank.value;
      if (!sr) return null;
      if (ui.useRefinedQuery && rankRefine.value && rankRefine.value.R25_final != null) {
        return rankRefine.value.R25_final;
      }
      let s25 = (ui.analysisAnchor25 > 0) ? ui.analysisAnchor25
              : (ui.myScore > 0 ? equiv25FromScore26(ui.myScore, sr) : null);
      if (!s25) return null;
      return rank25FromScore25(s25, sr);
    });
    // 供给率 map: 25等位分 → { enroll26 (2026全体在该25分上招生数), cnt26 (该25分对应的26分同分人数), ratio }
    const supplyMap = computed(() => {
      const m = new Map();
      const sr = scoreRank.value;
      if (!sr) return m;
      // 1) 聚合 2026 全体 plans 在每个 25 等位分上的总招生
      const enrollMap = new Map();
      for (const p of store.allPlans) {
        if (!p) continue;
        const s25 = p.isStopped ? p.score25 : p.ref25Score;
        if (s25 == null) continue;
        const e = p.enrollNum26 || 0;
        if (!e) continue;
        enrollMap.set(s25, (enrollMap.get(s25) || 0) + e);
      }
      // 2) 每个 25 score → 26 同分人数 (26 一分一段表 [score, cnt, cumRank])
      const t26 = sr.oneScoreOneRank?.["2026"];
      if (!t26) return m;
      for (const [s25, enroll26] of enrollMap) {
        const eq = equivFromScore25(s25, sr);
        if (!eq?.score26) continue;
        let cnt26 = null;
        for (const row of t26) {
          if (row[0] === eq.score26) { cnt26 = row[1]; break; }
        }
        if (!cnt26) continue;
        m.set(s25, { enroll26, cnt26, score26: eq.score26, ratio: enroll26 / cnt26 });
      }
      return m;
    });
    function admitProbFor(plan) {
      return computeAdmitProb(plan, {
        userRank25: userRank25Anchor.value,
        scoreRank: scoreRank.value,
        supplyMap: supplyMap.value,
      });
    }

    // 转专业分类
    const transferTargetSet = computed(() => new Set((store.transferTargets || []).map(s => (s || "").replace(/\s+/g, "").trim()).filter(Boolean)));
    const transferAcceptSet = computed(() => new Set((store.transferAccepts || []).map(s => (s || "").replace(/\s+/g, "").trim()).filter(Boolean)));
    function transferOf(plan) {
      return classifyTransfer(plan, transferTargetSet.value, transferAcceptSet.value);
    }
    function resetTransferLists() {
      store.transferTargets = DEFAULT_TRANSFER_TARGETS.slice();
      store.transferAccepts = DEFAULT_TRANSFER_ACCEPTS.slice();
    }
    function resetCwbRanges() {
      store.cwbRanges = JSON.parse(JSON.stringify(DEFAULT_CWB_RANGES));
    }

    // ===== 位次精修 (同分位置 + 上方扩招 → 修正 25 等位分/位次) =====
    // effective_ref25 — 把 中外合作 -15, 民族班 -10 (LOW qualifier 实际录低于挂牌)
    function effectiveRef25(plan) {
      const base = plan.ref25Score ?? plan.score25;
      if (base == null) return null;
      const name = plan.majorName26 || plan.majorName25 || "";
      if (name.includes("中外合作办学")) return base - 15;
      if (name.includes("民族班"))       return base - 10;
      return base;
    }

    const rankRefine = computed(() => {
      const sr = scoreRank.value;
      if (!sr || !ui.myScore) return null;
      const s26 = ui.myScore;
      const posPct = Math.max(0, Math.min(100, ui.samePosPct ?? 50));
      const osr26 = sr.oneScoreOneRank?.["2026"] || [];
      const osr25 = sr.oneScoreOneRank?.["2025"] || [];
      if (!osr26.length || !osr25.length) return null;

      // Step 1: 同分位置 修正
      let cum = null, cnt = 0, prevCum = 0;
      for (const [s, c, cu] of osr26) {
        if (s === s26) { cum = cu; cnt = c; break; }
        if (s < s26) break;
        prevCum = cu;
      }
      if (cum == null) return null;
      // group ranks: (prevCum+1) .. cum; pos=0 → 顶 (prevCum+1); pos=100 → 底 (cum)
      const R26 = prevCum + 1 + Math.max(0, cnt - 1) * (posPct / 100);

      // 反查 25 等位: Y0 = osr25 找 cum25 >= R26 的第一个 score (反查分)
      // R25_0 = R26 (位次绝对值, 不跳跃; 跳的是 score 不是 rank)
      let Y0 = null;
      for (const [s, _c, cu] of osr25) {
        if (cu >= R26) { Y0 = s; break; }
      }
      if (Y0 == null) Y0 = osr25.length ? osr25[osr25.length - 1][0] : null;
      if (Y0 == null) return null;
      const R25_0 = Math.round(R26);

      // Step 2: 上方扩招 (effective_ref25 >= Y0)
      const T = transferTargetSet.value;
      const A = transferAcceptSet.value;
      let sumA = 0, cntA = 0, sumA_zwhz = 0;
      let sumB = 0, cntB = 0;
      let nPlanAbove = 0;
      for (const p of store.allPlans) {
        const eff = effectiveRef25(p);
        if (eff == null || eff < Y0) continue;
        nPlanAbove++;
        const delta = (p.enrollNum26 || 0) - (p.enrollNum25 || 0);
        const tr = classifyTransfer(p, T, A);
        const isZ = (p.majorName26 || "").includes("中外合作办学");
        if (tr.level === "ok" || tr.level === "warn") {
          sumA += delta; cntA++;
          if (isZ) sumA_zwhz += delta;
        } else {
          sumB += delta; cntB++;
        }
      }
      const totalShift = sumA * 1.0 + sumB * 0.2;
      // R25_final = R25_0 - totalShift; totalShift>0 (扩招) → R25 减小 (位次提前)
      const R25_final = Math.round(R25_0 - totalShift);
      let Y_final = null;
      for (const [s, _c, cu] of osr25) {
        if (cu >= R25_final) { Y_final = s; break; }
      }
      if (Y_final == null && osr25.length) Y_final = osr25[osr25.length - 1][0];

      return {
        s26, posPct, cnt26: cnt, R26: Math.round(R26),
        Y0, R25_0,
        nPlanAbove,
        sumA, cntA, sumA_zwhz,
        sumB, cntB,
        totalShift, R25_final, Y_final,
      };
    });

    function setSamePosPct(v) {
      ui.samePosPct = Math.max(0, Math.min(100, Math.round(+v || 0)));
    }

    // tier 映射 (id -> 'chong'|'wen'|'bao'|null)
    // voluntary 模式用 relaxed (每条都归一档); 其它模式用 strict
    const tierMap = computed(() => {
      const m = new Map();
      if (!cwb.value) return m;
      const fn = store.viewMode === "voluntary" ? planTierRelaxed : planTier;
      for (const p of paged.value) {
        const t = fn(p, cwb.value);
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
    // 当前激活志愿单 (computed, 2-way 代理到 voluntaryLists[activeName])
    const voluntary = computed({
      get() { return store.voluntaryLists[store.activeVoluntaryName] || []; },
      set(arr) { store.voluntaryLists[store.activeVoluntaryName] = arr; },
    });
    // V9: 当前选中行集合 (支持多选). plain click 替换单选, ctrl/cmd 切换, shift 范围
    const voluntarySelectedIds = ref(new Set());
    const voluntarySelectionAnchor = ref(null);
    function selectVoluntaryRow(payload) {
      // payload: { id, ctrl, meta, shift } 或 字符串 id (兼容旧调用)
      const id = typeof payload === "string" ? payload : payload?.id;
      if (!id) return;
      const ctrl  = typeof payload === "object" && (payload.ctrl || payload.meta);
      const shift = typeof payload === "object" && payload.shift;
      const cur = voluntarySelectedIds.value;
      if (shift && voluntarySelectionAnchor.value && voluntarySelectionAnchor.value !== id) {
        const ids = voluntary.value;
        const a = ids.indexOf(voluntarySelectionAnchor.value);
        const b = ids.indexOf(id);
        if (a < 0 || b < 0) { voluntarySelectedIds.value = new Set([id]); voluntarySelectionAnchor.value = id; return; }
        const [lo, hi] = a < b ? [a, b] : [b, a];
        voluntarySelectedIds.value = new Set(ids.slice(lo, hi + 1));
      } else if (ctrl) {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id); else next.add(id);
        voluntarySelectedIds.value = next;
        voluntarySelectionAnchor.value = id;
      } else {
        // plain: 单选; 已是唯一选中再点取消
        if (cur.size === 1 && cur.has(id)) {
          voluntarySelectedIds.value = new Set();
          voluntarySelectionAnchor.value = null;
        } else {
          voluntarySelectedIds.value = new Set([id]);
          voluntarySelectionAnchor.value = id;
        }
      }
    }
    function clearVoluntarySelection() {
      voluntarySelectedIds.value = new Set();
      voluntarySelectionAnchor.value = null;
    }
    // V9: 锁定 / 待确认 (按 listName keyed; 数组语义 = Set, 用 Array 以便 LS 序列化)
    function pinnedIdsOfActive() {
      return store.voluntaryPinned[store.activeVoluntaryName] || [];
    }
    function pendingIdsOfActive() {
      return store.voluntaryPending[store.activeVoluntaryName] || [];
    }
    const pinnedSet = computed(() => new Set(pinnedIdsOfActive()));
    const pendingSet = computed(() => new Set(pendingIdsOfActive()));
    const fixedSet = computed(() => new Set([...pinnedSet.value, ...pendingSet.value]));
    // 编辑前的 pinned 集合 (用于区分: "原本锁定但暂为 pending" vs "刚被移动的 pending")
    const backupPinnedSet = computed(() => {
      const bk = store.voluntaryBackup[store.activeVoluntaryName];
      return new Set(bk && Array.isArray(bk.pinned) ? bk.pinned : []);
    });
    function setPinnedActive(arr) {
      store.voluntaryPinned = { ...store.voluntaryPinned, [store.activeVoluntaryName]: arr };
    }
    function setPendingActive(arr) {
      store.voluntaryPending = { ...store.voluntaryPending, [store.activeVoluntaryName]: arr };
    }
    function getBackupActive() {
      return store.voluntaryBackup[store.activeVoluntaryName] || null;
    }
    function setBackupActive(snap) {
      store.voluntaryBackup = { ...store.voluntaryBackup, [store.activeVoluntaryName]: snap };
    }
    function clearBackupActive() {
      const next = { ...store.voluntaryBackup };
      delete next[store.activeVoluntaryName];
      store.voluntaryBackup = next;
    }
    // 26 等位次 lookup (id -> rank26). 缺则给 Infinity (排到最后)
    function rank26ForPlan(p) {
      if (!p || !scoreRank.value) return Infinity;
      const s25 = p.isStopped ? p.score25 : p.ref25Score;
      const e = equivFromScore25(s25, scoreRank.value);
      return e.rank26 ?? Infinity;
    }
    // 应用自动排序: pinned + pending 保留当前下标位置, 其余按 26 等位次升序填充
    function runAutoSort() {
      const ids = voluntary.value;
      if (!ids.length || !scoreRank.value) return;
      const m = planByIdMap.value;
      const fixed = fixedSet.value;
      const slots = new Array(ids.length).fill(null);
      const free = [];
      ids.forEach((id, i) => {
        if (fixed.has(id)) slots[i] = id;
        else free.push(id);
      });
      free.sort((a, b) => rank26ForPlan(m[a]) - rank26ForPlan(m[b]));
      let fi = 0;
      const out = slots.map(s => s ?? free[fi++]);
      // 仅当顺序变化时写回 (避免无限 watch 触发)
      const same = ids.length === out.length && ids.every((v, i) => v === out[i]);
      if (!same) voluntary.value = out;
    }
    // 数据载入或切表后, 自动排序一次 (使现有列表受新规则支配)
    watch([() => store.activeVoluntaryName, scoreRank], () => {
      runAutoSort();
    });
    // 切表清选中
    watch(() => store.activeVoluntaryName, () => { clearVoluntarySelection(); });
    // 多列表管理
    function newVoluntaryList(name) {
      if (!name) {
        name = prompt("新志愿单名 (建议: '650 分志愿' 之类):", `${ui.myScore || ''}分志愿`);
        if (!name) return;
      }
      if (store.voluntaryLists[name]) { alert(`"${name}" 已存在`); return; }
      store.voluntaryLists = { ...store.voluntaryLists, [name]: [] };
      store.activeVoluntaryName = name;
    }
    function renameVoluntaryList() {
      const oldName = store.activeVoluntaryName;
      const newName = prompt("新名:", oldName);
      if (!newName || newName === oldName) return;
      if (store.voluntaryLists[newName]) { alert("已存在"); return; }
      const renameKey = (obj) => {
        const out = {};
        for (const k of Object.keys(obj)) out[k === oldName ? newName : k] = obj[k];
        return out;
      };
      store.voluntaryLists  = renameKey(store.voluntaryLists);
      store.voluntaryPinned = renameKey(store.voluntaryPinned);
      store.voluntaryPending = renameKey(store.voluntaryPending);
      store.voluntaryBackup = renameKey(store.voluntaryBackup);
      store.activeVoluntaryName = newName;
    }
    function duplicateVoluntaryList() {
      const oldName = store.activeVoluntaryName;
      const newName = prompt("复制为新志愿单名:", `${oldName} 副本`);
      if (!newName) return;
      if (store.voluntaryLists[newName]) { alert("已存在"); return; }
      store.voluntaryLists = {
        ...store.voluntaryLists,
        [newName]: [...(store.voluntaryLists[oldName] || [])],
      };
      store.voluntaryPinned = {
        ...store.voluntaryPinned,
        [newName]: [...(store.voluntaryPinned[oldName] || [])],
      };
      store.voluntaryPending = {
        ...store.voluntaryPending,
        [newName]: [...(store.voluntaryPending[oldName] || [])],
      };
      store.activeVoluntaryName = newName;
    }
    function deleteVoluntaryList() {
      const name = store.activeVoluntaryName;
      const keys = Object.keys(store.voluntaryLists);
      if (keys.length === 1) { alert("至少保留 1 个志愿单"); return; }
      const cnt = store.voluntaryLists[name]?.length || 0;
      if (!confirm(`删除志愿单 "${name}" (${cnt} 项)?`)) return;
      const dropKey = (obj) => { const o = { ...obj }; delete o[name]; return o; };
      store.voluntaryLists  = dropKey(store.voluntaryLists);
      store.voluntaryPinned = dropKey(store.voluntaryPinned);
      store.voluntaryPending = dropKey(store.voluntaryPending);
      store.voluntaryBackup = dropKey(store.voluntaryBackup);
      store.activeVoluntaryName = Object.keys(store.voluntaryLists)[0];
    }
    function switchVoluntaryList(name) {
      if (store.voluntaryLists[name]) store.activeVoluntaryName = name;
    }

    // 志愿单操作 (基于当前激活列表)
    const voluntarySet = computed(() => new Set(voluntary.value));
    function isInVoluntary(id) { return voluntarySet.value.has(id); }
    function voluntaryIndex(id) {
      const i = voluntary.value.indexOf(id);
      return i >= 0 ? i + 1 : 0;
    }
    function toggleVoluntary(id) {
      const arr = [...voluntary.value];
      const i = arr.indexOf(id);
      if (i >= 0) {
        arr.splice(i, 1);
        // 移除时也从 pinned / pending 里清掉
        const pn = pinnedIdsOfActive().filter(x => x !== id);
        const pd = pendingIdsOfActive().filter(x => x !== id);
        if (pn.length !== pinnedIdsOfActive().length) setPinnedActive(pn);
        if (pd.length !== pendingIdsOfActive().length) setPendingActive(pd);
        voluntary.value = arr;
        if (voluntarySelectedIds.value.has(id)) {
          const next = new Set(voluntarySelectedIds.value); next.delete(id);
          voluntarySelectedIds.value = next;
        }
        runAutoSort();
      } else {
        arr.push(id);
        voluntary.value = arr;
        runAutoSort();   // V9: 新加入的不锁定; 自动按 26 位次插入合适位置
      }
    }
    // V9 (rewritten per user spec):
    // 移动 = splice + insert (保持各项相对顺序), 不在 move 期间 auto-sort.
    // 第一次 move (本次编辑会话) 触发: 整数组 + 当时 pinned 进 backup;
    //   把所有原 pinned 转入 pending (整理期间一切位置都待重新确认).
    // 之后 move 只更新数组 + 把移动项加入 pending.
    // ✓ 全部确认 → pending → pinned, 清 backup;
    // ↩ 全部撤销 → 数组+pinned 从 backup 还原, 清 pending+backup, runAutoSort.
    function markPendingMoveTo(id, targetIdx) {
      const ids = [...voluntary.value];
      const cur = ids.indexOf(id);
      if (cur < 0) return;
      const N = ids.length;
      targetIdx = Math.max(0, Math.min(N - 1, targetIdx));
      if (cur === targetIdx) return;
      // 首次进入编辑会话: snapshot + pinned → pending
      if (!getBackupActive()) {
        setBackupActive({
          ids: [...voluntary.value],
          pinned: [...pinnedIdsOfActive()],
        });
        const pn = pinnedIdsOfActive();
        if (pn.length) {
          setPinnedActive([]);
          const pd = pendingIdsOfActive();
          const merged = [...pd];
          for (const x of pn) if (!merged.includes(x)) merged.push(x);
          setPendingActive(merged);
        }
      }
      // splice + insert (保留各项相对顺序; 不 auto-sort)
      const [item] = ids.splice(cur, 1);
      ids.splice(targetIdx, 0, item);
      voluntary.value = ids;
      // 移动项加入 pending
      const pd = pendingIdsOfActive();
      if (!pd.includes(id)) setPendingActive([...pd, id]);
      // 移动完成后, 滚动到该行 (若已经出屏)
      nextTick(() => scrollVoluntaryRowIntoView(id));
    }
    function scrollVoluntaryRowIntoView(id) {
      const el = document.querySelector(`tr[data-vol-row-id="${id}"]`);
      if (!el) return;
      const container = el.closest(".table-scroll");
      if (!container) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      // sticky thead 约 28px, scrollbar 约 18px; 留缓冲
      const topGuard = 40;
      const bottomGuard = 28;
      if (eRect.top < cRect.top + topGuard || eRect.bottom > cRect.bottom - bottomGuard) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
    // "原本锁定" = 编辑前的 pinned (backup.pinned 优先, 没编辑会话时用当前 pinned)
    function isOriginallyPinned(id) {
      const bk = getBackupActive();
      if (bk && Array.isArray(bk.pinned)) return bk.pinned.includes(id);
      return pinnedSet.value.has(id);
    }
    // 边界提示 (单条移动遇到 📌 锁定项时, 停下并提示)
    function showBoundaryNote(text) {
      ui.moveBoundaryNote = text;
      if (ui._noteTimer) clearTimeout(ui._noteTimer);
      ui._noteTimer = setTimeout(() => { ui.moveBoundaryNote = null; }, 5000);
    }
    function planLabel(id) {
      const p = planByIdMap.value[id];
      return p ? `${p.schoolName} · ${p.majorName26 || p.majorName25 || ''}` : id;
    }
    function moveVoluntaryUp(id) {
      const ids = voluntary.value;
      const i = ids.indexOf(id);
      if (i <= 0) return;
      // 非锁定行 不可跨过 锁定行 → 停下来给用户决定
      if (!isOriginallyPinned(id) && isOriginallyPinned(ids[i - 1])) {
        showBoundaryNote(`⚠ 上方 #${i} 是 📌 锁定项 [${planLabel(ids[i - 1])}]. 停在边界. 用 ⇈ 跳过该项, 或 🔓 解锁该项后继续.`);
        return;
      }
      markPendingMoveTo(id, i - 1);
    }
    function moveVoluntaryDown(id) {
      const ids = voluntary.value;
      const i = ids.indexOf(id);
      if (i < 0 || i >= ids.length - 1) return;
      if (!isOriginallyPinned(id) && isOriginallyPinned(ids[i + 1])) {
        showBoundaryNote(`⚠ 下方 #${i + 2} 是 📌 锁定项 [${planLabel(ids[i + 1])}]. 停在边界. 用 ⇊ 跳过该项, 或 🔓 解锁该项后继续.`);
        return;
      }
      markPendingMoveTo(id, i + 1);
    }
    // ⇈ 上移到顶 (智能):
    //   原本锁定行 → 直接到 #1
    //   非锁定行 → 移到"上方第一个锁定行"的下面 (没锁定时到顶)
    function moveVoluntaryToTop(id) {
      const ids = voluntary.value;
      const cur = ids.indexOf(id);
      if (cur <= 0) return;
      let target = 0;
      if (!isOriginallyPinned(id)) {
        for (let i = cur - 1; i >= 0; i--) {
          if (isOriginallyPinned(ids[i])) { target = i + 1; break; }
        }
      }
      if (target !== cur) markPendingMoveTo(id, target);
    }
    // ⇊ 下移到底 (智能):
    //   原本锁定行 → 紧跟在 "最后一个其它锁定行" 后面 (保持在锁定区, 不到非锁定区)
    //                若没有其它锁定行 → 末尾
    //   非锁定行 → 移到 "下方第一个锁定行" 的上面 (没有则末尾)
    function moveVoluntaryToBottom(id) {
      const ids = voluntary.value;
      const cur = ids.indexOf(id);
      const N = ids.length;
      if (cur < 0 || cur >= N - 1) return;
      let target;
      if (isOriginallyPinned(id)) {
        // 找最后一个其它锁定行
        let lastOther = -1;
        for (let i = N - 1; i >= 0; i--) {
          if (i !== cur && isOriginallyPinned(ids[i])) { lastOther = i; break; }
        }
        if (lastOther < 0) target = N - 1;
        // 想让 self 在最终数组里紧跟 lastOther 后:
        //   lastOther > cur → splice 后 lastOther 移到 lastOther-1, target=lastOther
        //   lastOther < cur → target = lastOther+1
        else if (lastOther > cur) target = lastOther;
        else target = lastOther + 1;
      } else {
        target = N - 1;
        for (let i = cur + 1; i < N; i++) {
          if (isOriginallyPinned(ids[i])) { target = i - 1; break; }
        }
      }
      if (target !== cur) markPendingMoveTo(id, target);
    }
    // V9 多选: 统一移动入口
    //   单选 → 走 single-row 智能逻辑 (含 ⇈⇊ 的锁定边界)
    //   多选 → 块整体移动 (⇈⇊ 绝对到顶/底, ↑↓ 整块平移 1 格)
    function moveSelection(direction) {
      const sel = voluntarySelectedIds.value;
      if (!sel.size) return;
      if (sel.size === 1) {
        const id = [...sel][0];
        if (direction === "top") moveVoluntaryToTop(id);
        else if (direction === "up") moveVoluntaryUp(id);
        else if (direction === "down") moveVoluntaryDown(id);
        else if (direction === "bottom") moveVoluntaryToBottom(id);
        return;
      }
      const ids0 = voluntary.value;
      const ordered = ids0.filter(x => sel.has(x));
      if (direction === "top") {
        for (let k = 0; k < ordered.length; k++) markPendingMoveTo(ordered[k], k);
      } else if (direction === "bottom") {
        const N = voluntary.value.length;
        for (let k = ordered.length - 1; k >= 0; k--) {
          markPendingMoveTo(ordered[k], N - (ordered.length - k));
        }
      } else if (direction === "up") {
        if (ids0.findIndex(x => sel.has(x)) === 0) return;
        for (const id of ordered) {
          const i = voluntary.value.indexOf(id);
          if (i > 0) markPendingMoveTo(id, i - 1);
        }
      } else if (direction === "down") {
        let lastSel = -1;
        ids0.forEach((x, i) => { if (sel.has(x)) lastSel = i; });
        if (lastSel === ids0.length - 1) return;
        for (const id of ordered.slice().reverse()) {
          const i = voluntary.value.indexOf(id);
          if (i < voluntary.value.length - 1) markPendingMoveTo(id, i + 1);
        }
      }
    }
    // V9: 锁定确认 / 撤销 / 解锁
    // 单条 ✓ = 全部确认 (用户表达"整理完了, 这次都按现在的来"; 不必逐条确认)
    function confirmPin(id) {
      if (!pendingIdsOfActive().includes(id)) return;
      confirmAllPending();
    }
    // 单条撤销: 这条退出 pending. 若它在 backup.pinned 中 (原本就 pinned), 恢复 pinned.
    function cancelPending(id) {
      const pd = pendingIdsOfActive();
      if (!pd.includes(id)) return;
      setPendingActive(pd.filter(x => x !== id));
      const bk = getBackupActive();
      if (bk && bk.pinned && bk.pinned.includes(id)) {
        const pn = pinnedIdsOfActive();
        if (!pn.includes(id)) setPinnedActive([...pn, id]);
      }
      if (!pendingIdsOfActive().length) clearBackupActive();
      runAutoSort();   // 撤销后, 该 plan 若不在 pinned, 由自动排序决定位置
    }
    function unpinConfirmed(id) {
      const pn = pinnedIdsOfActive();
      if (!pn.includes(id)) return;
      setPinnedActive(pn.filter(x => x !== id));
      runAutoSort();
    }
    // 当前位置直接锁定 (不需先移动) — 不进入"整理会话", 不影响 backup
    function pinAtCurrent(id) {
      const pn = pinnedIdsOfActive();
      if (pn.includes(id)) return;
      setPinnedActive([...pn, id]);
      const pd = pendingIdsOfActive();
      if (pd.includes(id)) setPendingActive(pd.filter(x => x !== id));
      // 若 pending 因此清空, 清 backup
      if (!pendingIdsOfActive().length && getBackupActive()) clearBackupActive();
    }
    // 一键锁定所有当前位置 (无 pending 编辑会话时使用)
    function pinAllCurrent() {
      const ids = voluntary.value;
      if (!ids.length) return;
      if (!confirm(`把当前 ${ids.length} 项全部锁定到现在的位置?\n之后新增项目仍按 26 位次自动排, 锁定项不动.`)) return;
      setPinnedActive([...ids]);
      setPendingActive([]);
      clearBackupActive();
    }
    // 全部确认: pending → pinned (含原 backup pinned), 清 backup
    function confirmAllPending() {
      const pd = pendingIdsOfActive();
      if (!pd.length) return;
      const pn = pinnedIdsOfActive();
      const merged = [...pn];
      for (const id of pd) if (!merged.includes(id)) merged.push(id);
      setPinnedActive(merged);
      setPendingActive([]);
      clearBackupActive();
    }
    // 全部撤销: 数组 + pinned 从 backup 完整回滚 (彻底回到编辑前)
    function cancelAllPending() {
      const bk = getBackupActive();
      if (!bk) {
        // 没有编辑会话, 但可能孤立 pending → 简单清空
        if (pendingIdsOfActive().length) setPendingActive([]);
        runAutoSort();
        return;
      }
      voluntary.value = [...bk.ids];
      setPinnedActive([...(bk.pinned || [])]);
      setPendingActive([]);
      clearBackupActive();
      runAutoSort();   // backup 中 unpinned 部分按 26 位次重排 (与编辑前一致)
    }
    function clearVoluntary() {
      if (confirm(`确认清空当前志愿单 "${store.activeVoluntaryName}" (${voluntary.value.length} 项)?`)) {
        voluntary.value = [];
        setPinnedActive([]);
        setPendingActive([]);
        clearBackupActive();
        clearVoluntarySelection();
      }
    }
    function toggleExpand(id) {
      // 单展开模式; voluntary / recommend / 主表 各自独立
      const key = store.viewMode === "voluntary" ? "expandedRowsVol"
        : store.viewMode === "recommend" ? "expandedRecommend"
        : "expandedRows";
      const wasOpen = store[key].has(id);
      store[key] = wasOpen ? new Set() : new Set([id]);
    }
    // 给 ResultList 用的当前 expanded set
    const currentExpandedRows = computed(() =>
      store.viewMode === "voluntary" ? store.expandedRowsVol
      : store.viewMode === "recommend" ? store.expandedRecommend
      : store.expandedRows);

    // 每视图绑定不同的关键词筛选 state (主表用 store.filters; voluntary/recommend 各自)
    const currentKeywordFilters = computed(() => {
      if (store.viewMode === "voluntary") return store.voluntaryKeyword;
      if (store.viewMode === "recommend") return store.recommendKeyword;
      return store.filters;
    });
    // 应用关键词 4 字段到 plan 列表
    function applyKeywordFilter(plans, f) {
      if (!f) return plans;
      let out = plans;
      if (f.pickedSchool) out = out.filter(p => p.schoolName === f.pickedSchool);
      if (f.pickedMajorClass) out = out.filter(p =>
        (p.majorClass || p.majorClass25) === f.pickedMajorClass);
      if (f.pickedMajorName) out = out.filter(p =>
        p.majorName26 === f.pickedMajorName || p.majorName25 === f.pickedMajorName);
      if (f.keyword) out = out.filter(p => matchesKeyword(p, f.keyword));
      return out;
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
    // 点击空白处关闭 导入/导出 dropdown
    function onIODocMouseDown(ev) {
      const inside = ev.target.closest?.(".import-export-menu");
      if (!inside) { ui.showImportMenu = false; ui.showExportMenu = false; }
    }
    watch(() => ui.showImportMenu || ui.showExportMenu, on => {
      if (on) document.addEventListener("mousedown", onIODocMouseDown);
      else document.removeEventListener("mousedown", onIODocMouseDown);
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
    // 双击 cell 编辑 (用户修改 25 参考分; 自动算位次)
    function editPlanScore(planId, newScore) {
      const idx = store.allPlans.findIndex(p => p.id === planId);
      if (idx < 0) return;
      const p = store.allPlans[idx];
      const s = parseInt(newScore, 10);
      if (!s || s < 100 || s > 750) { alert("分数无效 (100-750)"); return; }
      // 如果新值等于原始值, 直接 revert (取消 override + 不再显示 *)
      const orig = planOriginals.get(planId);
      if (orig && s === orig.ref25Score) {
        revertPlanScore(planId);
        return;
      }
      const newRank = scoreRank.value ? rank25FromScore25(s, scoreRank.value) : null;
      store.allPlans[idx] = { ...p, ref25Score: s, ref25Rank: newRank };
      store.planOverrides = {
        ...store.planOverrides,
        [planId]: { ref25Score: s, ref25Rank: newRank, _edited: true },
      };
    }
    // 恢复某条 plan 的原始 ref25Score/Rank
    function revertPlanScore(planId) {
      const orig = planOriginals.get(planId);
      if (!orig) return;
      const idx = store.allPlans.findIndex(p => p.id === planId);
      if (idx >= 0) {
        const p = store.allPlans[idx];
        store.allPlans[idx] = { ...p, ref25Score: orig.ref25Score, ref25Rank: orig.ref25Rank };
      }
      const ov = { ...store.planOverrides };
      delete ov[planId];
      store.planOverrides = ov;
    }

    // 排序设置 modal handlers
    function savePriorityOverrides(out) {
      store.priorityOverrides = out;
      ui.showPrioritySettings = false;
    }
    function resetPriorityOverrides() {
      if (!confirm("重置所有优先次序为默认 (priority.json 自带顺序)?")) return;
      store.priorityOverrides = { schools: null, cities: null, majorClasses: null, majors: null };
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
      scoreRank, meta, priority, currentPage, cwb, tierMap, paneTargets, activeTier, filteredTierCounts, recommendData,
      admitProbFor, userRank25Anchor, transferOf, resetTransferLists,
      rankRefine, setSamePosPct, refinedScore26, resetCwbRanges,
      transferTargetSet, transferAcceptSet,
      ratioSumOk, resetRatios,
      filtered, sorted, paged, planByIdMap, compareIdSet, keywordCandidatePool,
      openDetail, toggleCompare, toggleFavorite, toggleExpand, saveFavorites, currentExpandedRows,
      currentKeywordFilters,
      voluntary, voluntarySet, isInVoluntary, voluntaryIndex, toggleVoluntary,
      moveVoluntaryUp, moveVoluntaryDown, moveVoluntaryToTop, moveVoluntaryToBottom, clearVoluntary,
      newVoluntaryList, renameVoluntaryList, duplicateVoluntaryList, deleteVoluntaryList, switchVoluntaryList,
      voluntaryTierCounts, exportVoluntaryByTier, exportVoluntaryHtml, voluntaryAnalysis,
      exportVoluntaryJson, importVoluntaryJson, importLnVolHtml, mergeFromOtherList,
      exportVoluntaryCsv, importVoluntaryCsv, exportLnVolHtml,
      // V9: 锁定/待确认
      pinnedSet, pendingSet, backupPinnedSet,
      voluntaryPinnedCount: computed(() => pinnedSet.value.size),
      voluntaryPendingCount: computed(() => pendingSet.value.size),
      confirmPin, cancelPending, unpinConfirmed, confirmAllPending, cancelAllPending,
      pinAtCurrent, pinAllCurrent,
      voluntarySelectedIds, selectVoluntaryRow, clearVoluntarySelection, moveSelection,
      resetFilters, onApplyTier, reloadData,
      exportCsv, toggleDark,
      savePreset, loadPreset, deletePreset, renamePreset, copyShareLink,
      takeScreenshot, printPage,
      // Items 6.x: 排序 / 列设置
      visibleColumns, allColumns, toggleColumn, resetColumns, onColDrop, onColResize,
      savePriorityOverrides, resetPriorityOverrides,
      editPlanScore, revertPlanScore,
      onSortCol, sortFieldLabel, toggleSortDir, removeSortKey,
      onSortDragStart, onSortDrop,
      probColorClass, supplyMap,
    };
  },
});
__app.config.globalProperties.probColorClass = probColorClass;
__app.component("AdmitTrendChart", AdmitTrendChart);
__app.component("TransferRiskSection", TransferRiskSection);
__app.component("AdmitTopSummary", AdmitTopSummary);
__app.mount("#app");
