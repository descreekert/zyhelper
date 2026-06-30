<div align="center">

# 🎯 zyhelper

### 2026 辽宁省 物理类 · 高考志愿填报助手

<br>

[![在线试用](https://img.shields.io/badge/▶_在线试用-GitHub_Pages-2ea44f?style=for-the-badge)](https://descreekert.github.io/zyhelper/)
[![用户手册](https://img.shields.io/badge/📘_用户手册-USER_GUIDE-blue?style=for-the-badge)](docs/USER_GUIDE.md)
[![开发文档](https://img.shields.io/badge/🛠_开发文档-DEVELOPER_GUIDE-orange?style=for-the-badge)](docs/DEVELOPER_GUIDE.md)

<br>

**纯静态 SPA · 数据不离浏览器 · 一键 PDF · 兼容辽宁招考网官方 HTML 格式**

</div>

---

## ⚡ 5 秒上手

1. 打开 <https://descreekert.github.io/zyhelper/>
2. 顶部填 **26 高考分数** (例 `650`)
3. 左侧筛选 → 中间结果 → ➕ 加进志愿单 → `📊 分析` / `📄 PDF 报告`

---

## 📚 文档导航 — 按你的角色选

<table>
<tr>
<td width="50%" valign="top">

### 👤 我是 **志愿填报人**

> 我想用这个工具帮自己选/报志愿,不懂代码

➡️ **[📘 用户手册 (USER_GUIDE.md)](docs/USER_GUIDE.md)**

- 5 分钟快速上手
- 主视图查询 / 筛选 / 排序
- 志愿单管理 + 锁定 + 导入导出
- 分析页 (录取趋势 / 转专业风险)
- PDF 报告导出
- 常见问题 FAQ

</td>
<td width="50%" valign="top">

### 🛠 我是 **开发者 / 维护者**

> 我想看代码 / 改算法 / 更新数据

➡️ **[🛠 开发者文档 (DEVELOPER_GUIDE.md)](docs/DEVELOPER_GUIDE.md)**

- 技术栈 + 仓库结构
- 数据 pipeline (3 个 Python 脚本)
- 前端架构 + Vue 组件
- 录取率算法 公式
- localStorage schema
- 数据更新流程 + 部署

</td>
</tr>
</table>

---

## 🎬 演示

### 场景 1 · 选志愿

按 学校 / 城市 / 专业类 优先档筛选,切换冲档 / 三栏视图

<p align="center"><img src="docs/gifs/s1_select.gif" width="80%" alt="选志愿"></p>

### 场景 2 · 报志愿

进入志愿单 → 一键锁定 → 导出 / 导入菜单 (含官网格式 HTML)

<p align="center"><img src="docs/gifs/s2_voluntary.gif" width="80%" alt="报志愿"></p>

### 场景 3 · 分析 + PDF

总览 / 各档 Top 3 / 阈值 Top 5 / 转专业风险 / 录取趋势 → 一键 PDF

<p align="center"><img src="docs/gifs/s3_analysis.gif" width="80%" alt="分析"></p>

---

## ✨ 功能亮点

<table>
<tr>
<td>

**🎯 智能冲稳保**
- 26↔25 等位分自动换算
- 一键应用筛选

</td>
<td>

**📊 录取率算法**
- 位次差 sigmoid + 5 因子
- 专业热度调整可关
- 11 阈值 Top 5 表

</td>
<td>

**📈 互动趋势图**
- 滑杆 / Y 轴 / 直方图 / SVG 点击
- Hover 详情 含 Δ 分位次

</td>
</tr>
<tr>
<td>

**🎓 转专业风险扫描**
- 目标 / 可接受 双清单
- ✓ / ⚠ / ✗ 自动判定

</td>
<td>

**📋 多志愿单 + 锁定**
- 多列表切换
- 📌 / ⏳ 状态机
- 自动按 26 等位次排

</td>
<td>

**📤 全格式导入导出**
- 辽宁招考网 HTML (官网+预选)
- JSON / CSV / PDF
- 源顺序锁定

</td>
</tr>
<tr>
<td>

**📍 6 大聚合**
- 按分数 / 学校 / 城市
- 按报考专业 (主名收敛)
- 招生维度 (全 2026)

</td>
<td>

**📄 15-section PDF**
- 总结 + 趋势 + 完整志愿
- 6 大聚合表
- 转专业风险扫描

</td>
<td>

**🔒 隐私第一**
- 纯静态, 无后端
- 数据存浏览器 LS
- 不上传任何东西

</td>
</tr>
</table>

---

## 🚀 本地运行

```bash
git clone https://github.com/descreekert/zyhelper.git
cd zyhelper
python3 -m http.server 8765
# 浏览器打开 http://localhost:8765/
```

无构建步骤 — `index.html` + `assets/app.js` 直接服务即可。

---

## 📦 数据范围

- **省份/科类**: 辽宁 物理类
- **批次**: 2026 本科
- **条目数**: 12,728 条招生计划 (含 567 中外合作 / 1871 停招)
- **学校**: 930 所
- **数据源**: 辽宁招生考试网公开数据
- **更新频率**: 招生计划公布后 / 历年录取数据公布后

详细数据更新流程见 [DEVELOPER_GUIDE.md §9](docs/DEVELOPER_GUIDE.md#9-数据更新流程)

---

## 📝 License

MIT (待加 LICENSE)

## 🙋 反馈

[GitHub Issues](https://github.com/descreekert/zyhelper/issues)

---

<div align="center"><sub>Made with 💙 for 2026 高考志愿填报</sub></div>
