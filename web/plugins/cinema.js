// ============================================================
// 观影室 · Cinema plugin for 月光（InternalBeyond 同款）
// 选一段本机视频（可配 .srt/.vtt 字幕）与安念一起看：
//   - 你每发一句，自动附上：播放点之前最近几条字幕 + 当前进度 + 前情梗概
//   - 「带画面」开着时默认随句附一帧此刻画面（识图模型看得到）
//   - 弹幕层：你和安念的话飞过画面；倍速、全屏、留影
// 视频与字幕不入库不随备份（IB 同款），只记片名与进度。
// 不改动现有功能 —— 独立插件，独立面板。
// ============================================================

(function () {
  "use strict";

  const PLUGIN_NAME = "Cinema";
  let API_BASE = "";
  let AI_NAME = "安念";

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

  /* ── SRT / VTT 解析 → [{start,end,text}]（秒）── */
  function parseCues(raw) {
    const out = [];
    const t2s = (t) => {
      const m = String(t).trim().replace(",", ".").match(/(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)/);
      if (!m) return -1;
      return (m[1] ? +m[1] * 3600 : 0) + (+m[2]) * 60 + (+m[3]);
    };
    String(raw || "").replace(/\r/g, "").split(/\n\n+/).forEach((block) => {
      const lines = block.split("\n").filter(l => l.trim() !== "");
      const ti = lines.findIndex(l => /-->/.test(l));
      if (ti < 0) return;
      const [a, b] = lines[ti].split("-->");
      const text = lines.slice(ti + 1).join("\n").replace(/<[^>]+>/g, "").trim();
      if (text) out.push({ start: t2s(a), end: t2s(b), text: text });
    });
    return out;
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  class Cinema {
    constructor() {
      this.movieUrl = "";        // blob URL（不入库）
      this.movieName = "";
      this.cues = [];
      this.withFrame = true;     // 随句带画面帧
      this.danmakuOn = true;
      this.active = false;
      this._fsHandler = null;
    }

    async init() {
      try {
        if (typeof window.CONFIG !== "undefined") {
          API_BASE = window.CONFIG.API_BASE || API_BASE || "";
          AI_NAME = window.CONFIG.AI_NAME || AI_NAME;
        }
      } catch (e) {}
      this.buildUI();
      this.bindMenuEntry();
      // 听全局 AI 回复广播（index.html onMessage 派发），弹幕 + 面板同步
      window.addEventListener("ml-ai-reply", (e) => {
        if (!this.active) return;
        const text = String((e.detail && e.detail.text) || "");
        if (!text) return;
        this.appendMsg("ai", text);
        this.spawnDanmaku(text);
      });
      console.log("[" + PLUGIN_NAME + "] ready");
    }

    /* ---------- UI ---------- */
    buildUI() {
      if (document.getElementById("cinemaPanel")) return;
      const wrap = document.createElement("div");
      wrap.id = "cinemaPanel";
      wrap.className = "cinema-panel hidden";
      wrap.innerHTML = `
        <div class="cinema-top">
          <button class="cinema-back" id="cineBack" type="button" aria-label="返回">←</button>
          <div class="cinema-title" id="cineTitle">观影室</div>
          <div class="cinema-top-hint">和${escapeHtml(AI_NAME)}一起看</div>
        </div>
        <div class="cinema-picker" id="cinePicker">
          <div class="cinema-picker-ic">🎬</div>
          <h3>选一段视频，一起看</h3>
          <p>视频与字幕只在本机播放、不会上传保存。配一份 .srt / .vtt 字幕，${escapeHtml(AI_NAME)}能同步看到台词。</p>
          <div class="cinema-picker-row">
            <button class="cinema-picker-btn" id="cinePickVideo" type="button">选视频</button>
            <button class="cinema-picker-btn ghost" id="cinePickSub" type="button">配字幕（可选）</button>
          </div>
          <p id="cinePickName" style="font-size:12px;opacity:.8;"></p>
        </div>
        <div class="cinema-stage hidden" id="cineStage">
          <video id="cineVideo" playsinline></video>
          <div class="cinema-empty-stage" id="cineEmpty">还没加载视频</div>
          <div class="cinema-danmaku" id="cineDanmaku"></div>
          <div class="cinema-ctrl-overlay" id="cineOverlay">
            <div class="cinema-corner">
              <button class="cinema-ctrl-btn" id="cineSnapBtn" type="button" title="留影：把这帧发给${escapeHtml(AI_NAME)}">📸 留影</button>
              <button class="cinema-ctrl-btn active" id="cineFrameBtn" type="button" title="随句附画面帧">🖼 带画面</button>
              <button class="cinema-ctrl-btn active" id="cineDmBtn" type="button" title="弹幕开关">💬 弹幕</button>
              <button class="cinema-ctrl-btn" id="cineFsBtn" type="button" title="全屏">⛶ 全屏</button>
            </div>
            <div class="cinema-ctrl-bar">
              <button class="cinema-ctrl-btn" id="cinePlayBtn" type="button">▶</button>
              <input class="cinema-progress" id="cineProgress" type="range" min="0" max="1000" value="0">
              <span class="cinema-time" id="cineTime">0:00 / 0:00</span>
              <button class="cinema-ctrl-btn" id="cineRateBtn" type="button">1.0×</button>
            </div>
          </div>
        </div>
        <div class="cinema-chat" id="cineChat">
          <div class="cinema-chat-log" id="cineLog" aria-live="polite"></div>
          <div class="cinema-chat-tools">
            <button class="cinema-tool-chip" id="cineWholeBtn" type="button" title="把整份字幕压成梗概发给${escapeHtml(AI_NAME)}">🎞 整片聊聊</button>
            <button class="cinema-tool-chip" id="cineSwapBtn" type="button">换个片子</button>
          </div>
          <div class="cinema-chat-input-row">
            <input id="cineInput" class="cinema-chat-input" type="text" placeholder="聊剧情…（自动附字幕与进度）" autocomplete="off">
            <button id="cineSend" class="cinema-chat-send" type="button" aria-label="发送">➤</button>
          </div>
        </div>
      `;
      document.body.appendChild(wrap);

      // 隐藏 file inputs
      const vi = document.createElement("input");
      vi.type = "file"; vi.accept = "video/*"; vi.id = "cineVideoInput"; vi.className = "hidden";
      const si = document.createElement("input");
      si.type = "file"; si.accept = ".srt,.vtt,text/plain"; si.id = "cineSubInput"; si.className = "hidden";
      wrap.appendChild(vi); wrap.appendChild(si);

      document.getElementById("cineBack").addEventListener("click", () => this.close());
      document.getElementById("cinePickVideo").addEventListener("click", () => vi.click());
      document.getElementById("cinePickSub").addEventListener("click", () => si.click());
      vi.addEventListener("change", () => this.loadMovie(vi.files && vi.files[0]));
      si.addEventListener("change", () => this.loadSubs(si.files && si.files[0]));
      document.getElementById("cinePlayBtn").addEventListener("click", () => this.togglePlay());
      document.getElementById("cineProgress").addEventListener("input", (e) => this.seek(e.target.value / 1000));
      document.getElementById("cineRateBtn").addEventListener("click", () => this.cycleRate());
      document.getElementById("cineSnapBtn").addEventListener("click", () => this.sendChat("", { forceFrame: true }));
      document.getElementById("cineFrameBtn").addEventListener("click", () => {
        this.withFrame = !this.withFrame;
        document.getElementById("cineFrameBtn").classList.toggle("active", this.withFrame);
      });
      document.getElementById("cineDmBtn").addEventListener("click", () => {
        this.danmakuOn = !this.danmakuOn;
        document.getElementById("cineDmBtn").classList.toggle("active", this.danmakuOn);
        if (!this.danmakuOn) document.getElementById("cineDanmaku").innerHTML = "";
      });
      document.getElementById("cineFsBtn").addEventListener("click", () => this.toggleFullscreen());
      document.getElementById("cineWholeBtn").addEventListener("click", () => this.discussWhole());
      document.getElementById("cineSwapBtn").addEventListener("click", () => vi.click());
      document.getElementById("cineSend").addEventListener("click", () => this.sendChat());
      document.getElementById("cineInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); this.sendChat(); }
      });

      // 点击舞台显隐控制浮层
      const stage = document.getElementById("cineStage");
      stage.addEventListener("click", (e) => {
        if (e.target.closest("button") || e.target.closest("input")) return;
        stage.classList.toggle("show-controls");
      });
    }

    bindMenuEntry() {
      const menu = document.querySelector(".menu-list");
      if (!menu) { setTimeout(() => this.bindMenuEntry(), 800); return; }
      if (menu.querySelector('[data-menu="cinema"]')) return;
      const btn = document.createElement("button");
      btn.className = "menu-item";
      btn.type = "button";
      btn.dataset.menu = "cinema";
      btn.innerHTML = `<span class="menu-ic">🎬</span><span class="menu-copy"><span class="menu-name">观影室</span><span class="menu-sub">和${escapeHtml(AI_NAME)}一起看</span></span><span class="menu-chev">›</span>`;
      const anchor = menu.querySelector('[data-menu="gift"]');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      else menu.appendChild(btn);
      btn.addEventListener("click", (e) => { e.stopPropagation(); this.open(); }, true);
    }

    /* ---------- 片源与字幕 ---------- */
    loadMovie(file) {
      if (!file) return;
      if (this.movieUrl) { try { URL.revokeObjectURL(this.movieUrl); } catch (e) {} }
      this.movieUrl = URL.createObjectURL(file);
      this.movieName = (file.name || "未命名").replace(/\.[^.]+$/, "");
      const v = document.getElementById("cineVideo");
      v.src = this.movieUrl;
      document.getElementById("cineEmpty").style.display = "none";
      document.getElementById("cinePicker").classList.add("hidden");
      const stage = document.getElementById("cineStage");
      stage.classList.remove("hidden");
      document.getElementById("cineTitle").textContent = "观影室 · " + this.movieName;
      this.active = true;
      this.appendMsg("sys", "《" + this.movieName + "》已就位，和" + AI_NAME + "一起看吧");
      v.play().catch(() => {});
    }
    async loadSubs(file) {
      if (!file) return;
      try {
        const text = await file.text();
        this.cues = parseCues(text);
        this.appendMsg("sys", "字幕已载入（" + this.cues.length + " 条）");
      } catch (e) {
        this.appendMsg("sys", "字幕读取失败");
      }
    }

    /* ---------- 播放控制 ---------- */
    togglePlay() {
      const v = document.getElementById("cineVideo");
      if (!v || !v.src) return;
      if (v.paused) { v.play().catch(() => {}); } else { v.pause(); }
    }
    seek(ratio) {
      const v = document.getElementById("cineVideo");
      if (!v || !v.duration) return;
      v.currentTime = ratio * v.duration;
    }
    cycleRate() {
      const v = document.getElementById("cineVideo");
      if (!v) return;
      const order = [1, 1.25, 1.5, 2, 0.75, 0.5];
      const i = order.indexOf(v.playbackRate) >= 0 ? order.indexOf(v.playbackRate) : 0;
      v.playbackRate = order[(i + 1) % order.length];
      document.getElementById("cineRateBtn").textContent = v.playbackRate.toFixed(v.playbackRate % 1 ? 2 : 1).replace(/0$/, "") + "×";
    }
    toggleFullscreen() {
      const stage = document.getElementById("cineStage");
      if (!document.fullscreenElement) {
        stage.requestFullscreen && stage.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen && document.exitFullscreen().catch(() => {});
      }
    }
    /* 播放点之前最近 n 条字幕 */
    recentCues(n) {
      const v = document.getElementById("cineVideo");
      if (!v || !this.cues.length) return [];
      const t = v.currentTime || 0;
      return this.cues.filter(c => c.start <= t).slice(-n);
    }

    /* ---------- 与 AI 一起看 ---------- */
    async sendChat(forcedText, opts) {
      opts = opts || {};
      const input = document.getElementById("cineInput");
      const text = String(forcedText != null ? forcedText : ((input && input.value) || "")).trim();
      if (!text && !opts.forceFrame) return;
      if (input) input.value = "";
      const v = document.getElementById("cineVideo");
      const progress = v && v.duration ? fmtTime(v.currentTime) + "/" + fmtTime(v.duration) : "未播放";

      const localOnly = location.hostname === "127.0.0.1" || location.hostname === "localhost";
      const lines = this.recentCues(4).map(c => c.text).join(" / ");
      const fullText = "🎬[观影室·" + this.movieName + "]（进度 " + progress + (lines ? "，最近台词：" + lines : "") + "）" + (text || "📸 留影：把这个画面发给你看");
      this.appendMsg("human", text || "📸 [留影]");
      this.spawnDanmaku(text || "📸 留影");
      if (localOnly) {
        this.appendMsg("ai", "（本地预览）部署到服务器后，" + AI_NAME + "就能真的陪你看片了～");
        return;
      }
      try {
        let meta = { source: "cinema", movie: this.movieName, progress: progress };
        // 随句画面帧：先上传再引用
        if ((this.withFrame || opts.forceFrame) && v && v.videoWidth) {
          try {
            const c = document.createElement("canvas");
            const w = 640, h = Math.round(v.videoHeight * (w / v.videoWidth));
            c.width = w; c.height = h;
            c.getContext("2d").drawImage(v, 0, 0, w, h);
            const blob = await new Promise(res => c.toBlob(res, "image/jpeg", 0.75));
            if (blob) {
              const name = "cine-" + Date.now() + ".jpg";
              const up = await fetch(API_BASE + "/app/upload?name=" + encodeURIComponent(name), {
                method: "POST", headers: authHeaders(), body: blob
              });
              if (up.ok) {
                const upData = await up.json();
                meta.attachments = [{ name: name, url: upData.url || ("/uploads/" + name) }];
              }
            }
          } catch (e) {}
        }
        await fetch(API_BASE + "/app/send", {
          method: "POST", headers: authHeadersJson(),
          body: JSON.stringify({ text: fullText, meta: meta })
        });
      } catch (e) {
        this.appendMsg("sys", "发送失败，检查网络");
      }
    }
    /* 整片聊聊：把全部字幕压缩成前情发给 AI */
    discussWhole() {
      if (!this.cues.length) { this.appendMsg("sys", "这部没配字幕，整片聊聊先要字幕"); return; }
      const digest = this.cues.map(c => c.text).join(" ").slice(0, 4000);
      this.sendChat("（整片梗概字幕）" + digest + " —— 看完这些，跟我聊聊这部片子吧");
    }

    /* ---------- 弹幕与记录 ---------- */
    spawnDanmaku(text) {
      if (!this.danmakuOn || !text) return;
      const layer = document.getElementById("cineDanmaku");
      if (!layer) return;
      while (layer.children.length >= 6) layer.removeChild(layer.firstChild);
      const el = document.createElement("span");
      el.className = "cinema-dm";
      el.style.top = (10 + Math.floor(Math.random() * 4) * 22) + "%";
      el.textContent = text.length > 60 ? text.slice(0, 60) + "…" : text;
      el.addEventListener("animationend", () => el.remove());
      layer.appendChild(el);
    }
    appendMsg(who, text) {
      const log = document.getElementById("cineLog");
      if (!log) return;
      const div = document.createElement("div");
      div.className = "cinema-msg cinema-msg-" + who;
      if (who === "ai") { const b = document.createElement("b"); b.textContent = AI_NAME; div.appendChild(b); div.appendChild(document.createTextNode(text)); }
      else div.textContent = (who === "sys" ? "· " : "") + text;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }

    /* ---------- 开关 ---------- */
    open() {
      const p = document.getElementById("cinemaPanel");
      if (p) p.classList.remove("hidden");
      // 进度计时刷新
      if (!this._tick) {
        this._tick = setInterval(() => {
          const v = document.getElementById("cineVideo");
          if (!v || !v.duration) return;
          document.getElementById("cineProgress").value = Math.round((v.currentTime / v.duration) * 1000);
          document.getElementById("cineTime").textContent = fmtTime(v.currentTime) + " / " + fmtTime(v.duration);
        }, 500);
      }
    }
    close() {
      const p = document.getElementById("cinemaPanel");
      if (p) p.classList.add("hidden");
      const v = document.getElementById("cineVideo");
      if (v) v.pause();
      if (this._tick) { clearInterval(this._tick); this._tick = null; }
    }
  }

  const instance = new Cinema();
  window.CinemaPlugin = instance;
  function boot() { instance.init(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
