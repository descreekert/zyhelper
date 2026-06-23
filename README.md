# 志愿助手 zyhelper

> 2026 物理类 高考志愿填报助手 · 纯静态 Web 应用

替代 Excel 81 列宽表, 提供:
- 🎯 冲稳保 3 段自动计算 (26 分数 → 25 等位分换算)
- 📊 17 列可定制表格 (拖动列宽 / 拖动列序 / 隐藏列 / 多列排序)
- 🔍 智能补全关键词 (学校 / 专业类 / 专业)
- 📑 筛选预设 + URL 分享 + localStorage 持久化
- 💾 收藏配额提示 (`冲 28/28 ✓`) + 按档分组导出 CSV
- 📷 截图保存 + 🖨 打印优化
- 🌙 暗黑模式

[**▶ 在线试用 (GitHub Pages)**](https://descreekert.github.io/zyhelper/)

## 截图

主表格 + 顶部 26 分数 → 多年等位 + 冲稳保 一键应用筛选

筛选侧栏: 学校/城市/专业类 优先次序 + chip 多选 + 选科组合

## 快速启动

```bash
git clone https://github.com/descreekert/zyhelper.git
cd zyhelper
python3 -m http.server 8765
# 浏览器打开 http://localhost:8765/
```

## 数据更新

数据来自外部 xlsx (本仓库不含原始 xlsx)。生成 JSON:

```bash
python3 scripts/build_data.py            # 全部
python3 scripts/build_data.py --only score_rank   # 仅一分一段 (26 公布后用)
python3 scripts/build_data.py --only plans        # 仅招生计划
```

## 技术栈

| 层 | 选型 | 备注 |
|---|---|---|
| 前端框架 | Vue 3 | CDN, 无构建 |
| UI | Tailwind CSS | CDN JIT |
| 图表 | Chart.js | 详情抽屉历年趋势 |
| 截图 | html2canvas | 导出 PNG |
| 数据 | Python + openpyxl | xlsx → JSON 一次性生成 |

## 目录结构

```
zyhelper/
├── index.html              # 入口
├── assets/
│   ├── app.js              # Vue 3 单文件应用
│   └── style.css           # 自定义 CSS
├── data/                   # build_data.py 生成
│   ├── plans.json          # 招生计划 (16 MB, 12728 条)
│   ├── score_rank.json     # 一分一段 + 等位分
│   ├── priority.json       # 学校/城市/专业类 优先次序
│   └── meta.json           # 枚举值
├── scripts/
│   └── build_data.py       # 数据生成脚本
├── docs/                   # 设计/进度/Review 文档 (中文)
└── README.md
```

## 主要功能

| 区域 | 功能 |
|---|---|
| **顶栏** | 26 分数 ↔ 位次 双向输入, 多年等位对照 (25/24/23), 冲稳保 3 按钮 (toggle), ⚙ 比例调节, 视图切换 (表格/卡片/三栏), 对比/收藏/分享/截图/打印 |
| **侧栏** | 筛选预设 chip · 智能补全搜索 · 25 参考分/位次 3 段冲稳保范围 · 学费 · 学校/城市/专业类 优先次序 (滑杆 + chip) · 学科评估 · 院校标签 · 选科组合 · 开关 |
| **表格** | 17 列, 行点击展开 4 块详情 (学校/专业/25vs26 对比/预测+变化), tier 着色, sticky 表头 |
| **冲稳保** | 三栏并排浏览 · 收藏配额 `冲 N/T ✓⚠✗` · 按档分组导出志愿单 CSV |
| **筛选预设** | 保存/重命名/删除 · localStorage 持久化 · URL hash 分享 |

## 部署

参见 [docs/14_deployment.md](docs/14_deployment.md):
- nginx 配置 (gzip 必开, 16MB → 3MB)
- 国内 CDN 本地化
- HTTPS (clipboard API 必需)

## 文档

| 文件 | 内容 |
|---|---|
| [docs/01_requirements.md](docs/01_requirements.md) | 功能需求 |
| [docs/02_architecture.md](docs/02_architecture.md) | 技术架构 |
| [docs/03_testing.md](docs/03_testing.md) | 测试计划 |
| [docs/04_chongwenbao_algorithm.md](docs/04_chongwenbao_algorithm.md) | 冲稳保算法 |
| [docs/05_progress.md](docs/05_progress.md) | 总进度 (8 轮迭代记录) |
| [docs/06-09](docs/) | 各轮用户 review |
| [docs/10-13](docs/) | P1/P2/P3.16/3.18 等大功能 |
| [docs/14_deployment.md](docs/14_deployment.md) | 部署指南 |

## License

MIT (个人项目, 数据来自公开渠道, web app 代码 open source)
