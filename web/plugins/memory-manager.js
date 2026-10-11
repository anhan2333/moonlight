// ============================================================
// 记忆管家 · Memory Manager for 月光（AionsHome 同款管线前端）
//   概览 / 语义召回测试 / 手动总结 / 记忆审核台（确认才落库）/ 配置
// 后端端点：/app/mem/config · test_embed · recall · add · digest · review · review/apply
// 不改动现有星图 —— 独立插件，独立面板。
// ============================================================

(function () {
  "use strict";

  const PLUGIN_NAME = "MemoryManager";
  let API_BASE = "";
  let AI_NAME = "安念";

  function authHeaders() {
    const secret = localStorage.getItem("companion_secret") || "";
    return { "Authorization": "Bearer " + secret };
  }
  function authJson() { return Object.assign({}, authHeaders(), { "Content-Type": "application/json" }); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  async function api(path, opts) {
    const r = await fetch(API_BASE + path, opts);
    if (r.status === 401) { try { if (typeof handle401 === "function") handle401(); } catch (e) {} throw new Error("401"); }
    if (!r.ok) {
      let msg = "HTTP " + r.status;
      try { const d = await r.json(); msg = d.detail || d.error || msg; } catch (e) {}
      throw new Error(msg);
    }
    return r.json();
  }

  class MemoryManager {
    constructor() {
      this.tab = "overview";
      this.cfg = null;
      this.reviewItems = [];
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
      if (document.getElementById("mmPanel")) return;
      const wrap = document.createElement("div");
      wrap.id = "mmPanel";
      wrap.className = "mm-panel hidden";
      wrap.innerHTML = `
        <div class="mm-top">
          <button class="mm-back" id="mmBack" type="button" aria-label="返回">←</button>
          <div>
            <div class="mm-title">记忆管家</div>
            <div class="mm-sub">${esc(AI_NAME)}的长期记忆 · 向量召回 · 自动总结 · 审核台</div>
          </div>
        </div>
        <div class="mm-tabs" id="mmTabs">
          <button class="mm-tab active" data-tab="overview" type="button">概览</button>
          <button class="mm-tab" data-tab="recall" type="button">召回测试</button>
          <button class="mm-tab" data-tab="digest" type="button">总结</button>
          <button class="mm-tab" data-tab="review" type="button">审核台</button>
          <button class="mm-tab" data-tab="config" type="button">配置</button>
        </div>
        <div class="mm-body">
          <div class="mm-page on" id="mmPage-overview"></div>
          <div class="mm-page" id="mmPage-recall"></div>
          <div class="mm-page" id="mmPage-digest"></div>
          <div class="mm-page" id="mmPage-review"></div>
          <div class="mm-page" id="mmPage-config"></div>
        </div>
      `;
      document.body.appendChild(wrap);
      document.getElementById("mmBack").addEventListener("click", () => this.close());
      document.getElementById("mmTabs").addEventListener("click", (e) => {
        const b = e.target.closest(".mm-tab"); if (!b) return;
        this.switchTab(b.dataset.tab);
      });
      this.renderRecallPage();
      this.renderDigestPage();
      this.renderConfigPage();
    }

    bindMenuEntry() {
      const menu = document.querySelector(".menu-list");
      if (!menu) { setTimeout(() => this.bindMenuEntry(), 800); return; }
      if (menu.querySelector('[data-menu="memman"]')) return;
      const btn = document.createElement("button");
      btn.className = "menu-item";
      btn.type = "button";
      btn.dataset.menu = "memman";
      btn.innerHTML = `<span class="menu-ic">🧠</span><span class="menu-copy"><span class="menu-name">记忆管家</span><span class="menu-sub">向量召回 · 总结 · 审核台</span></span><span class="menu-chev">›</span>`;
      const anchor = menu.querySelector('[data-menu="memsky"]');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      else menu.appendChild(btn);
      btn.addEventListener("click", (e) => { e.stopPropagation(); this.open(); }, true);
    }

    switchTab(tab) {
      this.tab = tab;
      document.querySelectorAll("#mmTabs .mm-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
      document.querySelectorAll(".mm-page").forEach(p => p.classList.toggle("on", p.id === "mmPage-" + tab));
      if (tab === "overview") this.loadOverview();
      if (tab === "config") this.renderConfigPage();
    }

    async open() {
      document.getElementById("mmPanel").classList.remove("hidden");
      this.switchTab(this.tab || "overview");
      this.loadOverview();
    }
    close() { document.getElementById("mmPanel").classList.add("hidden"); }

    /* ── 概览 ── */
    async loadOverview() {
      const el = document.getElementById("mmPage-overview");
      el.innerHTML = '<div class="mm-busy">读取记忆库状态…</div>';
      try {
        this.cfg = await api("/app/mem/config", { headers: authHeaders() });
      } catch (e) {
        el.innerHTML = '<div class="mm-empty">读不到记忆库（' + esc(e.message) + '）<br>需在部署了后端的服务器上打开。</div>';
        return;
      }
      const s = this.cfg.stats || {};
      const embedOk = this.cfg.embed_key_set, sentOk = this.cfg.sentinel_key_set;
      el.innerHTML = `
        <div class="mm-stat-grid">
          <div class="mm-stat"><b>${s.total || 0}</b><span>记忆总数</span></div>
          <div class="mm-stat"><b>${s.embedded || 0}</b><span>已向量化</span></div>
          <div class="mm-stat"><b>${s.unresolved || 0}</b><span>📌 待办记忆</span></div>
          <div class="mm-stat"><b>${s.anchor || 0}</b><span>总结锚点</span></div>
        </div>
        <div class="mm-card">
          <h4>系统状态</h4>
          <div class="mm-kv"><span class="k">向量模型（语义召回）</span><span class="v"><span class="mm-dot ${embedOk ? "ok" : "no"}"></span>${embedOk ? esc(this.cfg.embed_model) : "未配置（降级为关键词）"}</span></div>
          <div class="mm-kv"><span class="k">哨兵/总结模型</span><span class="v"><span class="mm-dot ${sentOk ? "ok" : "no"}"></span>${sentOk ? esc(this.cfg.sentinel_model) : "未配置"}</span></div>
        </div>
        <div class="mm-card">
          <h4>快速操作</h4>
          <div class="mm-btn-row">
            <button class="mm-btn primary" id="mmQuickBackfill" type="button">补全历史向量</button>
            <button class="mm-btn" id="mmQuickDigest" type="button">立即总结新记忆</button>
            <button class="mm-btn" id="mmQuickReview" type="button">打开审核台</button>
          </div>
          <div class="mm-hint" id="mmOverviewMsg" style="margin-top:10px;"></div>
        </div>
      `;
      el.querySelector("#mmQuickBackfill").addEventListener("click", async (e) => {
        e.target.disabled = true; el.querySelector("#mmOverviewMsg").textContent = "正在给历史记忆补向量…";
        try { const r = await api("/app/mem/touch_all_embed", { method: "POST", headers: authJson(), body: "{}" }); el.querySelector("#mmOverviewMsg").textContent = `补了 ${r.embedded}/${r.total} 条`; this.loadOverview(); }
        catch (err) { el.querySelector("#mmOverviewMsg").textContent = "失败：" + err.message; e.target.disabled = false; }
      });
      el.querySelector("#mmQuickDigest").addEventListener("click", () => this.switchTab("digest"));
      el.querySelector("#mmQuickReview").addEventListener("click", () => this.switchTab("review"));
    }

    /* ── 召回测试 ── */
    renderRecallPage() {
      const el = document.getElementById("mmPage-recall");
      el.innerHTML = `
        <div class="mm-hint">输入一句话，看记忆系统会召回哪些相关记忆（综合评分 = 向量×0.6 + 关键词×0.3 + 重要度×0.1，门槛 0.45）。</div>
        <div class="mm-field"><input class="mm-input" id="mmRecallQ" type="text" placeholder="比如：我跟你说过我喜欢什么？"></div>
        <button class="mm-btn primary" id="mmRecallGo" type="button">召回</button>
        <div id="mmRecallOut" style="margin-top:14px;"></div>
      `;
      const go = () => {
        const q = document.getElementById("mmRecallQ").value.trim();
        const out = document.getElementById("mmRecallOut");
        if (!q) { out.innerHTML = ""; return; }
        out.innerHTML = '<div class="mm-busy">召回中…</div>';
        api("/app/mem/recall", { method: "POST", headers: authJson(), body: JSON.stringify({ query: q }) })
          .then(d => {
            if (!d.results || !d.results.length) { out.innerHTML = '<div class="mm-empty">没有达到门槛的记忆。</div>'; return; }
            out.innerHTML = d.results.map(r => this.memItemHtml(r)).join("");
          })
          .catch(e => { out.innerHTML = '<div class="mm-warn">失败：' + esc(e.message) + "</div>"; });
      };
      document.getElementById("mmRecallGo").addEventListener("click", go);
      document.getElementById("mmRecallQ").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    }
    memItemHtml(r) {
      const kws = Array.isArray(r.keywords) ? r.keywords.join("、") : (r.keywords || "");
      return `<div class="mm-item">
        <div class="mm-item-head">
          <span class="mm-score">${(r.score != null ? r.score : "")}</span>
          ${r.unresolved ? '<span class="mm-pin">📌待办</span>' : ""}
          <span class="mm-type">${esc(r.mem_type || "event")}</span>
        </div>
        <div class="mm-item-body">${esc(r.content)}</div>
        ${kws ? '<div class="mm-item-kw">关键词：' + esc(kws) + "</div>" : ""}
      </div>`;
    }

    /* ── 总结 ── */
    renderDigestPage() {
      const el = document.getElementById("mmPage-digest");
      el.innerHTML = `
        <div class="mm-hint">把锚点之后的聊天交给模型提炼成长期记忆（自动去重锚点，不会重复总结）。也可以「只出草案」先看看再决定入库。</div>
        <div class="mm-btn-row">
          <button class="mm-btn primary" id="mmDigestRun" type="button">立即总结并入库</button>
          <button class="mm-btn" id="mmDigestDraft" type="button">只出草案</button>
          <button class="mm-btn" id="mmDigestAll" type="button">总结全部历史</button>
        </div>
        <div id="mmDigestOut" style="margin-top:14px;"></div>
      `;
      const run = (mode) => {
        const out = document.getElementById("mmDigestOut");
        out.innerHTML = '<div class="mm-busy">模型提炼中，可能要十几秒…</div>';
        const body = mode === "all" ? { all: true } : (mode === "draft" ? { draft: true } : {});
        api("/app/mem/digest", { method: "POST", headers: authJson(), body: JSON.stringify(body) })
          .then(d => {
            if (d.error) { out.innerHTML = '<div class="mm-warn">' + esc(d.error) + "</div>"; return; }
            if (!d.added || !d.added.length) { out.innerHTML = '<div class="mm-empty">没有新记忆（待处理 ' + (d.pending || 0) + " 条消息，模型认为都不值得记，或消息太少）。</div>"; return; }
            if (d.draft) {
              out.innerHTML = '<div class="mm-hint">草案（未入库）：</div>' + d.added.map(a => '<div class="mm-item"><div class="mm-item-body">' + esc(a.content || JSON.stringify(a)) + "</div></div>").join("");
            } else {
              out.innerHTML = '<div class="mm-hint">已入库 ' + d.added.length + " 条：</div>" + d.added.map(a => '<div class="mm-item"><div class="mm-item-body">' + esc(a.content) + (a.embedded ? ' <span class="mm-type">已向量化</span>' : ' <span class="mm-type">未向量化</span>') + "</div></div>").join("");
            }
          })
          .catch(e => { out.innerHTML = '<div class="mm-warn">失败：' + esc(e.message) + "</div>"; });
      };
      document.getElementById("mmDigestRun").addEventListener("click", () => run("run"));
      document.getElementById("mmDigestDraft").addEventListener("click", () => run("draft"));
      document.getElementById("mmDigestAll").addEventListener("click", () => run("all"));
    }

    /* ── 审核台 ── */
    async loadReview() {
      const el = document.getElementById("mmPage-review");
      el.innerHTML = '<div class="mm-hint">让模型对现有记忆出 keep/edit/delete 草案。<b>它只是建议，你逐条确认后才会真正改库。</b></div><div class="mm-busy">生成草案中（记忆多时可能要几十秒）…</div>';
      try {
        const d = await api("/app/mem/review", { headers: authHeaders() });
        this.reviewItems = d.items || [];
        this.renderReviewList();
      } catch (e) {
        el.innerHTML = '<div class="mm-warn">草案生成失败：' + esc(e.message) + "</div>";
      }
    }
    renderReviewList() {
      const el = document.getElementById("mmPage-review");
      if (!this.reviewItems.length) {
        el.innerHTML = '<div class="mm-hint">让模型对现有记忆出 keep/edit/delete 草案，你确认后才会改库。</div><div class="mm-empty">记忆库是空的，或还没生成草案。</div><div class="mm-btn-row"><button class="mm-btn primary" id="mmReviewGen" type="button">生成草案</button></div>';
        el.querySelector("#mmReviewGen").addEventListener("click", () => this.loadReview());
        return;
      }
      const counts = { keep: 0, edit: 0, delete: 0 };
      this.reviewItems.forEach(i => { counts[i.final_action] = (counts[i.final_action] || 0) + 1; });
      el.innerHTML = `
        <div class="mm-hint">共 ${this.reviewItems.length} 条 · keep ${counts.keep} / edit ${counts.edit} / delete ${counts.delete}。改每条的动作或编辑内容，最后点「应用确认的改动」。</div>
        <div id="mmReviewList"></div>
        <div class="mm-btn-row">
          <button class="mm-btn primary" id="mmReviewApply" type="button">应用确认的改动</button>
          <button class="mm-btn" id="mmReviewRegen" type="button">重新生成草案</button>
        </div>
      `;
      const list = el.querySelector("#mmReviewList");
      this.reviewItems.forEach((it, idx) => {
        const row = document.createElement("div");
        row.className = "mm-review-item act-" + it.final_action;
        row.innerHTML = `
          <div class="mm-review-head">
            <span class="mm-review-seq">${it.seq}</span>
            <span class="mm-review-action">${it.final_action === "keep" ? "保留" : it.final_action === "edit" ? "精简" : "删除"}</span>
            <div class="mm-review-seg">
              <button data-a="keep" class="${it.final_action === "keep" ? "on" : ""}" type="button">保留</button>
              <button data-a="edit" class="${it.final_action === "edit" ? "on" : ""}" type="button">精简</button>
              <button data-a="delete" class="${it.final_action === "delete" ? "on" : ""}" type="button">删除</button>
            </div>
          </div>
          ${it.final_action === "delete" ? '<div class="mm-review-orig">' + esc(it.original_content) + "</div>" : ""}
          <div class="mm-review-new" data-view>${esc(it.final_action === "edit" ? (it.final_content || it.suggested_content) : it.original_content)}</div>
          <input class="mm-review-edit hidden" type="text" value="${esc(it.final_action === "edit" ? (it.final_content || it.suggested_content) : it.original_content)}">
          ${it.reason ? '<div class="mm-review-reason">理由：' + esc(it.reason) + "</div>" : ""}
        `;
        row.querySelectorAll(".mm-review-seg button").forEach(b => {
          b.addEventListener("click", () => {
            const a = b.dataset.a;
            it.final_action = a;
            if (a === "edit" && !it.final_content) it.final_content = it.suggested_content || it.original_content;
            if (a !== "edit") it.final_content = it.original_content;
            row.className = "mm-review-item act-" + a;
            row.querySelectorAll(".mm-review-seg button").forEach(x => x.classList.toggle("on", x.dataset.a === a));
            row.querySelector(".mm-review-action").textContent = a === "keep" ? "保留" : a === "edit" ? "精简" : "删除";
            const editInput = row.querySelector(".mm-review-edit");
            const view = row.querySelector("[data-view]");
            if (a === "edit") { editInput.classList.remove("hidden"); view.classList.add("hidden"); }
            else { editInput.classList.add("hidden"); view.classList.remove("hidden"); view.textContent = a === "delete" ? "" : it.original_content; }
            const orig = row.querySelector(".mm-review-orig"); if (orig) orig.style.display = a === "delete" ? "" : "none";
          });
        });
        const editInput = row.querySelector(".mm-review-edit");
        editInput.addEventListener("input", () => { it.final_content = editInput.value; });
        list.appendChild(row);
      });
      el.querySelector("#mmReviewApply").addEventListener("click", () => this.applyReview());
      el.querySelector("#mmReviewRegen").addEventListener("click", () => this.loadReview());
    }
    async applyReview() {
      const changed = this.reviewItems.filter(i => i.final_action !== "keep" || i.final_content !== i.original_content);
      if (!changed.length) { this.toast("没有需要应用的改动"); return; }
      if (!confirm(`确认应用 ${changed.length} 条改动？删除/精简会真的改库。`)) return;
      const el = document.getElementById("mmPage-review");
      try {
        const d = await api("/app/mem/review/apply", {
          method: "POST", headers: authJson(),
          body: JSON.stringify({ decisions: changed.map(i => ({ mem_id: i.mem_id, final_action: i.final_action, final_content: i.final_content })) })
        });
        el.innerHTML = '<div class="mm-hint">已应用：编辑 ' + d.edited + " · 删除 " + d.deleted + " · 跳过 " + d.skipped + "</div>";
        this.reviewItems = [];
        setTimeout(() => this.renderReviewList(), 1200);
      } catch (e) { this.toast("应用失败：" + e.message); }
    }

    /* ── 配置 ── */
    renderConfigPage() {
      const el = document.getElementById("mmPage-config");
      const c = this.cfg || {};
      el.innerHTML = `
        <div class="mm-warn">这里配置的是记忆系统专用的向量/哨兵模型（与聊天模型分开）。留空表示不改该项。密钥只存服务器本机。</div>
        <div class="mm-card">
          <h4>向量模型（语义召回）</h4>
          <div class="mm-field"><label>端点（OpenAI 兼容，如 https://api.siliconflow.cn/v1）</label><input class="mm-input" id="mmCfgEmbedEp" type="text" placeholder="${esc(c.embed_endpoint || "https://api.siliconflow.cn/v1")}"></div>
          <div class="mm-field"><label>模型（如 BAAI/bge-m3）</label><input class="mm-input" id="mmCfgEmbedModel" type="text" placeholder="${esc(c.embed_model || "BAAI/bge-m3")}"></div>
          <div class="mm-field"><label>密钥（当前：${esc(c.embed_key_masked || "未设置")}）</label><input class="mm-input" id="mmCfgEmbedKey" type="password" placeholder="sk-…（留空不改）"></div>
        </div>
        <div class="mm-card">
          <h4>哨兵/总结模型（判断是否检索 + 提炼记忆）</h4>
          <div class="mm-field"><label>端点</label><input class="mm-input" id="mmCfgSentEp" type="text" placeholder="${esc(c.sentinel_endpoint || "")}"></div>
          <div class="mm-field"><label>模型（如 Qwen/Qwen2.5-7B-Instruct）</label><input class="mm-input" id="mmCfgSentModel" type="text" placeholder="${esc(c.sentinel_model || "Qwen/Qwen2.5-7B-Instruct")}"></div>
          <div class="mm-field"><label>密钥（当前：${esc(c.sentinel_key_masked || "未设置")}）</label><input class="mm-input" id="mmCfgSentKey" type="password" placeholder="留空则复用向量密钥"></div>
        </div>
        <div class="mm-btn-row">
          <button class="mm-btn primary" id="mmCfgSave" type="button">保存配置</button>
          <button class="mm-btn" id="mmCfgTest" type="button">测试向量连通</button>
        </div>
        <div id="mmCfgOut" style="margin-top:12px;"></div>
      `;
      el.querySelector("#mmCfgSave").addEventListener("click", async () => {
        const g = id => (document.getElementById(id).value || "").trim();
        const body = {};
        const ep = g("mmCfgEmbedEp"); if (ep) body.embed_endpoint = ep;
        const em = g("mmCfgEmbedModel"); if (em) body.embed_model = em;
        const ek = g("mmCfgEmbedKey"); if (ek) body.embed_key = ek;
        const se = g("mmCfgSentEp"); if (se) body.sentinel_endpoint = se;
        const sm = g("mmCfgSentModel"); if (sm) body.sentinel_model = sm;
        const sk = g("mmCfgSentKey"); if (sk) body.sentinel_key = sk;
        try { await api("/app/mem/config", { method: "POST", headers: authJson(), body: JSON.stringify(body) }); this.toast("已保存"); this.loadOverview(); }
        catch (e) { this.toast("保存失败：" + e.message); }
      });
      el.querySelector("#mmCfgTest").addEventListener("click", async () => {
        const out = el.querySelector("#mmCfgOut"); out.textContent = "测试中…";
        try { const r = await api("/app/mem/test_embed", { method: "POST", headers: authJson(), body: "{}" }); out.textContent = `✓ ${r.model} 可用，维度 ${r.dim}`; }
        catch (e) { out.textContent = "✗ " + e.message; }
      });
    }

    toast(msg) {
      const t = document.createElement("div");
      t.style.cssText = "position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:9400;background:rgba(20,16,10,.85);color:#fff;font-size:12.5px;padding:9px 16px;border-radius:99px;";
      t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
    }
  }

  const instance = new MemoryManager();
  window.MemoryManagerPlugin = instance;
  function boot() { instance.init(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
