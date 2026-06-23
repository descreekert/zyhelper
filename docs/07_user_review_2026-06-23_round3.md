# 用户 Review — 2026-06-23 第三轮

> 第 2 轮完成后用户感觉"非常好", 第 3 轮提出 8 项进一步优化 (6 web app + 2 数据)。

---

## 修改清单总览

### Web App 部分

| # | 类别 | 摘要 | 优先级 | 状态 |
|---|---|---|:-:|:-:|
| 1 | 布局 | 左侧筛选可收起/展开 | 高 | ✅ |
| 2 | 表格 | 变化/专业备注/软科评级/学科评估 同时在表头列+展开行显示 (列保留, 展开行补全) | 中 | ✅ |
| 3 | 表格 | 列内容截断时 hover 显示完整 / 自动换行 | 中 | ✅ |
| 4 | 表格 | 新/停招/变化 tag 放专业名前面 (加变化 tag) | 低 | ✅ |
| 5 | 配色 | 学校 985/211 标签色系调淡 (不要太扎眼) | 低 | ✅ |
| 6.1 | 表头 | 点击表头多列排序 (tag 类型, 可调顺序/删除/切升降) | 高 | ✅ |
| 6.2 | 表头 | 表头列可拖动切换位置 | 中 | ✅ |
| 6.3 | 表头 | 表头列可隐藏 | 中 | ✅ |
| 7 | 自动补全 | 自动补全候选 ∈ 其他筛选条件结果 (方案 1) | 高 | ✅ |

### 数据层 (与原始 xlsx 相关)

| # | 摘要 | 优先级 | 状态 |
|---|---|:-:|:-:|
| 数据-1 | 预留 2026 一分一段 后续重新导入接口 (build_data.py 模块化) | 中 | ✅ |
| 数据-2 | "变化"字段的专业改名 diff 重新格式化 (加/删/前缀 结构化) | 高 | ✅ |

---

## 详细设计

### Item 1 — 侧栏收起/展开

**设计**:
- 顶栏左侧加 `[≡]` 按钮
- store.sidebarCollapsed: bool (localStorage 持久化)
- 收起时: 侧栏宽 80px → 0 (CSS transition); 主内容 flex-1 自动撑开
- 收起后保留一个"展开"小箭头按钮悬浮在主内容左上角

### Item 2 — 同时在表头列 + 展开行显示

**用户原意**: 不是挪走, 是"双显示"。表格列保留 (列宽不够时可能被截断), 同时在展开行也显示这些字段, 这样用户展开后能看到完整内容。

**改动**:
- 表格保留 学科评估 / 软科评级 / 变化 / 专业备注 4 列
- 展开行新增这 4 个字段 (之前未显示):
  - **变化** (完整 diff, 长字符串可换行)
  - **专业备注** (校区/分流/转专业 政策)
  - **学科评估** (完整列表, 不截断)
  - **软科评级** (完整列表)
- 展开行从 18 → ~22 字段

### Item 3 — hover 显示完整 + 换行

**两套方案 (二选一或都做)**:

A. **CSS hover 强制换行 (简洁)**:
```css
td.truncate:hover {
  white-space: normal;
  word-break: break-all;
  background: #fff;
  position: relative;
  z-index: 2;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
```
鼠标移上即换行显示完整内容。

B. **title 属性 (浏览器 tooltip)**:
已经在 td 上有 `:title="p.diff"`, 浏览器原生 tooltip 显示完整。

→ **本版两者都用**: title 是兜底, hover 换行是更好的视觉体验。

### Item 4 — Tag 顺序 + 加变化 tag

**当前**: `{{ majorName }} [停招] [新] [中外]`
**改为**: `[变化] [新] [停招] [中外] {{ majorName }}`

新增 "变化" tag (橘色 `#ea580c` / 浅橘背景), 显示规则:
- plan.diff 非空 且 不是 "新增" 也不是停招 → 显示 "变"
- hover 时显示完整 diff (后续接 Item 数据-2 重格式化)

### Item 5 — 学校标签色系调淡

**当前**:
| Tag | 当前 | 新 |
|---|---|---|
| 985 | `#dc2626` (red-600) | `#b91c1c` 转 `#f87171` 半透明 / 或 `#fee2e2` 底 + `#b91c1c` 字 |
| 211 | `#ea580c` (orange-600) | 改 `#fed7aa` 底 + `#c2410c` 字 |
| 双一流 | `#d97706` | `#fef3c7` 底 + `#a16207` 字 |
| 国重点 | `#65a30d` | `#dcfce7` 底 + `#15803d` 字 |
| 省重点 | `#16a34a` | `#d1fae5` 底 + `#16a34a` 字 |
| 保研资格 | (新加) | `#e0e7ff` 底 + `#4338ca` 字 |
| 其他 | `#64748b` | `#f1f5f9` 底 + `#64748b` 字 |

**风格统一**: 浅底色 + 深字, 像 GitHub label 风格, 不刺眼。

### Item 6.1 — 多列排序

**状态**:
- 删除 `store.sortBy: "ref25Score-desc"` (单一字符串)
- 改为 `store.sortKeys: [{field, dir}]`, 默认 `[{field: 'ref25Score', dir: 'desc'}]`

**UI**:
- 表头列每个有排序键的, 点击切换:
  - 未排序 → 添加为 asc, 加 `↑1` (序号)
  - 已 asc → 改 desc, 显示 `↓1`
  - 已 desc → 移除
- 排序顺序: 头一个 = 主排序, 第二 = 次排序…
- 顶部排序栏改为 tag 列表: `[25参考分 ↓1 ×] [学校优先 ↑2 ×]`, 可拖动调整顺序

**算法** `applyMultiSort(plans, sortKeys)`:
```js
return [...plans].sort((a, b) => {
  for (const {field, dir} of sortKeys) {
    const sign = dir === 'desc' ? -1 : 1;
    const av = getField(a, field), bv = getField(b, field);
    if (av == null && bv == null) continue;
    if (av == null) return 1;
    if (bv == null) return -1;
    const c = typeof av === 'string' ? av.localeCompare(bv) : (av - bv);
    if (c !== 0) return sign * c;
  }
  return 0;
});
```

### Item 6.2 — 列拖动重排

**状态**: `store.columnOrder: string[]` (列 key 数组), localStorage 持久化

**UI**: HTML5 `draggable="true"` on th
- `@dragstart`: 记录 sourceKey
- `@dragover.prevent` + `@dragenter`: 高亮目标
- `@drop`: 用 splice 重新排列

**重置按钮**: 顶栏加 "↺ 重置列" 一键回默认

### Item 6.3 — 列隐藏

**状态**: `store.hiddenColumns: Set<key>`, localStorage 持久化

**UI**: 表格右上加 "⚙ 列设置" 按钮 → 弹出 checklist:
```
☑ 院校        ☑ 城市
☑ 专业        ☑ 计划
☑ 学制        ☑ 学费
☑ 25参考分    ☑ 25参考位次
☑ 可信度      ☑ 操作
```
取消勾选 → 隐藏列

### 数据-1 — 一分一段重导入接口预留

**当前**: `scripts/build_data.py` 一次性生成所有 JSON。

**改造**: 加命令行参数支持子集重生成。
```bash
python3 scripts/build_data.py            # 全部
python3 scripts/build_data.py --only score_rank   # 只重生成一分一段
python3 scripts/build_data.py --only plans        # 只重生成招生计划
python3 scripts/build_data.py --only priority     # 只重生成优先次序
python3 scripts/build_data.py --only meta         # 只重生成元数据
```

**注意**: `build_meta` 依赖 plans, 所以 `--only score_rank` 不会触发 plans 重读, 但应该可以单独跑。需要解耦。

### Item 7 — 自动补全候选与其他筛选条件关联

**当前问题**: 自动补全候选基于全量 12728 plans, 不受其他筛选影响。
用户已选 `学校优先 ≤ 18` 时, 搜 "电子信息" 仍会出现非 Top 18 学校的专业 → 选了发现结果为空。

**方案 1 (采纳)**: 候选范围 = 应用其他所有筛选条件后的子集。

**实现**:
- 新 computed `keywordCandidatePool`: 用 `applyFilters(allPlans, filters with 关键词维度清空)` 算出
- 把这个 pool 传给 `KeywordAutocomplete` 而非 `store.allPlans`
- 下拉顶部加提示: "在当前筛选 N 条结果内补全"

**为什么清空关键词维度**: 否则已 picked 的 chip 会进一步限制候选,
变成"已选南京大学后, 搜专业只能看到南京大学的专业" — 这是合理的。
但如果用户想换个学校, 把 pickedSchool 也算进去就锁死了 — 所以只清自身关键词4 维, 其它维度照常生效。

### 数据-2 — 变化字段 diff 重格式化

**当前格式 (xlsx 直接来)**:
```
招生专业改名: 理科试验班类(数理科学类)(数学与应用数学、信息与计算科学、统计学、物理学、应用物理学、声学、天文学、大气科学、应用气象学) → 理科试验班类(数理科学类)(数学与应用数学、信息与计算科学、统计学、物理学、应用物理学、声学); 
```

**期望格式 (结构化)**:
```
专业删除: 天文学、大气科学、应用气象学
专业前缀: 理科试验班类(数理科学类) (未变)
```

**算法**:

1. 用正则匹配模式 `(?P<head>.*?) → (?P<tail>.*)`
2. 对 head / tail 提取最外层括号内的逗号列表:
   - 头部前缀 (括号外或第一个括号) 相同 → 标"前缀:" "(未变)"
   - 不同 → 标"前缀改:" "X → Y"
3. 内括号内列表 = `set(tail) - set(head)` = 新增 / `set(head) - set(tail)` = 删除 / `set(head) ∩ set(tail)` = 保留
4. 输出短摘要 + 完整 diff (折叠/展开)

**实现位置**: 在 `build_data.py` 的 `parse_diff(s)` 函数, 加到每个 plan 的 `diffStructured` 字段。

**Web 渲染**:
- 表格列只显示精简: `+3 / -2` 或 `改名: 删 天文学等3项`
- 展开行显示完整结构化 diff

---

## 实施顺序 (按依赖 + 工作量)

低工作量 / 独立 (先做):
1. Item 4 — tag 顺序 (10 分钟)
2. Item 5 — 标签色系 (10 分钟, 改 CSS)
3. Item 3 — hover/换行 (15 分钟, 改 CSS)

中工作量:
4. Item 1 — 侧栏 collapse (30 分钟, 加 state + transition)
5. Item 2 — 列挪展开行 (30 分钟, 调表格布局)
6. 数据-1 — build_data.py 模块化 (20 分钟)

高工作量:
7. Item 6.1 — 多列排序 (1 小时, sortKeys 状态 + 排序栏)
8. Item 6.3 — 列隐藏 (40 分钟, columns 元数据 + checklist)
9. Item 6.2 — 列拖动 (1 小时, drag-drop 事件)
10. 数据-2 — 变化字段 diff (1 小时, parse 算法)

总估计 ~6 小时实施。

---

## 改动追溯

每个 item 完成后在上面表格更新状态 (❌ → ✅), 并在下面追加 "实施细节" 小节。

---

## 实施细节 (2026-06-23 第 3 轮完成)

### Item 1 — 侧栏收起/展开
- `store.sidebarCollapsed` (bool, localStorage 持久化)
- 顶栏左上 `≡` 按钮切换
- `<aside class="sidebar">` 加 `transition-all duration-200`, width 80 → 0
- `v-if="!store.sidebarCollapsed"` 跳过内部渲染

### Item 2 — 表头列+展开行双显示
- 表头列保留 (学科评估/软科/变化/专业备注) 仍可见
- 展开行新增 4 个完整字段, 用 `expand-full` class 允许换行不截断
- 展开行字段总数从 18 → 22

### Item 3 — hover 显示完整 + 换行
- CSS `tbody tr:hover td.truncate { white-space: normal; word-break: break-word; }`
- 单元格 hover 时升 z-index + 加阴影, 用户能看到完整内容

### Item 4 — Tag 顺序 + 加变化 tag
- 卡片 + 表格: `<新> <停> <变> <中外>` 放在 majorName 前
- 新增 `badge-diff`: 橘色背景, 仅在 `plan.diff && !isStopped && isNew !== '新增'` 时显示, title 显示原文

### Item 5 — 标签色系调淡
- 985/211/双一流/国重点/省重点/保研资格 改为 GitHub label 风格 (浅底深字 + 1px 浅边框)
- 不再扎眼

### Item 6.1 — 多列排序 + tag 条
- 替换 `store.sortBy` (字符串) 为 `store.sortKeys: [{field, dir}]`
- 表头点击: 未排序 → asc → desc → 移除 (3 态循环)
- 顶部 sort chip 列表: 显示序号 + ↑↓ + ×; chip 可拖动调整顺序
- 列表为空时显示 "点击表头添加"

### Item 6.2 — 列拖动
- `store.columnOrder: string[]` (localStorage 持久化, null = 默认)
- HTML5 `draggable=true` on `<th>`, dragstart 记录 source, drop 时 splice 重排
- 拖动通过 `@col-drop` 事件冒泡到主 app, 由主 app 更新 columnOrder

### Item 6.3 — 列隐藏
- `store.hiddenColumns: Set<string>` (默认隐藏 `sp` / `mp` 两个优先次序列, 减少屏幕压力)
- 顶部右上 "⚙ 列" 按钮 → checklist 弹出
- "重置" 按钮一键恢复默认隐藏

### Item 7 — 自动补全联动筛选
- 新 computed `keywordCandidatePool`: `applyFilters(allPlans, {...filters, keyword:'', picked*: null})`
- `FilterPanel :plans` 从 `store.allPlans` 改为 `keywordCandidatePool`
- 下拉顶部加提示 `📍 在当前筛选 N 条结果内补全`
- 验证: 输入 26 分 620 后, 提示从 "700 条" 变为 "386 条"

### 数据-1 — build_data.py 模块化
- 新 `argparse --only [plans|score_rank|priority|meta|all]`
- 单独 4 个 `build_*_json(wb, out_dir)` 函数, 互相解耦
- 用例: 26 一分一段更新后, `python3 scripts/build_data.py --only score_rank` 一行搞定
- meta 仍依赖 plans, 如果 `--only meta` 会自动重读 plans (不写文件)

### 数据-2 — 变化字段 diff 重格式
- `parse_diff(diff_str)` 解析为 list of structured dict, 5 种类型:
  - `rename`: oldPrefix / newPrefix / prefixSame / added / removed / kept (4 个 list)
  - `num`: delta (整数)
  - `tuition`: from / to
  - `new` / `stopped`: text
- `diff_summary(structured)` 生成短摘要 (供表格列): `改名 +3-2, 人数-5`
- 每个 plan 加 `diffStructured` + `diffSummary` 字段
- web app 展开行用 `<ul>` 渲染结构化, 用颜色标记 +添加 (绿) / -删除 (红) / =保留 (灰)

### 验收

| 测试场景 | 结果 |
|---|---|
| 侧栏 ≡ 收起 → 表格全屏 | ✅ |
| 表头点击 学费 → 加入排序 → tag "2. 学费 ↑" | ✅ |
| ⚙ 列 弹出 → 取消勾选某列 → 该列消失 | ✅ |
| 表格变化列显示 "改名 +0-2, 人数-1" | ✅ |
| 展开行结构化 diff: + 添加 / − 删除 / = 保留 各自带颜色 | ✅ |
| 自动补全提示 "在当前筛选 N 条内补全", N 随筛选变化 | ✅ (700 → 386) |
| `python3 build_data.py --only score_rank` 只重生成 score_rank.json | ✅ |
