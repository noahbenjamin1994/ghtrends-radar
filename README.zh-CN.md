<div align="center">

# ghtrends ↗

**[English](README.md) · 简体中文**

### 看清机会，再开始做。

**GitHub 供给 × Google 搜索需求。**
发现增长中的赛道，了解竞争，分享有依据的判断。

[打开机会雷达](https://radar.ghtrends.dev/?lang=zh) · [判断方法](https://radar.ghtrends.dev/docs?lang=zh) · [反馈问题](https://github.com/noahbenjamin1994/ghtrends-radar/issues)

</div>

[![构建检查](https://github.com/noahbenjamin1994/ghtrends-radar/actions/workflows/check.yml/badge.svg)](https://github.com/noahbenjamin1994/ghtrends-radar/actions/workflows/check.yml)

[![ghtrends 机会雷达预览](.github/assets/radar-preview.png)](https://radar.ghtrends.dev/?lang=zh)

## 它能告诉你什么？

| 搜索方向 | 活跃开源供给 | 结论 |
|---|---|---|
| 上升 | 匹配项目少 | 验证具体、尚未被充分服务的场景 |
| 上升 | 已有一定规模 | 比较工作流、受众与迁移成本 |
| 平稳 / 下降 | 任意 | 明确实际搜索变化，不直接推断商业“红海” |
| 分歧 / 证据不足 | 任意 | 说明已知事实，以及下一步该验证什么 |

每份报告包含来源查询、采集日期、方法版本和适用范围。分类页与报告页在 JavaScript 加载前就包含可读证据正文。搜索关注度不能直接代表付费客户，象限分类用于决定下一步研究方向，不预测商业成功。

## 数据不足时，也给出下一步

系统不会为了给出确定答案，把零搜索量直接判成“死海”，或把少量仓库判成“蓝海”。报告会明确说明：

- **目前已知**：实际检索范围、已找到的项目、可用的搜索历史。
- **初步建议**：根据已有证据，建议先研究什么、验证什么。
- **下一步行动**：查看替代工具、验证具体用户问题、调整关键词后重新采集。

例如输入 `ai4s`，系统会识别为 **AI for Science**，分别查询 GitHub 的 `ai4science`、`ai-for-science`、`ai4s` 标签，再对返回项目去重；不完整的联合检索只报告已找到的下限。Google Trends 使用完整领域名称。旧的缩写报告保留原始数据，并提供一键重查入口。

扫描会显示来源进度，在项目详情补充完毕前先展示初步结果。用户扫描优先于定时刷新，仓库详情最多使用三个并发请求；数据源限流仍可能增加等待时间。自托管未填模型 Key 时使用内置主题映射；填入 DeepSeek Key 后启用输入标准化和简短研究报告。

## 60 秒开始使用

**直接打开网站：** [radar.ghtrends.dev](https://radar.ghtrends.dev/?lang=zh)，公开报告无需注册即可浏览。

网站支持中英文，包括报告解释、Markdown 和 PNG 导出。首次访问跟随浏览器语言；右上角可切换并保存偏好，切换时保留当前页面。链接添加 `?lang=zh` 或 `?lang=en` 可指定语言。

**CLI、本地网页与 MCP：** 需要 Node.js 22.13 或更新版本。

无需全局安装：

```sh
npx --yes --package=https://radar.ghtrends.dev/ghtrends.tgz ghtrends ui
```

也可以安装到本机：

```sh
npm install -g https://github.com/noahbenjamin1994/ghtrends-radar/releases/download/v0.3.0/ghtrends-radar-0.3.0.tgz

ghtrends ui
ghtrends scan --topic ai4s --json
ghtrends repo facebook/react
ghtrends compare facebook/react vuejs/core --format md
```

发布包名是 **ghtrends-radar**，可执行命令是 **ghtrends**。npm 上现有的 `ghtrends` 属于另一个项目；本项目目前通过 GitHub Releases 分发。

## 一套分析引擎，三种使用方式

- **网页**：机会地图、赛道证据、仓库历史、竞品对比和持久化个人关注清单。可导出 PNG、Markdown、JSON，也可将固定报告卡片嵌入 README。
- **CLI**：扫描赛道、查看仓库、管理持久化关注清单、对比项目、生成报告。
- **MCP**：让智能体直接使用结构化 GitHub 与搜索需求证据。

```sh
ghtrends scan --topic agent-memory --keyword "ai agent memory" --geo US
ghtrends scan --topic mcp-servers --report findings.md
ghtrends watch add facebook/react
ghtrends watch list
ghtrends watch run
ghtrends watch remove facebook/react
ghtrends report --topic coding-agents --format md
ghtrends compare facebook/react vuejs/core sveltejs/svelte --format json
ghtrends collect
ghtrends ui --port 3721 --no-open
ghtrends mcp
```

`scan` 执行赛道扫描；`report` 将完整可用证据、主要项目、Issue 线索与限制整理为文档。`watch run` 执行一次刷新，可交给外部调度器定期运行。

### MCP 配置

先安装发布包，再加入客户端的 MCP 配置：

```json
{
  "mcpServers": {
    "ghtrends": {
      "command": "ghtrends",
      "args": ["mcp"]
    }
  }
}
```

提供 `ghtrends_scan`、`ghtrends_repo`、`ghtrends_compare`、`ghtrends_watch_list` 四个工具，使用 stdio 传输。

示例提问：**“比较智能体记忆赛道的活跃 GitHub 供给与搜索需求，给我判断依据、适用范围和下一步建议。”**

### 凭据与存储

未配置凭据时，可在 GitHub 未认证额度内查询公开数据。较大扫描可选择个人 Token 或自己的 GitHub App：

```sh
export GITHUB_TOKEN=your_token
# 或者：
export GITHUB_APP_ID=your_app_id
export GITHUB_INSTALLATION_ID=your_installation_id
export GITHUB_PRIVATE_KEY_PATH=/secure/path/github-app.pem
```

App 安装令牌会自动续签。只返回公开仓库，不要把凭据提交到仓库或暴露给浏览器。

- 发布包附带有日期的公开初始快照，首次启动即可浏览。快照保留来源日期，超过 14 天的证据会降级，刷新后重新判断。
- SQLite 默认放在 `~/.ghtrends`，可用 `GHTRENDS_DATA_DIR` 覆盖。
- 托管版历史和关注列表按账户存入 SQLite，跨设备可用；自托管 CLI、MCP 与网页共用本地工作区，完成的扫描显示在“我的研究”。
- `GOOGLE_TRENDS_PROXY` 可选，用于配置 Trends 采集的 HTTP 代理。
- Google Trends 网页端点并非官方稳定 API，可能限流或变更。采集失败会明确呈现；复用历史快照时保留原日期。
- 登录后的新报告默认私有，主动公开后才可分享；停止公开会撤回后续访问，已下载的副本无法收回。旧匿名报告仍公开，无法自动认领；可在报告页手动保存到“我的研究”。

支持可复现的数据导入：

```sh
ghtrends scan --topic mcp-servers --trends-file demand.json --json
```

`demand.json` 遵循 `src/core/types.ts` 中的 `DemandEvidence`：包含匹配的关键词与地区、原始 Trends 来源链接、采集时间、每周 0–100 观测值以及可选参考词数值。未完成周需标记。系统校验输入，不会把日数据或缺失周当作完整周数据。

## 托管版与自托管版

| 功能 | 托管版未登录 | 托管版已登录 | 自托管开源版 |
|---|---|---|---|
| 公开雷达、报告、需求线索、公开导出 | 可用 | 可用 | 可用 |
| 新扫描、未缓存仓库对比 | — | 可用，有每日额度 | 使用自己的数据源额度 |
| 历史与关注列表 | — | 按账户保存，跨设备可用 | 本地 SQLite 工作区 |
| 输入标准化、简报 | 阅读已公开简报 | 使用后端 DeepSeek Key | 可选填写自己的 Key |
| 私有报告、主动分享 | — | 支持 | 由自己的部署访问范围决定 |

**一套代码，两种运行模式。** 自托管不要求 Logto，也不要求外部数据库。托管版将账户与报告归属、历史、关注列表、会话、每日额度存入 SQLite，单实例配持久化目录。备份使用 SQLite 备份接口或停机复制，不能只复制运行中的主文件而忽略 WAL。

自托管可选 AI 配置（仅后端环境变量）：

```sh
export DEEPSEEK_API_KEY=your_deepseek_key
export DEEPSEEK_MODEL=deepseek-flash
ghtrends ui
```

模型生成一个 Trends 主词、最多两个同义表达，以及受约束的 GitHub 主题与短语。歧义缩写会要求选择含义；采集完成后，根据**实际证据**生成中英文简报，不计算或改写指标。必要的查询会发送给 DeepSeek、Google、GitHub，请勿输入秘密。简报失败时，已采集的报告仍可阅读。

公开托管部署配置 `GHTRENDS_HOSTED=1`、HTTPS `PUBLIC_URL`、`LOGTO_ENDPOINT`、`LOGTO_APP_ID`、`LOGTO_APP_SECRET`，可通过 `GHTRENDS_DAILY_SCANS` 修改每日额度（默认 10）。Logto 选择 Traditional 应用，回调地址为 `${PUBLIC_URL}/auth/callback`。GitHub 与 DeepSeek 密钥放服务器 Secret，不能放入 `VITE_*` 或浏览器存储。登录使用 PKCE、nonce/state、签名令牌校验；浏览器只获得 HttpOnly、Secure 会话 Cookie，个人数据写入另做 CSRF 校验。

## 判断方法

**供给：** 查询相关 GitHub 主题，以及仓库名称或描述中的短语；逐项列出实际检索式。仓库须未归档、不是 Fork、至少 5 Star，且 180 天内有提交。目前以 50 个符合条件的项目作为供给密集门槛。单主题采用搜索返回的数量，展示最多 100 个主要项目；多主题对返回项目去重，未完整枚举时给出下限。它不是全市场竞品普查，不包含所有无标签或闭源产品。

**搜索关注度（方法 1.1.0）：** 获取两年 Google Trends 数据。比较最近 8 个完整周与前 8 周的中位数，同时核对 4 周和 13 周变化。主词与同义词在同一地区、时间范围内采集，分别展示曲线，不相加归一化指数，也不选增速最高的词代替主词。

- 至少 26 个连续完整周，最近 26 周至少 60% 非零，前期中位数至少为 3。
- 上升 / 下降：8 周变化至少 ±10%，重采样区间全部位于零的同侧，短期和较长周期没有超过 10% 的反向变化。
- 平稳：8 周变化不到 10%，4 周和 13 周变化均不到 20%。其他可用情况、季节性反弹或同义词反向，标为**信号分歧**。
- 证据缺失、过旧、不连续、接近零或采集失败时保留 `uncertain`。只使用采集时已结束的周；同周冲突值阻止分类。重采样检查稳定性，不代表成功概率。

兼容字段 `fast` 仍表示更严格的 25% 突破诊断；页面方向与分类使用 `metrics.trend`。50 个仓库是依赖检索范围的经验门槛，**不能证明商业竞争激烈**；Google 搜索关注度**不等于客户需求增速**。每份报告展示原始词、来源日期及限制。

**仓库证据：** 使用 GitHub 官方 Star 历史自然日期分桶、有限的近期 Issue 样本、人工维护者回复和返回的贡献者提交数。自然日期窗口不代表滚动 24 小时净增。页面会说明样本范围；开放 Issue 是研究线索，不等于已验证的市场缺口。

**可复现性：** 来源证据、分析时间和方法版本共同决定报告 ID。旧报告的原始数据不变，重新扫描会产生新快照。初步建议可根据已记录的事实改进措辞，不会改写旧证据。本地报告只在主动分享时对外提供。

## 开发与部署

```sh
git clone https://github.com/noahbenjamin1994/ghtrends-radar.git
cd ghtrends-radar
npm ci
npm run check
npm run build
npm test
npm start
```

前端采用 React + TypeScript + Vite；核心为 TypeScript、Express、SQLite、Commander 与官方 MCP SDK。单包结构，无需外部数据库；LLM Key 为可选增强。

```sh
docker build -t ghtrends .
docker run --rm -p 3721:3721 -v ghtrends-data:/app/data \
  -e HOST=0.0.0.0 ghtrends
```

公共部署设置 `GHTRENDS_HOSTED=1`，首页仅展示精选赛道；自定义扫描需登录，保存为个人报告。关键词变体分开存储，不会覆盖标准赛道。配置 `PUBLIC_URL`；按需启用 `GHTRENDS_AUTO_COLLECT=1`，根据来源采集时间每日刷新精选赛道。`TRUST_PROXY` 仅填写实际受信任的反向代理网络。公共扫描限频，用户任务优先于定时采集；重新解释报告不会推迟数据刷新。

## 参与贡献

欢迎提交有证据的主题映射、算法反例测试、真实采集失败记录、翻译与无障碍改进。发现判断问题时，请附原始来源链接和时间戳。提交前运行上述检查。

如果 ghtrends 帮你找到了值得做的方向，欢迎分享报告、给项目点 Star，方便下次找到它。

MIT 协议。与 GitHub 或 Google 无隶属关系。Google Trends 采集复用了现有 trendscout 项目的经验。
