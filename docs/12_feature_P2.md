# P2 三件套

> P1 完成后, 进入 P2 (锦上添花): 预设 / URL 分享 / 暗黑模式.

## 子功能

| # | 名称 | 描述 |
|---|---|---|
| P2.1 | 筛选预设 | 保存当前所有筛选条件为命名预设, 一键加载 |
| P2.2 | URL hash 分享 | 把筛选编码进 URL hash, 别人打开自动应用 |
| P2.3 | 暗黑模式 CSS 修 | 主体内容覆盖完整, 配色协调 |

## P2.1 筛选预设

### 设计

- 侧栏顶部 (筛选标题下方) 加 "预设" 区: 横排 chip + "+保存" 按钮
- 每个预设 chip: 名字 + hover 显示 "×" 删除
- 点 "+ 保存" → prompt 输入名字 → 当前 filters 序列化存 localStorage
- 点已存 chip → 加载该预设 (覆盖当前 filters)

### 序列化

filters 含 Set, 需要转 Array. 还原时再转回 Set.

```js
function serialize(f) {
  return {
    ...f,
    evalAccept: [...f.evalAccept],
    schoolTags: [...f.schoolTags],
    selectedSchools: f.selectedSchools ? [...f.selectedSchools] : null,
    selectedCities: f.selectedCities ? [...f.selectedCities] : null,
    selectedMajorClasses: f.selectedMajorClasses ? [...f.selectedMajorClasses] : null,
    subjects: [...f.subjects],
  };
}
function deserialize(o) {
  return {
    ...o,
    evalAccept: new Set(o.evalAccept),
    schoolTags: new Set(o.schoolTags),
    selectedSchools: o.selectedSchools ? new Set(o.selectedSchools) : null,
    ...
  };
}
```

## P2.2 URL hash 分享

### 设计

- filters 改变时 (debounced 500ms), 把 `serialize(filters)` JSON.stringify → base64url → 写入 `location.hash`
- 页面加载时, 读 hash → base64url → JSON.parse → deserialize → 覆盖 filters
- 顶栏右上加 "🔗 复制链接" 按钮 (复制 location.href 到剪贴板)

### 注意

- hash 太长可能被浏览器截断, 但 64KB 应该够
- 不持久化 (跟 localStorage 不同), 只在当前 URL
- 跟 store/filters 自动 watch 同步

## P2.3 暗黑模式 CSS 修

### 当前问题

`toggleDark()` 切 `html.dark` class, 但只有 style.css 里的几个选择器有 dark 覆盖. Tailwind 的 `bg-white`, `text-slate-900` 等不变. 主体区域看起来撕裂.

### 改造

在 style.css 加更全面的 `.dark` 选择器覆盖:
- `body`, `header`, `aside`, `main`: 深色背景
- 表格 / 卡片 / section: 深色
- text-* 反转

或者用 CSS variables 重构 — 但工作量大. 第一版用强力选择器一覆盖了之.

## 实施顺序

1. P2.1 预设 (高价值, 自包含)
2. P2.2 URL share (中, 基础设施已就绪)
3. P2.3 暗黑修 (CSS only, polish)

## 改动追溯

### 实施细节 (2026-06-23 完成)

#### P2.1 筛选预设
- `serializeFilters(f)` / `deserializeFilters(o)` 在 app.js 顶部 (Set ↔ Array 转换)
- `store.presets: [{name, filters}, ...]`, localStorage key `LS_KEY_PRESET = zyhelper_presets_v2`
- 主 setup 加 `savePreset / loadPreset / deletePreset / renamePreset` 4 函数
- FilterPanel 顶部加 "📑 筛选预设" 区, chip + 保存按钮
- chip hover 显示 ✎ (rename) + × (delete)

**验证**:
- 输入 620 → 点 "+ 保存当前" → prompt "冲档620" → chip 显示 ✓
- 重置筛选 → 点 chip 还原所有 filter 字段 (含 subjects, schoolPriorityRange, etc.)

#### P2.2 URL hash 分享
- `encodeHash(obj)` / `decodeHash(s)`: base64url 编码 (Unicode 安全 via encodeURIComponent)
- filters watch (deep, debounce 500ms) → `history.replaceState("#" + encoded)`
- 启动后 `applyHash()` 从 hash 还原 filters
- `hashUpdating` flag 防止循环 (hash 改 → 改 filters → 改 hash)
- 监听 `window.hashchange` 支持用户手动改 hash
- 顶栏加 "🔗 分享" 按钮 → `navigator.clipboard.writeText(location.href)`

**验证**:
- 输入 620 → location.hash 977 字符
- 点 🔗 分享 → 弹出 "链接已复制!"
- 在新窗口打开该 URL → filters 自动恢复

#### P2.3 暗黑模式 CSS 全面覆盖
- 加 `color-scheme: dark` 让 form controls 默认深色
- 覆盖 Tailwind utilities: `.dark .bg-white`, `.dark .bg-slate-50`, `.dark .text-slate-{500-900}`
- 表格 / 卡片 / section / 抽屉 全部深色背景
- input/select/textarea 深色
- chip / preset-chip / tag badge 深色变体 (985/211 等保留可识别色彩, 加深底色)
- tier 行颜色调淡 (rgba alpha 0.15) 而非满色
- 字色: text-blue-{6,7}00, text-purple-700, text-rose-500, text-amber 等都加 dark 变体

**验证**: 切换暗模式 → 整体页面深色协调, 无白色撕裂

### 验收

| 场景 | 结果 |
|---|---|
| 侧栏顶部预设区显示 | ✅ |
| 保存预设 "冲档620" → chip 出现 | ✅ |
| 输入分数 620 → URL hash 写入 977 字符 | ✅ |
| 顶栏 🔗 分享 按钮 复制链接 | ✅ |
| 切换暗黑模式 → 主体内容协调 | ✅ |
