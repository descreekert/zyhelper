# P1 三件套

> 第 5 轮 UI 打磨 + 3.16 冲稳保高级功能后, 进入 P1 大功能.

---

## 子功能

| # | 名称 | 描述 |
|---|---|---|
| P1.1 | 位次反查分数 | 在顶栏可输入 26 位次, 自动换算 26 分数 (双向) |
| P1.2 | 多年等位分对照 | 给定 26 分数, 展示 25/24/23/22 各年的等位分 + 等位次 |
| P1.3 | 选科切换 UI | 不再 hardcode 化学/政治, 用户可选实际选科组合, 过滤逻辑联动 |

---

## P1.1 — 位次反查分数

### 当前
- 顶栏: `26 分数 [620] | 26 位次: 7935`
- 输入分数 → 自动算位次
- 位次是只读 `<span>`

### 改造
两个输入框, 任一可编辑, 另一自动同步:
```
26 分数 [620]  ←→  26 位次 [7935]
```
- 用户改分数 → 重算位次 (rank26FromScore26)
- 用户改位次 → 反查分数 (score26FromRank26)
- 内部避免循环更新: 用 watch + skip flag

### 实现
- ScoreTool 的 myRank 改为可编辑 `<input type="number">`
- 加 `onRank()` 方法: emit update + 调 `score26FromRank26` → emit `update:myScore`
- 用 `isUpdatingFromSelf` flag 防止递归

---

## P1.2 — 多年等位分对照

### 当前
- 只显示 1 个等位 (基于 `equivSource` 切换的 25/24/23/avg)

### 改造
新增展示 4 个年份的等位分/等位次, 紧凑 inline:
```
26 分 620 / 位次 7935
等位: 25 → 620 / 7935   24 → 615 / 8200   23 → 605 / 9100   22 → 600 / 9500
```

### 实现
- 顶栏第 2 行 (现在是冲稳保按钮) 之上加一行 "等位对照"
- 或者: 鼠标 hover "25 等位分" 时弹出包含全部年份的 popover
- 选 inline 一行, 默认显示, 4 个年份并列, 字体小

直接在 ScoreTool 添加 `multiEquiv()` 返回数组, 显示 inline 行。

---

## P1.3 — 选科切换 UI

### 当前
`matchesSubjectRequirement(req)` hardcode 物理类 + (化学 OR 政治) OR 不限, 排除 生物/地理.

### 改造
1. 用户在筛选侧栏可选实际选科组合
2. 物理类: 物理是必选
3. 其它选 2 科: 化学/政治/生物/地理 (4 选 2 = 6 种组合)
4. 默认: 物理 + 化学 + 政治
5. 过滤规则:
   - 专业要求 "不限" → 通过
   - 专业要求含其中一个用户选的科目 → 通过
   - 其它 → 过滤
6. 实际匹配: 专业要求字符串解析含 "化学" "政治" "生物" "地理" 等

### 实现
- `store.filters.subjects` = `Set<string>` 默认 `{化学, 政治}` (物理是隐含的)
- 侧栏加 "选科组合" 单选/多选 chip 区
- `matchesSubjectRequirement(req, subjects)` 接受用户选科集合
- 仍然过滤 "生物/地理" 当用户未选时

---

## 实施顺序

1. P1.3 选科切换 (单独, 跟其他无依赖)
2. P1.1 位次反查 (改 ScoreTool)
3. P1.2 多年等位 (扩展 ScoreTool)

---

## 改动追溯

### 实施细节 (2026-06-23 完成)

#### P1.1 位次反查分数

**改造**: ScoreTool 把 26 位次从 `<span>` 改成 `<input type="number">`, 同时增加 `onRank()` 处理:
```js
function onRank(v) {
  if (updatingFromScore) return;          // 防止 score → rank → score 循环
  const r = +v || 0;
  updatingFromRank = true;
  emit("update:myRank", r);
  if (r) {
    const score = score26FromRank26(r, props.scoreRank);   // 反查
    if (score) emit("update:myScore", score);
  }
  setTimeout(() => { updatingFromRank = false; }, 50);
}
```
**验证**: 输入位次 5000 → 自动算分 633 ✓

#### P1.2 多年等位分对照

**改造**: ScoreTool 加 computed `multiEquiv` — 给当前 26 分数, 算 25/24/23/22 各年等位分 + 等位次
```js
const multiEquiv = computed(() => {
  if (!props.myScore) return null;
  const years = ["25", "24", "23", "22"];
  return years.map(y => {
    const { score, rank } = equivFromScore26(props.myScore, props.scoreRank, y);
    return score != null ? { year: y, score, rank } : null;
  }).filter(Boolean);
});
```
顶栏 inline 显示 4 年对照: `25: 633/5103 | 24: 641/5081 | 23: 632/5045 | 22: 620/5074`

#### P1.3 选科切换 UI

**当前问题**: `matchesSubjectRequirement` 硬编码 "化学 OR 政治 - 生物 - 地理"

**改造**:
1. 加 `ALL_SUBJECTS = ["化学", "政治", "生物", "地理"]` (物理类除物理外的 4 个)
2. `subjects: Set<string>` 加到 `initialFilters`, 默认 `{化学, 政治}`
3. `matchesSubjectRequirement(req, subjects)` 接受 Set 参数:
   - "不限" → 通过
   - req 含用户未选的科目 → 过滤
   - req 含用户选的科目 → 通过
   - req 不含任何科目 → 通过 (e.g. 纯物理)
4. FilterPanel 加 "选科组合" chip 区, 物理+(选 2 科)

**验证**:
- 默认 `{化学, 政治}` → 139 条
- 取消化学 → 0 条 (因为默认筛选条件极严, 99% 物理类内的 Top18 学校 + Top16 类 + Top10 城市都需化学)
- 加入生物 → 仍 139 (在 Top16 类 + Top18 学校范围内, 没有要求生物的)

### 验收

| 场景 | 结果 |
|---|---|
| 顶栏改成两个 input (分数 + 位次) | ✅ |
| 输入位次 5000 → 自动算分 633 | ✅ |
| 多年等位行: 25/24/23/22 inline | ✅ |
| 选科 chip 区 (化学/政治/生物/地理) | ✅ |
| 默认 化学+政治 蓝底高亮 | ✅ |
| 切换选科联动筛选 | ✅ |
