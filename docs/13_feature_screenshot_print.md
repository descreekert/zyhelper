# 3.18 截图 + 打印功能

## 子功能

| # | 名称 | 描述 |
|---|---|---|
| 3.18.1 | 截图保存 | 当前内容渲染为 PNG, 自动下载 |
| 新加 | 打印 | 浏览器原生打印对话框, CSS 优化版面 |

## 3.18 截图 (html2canvas)

### 设计
- 顶栏加 "📷 截图" 按钮
- 点击: html2canvas 渲染 `<main>` 区域 → PNG → 自动下载
- 默认文件名 `志愿表_${YYYY-MM-DD}.png`
- 若有展开行 / 对比栏 / 收藏栏, 同时截入
- 注意: html2canvas 不支持 CSS sticky (sticky 在截图中会丢位置), 可接受

### 注意点
- 表格内容较多时图片很大 (几 MB), 但用户可接受
- html2canvas 用现 CDN 版本 1.4.1, 已加载
- 截图前临时隐藏一些不需要的元素 (e.g. 顶栏的操作按钮), 截完恢复
- 加 loading 提示 (大表格可能 2-3 秒)

## 打印

### 设计
- 顶栏加 "🖨 打印" 按钮
- `window.print()` 原生触发
- 通过 `@media print` CSS 优化:
  - 隐藏侧栏, 顶栏按钮, 列设置 panel, 浮动按钮
  - 表格 sticky 取消 (打印每页显示表头)
  - 字体调小, 行高紧凑
  - 表格使用 thead repeat (浏览器原生支持)
  - 背景色保留 (`color-adjust: exact`)
- 表格分页友好 (每页含表头)

### 注意点
- 打印 PDF 是首选 (浏览器内置)
- 打印应该在亮色模式 (即使屏幕是暗色, 打印强制亮色)

## 实现顺序
1. 加按钮 + ID 标记 (顶栏)
2. 截图函数 (调 html2canvas)
3. 打印 CSS (`@media print`)
4. 烟雾测试

## 改动追溯

### 实施细节 (2026-06-23 完成)

#### 3.18 截图
- 顶栏加 `📷 截图` 按钮 (between 🔗 分享 和 导出 CSV)
- `takeScreenshot()` 异步函数:
  1. 设 `ui.screenshotting = true` (按钮变 ⏳ + disabled)
  2. body 加 `screenshot-mode` class
  3. 取消表格容器 max-height/overflow (让所有行都渲染)
  4. `html2canvas(main, {backgroundColor, scale, useCORS, ignoreElements})` 渲染
  5. `ignoreElements`: 跳过 `.no-screenshot` (顶栏按钮 + sticky 元素)
  6. `canvas.toDataURL("image/png")` → 创建 `<a download>` 触发下载
  7. 恢复 max-height/overflow + 移除 screenshot-mode
- 文件名: `志愿表_${YYYY-MM-DD}.png`
- 错误处理: alert + console.error

#### 打印
- 顶栏加 `🖨 打印` 按钮
- `printPage() { window.print(); }` 极简
- 关键在 CSS `@media print`:
  - 强制亮色: `html, body { background: white; color: black; color-scheme: light; }`
  - 隐藏: `.no-print, aside, button.fixed, .col-settings-panel` etc.
  - main 占满 width: 100%
  - 表格紧凑: 9px 字体 + 2-3px padding
  - `thead { display: table-header-group; }` 浏览器原生在每页重复表头
  - `tbody tr { page-break-inside: avoid; }` 行不跨页
  - 取消 sticky (`thead th { position: static; }`)

### 验收

| 场景 | 结果 |
|---|---|
| 顶栏 📷 截图 / 🖨 打印 按钮显示 | ✅ |
| html2canvas 库已加载 | ✅ (CDN 1.4.1) |
| html2canvas 渲染 main → PNG 成功 | ✅ (596x447 测试通过) |
| 打印 CSS @media print 添加 | ✅ (16+ 规则) |

### 用户使用提示

- 截图前: 确保表格已展开到想要的状态
- 截图大表格 (1000+ 行) 可能耗时 5-10 秒, 按钮显示 ⏳
- 打印 PDF: Chrome 打印对话框选 "另存为 PDF"
- 暗黑模式下打印仍是亮色 (CSS 强制)
