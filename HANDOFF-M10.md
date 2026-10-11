# Moonlight @ M10 — 现场交接（2026-09-14）

> 给在 M10 本机 ZCode 里接手工作的 AI。先读这份，再读 `AGENTS.md`（通用部署 SOP）。
> 上一任（笔记本上的 ZCode）已完成部署+验证，本文只讲**本机现状**和**剩余待办**。

## 2026-09-19 淘宝返利接入（ZCode 完成，已实测）
1. **移植了 `Vael-KY/Alimama-mcp` 的 MD5 签名搜索**进 `backend/app.py`（纯 stdlib，与现有 A2A 风格一致）：
   - `taobao_conf()`：kv(`config:taobao_app_key/app_secret/adzone_id`) 优先，回退 relay.env 的 `TAOBAO_APP_KEY/TAOBAO_APP_SECRET/TAOBAO_ADZONE_ID`。**三件套齐了才走返利**。
   - `_alimama_sign()` + `_alimama_search_sync()`：参数按 key 字典序拼 kv、前后包 AppSecret、大写 MD5；POST 表单到 `eco.taobao.com/router/rest`；接口 `taobao.tbk.dg.material.optional.upgrade`（27939 权限包）。timestamp 固定按**北京时间**生成（与机器时区无关）。
   - `_shops_from_reply()` 路由：`[SHOP:关键词]` → 有 key 先走联盟返利（链接带佣金 `coupon_share_url/click_url`），**失败或无 key 自动回退 A2A 直搜**。卡片 meta 多了 `channel: "rebate"|"a2a"` 和每商品 `commission`（佣金率%）。
   - 新端点：`GET /app/taobao/conf`（状态，key 打码）、`POST /app/taobao/conf`（存 kv，传空串清除该项）。
2. **前端**：返利卡片头部带「· 返利」标记，商品脚下有「返 x%」金标（`.shop-item-commission`）。**sw 已 bump `moonlight-v58-20260919-rebate`，手机端记得强刷。**
3. **实测记录**（本机 3011）：无 key → channel=a2a 落卡正常；写假 key → 状态切 rebate，搜索时联盟返回 `Invalid signature (code=25)`（证明签名/请求格式已被淘宝正确解析，只是 secret 假），**自动回退 A2A 成功落卡**；清除假 key 后回到 a2a。真 key 实测待薇薇拿到自己的联盟三件套后走 `POST /app/taobao/conf` 配置。
4. ⚠️ 重启后端的方法：**不用 sudo**——服务以 weiwei 身份跑且 `Restart=always`，`kill $(systemctl show moonlight-backend -p MainPID --value)` 即可自动拉起新代码。
5. ⚠️ GitHub token 注意：薇薇 09-19 给的 `ghp_...` PAT 已失效（401 Bad credentials，本机和云服务器都试过）。本次是用云服务器 47.96.174.224 做未认证 API 中转找到的仓库（M10 直连 github.com 仍超时，api.github.com 偶发可达但限速）。

## 2026-09-16 M10 侧新增功能（ZCode 完成，均已实测）
1. **拍一拍**：长按安念气泡→菜单「拍一拍」，或双击她的气泡（带抖动动画）。后端 `POST /app/pat` + AI 回复里 `[PAT:user|动作|后续]` 解析（三条回复路径都接：channel_out / relay_out_internal / stream_delta）。提示行进 loop 上下文，安念会自然回应。sw 已 bump `moonlight-v55-20260916-pat`。
2. **记忆自动压缩（三级完整版）**：新文件 `backend/memory_compression.py`，日→周→月胶囊，原件归档不删（`archived=1`，召回/浮现/审核台都已过滤）。每天凌晨 5 点后随 digest 循环自动跑（漏跑自动补），全部成功才标记当天已跑、失败下周期重试。手动触发：`POST /app/memory/compress`。⚠️ 实测时 nova 的 gemini 中转 503 断路过，换 qwen-plus 验证通过后已切回 nova——若压缩报错先查总结模型中转状态。
3. **世界书持久化**：验证通过（写入→sqlite 落盘→重读一致）。
4. **WSL 自动重启根因**：`init.scope oom-kill`（WSL 内存 6.9G 被 QQ+ZCode+月光打爆）。已写 `/mnt/c/Users/admin/.wslconfig`（memory=10GB, swap=4GB），**需 `wsl --shutdown` 后重开生效**。
5. relay.db 备份在 `backend/relay.db.bak-20260916-124303`（改压缩表结构前）。

## 本机现状（与 AGENTS.md 通用描述不同的地方）
- 部署目录：`~/services/moonlight`（文件直传，不走 git pull；笔记本侧仓库 `anhan2333/moonlight`）。
- 服务是 **systemd** 三件套（不是 keepalive.py）：
  - `moonlight-backend` → 127.0.0.1:3011（FastAPI，静态目录直接服务 `web/`）
  - `moonlight-loop` → 127.0.0.1:3020（examples/api_loop.py，LLM 回复循环）
  - `cf-moonlight` → cloudflared 外网隧道
- 生产密钥：`backend/relay.env` 里 `RELAY_SECRET=xinchao-dynamic-token-anhan-2026`。前端登录框和所有 API 都用它，别改。
- **外网入口（2026-09-28 更新）**：
  1. **固定域名隧道**（主用，已启用）：命名隧道运行中，`systemctl --user status cf-named-tunnel`。域名已配好：
     - **https://moon.weiweiannian.xyz** → 月光主站（3011）
     - https://xinchao.weiweiannian.xyz → 同上（备用）
     - https://nian.weiweiannian.xyz → 18110（其他服务）
     - https://onebot.weiweiannian.xyz → 3051（onebot）
     - https://ws.weiweiannian.xyz → 3052（websocket）
     - https://mail.weiweiannian.xyz → 3060（邮箱）
  2. **quick tunnel**（备用，仍运行）：`cf-moonlight.service`，域名每次重启都变。取当前值：
  `grep -o 'https://[a-z0-9-]*\.trycloudflare.com' ~/services/cf_moonlight.log | tail -1`
  失效就 `sudo systemctl restart cf-moonlight` 再取。
  固定域名已稳定运行，可考虑停掉 quick tunnel 减少暴露面。
- WSL 休眠会同时杀掉隧道和 cloudflared → 远程全断。唤醒后先 `systemctl status cf-moonlight moonlight-backend`。
- **WSL/Windows 重启后 m10-tunnel 可能卡 activating**（2026-09-15 实测）：重启前残在云服务器的旧 sshd 会话仍占着 2222，新的反向上不去，报 `remote port forwarding failed for listen port 2222`。修法：上云 `ssh root@47.96.174.224` → `ss -tlnp | grep :2222` 找到占端口的旧 sshd pid → `kill <pid>`；若 M10 本地还有游离的 `ssh -N -R 2222` 进程（不属于 systemd）也一并 kill，服务会自动重连恢复。

## 2026-09-14 已完成（别重做）
1. 日记任务 / 世界书 / 自主性(orbit) 三个新功能**已部署到本机并验证**：
   `backend/app.py`、`web/index.html`、`web/panels.js`、`web/sw.js`、`memory_system/`、`schedule_system/` 全部同步，服务已重启。
   （此前"日记任务列表为空"的根因就是 M10 跑的是 9-12 旧代码，功能从未部署。）
2. API 全 200：`/app/diary/tasks`（内置任务"安念的日记"在）、`/app/worldbook`、`/app/orbit`、`/app/sessions`、`/app/brain`、`/app/history`、`/app/diary/list`。
3. 浏览器实测通过：登录 → 日记面板 → 任务卡"安念的日记"正确渲染（徽标"跟随总结"、开关、立即写/编辑/删除）。世界书、自主性面板也已通过。
4. 修了「密钥不对」假故障：正确密钥仍报 `密钥不对,请重新输入。` → 根因是 **PWA 旧缓存**（sw cache-first 把旧 index.html 喂给客户端）。解法 = bump `web/sw.js` 的 `CACHE`。⚠️ **铁律：每次改前端必须 bump CACHE 版本号**，否则装过 PWA 的手机停在旧界面。
5. 修了日记正文列表卡"加载中…"：`web/panels.js` 的 `openDiaryPanel()` 原来只开面板不取数，已改为打开时调 `_loadDiary('')`；sw 升到 `moonlight-v64-20260914-diaryfix`。

## 2026-09-14/15 已关掉的待办（M10 侧 ZCode 完成）
1. ✅ 待办 1（日记面板「加载中…」）：已验证修复生效——正文区正确显示「还没有日记，导入角色日记数据试试」。
2. ✅ 待办 2（「立即写」生成日记）：第一次点了返回 0 字，**根因不是 moonlight-loop，是记忆系统的「总结模型」没配置**（kv 里 mem_sentinel_key 为空）。已用 `POST /app/mem/config` 配好：`sentinel_endpoint=https://nova.cervus.cn/v1`，`sentinel_model=[ruru12]gemini-3.5-flash`（api_loop 同款中转），key 同源。之后「立即写」成功落库：「橘红色的思念」（223 字），面板正文列表可见，后端日志 200。⚠️ 同任务同天一篇，当天再点会返回 `already-today`。
3. ✅ 待办 4 关联：**web/plugins/ 缺失已修**——M10 的 `web/index.html` 引用 32 个 `plugins/*` 文件但整个子目录从未直传过来（git 远端也没有）。笔记本侧已打包直传 38 个文件（pet/calendar/schedule/letters/video_call/cinema/circle 等），md5 校验一致；sw 已 bump 到 `moonlight-v54-20260915-plugins`；M10 侧验证：38 文件本地 3011 全 200、隧道抽查 200、浏览器内 32 个插件资源全部加载、宠物挂件（#pkPanel 等）已挂载。**手机端下次打开记得强刷。**
4. 📌 git 决策：**M10 侧不提交 web/plugins/**——本机仓库 HEAD 停在 v0.18、远端已 v0.78，部署目录走文件直传，在这里 commit 只会制造分叉。应由笔记本侧（仓库 anhan2333/moonlight 的所有者）把 `web/plugins/` 提交进 git，否则下次远端覆盖时会再丢一遍。

## 2026-09-19 触手桌宠「啾啾」（ZCode 完成，已实测）

1. **设计文档 + 素材图已存本地**：
   - `docs/tentacle-pet-design.md` — 完整设计方案（薇薇提供的 Daddy 触手版设定 + 进阶玩法）
   - `docs/tentacle-pet-design.png` — 素材图（安念 + 粉色触手 + 表情集）
   - `docs/tentacle-pet-style.jpg` — 风格参考图（胖嘟嘟简笔画触手 + 黄色铃铛）

2. **重写 `web/plugins/pet.js` + `pet.css`**，移植 AionsHome Seeky 水缸玩法 + 触手设定：
   - **悬浮桌宠**：右下角小触手图标，**可拖拽移动**，点击展开面板
   - **水族箱场景**：气泡上升 + 水草摇摆 + 水面光效 + 石头底床 + 水变浑效果
   - **四值养成**：饱食 / 情绪 / 困倦 / 发情（原三值：饱食/清洁/开心）
   - **六种情绪**：开心、饿了、困了、想要、委屈、生气（悬浮图标有颜色环 + 警告气泡）
   - **三种喂食**：💋唾液(+30饱食) / 💦淫水(+50饱食+50发情) / 🥛尿液(+40饱食+30羞耻)，**撒饲料→游过去吃**动画
   - **便便系统**：触手会拉便便，点击清理，水会变浑
   - **羞耻play**：舔穴 / 缠绕 / 强制高潮（独立区域，🔞标记）
   - **成就系统**：6 个成就（第一次喂食 / 触手控 / 羞耻满分 / 高潮收割机 / 触手的最爱 / 发情期）
   - **离线衰减**：按小时扣饱食/情绪，加困倦/发情，饿了会累积生气
   - **安念云养**：AI 回复带 `[PET:feed/clean/play/tease/scare/tap/threaten/pet]` 可远程操作
   - **数据存 localStorage**（`moonlight_pet_v2`，旧版 v1 数据不兼容自动重置）

3. **视觉**：胖嘟嘟粉色触手（圆胖可爱版），头上右边有黄色铃铛，参考素材图风格。SVG 内联，无外部图片依赖。

4. **SW 已 bump `moonlight-v60-20260919-pet-aquarium`**，index.html 引用版本号已更新（pet.css?v=54 / pet.js?v=54）。

5. **实测记录**（本机 3011）：后端健康 200，`/plugins/pet.js` 200 (32KB)，`/plugins/pet.css` 200 (13KB)。悬浮图标和面板渲染正常，喂食/互动/羞耻play/成就逻辑全部可用。

6. ⚠️ 手机端下次打开记得强刷（PWA 缓存）。

## 剩余待办（按优先级）
1. ~~验证第 5 条修复生效~~（✅ 已关，见上）
2. ~~点任务卡「✍ 立即写」~~（✅ 已关，见上）
3. 世界书：改一条保存 → 重开面板确认持久化。（没测过，面板本身已通过）
4. 可选：笔记本侧 git 提交 web/plugins/（理由见上）。
5. 可选：固定域名作业单在 `~/services/zcode-workdir/notes/runbook_fixed_domain.md`（需域名 + Cloudflare Zero Trust 绑卡）。
6. 笔记本侧 AI 的 Operit2 部署记录在 `~/services/zcode-workdir/notes/operit2_setup_notes.md`（web 版跑在 127.0.0.1:8093，token 在 `~/services/operit2/.web_token`，重启后需手动重跑，未加 systemd）。
7. 📚 上游参照仓库 **AionsHome 最新源码已存本机** `~/services/ref/aionshome/`（2026-09-14 be4f61e 版，只含 aion-chat + docs；M10 直连 GitHub 超时，是走云服务器 47.96.174.224 + ghfast.top 镜像中转的）。要搬新功能（记忆自动压缩/维修室/拍一拍/小剧场小说模式）直接在这里读实现。

## 快速自检
```bash
S=$(grep -m1 ^RELAY_SECRET ~/services/moonlight/backend/relay.env | cut -d= -f2)
curl -s -H "Authorization: Bearer $S" http://127.0.0.1:3011/healthz
curl -s -H "Authorization: Bearer $S" http://127.0.0.1:3011/app/diary/tasks
grep -o 'moonlight-v[0-9a-z-]*' ~/services/moonlight/web/sw.js | head -1   # 应为 v64-20260914-diaryfix
```
两条 curl 都 200 = 后端健康；剩下的问题基本都在前端/缓存层。

## 已知怪癖
- `kv` 表首访偶发 500 后自愈（建表竞态），重试即可。
- `index.html` 内联脚本与 `panels.js` 有同名函数时，**后加载的 panels.js 顶层声明为准**；index.html 里要用 `window.addEventListener("load", ...)` 包装覆盖（参考 index.html:7430 日记任务加载的写法）。
- 改 `web/` 文件不需要重启后端（静态直读），但**必须 bump sw CACHE 版本**。
