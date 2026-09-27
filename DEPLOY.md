# 部署指南

**项目简介**：一个基于 ISO 4 / LTWA 规则的期刊名缩写工具——上传 `.bib` 文件或手动输入期刊全名，即可获得标准缩写。站点为纯静态页面，**无后端**，所有计算均在浏览器端 JavaScript 完成，可离线运行。

## 目录结构

```
缩写转换/
├── web/                  # 静态站点根目录（部署时以它为站点根）
│   ├── index.html        # 页面入口（中文 UI）
│   ├── js/               # 浏览器端核心逻辑（ISO 4 缩写 + bib 处理）
│   ├── data/ltwa.json    # LTWA 词表（约 1.4 MB）
│   └── _headers          # Cloudflare Pages 自定义响应头
├── app.py / abbreviator.py / bib_processor.py   # 本地 Python 版（与部署无关）
├── .github/workflows/deploy-pages.yml   # GitHub Pages 自动部署工作流
├── .gitattributes        # 统一 LF 行尾（避免 Windows 克隆后词表出现 CRLF）
└── DEPLOY.md             # 本文档
```

部署时以 `web/` 目录为站点根；项目根目录下的 Python 文件不参与部署。

## 本地预览

两种方式任选其一，然后在浏览器打开 <http://localhost:8000>：

```bash
# 方式一：Python 自带静态服务器
python -m http.server 8000 -d web

# 方式二：Node serve
npx serve web -p 8000
```

> `npx serve` 不带 `-p` 参数时默认使用 3000 端口，按其终端提示的地址访问即可。

> 直接双击 `index.html`（file:// 协议）也能打开，但词表通过 `fetch` 加载，部分浏览器会拦截 file 协议下的请求，建议始终用本地 HTTP 服务器预览。

## 部署到 Cloudflare Pages

### 路径一：Dashboard 直接上传（无需安装任何工具）

1. 登录 <https://dash.cloudflare.com>，进入 **Workers & Pages**。
2. 点击 **Create** → 选择 **Pages** → **Upload assets**。
3. 项目名称自拟（如 `journal-abbrev`），把 **`web` 文件夹的内容**拖入上传区。
4. 无需设置构建命令（留空），输出目录保持默认，点击部署。

稍等片刻即可获得 `https://<项目名>.pages.dev` 访问地址。

### 路径二：Wrangler CLI

```bash
npx wrangler login
npx wrangler pages deploy web --project-name=journal-abbrev
```

首次 `login` 会打开浏览器完成授权；`deploy` 完成后会输出线上地址。

### 路径三：Git 集成自动部署（可选）

将仓库关联到 Pages 项目后：

- **构建命令：留空**（本项目无构建步骤）
- **构建输出目录：`web`**

此后每次 push 即自动发布。

### 自定义域名与 HTTPS

在 Pages 项目的 **Custom domains** 中绑定自有域名，Cloudflare 会自动签发证书并全程提供 HTTPS（含默认的 `*.pages.dev` 地址）。

## 部署到 GitHub Pages

站点全部使用相对路径，因此放在仓库子目录（`user.github.io/repo/` 这种子路径）下也能正常工作。

### 方式一：GitHub Actions（推荐，仓库已配好）

仓库内已包含 `.github/workflows/deploy-pages.yml`，它只把 `web/` 目录作为站点产物发布：

1. 在 GitHub 网页端创建空仓库（**不要**勾选初始化 README），或直接用 `gh`：

   ```bash
   gh repo create <仓库名> --public --source=. --remote=origin
   git commit -m "init" && git push -u origin main
   ```

2. 进入仓库 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。
3. 推送到 `main`（或在 Actions 页手动 `Run workflow`）后，访问 `https://<用户名>.github.io/<仓库名>/`。

首次部署需等 1～2 分钟；之后每次 push 都会自动重新发布。

### 方式二：发布到 gh-pages 分支（不需要 Actions）

```bash
git subtree push --prefix web origin gh-pages
```

然后在 **Settings → Pages** 把 Source 设为 `Deploy from a branch` → 分支 `gh-pages` → 目录 `/ (root)`。

### GitHub Pages 与 Cloudflare Pages 的差异

- `web/_headers` 只有 Cloudflare Pages 会读取；GitHub Pages 会直接忽略它，因此 LTWA 词表在 GitHub Pages 上没有 7 天强缓存和 Brotli 预压缩，`*.github.io` 的国内访问速度也通常更慢。
- 若想两者都用：Cloudflare Pages 绑定自定义域名做主站，GitHub 仓库只作为源码托管。

## 备注

- 站点为纯静态资源：LTWA 词表（约 1.4 MB）会被 Cloudflare 自动做 Brotli 压缩，且 `web/_headers` 已为其配置 7 天长缓存（`Cache-Control: public, max-age=604800, immutable`），首次加载后浏览器本地有缓存，后续访问几乎瞬时打开。
- 本机已通过 `npx --yes wrangler --version` 检测到 wrangler 4.141.0（由 npx 自动拉取，无需全局安装）。
- `web/tests/` 会随 `web/` 一起发布到公网（内含测试脚本与 `golden.json`），不影响功能；若不希望公开，可在部署前把该目录移到仓库根目录的 `tests/` 下。
- 仓库已通过 `.gitattributes` 固定为 LF 行尾。原因：`web/data/wordnet_nouns.txt` 由 `web/js/abbreviator.js` 按 `\n` 切分后做精确匹配，若在 Windows 上以 CRLF 检出，每个词会带上尾部 `\r`，名词识别会失效。
