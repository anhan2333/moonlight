// ============================================================
// 锁屏 · Lock plugin for 月光（InternalBeyond 同款，默认关闭）
//   - 挂锁 + 大字时钟 + 上滑解锁 + 可选 4 位 PIN
//   - 配置只存本机（localStorage），不进备份、不给任何 AI
//   - 开启后：每次冷启动（新标签页）先进锁屏；刷新不重复锁
//   - 设置入口注入 profile「锁屏通知」下方
// 防的是顺手翻看，不能替代设备锁（IB 同款说明）。
// 不改动现有功能 —— 独立插件，独立遮罩。
// ============================================================

(function () {
  "use strict";

  const PLUGIN_NAME = "Lock";
  const LS_ON = "moonlight_lock_on";        // "1" = 开
  const LS_PIN = "moonlight_lock_pin";      // 4 位数字（本机专属）
  const SESSION_KEY = "moonlight_lock_passed";   // sessionStorage：本标签页已解锁

  class Lock {
    constructor() {
      this.pinBuf = "";
      this.el = null;
    }

    enabled() { return localStorage.getItem(LS_ON) === "1"; }
    hasPin() { return /^\d{4}$/.test(localStorage.getItem(LS_PIN) || ""); }

    async init() {
      this.buildUI();
      this.injectSettings();
      // 冷启动才锁（sessionStorage 有记录 = 本标签页已解锁过，刷新不再锁）
      const coldStart = !sessionStorage.getItem(SESSION_KEY);
      if (this.enabled() && coldStart && !document.getElementById("login").classList.contains("hidden")) {
        // 登录页可见时先让位给登录，登录成功后再锁
        window.addEventListener("ml-logged-in", () => this.show(), { once: true });
      } else if (this.enabled() && coldStart) {
        this.show();
      }
      console.log("[" + PLUGIN_NAME + "] ready");
    }

    buildUI() {
      if (document.getElementById("lkScreen")) return;
      const el = document.createElement("div");
      el.id = "lkScreen";
      el.className = "lk-screen hidden";
      el.innerHTML = `
        <div class="lk-clock-wrap">
          <div class="lk-time" id="lkTime">--:--</div>
          <div class="lk-date" id="lkDate"></div>
          <div class="lk-lock">🔒</div>
          <div class="lk-hint" id="lkHint"></div>
        </div>
        <div class="lk-spacer"></div>
        <div class="lk-swipe" id="lkSwipe"><div class="lk-swipe-bar"></div><span>上滑解锁</span></div>
        <div class="lk-pin" id="lkPin">
          <div class="lk-dots" id="lkDots"><span class="lk-dot"></span><span class="lk-dot"></span><span class="lk-dot"></span><span class="lk-dot"></span></div>
          <div class="lk-keys" id="lkKeys"></div>
        </div>
      `;
      document.body.appendChild(el);
      this.el = el;

      // 键盘
      const keys = document.getElementById("lkKeys");
      ["1","2","3","4","5","6","7","8","9","清空","0","解锁"].forEach(k => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "lk-key" + (/\D/.test(k) ? " fn" : "");
        b.textContent = k;
        b.addEventListener("click", () => this.onKey(k));
        keys.appendChild(b);
      });

      // 上滑
      let y0 = null;
      const swipe = document.getElementById("lkSwipe");
      const onStart = (y) => { y0 = y; };
      const onEnd = (y) => {
        if (y0 != null && y0 - y > 46) this.tryUnlock();
        y0 = null;
      };
      swipe.addEventListener("touchstart", (e) => onStart(e.touches[0].clientY), { passive: true });
      swipe.addEventListener("touchend", (e) => onEnd((e.changedTouches[0] || {}).clientY || 0), { passive: true });
      swipe.addEventListener("mousedown", (e) => { onStart(e.clientY); const up = (ev) => { onEnd(ev.clientY); document.removeEventListener("mouseup", up); }; document.addEventListener("mouseup", up); });
      swipe.addEventListener("click", () => this.tryUnlock());   // 点一下也算（无 PIN 时直接开）

      // 键盘输入
      document.addEventListener("keydown", (e) => {
        if (this.el.classList.contains("hidden")) return;
        if (/^[0-9]$/.test(e.key)) this.onKey(e.key);
        else if (e.key === "Enter") this.onKey("解锁");
        else if (e.key === "Backspace") this.onKey("清空");
      });
      this.tick();
      setInterval(() => this.tick(), 10000);
    }

    tick() {
      if (!this.el || this.el.classList.contains("hidden")) return;
      const d = new Date();
      const t = document.getElementById("lkTime");
      if (t) t.textContent = d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
      const dd = document.getElementById("lkDate");
      if (dd) dd.textContent = (d.getMonth() + 1) + "月" + d.getDate() + "日 · " + ["周日","周一","周二","周三","周四","周五","周六"][d.getDay()];
    }

    show() {
      this.el.classList.remove("hidden");
      this.el.classList.remove("unlocking");
      this.pinBuf = "";
      this.paintDots();
      const needPin = this.hasPin();
      document.getElementById("lkPin").classList.toggle("on", needPin);
      document.getElementById("lkSwipe").style.display = needPin ? "none" : "";
      document.getElementById("lkHint").textContent = needPin ? "输入 4 位解锁码" : "";
      this.tick();
    }
    hide() {
      this.el.classList.add("unlocking");
      setTimeout(() => { this.el.classList.add("hidden"); this.el.classList.remove("unlocking"); }, 480);
      try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (e) {}
    }

    onKey(k) {
      if (k === "清空") { this.pinBuf = ""; this.paintDots(); return; }
      if (k === "解锁") { this.tryUnlock(); return; }
      if (this.pinBuf.length < 4) { this.pinBuf += k; this.paintDots(); }
      if (this.pinBuf.length === 4) this.tryUnlock();
    }
    paintDots() {
      const dots = document.querySelectorAll("#lkDots .lk-dot");
      dots.forEach((d, i) => d.classList.toggle("fill", i < this.pinBuf.length));
    }
    tryUnlock() {
      if (!this.hasPin()) { this.hide(); return; }
      if (this.pinBuf === localStorage.getItem(LS_PIN)) {
        this.pinBuf = "";
        this.hide();
      } else {
        this.pinBuf = "";
        this.paintDots();
        const pin = document.getElementById("lkPin");
        pin.classList.remove("lk-shake");
        void pin.offsetWidth;
        pin.classList.add("lk-shake");
      }
    }

    /* ---------- 设置注入（profile 设置区）---------- */
    injectSettings() {
      const anchor = document.querySelector("#pushSeg");
      const card = anchor && anchor.closest(".settings-card");
      if (!card || document.getElementById("lkSetCard")) return;
      const sec = document.createElement("section");
      sec.className = "settings-card";
      sec.id = "lkSetCard";
      sec.innerHTML =
        '<div class="settings-label">锁屏 <i class="info-i" title="打开后每次进入月光先过锁屏；可设 4 位解锁码。配置只存本机，防的是顺手翻看，不能替代设备锁。">i</i></div>' +
        '<div class="segmented" id="lkSeg" role="group" aria-label="锁屏开关">' +
          '<button type="button" data-val="off">关</button>' +
          '<button type="button" data-val="on">开</button>' +
        "</div>" +
        '<div class="lk-pin-form" id="lkPinForm">' +
          '<div class="push-hint" id="lkPinHint"></div>' +
          '<input class="lk-pin-input" id="lkPinInput" type="password" inputmode="numeric" maxlength="4" placeholder="设 4 位解锁码（留空清除）">' +
        "</div>";
      card.parentNode.insertBefore(sec, card.nextSibling);

      const seg = sec.querySelector("#lkSeg");
      const paint = () => seg.querySelectorAll("button").forEach(b => b.classList.toggle("active", (b.dataset.val === "on") === this.enabled()));
      paint();
      seg.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.val === "on") localStorage.setItem(LS_ON, "1");
        else localStorage.removeItem(LS_ON);
        paint();
        sec.querySelector("#lkPinForm").classList.toggle("on", this.enabled());
      });
      const pinForm = sec.querySelector("#lkPinForm");
      pinForm.classList.toggle("on", this.enabled());
      const pinInput = sec.querySelector("#lkPinInput");
      const pinHint = sec.querySelector("#lkPinHint");
      pinInput.addEventListener("input", () => {
        pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 4);
        if (pinInput.value.length === 4) {
          localStorage.setItem(LS_PIN, pinInput.value);
          pinHint.textContent = "解锁码已设置 ✓";
          pinInput.value = "";
        } else if (pinInput.value === "" && this.hasPin()) {
          // 清空提交（点别处后）才清除，这里先不打扰
        }
      });
      pinInput.addEventListener("blur", () => {
        if (pinInput.value === "" && this.hasPin() && pinHint.textContent.includes("已设置")) {
          localStorage.removeItem(LS_PIN);
          pinHint.textContent = "解锁码已清除（上滑即可解锁）";
        }
      });
    }
  }

  const instance = new Lock();
  window.LockPlugin = instance;
  function boot() { instance.init(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
