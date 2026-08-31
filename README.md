# 实习招聘聚合-杨逍爹制作

零依赖 Node.js（≥24，内置 `node:sqlite` / `fetch` / `http`，无需 `npm install`）实现的实习招聘聚合站：爬取**字节跳动、阿里巴巴、腾讯、拼多多、美团、快手**招聘官网的技术/研发实习岗（社招、校招已移除，全站仅保留实习岗），按时间窗口分「6个月内更新 / 今日更新（近24小时）/ 今周更新（近7天）/ 今月更新（近30天）/ 无时间标注」板块展示，并支持「人才专项计划」筛选。

## 快速开始

```bash
npm start
```

启动后先自动抓取一次（约 1-3 分钟），之后每 2 小时自动更新。浏览器访问 <http://localhost:3000>。

其他命令：

```bash
npm run crawl     # 手动立即抓取一次
npm run probe     # 只探测 6 个数据源接口与字段映射，不写库
npm test          # 运行单元测试
PORT=8080 npm start   # 自定义端口
```

## 功能

- 五个板块：「6个月内更新」（近 6 个月）、今日更新（近 24h）、今周更新（近 7 天）、今月更新（近 30 天）、**无时间标注**（来源未提供发布时间的岗位），按发布时间倒序。
- 无时间标注的岗位同时出现在「6个月内更新」，但不会进入「今日/今周/今月」板块。
- 筛选：公司、**人才专项（是/否）**、关键词、城市；**页码分页**（上一页/下一页、页码、输入跳转任意页）。
- 人才专项岗位带「人才专项」标签：字节 Seed 大模型 / 前沿技术领域、腾讯青云计划、美团北斗计划、快手快Star、阿里阿里星/C-Star。
- 岗位卡片：公司、标题（外链到官网详情页）、类别、城市、部门、招聘类型标签、相对 + 绝对发布时间。
- 顶部数据源状态横幅：各源正常 / 部分可用 / 暂不可用，以及上次抓取时间与总数。
- 接口：`GET /api/jobs?period=all|today|week|month|missing&company&recruitType&q&city&page&pageSize`、`GET /api/stats`、`GET /api/health`、`POST /api/crawl`（手动触发抓取）。

## 数据来源与抓取方式

| 公司 | 实习 | 说明 |
| --- | --- | --- |
| 字节跳动 | ✅ | campus 接口仅抓实习（recruitment_id=202），含 Seed 大模型人才实习、日常实习、ByteIntern；每源上限 3000 条 |
| 腾讯 | ✅ | join.qq.com 实习项目：日常实习 / 应届实习 / 青云计划-实习生；技术族 + AI 专项过滤；接口无发布时间，统一以首见时间归入 6 个月内 |
| 阿里巴巴 | ✅ | campus-talent 接口仅抓实习（internship 批次 + topTalentPlan/星计划人才专项）；阿里星/C-Star 标记为人才专项；每源上限 2000 条 |
| 拼多多 | ✅ | 仅实习列表接口（position/train/list）；当前公开接口技术岗较少 |
| 美团 | ✅ | jobType=2 实习；北斗计划岗位标题带【北斗】 |
| 快手 | ✅ | campus 站点仅抓实习生项目；快Star岗位标题带【快Star】 |

- 技术岗过滤：源类别优先（技术/研发/工程/算法/测试/运维…），标题关键词白/黑名单兜底（排除产品/运营/市场/销售/人力/财务等）。
- 单个数据源失败仅标记「暂不可用」并记录日志，不影响其他源与页面展示。
- 每源每次上限：字节 3000、阿里 2000、腾讯 1000，其余默认 500（`MAX_JOBS_PER_SOURCE` 可调）；全局限速 ≥1s，15s 超时，2 次退避重试；自识别浏览器 UA 与 `Accept-Language: zh-CN`。
- 数据仅保留各官网公开岗位信息，个人非商业用途；请遵守目标网站服务条款与访问频率限制。

## 目录结构

```
src/
  config.js           # 端口、窗口、限额等配置
  time.js             # 滚动窗口、时间解析/格式化
  db.js               # node:sqlite：jobs 表、幂等 upsert、下线与清理
  crawler/
    index.js          # 抓取编排、状态写入、--probe 探测模式
    utils.js          # 限速客户端、技术岗过滤、分页工具
    bytedance.js      # 字节跳动
    tencent.js        # 腾讯（join.qq.com 实习）
    alibaba.js        # 阿里巴巴（实习，上限 2000）
    pinduoduo.js      # 拼多多
    meituan.js        # 美团
    kuaishou.js       # 快手（实习）
  server.js           # HTTP 服务：静态文件 + JSON API + 定时更新
public/               # 前端（纯 HTML/CSS/JS，无 CDN，可离线）
test/                 # node --test 单元测试
data/                 # 运行时生成的数据库与状态（已 gitignore）
```

## 数据模型

`jobs` 表主键为 `id = company:postId`。字段：`company`、`title`、`category`、`recruit_type`、`city`、`department`、`description`、`url`、`published_at`、`first_seen_at`、`last_seen_at`、`active`。按 id 幂等 upsert；某次抓取未再出现的旧岗自动下线（`active=0`，页面隐藏）；90 天前仍未恢复的非活跃记录会被清理。

## 常见问题

- **页面显示某公司「暂不可用」**：多为该公司接口临时变更或网络受限，不影响其他公司数据；可稍后点击「重新抓取」或运行 `npm run crawl`。
- **抓取速度较慢**：为保证对官网的礼貌访问，全局限速 ≥1s/请求，全量抓取约 1-3 分钟。
- **某公司岗位数是整数上限（如 500/1000/2000）**：这是每源每次抓取的上限（默认 500，腾讯 1000、阿里 2000），防止单次抓取过慢；若某源岗位特别多会顶到上限。需要调整可设置环境变量，如 `MAX_JOBS_PER_SOURCE=1000 npm start`。
- **拼多多为 0**：拼多多招聘官网公开接口当前只返回管培生等非技术岗，属于源站现状，非程序问题；页面状态横幅会显示「正常（暂无技术岗）」。
- **腾讯实习岗**：来自 join.qq.com（日常实习 / 应届实习 / 青云计划-实习生），接口不提供发布时间，统一归入「无时间标注」板块（同时保留在「6个月内更新」），以首次抓取时间作为展示时间，且每次抓取保留原时间，不会反复挤进「今日更新」。
- **全站只有实习岗**：按要求已移除社招与校招，仅保留各公司实习岗位；字节（含 Seed 大模型人才实习）上限 3000 条、阿里 2000 条。
- **数据目录**：`data/jobs.db`（SQLite）与 `data/status.json`（各源状态）。删除 `data/` 后重新 `npm start` 会全量重建。

## 让朋友也能访问

### 情况一：朋友和你连接同一个 WiFi / 局域网

1. 保持 `npm start` 运行，不要关闭窗口。
2. 放行防火墙端口（只需一次）：
   - 双击项目里的 **`开启局域网访问.bat`**（右键 → 以管理员身份运行）；或
   - 以管理员身份运行 PowerShell，执行：
     ```powershell
     netsh advfirewall firewall add rule name="RecruitSite3000" dir=in action=allow protocol=TCP localport=3000
     ```
3. 把你的局域网 IP 发给朋友（服务器启动日志里也会显示），形如：
   `http://192.168.0.100:3000`

> 提示：`npm start` 时终端会打印「局域网访问（同一网络的朋友）: http://…」。家庭路由器若开启「AP 隔离」会阻断设备互访，需在路由器设置里关闭。

### 情况二：朋友在异地（公网访问）

局域网 IP 只能在同一网络内访问。异地访问需要「内网穿透」或把项目部署到云服务器，任选其一：

- **Cloudflare Tunnel（免费、无需公网 IP）**：安装 `cloudflared` 后运行 `cloudflared tunnel --url http://localhost:3000`，会得到一个 `https://xxx.trycloudflare.com` 临时公网地址。
- **ngrok（免费）**：安装后运行 `ngrok http 3000`，得到临时公网地址。
- **国内工具**：cpolar / 花生壳（贝锐）也提供类似内网穿透，需注册账号。
- **云服务器部署**：把本项目放到有公网 IP 的服务器上（Node ≥24），`npm start` 后用 Nginx/Caddy 反代到 80 端口即可。

> 注意：任何内网穿透工具都会把你的本地服务暴露到公网，仅供临时分享；长期使用建议加访问密码或部署到云服务器。

### 本项目已配好的公网隧道（Cloudflare 快速隧道）

1. 保持 `npm start` 运行。
2. 双击 **`启动公网隧道.bat`**（或在 PowerShell 里运行）：
   ```powershell
   & "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:3000 --no-autoupdate
   ```
3. 从终端输出中找到形如 `https://xxx.trycloudflare.com` 的地址发给朋友。

> 重要：快速隧道地址是**临时的**——每次启动隧道都会生成新的随机域名，`npm start` 或隧道重启后需重新获取地址。想长期固定地址，需要注册 Cloudflare 账号创建 Named Tunnel，或改用云服务器部署。
