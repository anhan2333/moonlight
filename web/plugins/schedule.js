// ============================================================
// 闹铃日程 · Schedule plugin for 月光（InternalBeyond/AionsHome 同款）
//   - 到点安念主动开口提醒（后端扫描循环触发，走现有大脑链路）
//   - 安念聊天里 [SCHEDULE:时间|内容] 自动建日程（后端解析）
//   - 位置共享：浏览器定位推给后端 → 安念知道你在哪/离家的距离
// 不改动现有日历（纪念日）—— 独立插件，独立面板。
// ============================================================

(function () {
  "use strict";

  const PLUGIN_NAME = "Schedule";
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
    if (!r.ok) {
      let msg = "HTTP " + r.status;
      try { const d = await r.json(); msg = d.detail || msg; } catch (e) {}
      throw new Error(msg);
    }
    return r.json();
  }
  function localInputValue(dtm) {
    // datetime-local 用本地时区格式
    const d = new Date(dtm);
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  class Schedule {
    constructor() { this.items = []; this.locCfg = null; this._poll = null; }

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
      if (document.getElementById("scPanel")) return;
      const wrap = document.createElement("div");
      wrap.id = "scPanel";
      wrap.className = "sc-panel hidden";
      wrap.innerHTML = `
        <div class="sc-top">
          <button class="sc-back" id="scBack" type="button" aria-label="返回">←</button>
          <div>
            <div class="sc-title">闹铃</div>
            <div class="sc-sub">到点${esc(AI_NAME)}主动提醒你 · 聊天里说一声也行</div>
          </div>
          <button class="sc-topbtn" id="scAddBtn" type="button">＋ 新闹铃</button>
        </div>
        <div class="sc-body">
          <div id="scList"><div class="sc-empty">加载中…</div></div>
          <div class="sc-loc">
            <div class="sc-loc-head">📍 位置共享</div>
            <div class="sc-loc-row">
              <div><div class="lab">让${esc(AI_NAME)}知道你在哪</div><div class="val" id="scLocState">—</div></div>
              <label class="sc-switch"><input type="checkbox" id="scLocToggle"><span></span></label>
            </div>
            <div class="sc-loc-btns">
              <button class="sc-loc-btn" id="scLocNow" type="button">📡 现在定位一次</button>
              <button class="sc-loc-btn" id="scLocHome" type="button">🏠 把当前位置设为家</button>
            </div>
            <div class="sc-loc-row" style="margin-top:10px;">
              <div><div class="lab">高德 Web 服务 Key（逆地理用）</div><div class="val" id="scAmapState">—</div></div>
            </div>
            <div class="sc-new-row">
              <input id="scAmapKey" type="text" placeholder="sk/高德key，留空不改" style="width:100%;box-sizing:border-box;background:var(--field-bg,#faf8f4);color:inherit;border:1px solid rgba(140,120,90,.22);border-radius:10px;padding:8px 10px;font-size:12px;outline:none;">
              <button class="sc-loc-btn" id="scAmapSave" type="button" style="flex:0 0 auto;padding:8px 14px;">保存</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(wrap);
      document.getElementById("scBack").addEventListener("click", () => this.close());
      document.getElementById("scAddBtn").addEventListener("click", () => this.openNew());
      document.getElementById("scLocToggle").addEventListener("change", (e) => this.setShare(e.target.checked));
      document.getElementById("scLocNow").addEventListener("click", () => this.pushLocation(true));
      document.getElementById("scLocHome").addEventListener("click", () => this.setHome());
      document.getElementById("scAmapSave").addEventListener("click", () => this.saveAmapKey());
    }

    bindMenuEntry() {
      const menu = document.querySelector(".menu-list");
      if (!menu) { setTimeout(() => this.bindMenuEntry(), 800); return; }
      if (menu.querySelector('[data-menu="schedule"]')) return;
      const btn = document.createElement("button");
      btn.className = "menu-item";
      btn.type = "button";
      btn.dataset.menu = "schedule";
      btn.innerHTML = `<span class="menu-ic">⏰</span><span class="menu-copy"><span class="menu-name">闹铃</span><span class="menu-sub">到点${esc(AI_NAME)}主动提醒你</span></span><span class="menu-chev">›</span>`;
      const anchor = menu.querySelector('[data-menu="calendar"]');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      else menu.appendChild(btn);
      btn.addEventListener("click", (e) => { e.stopPropagation(); this.open(); }, true);
    }

    async open() {
      document.getElementById("scPanel").classList.remove("hidden");
      await this.loadList();
      await this.loadLocConfig();
      if (!this._poll) this._poll = setInterval(() => {
        const p = document.getElementById("scPanel");
        if (p && !p.classList.contains("hidden")) this.loadList();
      }, 30000);
    }
    close() { document.getElementById("scPanel").classList.add("hidden"); }

    async loadList() {
      const box = document.getElementById("scList");
      if (!box) return;
      const localOnly = (typeof USE_MOCK !== "undefined" && USE_MOCK);
      if (localOnly) { box.innerHTML = '<div class="sc-empty">（本地预览）闹铃存在服务器上，部署后这里就是你的日程。<br>聊天里对安念说「明早八点提醒我吃药」她就会记下来。</div>'; return; }
      try {
        const d = await api("/app/schedule/list", { headers: authHeaders() });
        this.items = d.schedules || [];
        this.renderList();
      } catch (e) {
        box.innerHTML = '<div class="sc-empty">加载失败：' + esc(e.message) + "</div>";
      }
    }
    renderList() {
      const box = document.getElementById("scList");
      const now = new Date();
      const active = this.items.filter(i => !i.fired && new Date((i.time || "").replace(" ", "T")) >= now);
      const past = this.items.filter(i => i.fired || new Date((i.time || "").replace(" ", "T")) < now);
      if (!this.items.length) {
        box.innerHTML = '<div class="sc-empty">还没有闹铃。<br>点右上「＋」，或直接在聊天里说「明天下午三点提醒我取快递」。</div>';
        return;
      }
      box.innerHTML = "";
      const mk = (it) => {
        const el = document.createElement("div");
        el.className = "sc-item" + (it.fired ? " fired" : "");
        el.innerHTML =
          '<div class="sc-item-main">' +
            '<div class="sc-item-time"></div>' +
            '<div class="sc-item-content"></div>' +
            (it.repeat && it.repeat !== "once" ? '<div class="sc-item-repeat">' + (it.repeat === "daily" ? "每天重复" : "每周重复") + "</div>" : "") +
          "</div>" +
          '<div class="sc-item-acts">' +
            (it.fired ? "" : '<button class="sc-mini" data-act="fire" type="button">试触发</button>') +
            '<button class="sc-mini danger" data-act="del" type="button">删</button>' +
          "</div>";
        el.querySelector(".sc-item-time").textContent = (it.time || "").slice(5).replace("T", " ");
        el.querySelector(".sc-item-content").textContent = it.content || "";
        el.querySelector('[data-act="del"]').addEventListener("click", async () => {
          if (!confirm("删除这个闹铃？")) return;
          try { await api("/app/schedule/" + it.id, { method: "DELETE", headers: authHeaders() }); this.loadList(); } catch (e) { this.toast("删除失败"); }
        });
        const fb = el.querySelector('[data-act="fire"]');
        if (fb) fb.addEventListener("click", async () => {
          try { await api("/app/schedule/test_fire", { method: "POST", headers: authJson(), body: JSON.stringify({ id: it.id }) }); this.toast("已让" + AI_NAME + "开口"); } catch (e) { this.toast("触发失败"); }
        });
        return el;
      };
      if (active.length) {
        const t = document.createElement("div"); t.className = "sc-item-repeat"; t.textContent = "将 来"; box.appendChild(t);
        active.forEach(i => box.appendChild(mk(i)));
      }
      if (past.length) {
        const t2 = document.createElement("div"); t2.className = "sc-item-repeat"; t2.style.marginTop = "14px"; t2.textContent = "已提醒"; box.appendChild(t2);
        past.slice(-10).reverse().forEach(i => box.appendChild(mk(i)));
      }
    }

    openNew() {
      const mask = document.createElement("div");
      mask.className = "sc-new-mask";
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      tomorrow.setHours(9, 0, 0, 0);
      mask.innerHTML =
        '<div class="sc-new">' +
          "<h4>新闹铃</h4>" +
          '<input type="datetime-local" id="scNewTime" value="' + localInputValue(tomorrow) + '">' +
          '<textarea id="scNewContent" rows="2" placeholder="要提醒什么？如：吃药 / 取快递 / 该喝水了"></textarea>' +
          '<div class="sc-new-row">' +
            '<select id="scNewRepeat"><option value="once">仅一次</option><option value="daily">每天</option><option value="weekly">每周</option></select>' +
          "</div>" +
          '<button class="sc-new-ok" id="scNewOk" type="button">设好</button>' +
          '<button class="sc-new-no" id="scNewNo" type="button">取消</button>' +
        "</div>";
      document.body.appendChild(mask);
      mask.addEventListener("click", (e) => { if (e.target === mask) mask.remove(); });
      mask.querySelector("#scNewNo").addEventListener("click", () => mask.remove());
      mask.querySelector("#scNewOk").addEventListener("click", async () => {
        const time = mask.querySelector("#scNewTime").value.replace("T", " ");
        const content = mask.querySelector("#scNewContent").value.trim();
        const repeat = mask.querySelector("#scNewRepeat").value;
        if (!time || !content) { this.toast("时间和内容都要填"); return; }
        try {
          await api("/app/schedule/add", { method: "POST", headers: authJson(), body: JSON.stringify({ time, content, repeat }) });
          mask.remove(); this.loadList(); this.toast("闹铃已设，到点" + AI_NAME + "会开口");
        } catch (e) { this.toast("失败：" + e.message); }
      });
    }

    /* ── 位置 ── */
    async loadLocConfig() {
      const localOnly = (typeof USE_MOCK !== "undefined" && USE_MOCK);
      if (localOnly) { document.getElementById("scLocState").textContent = "（本地预览不可用）"; return; }
      try {
        const d = await api("/app/location/config", { headers: authHeaders() });
        this.locCfg = d;
        const t = document.getElementById("scLocToggle");
        t.checked = !!d.share_on;
        const amap = document.getElementById("scAmapState");
        if (amap) amap.textContent = d.amap_key_set ? "已配置 ✓" : "未配置（位置只有经纬度，解析不出街道）";
        const last = d.last;
        const where = last && last.place ? [last.place.city, last.place.district].filter(Boolean).join(" ") : "";
        document.getElementById("scLocState").textContent =
          (d.home ? "家：已设 " + (((d.home.place || {}).district) || "") : "家：未设") +
          (where ? " · 上次位置 " + where : "");
        if (d.share_on) this.pushLocation(false);
      } catch (e) { document.getElementById("scLocState").textContent = "读取失败"; }
    }
    async saveAmapKey() {
      const inp = document.getElementById("scAmapKey");
      const key = (inp && inp.value || "").trim();
      if (!key) { this.toast("先输入 key"); return; }
      try {
        await api("/app/location/config", { method: "POST", headers: authJson(), body: JSON.stringify({ amap_key: key }) });
        this.toast("高德 Key 已保存"); if (inp) inp.value = "";
        this.loadLocConfig();
      } catch (e) { this.toast("保存失败"); }
    }
    async setShare(on) {
      try {
        await api("/app/location/config", { method: "POST", headers: authJson(), body: JSON.stringify({ share: on }) });
        this.toast(on ? "位置共享已开" : "位置共享已关");
        if (on) this.pushLocation(true);
      } catch (e) { this.toast("设置失败"); document.getElementById("scLocToggle").checked = !on; }
    }
    pushLocation(tell) {
      if (!navigator.geolocation) { if (tell) this.toast("浏览器不支持定位"); return; }
      if (tell) this.toast("定位中…");
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const d = await api("/app/location/push", {
            method: "POST", headers: authJson(),
            body: JSON.stringify({ lng: pos.coords.longitude, lat: pos.coords.latitude, accuracy: Math.round(pos.coords.accuracy) })
          });
          const where = (d.place && (d.place.district || d.place.city)) || "已更新";
          if (tell) this.toast("位置已给" + AI_NAME + "：" + where);
          this.loadLocConfig();
        } catch (e) { if (tell) this.toast("推送失败"); }
      }, (err) => { if (tell) this.toast("定位失败：" + (err.code === 1 ? "拒绝了权限" : err.message)); }, { enableHighAccuracy: true, timeout: 12000 });
    }
    async setHome() {
      try { await api("/app/location/set_home", { method: "POST", headers: authJson(), body: "{}" }); this.toast("家已设在当前位置"); this.loadLocConfig(); }
      catch (e) { this.toast("先定位一次再设家"); }
    }
    toast(msg) {
      const t = document.createElement("div");
      t.style.cssText = "position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:9400;background:rgba(20,16,10,.85);color:#fff;font-size:12.5px;padding:9px 16px;border-radius:99px;";
      t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
    }
  }

  const instance = new Schedule();
  window.SchedulePlugin = instance;
  function boot() { instance.init(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
