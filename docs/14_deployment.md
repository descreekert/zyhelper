# 部署指南

> 本 web app **是纯静态的**, 无构建步骤, 可直接放 nginx / Apache / GitHub Pages / Vercel / CDN.

## 文件结构

```
new/工具/报考/
├── index.html              # 入口
├── assets/
│   ├── app.js              # Vue 3 应用 (单文件)
│   └── style.css           # 所有样式
└── data/                   # 静态数据 (build_data.py 生成)
    ├── plans.json          # ~16 MB
    ├── score_rank.json     # 68 KB
    ├── priority.json       # 61 KB
    └── meta.json           # 9 KB
```

**总大小**: ~16.5 MB (主要是 plans.json)

## 外部依赖 (CDN)

`index.html` 引用了 4 个 CDN:
| 库 | 版本 | URL |
|---|---|---|
| Vue 3 | 3.4.21 | `https://unpkg.com/vue@3.4.21/dist/vue.global.prod.js` |
| Tailwind CSS | latest | `https://cdn.tailwindcss.com` |
| Chart.js | 4.4.2 | `https://unpkg.com/chart.js@4.4.2/dist/chart.umd.js` |
| html2canvas | 1.4.1 | `https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js` |

国内访问 unpkg.com 可能慢或不通, 建议**本地化**:

```bash
mkdir -p new/工具/报考/vendor
cd new/工具/报考/vendor
curl -L -o vue.js https://unpkg.com/vue@3.4.21/dist/vue.global.prod.js
curl -L -o chart.js https://unpkg.com/chart.js@4.4.2/dist/chart.umd.js
curl -L -o html2canvas.js https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js
# Tailwind 推荐用 CDN, 因为它是 JIT (按需生成 CSS); 但也可以下载预编译版
curl -L -o tailwind.js https://cdn.tailwindcss.com
```

然后 index.html 改 4 处 `<script src>` 引用为 `vendor/xxx.js`.

## nginx 配置示例

```nginx
server {
    listen       80;
    server_name  zyhelper.local;   # 或你的域名
    root         /var/www/zyhelper;
    index        index.html;

    # gzip 压缩 (关键! 16MB plans.json → ~3MB)
    gzip on;
    gzip_types
        application/json
        application/javascript
        text/css
        text/html;
    gzip_min_length 1k;
    gzip_comp_level 6;

    # JSON 数据缓存 1 天 (web app 已加 ?_t=Date.now() bust cache, 安全)
    location ~ \.json$ {
        add_header Cache-Control "public, max-age=86400";
    }

    # JS/CSS 文件缓存 (改动时手动 bust)
    location ~ \.(js|css)$ {
        add_header Cache-Control "public, max-age=3600";
    }

    # 兜底 SPA 路由 (本项目其实不需要, 仅作健壮)
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## HTTPS

如使用截图分享 / URL 分享 (clipboard API), **强烈建议 HTTPS** — 部分浏览器在 HTTP 下禁用 clipboard.

```bash
# certbot 一键 (Let's Encrypt)
sudo certbot --nginx -d zyhelper.example.com
```

## 部署流程

```bash
# 1. 本地生成数据 (xlsx → JSON)
cd new/工具/报考
python3 scripts/build_data.py

# 2. 上传到服务器
rsync -avz --delete \
    new/工具/报考/ \
    user@server:/var/www/zyhelper/

# 3. 浏览器自动加载新数据 (cache-bust 已内置)
```

## 数据更新

用户跑 pipeline 后, 重新生成 JSON 并上传:

```bash
# 只重新生成 一分一段 (例如 26 公布后)
python3 scripts/build_data.py --only score_rank

# 上传单文件
rsync new/工具/报考/data/score_rank.json user@server:/var/www/zyhelper/data/
```

## 其它部署方案

| 方案 | 适用场景 |
|---|---|
| **nginx** (推荐) | 自有服务器, 可控性最强 |
| **GitHub Pages** | 免费, 但 16MB 单文件可能超限. 需先压缩 |
| **Vercel / Netlify** | 免费, 一键部署. 适合个人 |
| **CDN (七牛/阿里 OSS)** | 国内访问最快 |
| **本地 file://** | 不行! fetch 跨域被禁, 必须用 http server |

## 本地开发 / 单机使用

```bash
cd new/工具/报考
python3 -m http.server 8765
# 浏览器打开 http://localhost:8765/
```

或用任何静态服务器:

```bash
# Node.js
npx http-server -p 8765

# Caddy
caddy file-server --root . --listen :8765
```

## 性能要点

- plans.json 16MB → gzip 3MB → 用户 4G 网约 1-2s 下载
- 浏览器解析 JSON ~200ms (12k 条目)
- 渲染首屏 < 1s (Vue 响应式)
- 筛选/排序 < 50ms (M1 mac)

总体首屏 2-3 秒内可用.
