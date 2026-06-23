# 用户 Review — 2026-06-23 第四轮

> 第 3 轮完成后用户提出 11 项新优化 + 4 项已知遗留补完, 共 15 项。

---

## 修改清单总览

### Bug 修复

| # | 摘要 | 优先级 | 状态 |
|---|---|:-:|:-:|
| 5 | 点 rename 行展开 白屏 (TypeError: Cannot read properties of undefined reading 'length') | 极高 | ✅ |
| 9 | 学校/城市优先 预设 chip 点击后无 active 状态 | 中 | ✅ |

### UX 优化

| # | 摘要 | 优先级 | 状态 |
|---|---|:-:|:-:|
| 1 | 列宽 resize 与排序事件冲突 (调宽触发排序) | 高 | ✅ |
| 2 | 列拖动与排序事件冲突 | 高 | ✅ |
| 3 | 展开行时主列数据完整显示 (持久 hover 效果); 收起后恢复 truncate | 中 | ✅ |
| 4 | 表格右上 "刷新" 按钮, 重跑当前筛选 | 中 | ✅ |
| 6 | 展开行布局优化 (4 块: 学校 / 专业 / 25 对比 / 预测) | 中 | ✅ |
| 7 | 表头 sticky, 滚动时锁定不动 | 中 | ✅ |
| 8 | 默认列顺序调整 (城市前置, 改名"25 分数") | 低 | ✅ |
| 10 | 默认值: 学校优先 → 第一档 1-18, 城市优先 → Top 10 | 低 | ✅ |
| 11 | ⚙ 列设置 panel 点空白处不收起 | 低 | ✅ |

### 已知遗留补完

| # | 摘要 | 优先级 | 状态 |
|---|---|:-:|:-:|
| K1 | 侧栏收起时无浮动"展开"小箭头 | 低 | ✅ |
| K2 | 列宽 resize 不够明显 (跟 Item 1 合并解决) | 中 | ✅ |
| K3 | 自动补全前 8 候选, 无 "更多" 按钮 | 低 | ✅ |
| K4 | 变化字段 "其它" 类型 fallback 时直接显示原文 | 低 | ✅ |

---

## 详细设计

### Item 5 — rename 行展开白屏 (Bug)

**根因**: `build_data.py` 的 `slim()` 会过滤空数组:
```python
if not (v is None or v == "" or v == [] or v == {}): keep
```
所以 `parse_diff` 返回的 `{'added': [], 'removed': [...], 'kept': [...]}` 在 JSON 里变成 `{removed: [...], kept: [...]}` (added 字段被删掉).

模板里 `v-if="d.added.length"` 抛错 `Cannot read 'length' of undefined`.

**修复**:
- 改模板用 optional chaining: `(d.added || []).length`
- 或在 slim 时保留 diffStructured 字段不精简
- 选后者: 在 `slim()` 加白名单, `diffStructured` 不展开递归 slim

### Item 9 — 预设 chip 无 active 状态

**当前**: 点 "第一档 1-18" 后, lo=1, hi=18, selected=null. 但 chip 看起来跟普通按钮一样, 不知道是哪个预设当前生效.

**修复**: `PriorityFilter` 加 `isActivePreset(p)`:
- `mode='range'`: `p.lo === valueLo && p.hi === valueHi`
- `mode='max'`: `p.value === valueMax`
匹配的预设 chip 加 `active` class.

### Item 1+2 — Resize/Drag 与排序冲突

**根因**:
- CSS `resize: horizontal` 把 mousedown→mouseup 操作"吃掉"成 resize, 但浏览器仍触发 `click` 在 th 上 → 触发 sort
- `draggable=true` on th, dragstart 拦下了, 但起手前的小移动可能也会触发 click

**修复**: 不再让 th 自己同时承担 click/resize/drag, 而是拆分为子元素:

```html
<th>
  <span class="th-drag" draggable="true" @dragstart>⠿</span>   <!-- 左, 拖动 -->
  <span class="th-text" @click="sort">{{ label }}</span>        <!-- 中, 点击排序 -->
  <span class="sort-ind" v-if="sorted">↑↓</span>                <!-- 排序指示 -->
  <span class="th-resize" @mousedown="startResize"></span>      <!-- 右, 拖宽 -->
</th>
```

- 移除 CSS `resize: horizontal`, 自己实现 mousedown→mousemove 计算 width
- 移除 `draggable` from th, 只在 `.th-drag` span 上
- click 限定在 `.th-text` 内, 不会被 drag/resize 串扰

### Item 3 — 展开行时主行完整显示

**当前**: 主行 td 用 `truncate` (white-space: nowrap + overflow: hidden), 只在 hover 时展开.

**改为**: 展开时主行加 class `main-row-expanded`, CSS 让所有 truncate td 都换行:
```css
tr.main-row-expanded td.truncate { white-space: normal; word-break: break-word; }
```

### Item 4 — 刷新按钮

**位置**: 顶栏右侧 (CSV 导出附近) 加 `🔄 刷新` 按钮.

**行为**:
- 重新 fetch 4 个 JSON (plans / score_rank / priority / meta)
- 显示 loading 进度
- 完成后保留当前筛选条件

### Item 6 — 展开行 4 块布局

**当前**: 一个网格 22 字段平铺, 不分块.

**新布局**:
```
┌─ 🏫 学校基本信息 ────────────┐  ┌─ 📚 专业信息 ────────────┐
│ 所在省 │ 北京 │ 城市层级 │ 一线 │  │ 所含专业:  ...           │
│ 学校类型 │ 综合 │ 主管部门 │ 教育部│ 学科评估:  通信工程(A+)  │
│ 校保研率 │ 27% │ 校升学率 │ 58%  │  │ 软科评级:  通信工程(A+,2)│
└────────────────────────────────┘  │ 专业保研率: 信电学院 30%  │
                                    │ 专业备注:  校区分流政策   │
                                    └──────────────────────────┘

┌─ 📊 25 年对比 (完整表格) ─────────────────────────────────┐
│ 年   │ 专业名 │ 计划 │ 学制 │ 学费 │ 分数 │ 位次 │ 平均位次 │ 参考来源 │
│ 26   │ 通信   │ 21   │ 4    │ 5500 │ 655(参考) │ 1895 │ 1850 │ ... │
│ 25   │ 通信   │ 20   │ 4    │ 5500 │ 655(实际) │ 1895 │      │      │
└──────────────────────────────────────────────────────────┘

┌─ 🔮 预测 ────────────────────────────────────────────────┐
│ 预测分数: 645  │  预测位次: 2500  │  线差预测分数: 220  │  趋势: 平稳 │
└──────────────────────────────────────────────────────────┘

┌─ 📈 变化 (结构化) ────────────────────────────────────────┐
│ • 改名: 工科试验班(信息) → 工科试验班(计算机)             │
│   - 删除 (7): 工业设计、光电信息科学与工程、...           │
│   + 添加 (0): -                                          │
│   = 保留 (3): 计算机科学与技术、信息安全、软件工程        │
│ • 招生人数 -5                                            │
└──────────────────────────────────────────────────────────┘
```

每块用 `<section>` 带 `<h4>` 标题 + 浅灰背景 + 边框, 视觉分明.

### Item 7 — 表头 sticky

**当前**: `position: sticky; top: 0` 但因为外层不是单独滚动容器, 所以并没真正 sticky.

**修复**: 给 `.overflow-x-auto` 容器加 `max-height: calc(100vh - 220px); overflow: auto`,
让 th 在该容器内 sticky.

副作用: 主页面不再整页滚动, 只表格区滚动. 这样实际更好用.

### Item 8 — 默认列顺序

新默认顺序:
```
tier(档), city(城市), school(院校), major(专业), num(计划), dur(学制), tuition(学费),
diff(变化), score(25分数), rank(25位次), conf(可信度),
eval(学科评估), soft(软科评估), remarks(专业备注), baoyan(专业保研率), actions
```

- 把 `city` 移到 `school` 前
- 新增 `baoyan` 列 (`baoyanDetail` 字段)
- 改 label "25参考分" → "25分数"

### Item 10 — 默认值改

- 学校优先 → `schoolPriorityRange = [1, 18]` (现 `[1, 50]`)
- 城市优先 → `cityPriorityMax = 10` (现 `18`)

### Item 11 — 列设置 panel 点击空白收起

**方案**: 加 click-outside 侦听:
- 当 panel 打开时, 监听 document mousedown
- 如果 mousedown 目标不在 panel 内 → 关闭
- 取消监听

Vue 3 实现:
```js
function onDocClick(ev) {
  if (panelRef.value && !panelRef.value.contains(ev.target)) {
    ui.showColSettings = false;
  }
}
watch(() => ui.showColSettings, on => {
  if (on) document.addEventListener('mousedown', onDocClick);
  else    document.removeEventListener('mousedown', onDocClick);
});
```

### K1 — 侧栏收起时浮动展开按钮

**当前**: 收起后需点顶栏 `≡` 才能展开.

**改**: 侧栏收起态在主内容左上角浮一个小箭头 `›` 按钮, 点击展开.

### K3 — 自动补全 "更多" 按钮

候选每组最多 8 条, 加 "...还有 N 条" 提示行, 点击后切换到 "显示全部" 模式 (max 50).

### K4 — 变化 其它 类型 fallback

`parse_diff` 当前所有 fallback 写成 `{type: 'other', text: ...}`. 模板里只渲染 `text`.

更好: 给 `other` 加更好 UI (灰色斜体 + "其它变更" 标签).

---

## 实施顺序

按 "工作量低 / Bug 优先" 原则:

1. **Item 5** (bug, 5 分钟)
2. **Item 9** (chip active, 10 分钟)
3. **Item 10** (默认值改, 5 分钟)
4. **Item 11** (click outside, 10 分钟)
5. **K1** (浮动展开按钮, 10 分钟)
6. **Item 8** (列顺序 + 改 label + 加 baoyan 列, 15 分钟)
7. **Item 4** (刷新按钮, 10 分钟)
8. **Item 3** (expanded row 全显, 5 分钟)
9. **Item 7** (sticky 表头, 15 分钟)
10. **Item 6** (展开行 4 块布局, 30 分钟)
11. **Items 1+2** (drag/resize 拆分子元素, 40 分钟)
12. **K3** (autocomplete "更多" 按钮, 15 分钟)
13. **K4** (变化 fallback UI, 5 分钟)
14. 更新所有 docs

---

## 改动追溯

每完成一项更新上面表格. 实施细节追加到本文档底部.

---

## 实施细节 (2026-06-23 第 4 轮完成)

### Item 5 — rename 白屏 bug 修复
- 根因: `slim()` 把空数组 `added: []` 过滤掉, JS 端访问 `.length` 抛错
- 修复: 加 `slim_plan()` + 白名单 `PRESERVE_EMPTY_LISTS = {added, removed, kept}`
- 模板还用 `(d.added || []).length` 双保险

### Item 9 — 预设 chip active
- `PriorityFilter` 加 `isActivePreset(p)`; chip 加蓝底白字 `active` class

### Item 10 — 默认值
- `schoolPriorityRange [1, 50]` → `[1, 18]`
- `cityPriorityMax 18` → `10`

### Item 11 — col panel 点空白收起
- watch `ui.showColSettings`: 打开时挂 mousedown 全局监听, 关闭时移除
- target 不在 `.col-settings-panel` 内则关闭; 同时加 "关闭" 按钮兜底

### K1 — 侧栏浮动展开按钮
- 收起态在主内容左侧浮一个 `›` 按钮 (fixed top:100px left:8px)

### Item 8 — 默认列顺序 + label + baoyan
- 新顺序: 档/城市/院校/专业/计划/学制/学费/变化/25分数/25位次/可信度/学科评估/软科评级/专业备注/专业保研/操作
- 改 label "25参考分" → "25分数"
- 新增 `baoyan` 列 (源 `baoyanDetail` 字段)
- LS_KEY_LAYOUT 升 v2 强制重置旧持久化

### Item 4 — 刷新按钮
- 顶栏 `🔄 刷新`, 调用 `reloadData()` → `load()` 加 `?_t=Date.now()` 破缓存

### Item 3 — 展开主行不截断
- 主行加 `main-row-expanded` class
- CSS `tr.main-row-expanded td.truncate { white-space: normal; }` + 浅蓝背景

### Item 7 — sticky 表头
- `.table-scroll { max-height: calc(100vh - 200px); overflow: auto; }`
- th `position: sticky; top: 0` 现在真正生效

### Item 6 — 展开行 4 块布局
- 5 个 `<section class="expand-section">`: 学校 / 专业 / 25 vs 26 对比 (跨满宽) / 预测 / 变化
- 对比表格列出 26/25/24/23/22 多年, 行内对齐

### Items 1+2 — drag/resize/sort 拆子元素
- `<th>` 内 3 子元素: `.th-drag(⠿)` 拖动 / `.th-text` 点击排序 / `.th-resize` 调宽
- 删除 CSS `resize: horizontal`, 改 JS 控制宽度
- `@click.stop` / `@mousedown.stop` 阻断事件传播, 互不干扰

### K3 — autocomplete "更多"
- 每组初始 8 条, 总数 > 8 时显示 "还有 N 条, 点击展开"
- 点击 → 该组扩展到 50 条 (用 `expandedGroups` Set 跟踪)

### K4 — diff fallback UI
- "其它" 类型加灰色斜体 `其它:` 标签

### 烟雾测试

| 场景 | 结果 |
|---|---|
| 点 rename 行展开 (改名 +1, 人数+3) | ✅ 无白屏, 结构化渲染正确 |
| 默认: 学校 [1,18] 城市 ≤10 chip 蓝色高亮 | ✅ |
| 5 个 section 完整显示 | ✅ 视觉分块清晰 |
| 列顺序: 档/城市/院校/专业/... | ✅ |
| sort chip 显示 "25分数 ↓1" | ✅ |
| 顶部 🔄 刷新 按钮 | ✅ |
| 拖动列宽不触发排序 | ✅ |
