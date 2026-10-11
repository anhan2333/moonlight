// ============================================================
// Auto Memory · 安念对你的认知档案（InternalBeyond 同款）
//   - 六分类：工作/个人/当下所想/简史/长期背景/你的指令
//   - 三级优先：always（随人设进上下文·写入要你确认）/ normal / low
//   - 「让安念整理档案」：把现有档案+最近聊天交给模型，输出
//     add/update/delete 指令 → 确认卡逐条预览 → 点了才落库
// 数据只存本机（localStorage），与 IB「完全本地」同一哲学。
// 不改动现有记忆库/星图 —— 独立插件，独立面板。
// ============================================================

(function () {
  "use strict";

  const PLUGIN_NAME = "AutoMemory";
  const LS_KEY = "moonlight_automemory_v1";
  let API_BASE = "";
  let AI_NAME = "安念";

  const CATS = [
    { id: "all",                 label: "全部" },
    { id: "work_context",        label: "工作处境" },
    { id: "personal_context",    label: "个人生活" },
    { id: "top_of_mind",         label: "当下所想" },
    { id: "brief_history",       label: "近期经历" },
    { id: "long_term_background",label: "长期背景" },
    { id: "user_instructions",   label: "你的指令" }
  ];
  const PRS = [
    { id: "always", label: "核心" },
    { id: "normal", label: "日常" },
    { id: "low",    label: "随记" }
  ];

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
  function catLabel(id) {
    const c = CATS.find(x => x.id === id);
    return c ? c.label : id;
  }
  function prLabel(id) {
    const p = PRS.find(x => x.id === id);
    return p ? p.label : id;
  }

  class AutoMemory {
    constructor() {
      this.entries = [];       // {id, cat, pr, text, created_at, updated_at}
      this.filter = "all";
      this.editingId = null;
    }

    /* ---------- 存储 ---------- */
    load() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        this.entries = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(this.entries)) this.entries = [];
      } catch (e) { this.entries = []; }
    }
    save() {
      try { localStorage.setItem(LS_KEY, JSON.stringify(this.entries)); } catch (e) {}
    }
    uid() { return "am-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

    async init() {
      try {
        if (typeof window.CONFIG !== "undefined") {
          API_BASE = window.CONFIG.API_BASE || API_BASE || "";
          AI_NAME = window.CONFIG.AI_NAME || AI_NAME;
        }
      } catch (e) {}
      this.load();
      this.buildUI();
      this.bindMenuEntry();
      // 听全局 AI 回复广播：整理档案的指令卡随安念的回复带出
      window.addEventListener("ml-ai-reply", (e) => {
        if (e && e.detail) this.onAiReply(e.detail.text);
      });
      console.log("[" + PLUGIN_NAME + "] ready,", this.entries.length, "entries");
    }

    /* ---------- UI ---------- */
    buildUI() {
      if (document.getElementById("amPanel")) return;
      const wrap = document.createElement("div");
      wrap.id = "amPanel";
      wrap.className = "am-panel hidden";
      wrap.innerHTML = `
        <div class="am-top">
          <button class="am-back" id="amBack" type="button" aria-label="返回">←</button>
          <div>
            <div class="am-title">你对我的了解</div>
            <div class="am-sub">Auto Memory · ${escapeHtml(AI_NAME)}的认知档案</div>
          </div>
          <div class="am-top-actions">
            <button class="am-topbtn primary" id="amOrganizeBtn" type="button">✨ 让${escapeHtml(AI_NAME)}整理</button>
            <button class="am-topbtn" id="amAddBtn" type="button">＋</button>
          </div>
        </div>
        <div class="am-cats" id="amCats"></div>
        <div class="am-scroll" id="amList"></div>
      `;
      document.body.appendChild(wrap);

      document.getElementById("amBack").addEventListener("click", () => this.close());
      document.getElementById("amAddBtn").addEventListener("click", () => this.openEdit(null));
      document.getElementById("amOrganizeBtn").addEventListener("click", () => this.organize());
      this.renderCats();
      this.renderList();
    }

    bindMenuEntry() {
      const menu = document.querySelector(".menu-list");
      if (!menu) { setTimeout(() => this.bindMenuEntry(), 800); return; }
      if (menu.querySelector('[data-menu="automemory"]')) return;
      const btn = document.createElement("button");
      btn.className = "menu-item";
      btn.type = "button";
      btn.dataset.menu = "automemory";
      btn.innerHTML = `<span class="menu-ic">🗂</span><span class="menu-copy"><span class="menu-name">Auto Memory</span><span class="menu-sub">安念对你的认知档案</span></span><span class="menu-chev">›</span>`;
      const anchor = menu.querySelector('[data-menu="memsky"]');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      else menu.appendChild(btn);
      btn.addEventListener("click", (e) => { e.stopPropagation(); this.open(); }, true);
    }

    renderCats() {
      const box = document.getElementById("amCats");
      if (!box) return;
      box.innerHTML = CATS.map(c => {
        const n = c.id === "all" ? this.entries.length : this.entries.filter(e => e.cat === c.id).length;
        return `<button class="am-cat${this.filter === c.id ? " active" : ""}" data-cat="${c.id}" type="button">${c.label}<span class="n">${n}</span></button>`;
      }).join("");
      box.querySelectorAll("[data-cat]").forEach(b => {
        b.addEventListener("click", () => { this.filter = b.dataset.cat; this.renderCats(); this.renderList(); });
      });
    }
    renderList() {
      const box = document.getElementById("amList");
      if (!box) return;
      const list = this.entries
        .filter(e => this.filter === "all" || e.cat === this.filter)
        .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
      if (!list.length) {
        box.innerHTML = '<div class="am-empty">档案还是空的。<br>点右上 ＋ 手动写一条，或让' + escapeHtml(AI_NAME) + '自己整理。</div>';
        return;
      }
      box.innerHTML = "";
      list.forEach(e => {
        const div = document.createElement("div");
        div.className = "am-item " + (e.pr === "always" ? "always" : e.pr === "low" ? "low" : "");
        div.innerHTML =
          '<div class="am-item-head">' +
            '<span class="am-pr am-pr-' + e.pr + '">' + prLabel(e.pr) + "</span>" +
            '<span class="am-cat-tag">' + catLabel(e.cat) + "</span>" +
            '<span class="am-item-time">' + escapeHtml((e.updated_at || "").slice(0, 16).replace("T", " ")) + "</span>" +
          "</div>" +
          '<div class="am-item-text"></div>' +
          '<div class="am-item-acts">' +
            '<button class="am-item-act" data-act="edit" type="button">编辑</button>' +
            '<button class="am-item-act danger" data-act="del" type="button">删除</button>' +
          "</div>";
        div.querySelector(".am-item-text").textContent = e.text;
        div.querySelector('[data-act="edit"]').addEventListener("click", () => this.openEdit(e.id));
        div.querySelector('[data-act="del"]').addEventListener("click", () => {
          if (confirm("删除这条档案？")) {
            this.entries = this.entries.filter(x => x.id !== e.id);
            this.save(); this.renderCats(); this.renderList();
          }
        });
        box.appendChild(div);
      });
    }

    /* ---------- 手动编辑 ---------- */
    openEdit(id) {
      this.editingId = id;
      const old = id ? this.entries.find(e => e.id === id) : null;
      const mask = document.createElement("div");
      mask.className = "am-edit-mask";
      mask.id = "amEditMask";
      mask.innerHTML =
        '<div class="am-edit">' +
          "<h4>" + (id ? "编辑档案" : "写一条档案") + "</h4>" +
          '<textarea id="amEditText" placeholder="安念知道的关于你的事…"></textarea>' +
          '<div class="am-edit-row">' +
            '<select id="amEditCat">' + CATS.filter(c => c.id !== "all").map(c => '<option value="' + c.id + '"' + (old && old.cat === c.id ? " selected" : "") + ">" + c.label + "</option>").join("") + "</select>" +
            '<select id="amEditPr">' + PRS.map(p => '<option value="' + p.id + '"' + (old ? (old.pr === p.id ? " selected" : "") : (p.id === "normal" ? " selected" : "")) + ">" + p.label + "</option>").join("") + "</select>" +
          "</div>" +
          '<button class="am-edit-commit" id="amEditOk" type="button">保存</button>' +
          '<button class="am-edit-cancel" id="amEditNo" type="button">取消</button>' +
        "</div>";
      document.body.appendChild(mask);
      if (old) mask.querySelector("#amEditText").value = old.text;
      mask.addEventListener("click", (e) => { if (e.target === mask) mask.remove(); });
      mask.querySelector("#amEditNo").addEventListener("click", () => mask.remove());
      mask.querySelector("#amEditOk").addEventListener("click", () => {
        const text = mask.querySelector("#amEditText").value.trim();
        if (!text) return;
        const cat = mask.querySelector("#amEditCat").value;
        const pr = mask.querySelector("#amEditPr").value;
        const now = new Date().toISOString();
        if (this.editingId) {
          const e = this.entries.find(x => x.id === this.editingId);
          if (e) { e.text = text; e.cat = cat; e.pr = pr; e.updated_at = now; }
        } else {
          this.entries.push({ id: this.uid(), cat: cat, pr: pr, text: text, created_at: now, updated_at: now });
        }
        this.save(); mask.remove();
        this.renderCats(); this.renderList();
      });
    }

    /* ---------- AI 整理（IB 同款：指令 → 确认卡 → 落库）---------- */
    async organize() {
      const localOnly = location.hostname === "127.0.0.1" || location.hostname === "localhost";
      if (localOnly) { this.toast("（本地预览）部署后安念才能真正读聊天、整理档案"); return; }
      const busy = document.createElement("div");
      busy.className = "am-busy"; busy.id = "amBusy";
      busy.textContent = "安念正在读档案和最近的聊天…";
      const panel = document.getElementById("amPanel");
      panel.appendChild(busy);
      try {
        // 材料：现有档案 + 最近聊天
        const dossier = this.entries.map(e => "[" + e.id + "|分类:" + catLabel(e.cat) + "|优先:" + prLabel(e.pr) + "] " + e.text).join("\n") || "（空）";
        let recent = "";
        try {
          const r = await fetch(API_BASE + "/app/history?limit=60", { headers: authHeaders() });
          if (r.ok) {
            const d = await r.json();
            recent = (d.messages || []).slice(-60).map(m => (m.from === "human" ? "她" : AI_NAME) + "：" + String(m.text || "").slice(0, 300)).join("\n");
          }
        } catch (e) {}
        const sys = "你在维护一份关于用户的认知档案（Auto Memory）。根据现有档案和最近聊天，输出 JSON 指令数组，不要输出别的文字。每条指令形如：" +
          '{"op":"add","cat":"personal_context","pr":"normal","text":"…"} 或 {"op":"update","id":"am-xxx","text":"…","pr":"normal"} 或 {"op":"delete","id":"am-xxx"}。' +
          "cat ∈ work_context/personal_context/top_of_mind/brief_history/long_term_background/user_instructions；pr ∈ always/normal/low。" +
          "只提炼确定、持久、对你理解她有用的信息；琐碎寒暄不要写；already 有的用 update；过时的用 delete。至多 8 条。";
        const r2 = await fetch(API_BASE + "/app/send", {
          method: "POST", headers: authHeadersJson(),
          body: JSON.stringify({
            text: "【档案整理请求】请根据下面材料整理我的认知档案，只输出 JSON 指令数组。\n===现有档案===\n" + dossier + "\n===最近聊天===\n" + (recent || "（拉不到）"),
            meta: { source: "automemory_organize", system_hint: sys }
          })
        });
        busy.remove();
        if (!r2.ok) { this.toast("发送失败（" + r2.status + "）"); return; }
        this.toast("整理请求已发给" + AI_NAME + "，等 TA 下一条回复带出整理卡");
        // 等 AI 回复（全局广播 ml-ai-reply），在面板里解析指令
        this._awaitOrganize = true;
      } catch (e) {
        busy.remove();
        this.toast("出错：" + (e.message || e));
      }
    }
    /* 收到 AI 回复时尝试解析整理指令（index.html 广播调用）*/
    onAiReply(text) {
      if (!this._awaitOrganize || !text) return;
      const m = String(text).match(/\[[\s\S]*\]/);
      if (!m) return;
      let ops;
      try { ops = JSON.parse(m[0]); } catch (e) { return; }
      if (!Array.isArray(ops) || !ops.length) return;
      this._awaitOrganize = false;
      this.showConfirm(ops);
    }
    showConfirm(ops) {
      const old = document.getElementById("amConfirmMask");
      if (old) old.remove();
      const mask = document.createElement("div");
      mask.className = "am-confirm-mask";
      mask.id = "amConfirmMask";
      const rows = ops.map((o, i) => {
        let op = o.op || "add", cls = "op-" + op, label = { add: "新增", update: "更新", delete: "删除" }[op] || op;
        if (op === "add" && o.pr === "always") { label = "写入核心"; cls = "op-always"; }
        let body = "";
        if (op === "delete") body = "删除 [" + (o.id || "?") + "]";
        else body = (o.id ? "[" + o.id + "] → " : "") + (o.text || "");
        const meta = op === "delete" ? "" : "（" + catLabel(o.cat || "personal_context") + " · " + prLabel(o.pr || "normal") + "）";
        return '<div class="am-confirm-item"><span class="op ' + cls + '">' + label + "</span>" + escapeHtml(body) + ' <span style="opacity:.5;font-size:11px;">' + meta + "</span></div>";
      }).join("");
      mask.innerHTML =
        '<div class="am-confirm">' +
          "<h4>🗂 " + escapeHtml(AI_NAME) + "想这样更新档案</h4>" +
          rows +
          '<div class="am-confirm-row">' +
            '<button class="am-confirm-ok" id="amConfOk" type="button">全部执行</button>' +
            '<button class="am-confirm-no" id="amConfNo" type="button">先不改</button>' +
          "</div>" +
        "</div>";
      document.body.appendChild(mask);
      mask.querySelector("#amConfNo").addEventListener("click", () => mask.remove());
      mask.querySelector("#amConfOk").addEventListener("click", () => {
        ops.forEach(o => {
          const now = new Date().toISOString();
          if (o.op === "delete" && o.id) {
            this.entries = this.entries.filter(x => x.id !== o.id);
          } else if (o.op === "update" && o.id) {
            const e = this.entries.find(x => x.id === o.id);
            if (e) { if (o.text) e.text = o.text; if (o.pr) e.pr = o.pr; if (o.cat) e.cat = o.cat; e.updated_at = now; }
          } else if (o.op === "add" && o.text) {
            // always 级写入：确认卡本身就是确认（IB 同款语义）
            this.entries.push({ id: this.uid(), cat: o.cat || "personal_context", pr: o.pr || "normal", text: o.text, created_at: now, updated_at: now });
          }
        });
        this.save(); mask.remove();
        this.renderCats(); this.renderList();
        this.toast("档案已更新");
      });
    }
    toast(msg) {
      const t = document.createElement("div");
      t.style.cssText = "position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:9400;background:rgba(20,16,10,.85);color:#fff;font-size:12.5px;padding:9px 16px;border-radius:99px;";
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 2600);
    }

    open() {
      const p = document.getElementById("amPanel");
      if (p) { p.classList.remove("hidden"); this.renderCats(); this.renderList(); }
    }
    close() {
      const p = document.getElementById("amPanel");
      if (p) p.classList.add("hidden");
    }
  }

  const instance = new AutoMemory();
  window.AutoMemoryPlugin = instance;
  function boot() { instance.init(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
