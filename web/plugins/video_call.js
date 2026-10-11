// ============================================================
// 视频通话插件 · Video Call Plugin for 月光
// 理念来自 pai-voice（实时语音层）：
//   - 更稳定的实时传输（WebRTC + STUN，P2P 直连）
//   - 更好的网络适应性（连接状态监测、断线自动重连、超时控制）
//   - 更低延迟（LocalDescription 直连，减少中转）
//   - 更好的音画质量（可配置分辨率/帧率/码率，jitter buffer）
// 特色：视频画面 + 文字聊天同时进行（面板内输入框直接发消息）。
// 不改动现有语音通话 —— 独立插件，独立面板。
// ============================================================

(function () {
  "use strict";

  const PLUGIN_NAME = "VideoCall";
  let API_BASE = "";
  let AI_NAME = "安念";
  let HUMAN_NAME = "你";

  function authHeaders() {
    const secret = localStorage.getItem("companion_secret") || "";
    return { "Authorization": "Bearer " + secret };
  }
  function authHeadersJson() {
    return Object.assign({}, authHeaders(), { "Content-Type": "application/json" });
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  class VideoCall {
    constructor() {
      this.localStream = null;
      this.pc = null;               // RTCPeerConnection
      this.callId = null;
      this.active = false;
      this.minimized = false;
      this.startedAt = 0;
      this.timerHandle = null;
      this.reconnectTimer = null;
      this.chatLog = [];            // 通话内文字消息 {who, text}
      this.cfg = {
        video_resolution: "640x480",
        video_fps: 24,
        audio_enabled: true,
        audio_bitrate: "64k",
        network_timeout: 30,
        jitter_buffer: 100,
        frame_ms: 1000          // 抽帧档位：1000 实时流 / 5000 标准 / 60000 省流 / 0 关（陪伴独立按钮）
      };
      this.facing = "user";     // 前置 user / 后置 environment（pai-voice 同款翻转镜头）
      // ── IB 同款扩展状态 ──
      this.pendingFrame = null;     // 夹住的帧 {blob, dataUrl}
      this.frameQuality = "m";      // 画质三档 l / m / h
      this.danmakuOn = true;        // 弹幕开关
      this.giftSent = 0;            // 本场礼物计数（送出+收礼）
      this.companionMode = "live";  // live | companion（陪伴模式，独立于抽帧档位）
      this.source = "camera";       // 画帧来源：camera 摄像头 / screen 屏幕共享（pai-voice 同款）
      this.cameraMode = "live";     // 切到屏幕共享前摄像头用的模式，关屏幕共享后回到它
      this._lastScreenThumb = null; // 屏幕变化检测:64×36 灰度缩略图
      this._lastScreenSentAt = 0;
      this._screenThumbCanvas = null;
      this._dmLanes = [false, false, false];
    }

    /* ---------- 初始化 ---------- */
    async init() {
      // 读全局配置（index.html 同源）
      try {
        if (typeof window.CONFIG !== "undefined") {
          API_BASE = window.CONFIG.API_BASE || API_BASE || "";
          AI_NAME = window.CONFIG.AI_NAME || AI_NAME;
          HUMAN_NAME = window.CONFIG.HUMAN_NAME || HUMAN_NAME;
        }
      } catch (e) {}

      // 拉后端配置（fail-safe：拉不到就用默认）
      try {
        const r = await fetch(API_BASE + "/app/video/config", { headers: authHeaders() });
        if (r.ok) {
          const d = await r.json();
          Object.assign(this.cfg, d.config || {});
        }
      } catch (e) {}
      // 抽帧档位本地记忆（pai-voice：live 5s / companion 20s，这里四档+关）
      try {
        const saved = localStorage.getItem("vc_frame_ms");
        if (saved !== null && saved !== "") this.cfg.frame_ms = Number(saved);
        const q = localStorage.getItem("vc_frame_quality");
        if (q === "l" || q === "m" || q === "h") this.frameQuality = q;
        this.danmakuOn = localStorage.getItem("vc_danmaku") !== "0";
      } catch (e) {}

      this.buildUI();
      this.bindMenuEntry();
      console.log("[" + PLUGIN_NAME + "] plugin ready", this.cfg);
    }

    /* ---------- UI ---------- */
    buildUI() {
      if (document.getElementById("vcPanel")) return; // 幂等

      const wrap = document.createElement("div");
      wrap.id = "vcPanel";
      wrap.className = "vc-panel hidden";
      wrap.innerHTML = `
        <div class="vc-stage">
          <!-- 远端（AI）画面区：显示 AI 头像 + 呼吸光环；AI 侧有视频流时会切换为 <video> -->
          <div class="vc-remote" id="vcRemote">
            <img id="vcRemoteAvatar" src="avatar-sea.png" alt="">
            <div class="vc-remote-name">${escapeHtml(AI_NAME)}</div>
            <div class="vc-remote-status" id="vcRemoteStatus">等待接通…</div>
            <video id="vcRemoteVideo" autoplay playsinline class="hidden"></video>
          </div>
          <!-- 弹幕层（IB 同款）：TA 的话/你的输入/礼物提示逐条上浮 -->
          <div class="vc-danmaku" id="vcDanmaku" aria-hidden="true"></div>
          <!-- 礼物统计（右上，IB 同款） -->
          <div class="vc-gift-badge hidden" id="vcGiftBadge" title="本场礼物">🎁 <span id="vcGiftCount">0</span></div>
          <!-- 本地预览（小窗，可拖动） -->
          <div class="vc-local" id="vcLocal">
            <video id="vcLocalVideo" autoplay muted playsinline></video>
            <div class="vc-local-hint">你</div>
          </div>
          <!-- 计时 + 状态 -->
          <div class="vc-topbar">
            <span class="vc-badge" id="vcBadge">📹 视频通话</span>
            <span class="vc-timer" id="vcTimer">00:00</span>
            <button id="vcDanmakuBtn" class="vc-dm-toggle" type="button" title="弹幕开关">💬 弹幕</button>
          </div>
        </div>
        <!-- 通话内文字聊天：边看画面边打字 -->
        <div class="vc-chat">
          <!-- 夹帧条：拍的一帧先"夹住"，随下一条消息一起发（IB 同款，可换帧/取消/立即发） -->
          <div class="vc-pending hidden" id="vcPendingRow">
            <img id="vcPendingThumb" alt="已夹住的画面">
            <button id="vcPendingReshoot" class="vc-pending-act" type="button">换帧</button>
            <button id="vcPendingNow" class="vc-pending-act vc-pending-now" type="button">立即发</button>
            <button id="vcPendingCancel" class="vc-pending-x" type="button" aria-label="取消">✕</button>
          </div>
          <div class="vc-chat-log" id="vcChatLog" aria-live="polite"></div>
          <div class="vc-chat-input-row">
            <input id="vcChatInput" class="vc-chat-input" type="text" placeholder="通话时也可以打字…" autocomplete="off">
            <button id="vcChatSend" class="vc-chat-send" type="button" aria-label="发送">➤</button>
          </div>
        </div>
        <!-- 控制条 -->
        <div class="vc-controls">
          <button id="vcMicBtn" class="vc-ctl vc-ctl-mic on" type="button" title="麦克风">
            <span class="vc-ic">🎙</span><span class="vc-lb">麦克风</span>
          </button>
          <button id="vcCamBtn" class="vc-ctl vc-ctl-cam on" type="button" title="摄像头">
            <span class="vc-ic">📷</span><span class="vc-lb">摄像头</span>
          </button>
          <button id="vcShotBtn" class="vc-ctl vc-ctl-shot" type="button" title="夹住当前帧，随下一句发出">
            <span class="vc-ic">📸</span><span class="vc-lb">拍照</span>
          </button>
          <button id="vcScreenBtn" class="vc-ctl vc-ctl-screen" type="button" title="共享屏幕给安念">
            <span class="vc-ic">🖥</span><span class="vc-lb">屏幕</span>
          </button>
          <button id="vcAlbumBtn" class="vc-ctl vc-ctl-album" type="button" title="从相册发图">
            <span class="vc-ic">🖼</span><span class="vc-lb">相册</span>
          </button>
          <button id="vcVmsgBtn" class="vc-ctl vc-ctl-vmsg" type="button" title="录一段视频消息（10秒）">
            <span class="vc-ic">🎬</span><span class="vc-lb">视频消息</span>
          </button>
          <button id="vcGiftBtn" class="vc-ctl vc-ctl-gift" type="button" title="送安念礼物">
            <span class="vc-ic">🎁</span><span class="vc-lb">礼物</span>
          </button>
          <!-- pai-voice 同款：翻转镜头（手机前/后摄）+ 抽帧频率档位 -->
          <button id="vcFlipBtn" class="vc-ctl vc-ctl-flip" type="button" title="翻转镜头（前/后）">
            <span class="vc-ic">🔄</span><span class="vc-lb" id="vcFlipLb">前置</span>
          </button>
          <button id="vcFrameBtn" class="vc-ctl vc-ctl-frame" type="button" title="画面同步频率">
            <span class="vc-ic">⏱</span><span class="vc-lb" id="vcFrameLb">5秒/帧</span>
          </button>
          <button id="vcQualBtn" class="vc-ctl vc-ctl-qual" type="button" title="画质三档">
            <span class="vc-ic">✨</span><span class="vc-lb" id="vcQualLb">均衡</span>
          </button>
          <button id="vcCompBtn" class="vc-ctl vc-ctl-comp" type="button" title="陪伴模式：他安静地看着你，离开/回来/久坐会自然开口">
            <span class="vc-ic">❤️</span><span class="vc-lb">陪伴</span>
          </button>
          <button id="vcMiniBtn" class="vc-ctl vc-ctl-mini" type="button" title="最小化">
            <span class="vc-ic">🔽</span><span class="vc-lb">最小化</span>
          </button>
          <button id="vcEndBtn" class="vc-ctl vc-ctl-end" type="button" title="挂断">
            <span class="vc-ic">📞</span><span class="vc-lb">挂断</span>
          </button>
        </div>
      `;
      document.body.appendChild(wrap);

      // 最小化浮条
      const mini = document.createElement("div");
      mini.id = "vcMini";
      mini.className = "vc-mini hidden";
      mini.innerHTML = `<span class="vc-mini-dot"></span>📹 <span id="vcMiniTimer">00:00</span> <button id="vcMiniExpand" type="button">展开</button>`;
      document.body.appendChild(mini);

      // 相册文件选择器（隐藏）
      const albumInput = document.createElement("input");
      albumInput.type = "file";
      albumInput.id = "vcAlbumInput";
      albumInput.accept = "image/*";
      albumInput.style.display = "none";
      albumInput.addEventListener("change", (e) => this.onAlbumPicked(e));
      document.body.appendChild(albumInput);

      // 事件绑定
      document.getElementById("vcEndBtn").addEventListener("click", () => this.hangup());
      document.getElementById("vcMiniBtn").addEventListener("click", () => this.minimize());
      document.getElementById("vcMiniExpand").addEventListener("click", () => this.expand());
      document.getElementById("vcMicBtn").addEventListener("click", () => this.toggleMic());
      document.getElementById("vcCamBtn").addEventListener("click", () => this.toggleCam());
      document.getElementById("vcShotBtn").addEventListener("click", () => this.capturePendingFrame());
      document.getElementById("vcScreenBtn").addEventListener("click", () => this.toggleScreenShare());
      document.getElementById("vcAlbumBtn").addEventListener("click", () => this.pickAlbumPhoto());
      document.getElementById("vcVmsgBtn").addEventListener("click", () => this.toggleVideoMessage());
      document.getElementById("vcFlipBtn").addEventListener("click", () => this.flipCamera());
      document.getElementById("vcFrameBtn").addEventListener("click", () => this.cycleFrameRate());
      document.getElementById("vcQualBtn").addEventListener("click", () => this.cycleQuality());
      document.getElementById("vcCompBtn").addEventListener("click", () => this.toggleCompanion());
      document.getElementById("vcGiftBtn").addEventListener("click", () => this.openGiftTray());
      document.getElementById("vcDanmakuBtn").addEventListener("click", () => this.toggleDanmaku());
      document.getElementById("vcPendingReshoot").addEventListener("click", () => this.capturePendingFrame());
      document.getElementById("vcPendingCancel").addEventListener("click", () => this.clearPendingFrame());
      document.getElementById("vcPendingNow").addEventListener("click", () => this.sendPendingNow());
      this.paintFrameLabel();
      this.paintQualityLabel();
      this.paintDanmakuToggle();
      document.getElementById("vcChatSend").addEventListener("click", () => this.sendChat());
      document.getElementById("vcChatInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); this.sendChat(); }
      });

      // 最小化浮条点击主体也展开
      document.getElementById("vcMini").addEventListener("click", (e) => {
        if (e.target.id !== "vcMiniExpand") this.expand();
      });
    }

    /* 菜单入口：静态入口已在 index.html,这里只做兜底防重复（菜单可能晚于插件加载） */
    bindMenuEntry() {
      // 静态按钮已在 index.html 菜单里（v140+），dispatch 走 data-menu === "video_call"。
      // 老版本若是插件动态插入的,这里幂等保留:已有就跳过。
      const menu = document.querySelector(".menu-list") || document.querySelector(".menu");
      if (!menu) {
        setTimeout(() => this.bindMenuEntry(), 800);
        return;
      }
      if (menu.querySelector('[data-menu="video_call"]')) return;

      const btn = document.createElement("button");
      btn.className = "menu-item";
      btn.type = "button";
      btn.dataset.menu = "video_call";
      btn.innerHTML = `<span class="menu-ic">📹</span><span class="menu-copy"><span class="menu-name">视频通话</span><span class="menu-sub">和${escapeHtml(AI_NAME)}视频</span></span><span class="menu-chev">›</span>`;
      const voiceItem = menu.querySelector('[data-menu="voice"]');
      if (voiceItem && voiceItem.parentNode) voiceItem.parentNode.insertBefore(btn, voiceItem.nextSibling);
      else menu.appendChild(btn);

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.open();
      }, true);
    }

    /* ---------- 通话生命周期 ---------- */
    async open() {
      if (this.active) { this.expand(); return; }

      this.showPanel();
      this.setStatus("准备中…");
      this.appendSystem("正在发起视频通话…");

      // 0. 安全上下文检测：getUserMedia 只在 https / localhost 下可用。
      //    手机用 http://局域网IP 访问时 navigator.mediaDevices === undefined（之前报 TypeError 的根因）。
      if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.setStatus("语音模式（视频需 HTTPS）");
        this.appendSystem("⚠️ 摄像头/麦克风只在 HTTPS 或 localhost 下开放。");
        this.appendSystem("当前是 " + location.protocol + "//" + location.host + " （HTTP 明文地址）。");
        this.appendSystem("文字聊天不受影响，可继续使用。视频请在电脑端(localhost)使用，或等部署到 M10 后走 HTTPS/Tailscale。");
        this.active = true;   // 语音模式也算激活，翻转/静音等按钮可用
        this.startTimer();   // 语音模式也能计时/聊天（诊断：面板必须"有反应"）
        // 不直接挂断：面板留着，文字聊天照常可用
        return;
      }

      this.setStatus("正在打开摄像头…");

      // 1. 拿本地媒体流（网络适应：明确约束 + 失败降级）
      try {
        this.localStream = await this.getMedia();
      } catch (e) {
        // 降级：只要音频
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
          this.appendSystem("摄像头不可用，已切换为仅语音视频通话");
        } catch (e2) {
          this.setStatus("无法访问摄像头/麦克风");
          this.appendSystem("权限被拒或设备不可用：" + (e2 && e2.name ? e2.name : e2));
          this.appendSystem("（视频通话需要摄像头/麦克风权限。检查浏览器地址栏左侧的权限设置，或在系统设置里允许。）");
          // 不立即挂断：面板留着（计时器继续走），用户可自行点挂断 —— 避免"闪一下就没了，以为没反应"
          this.active = true;   // 语音模式也算激活，翻转/静音等按钮可用
          this.startTimer();
          return;
        }
      }
      const lv = document.getElementById("vcLocalVideo");
      if (lv) lv.srcObject = this.localStream;

      // 2. 通知后端（AI 知道这是视频通话，回复会带上下文）
      this.callId = "vcall-" + Date.now();
      this.active = true;
      this.startedAt = Date.now();
      try {
        await fetch(API_BASE + "/app/video/call", {
          method: "POST", headers: authHeadersJson(),
          body: JSON.stringify({ action: "start", call_id: this.callId })
        });
      } catch (e) {}

      // 3. 起 WebRTC（P2P 直连、低延迟；AI 侧接入后即可互看画面）
      await this.setupPeer();

      // 4. 计时 + 抽帧（pai-voice 理念：通话中每5秒一帧 → 后端存最新帧 → AI 想看就读）
      this.setStatus("已接通");
      this.startTimer();
      this.startFramePush();
      this.startVoiceCap();

      // 欢迎语（AI 会通过 SSE 收到 call_start，稍后回复会出现在聊天里）
      this.appendAI(`${AI_NAME}已接通视频，你可以打字或说话～`);
    }

    async getMedia() {
      const [w, h] = (this.cfg.video_resolution || "640x480").split("x").map(Number);
      const constraints = {
        video: { width: { ideal: w || 640 }, height: { ideal: h || 480 }, frameRate: { ideal: this.cfg.video_fps || 24 }, facingMode: "user" },
        // pai-voice 同款音频约束：回声消除 + 噪声抑制 + 自动增益（扬声器回声/环境噪声抑制）
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      };
      return await navigator.mediaDevices.getUserMedia(constraints);
    }

    /* ── 通话里说话 → 分段录音 → 服务器 ASR → AI 回复（语音通话同款链路）── */
    startVoiceCap() {
      this.stopVoiceCap();
      if (!navigator.mediaDevices || !window.MediaRecorder) return;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      try {
        this._voiceRec = new MediaRecorder(this.localStream, { mimeType: mime });
      } catch (e) { return; }
      this._voiceRec.ondataavailable = async (ev) => {
        if (!this.active || !ev.data || ev.data.size < 1200) return;
        try {
          const r = await fetch(API_BASE + "/app/voice?name=voice.webm&call_id=" + this.callId, {
            method: "POST",
            headers: Object.assign(authHeadersJson(), { "Content-Type": mime }),
            body: ev.data,
          });
          const d = await r.json();
          if (d && d.text) this.appendSystem("你：" + String(d.text).replace(/^🎤\s*/, ""));
        } catch (e) {}
      };
      this._voiceRec.start(8000);
    }
    stopVoiceCap() {
      if (this._voiceRec && this._voiceRec.state !== "inactive") {
        try { this._voiceRec.stop(); } catch (e) {}
      }
      this._voiceRec = null;
    }
        /* 每 N 秒把本地画面抽一帧（480宽 jpeg@0.6）传给后端，后端只保留最新一帧。
       AI 侧随时可 GET /app/video/eye 亲眼看；挂断/关摄像头自动停。
       频率来自档位 vcFrameMs：5s 实时 / 20s 陪伴 / 30s / 60s / 0 关闭（pai-voice 同款）。 */
    startFramePush() {
      this.stopFramePush();
      this._shotCanvas = null;
      // pai-voice 同款:屏幕共享 2 秒一帧(字幕/画面变了才发),摄像头按档位走
      const ms = this.source === "screen" ? 2000 : this.frameMs();
      if (ms > 0) this._frameTimer = setInterval(() => this.pushFrame(), ms);
    }
    /* 1s 实时档用小帧快传，其余档正常画质 */
    fastMode() { return this.frameMs() > 0 && this.frameMs() <= 2000; }
    frameMs() {
      const v = Number(this.cfg.frame_ms);
      return Number.isFinite(v) && v >= 0 ? v : 5000;
    }
    stopFramePush() {
      if (this._frameTimer) { clearInterval(this._frameTimer); this._frameTimer = null; }
    }
    /* 只有电脑浏览器能共享屏幕;iPhone/iPad 的 Safari 没有 getDisplayMedia(pai-voice 同款) */
    canShareScreen() {
      return typeof navigator !== "undefined" && !!navigator.mediaDevices.getDisplayMedia && !/iPhone|iPad|iPod/i.test(navigator.userAgent);
    }
    /* 屏幕变化检测(pai-voice _screenChanged 1:1):64×36 灰度缩略图比上帧,
       平均差 ≤0.3% 当没变(换一句字幕也算变了);每 60 秒至少发一帧保底。 */
    _screenChanged() {
      if (!this._screenThumbCanvas) {
        this._screenThumbCanvas = document.createElement("canvas");
        this._screenThumbCanvas.width = 64; this._screenThumbCanvas.height = 36;
      }
      const c = this._screenThumbCanvas.getContext("2d", { willReadFrequently: true });
      c.drawImage(this._shotCanvas, 0, 0, 64, 36);
      const d = c.getImageData(0, 0, 64, 36).data;
      const cur = new Float32Array(64 * 36);
      for (let i = 0; i < cur.length; i++) cur[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
      const now = Date.now();
      let changed = true;
      if (this._lastScreenThumb) {
        let sum = 0;
        for (let i = 0; i < cur.length; i++) sum += Math.abs(cur[i] - this._lastScreenThumb[i]);
        changed = sum / cur.length > 0.003 || now - (this._lastScreenSentAt || 0) > 60000;
      }
      if (changed) { this._lastScreenThumb = cur; this._lastScreenSentAt = now; }
      return changed;
    }
    /* 翻转镜头（顾川/pai-voice 原版）：facingMode 先 exact 后 ideal,iOS 对 ideal 常不理。
       pai-voice 原码在 _build/paivoice-voice-call.js.new:195-219,这里 1:1 对齐。 */
    async flipCamera() {
      if (this.source === "screen") { await this.stopScreenShare(); }   // pai-voice 同款:翻转 = 回到摄像头
      if (!this.active) { this.appendSystem("通话还没开始，先点接听"); return; }
      if (!window.isSecureContext || !navigator.mediaDevices) { this.appendSystem("当前环境不支持摄像头"); return; }
      const want = this.facing === "user" ? "environment" : "user";
      let fresh;
      try {
        // iOS 对 ideal 常常不理，先 exact 强制指定前/后摄；没有那一路（比如电脑）再退回 ideal
        fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: want }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      } catch (e) {
        if (e && (e.name === "OverconstrainedError" || e.name === "NotFoundError")) {
          try {
            fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: want }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
          } catch (e2) { this.appendSystem("没有可用的" + (want === "user" ? "前置" : "后置") + "摄像头"); return; }
        } else { this.appendSystem("翻转失败：" + (e.name || e)); return; }
      }
      const track = fresh && fresh.getVideoTracks()[0];
      if (!track) { this.appendSystem("没有拿到摄像头画面"); return; }
      // 校验拿到的真是想要的那一面（部分安卓 ideal 会静默给回原摄像头）
      const gotFacing = (track.getSettings && track.getSettings().facingMode) || "";
      const gotLabel = (track.label || "").toLowerCase();
      if (want === "environment" && (gotFacing === "user" || /front|face|前/.test(gotLabel))) {
        track.stop();
        this.appendSystem("这台设备好像没有后置摄像头");
        return;
      }
      // 停掉旧的视频轨（指示灯随真停而灭），接上新轨
      if (this.localStream) this.localStream.getVideoTracks().forEach(t => { try { t.stop(); } catch (e) {} this.localStream.removeTrack(t); });
      this.localStream.addTrack(track);
      this.facing = want;
      const lv = document.getElementById("vcLocalVideo");
      if (lv) lv.srcObject = new MediaStream([track]);
      const camBtn = document.getElementById("vcCamBtn");
      if (camBtn) { camBtn.classList.add("on"); camBtn.classList.remove("off"); }
      const lb = document.getElementById("vcFlipLb");
      if (lb) lb.textContent = want === "user" ? "前置" : "后置";
      this.appendSystem("已切换为" + (want === "user" ? "前置" : "后置") + "镜头");
      if (this._frameTimer) this.startFramePush();   // 按当前档位继续抽帧
    }
    /* 抽帧频率档位循环：5s → 20s(陪伴) → 30s → 60s → 关 → 5s */
    cycleFrameRate() {
      const order = [1000, 5000, 60000, 0];   // 1s=实时流 → 5s 标准 → 60s 省流 → 关（陪伴是独立按钮）
      const cur = this.frameMs();
      const next = order[(order.indexOf(cur) + 1) % order.length];
      this.cfg.frame_ms = next;
      try { localStorage.setItem("vc_frame_ms", String(next)); } catch (e) {}
      this.paintFrameLabel();
      if (this.active && this.localStream) this.startFramePush();
      this.appendSystem(next === 0 ? "画面同步已关（" + AI_NAME + "看不到你了）" : "画面同步：每 " + Math.round(next / 1000) + " 秒一帧");
    }
    paintFrameLabel() {
      const lb = document.getElementById("vcFrameLb");
      if (!lb) return;
      const ms = this.frameMs();
      lb.textContent = ms === 0 ? "已关" : Math.round(ms / 1000) + "秒/帧";
    }

    /* ══════════ IB 同款：弹幕层 ══════════
       TA 的话逐条上浮；你的输入与礼物/留影提示也走弹幕（可关）。 */
    toggleDanmaku() {
      this.danmakuOn = !this.danmakuOn;
      try { localStorage.setItem("vc_danmaku", this.danmakuOn ? "1" : "0"); } catch (e) {}
      this.paintDanmakuToggle();
      if (!this.danmakuOn) {
        const d = document.getElementById("vcDanmaku");
        if (d) d.innerHTML = "";
      }
    }
    paintDanmakuToggle() {
      const b = document.getElementById("vcDanmakuBtn");
      if (b) {
        b.classList.toggle("off", !this.danmakuOn);
        b.textContent = this.danmakuOn ? "💬 弹幕" : "💬 已关";
      }
    }
    spawnDanmaku(text, cls) {
      if (!this.danmakuOn || !text) return;
      const layer = document.getElementById("vcDanmaku");
      if (!layer) return;
      while (layer.children.length >= 6) layer.removeChild(layer.firstChild);   // 最多同时 6 条
      const laneFree = this._dmLanes.indexOf(false);
      const lane = laneFree >= 0 ? laneFree : Math.floor(Math.random() * this._dmLanes.length);
      this._dmLanes[lane] = true;
      const el = document.createElement("span");
      el.className = "vc-dm" + (cls ? " vc-dm-" + cls : "");
      el.style.top = (8 + lane * 30) + "%";
      el.textContent = text;
      el.addEventListener("animationend", () => { this._dmLanes[lane] = false; el.remove(); });
      layer.appendChild(el);
    }

    /* ══════════ IB 同款：夹帧拍照 ══════════
       拍的一帧先「夹住」（缩略图可换帧/取消/立即发），随你下一句话一起发出。 */
    async capturePendingFrame() {
      if (!this.localStream) return;
      const vtrack = this.localStream.getVideoTracks()[0];
      if (!vtrack || !vtrack.enabled) { this.appendSystem("摄像头已关，拍不了"); return; }
      const v = document.getElementById("vcLocalVideo");
      if (!v || !v.videoWidth) { this.appendSystem("画面还没就绪"); return; }
      try {
        const c = document.createElement("canvas");
        const [w, q] = this.qualityParams();
        const h = Math.round(v.videoHeight * (w / v.videoWidth));
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(v, 0, 0, w, h);
        const blob = await new Promise(res => c.toBlob(res, "image/jpeg", q));
        if (!blob) throw new Error("capture failed");
        const dataUrl = c.toDataURL("image/jpeg", 0.5);   // 缩略图用小一点
        this.pendingFrame = { blob: blob, dataUrl: dataUrl };
        this.paintPending();
        this.spawnDanmaku("📸 已夹住一帧，随下一句发出", "snap");
      } catch (e) {
        this.appendSystem("拍照失败：" + (e.message || e));
      }
    }
    clearPendingFrame() {
      this.pendingFrame = null;
      this.paintPending();
    }
    paintPending() {
      const row = document.getElementById("vcPendingRow");
      const img = document.getElementById("vcPendingThumb");
      if (!row) return;
      if (this.pendingFrame) {
        if (img) img.src = this.pendingFrame.dataUrl;
        row.classList.remove("hidden");
      } else {
        row.classList.add("hidden");
        if (img) img.src = "";
      }
    }
    /* 保留旧「立即拍照」能力：夹住的帧不等信息，立刻单独发出 */
    async sendPendingNow() {
      if (!this.pendingFrame) return;
      const frame = this.pendingFrame;
      this.clearPendingFrame();
      await this.deliverFrame(frame, "📸 [拍照]（来自视频通话）", {});
    }
    /* 上传一帧并作为附件消息发出（复用主聊天通道，多模态模型看得到） */
    async deliverFrame(frame, text, extraMeta) {
      try {
        const name = "vc-snap-" + Date.now() + ".jpg";
        const up = await fetch(API_BASE + "/app/upload?name=" + encodeURIComponent(name), {
          method: "POST", headers: authHeaders(), body: frame.blob
        });
        if (!up.ok) throw new Error("upload " + up.status);
        const upData = await up.json();
        await fetch(API_BASE + "/app/send", {
          method: "POST", headers: authHeadersJson(),
          body: JSON.stringify({
            text: text,
            meta: Object.assign({ attachments: [{ name: name, url: upData.url || ("/uploads/" + name) }], video_call: true, call_id: this.callId }, extraMeta || {})
          })
        });
        return true;
      } catch (e) {
        this.appendSystem("发送失败：" + (e.message || e));
        return false;
      }
    }

    /* ══════════ IB 同款：礼物系统（五档）══════════
       小心心/花束/夏日烟火/流星雨/银河铁道之夜；三档以上全屏画布特效；
       后端 /app/gift/send 落聊天记录；AI 可用 <ws_gift id="…"/> 回礼。 */
    async openGiftTray() {
      let tray = document.getElementById("vcGiftTray");
      if (tray) { tray.remove(); return; }              // 再点一次收起
      tray = document.createElement("div");
      tray.id = "vcGiftTray";
      tray.className = "vc-gift-tray";
      const gifts = [
        { id: "heart",    icon: "💗", name: "小心心",       tier: 1 },
        { id: "bouquet",  icon: "💐", name: "花束",         tier: 2 },
        { id: "firework", icon: "🎆", name: "夏日烟火",     tier: 3 },
        { id: "meteor",   icon: "🌠", name: "流星雨",       tier: 4 },
        { id: "galaxy",   icon: "🚂", name: "银河铁道之夜", tier: 5 }
      ];
      tray.innerHTML = gifts.map(g =>
        `<button class="vc-gift-item vc-gift-t${g.tier}" data-gift="${g.id}" type="button"><span class="vc-gift-ic">${g.icon}</span><span class="vc-gift-name">${g.name}</span></button>`
      ).join("") + `<button class="vc-gift-close" type="button" aria-label="收起">收起</button>`;
      document.getElementById("vcPanel").appendChild(tray);
      tray.addEventListener("click", (e) => {
        const item = e.target.closest("[data-gift]");
        if (item) { this.sendGift(item.dataset.gift); tray.remove(); return; }
        if (e.target.classList.contains("vc-gift-close")) tray.remove();
      });
    }
    async sendGift(giftId) {
      const names = { heart: "小心心", bouquet: "花束", firework: "夏日烟火", meteor: "流星雨", galaxy: "银河铁道之夜" };
      const icons = { heart: "💗", bouquet: "💐", firework: "🎆", meteor: "🌠", galaxy: "🚂" };
      const tiers = { heart: 1, bouquet: 2, firework: 3, meteor: 4, galaxy: 5 };
      const name = names[giftId]; if (!name) return;
      this.bumpGiftBadge();
      this.addGiftCard("human", icons[giftId] + " 你送了" + AI_NAME + "【" + name + "】");
      this.spawnDanmaku(icons[giftId] + " 送出【" + name + "】", "gift");
      this.playGiftEffect(giftId);
      const localOnly = location.hostname === "127.0.0.1" || location.hostname === "localhost";
      if (localOnly) { this.appendSystem("（本地预览：礼物特效照放，部署后写入聊天记录）"); return; }
      try {
        await fetch(API_BASE + "/app/gift/send", {
          method: "POST", headers: authHeadersJson(),
          body: JSON.stringify({ gift_id: giftId, reason: "视频通话里送出的" })
        });
      } catch (e) { this.appendSystem("礼物没送出去（网络）：" + (e.message || e)); }
    }
    receiveGift(giftId, reason) {
      const names = { heart: "小心心", bouquet: "花束", firework: "夏日烟火", meteor: "流星雨", galaxy: "银河铁道之夜" };
      const icons = { heart: "💗", bouquet: "💐", firework: "🎆", meteor: "🌠", galaxy: "🚂" };
      const name = names[giftId]; if (!name) return;
      this.bumpGiftBadge();
      this.addGiftCard("ai", icons[giftId] + " " + AI_NAME + "送了你【" + name + "】" + (reason ? " —— " + reason : ""));
      this.spawnDanmaku(icons[giftId] + " " + AI_NAME + "送你【" + name + "】", "gift");
      this.playGiftEffect(giftId);
    }
    bumpGiftBadge() {
      this.giftSent++;
      const badge = document.getElementById("vcGiftBadge");
      const n = document.getElementById("vcGiftCount");
      if (badge) badge.classList.remove("hidden");
      if (n) n.textContent = String(this.giftSent);
    }
    addGiftCard(who, text) {
      const log = document.getElementById("vcChatLog");
      if (!log) return;
      const div = document.createElement("div");
      div.className = "vc-msg vc-msg-gift" + (who === "ai" ? " vc-msg-gift-ai" : "");
      div.textContent = text;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }
    /* 全屏画布特效（收成小窗也照放）：烟火 3s / 流星雨 3.5s / 银河铁道之夜 8.2s */
    playGiftEffect(giftId) {
      if (giftId === "heart" || giftId === "bouquet") return;   // 一二档只有气泡
      const tier = giftId === "galaxy" ? 8200 : (giftId === "meteor" ? 3500 : 3000);
      const cvs = document.createElement("canvas");
      cvs.className = "vc-fx-canvas";
      cvs.width = window.innerWidth; cvs.height = window.innerHeight;
      document.body.appendChild(cvs);
      const ctx = cvs.getContext("2d");
      const W = cvs.width, H = cvs.height;
      const t0 = performance.now();
      const parts = [];
      const rand = (a, b) => a + Math.random() * (b - a);
      const burst = (x, y, hue, n) => {
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, sp = rand(1, 5.2);
          parts.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, hue: hue + rand(-18, 18), kind: "p" });
        }
      };
      const meteors = [];
      const spawnMeteor = () => meteors.push({ x: rand(W * 0.15, W), y: rand(-40, H * 0.35), vx: rand(-7, -4), vy: rand(3, 5.2), life: 1 });
      let lastMeteor = 0;
      const trainDots = [];
      if (giftId === "galaxy") {
        for (let i = 0; i < 90; i++) trainDots.push({ t: i / 90, off: rand(-14, 14) });
      }
      const frame = (now) => {
        const el = now - t0;
        ctx.clearRect(0, 0, W, H);
        const fade = Math.max(0, Math.min(1, (tier - el) / 600));         // 结尾淡出
        if (giftId === "firework") {
          if (Math.random() < 0.09 || parts.length < 40) burst(rand(W * .15, W * .85), rand(H * .12, H * .5), rand(0, 360), 46);
        }
        if (giftId === "meteor") {
          if (now - lastMeteor > 260) { lastMeteor = now; spawnMeteor(); spawnMeteor(); }
          meteors.forEach(m => {
            m.x += m.vx; m.y += m.vy; m.life -= 0.006;
            const g = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 12, m.y - m.vy * 12);
            g.addColorStop(0, "rgba(255,235,190," + (0.95 * m.life * fade) + ")");
            g.addColorStop(1, "rgba(255,235,190,0)");
            ctx.strokeStyle = g; ctx.lineWidth = 2.4; ctx.beginPath();
            ctx.moveTo(m.x, m.y); ctx.lineTo(m.x - m.vx * 12, m.y - m.vy * 12); ctx.stroke();
          });
          for (let i = meteors.length - 1; i >= 0; i--) if (meteors[i].life <= 0 || meteors[i].x < -80) meteors.splice(i, 1);
        }
        if (giftId === "galaxy") {
          // 整幅银河
          const band = ctx.createLinearGradient(0, H * 0.25, W, H * 0.62);
          band.addColorStop(0, "rgba(120,110,255,0)");
          band.addColorStop(0.5, "rgba(170,150,255," + (0.16 * fade) + ")");
          band.addColorStop(1, "rgba(90,80,200,0)");
          ctx.fillStyle = band; ctx.fillRect(0, 0, W, H);
          for (let i = 0; i < 140; i++) {   // 星尘
            const x = (i * 137.5) % W, y = (H * 0.28 + Math.sin(i * 0.7) * H * 0.12 + (i * 53) % (H * 0.3));
            ctx.fillStyle = "rgba(255,250,230," + (rand(0.15, 0.6) * fade) + ")";
            ctx.fillRect(x, y, 1.6, 1.6);
          }
          // 光的列车：沿弧线飞驰的光点列
          const p = (el % 2600) / 2600;
          trainDots.forEach(d => {
            const tt = (p + d.t) % 1;
            const x = W * (tt * 1.3 - 0.15);
            const y = H * 0.72 - Math.sin(tt * Math.PI) * H * 0.3 + d.off;
            const s = 1 + Math.sin(tt * Math.PI) * 2.4;
            const g2 = ctx.createRadialGradient(x, y, 0, x, y, s * 5);
            g2.addColorStop(0, "rgba(255,240,200," + (0.9 * fade) + ")");
            g2.addColorStop(1, "rgba(255,220,150,0)");
            ctx.fillStyle = g2;
            ctx.beginPath(); ctx.arc(x, y, s * 5, 0, Math.PI * 2); ctx.fill();
          });
          if (Math.random() < 0.05) burst(rand(W * .2, W * .8), rand(H * .1, H * .4), rand(200, 280), 26);
        }
        // 通用粒子
        for (let i = parts.length - 1; i >= 0; i--) {
          const pt = parts[i];
          pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.05; pt.life -= 0.016;
          if (pt.life <= 0) { parts.splice(i, 1); continue; }
          ctx.fillStyle = "hsla(" + pt.hue + ",95%," + (62 + pt.life * 15) + "%," + (pt.life * fade) + ")";
          ctx.beginPath(); ctx.arc(pt.x, pt.y, 2.1, 0, Math.PI * 2); ctx.fill();
        }
        if (el < tier) requestAnimationFrame(frame);
        else cvs.remove();
      };
      requestAnimationFrame(frame);
    }

    /* ══════════ IB 同款：AI 主动「留影」+ 回礼 + 来电 标记解析 ══════════
       <ws_vsnap/>          → 拍当前画面落进聊天
       <ws_gift id="…"/>    → 安念回礼（五档之一）
       <ws_vcall say="…"/>  → 安念发起视频来电（不在通话时弹横幅） */
    parseAiMarkup(rawText) {
      let text = String(rawText || "");
      // 留影
      if (/<\s*ws_vsnap\s*\/?\s*>/i.test(text)) {
        text = text.replace(/<\s*ws_vsnap\s*\/?\s*>/gi, "");
        this.autoSnap();
      }
      // 回礼
      const gm = text.match(/<\s*ws_gift\s+id\s*=\s*["']?([a-z_]+)["']?[^>]*?(?:reason\s*=\s*["']([^"']*)["'])?[^>]*\/?\s*>/i);
      if (gm) {
        text = text.replace(/<\s*ws_gift[\s\S]*?>/gi, "");
        this.receiveGift(gm[1], gm[2] || "");
      }
      return text.trim();
    }
    async autoSnap() {
      const vtrack = this.localStream && this.localStream.getVideoTracks()[0];
      if (!this.localStream || !vtrack || !vtrack.enabled) {
        this.spawnDanmaku("📸 " + AI_NAME + "想留影，但你的镜头没开", "snap");
        this.appendSystem(AI_NAME + "想留影，镜头没开没拍成");
        return;
      }
      const v = document.getElementById("vcLocalVideo");
      if (!v || !v.videoWidth) return;
      try {
        const c = document.createElement("canvas");
        const [w, q] = this.qualityParams();
        const h = Math.round(v.videoHeight * (w / v.videoWidth));
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(v, 0, 0, w, h);
        const blob = await new Promise(res => c.toBlob(res, "image/jpeg", q));
        if (!blob) return;
        const ok = await this.deliverFrame({ blob: blob, dataUrl: "" }, "📸 [留影] " + AI_NAME + "拍下了这一刻", { video_snapshot: true, by_ai: true });
        if (ok) {
          this.spawnDanmaku("📸 " + AI_NAME + "留下了这一刻", "snap");
          this.appendSystem("📸 " + AI_NAME + "拍了你的画面（已存进聊天）");
        }
      } catch (e) {}
    }

    /* ══════════ IB 同款：视频来电横幅 ══════════ */
    maybeIncoming(rawText) {
      if (this.active) return;
      const m = String(rawText || "").match(/<\s*ws_vcall(?:\s+say\s*=\s*["']([^"']*)["'])?[^\d]*kind\s*=\s*["']?video["']?[^>]*\/?\s*>/i)
            || String(rawText || "").match(/<\s*ws_vcall\s+say\s*=\s*["']([^"']*)["'][^>]*\/?\s*>/i);
      if (!m) return;
      this.incomingVideo(m[1] || "");
    }
    incomingVideo(sayText) {
      if (this.active || document.getElementById("vcIncoming")) return;
      const wrap = document.createElement("div");
      wrap.id = "vcIncoming";
      wrap.className = "vc-incoming";
      wrap.innerHTML =
        '<div class="vc-incoming-card">' +
          '<div class="vc-incoming-title">📹 ' + escapeHtml(AI_NAME) + '视频来电</div>' +
          '<div class="vc-incoming-say">' + escapeHtml(sayText || (AI_NAME + "想和你视频。")) + '</div>' +
          '<div class="vc-incoming-row">' +
            '<button class="vc-inc-decline" id="vcIncDecline" type="button">暂不</button>' +
            '<button class="vc-inc-accept" id="vcIncAccept" type="button">接听</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(wrap);
      const declineMsg = () => {
        wrap.remove();
        const localOnly = location.hostname === "127.0.0.1" || location.hostname === "localhost";
        if (!localOnly && typeof window.apiCallEvent === "function") window.apiCallEvent("declined", { call_id: "", channel: "video" }).catch(() => {});
      };
      document.getElementById("vcIncDecline").addEventListener("click", declineMsg);
      document.getElementById("vcIncAccept").addEventListener("click", () => { wrap.remove(); this.open(); });
      setTimeout(() => { if (document.getElementById("vcIncoming") === wrap) declineMsg(); }, 30000);   // 30 秒没人理自动收
    }
    async pushFrame() {
      if (!this.active || !this.localStream) return;
      const v = document.getElementById("vcLocalVideo");
      if (!v || !v.videoWidth) return;
      const screen = this.source === "screen";
      if (!this._screenStream && !screen) {      // 屏幕共享时抓的是共享画面，不用看摄像头开关
        const vtrack = this.localStream.getVideoTracks()[0];
        if (!vtrack || !vtrack.enabled) return;  // 摄像头关着不抽帧
      }
      try {
        if (!this._shotCanvas) this._shotCanvas = document.createElement("canvas");
        const c = this._shotCanvas;
        let w, q;
        if (screen) {
          // pai-voice 同款:屏幕 1280 宽(字幕和游戏里的字要看得清),0.72 画质
          w = 1280; q = 0.72;
        } else {
          const [qw, qq] = this.qualityParams();
          w = qw; q = qq;
        }
        const h = Math.round(v.videoHeight * (w / v.videoWidth));
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(v, 0, 0, w, h);
        if (screen && !this._screenChanged()) return;   // 画面没变就不发(回合制游戏/暂停时大部分时间是静止的)
        const blob = await new Promise(res => c.toBlob(res, "image/jpeg", q));
        if (!blob) return;
        const r = await fetch(API_BASE + "/app/video/frame", { method: "POST", headers: authHeaders(), body: blob });
        if (r.ok && !this._eyeHinted) { this._eyeHinted = true; this.appendSystem("📸 画面已同步给" + AI_NAME + "（每" + Math.round((screen ? 2000 : this.frameMs()) / 1000) + "秒一帧，TA随时能看）"); }
      } catch (e) { /* 帧上传失败静默：不影响通话 */ }
    }

    /* ── 画质三档（IB 同款 l/m/h）：l=省流 480/.6，m=均衡 640/.78，h=清晰 800/.9 ── */
    qualityParams() {
      if (this.fastMode()) return [320, 0.5];   // 1s 实时档：小帧快传，AI 只看动态
      if (this.frameQuality === "l") return [480, 0.6];
      if (this.frameQuality === "h") return [800, 0.9];
      return [640, 0.78];
    }
    cycleQuality() {
      const order = ["l", "m", "h"];
      this.frameQuality = order[(order.indexOf(this.frameQuality) + 1) % order.length];
      try { localStorage.setItem("vc_frame_quality", this.frameQuality); } catch (e) {}
      this.paintQualityLabel();
      this.appendSystem("画质：" + (this.frameQuality === "l" ? "省流" : this.frameQuality === "h" ? "清晰" : "均衡"));
    }
    paintQualityLabel() {
      const lb = document.getElementById("vcQualLb");
      if (lb) lb.textContent = this.frameQuality === "l" ? "省流" : this.frameQuality === "h" ? "清晰" : "均衡";
    }

    async setupPeer() {
      if (!this.localStream) return;
      try {
        this.pc = new RTCPeerConnection({
          iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
          bundlePolicy: "max-bundle",
          rtcpMuxPolicy: "require"
        });
        this.localStream.getTracks().forEach(t => this.pc.addTrack(t, this.localStream));

        this.pc.onicecandidate = (e) => {
          if (e.candidate) this.postJSON("/app/video/ice-candidate", { candidate: e.candidate.toJSON(), call_id: this.callId }).catch(() => {});
        };
        this.pc.ontrack = (e) => {
          // AI 侧将来接视频流后，这里自动切到真实画面
          const rv = document.getElementById("vcRemoteVideo");
          const ra = document.getElementById("vcRemoteAvatar");
          if (e.streams && e.streams[0] && rv) {
            rv.srcObject = e.streams[0];
            rv.classList.remove("hidden");
            if (ra) ra.classList.add("hidden");
          }
        };
        this.pc.onconnectionstatechange = () => {
          const st = this.pc && this.pc.connectionState;
          if (st === "connected") this.setStatus("已接通");
          else if (st === "disconnected") {
            this.setStatus("连接波动，正在恢复…");
            this.scheduleReconnect();
          } else if (st === "failed" || st === "closed") {
            this.setStatus("连接断开");
          }
        };

        const offer = await this.pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
        await this.pc.setLocalDescription(offer);
        await this.postJSON("/app/video/offer", { offer: { type: offer.type, sdp: offer.sdp }, call_id: this.callId });
      } catch (e) {
        // WebRTC 失败不阻塞通话：文字聊天照常可用
        console.warn("[" + PLUGIN_NAME + "] WebRTC setup failed (chat still works):", e);
        this.appendSystem("实时画面通道暂不可用，文字聊天不受影响");
      }
    }

    scheduleReconnect() {
      if (this.reconnectTimer) return;
      this.setStatus("连接波动，正在恢复…");
      // 顾川同款:断线标记 end(disconnect)——不算挂断,inbox 不出现 end;60s 内接回算同一通
      if (this.callId) {
        fetch(API_BASE + "/app/video/call", {
          method: "POST", headers: authHeadersJson(),
          body: JSON.stringify({ action: "end", call_id: this.callId, reason: "disconnect" })
        }).catch(() => {});
      }
      this.reconnectTimer = setTimeout(async () => {
        this.reconnectTimer = null;
        if (!this.active) return;
        try { if (this.pc) this.pc.close(); } catch (e) {}
        this.pc = null;
        await this.setupPeer();
        // 重连成功后,带同一 call_id 再 start 一次,后端 60s 内会判定为同一通
        if (this.active && this.callId) {
          try {
            const r = await fetch(API_BASE + "/app/video/call", {
              method: "POST", headers: authHeadersJson(),
              body: JSON.stringify({ action: "start", call_id: this.callId })
            });
            const d = await r.json().catch(() => ({}));
            if (d && d.resumed) this.appendSystem("⚡ 已接回同一通，不用重新打招呼");
          } catch (e) {}
        }
      }, 2500);
    }


    /* ══════════ 陪伴模式（独立开关，非抽帧档位）══════════ */
    async toggleCompanion() {
      const want = this.companionMode !== "companion" ? "companion" : "live";
      if (this.source === "screen") {
        // pai-voice 同款:屏幕共享时切陪伴 = 记下摄像头要用的模式,关了屏幕共享再用
        this.cameraMode = want;
        this.appendSystem("屏幕共享中：已记下" + (want === "companion" ? "陪伴" : "实时") + "模式，关闭共享后生效");
        return;
      }
      try {
        const r = await fetch(API_BASE + "/app/video/mode", {
          method: "POST", headers: authHeadersJson(),
          body: JSON.stringify({ mode: want })
        });
        if (!r.ok) throw new Error("mode " + r.status);
        const d = await r.json();
        this.companionMode = d.mode || want;
      } catch (e) {
        this.appendSystem("陪伴模式切换失败：" + (e.message || e));
        return;
      }
      const btn = document.getElementById("vcCompBtn");
      if (btn) btn.classList.toggle("on", this.companionMode === "companion");
      if (this.companionMode === "companion") {
        this._prevFrameMs = this.frameMs();
        this.cfg.frame_ms = 20000;             // 陪伴档：低频抽帧，省电省流（AI 自己按需评估）
        if (this.active && this.localStream) this.startFramePush();
        this.paintFrameLabel();
        this.spawnDanmaku("❤️ 陪伴模式：他安静地看着你，有事他会开口", "sys");
      } else {
        if (this._prevFrameMs) this.cfg.frame_ms = this._prevFrameMs;
        if (this.active && this.localStream) this.startFramePush();
        this.paintFrameLabel();
        this.spawnDanmaku("⚡ 已切回实时", "sys");
      }
    }

    /* ══════════ 共享屏幕（pai-voice 官方仓库 enableScreen 同款）══════════
       画面替代摄像头走同一条抽帧管线(1280宽/2秒一帧/变了才发),麦克风照旧。
       后端攒 10 秒的帧一次喂 5 张给模型串剧情——看剧/打游戏安念陪你一起看。 */
    async toggleScreenShare() {
      if (this.source === "screen") { this.stopScreenShare(); return; }
      if (!this.canShareScreen()) { this.appendSystem("这个浏览器/设备不支持共享屏幕（手机 Safari 没有 getDisplayMedia）"); return; }
      try {
        const disp = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: "always", frameRate: { ideal: 5, max: 10 } }, audio: false });
        const track = disp.getVideoTracks()[0];
        if (!track) { this.appendSystem("没拿到屏幕画面"); return; }
        this._stopVideoTracksSafe();
        this.localStream.addTrack(track);
        track.addEventListener("ended", () => { if (this.source === "screen") this.stopScreenShare(); });  // 点了浏览器的"停止共享"
        const v = document.getElementById("vcLocalVideo");
        if (v) v.srcObject = new MediaStream([track]);
        if (this.source !== "screen") this.cameraMode = this.companionMode;   // 记下摄像头原来的模式
        this.source = "screen";
        this._lastScreenThumb = null; this._lastScreenSentAt = 0;
        this.startFramePush();                                                // 切 2 秒一帧
        const b = document.getElementById("vcScreenBtn"); if (b) b.classList.add("on");
        this.spawnDanmaku("🖥 你在共享屏幕，安念会陪你一起看", "sys");
        this.appendSystem("🖥 屏幕共享中：画面 2 秒一帧、变了才发，安念每 10 秒把这几秒串成一句");
        try {
          await fetch(API_BASE + "/app/video/mode", { method: "POST", headers: authHeadersJson(), body: JSON.stringify({ mode: "screen" }) });
        } catch (e) {}
      } catch (e) {
        this.appendSystem("屏幕共享失败：" + (e.message || e));
      }
    }
    stopScreenShare() {
      if (this._screenStream) {
        this._screenStream.getTracks().forEach(t => t.stop());
        this._screenStream = null;
      }
      this._stopVideoTracksSafe();
      if (this.localStream) {
        const lv = document.getElementById("vcLocalVideo");
        if (lv) lv.srcObject = this.localStream;
      }
      this.source = "camera";
      this._lastScreenThumb = null;
      this.startFramePush();                            // 回摄像头档位
      const b = document.getElementById("vcScreenBtn");
      if (b) b.classList.remove("on");
      try {
        fetch(API_BASE + "/app/video/mode", { method: "POST", headers: authHeadersJson(), body: JSON.stringify({ mode: this.cameraMode || "live" }) });
      } catch (e) {}
      this.spawnDanmaku("📹 已切回摄像头画面", "sys");
    }
    _stopVideoTracksSafe() {
      if (!this.localStream) return;
      this.localStream.getVideoTracks().forEach(t => { try { t.stop(); } catch (e) {} this.localStream.removeTrack(t); });
    }

    /* ══════════ 相册发图 ══════════ */
    pickAlbumPhoto() {
      const inp = document.getElementById("vcAlbumInput");
      if (inp) inp.click();
    }
    async onAlbumPicked(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const name = "vc-album-" + Date.now() + ".jpg";
        const up = await fetch(API_BASE + "/app/upload?name=" + encodeURIComponent(name), {
          method: "POST", headers: authHeaders(), body: file
        });
        if (!up.ok) throw new Error("upload " + up.status);
        const upData = await up.json();
        await fetch(API_BASE + "/app/send", {
          method: "POST", headers: authHeadersJson(),
          body: JSON.stringify({
            text: "🖼 [相册] " + HUMAN_NAME + "从相册发了一张图",
            meta: { attachments: [{ name: name, url: upData.url || ("/uploads/" + name) }], video_call: true, call_id: this.callId }
          })
        });
        this.spawnDanmaku("🖼 已从相册发出", "sys");
      } catch (err) {
        this.appendSystem("相册发送失败：" + (err.message || err));
      }
    }

    /* ══════════ 视频消息（10秒） ══════════ */
    async toggleVideoMessage() {
      if (this._vmsgRec) { this._vmsgRec.stop(); return; }
      if (!this.localStream) { this.appendSystem("先开摄像头"); return; }
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus"
                 : MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "";
      let rec;
      try { rec = new MediaRecorder(this.localStream, mime ? { mimeType: mime } : undefined); }
      catch (e) { this.appendSystem("视频消息不支持：" + (e.message || e)); return; }
      this._vmsgChunks = [];
      rec.ondataavailable = e => { if (e.data.size) this._vmsgChunks.push(e.data); };
      rec.onstop = async () => {
        this._vmsgRec = null;
        const b2 = document.getElementById("vcVmsgBtn");
        if (b2) b2.classList.remove("on");
        if (!this._vmsgChunks.length) return;
        const blob = new Blob(this._vmsgChunks, { type: rec.mimeType || "video/webm" });
        const name = "vmsg-" + Date.now() + ".webm";
        try {
          const up = await fetch(API_BASE + "/app/upload?name=" + encodeURIComponent(name), {
            method: "POST", headers: authHeaders(), body: blob
          });
          if (!up.ok) throw new Error("upload " + up.status);
          const upData = await up.json();
          await fetch(API_BASE + "/app/send", {
            method: "POST", headers: authHeadersJson(),
            body: JSON.stringify({
              text: "🎬 [视频消息] " + HUMAN_NAME + "发来一段视频",
              meta: { attachments: [{ name: name, url: upData.url || ("/uploads/" + name), mime: blob.type, kind: "video" }], video_call: true, call_id: this.callId }
            })
          });
          this.spawnDanmaku("🎬 视频消息已发", "sys");
        } catch (err) {
          this.appendSystem("视频消息发送失败：" + (err.message || err));
        }
      };
      rec.start(200);
      this._vmsgRec = rec;
      const b3 = document.getElementById("vcVmsgBtn");
      if (b3) b3.classList.add("on");
      this.spawnDanmaku("🎬 录制中…再点一下或 10 秒后自动停止", "sys");
      setTimeout(() => { if (this._vmsgRec === rec) rec.stop(); }, 10000);
    }

    async hangup(recordText) {
      if (!this.active && !this.localStream) { this.hideAll(); return; }

      const dur = Math.max(0, Math.round((Date.now() - this.startedAt) / 1000));
      const mm = String(Math.floor(dur / 60)).padStart(2, "0");
      const ss = String(dur % 60).padStart(2, "0");
      const giftLine = this.giftSent > 0 ? "，礼物×" + this.giftSent : "";

      // 后端记录
      try {
        await fetch(API_BASE + "/app/video/call", {
          method: "POST", headers: authHeadersJson(),
          body: JSON.stringify({
            action: "record", call_id: this.callId,
            text: `${HUMAN_NAME}与${AI_NAME}视频通话 ${mm}:${ss}` + giftLine + (recordText ? `，聊了：${recordText}` : "")
          })
        });
      } catch (e) {}
      try {
        await fetch(API_BASE + "/app/video/call", {
          method: "POST", headers: authHeadersJson(),
          body: JSON.stringify({ action: "end", call_id: this.callId })
        });
      } catch (e) {}
      // 陪伴模式随挂断复位（下次通话默认实时）
      if (this.companionMode === "companion") {
        this.companionMode = "live";
        const cb = document.getElementById("vcCompBtn");
        if (cb) cb.classList.remove("on");
        try { fetch(API_BASE + "/app/video/mode", { method: "POST", headers: authHeadersJson(), body: JSON.stringify({ mode: "live" }) }); } catch (e) {}
      }

      // 清理（顾川 _releaseMedia 顺序：帧定时器 → 录音 → pc → 媒体轨 → 状态）
      this.active = false;
      this.stopTimer();
      this.stopFramePush();
      this.stopVoiceCap();
      this._eyeHinted = false;
      this.clearPendingFrame();
      this.giftSent = 0;
      this.source = "camera";          // 屏幕共享状态复位
      this._lastScreenThumb = null;
      const gb = document.getElementById("vcGiftBadge"); if (gb) gb.classList.add("hidden");
      const tray = document.getElementById("vcGiftTray"); if (tray) tray.remove();
      // 1) pc 先关（不再发流）
      try { if (this.pc) this.pc.close(); } catch (e) {}
      this.pc = null;
      // 2) 媒体轨全停（麦克风/摄像头指示灯真正灭）
      if (this.localStream) {
        this.localStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
        this.localStream = null;
      }
      // 3) 重连定时器最后清（避免上面任何一步触发它）
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      this.hideAll();
    }

    /* ---------- 控件 ---------- */
    /* 静音（顾川/pai-voice 同款）：真把音轨停掉（iOS 指示灯只认这个），取消时重新 getUserMedia 接回。
       优点：安卓/iOS 状态栏真实灭灯；你提的"我睡觉就不会按住说话"场景下，睡着了按到静音键也能真安静。 */
    async toggleMic() {
      if (!this.localStream) return;
      const tracks = this.localStream.getAudioTracks();
      const btn = document.getElementById("vcMicBtn");
      const goingMute = tracks.length && tracks[0].enabled;
      if (goingMute) {
        // 真静音：stop + removeTrack
        tracks.forEach(t => { try { t.stop(); } catch (e) {} this.localStream.removeTrack(t); });
        if (btn) { btn.classList.remove("on"); btn.classList.add("off"); }
        this.appendSystem("麦克风已静音（音轨已停）");
        return;
      }
      // 取消静音：重新拿一次麦克风
      try {
        const fresh = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
          video: false
        });
        const track = fresh.getAudioTracks()[0];
        if (!track) throw new Error("no track");
        this.localStream.addTrack(track);
        // WebRTC pc 也得换轨，否则对面还是听不到
        if (this.pc) {
          try {
            const senders = this.pc.getSenders ? this.pc.getSenders() : [];
            const audioSender = senders.find(s => s.track && s.track.kind === "audio");
            if (audioSender && audioSender.replaceTrack) await audioSender.replaceTrack(track);
            else this.pc.addTrack(track, this.localStream);
          } catch (e) {}
        }
        if (btn) { btn.classList.add("on"); btn.classList.remove("off"); }
        this.appendSystem("麦克风已开");
      } catch (e) {
        this.appendSystem("麦克风没拿回来：" + (e.message || e));
      }
    }
    toggleCam() {
      if (!this.localStream) return;
      const tracks = this.localStream.getVideoTracks();
      if (!tracks.length) return;
      tracks[0].enabled = !tracks[0].enabled;
      const btn = document.getElementById("vcCamBtn");
      btn.classList.toggle("on", tracks[0].enabled);
      btn.classList.toggle("off", !tracks[0].enabled);
      this.appendSystem(tracks[0].enabled ? "摄像头已开" : "摄像头已关");
    }
    minimize() {
      this.minimized = true;
      const p = document.getElementById("vcPanel");
      const m = document.getElementById("vcMini");
      if (p) p.classList.add("hidden");
      if (m) m.classList.remove("hidden");
    }
    expand() {
      this.minimized = false;
      const p = document.getElementById("vcPanel");
      const m = document.getElementById("vcMini");
      if (m) m.classList.add("hidden");
      if (p) p.classList.remove("hidden");
    }

    /* 拍照：截一帧本地画面发给 AI（走 /app/upload + /app/send，多模态模型可看到） */
    async snapshot() {
      if (!this.localStream) return;
      const vtrack = this.localStream.getVideoTracks()[0];
      if (!vtrack || !vtrack.enabled) { this.appendSystem("摄像头已关，拍不了"); return; }
      try {
        const v = document.getElementById("vcLocalVideo");
        const c = document.createElement("canvas");
        c.width = v.videoWidth || 640; c.height = v.videoHeight || 480;
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        const blob = await new Promise(res => c.toBlob(res, "image/jpeg", 0.85));
        if (!blob) throw new Error("capture failed");

        // 上传
        const name = "vc-snap-" + Date.now() + ".jpg";
        const up = await fetch(API_BASE + "/app/upload?name=" + encodeURIComponent(name), {
          method: "POST", headers: authHeaders(), body: blob
        });
        if (!up.ok) throw new Error("upload " + up.status);
        const upData = await up.json();

        // 发送（附件引用由后端/前端统一格式处理；这里用 meta 附上）
        const send = await fetch(API_BASE + "/app/send", {
          method: "POST", headers: authHeadersJson(),
          body: JSON.stringify({
            text: "📸 [视频通话截图]（来自视频通话）",
            meta: { attachments: [{ name: name, url: upData.url || ("/uploads/" + name) }], video_call: true, call_id: this.callId }
          })
        });
        if (!send.ok) throw new Error("send " + send.status);
        this.appendHuman("📸 拍了一张给你");
      } catch (e) {
        this.appendSystem("拍照失败：" + (e.message || e));
      }
    }

    /* ---------- 通话内聊天（边看画面边打字；夹住的帧随消息一起发）---------- */
    async sendChat() {
      const input = document.getElementById("vcChatInput");
      if (!input) return;
      const text = (input.value || "").trim();
      if (!text && !this.pendingFrame) return;
      input.value = "";
      this.spawnDanmaku(text, "human");                       // 你的输入也上弹幕（IB 同款，可关）
      const frame = this.pendingFrame;
      this.clearPendingFrame();

      // 本地预览(无后端)：假回复，保证链路在电脑上可试
      const localOnly = location.hostname === "127.0.0.1" || location.hostname === "localhost";
      if (localOnly) {
        if (frame) this.appendHuman(text ? text + " 📸[照片]" : "📸 [照片]");
        else this.appendHuman(text);
        this.setStatus("安念在回…");
        setTimeout(() => {
          this.appendAI("（本地预览）看到你啦～部署到服务器后就是真正的我了。");
          this.spawnDanmaku("（本地预览）看到你啦～", "ai");
          this.setStatus("已接通");
        }, 1200);
        return;
      }

      // 识图兜底（IB 同款）：画面同步关着时告诉 TA 看不到画面
      const visionNote = (this.frameMs() === 0) ? "（注：镜头画面同步未开启，你现在看不到我的画面）" : "";

      // 夹帧随消息发出：先传帧，再连文字一起发
      if (frame) {
        const sent = await this.deliverFrame(frame, (text || "📸 [照片]") + visionNote, { pending_shot: true });
        if (sent) this.appendHuman(text ? text + " 📸[照片]" : "📸 [照片]");
        return;
      }

      // 复用主聊天通道：AI 在通话上下文里回复（主界面也会同步出现）
      try {
        await fetch(API_BASE + "/app/send", {
          method: "POST", headers: authHeadersJson(),
          body: JSON.stringify({ text: text + visionNote, meta: { source: "video_call", call_id: this.callId } })
        });
      } catch (e) {
        this.appendSystem("发送失败，检查网络");
      }
    }

    /* ---------- 工具 ---------- */
    async postJSON(path, body) {
      const r = await fetch(API_BASE + path, { method: "POST", headers: authHeadersJson(), body: JSON.stringify(body) });
      if (!r.ok) throw new Error(path + " " + r.status);
      return r.json();
    }

    showPanel() {
      const p = document.getElementById("vcPanel");
      const m = document.getElementById("vcMini");
      if (p) { p.classList.remove("hidden"); }
      if (m) m.classList.add("hidden");
      const log = document.getElementById("vcChatLog");
      if (log) log.innerHTML = "";
    }
    hideAll() {
      const p = document.getElementById("vcPanel");
      const m = document.getElementById("vcMini");
      if (p) p.classList.add("hidden");
      if (m) m.classList.add("hidden");
    }
    setStatus(t) {
      const el = document.getElementById("vcRemoteStatus");
      if (el) el.textContent = t;
    }
    startTimer() {
      this.stopTimer();
      this.timerHandle = setInterval(() => {
        const dur = Math.max(0, Math.round((Date.now() - this.startedAt) / 1000));
        const mm = String(Math.floor(dur / 60)).padStart(2, "0");
        const ss = String(dur % 60).padStart(2, "0");
        const t = mm + ":" + ss;
        const el = document.getElementById("vcTimer");
        const mt = document.getElementById("vcMiniTimer");
        if (el) el.textContent = t;
        if (mt) mt.textContent = t;
      }, 1000);
    }
    stopTimer() { if (this.timerHandle) { clearInterval(this.timerHandle); this.timerHandle = null; } }

    appendHuman(text) { this.appendMsg("human", text); }
    appendAI(text) { this.appendMsg("ai", text); }
    appendSystem(text) { this.appendMsg("sys", text); }
    appendMsg(who, text) {
      const log = document.getElementById("vcChatLog");
      if (!log) return;
      const div = document.createElement("div");
      div.className = "vc-msg vc-msg-" + who;
      div.textContent = (who === "human" ? "" : who === "ai" ? AI_NAME + "：" : "· ") + text;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }

    /* 主界面 SSE 收到 AI 回复时，同步进通话面板（index.html 调用）。
       顺带处理 IB 标记：<ws_vsnap/> 留影 / <ws_gift/> 回礼，弹幕上浮。 */
    onAiReply(rawText) {
      if (!this.active) return;
      const text = this.parseAiMarkup(rawText);
      if (text) {
        this.appendAI(text);
        this.spawnDanmaku(text, "ai");
        this.speakReply(text);   // 原版 PaiVoice 同款：陪伴/通话里安念会开口说出来，不只是文字
      }
    }
    /* 把回复念出来（MOSS TTS）：剥掉动作旁白再念，被打断/挂断即停 */
    speakReply(text) {
      const clean = String(text || "").replace(/（[^）]*）|\([^)]*\)/g, "").replace(/[*#>「」]/g, "").replace(/\s*\n\s*/g, "，").trim();
      if (!clean) return;
      if (this._ttsAudio) { try { this._ttsAudio.pause(); } catch (e) {} this._ttsAudio = null; }
      fetch(API_BASE + "/app/tts", {
        method: "POST", headers: authHeadersJson(),
        body: JSON.stringify({ text: clean.slice(0, 300) })
      }).then(r => r.ok ? r.blob() : null).then(b => {
        if (!b || !this.active) return;
        const au = new Audio(URL.createObjectURL(b));
        this._ttsAudio = au;
        au.play().catch(() => {});
      }).catch(() => {});
    }
  }

  // 单例挂到 window，供 index.html / 其他插件调用
  const instance = new VideoCall();
  window.VideoCallPlugin = instance;

  function boot() { instance.init(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

