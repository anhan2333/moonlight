// ============================================================
// 粉月亮 · 生理期插件（InternalBeyond 同款，并入日历）
//   - 填上次经期开始日 + 周期天数 → 自动推算第几天/下次约几号
//   - 月历粉点：经期红点、易孕期浅粉点（MutationObserver 注入，不改日历代码）
//   - 临近或进行中时「告诉安念」：一句关怀上下文发给 TA，
//     TA 之后聊天会自然照顾（每天最多自动提一次，可手动）
// 数据只存本机。不改动现有日历插件 —— 独立插件，只加不减。
// ============================================================

(function () {
  "use strict";

  const PLUGIN_NAME = "Period";
  const LS = "moonlight_period_v1";        // {start:'YYYY-MM-DD', cycle:28, len:5}
  const LS_NOTIFIED = "moonlight_period_notified";  // 今天是否已告诉安念

  function authHeadersJson() {
    const secret = localStorage.getItem("companion_secret") || "";
    return { "Authorization": "Bearer " + secret, "Content-Type": "application/json" };
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function dkey(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function parseKey(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

  class Period {
    constructor() { this.cfg = null; }

    load() {
      try { this.cfg = JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) { this.cfg = null; }
      if (this.cfg && (!parseKey(this.cfg.start) || !this.cfg.cycle)) this.cfg = null;
    }
    save() {
      try { localStorage.setItem(LS, JSON.stringify(this.cfg)); } catch (e) {}
    }

    /* 推算：{dayOfCycle, inPeriod, dayNum, nextStart, fertile:[d1,d2]} */
    status() {
      if (!this.cfg) return null;
      const start = parseKey(this.cfg.start);
      const cycle = Math.max(15, Math.min(45, this.cfg.cycle || 28));
      const len = Math.max(2, Math.min(10, this.cfg.len || 5));
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let diff = daysBetween(start, today) % cycle;
      if (diff < 0) diff += cycle;
      const dayOfCycle = diff + 1;
      const inPeriod = dayOfCycle <= len;
      const nextStart = addDays(today, cycle - diff);
      const ovu = addDays(nextStart, -14);          // 排卵日≈下次开始前 14 天
      const fertile = [addDays(ovu, -3), addDays(ovu, +1)];
      return { dayOfCycle, inPeriod, dayNum: dayOfCycle, len, cycle, nextStart, ovu, fertile };
    }

    async init() {
      this.load();
      this.buildCard();
      this.watchCalendar();
      // 每天自动提一次（临近/进行中才提）
      this.autoTell();
      console.log("[" + PLUGIN_NAME + "] ready");
    }

    /* ---------- 日历面板顶部卡 ---------- */
    buildCard() {
      if (document.getElementById("pmCard")) return;
      const cal = document.getElementById("calendarPanel") || document.querySelector(".calendar-panel");
      if (!cal) { setTimeout(() => this.buildCard(), 900); return; }
      const card = document.createElement("div");
      card.id = "pmCard";
      card.className = "pm-card";
      const _pb = cal.querySelector(".side-panel-body");if (_pb) { _pb.insertBefore(card, _pb.firstChild); }else { cal.insertBefore(card, cal.firstChild.nextSibling || null); }
      this.paintCard();
    }
    paintCard() {
      const card = document.getElementById("pmCard");
      if (!card) return;
      const st = this.status();
      if (!st) {
        card.innerHTML =
          '<div class="pm-head"><span class="moon">🌙</span>粉月亮 · 生理期<span class="pm-status">未设置</span></div>' +
          '<div class="pm-body">填一次，之后月历自动标粉点，安念也知道照顾你。</div>' +
          '<div class="pm-row">' +
            '<label>上次开始</label><input type="date" id="pmStart">' +
            '<label>周期</label><input type="number" id="pmCycle" value="28" min="15" max="45"><span style="font-size:11px;">天</span>' +
            '<label>经期</label><input type="number" id="pmLen" value="5" min="2" max="10"><span style="font-size:11px;">天</span>' +
            '<button class="pm-save" id="pmSave" type="button">保存</button>' +
          "</div>";
        card.querySelector("#pmSave").addEventListener("click", () => {
          const s = card.querySelector("#pmStart").value;
          if (!s) { this.toast("先选上次开始日"); return; }
          this.cfg = { start: s, cycle: Number(card.querySelector("#pmCycle").value) || 28, len: Number(card.querySelector("#pmLen").value) || 5 };
          this.save(); this.paintCard(); this.paintDots();
          this.toast("粉月亮已开启");
        });
        return;
      }
      const near = !st.inPeriod && daysBetween(new Date(), st.nextStart) <= 2;
      const status = st.inPeriod ? ("经期第 " + st.dayNum + " 天") : near ? ("快来了 · 约 " + (st.nextStart.getMonth() + 1) + "/" + st.nextStart.getDate()) : "周期平稳";
      card.innerHTML =
        '<div class="pm-head"><span class="moon">🌙</span>粉月亮 · 生理期<span class="pm-status">' + esc(status) + "</span></div>" +
        '<div class="pm-body">周期 ' + st.cycle + " 天 · 经期 " + st.len + " 天 · 下次约 <b>" + (st.nextStart.getMonth() + 1) + "月" + st.nextStart.getDate() + "日</b>" +
        " · 易孕期 " + (st.fertile[0].getMonth() + 1) + "/" + st.fertile[0].getDate() + "–" + (st.fertile[1].getMonth() + 1) + "/" + st.fertile[1].getDate() + "</div>" +
        '<div class="pm-row">' +
          '<button class="pm-log" id="pmLog" type="button">🩸 今天来了（重置开始日）</button>' +
          '<button class="pm-log" id="pmTell" type="button">💌 告诉安念</button>' +
          '<button class="pm-log" id="pmEdit" type="button" style="margin-left:auto;">修改设置</button>' +
        "</div>";
      card.querySelector("#pmLog").addEventListener("click", () => {
        this.cfg.start = dkey(new Date()); this.save(); this.paintCard(); this.paintDots(); this.toast("已记录：今天是第 1 天");
      });
      card.querySelector("#pmTell").addEventListener("click", () => this.tellAI(true));
      card.querySelector("#pmEdit").addEventListener("click", () => { this.cfg = null; this.save(); this.paintCard(); this.paintDots(); });
    }

    /* ---------- 月历粉点（MutationObserver，不碰日历代码）---------- */
    watchCalendar() {
      const tryPaint = () => { this.paintDots(); };
      const mo = new MutationObserver(tryPaint);
      const start = () => {
        const grid = document.querySelector(".calendar-grid");
        if (grid) mo.observe(grid, { childList: true, subtree: true });
        tryPaint();
      };
      start();
      setInterval(() => { const g = document.querySelector(".calendar-grid"); if (g) tryPaint(); }, 1500);
    }
    paintDots() {
      const st = this.status();
      if (!st || !this.cfg) { document.querySelectorAll(".pm-chip").forEach(c => c.remove()); return; }
      const cells = document.querySelectorAll(".calendar-day[data-date]");
      if (!cells.length) return;
      const start = parseKey(this.cfg.start);
      const cycle = st.cycle, len = st.len;
      const ovu = cycle - 14;
      cells.forEach(cell => {
        const old = cell.querySelector(".pm-chip");
        if (old) old.remove();
        const d = parseKey(cell.dataset.date);
        if (!d) return;
        let diff = daysBetween(start, d) % cycle;
        if (diff < 0) diff += cycle;
        const isPeriod = diff < len;
        const isFertile = !isPeriod && Math.abs(diff - ovu) <= 3;
        if (!isPeriod && !isFertile) return;
        const chip = document.createElement("span");
        chip.className = "pm-chip " + (isPeriod ? "pm-period" : "pm-fertile");
        chip.title = isPeriod ? "经期第 " + (diff + 1) + " 天" : "易孕期";
        cell.appendChild(chip);
      });
    }

    /* ---------- 告诉安念 ---------- */
    async tellAI(force) {
      const st = this.status();
      if (!st) return;
      const today = dkey(new Date());
      if (!force && localStorage.getItem(LS_NOTIFIED) === today) return;
      if (location.hostname === "127.0.0.1" || location.hostname === "localhost") { this.toast("（本地预览）部署后才会真的告诉安念"); return; }
      const note = st.inPeriod
        ? "（她的生理期第 " + st.dayNum + " 天，请多疼她一点：主动提醒她喝温水、别碰凉的，说话放软。）"
        : "（她生理期快来了，约 " + (st.nextStart.getMonth() + 1) + "月" + st.nextStart.getDate() + "日，这两天照顾她的情绪，别让她熬夜。）";
      try {
        await fetch((window.CONFIG && window.CONFIG.API_BASE ? window.CONFIG.API_BASE : "") + "/app/send", {
          method: "POST", headers: authHeadersJson(),
          body: JSON.stringify({ text: "🌙[粉月亮] " + note, meta: { source: "period", kind: "note" } })
        });
        localStorage.setItem(LS_NOTIFIED, today);
        if (force) this.toast("安念知道了");
      } catch (e) { if (force) this.toast("发送失败"); }
    }
    autoTell() {
      const st = this.status();
      if (!st) return;
      const near = st.inPeriod || daysBetween(new Date(), st.nextStart) <= 2;
      if (near) this.tellAI(false);
    }
    toast(msg) {
      const t = document.createElement("div");
      t.style.cssText = "position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:9400;background:rgba(20,16,10,.85);color:#fff;font-size:12.5px;padding:9px 16px;border-radius:99px;";
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 2600);
    }
  }

  const instance = new Period();
  window.PeriodPlugin = instance;
  function boot() { instance.init(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
