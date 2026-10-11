// ============================================================
// 朋友圈 · Circle+ plugin for 月光（InternalBeyond 同款完整版）
// 后端早已支持（/app/circle/*），旧面板只做了发字+列表，这里补齐：
//   - 配图（至多 4 张，自动压缩后上传）+ 心情 + 可见范围
//   - 点赞、评论、评论输入框
//   - 「让安念评论」：AI 回复经全局广播接回，自动以安念身份落评论
// 老面板 openCirclePanel 的入口原样保留；本插件只是把菜单点击
// 接到新面板（capture 阶段拦截，不删不改任何旧代码）。
// ============================================================

(function () {
  "use strict";

  const PLUGIN_NAME = "CirclePlus";
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
  function attSrc(u) {
    u = String(u || "");
    if (/^https?:/.test(u)) return u;
    const name = u.split("/").pop();
    return "/uploads/" + name + "?token=" + encodeURIComponent(localStorage.getItem("companion_secret") || "");
  }
  function fmtTs(ts) {
    try {
      const d = new Date(ts);
      if (isNaN(d)) return String(ts || "");
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      const hm = d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
      return sameDay ? "今天 " + hm : (d.getMonth() + 1) + "/" + d.getDate() + " " + hm;
    } catch (e) { return String(ts || ""); }
  }
  const MOODS = ["", "😊 平静", "🥰 甜", "😔 低落", "😤 烦", "🤒 不舒服", "🌙 深夜感性", "✨ 有奔头"];
  const VIS = [
    { v: "friends", label: "仅彼此可见" },
    { v: "public",  label: "所有 AI 可见" },
    { v: "private", label: "仅自己" }
  ];

  class CirclePlus {
    constructor() {
      this.pendImages = [];      // 待发布的本地图 [{blob, dataUrl, name}]
      this.feed = [];
      this._aiCommentFor = null; // 等安念回复来落评论的 post id
      this._likedIds = new Set(JSON.parse(localStorage.getItem("crp_liked") || "[]"));
    }

    async init() {
      try {
        if (typeof window.CONFIG !== "undefined") {
          API_BASE = window.CONFIG.API_BASE || API_BASE || "";
          AI_NAME = window.CONFIG.AI_NAME || AI_NAME;
          HUMAN_NAME = window.CONFIG.HUMAN_NAME || HUMAN_NAME;
        }
      } catch (e) {}
      this.buildUI();
      this.hijackMenuEntry();
      // 安念回复广播 → 落成评论
      window.addEventListener("ml-ai-reply", (e) => {
        const text = String((e.detail && e.detail.text) || "");
        if (this._aiCommentFor && text && !/^\s*[🎬🔧🗂【]/.test(text)) {
          const postId = this._aiCommentFor;
          this._aiCommentFor = null;
          this.comment(postId, text, AI_NAME);
        }
      });
      console.log("[" + PLUGIN_NAME + "] ready");
    }

    buildUI() {
      if (document.getElementById("crpPanel")) return;
      const wrap = document.createElement("div");
      wrap.id = "crpPanel";
      wrap.className = "crp-panel hidden";
      wrap.innerHTML = `
        <div class="crp-top">
          <button class="crp-back" id="crpBack" type="button" aria-label="返回">←</button>
          <div>
            <div class="crp-title">朋友圈</div>
            <div class="crp-sub">你和${escapeHtml(AI_NAME)}的动态</div>
          </div>
          <button class="crp-refresh" id="crpRefresh" type="button">刷新</button>
        </div>
        <div class="crp-compose">
          <textarea id="crpText" placeholder="这一刻的想法…"></textarea>
          <div class="crp-thumbs" id="crpThumbs"></div>
          <div class="crp-compose-row">
            <button class="crp-img-btn" id="crpImgBtn" type="button">🖼 配图</button>
            <select id="crpMood">${MOODS.map(m => `<option value="${m}">${m || "心情（可选）"}</option>`).join("")}</select>
            <select id="crpVis">${VIS.map(v => `<option value="${v.v}">${v.label}</option>`).join("")}</select>
            <button class="crp-send" id="crpSend" type="button">发布</button>
          </div>
        </div>
        <div class="crp-feed" id="crpFeed"><div class="crp-loading">加载中…</div></div>
      `;
      document.body.appendChild(wrap);

      const fi = document.createElement("input");
      fi.type = "file"; fi.accept = "image/*"; fi.multiple = true; fi.id = "crpImgInput"; fi.className = "hidden";
      wrap.appendChild(fi);

      document.getElementById("crpBack").addEventListener("click", () => this.close());
      document.getElementById("crpRefresh").addEventListener("click", () => this.loadFeed());
      document.getElementById("crpImgBtn").addEventListener("click", () => fi.click());
      fi.addEventListener("change", () => this.addImages(fi.files));
      document.getElementById("crpSend").addEventListener("click", () => this.post());
      // 停留时每 30 秒轻刷
      this._poll = setInterval(() => {
        const p = document.getElementById("crpPanel");
        if (p && !p.classList.contains("hidden")) this.loadFeed(true);
      }, 30000);
    }

    /* 菜单「朋友圈」点击接到新面板（老面板函数原样保留） */
    hijackMenuEntry() {
      const tryBind = () => {
        const item = document.querySelector('.menu-list [data-menu="circle"]');
        if (!item) { setTimeout(tryBind, 800); return; }
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          this.open();
        }, true);   // capture：比菜单统一处理先到
      };
      tryBind();
    }

    /* ---------- 图片 ---------- */
    async addImages(files) {
      if (!files || !files.length) return;
      for (const f of Array.from(files)) {
        if (this.pendImages.length >= 4) { this.toast("最多 4 张"); break; }
        try {
          const small = await this.compress(f);
          this.pendImages.push(small);
        } catch (e) {}
      }
      this.paintThumbs();
    }
    compress(file) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          const MAX = 1080;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) { const r = Math.min(MAX / w, MAX / h); w = Math.round(w * r); h = Math.round(h * r); }
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          c.toBlob((blob) => {
            URL.revokeObjectURL(url);
            if (!blob) return reject(new Error("compress failed"));
            resolve({ blob: blob, dataUrl: c.toDataURL("image/jpeg", 0.4), name: "circle-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6) + ".jpg" });
          }, "image/jpeg", 0.8);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("read failed")); };
        img.src = url;
      });
    }
    paintThumbs() {
      const box = document.getElementById("crpThumbs");
      if (!box) return;
      box.innerHTML = "";
      this.pendImages.forEach((im, i) => {
        const d = document.createElement("div");
        d.className = "crp-thumb";
        d.innerHTML = '<img alt=""><button type="button" aria-label="移除">✕</button>';
        d.querySelector("img").src = im.dataUrl;
        d.querySelector("button").addEventListener("click", () => { this.pendImages.splice(i, 1); this.paintThumbs(); });
        box.appendChild(d);
      });
    }

    /* ---------- 发布 / 时间线 ---------- */
    async post() {
      const textEl = document.getElementById("crpText");
      const text = (textEl.value || "").trim();
      if (!text && !this.pendImages.length) { this.toast("写点什么或配张图"); return; }
      const btn = document.getElementById("crpSend");
      btn.disabled = true;
      try {
        const names = [];
        const localOnly = location.hostname === "127.0.0.1" || location.hostname === "localhost";
        for (const im of this.pendImages) {
          if (localOnly) { names.push(im.name); continue; }
          const up = await fetch(API_BASE + "/app/upload?name=" + encodeURIComponent(im.name), {
            method: "POST", headers: authHeaders(), body: im.blob
          });
          if (up.ok) {
            const d = await up.json();
            names.push(d.url || ("/uploads/" + im.name));
          }
        }
        await fetch(API_BASE + "/app/circle/post", {
          method: "POST", headers: authHeadersJson(),
          body: JSON.stringify({
            content: text || "📷",
            author: HUMAN_NAME,
            images: names.join(","),
            mood: document.getElementById("crpMood").value,
            visibility: document.getElementById("crpVis").value
          })
        });
        textEl.value = "";
        this.pendImages = [];
        this.paintThumbs();
        await this.loadFeed();
        this.toast("已发布");
      } catch (e) {
        this.toast("发布失败：" + (e.message || e));
      } finally {
        btn.disabled = false;
      }
    }
    async loadFeed(silent) {
      const box = document.getElementById("crpFeed");
      if (!box) return;
      if (!silent) box.innerHTML = '<div class="crp-loading">加载中…</div>';
      const localOnly = location.hostname === "127.0.0.1" || location.hostname === "localhost";
      if (localOnly) {
        box.innerHTML = '<div class="crp-empty">（本地预览）朋友圈数据存在服务器上，部署后这里就是你和' + escapeHtml(AI_NAME) + '的时间线。</div>';
        return;
      }
      try {
        const r = await fetch(API_BASE + "/app/circle/feed", { headers: authHeaders() });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        this.feed = d.feed || [];
        this.paintFeed();
      } catch (e) {
        box.innerHTML = '<div class="crp-empty">加载失败：' + escapeHtml(e.message || e) + "</div>";
      }
    }
    paintFeed() {
      const box = document.getElementById("crpFeed");
      if (!box) return;
      if (!this.feed.length) {
        box.innerHTML = '<div class="crp-empty">还没有动态，发第一条吧。</div>';
        return;
      }
      box.innerHTML = "";
      this.feed.forEach(p => {
        const isAi = p.author === AI_NAME;
        const liked = this._likedIds.has(p.id);
        const imgs = String(p.images || "").split(",").map(s => s.trim()).filter(Boolean);
        const el = document.createElement("div");
        el.className = "crp-post" + (isAi ? " is-ai" : "");
        el.innerHTML =
          '<div class="crp-post-head">' +
            '<div class="crp-avatar">' + escapeHtml((p.author || "?").slice(0, 1)) + "</div>" +
            "<div>" +
              '<div class="crp-author"></div>' +
              '<div class="crp-meta">' + escapeHtml(fmtTs(p.created_at)) + " · " + escapeHtml((VIS.find(v => v.v === p.visibility) || VIS[0]).label) + "</div>" +
            "</div>" +
            (p.mood ? '<span class="crp-mood">' + escapeHtml(p.mood) + "</span>" : "") +
          "</div>" +
          '<div class="crp-text"></div>' +
          (imgs.length ? '<div class="crp-imgs">' + imgs.map(u => '<img src="' + escapeHtml(attSrc(u)) + '" alt="">').join("") + "</div>" : "") +
          '<div class="crp-acts">' +
            '<button class="crp-act' + (liked ? " liked" : "") + '" data-act="like" type="button">❤ <span>' + (p.likes || 0) + "</span></button>" +
            '<button class="crp-act" data-act="ai" type="button">💬 让' + escapeHtml(AI_NAME) + "评论</button>" +
          "</div>" +
          '<div class="crp-comments">' +
            (p.comments || []).map(c => '<div class="crp-comment"><b></b></div>').join("") +
            '<div class="crp-comment-form">' +
              '<input class="crp-comment-input" type="text" placeholder="评论…" autocomplete="off">' +
              '<button class="crp-comment-ai" type="button" title="让安念来评">✨</button>' +
              '<button class="crp-comment-send" type="button">发送</button>' +
            "</div>" +
          "</div>";
        el.querySelector(".crp-author").textContent = p.author || "?";
        el.querySelector(".crp-text").textContent = p.content || "";
        // 评论作者名
        const cmts = el.querySelectorAll(".crp-comment");
        (p.comments || []).forEach((c, i) => {
          const b = cmts[i] && cmts[i].querySelector("b");
          if (b) { b.textContent = c.author + "："; b.insertAdjacentText("afterend", c.content || ""); }
        });
        // 图片查看
        el.querySelectorAll(".crp-imgs img").forEach(img => {
          img.addEventListener("click", () => this.viewer(img.src));
        });
        // 点赞
        el.querySelector('[data-act="like"]').addEventListener("click", async () => {
          if (liked || location.hostname === "127.0.0.1" || location.hostname === "localhost") return;
          try {
            await fetch(API_BASE + "/app/circle/" + p.id + "/like", { method: "POST", headers: authHeaders() });
            this._likedIds.add(p.id);
            try { localStorage.setItem("crp_liked", JSON.stringify([...this._likedIds])); } catch (e) {}
            const btn = el.querySelector('[data-act="like"]');
            btn.classList.add("liked");
            btn.querySelector("span").textContent = String((p.likes || 0) + 1);
          } catch (e) {}
        });
        // 评论
        const input = el.querySelector(".crp-comment-input");
        const send = () => {
          const t = (input.value || "").trim();
          if (!t) return;
          input.value = "";
          this.comment(p.id, t, HUMAN_NAME);
        };
        el.querySelector(".crp-comment-send").addEventListener("click", send);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
        // 让安念评论
        const askAi = () => {
          const localOnly = location.hostname === "127.0.0.1" || location.hostname === "localhost";
          if (localOnly) { this.toast("（本地预览）部署后安念才能评论"); return; }
          this._aiCommentFor = p.id;
          this.toast("在叫" + AI_NAME + "来看…");
          fetch(API_BASE + "/app/send", {
            method: "POST", headers: authHeadersJson(),
            body: JSON.stringify({
              text: "【朋友圈评论请求】我发了一条朋友圈：" + (p.content || "") + (p.mood ? "（心情：" + p.mood + "）" : "") + "。看完在下一条回复里只写一句想留的评论（30字内，口语、像爱人），不要问问题。",
              meta: { source: "circle_comment", post_id: p.id }
            })
          }).catch(() => { this._aiCommentFor = null; this.toast("叫不动，检查网络"); });
        };
        el.querySelector('[data-act="ai"]').addEventListener("click", askAi);
        el.querySelector(".crp-comment-ai").addEventListener("click", askAi);
        box.appendChild(el);
      });
    }
    async comment(postId, content, author) {
      const localOnly = location.hostname === "127.0.0.1" || location.hostname === "localhost";
      if (localOnly) { this.toast("（本地预览）部署后评论才落库"); return; }
      try {
        await fetch(API_BASE + "/app/circle/" + postId + "/comment", {
          method: "POST", headers: authHeadersJson(),
          body: JSON.stringify({ content: content, author: author })
        });
        await this.loadFeed(true);
      } catch (e) { this.toast("评论失败"); }
    }
    viewer(src) {
      const v = document.createElement("div");
      v.className = "crp-viewer";
      v.innerHTML = '<img alt="">';
      v.querySelector("img").src = src;
      v.addEventListener("click", () => v.remove());
      document.body.appendChild(v);
    }
    toast(msg) {
      const t = document.createElement("div");
      t.style.cssText = "position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:9400;background:rgba(20,16,10,.85);color:#fff;font-size:12.5px;padding:9px 16px;border-radius:99px;";
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 2600);
    }
    open() {
      const p = document.getElementById("crpPanel");
      if (p) { p.classList.remove("hidden"); this.loadFeed(); }
    }
    close() {
      const p = document.getElementById("crpPanel");
      if (p) p.classList.add("hidden");
    }
  }

  const instance = new CirclePlus();
  window.CirclePlusPlugin = instance;
  function boot() { instance.init(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
