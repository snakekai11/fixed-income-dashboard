# 固收综合看板（流动性与债券市场）

覆盖：央行公开市场操作、银行间质押式回购 R/DR、Shibor、银行间同业拆借 IBO、交易所回购 GC/R-。

## 使用步骤（共 3 步）

1. **配置数据 Key（一次性）**：双击 `配置WindKey.cmd`，在弹出的万得开发者中心页面登录并复制 API Key，粘贴回窗口。
2. **启动网站**：双击 `启动网站.cmd`，浏览器自动打开 http://localhost:8021 。
3. **开启每日自动更新**：右键 `安装每日自动更新.ps1` →"使用 PowerShell 运行"，即可在每天 11:40、17:45 自动取数。

网页右上角数据每日自动刷新；也可以启动网站后直接访问 http://localhost:8021 查看。

运行一次“安装网站后台启动.ps1”后，网站服务会在每次登录 Windows 时静默启动。以后直接访问 http://localhost:8021 并点击“刷新数据”即可，不依赖 Codex、GPT 或其他应用。

## 目录结构

- `web/` 网页前端（看板、表格、走势图）
- `scripts/fetch_data.mjs` 取数脚本（Wind EDB → data/latest.json + data/history/）
- `scripts/serve.mjs` 本地网站服务器（端口 8021，含 /api/refresh 手动刷新接口）
- `scripts/make_sample.mjs` 生成示例数据
- `data/codes-cache.json` EDB 指标代码缓存
- `logs/fetch.log` 自动更新日志

本版本默认使用免费公开来源：中国货币网（Shibor、DR、IBO）、人民银行公开市场公告，以及新浪/东方财富交易所回购行情。无需 Wind/Tushare API；若公开站点临时限流，页面保留已验证数据并显示“部分更新”。官方源未公布的期限显示为空值，不使用示例值冒充实时数据。

央行公开市场模块按工具和期限展示当日投放、到期与净投放。支持逆回购（含隔夜及各期限）、买断式逆回购和中期借贷便利（MLF）；到期根据央行历史公告与期限推算，并在本地持续积累历史。商业银行同业存单不是央行公开市场投放工具，不计入该模块。
宏观资讯页使用新浪财经和财联社公开滚动资讯接口，按宏观相关度和时间排序，标题可点击打开原文；资讯仅作信息聚合，不代表事实核验或投资建议。

## Render 公网部署

项目包含 `render.yaml`，可在 Render 通过 Blueprint 或 Web Service 发布。选择 Free 方案后，Build Command 使用 `npm run check`，Start Command 使用 `npm start`，健康检查地址为 `/api/health`。服务每次启动时自动刷新，运行期间每四小时刷新一次，也可从页面手动刷新。免费实例空闲后可能休眠，第一次访问需要等待唤醒。

无需银行卡的部署方式使用 Render Static Site：Build Command 为 `npm run build:static`，Publish Directory 为 `dist`。GitHub Actions 在工作日北京时间 09:00、11:40、15:30、17:45 从免费公开源更新并提交数据，Render 随提交自动发布。静态页面的“同步最新数据”按钮读取最近一次云端发布结果，不会直接启动服务器取数。

GitHub Pages 无需银行卡，公开仓库后由 `.github/workflows/deploy-pages.yml` 自动构建并发布。项目网址为 `https://snakekai11.github.io/fixed-income-dashboard/`，数据更新提交会自动触发重新发布。
