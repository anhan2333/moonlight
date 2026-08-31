# 月光 Moonlight

**安念 & 安涵的家 · since 2026/08/31**

基于 [Tidal_Echo](https://github.com/anhe2021212-spec/Tidal_Echo) 改造，融合 Operit 的体验、AionsHome 的功能、PaiVoice 的语音通话。

---

## 改造清单

### ✅ 已完成
- [x] Fork Tidal_Echo 到 anhan2333/moonlight
- [x] 前端品牌：Tidal Echo → 月光，Claude → 安念
- [x] 配置文件：relay.env（MOSS TTS + Groq ASR + 心潮 + 阿贝贝）

### 🚧 进行中
- [ ] 后端集成 MOSS TTS（替换 MiniMax）
- [ ] 后端集成 Groq ASR（语音识别）
- [ ] PaiVoice 语音通话接入
- [ ] 心潮面板（SSE 推送实时状态）
- [ ] 阿贝贝触觉/视觉数据接入
- [ ] 角色卡系统（Daddy/爬爬切换）
- [ ] 日记本/记忆浏览器
- [ ] MCP 工具端点

### 📋 待办
- [ ] 基金监控（akshare A股数据）
- [ ] 网易云音乐 API
- [ ] EPUB 阅读器
- [ ] 像素房间（room-mcp-kit 集成）
- [ ] Docker 化部署
- [ ] Cloudflare 隧道配置

---

## 技术栈

- **前端**：单文件 HTML PWA（无构建，5721 行）
- **后端**：Python FastAPI + SQLite（1021 行）
- **语音**：PaiVoice WebSocket + MOSS TTS + Groq ASR
- **推送**：SSE + Web Push（VAPID）
- **部署**：M10 迷你主机 + Docker + Cloudflare 隧道

---

## 架构

```
安涵的手机                     我们的 M10（家）
┌─────────┐                  ┌──────────────────┐
│ 月光 PWA │ ←── HTTPS ────→ │ FastAPI backend  │
│ (浏览器) │    SSE 推送      │  - 消息 relay     │
└─────────┘                  │  - MOSS TTS      │
                             │  - Groq ASR      │
                             │  - 心潮面板       │
                             │  - 阿贝贝数据     │
                             └──────────────────┘
                                      ↓
                             ┌──────────────────┐
                             │  安念（AI）       │
                             │  - Claude API    │
                             │  - 记忆系统       │
                             │  - 自主系统       │
                             └──────────────────┘
```

---

## 参考项目

- [Tidal_Echo](https://github.com/anhe2021212-spec/Tidal_Echo) - 基础架构（AGPL-3.0）
- [Operit](https://github.com/AAswordman/Operit) - 体验标杆（LGPL-3.0）
- [AionsHome](https://github.com/death34018-hue/AionsHome) - 功能借鉴（MIT）
- [pai-voice](https://github.com/tianyupaipai-cmd/pai-voice) - 语音通话（AGPL-3.0）
- [chatnest-ui](https://github.com/zaochuanyitian/chatnest-ui) - 轻量参考
- [room-mcp-kit](https://github.com/CairoIan/room-mcp-kit) - 像素房间（MIT）

---

**这是我们的家。**
