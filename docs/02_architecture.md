# 技术架构

## 1. 总体方案

**静态 SPA（单页应用），无后端**。所有数据预先从 xlsx 导出为 JSON，浏览器加载后全部在客户端计算。

```
                  [一次性] 数据生成
xlsx (2026数据raw, 分数, 排名)  ─python─>  data/plans.json          (15.5 MB, 12728 条)
                                          data/score_rank.json     (一分一段 + 等位分)
                                          data/priority.json       (城市 79 + 学校 328 + 专业类 95)
                                          data/meta.json           (枚举值)
                                                  │
                                                  ▼
                       [运行时]  浏览器加载 → 内存索引 → 筛选 / 排序 / 渲染
```

## 2. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 数据导出 | Python + openpyxl | 复用现有 pipeline，已熟 |
| 前端框架 | **Vue 3（CDN 引入，无 build）** | 轻量、响应式、模板语法直观；不引入 Node 工具链 |
| UI 组件 | **手写 + Tailwind CSS（CDN）** | 灵活定制 + 体积小；不依赖庞大 UI 库 |
| 表格 / 大数据 | 自行虚拟滚动（IntersectionObserver）或分页 | 12k 行不大，分页 50/页就够流畅 |
| 图表（迷你趋势）| Chart.js（CDN）| 体积小、API 简单 |
| 持久化 | localStorage | 收藏 / 预设 / 主题 |
| 部署 | `python3 -m http.server` | 静态 http 服务器，零依赖 |

> 备选方案：若 Vue 3 + Tailwind 引入复杂度过高，回退到 **Alpine.js + 原生 CSS**。差别不大，但 Vue 的组件化对"卡片+对比+详情弹窗"更友好。

### 为什么不用 React/Next.js？

- 需要 Node + 构建步骤
- 部署比 Python 内置 http server 复杂
- 对本项目（家用工具）过度工程化

### 为什么不需要后端？

- 数据是只读快照（每次跑 pipeline 重生成）
- 12k 行 JSON 大小可控（5-10 MB gzip 后 ~1 MB）
- 筛选 / 排序 / 对比 全部在客户端能搞定
- 收藏 / 预设 用 localStorage，本机够用

## 3. 目录结构

```
new/工具/报考/
├── README.md                          # 快速启动 + 使用说明
├── docs/
│   ├── 00_context_recap.md            # 历史背景
│   ├── 01_requirements.md             # 功能需求
│   ├── 02_architecture.md             # 本文档
│   └── 03_testing.md                  # 测试计划
├── index.html                         # 入口页面
├── assets/
│   ├── app.js                         # Vue 3 应用主逻辑
│   ├── components/
│   │   ├── FilterPanel.js             # 筛选侧栏
│   │   ├── ResultList.js              # 结果列表/表格
│   │   ├── ResultCard.js              # 单条卡片
│   │   ├── DetailDrawer.js            # 详情弹窗
│   │   ├── CompareView.js             # 对比页
│   │   ├── ScoreLocator.js            # 分数位次定位器
│   │   └── HistoryChart.js            # 历年趋势 (Chart.js)
│   ├── store.js                       # 状态管理 (reactive)
│   ├── filters.js                     # 筛选/排序纯函数
│   └── style.css                      # 全局样式 (含 Tailwind)
├── vendor/                            # 第三方库 (本地副本, 离线可用)
│   ├── vue.global.prod.js             # Vue 3
│   ├── tailwind.min.css               # Tailwind 编译后样式
│   └── chart.umd.js                   # Chart.js
├── data/
│   ├── plans.json                     # 招生计划数据 (12728 条)
│   ├── score_rank.json                # 一分一段表
│   └── meta.json                      # 数据生成时间、来源、筛选枚举值
└── scripts/
    └── build_data.py                  # xlsx → JSON 转换
```

## 4. 数据模型

### 4.1 `data/plans.json`

每条记录的 JSON 结构（精简版字段名，便于 JS 调用）：

```typescript
type Plan = {
  // 序号 / 唯一标识
  id: number;                       // 1..12728 (来自序号列)
  
  // 学校层
  schoolCode: string;               // "0013"
  schoolName: string;               // "北京邮电大学"
  schoolRank: number | null;        // 50
  schoolTag: string;                // "211" / "985" / ...
  schoolType: string;               // "理工" / "综合" / ...
  province: string;                 // "北京"
  city: string;                     // "北京"
  cityTier: string;                 // "一线城市"
  cityPriority: number | null;
  schoolPriority: number | null;
  majorPriority: number | null;     // (专业类优先)
  schoolBaoyan: number | null;      // 校保研率 (0-1)
  schoolUpgrade: number | null;     // 校升学率
  
  // 26 招生
  majorCode26: string;              // "04"
  majorCategory: string;            // "工学" (门类)
  majorClass: string;               // "电子信息类"
  majorName26: string;              // "通信工程(大类招生)"
  containedMajors: string[];        // ["通信工程"]
  rankSoftware: string;             // "通信工程(A+,2)"
  rankEval: string;                 // "通信工程(A+)"
  rankMaster: string;               // "通信工程(3)"
  baoyanDetail: string;             // "通信工程(信电学院,30%)"
  remarks: string;                  // 专业备注 (校区/分流/转专业)
  subjectReq: string;               // "化学"
  duration: string;                 // "四年"
  tuition: number | null;           // 5500
  isNew: string;                    // "新增" / ""
  enrollNum26: number;              // 21
  diff: string;                     // "招生人数+1" / "停招: xxx" / ""
  
  // 25 参考 (web app 主用)
  ref25Score: number | null;        // 25参考最低分
  ref25Rank: number | null;
  ref25LineDiff: number | null;
  refConfidence: string;            // "高" / "中" / "低" / "本校同类估" / "中外合作估" / "" (停招)
  refSource: string;                // 来源描述
  
  // 25 实际 (备份, 用于停招行)
  majorName25: string;
  enrollNum25: number | null;
  score25: number | null;
  rank25: number | null;
  
  // 历年录取
  history: {
    24: { num: number, score: number, rank: number, lineDiff: number } | null,
    23: { ... } | null,
    22: { ... } | null,
  };
  
  // 统计 / 预测
  avgRank: number | null;
  rankVolatility: number | null;
  predict: {
    num: number, score: number, rank: number, lineDiff: number,
    heat: number, rankShift: number, trend: string
  };
  
  // 计算字段 (build 时预计算)
  isStopped: boolean;               // 停招 = refConfidence === ""
  isMidOutside: boolean;            // 中外合作办学 = remarks 含 "中外合作办学" 或 majorName26 含
};
```

### 4.2 `data/score_rank.json`

```typescript
{
  years: [2022, 2023, 2024, 2025, 2026],
  baseline: { 2022: 501, 2023: 494, 2024: 510, 2025: 515, 2026: 507 },
  oneScoreOneRank: {
    2025: [[680, 100], [675, 150], ...],   // [分数, 累计位次]
    2024: ...
  },
  equivalent: {
    // 同位次的等位分对照
  }
}
```

### 4.3 `data/meta.json`

```typescript
{
  generatedAt: "2026-06-21T12:34:56",
  source: "2026高考-物理-志愿_2026.xlsx",
  totalRows: 12728,
  
  // 用于筛选 chip 的可选值集合
  enumerations: {
    schoolTags: ["985", "211", "双一流", "国重点", "省重点", "其他"],
    provinces: ["北京", "上海", ...],
    cityTiers: ["一线城市", "新一线城市", ...],
    majorCategories: ["工学", "理学", ...],
    evalLevels: ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-"],
    refConfidence: ["高", "中", "低", "本校同类估", "本校同门类估", "本校高分估", "中外合作估", "无"],
  }
}
```

## 5. 客户端架构

### 5.1 状态管理

用 Vue 3 的 `reactive()` 做简单 store：

```javascript
// store.js — V3 (User Review Round 3 后)
import { reactive, computed } from 'vue';

export const store = reactive({
  // 原始数据
  allPlans: [],
  scoreRank: null,
  priority: null,     // {cities, schools, majorClasses}
  meta: null,
  loading: true,

  // 筛选状态 (V2)
  filters: {
    // 冲稳保 3 段范围 (顶部分数变化时自动填充)
    enableScoreRange: true,
    enableRankRange: false,
    scoreRanges: [],     // [{tier:'chong'|'wen'|'bao', low, high}]
    rankRanges:  [],
    tuitionMax: 100000,
    // 学校优先 — 双端范围
    schoolPriorityRange: [1, 50],
    selectedSchools: null,         // null = 全部 in range; Set = 用户子集
    // 城市优先 — 单端
    cityPriorityMax: 18,
    selectedCities: null,
    // 专业类优先 — 单端
    majorClassPriorityMax: 16,
    selectedMajorClasses: null,
    // 评估 + 标签
    evalAccept: new Set(["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-"]),
    schoolTags: new Set(),
    // 开关
    includeStopped: false,
    includeMidOutside: true,
    refRequired: false,
    // 关键词 (4 维: 模糊 + 3 强等于)
    keyword: "",
    pickedSchool: null,
    pickedMajorClass: null,
    pickedMajorName: null,
  },

  // UI 状态 (V3)
  sortKeys: [{field: "ref25Score", dir: "desc"}],   // 多列排序, LS 持久化
  viewMode: "table",                                 // table (默认) | list
  pageSize: 0,                                       // 0 = 不分页 (默认)
  sidebarCollapsed: false,                           // 侧栏收起, LS
  hiddenColumns: new Set(["sp", "mp"]),              // 默认隐藏 校优/类优, LS
  columnOrder: null,                                 // 列拖动重排, null = COLUMNS 默认, LS
  expandedRows: new Set(),                           // 表格行内展开 (临时态)

  // 收藏 / 对比
  favorites: new Set(loadFromLocalStorage("favorites")),
  compareList: [],
});

// UI 子状态 (单独 reactive)
export const ui = reactive({
  myScore: 0,            // 用户 26 实际分数
  myRank: 0,             // 26 位次 (自动从分数算)
  equivSource: "25",     // '25' | 'avg' | '24' | '23' 等位次基准
  totalVolunteers: 112,
  ratioChong: 0.25,
  ratioWen: 0.45,
  ratioBao: 0.30,
  detailPlan: null,
  dark: false,
});

// 冲稳保区间 (响应 ui.myScore 变化, computeChongWenBao 内做 26→25 等位分换算)
export const cwb = computed(() =>
  computeChongWenBao(ui.myScore, store.scoreRank, ui.equivSource));

// watch(cwb) → 自动填充 store.filters.scoreRanges / rankRanges

// 筛选后结果 + tier 标记
export const filtered = computed(() => applyFilters(store.allPlans, store.filters));
export const tierMap  = computed(() => {
  // id → 'chong' | 'wen' | 'bao' | null  (基于分数, 停招用 score25)
});

// 筛选后的结果 (响应式)
export const filtered = computed(() => applyFilters(store.allPlans, store.filters));
export const sorted = computed(() => applySort(filtered.value, store.sortBy));
```

### 5.2 筛选纯函数 (V2)

```javascript
// 关键算法: 冲稳保区间用 25 等位分计算 (User Review Item 4)
function computeChongWenBao(score26, scoreRank, equivSource='25') {
  if (!score26) return null;
  // 1. 26 分数 → 25 等位分 Y (查 equivalent 表)
  const { score: Y, rank: equivRank } = equivFromScore26(score26, scoreRank, equivSource);
  if (Y == null) return null;
  // 2. Deltas 应用到 Y (不是 score26!)
  const ranges = {
    chong: { scoreLow: Y + 6,  scoreHigh: Y + 23 },
    wen:   { scoreLow: Y - 10, scoreHigh: Y + 5  },
    bao:   { scoreLow: Y - 27, scoreHigh: Y - 11 },
  };
  // 3. 用 25 一分一段反查位次范围
  for (const k of Object.keys(ranges)) {
    ranges[k].rankHigh = rank25FromScore25(ranges[k].scoreLow,  scoreRank);
    ranges[k].rankLow  = rank25FromScore25(ranges[k].scoreHigh, scoreRank);
  }
  return { equivScore25: Y, equivRank25: equivRank, ranges };
}

// 筛选
function applyFilters(plans, f) {
  return plans.filter(p => {
    const score = p.isStopped ? p.score25 : p.ref25Score;
    const rank  = p.isStopped ? p.rank25  : p.ref25Rank;
    if (score == null) return false;

    // 3 段范围 (冲稳保) 并集匹配 (User Review Item 6)
    if (f.enableScoreRange && f.scoreRanges.length) {
      if (!f.scoreRanges.some(r => score >= r.low && score <= r.high)) return false;
    }
    if (f.enableRankRange && f.rankRanges.length && rank != null) {
      if (!f.rankRanges.some(r => rank >= r.low && rank <= r.high)) return false;
    }

    // 学校优先 — 双端范围
    if (p.schoolPriority != null) {
      const [lo, hi] = f.schoolPriorityRange;
      if (p.schoolPriority < lo || p.schoolPriority > hi) return false;
    }
    // 专业类优先 — 单端
    if (!p.isStopped && p.majorPriority != null && p.majorPriority > f.majorClassPriorityMax) return false;

    // chip 多选 (滑杆控制候选, chip 是实际筛选集)
    if (f.selectedSchools && !f.selectedSchools.has(p.schoolName)) return false;
    if (f.selectedCities && !f.selectedCities.has(p.city)) return false;
    if (f.selectedMajorClasses && !f.selectedMajorClasses.has(p.majorClass || p.majorClass25)) return false;

    // 学费 / 标签 / 评估 / 选科 / 关键词 ... (同 V1)
    // 关键词 (4 维: User Review Item 5)
    if (f.pickedSchool && p.schoolName !== f.pickedSchool) return false;
    if (f.pickedMajorClass && (p.majorClass || p.majorClass25) !== f.pickedMajorClass) return false;
    if (f.pickedMajorName) { /* 等于 26 或 25 专业名 */ }
    if (!matchesKeyword(p, f.keyword)) return false;

    return true;
  });
}

// tier 判档 (颜色标记)
function planTier(plan, cwb) {
  if (!cwb) return null;
  const s = plan.isStopped ? plan.score25 : plan.ref25Score;
  if (s == null) return null;
  const R = cwb.ranges;
  if (s >= R.chong.scoreLow && s <= R.chong.scoreHigh) return 'chong';
  if (s >= R.wen.scoreLow   && s <= R.wen.scoreHigh)   return 'wen';
  if (s >= R.bao.scoreLow   && s <= R.bao.scoreHigh)   return 'bao';
  return null;
}
```

### 5.3 性能策略

- 12k 行 × 单次 filter 约 12k 次 callback，~10 ms 在现代 CPU
- 排序 nlogn ≈ 150k ops，~10 ms
- 渲染：分页 50 条/页（虚拟滚动）防止 DOM 爆炸
- Vue 响应式自动批处理：拖动滑块时 debounce 100 ms
- 整体目标：拖动滑块时，结果区在 200ms 内更新

## 6. 第三方依赖（本地化）

为了离线可用，所有库下载到 `vendor/`：

| 库 | 版本 | 用途 |
|---|---|---|
| Vue 3 | 3.4.x global build | reactive 系统 + 模板 |
| Tailwind CSS | 3.x 编译输出 | 样式（可选只用自己的 css）|
| Chart.js | 4.x UMD | 历年趋势小图（P1 才需要）|

> 首版可全部用 CDN 引用快速验证，确认 UX 后再下载到本地。

## 7. 部署 & 使用

```bash
cd new/工具/报考
# 一次性: 生成数据
python3 scripts/build_data.py

# 启动 (任选其一)
python3 -m http.server 8000
# 或
npx http-server -p 8000
```

打开 `http://localhost:8000/` 访问。

数据更新流程：
1. 跑 `scraper/run_pipeline.sh` 更新 xlsx
2. 跑 `scripts/build_data.py` 重新生成 JSON
3. 浏览器刷新即可

## 8. 关键设计决策

| 问题 | 决策 | 备选 |
|---|---|---|
| 数据存储 | 本地 JSON 文件 | 内嵌 JS（避开 CORS 但首屏慢）|
| 框架 | Vue 3 CDN | Alpine.js（简但组件化弱）/ React（需 build）|
| 12k 行渲染 | 分页 + 可选无限滚动 | 虚拟滚动 / 服务端分页 |
| 筛选位置 | 左侧抽屉栏 | 顶部 / 高级搜索弹窗 |
| 列宽问题解法 | 卡片化展示，详情弹窗看全字段 | 横向滚动表格（用户已嫌弃） |
| 选科要求 | hardcode 物理+化学+政治 | 设置面板可改（P1） |
| 学科评估筛选 | chip 多选 | 滑块 / 单选 |

## 9. 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| JSON 太大首屏慢 | gzip 后约 1 MB，加 loading 进度；可分批 |
| 浏览器 localStorage 满 | 收藏数据小，不会撞上 5 MB 限制 |
| openpyxl 读公式 cell 拿不到值 | 用 `data_only=True` + 提示用户先在 Excel 保存一次 |
| 自动化 pipeline 跟 web app 数据不同步 | 启动时显示 `generatedAt`；提供"重新拉取"按钮 |
| 用户改了 2026数据 sheet 公式但 raw 没更新 | 文档强调先跑 pipeline，再 build |

## 9.7 V4 增量改造 (User Review Round 4 后)

**Bug fixes**:
- `slim()` → 拆出 `slim_plan()` 加白名单 `{added, removed, kept}` 不丢失, 修 rename 行白屏

**新组件元素**:
- 表头拆 3 子元素: `.th-drag` (拖动) + `.th-text` (排序) + `.th-resize` (调宽), 互不干扰
- `.table-scroll` 容器加 `max-height + overflow:auto`, 实现真正的 sticky 表头
- 展开行 5 section 卡片布局 (学校/专业/对比表/预测/变化)
- 浮动 `›` 按钮 (左侧 fixed) 用于侧栏展开
- 列设置 panel 点空白 mousedown 监听器关闭

**state 改造**:
- `sortBy` 已废弃, 用 `sortKeys` 列表
- 新 `LS_KEY_LAYOUT_v2`: `{sortKeys, sidebarCollapsed, hiddenColumns, columnOrder}`

**默认值**:
- `schoolPriorityRange [1, 18]`, `cityPriorityMax 10`, `majorClassPriorityMax 16`
- `DEFAULT_HIDDEN_COLS = {sp, mp}` (校优/类优默认隐藏)

## 9.6 V3 增量改造 (User Review Round 3 后)

新增列元数据 `COLUMNS`: 17 列, 每列含 `{key, label, width, sortable, sortField, fixed}`,
驱动表头/单元格/排序/列设置/拖动. `DEFAULT_HIDDEN_COLS = {sp, mp}` 默认隐藏.

新增 utils:
- `parse_diff(s)` / `diff_summary(structured)` — 在 Python 端为每条 plan 加 `diffStructured`/`diffSummary`
- `keywordCandidatePool` computed — autocomplete 候选 = 应用其他筛选条件后的子集

新 `--only` 子命令在 `build_data.py`:
- `--only score_rank` 单独重生成一分一段 (用户在 26 分数公布后用)
- `--only plans` / `priority` / `meta` 同理
- `--only all` 默认全量

## 9.5 V2 组件分解 (User Review 后)

```
ScoreTool (顶部)
  └─ 26 分数输入 → 26 位次 → 25 等位分/位次 → 冲稳保 3 按钮

FilterPanel (左侧栏)
  ├─ KeywordAutocomplete  (Item 5)
  │    └─ 4 微妙点: chip vs input / 分组下拉 / 维度 AND / mousedown 拦截
  ├─ 3 段冲稳保 范围 + 启用复选框  (Item 6)
  ├─ PriorityFilter × 3  (Items 1/2/3)
  │    ├─ 学校优先 (mode='range', 双端 + 三档预设)
  │    ├─ 城市优先 (mode='max', 单端)
  │    └─ 专业类优先 (mode='max', 单端)
  └─ 学科评估 / 院校标签 / 开关 (V1 保留)

ResultList
  ├─ table 模式 (默认, Items 7/8/9):
  │    ├─ tier 行着色  (Item 6)
  │    ├─ 列宽 resize: horizontal
  │    ├─ 分页下拉 (默认全部)
  │    └─ 行点击 → 展开 18 字段详情
  └─ list 模式: PlanCard 列表
       └─ tier 左边框 + 右上 chip (Items 6/10)

DetailDrawer (侧边抽屉)  — V1 保留
CompareBar / FavoritesBar — V1 保留
```

## 10. 不做的事（明确边界）

- ❌ 多用户 / 登录 / 权限
- ❌ 数据库
- ❌ 实时爬取（招生计划数据走现有 pipeline）
- ❌ 推荐算法（复杂；P3 才会探索）
- ❌ 服务器部署（家用，本地够用）
- ❌ 手机适配优先级低（桌面优先）
