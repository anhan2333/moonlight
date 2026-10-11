// ============================================================
// 听歌 · Music plugin for 月光（InternalBeyond 同款精简版）
//   - 本机音频文件（可配 .lrc 歌词）全屏黑胶：唱臂落盘、逐句滚动
//   - 「一起听」：邀请安念共享正在播放，累计时长；TA 在对话里
//     知道你正和 TA 听这首歌（状态随歌词进度定时发给 TA）
//   - 迷你播放器：离开界面后留一枚可拖动的小唱机
// 完全本地播放，不依赖任何第三方曲库/中转。音频不上传。
// 不改动现有功能 —— 独立插件，独立面板。
// ============================================================

(function () {
  "use strict";

  const PLUGIN_NAME = "Music";
  let API_BASE = "";
  let AI_NAME = "安念";

  function authHeadersJson() {
    const secret = localStorage.getItem("companion_secret") || "";
    return { "Authorization": "Bearer " + secret, "Content-Type": "application/json" };
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }
  /* LRC 解析 → [{t, text}] */
  function parseLrc(raw) {
    const out = [];
    String(raw || "").split(/\r?\n/).forEach(line => {
      const times = [];
      let m;
      const re = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
      while ((m = re.exec(line))) times.push(+m[1] * 60 + +m[2] + (+(m[3] || 0) / Math.pow(10, m[3] ? m[3].length : 1)));
      const text = line.replace(/\[[^\]]*\]/g, "").trim();
      if (times.length && text) times.forEach(t => out.push({ t: t, text: text }));
    });
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  class Music {
    constructor() {
      this.audio = null;
      this.song = ""; this.artist = "";
      this.lyrics = []; this.lyricIdx = -1;
      this.together = false;     // 一起听进行中
      this.togetherStart = 0;
      this._beat = null;
      this._cover = "";
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
      console.log("[" + PLUGIN_NAME + "] ready");
    }

    buildUI() {
      if (document.getElementById("muPanel")) return;
      const wrap = document.createElement("div");
      wrap.id = "muPanel";
      wrap.className = "mu-panel hidden";
      wrap.innerHTML = `
        <div class="mu-top">
          <button class="mu-back" id="muBack" type="button" aria-label="返回">←</button>
          <div class="mu-title">听歌</div>
          <span class="mu-together-tag" id="muTag">💞 一起听 · <span id="muTagMin">0</span> 分钟</span>
        </div>
        <div class="mu-body">
          <div class="mu-vinyl">
            <div class="mu-disc" id="muDisc"><div class="mu-label" id="muLabel">🎵</div><div class="mu-spindle"></div></div>
            <div class="mu-arm" id="muArm"></div>
          </div>
          <div class="mu-now">
            <div class="mu-song" id="muSong">选一首本机歌</div>
            <div class="mu-artist" id="muArtist">支持 .mp3 / .m4a / .flac / .wav，可配 .lrc 歌词</div>
          </div>
          <div class="mu-lyric" id="muLyric"><div class="mu-lyric-inner" id="muLyricInner"></div></div>
          <input class="mu-seek" id="muSeek" type="range" min="0" max="1000" value="0">
          <div class="mu-times"><span id="muT0">0:00</span><span id="muT1">0:00</span></div>
          <div class="mu-controls">
            <button class="mu-ctrl" id="muPick2" type="button" title="换一首">🔁</button>
            <button class="mu-ctrl play" id="muPlay" type="button" aria-label="播放/暂停">▶</button>
            <button class="mu-ctrl" id="muStop" type="button" title="停止">⏹</button>
          </div>
        </div>
        <div class="mu-foot">
          <button class="mu-foot-btn" id="muPick" type="button">🎵 选本机音乐</button>
          <button class="mu-foot-btn" id="muPickLrc" type="button">📜 配歌词（.lrc）</button>
          <button class="mu-foot-btn" id="muTogether" type="button">💞 邀请${esc(AI_NAME)}一起听</button>
        </div>
      `;
      document.body.appendChild(wrap);

      const fi = document.createElement("input");
      fi.type = "file"; fi.accept = "audio/*"; fi.id = "muAudioInput"; fi.className = "hidden";
      const li = document.createElement("input");
      li.type = "file"; li.accept = ".lrc,text/plain"; li.id = "muLrcInput"; li.className = "hidden";
      wrap.appendChild(fi); wrap.appendChild(li);

      // 迷你唱机
      const mini = document.createElement("div");
      mini.id = "muMini";
      mini.className = "mu-mini";
      mini.innerHTML = '<div class="mu-label">🎵</div>';
      document.body.appendChild(mini);
      mini.addEventListener("click", () => this.open());
      let mx = null;
      mini.addEventListener("touchstart", (e) => { mx = { x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false }; }, { passive: true });
      mini.addEventListener("touchmove", (e) => {
        if (!mx) return;
        const dx = e.touches[0].clientX - mx.x, dy = e.touches[0].clientY - mx.y;
        if (Math.abs(dx) + Math.abs(dy) > 8) {
          mx.moved = true;
          const r = mini.getBoundingClientRect();
          mini.style.left = (r.left + dx) + "px"; mini.style.top = (r.top + dy) + "px";
          mini.style.right = "auto"; mini.style.bottom = "auto";
          mx.x = e.touches[0].clientX; mx.y = e.touches[0].clientY;
        }
      }, { passive: true });
      mini.addEventListener("touchend", () => { mx = null; });

      document.getElementById("muBack").addEventListener("click", () => this.close());
      document.getElementById("muPick").addEventListener("click", () => fi.click());
      document.getElementById("muPick2").addEventListener("click", () => fi.click());
      document.getElementById("muPickLrc").addEventListener("click", () => li.click());
      fi.addEventListener("change", () => this.loadAudio(fi.files && fi.files[0]));
      li.addEventListener("change", () => this.loadLrc(li.files && li.files[0]));
      document.getElementById("muPlay").addEventListener("click", () => this.togglePlay());
      document.getElementById("muStop").addEventListener("click", () => this.stop());
      document.getElementById("muSeek").addEventListener("input", (e) => { if (this.audio && this.audio.duration) this.audio.currentTime = e.target.value / 1000 * this.audio.duration; });
      document.getElementById("muTogether").addEventListener("click", () => this.toggleTogether());
    }

    bindMenuEntry() {
      const menu = document.querySelector(".menu-list");
      if (!menu) { setTimeout(() => this.bindMenuEntry(), 800); return; }
      if (menu.querySelector('[data-menu="music"]')) return;
      const btn = document.createElement("button");
      btn.className = "menu-item";
      btn.type = "button";
      btn.dataset.menu = "music";
      btn.innerHTML = `<span class="menu-ic">🎵</span><span class="menu-copy"><span class="menu-name">听歌</span><span class="menu-sub">黑胶 · 和安念一起听</span></span><span class="menu-chev">›</span>`;
      const anchor = menu.querySelector('[data-menu="tea"]');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      else menu.appendChild(btn);
      btn.addEventListener("click", (e) => { e.stopPropagation(); this.open(); }, true);
    }

    /* ---------- 曲目 ---------- */
    loadAudio(file) {
      if (!file) return;
      if (!this.audio) {
        this.audio = new Audio();
        this.audio.addEventListener("timeupdate", () => this.onTick());
        this.audio.addEventListener("ended", () => { this.paintDisc(); });
      }
      if (this._url) { try { URL.revokeObjectURL(this._url); } catch (e) {} }
      this._url = URL.createObjectURL(file);
      this.audio.src = this._url;
      const base = (file.name || "未命名").replace(/\.[^.]+$/, "");
      const parts = base.split(/[-–—_\s]+/);
      this.artist = parts.length > 1 ? parts[0].trim() : "";
      this.song = parts.length > 1 ? parts.slice(1).join(" ").trim() : base;
      document.getElementById("muSong").textContent = this.song;
      document.getElementById("muArtist").textContent = (this.artist ? this.artist + " · " : "") + "本机播放 · 不上传";
      this.lyrics = []; this.lyricIdx = -1;
      document.getElementById("muLyricInner").innerHTML = "";
      this.audio.play().then(() => this.paintDisc()).catch(() => this.paintDisc());
    }
    async loadLrc(file) {
      if (!file) return;
      try {
        const text = await file.text();
        this.lyrics = parseLrc(text);
        this.lyricIdx = -1;
        const inner = document.getElementById("muLyricInner");
        inner.innerHTML = this.lyrics.map((l, i) => '<div class="mu-lyric-line" data-i="' + i + '">' + esc(l.text) + "</div>").join("") || '<div class="mu-lyric-line">（没解析到歌词行）</div>';
        this.onTick();
      } catch (e) {}
    }
    togglePlay() {
      if (!this.audio || !this.audio.src) return;
      if (this.audio.paused) this.audio.play().catch(() => {});
      else this.audio.pause();
      this.paintDisc();
    }
    stop() {
      if (this.audio) { this.audio.pause(); try { this.audio.currentTime = 0; } catch (e) {} }
      this.paintDisc();
    }
    paintDisc() {
      const playing = !!(this.audio && this.audio.src && !this.audio.paused);
      document.getElementById("muDisc").classList.toggle("spinning", playing);
      document.getElementById("muArm").classList.toggle("on", playing);
      document.getElementById("muPlay").textContent = playing ? "⏸" : "▶";
      const mini = document.getElementById("muMini");
      if (mini) mini.classList.toggle("spinning", playing);
    }
    onTick() {
      const a = this.audio;
      if (!a) return;
      const dur = a.duration || 0;
      document.getElementById("muSeek").value = dur ? Math.round(a.currentTime / dur * 1000) : 0;
      document.getElementById("muT0").textContent = fmt(a.currentTime);
      document.getElementById("muT1").textContent = fmt(dur);
      // 歌词行
      if (this.lyrics.length) {
        let idx = -1;
        for (let i = 0; i < this.lyrics.length; i++) { if (this.lyrics[i].t <= a.currentTime) idx = i; else break; }
        if (idx !== this.lyricIdx) {
          this.lyricIdx = idx;
          const lines = document.querySelectorAll("#muLyricInner .mu-lyric-line");
          lines.forEach((l, i) => l.classList.toggle("cur", i === idx));
          const cur = lines[idx];
          const inner = document.getElementById("muLyricInner");
          if (cur && inner) inner.style.transform = "translateY(" + (26 - idx * 27) + "px)";
        }
      }
    }

    /* ---------- 一起听 ---------- */
    async toggleTogether() {
      if (this.together) { this.endTogether(); return; }
      if (!this.song) { this.toast("先选一首歌"); return; }
      const localOnly = location.hostname === "127.0.0.1" || location.hostname === "localhost";
      this.together = true;
      this.togetherStart = Date.now();
      document.getElementById("muTag").classList.add("on");
      document.getElementById("muTogether").classList.add("on");
      document.getElementById("muTogether").textContent = "💞 结束一起听";
      const msg = "💞[一起听] 她邀请你一起听《" + this.song + "》" + (this.artist ? "（" + this.artist + "）" : "") + "，正在本机播放。接下来每隔一会儿她会告诉你进度，陪她聊这首歌吧。";
      this.paintTag();
      if (localOnly) { this.toast("（本地预览）部署后" + AI_NAME + "才收得到"); return; }
      this.tell(msg);
      this._beat = setInterval(() => {
        this.paintTag();
        const min = Math.floor((Date.now() - this.togetherStart) / 60000);
        if (min > 0 && min % 3 === 0 && this._lastBeatMin !== min) {
          this._lastBeatMin = min;
          const line = (this.lyrics[this.lyricIdx] || {}).text || "";
          this.tell("💞[一起听] 已一起听《" + this.song + "》" + min + " 分钟" + (line ? "，正放到「" + line + "」" : "") + "。");
        }
      }, 20000);
    }
    endTogether() {
      this.together = false;
      if (this._beat) { clearInterval(this._beat); this._beat = null; }
      document.getElementById("muTag").classList.remove("on");
      document.getElementById("muTogether").classList.remove("on");
      document.getElementById("muTogether").textContent = "💞 邀请" + AI_NAME + "一起听";
      const min = Math.max(1, Math.floor((Date.now() - this.togetherStart) / 60000));
      const localOnly = location.hostname === "127.0.0.1" || location.hostname === "localhost";
      if (!localOnly) this.tell("💞[一起听] 结束，一起听了《" + this.song + "》" + min + " 分钟。");
      this.toast("一起听结束 · " + min + " 分钟");
    }
    paintTag() {
      const el = document.getElementById("muTagMin");
      if (el) el.textContent = String(Math.floor((Date.now() - this.togetherStart) / 60000));
    }
    async tell(text) {
      try {
        await fetch(API_BASE + "/app/send", {
          method: "POST", headers: authHeadersJson(),
          body: JSON.stringify({ text: text, meta: { source: "music_together", song: this.song } })
        });
      } catch (e) {}
    }
    toast(msg) {
      const t = document.createElement("div");
      t.style.cssText = "position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:9400;background:rgba(20,16,10,.85);color:#fff;font-size:12.5px;padding:9px 16px;border-radius:99px;";
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 2600);
    }

    open() {
      document.getElementById("muPanel").classList.remove("hidden");
      document.getElementById("muMini").classList.remove("on");
    }
    close() {
      document.getElementById("muPanel").classList.add("hidden");
      const playing = !!(this.audio && this.audio.src && !this.audio.paused);
      document.getElementById("muMini").classList.toggle("on", playing);
    }
  }

  const instance = new Music();
  window.MusicPlugin = instance;
  function boot() { instance.init(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
