// ============================================================
// DIY · 外部工具（InternalBeyond 同款）
//   - HTTP 工具：名字 / 方法 / URL / headers / body 模板
//   - 「调用前确认」开关：运行先弹确认卡（IB 同款）
//   - 结果一键发进聊天，让安念看到接口返回
//   - 工具配置导入 / 导出（JSON），只存本机
//   - 蓝牙诊断：扫附近 BLE 设备（啵啵贝玩具用的同一套 Web Bluetooth）
// MCP 不做（浏览器直连不现实，IB 也走中转）；HTTP 工具已覆盖同类需求。
// 不改动现有功能 —— 独立插件，独立面板。
// ============================================================

(function () {
  "use strict";

  const PLUGIN_NAME = "DIY";
  const LS_KEY = "moonlight_diy_tools_v1";
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

  class Diy {
    constructor() {
      this.tools = [];   // {id, name, method, url, headers, body, confirm}
      this.editingId = null;
    }
    load() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        this.tools = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(this.tools)) this.tools = [];
      } catch (e) { this.tools = []; }
    }
    save() {
      try { localStorage.setItem(LS_KEY, JSON.stringify(this.tools)); } catch (e) {}
    }
    uid() { return "tool-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

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
      console.log("[" + PLUGIN_NAME + "] ready,", this.tools.length, "tools");
    }

    buildUI() {
      if (document.getElementById("diyPanel")) return;
      const wrap = document.createElement("div");
      wrap.id = "diyPanel";
      wrap.className = "diy-panel hidden";
      wrap.innerHTML = `
        <div class="diy-top">
          <button class="diy-back" id="diyBack" type="button" aria-label="返回">←</button>
          <div>
            <div class="diy-title">外部工具</div>
            <div class="diy-sub">HTTP 接口 · 调用前确认 · 结果给${escapeHtml(AI_NAME)}看</div>
          </div>
          <div class="diy-top-actions">
            <button class="diy-topbtn" id="diyImportBtn" type="button" title="导入工具 JSON">导入</button>
            <button class="diy-topbtn" id="diyExportBtn" type="button" title="导出工具 JSON">导出</button>
            <button class="diy-topbtn primary" id="diyAddBtn" type="button">＋ 新工具</button>
          </div>
        </div>
        <div class="diy-scroll">
          <div id="diyList"></div>
          <div class="diy-ble-card">
            <b>📶 蓝牙诊断</b><br>
            扫描附近的 BLE 设备（啵啵贝玩具走的就是这套 Web Bluetooth，这里只列名字用来排障，不连接）。
            <br><button class="diy-ble-btn" id="diyBleBtn" type="button">扫描蓝牙设备</button>
            <div id="diyBleOut" style="margin-top:6px;opacity:.75;"></div>
          </div>
        </div>
      `;
      document.body.appendChild(wrap);

      const fi = document.createElement("input");
      fi.type = "file"; fi.accept = ".json,application/json"; fi.id = "diyImportInput"; fi.className = "hidden";
      wrap.appendChild(fi);

      document.getElementById("diyBack").addEventListener("click", () => this.close());
      document.getElementById("diyAddBtn").addEventListener("click", () => this.openEdit(null));
      document.getElementById("diyExportBtn").addEventListener("click", () => this.exportTools());
      document.getElementById("diyImportBtn").addEventListener("click", () => fi.click());
      fi.addEventListener("change", () => this.importTools(fi.files && fi.files[0]));
      document.getElementById("diyBleBtn").addEventListener("click", () => this.bleScan());
      this.renderList();
    }

    bindMenuEntry() {
      const menu = document.querySelector(".menu-list");
      if (!menu) { setTimeout(() => this.bindMenuEntry(), 800); return; }
      if (menu.querySelector('[data-menu="diy"]')) return;
      const btn = document.createElement("button");
      btn.className = "menu-item";
      btn.type = "button";
      btn.dataset.menu = "diy";
      btn.innerHTML = `<span class="menu-ic">🔧</span><span class="menu-copy"><span class="menu-name">外部工具</span><span class="menu-sub">HTTP 接口 · 调用前确认</span></span><span class="menu-chev">›</span>`;
      const anchor = menu.querySelector('[data-menu="backup"]');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor);
      else menu.appendChild(btn);
      btn.addEventListener("click", (e) => { e.stopPropagation(); this.open(); }, true);
    }

    renderList() {
      const box = document.getElementById("diyList");
      if (!box) return;
      if (!this.tools.length) {
        box.innerHTML = '<div class="diy-empty">还没有工具。<br>点右上「＋ 新工具」配一个 HTTP 接口试试——天气、番剧日历、你自己的服务都行。</div>';
        return;
      }
      box.innerHTML = "";
      this.tools.forEach(t => {
        const div = document.createElement("div");
        div.className = "diy-tool";
        div.innerHTML =
          '<div class="diy-tool-head">' +
            '<span class="diy-method ' + (t.method === "POST" ? "post" : "") + '">' + escapeHtml(t.method) + "</span>" +
            '<span class="diy-tool-name"></span>' +
            (t.confirm ? '<span class="diy-confirm-tag">调用前确认</span>' : "") +
          "</div>" +
          '<div class="diy-tool-url"></div>' +
          '<div class="diy-tool-acts">' +
            '<button class="diy-tool-act run" data-act="run" type="button">▶ 运行</button>' +
            '<button class="diy-tool-act" data-act="chat" type="button">结果发给' + escapeHtml(AI_NAME) + "</button>" +
            '<button class="diy-tool-act" data-act="edit" type="button">编辑</button>' +
            '<button class="diy-tool-act danger" data-act="del" type="button">删除</button>' +
          "</div>" +
          '<div class="diy-result hidden"></div>';
        div.querySelector(".diy-tool-name").textContent = t.name;
        div.querySelector(".diy-tool-url").textContent = t.url;
        const result = div.querySelector(".diy-result");
        let lastResult = "";
        div.querySelector('[data-act="run"]').addEventListener("click", async () => {
          const out = await this.runTool(t);
          lastResult = out.text;
          result.classList.remove("hidden");
          result.classList.toggle("err", !out.ok);
          result.textContent = out.text;
        });
        div.querySelector('[data-act="chat"]').addEventListener("click", async () => {
          if (!lastResult) {
            const out = await this.runTool(t);
            lastResult = out.text;
          }
          this.sendToChat(t, lastResult);
        });
        div.querySelector('[data-act="edit"]').addEventListener("click", () => this.openEdit(t.id));
        div.querySelector('[data-act="del"]').addEventListener("click", () => {
          if (confirm("删除工具「" + t.name + "」？")) {
            this.tools = this.tools.filter(x => x.id !== t.id);
            this.save(); this.renderList();
          }
        });
        box.appendChild(div);
      });
    }

    /* ---------- 运行（含调用前确认）---------- */
    runTool(t) {
      const headers = this.safeParse(t.headers) || {};
      const body = t.method === "POST" ? this.safeParse(t.body) : undefined;
      const go = async () => {
        try {
          const opt = { method: t.method || "GET", headers: headers };
          if (body !== undefined) opt.body = JSON.stringify(body);
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 15000);
          opt.signal = ctrl.signal;
          const r = await fetch(t.url, opt);
          clearTimeout(timer);
          const text = (await r.text()) || "(空响应)";
          return { ok: r.ok, text: "HTTP " + r.status + "\n" + text.slice(0, 3000) };
        } catch (e) {
          return { ok: false, text: "请求失败：" + (e.name === "AbortError" ? "超时(15s)" : (e.message || e)) };
        }
      };
      if (!t.confirm) return go();
      return new Promise((resolve) => {
        const mask = document.createElement("div");
        mask.className = "diy-confirm-mask";
        mask.innerHTML =
          '<div class="diy-confirm">' +
            "<h4>调用「" + escapeHtml(t.name) + "」？</h4>" +
            "<pre>" + escapeHtml((t.method || "GET") + " " + t.url + (body !== undefined ? "\n" + JSON.stringify(body, null, 2) : "")) + "</pre>" +
            '<div class="diy-confirm-row">' +
              '<button class="diy-confirm-ok" id="diyConfOk" type="button">调用</button>' +
              '<button class="diy-confirm-no" id="diyConfNo" type="button">取消</button>' +
            "</div>" +
          "</div>";
        document.body.appendChild(mask);
        mask.querySelector("#diyConfNo").addEventListener("click", () => { mask.remove(); resolve({ ok: false, text: "已取消" }); });
        mask.querySelector("#diyConfOk").addEventListener("click", async () => { mask.remove(); resolve(await go()); });
      });
    }
    safeParse(s) {
      if (!s || !String(s).trim()) return null;
      try { return JSON.parse(s); } catch (e) { return null; }
    }

    /* 结果发进聊天 */
    sendToChat(t, result) {
      const localOnly = location.hostname === "127.0.0.1" || location.hostname === "localhost";
      if (localOnly) { this.toast("（本地预览）部署后才能发进聊天"); return; }
      fetch(API_BASE + "/app/send", {
        method: "POST", headers: authHeadersJson(),
        body: JSON.stringify({
          text: "🔧[外部工具·" + t.name + "] 我调用了 " + t.url + "，返回：\n" + String(result).slice(0, 1500),
          meta: { source: "diy_tool", tool: t.name }
        })
      }).then(() => this.toast("已发给" + AI_NAME)).catch(() => this.toast("发送失败"));
    }

    /* ---------- 编辑器 ---------- */
    openEdit(id) {
      this.editingId = id;
      const old = id ? this.tools.find(x => x.id === id) : null;
      const mask = document.createElement("div");
      mask.className = "diy-edit-mask";
      mask.innerHTML =
        '<div class="diy-edit">' +
          "<h4>" + (id ? "编辑工具" : "新工具") + "</h4>" +
          "<div><label>名字</label><input id='diyEditName' placeholder='如：今天追什么番'></div>" +
          '<div class="diy-edit-row">' +
            "<div><label>方法</label><select id='diyEditMethod'><option>GET</option><option>POST</option></select></div>" +
            "<div><label style='visibility:hidden'>·</label><label class='diy-edit-check' style='margin:0'><input type='checkbox' id='diyEditConfirm'> 调用前确认</label></div>" +
          "</div>" +
          "<div><label>URL</label><input id='diyEditUrl' placeholder='https://api.example.com/xxx'></div>" +
          "<div><label>Headers（JSON，可空）</label><textarea id='diyEditHeaders' placeholder='{\"Authorization\": \"Bearer ...\"}'></textarea></div>" +
          "<div><label>Body（JSON，POST 用）</label><textarea id='diyEditBody' placeholder='{\"date\": \"2026-09-12\"}'></textarea></div>" +
          '<button class="diy-edit-commit" id="diyEditOk" type="button">保存</button>' +
          '<button class="diy-edit-cancel" id="diyEditNo" type="button">取消</button>' +
        "</div>";
      document.body.appendChild(mask);
      if (old) {
        mask.querySelector("#diyEditName").value = old.name || "";
        mask.querySelector("#diyEditMethod").value = old.method || "GET";
        mask.querySelector("#diyEditUrl").value = old.url || "";
        mask.querySelector("#diyEditHeaders").value = old.headers || "";
        mask.querySelector("#diyEditBody").value = old.body || "";
        mask.querySelector("#diyEditConfirm").checked = !!old.confirm;
      }
      mask.addEventListener("click", (e) => { if (e.target === mask) mask.remove(); });
      mask.querySelector("#diyEditNo").addEventListener("click", () => mask.remove());
      mask.querySelector("#diyEditOk").addEventListener("click", () => {
        const name = mask.querySelector("#diyEditName").value.trim();
        const url = mask.querySelector("#diyEditUrl").value.trim();
        if (!name || !url) { this.toast("名字和 URL 必填"); return; }
        const rec = {
          id: id || this.uid(),
          name: name,
          method: mask.querySelector("#diyEditMethod").value,
          url: url,
          headers: mask.querySelector("#diyEditHeaders").value.trim(),
          body: mask.querySelector("#diyEditBody").value.trim(),
          confirm: mask.querySelector("#diyEditConfirm").checked
        };
        if (id) {
          const i = this.tools.findIndex(x => x.id === id);
          if (i >= 0) this.tools[i] = rec;
        } else {
          this.tools.push(rec);
        }
        this.save(); mask.remove(); this.renderList();
      });
    }

    /* ---------- 导入导出 ---------- */
    exportTools() {
      const blob = new Blob([JSON.stringify(this.tools, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "moonlight_diy_tools.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    }
    importTools(file) {
      if (!file) return;
      file.text().then(tx => {
        const data = JSON.parse(tx);
        if (!Array.isArray(data)) throw new Error("需要数组");
        data.forEach(t => {
          if (t && t.name && t.url) {
            this.tools.push(Object.assign({ id: this.uid(), method: "GET", confirm: false }, t, { id: this.uid() }));
          }
        });
        this.save(); this.renderList();
        this.toast("导入完成");
      }).catch(e => this.toast("导入失败：" + (e.message || e)));
    }

    /* ---------- 蓝牙诊断 ---------- */
    async bleScan() {
      const out = document.getElementById("diyBleOut");
      if (!out) return;
      if (!navigator.bluetooth) { out.textContent = "这个浏览器不支持 Web Bluetooth（iOS Safari 不支持；用电脑 Chrome / 安卓 Chrome）。"; return; }
      out.textContent = "扫描中…（选一个设备即可，只会读名字）";
      try {
        const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
        out.textContent = "找到：" + (device.name || "(无名设备)") + "（id: " + device.id.slice(0, 12) + "…）";
      } catch (e) {
        out.textContent = e.name === "NotFoundError" ? "没选设备" : "扫描失败：" + (e.message || e);
      }
    }

    toast(msg) {
      const t = document.createElement("div");
      t.style.cssText = "position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:9400;background:rgba(20,16,10,.85);color:#fff;font-size:12.5px;padding:9px 16px;border-radius:99px;";
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 2600);
    }

    open() {
      const p = document.getElementById("diyPanel");
      if (p) { p.classList.remove("hidden"); this.renderList(); }
    }
    close() {
      const p = document.getElementById("diyPanel");
      if (p) p.classList.add("hidden");
    }
  }

  const instance = new Diy();
  window.DiyPlugin = instance;
  function boot() { instance.init(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
