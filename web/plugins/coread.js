// ============================================================
// 共读间 · Coread plugin for 月光（InternalBeyond 同款）
// 一篇日志＝一本书，选一位 TA 读到哪聊到哪。
//   - TA 每句话只随附「你此刻这一页」的原文 + 前文梗概，读不到后面的页
//   - 只存读到哪、书签、设置，随本机备份；不另存书
// 数据源：blog 插件的 localStorage（moonlight_blog_posts），只读不改。
// 不改动现有功能 —— 独立插件，独立面板。
// ============================================================

(function () {
  "use strict";

  const PLUGIN_NAME = "Coread";
  const LS_STATE = "moonlight_coread_state_v1";   // {bookId:{page,marks[],opened}}
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

  class Coread {
    constructor() {
      this.state = {};          // bookId -> {page, marks:[], opened}
      this.book = null;         // {id,title,content}
      this.pages = [];          // 分页后的段落数组
      this.page = 0;
      this.marks = [];
    }

    loadState() {
      try { this.state = JSON.parse(localStorage.getItem(LS_STATE) || "{}") || {}; }
      catch (e) { this.state = {}; }
    }
    saveState() {
      try { localStorage.setItem(LS_STATE, JSON.stringify(this.state)); } catch (e) {}
    }

    async init() {
      try {
        if (typeof window.CONFIG !== "undefined") {
          API_BASE = window.CONFIG.API_BASE || API_BASE || "";
          AI_NAME = window.CONFIG.AI_NAME || AI_NAME;
          HUMAN_NAME = window.CONFIG.HUMAN_NAME || HUMAN_NAME;
        }
      } catch (e) {}
      this.loadState();
      this.buildUI();
      this.bindMenuEntry();
      // 听安念回复广播 → 共读频道里显示
      window.addEventListener("ml-ai-reply", (e) => {
        if (!this.book) return;
        const text = String((e.detail && e.detail.text) || "");
        if (text && e.detail && e.detail.meta && e.detail.meta.source === "coread") {
          this.appendMsg("ai", text);
        }
      });
      console.log("[" + PLUGIN_NAME + "] ready");
    }

    buildUI() {
      if (document.getElementById("crdPanel")) return;
      const wrap = document.createElement("div");
      wrap.id = "crdPanel";
      wrap.className = "crd-panel hidden";
      wrap.innerHTML = `
        <div class="crd-top">
          <button class="crd-back" id="crdBack" type="button" aria-label="返回">←</button>
          <div>
            <div class="crd-title">共读间</div>
            <div class="crd-sub">读到哪，聊到哪</div>
          </div>
          <button class="crd-topbtn" id="crdShelfBtn" type="button" style="display:none">换一本</button>
        </div>
        <div class="crd-shelf" id="crdShelf"></div>
        <div class="crd-reader" id="crdReader">
          <div class="crd-page" id="crdPage"></div>
          <div class="crd-page-foot">
            <button class="crd-pg-btn" id="crdPrev" type="button">‹ 上一页</button>
            <span class="crd-pg-num" id="crdPgNum">1 / 1</span>
            <button class="crd-pg-btn crd-bookmark" id="crdMark" type="button">🔖 书签</button>
            <button class="crd-pg-btn" id="crdNext" type="button">下一页 ›</button>
          </div>
          <div class="crd-chat">
            <div class="crd-chat-log" id="crdLog"></div>
            <div class="crd-input-row">
              <input id="crdInput" class="crd-input" type="text" placeholder="和TA聊这一页…" autocomplete="off">
              <button id="crdSend" class="crd-send" type="button" aria-label="发送">➤</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(wrap);

      document.getElementById("crdBack").addEventListener("click", () => {
        if (this.book) this.showShelf();
        else this.close();
      });
      document.getElementById("crdShelfBtn").addEventListener("click", () => this.showShelf());
      document.getElementById("crdPrev").addEventListener("click", () => this.flip(-1));
      document.getElementById("crdNext").addEventListener("click", () => this.flip(1));
      document.getElementById("crdMark").addEventListener("click", () => this.toggleMark());
      document.getElementById("crdSend").addEventListener("click", () => this.sendChat());
      document.getElementById("crdInput").addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); this.sendChat(); }
      });
    }

    bindMenuEntry() {
      const menu = document.querySelector(".menu-list");
      if (!menu) { setTimeout(() => this.bindMenuEntry(), 800); return; }
      if (menu.querySelector('[data-menu="coread"]')) return;
      const btn = document.createElement("button");
      btn.className = "menu-item";
      btn.type = "button";
      btn.dataset.menu = "coread";
      btn.innerHTML = `<span class="menu-ic">📖</span><span class="menu-copy"><span class="menu-name">共读间</span><span class="menu-sub">读到哪聊到哪</span></span><span class="menu-chev">›</span>`;
      const anchor = menu.querySelector('[data-menu="letters"]');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      else menu.appendChild(btn);
      btn.addEventListener("click", (e) => { e.stopPropagation(); this.open(); }, true);
    }

    /* ---------- 书架 ---------- */
    renderShelf() {
      const box = document.getElementById("crdShelf");
      if (!box) return;
      let posts = [];
      try { posts = JSON.parse(localStorage.getItem("moonlight_blog_posts") || "[]"); } catch (e) {}
      if (!Array.isArray(posts)) posts = [];
      if (!posts.length) {
        box.innerHTML = '<div class="crd-empty">书架还是空的。<br>先去「AI日志」写一篇，这里就能选它当一本书和' + escapeHtml(AI_NAME) + '共读。</div>';
        return;
      }
      box.innerHTML = "";
      posts.slice().reverse().forEach(p => {
        const st = this.state[p.id] || {};
        const total = this.paginate(String(p.content || "")).length || 1;
        const el = document.createElement("div");
        el.className = "crd-book";
        el.innerHTML =
          '<div class="crd-book-cover">📕</div>' +
          '<div class="crd-book-info">' +
            '<div class="crd-book-name"></div>' +
            '<div class="crd-book-meta">' + escapeHtml(p.category || "未分类") + " · 共 " + total + " 页" + ((st.marks || []).length ? " · 🔖" + st.marks.length : "") + "</div>" +
            (st.page ? '<div class="crd-book-prog">读到第 ' + (st.page + 1) + " 页，继续？</div>" : "") +
          "</div>";
        el.querySelector(".crd-book-name").textContent = p.title || "无题";
        el.addEventListener("click", () => this.openBook(p));
        box.appendChild(el);
      });
    }

    /* ---------- 分页 ---------- */
    paginate(content) {
      const paras = String(content || "").split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
      if (!paras.length) paras.push(content || "");
      const pages = [];
      let buf = "";
      const LIMIT = 700;   // 每页约 700 字
      for (const para of paras) {
        if (!buf.length) { buf = para; continue; }
        if (buf.length + para.length + 2 <= LIMIT) { buf += "\n\n" + para; }
        else { pages.push(buf); buf = para; }
      }
      if (buf.length) pages.push(buf);
      return pages;
    }

    openBook(p) {
      this.book = p;
      this.pages = this.paginate(String(p.content || ""));
      const st = this.state[p.id] || {};
      this.page = Math.min(st.page || 0, Math.max(0, this.pages.length - 1));
      this.marks = st.marks || [];
      document.getElementById("crdShelf").style.display = "none";
      document.getElementById("crdReader").classList.add("on");
      document.getElementById("crdShelfBtn").style.display = "";
      document.querySelector(".crd-title").textContent = "共读 · " + (p.title || "无题");
      document.getElementById("crdLog").innerHTML = "";
      this.renderPage();
      this.appendMsg("sys", "你和" + AI_NAME + "正在共读《" + (p.title || "无题") + "》· TA 只看得到你此刻这一页");
    }
    showShelf() {
      this.book = null;
      document.getElementById("crdShelf").style.display = "";
      document.getElementById("crdReader").classList.remove("on");
      document.getElementById("crdShelfBtn").style.display = "none";
      document.querySelector(".crd-title").textContent = "共读间";
      this.renderShelf();
    }
    renderPage() {
      const el = document.getElementById("crdPage");
      el.textContent = this.pages[this.page] || "";
      const head = document.createElement("div");
      head.className = "crd-page-head";
      head.textContent = "第 " + (this.page + 1) + " 页 · 共 " + this.pages.length + " 页";
      el.insertBefore(head, el.firstChild);
      el.scrollTop = 0;
      document.getElementById("crdPgNum").textContent = (this.page + 1) + " / " + this.pages.length;
      document.getElementById("crdPrev").disabled = this.page === 0;
      document.getElementById("crdNext").disabled = this.page >= this.pages.length - 1;
      document.getElementById("crdMark").classList.toggle("on", this.marks.indexOf(this.page) >= 0);
      // 记住进度
      const st = this.state[this.book.id] || {};
      st.page = this.page; st.marks = this.marks;
      this.state[this.book.id] = st;
      this.saveState();
    }
    flip(d) {
      const n = this.page + d;
      if (n < 0 || n >= this.pages.length) return;
      this.page = n;
      this.renderPage();
    }
    toggleMark() {
      const i = this.marks.indexOf(this.page);
      if (i >= 0) this.marks.splice(i, 1);
      else this.marks.push(this.page);
      this.renderPage();
    }

    /* ---------- 聊天（只带当前页+前文梗概）---------- */
    async sendChat() {
      const input = document.getElementById("crdInput");
      const text = (input.value || "").trim();
      if (!text || !this.book) return;
      input.value = "";
      this.appendMsg("human", text);

      const localOnly = location.hostname === "127.0.0.1" || location.hostname === "localhost";
      if (localOnly) {
        setTimeout(() => this.appendMsg("ai", "（本地预览）部署到服务器后，" + AI_NAME + "就能陪你读这一页了～"), 1000);
        return;
      }

      // 前文梗概：之前各页取每页开头 60 字
      const recap = this.pages.slice(0, this.page).map((pg, i) => "第" + (i + 1) + "页：" + pg.slice(0, 60).replace(/\s+/g, " ") + "…").join("\n");
      const pageText = this.pages[this.page] || "";
      const fullText =
        "【共读·" + (this.book.title || "无题") + "】我在读第 " + (this.page + 1) + " 页（共 " + this.pages.length + " 页），只聊这一页，别剧透后面的。\n" +
        (recap ? "===前文梗概===\n" + recap + "\n" : "") +
        "===此刻这一页===\n" + pageText.slice(0, 1200) + "\n" +
        "===我想说===\n" + text;
      try {
        await fetch(API_BASE + "/app/send", {
          method: "POST", headers: authHeadersJson(),
          body: JSON.stringify({ text: fullText, meta: { source: "coread", book: this.book.title, page: this.page + 1 } })
        });
        // 安念的回复经 ml-ai-reply 广播回来，落在共读频道里
      } catch (e) {
        this.appendMsg("sys", "发送失败，检查网络");
      }
    }
    appendMsg(who, text) {
      const log = document.getElementById("crdLog");
      if (!log) return;
      const div = document.createElement("div");
      div.className = "crd-msg crd-msg-" + who;
      if (who === "ai") { const b = document.createElement("b"); b.textContent = AI_NAME; div.appendChild(b); div.appendChild(document.createTextNode(text)); }
      else div.textContent = (who === "sys" ? "· " : "") + text;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }

    open() {
      const p = document.getElementById("crdPanel");
      if (p) { p.classList.remove("hidden"); this.renderShelf(); }
    }
    close() {
      const p = document.getElementById("crdPanel");
      if (p) p.classList.add("hidden");
    }
  }

  const instance = new Coread();
  window.CoreadPlugin = instance;
  function boot() { instance.init(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
