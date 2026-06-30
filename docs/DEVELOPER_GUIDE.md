# zyhelper · 开发者文档

> 给**维护者 / 二次开发者**看 — 包含数据 pipeline / 架构 / 算法 / 部署细节。
> 用户视角的使用说明 → [USER_GUIDE.md](USER_GUIDE.md)

---

## 📑 目录

- [1. 技术栈](#1-技术栈)
- [2. 仓库结构](#2-仓库结构)
- [3. 数据 pipeline](#3-数据-pipeline)
- [4. 前端架构](#4-前端架构)
- [5. 录取率算法](#5-录取率算法)
- [6. 转专业判定](#6-转专业判定)
- [7. 关键组件](#7-关键组件)
- [8. localStorage schema](#8-localstorage-schema)
- [9. 数据更新流程](#9-数据更新流程)
- [10. 部署](#10-部署)
- [11. 常见坑](#11-常见坑)

---

## 1. 技术栈

| 层 | 选型 |
|----|----|
| 前端 | **Vue 3** (CDN, no build), Composition API |
| 样式 | Tailwind CSS (CDN JIT) + 自定义 CSS |
| 数据 | 静态 JSON (`data/*.json`), 总 ~15 MB |
| 持久化 | localStorage (志愿单 / 配置 / 锁定 / 列布局) |
| 报表 | SVG (录取趋势图) + HTML 模板化 + `window.print()` → PDF |
| 部署 | GitHub Pages, 纯静态, 无后端 |
| 数据 pipeline | Python 3 + openpyxl |

**设计原则**:
- 无构建步骤 — `index.html` + `assets/app.js` 直接部署
- 数据离线 — 用户的所有输入不出浏览器
- 数据生成由 Python pipeline 离线跑, 前端只消费 JSON

---

## 2. 仓库结构

```
new/工具/报考/                    ← web app 部署根 (GitHub Pages)
├── index.html                   ← 入口
├── assets/
│   ├── app.js                   ← 主 Vue app (~7000 行)
│   ├── style.css
│   └── templates/
│       ├── ln_official.html     ← 辽宁招考网 HTML 模板 (官网格式)
│       └── ln_prepick.html      ← 预选模式 模板
├── data/                        ← 由 build_data.py 生成
│   ├── plans.json               ← 12728 条招生计划 (~15 MB)
│   ├── score_rank.json          ← 一分一段 + 等位分
│   ├── priority.json            ← 城市/学校/专业类 优先档
│   └── meta.json
├── scripts/
│   ├── build_data.py            ← 从 xlsx 生成 data/*.json
│   └── writeback_baoyan.py
├── docs/
│   ├── USER_GUIDE.md            ← 用户手册
│   ├── DEVELOPER_GUIDE.md       ← 本文档
│   ├── DEMO_STORYBOARDS.md      ← 演示脚本
│   └── gifs/                    ← 3 个场景演示动图
└── ...

new/报考/高考/招生计划/scraper/   ← 数据 pipeline 工作目录
├── merge_25_26.py               ← 25/26 数据 join + 校内专业配对
├── enrich_25_reference.py       ← 给新增 26 算 25 参考
├── export_raw_sheet.py          ← 输出 2026数据raw sheet
└── out/plan_all_zh.csv          ← 26 招生计划 (scrape 自辽宁招考网)

new/2026高考-物理-志愿_2026.xlsx  ← 数据中转 Excel
  ├── sheet "2025数据"           ← 手工维护的 25 录取数据
  ├── sheet "_2026_internal"     ← merge_25_26 输出
  ├── sheet "2026数据raw"        ← export_raw_sheet 输出
  ├── sheet "分数"               ← 一分一段表 + 等位分 (公式)
  └── sheet "排名"               ← 优先档配置
```

---

## 3. 数据 pipeline

完整数据链路 (跑一次 ~5 分钟):

```
plan_all_zh.csv  ─┐
                   ├──► merge_25_26.py ──► sheet _2026_internal
sheet "2025数据" ─┘                              │
                                                  ▼
                            enrich_25_reference.py
                                                  │
                                                  ▼
                                  export_raw_sheet.py
                                                  │
                                                  ▼
                                        sheet 2026数据raw
                                                  │
                                                  ▼
                                          build_data.py
                                                  │
                                                  ▼
                                          data/*.json  ──► 前端
```

### 3.1 `merge_25_26.py` (校内 25/26 配对)

校际 join: 院校编号优先 → 院校名归一兜底。

校内专业配对 (`match_majors`):
1. **同代号 +0.5 boost** (新加): 当 25/26 同代号 且 完整名 ratio=1.0 且 双侧同名 ≥2 条 时, 候选 ratio +0.5
   - 修复 燕山 Z1/B1 / 长春理工 A4/A5/B3/B6 / 西安石油 Z 系列 等"同校同名多版本"贪心错配
2. **主名 (split_main_name)** 相似度 ≥ 0.7 才进候选
3. **强配规则** (子串包含 / qualifier 同 + Jaccard / items 子集 / 完整名 ≥ 0.8)
4. 贪心一对一: 按 ratio 降序取最优

新加 `derive_contained_majors`: 从 26 招生专业名解析"26所含专业" 写入 sheet, 修复 enrich 中/低 一直为 0 的 bug。

### 3.2 `enrich_25_reference.py` (新增专业 25 参考)

为每行 26 计划算 `25参考最低分 / 最低位次 / 可信度 / 来源`:

| 档位 | 触发条件 | 算法 |
|----|----|----|
| 高 | 25 已 1-1 匹配 | 直接复用 25 行 |
| 中 | 新增, 同校 25 单独同名 | 加权平均 (按 25 人数) |
| 低 | 新增, 同校 25 大类含此专业 | 同上 |
| 本校同类估 | 新增, 同校 25 同 `专业类` | 加权 |
| 本校同门类估 | 新增, 同校 25 同 `专业门类` | 加权 |
| 本校高分估 | fallback | 同校 25 Top 30% 加权 |
| 中外合作估 | 26 含 "中外合作办学" | 同校 25 Bottom 30% |
| 无 | 真新设, 同校 25 无任何 | — |

### 3.3 `build_data.py` (生成 web app JSON)

读 `2026数据raw` sheet → 输出 4 个 JSON。

**自算等位分** (修复 openpyxl save 清掉 XLOOKUP 缓存的反复回归):
不再读 "分数" sheet 的等位分 cell, 改用 Python 在一分一段表里反查:
```python
score26 → rank26 = osr26[score].cumRank
rank26 → score_Y = osr_Y[cumRank>=rank26 第一个 score]   # 等位分
rank_Y = score_to_rank(year, score_Y)
```

---

## 4. 前端架构

### 4.1 Vue 组件

```
createApp({ ... ScoreTool / FilterPanel / ResultList / PlanCard / DetailDrawer /
            CompareBar / FavoritesBar / PrioritySettings / KeywordAutocomplete /
            VoluntaryAnalysis / VoluntaryReport })
            └─ 全局注册:
               AdmitTrendChart        ← SVG 折线 + 阈值滑杆
               AdmitTopSummary        ← 各档 Top 3 + 阈值 Top 5
               TransferRiskSection    ← 转专业风险扫描 (含 compact PDF 模式)
```

### 4.2 状态管理

无 Vuex / Pinia, 直接用 reactive `store` + `ui`:
- `store.allPlans` — 全部 12728 plans (load 一次, ref 不变)
- `store.voluntaryLists` — { listName: ids[] } (多列表)
- `store.voluntaryPinned` / `Pending` / `Backup` — 锁定状态
- `store.transferTargets` / `transferAccepts` — 转专业清单
- `store.priorityOverrides` — 用户对城市/学校/专业类优先的修改
- `ui.*` — 临时 UI 状态 (展开行 / popover 开关 / anchor 手调 / 等)

### 4.3 大计算 — `voluntaryAnalysis` computed

`voluntaryAnalysis` 是核心 computed, 给分析页 + PDF 提供所有派生数据:
- `items` (每条志愿 含 admit / transfer / delta)
- `tiers` (chong/wen/bao/out 分组)
- `byScore` / `bySchool` / `byMajor` / `byCity` / `enrollByScore25` 5 大聚合
- `topByTier` (各档录取率 Top 3) / `topByThreshold` (11 阈值 Top 5)
- `transferSummary` (ok/warn/error 三档)
- `ranges` / `anchor25` / `anchorRank25` / `insights`

---

## 5. 录取率算法

```javascript
function computeAdmitProb(plan, ctx) {
  const SCALE = 1500, BIAS = 0.4;
  const r25  = plan.ref25Rank || plan.rank25;
  const ravg = plan.avgRank;
  const refRank = (r25 && ravg) ? round((r25 + ravg) / 2) : (r25 || ravg);

  const heat   = majorHeat(plan);
  const heatPct = ctx.ignoreHeat ? 0 : heat.pct;
  const effPlanRank = refRank * (1 + heatPct);

  const diff      = effPlanRank - ctx.userRank25;
  const probBase  = 1 / (1 + Math.exp(-diff / SCALE - BIAS));

  const supply    = ctx.supplyMap?.get(plan.ref25Score);
  let supplyAdj   = 0;
  if (supply?.ratio > 0.85)      supplyAdj = 0.10;
  else if (supply?.ratio > 0.5)  supplyAdj = 0.05;

  const prob = clamp(probBase + supplyAdj, 0.02, 0.98);
  return { prob, ... };
}
```

**专业热度** (`majorHeat`):

| 专业 | 调整 (pct) |
|----|----|
| 电子信息 / 集成电路 / 通信 / 微电子 | -4% |
| 计算机 / 软件 / 数据科学 / 人工智能 / 网络安全 | -3% |
| 自动化 / 智能科学 / 控制 | -1.5% |
| 机械 / 智能制造 / 工业工程 | -0.5% |
| 统计 / 大数据 | 0 |
| 车辆 | +0.5% |
| 能动 / 新能源 | +1% |
| 其它 | 0 |

负值 = 该专业实际录取分会比历史值高 (热门), 等效于把 plan 位次"调更靠前" (effPlanRank 变小, diff 变小, 概率下降)。

**供给率** = 该 25 分对应的 26 总招生数 / 26 同分人数。> 0.85 时招生充足, +10pp。

**新增专业** (`isNew === "新增"`): 用 plan 自己的 `ref25Score + 5` 反查位次代替 refRank, 标 `isEstimated: true`。

---

## 6. 转专业判定 (`classifyTransfer`)

```javascript
function classifyTransfer(plan, targetSet, acceptSet) {
  // 步骤 1: 主名直接在清单 → 单专业判定
  const main = mainNameOf(plan.majorName26 || plan.majorName25);
  if (targetSet.has(main)) return { level: "ok", ... };
  if (acceptSet.has(main)) return { level: "warn", ... };

  // 步骤 2: 大类 — 看 containedMajors
  const majors = plan.containedMajors?.length
    ? plan.containedMajors
    : extractMajorsFromName(plan.majorName26);
  const matchedTargets = majors.filter(m => targetSet.has(m));
  const matchedAccepts = majors.filter(m => acceptSet.has(m));
  if (matchedTargets.length) return { level: "ok", ... };
  if (matchedAccepts.length) return { level: "warn", ... };
  return { level: "error", ... };
}
```

主名优先解决 "数据科学与大数据技术(大类招生,项目选拔进入,...)" 类描述性括号被误拆成 list 的问题。

---

## 7. 关键组件

### `AdmitTrendChart` (SVG 折线)

- 互动: 阈值滑杆 (step 1, 0-99%) / Y 轴点击 / 直方图柱点击 / SVG 任意点击
- Hover tooltip 含 学校 / 专业 / 25 分位次 / Δ / 热度 chip / (估) / 阈值首达提示
- `compact=true` (PDF 模式): 关掉互动, 隐藏 hover

### `AdmitTopSummary`

各档 Top 3 (3 列彩色 grid) + 阈值 Top 5 (11 × 5 单表)。复用于分析页 + PDF。

### `TransferRiskSection`

3 档汇总卡 + 展开详细表 + 双栏 textarea 编辑 (互动模式) / 只读清单 (compact PDF 模式)。

### `VoluntaryReport` (PDF 报告组件)

15 section, 用 `@media print` CSS 控制打印分页。

---

## 8. localStorage schema

| Key | 内容 |
|----|----|
| `zyhelper_voluntary_lists_v2` | `{ listName: ids[] }` 多志愿单 |
| `zyhelper_voluntary_active_v2` | 当前激活的 listName |
| `zyhelper_voluntary_pinned_v1` | `{ listName: ids[] }` 锁定项 |
| `zyhelper_voluntary_pending_v1` | `{ listName: ids[] }` 待确认 |
| `zyhelper_voluntary_backup_v1` | `{ listName: snapshot }` 撤销 |
| `zyhelper_priority_overrides_v1` | 用户对城市/学校/专业类优先档的修改 |
| `zyhelper_plan_overrides_v1` | 用户对单个 plan 字段的覆盖 (例改分数) |
| `zyhelper_presets_v2` | 筛选预设 list |
| `zyhelper_ui_v1` | UI 临时状态 (myScore, 各种 popover, 展开行) |
| `zyhelper_transfer_targets_v1` | 转专业 目标专业 list |
| `zyhelper_transfer_accepts_v1` | 转专业 可接受 list |
| `zyhelper_fav_v1` | 收藏 ids[] |
| `zyhelper_layout_v1` | 列宽 / 顺序 / 隐藏 |

迁移: 改 schema 时尽量 LS 内部做向后兼容迁移, 而不是 bump version key (会丢用户数据).

---

## 9. 数据更新流程

每年招生计划发布后:

```bash
# 1. 爬最新 plan_all_zh.csv (略, 见 scraper/)

# 2. 把 25 录取数据填到 sheet "2025数据" (人工)

# 3. 把当年一分一段表填到 sheet "分数" (人工)

# 4. 跑 pipeline (约 5 分钟)
cd new/报考/高考/招生计划/scraper
python3 merge_25_26.py        # 校际+校内配对
python3 enrich_25_reference.py # 新增专业 25 参考
python3 export_raw_sheet.py    # 输出 2026数据raw

cd new/工具/报考
python3 scripts/build_data.py  # 生成 data/*.json

# 5. 改 index.html 的 cache-bust 参数 ?v=xxx

# 6. commit + push, GitHub Pages 自动部署
git add -A && git commit -m "data: update for ..." && git push
```

---

## 10. 部署

GitHub Pages, 仓库 `descreekert/zyhelper`, branch `main`, path `/`。

push 后 ~30s 生效。访问 <https://descreekert.github.io/zyhelper/>。

每次代码改动后 改 `index.html` 中的 `?v=...` cache-bust 参数, 强制用户拉新 JS。

---

## 11. 常见坑

| 坑 | 解决 |
|----|----|
| **`openpyxl.save()` 清掉 XLOOKUP 缓存** | `build_data.py` 不再读 Excel 等位分 cell, 自算 (见 §3.3) |
| **同校同名多代号 plan 贪心错配** | `match_majors` 加同代号 +0.5 boost (见 §3.1) |
| **26所含专业 None 导致 enrich 中/低=0** | `merge_25_26.derive_contained_majors` 从专业名解析 |
| **Vue 3 v-for 与 v-if 在同元素 v-if 优先级高** | 用 `<template v-for>` + 内层 `v-if` |
| **Element UI 表格 SVG 数据-v-XXX 属性** | 模板化导出时透传 sample `data-v-` 属性, 保留视觉一致 |
| **Tailwind CDN JIT 动态 class** | 颜色不要用 `bg-${color}-500`, 用 if-else 静态 class |

---

## 12. 测试 / 调试

- 浏览器 DevTools Console 可直接访问 `localStorage.getItem("zyhelper_ui_v1")` 等
- 改 `data/plans.json` 直接 reload 看新数据 (无需 cache-bust)
- 想完全 reset: `localStorage.clear(); location.reload()`
- 数据校验脚本 (one-off): 见 `scripts/build_data.py` 末尾的 `统计` 输出 (总 plans / 停招 / 中外合作 / 学校数)

---

## 13. License & 反馈

MIT (待加 LICENSE). Issues / PR: <https://github.com/descreekert/zyhelper/issues>
