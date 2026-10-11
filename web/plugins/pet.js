// ============================================================
// 小克总 · Pet plugin for 月光
// 玩法完整移植 AionsHome 的 Seeky（数据水缸宠物）：
//   三值养成（饱食/清洁/开心）+ 离线衰减 + 拉便便 + 水变浑
//   + 喂食会游过去吃 + 点便便清理 + 七种互动 + 气泡说话 + 事件日志
// 视觉换成粉色触手小克总（CSS+SVG，圆胖可爱）。
// 每次互动会发一条轻通知给安念（他在聊天里知道你养了只小克总、
// 刚喂了它/它拉了），像「一起听」同款共享感。
// 数据只存本机。不改动现有功能 —— 独立插件，独立面板。
// ============================================================

(function () {
  "use strict";

  const PLUGIN_NAME = "Pet";
  const LS = "moonlight_pet_v1";
  const HOUR = 3600 * 1000;
  let API_BASE = "";
  let AI_NAME = "安念";

  const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, Number(v) || 0));
  const rand = (a, b) => a + Math.random() * (b - a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function authJson() {
    const secret = localStorage.getItem("companion_secret") || "";
    return { "Authorization": "Bearer " + secret, "Content-Type": "application/json" };
  }
  function hhmm(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function nextWaste(base = Date.now(), soon = false) {
    return base + rand(soon ? 0.5 * HOUR : 2.5 * HOUR, soon ? 4 * HOUR : 7 * HOUR);
  }

  class Pet {
    constructor() {
      this.st = null;
      this.busy = false;
      this._clock = null;
    }

    /* ── 状态存取 + 离线衰减（AionsHome 同款公式）── */
    defaults() {
      const now = Date.now();
      return { name: "小克总", fullness: 72, cleanliness: 92, happiness: 76,
               last_seen_at: now, next_waste_at: nextWaste(now), wastes: [], events: [], x: 50, y: 30 };
    }
    load() {
      try {
        const raw = JSON.parse(localStorage.getItem(LS) || "null");
        this.st = Object.assign(this.defaults(), raw || {});
      } catch (e) { this.st = this.defaults(); }
      if (!Array.isArray(this.st.wastes)) this.st.wastes = [];
      if (!Array.isArray(this.st.events)) this.st.events = [];
      this.applyOffline();
    }
    save() {
      this.st.last_seen_at = Date.now();
      try { localStorage.setItem(LS, JSON.stringify(this.st)); } catch (e) {}
    }
    applyOffline() {
      const s = this.st, now = Date.now();
      const hours = clamp((now - (s.last_seen_at || now)) / HOUR, 0, 24 * 14);
      if (hours > 0) {
        s.fullness = clamp(s.fullness - hours * 3.2);
        s.cleanliness = clamp(s.cleanliness - hours * 0.7 - s.wastes.length * 0.35);
        const hungryPenalty = s.fullness < 35 ? hours * 1.2 : 0;
        const dirtyPenalty = s.cleanliness < 45 ? hours * 0.9 : 0;
        s.happiness = clamp(s.happiness - hours * 0.55 - hungryPenalty - dirtyPenalty);
      }
      let spawned = 0;
      while (s.next_waste_at <= now && s.wastes.length < 6) {
        if (spawned >= 1) break;                       // 离线最多补 1 坨，不惩罚太狠
        s.wastes.push({ id: "w" + s.next_waste_at, x: rand(15, 85), bottom: rand(6, 20), ts: s.next_waste_at });
        s.cleanliness = clamp(s.cleanliness - 10);
        s.happiness = clamp(s.happiness - 3);
        s.next_waste_at = nextWaste(s.next_waste_at);
        spawned++;
      }
      if (s.next_waste_at <= now) s.next_waste_at = nextWaste(now);
    }

    /* ── UI ── */
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
      // 安念云养：回复里带 [PET:feed/clean/play/tease/scare/tap/threaten] 即远程操作小克总
      // （AionsHome 同款 seeky_interaction；执行在前端，面板开着才可见）
      window.addEventListener("ml-ai-reply", (e) => {
        const text = String((e.detail && e.detail.text) || "");
        const m = text.match(/\[\s*PET\s*:\s*(feed|clean|play|tease|scare|tap|threaten)\s*\]/i);
        if (!m) return;
        const act = m[1].toLowerCase();
        if (document.getElementById("pkPanel") && !document.getElementById("pkPanel").classList.contains("hidden")) {
          this.doAction(act);
        } else {
          // 面板没开：静默应用数值 + 记一条事件，回来能看到
          const s = this.st;
          if (act === "feed") { s.fullness = clamp(s.fullness + 7); s.happiness = clamp(s.happiness + 4); this.logEvent(AI_NAME + "远程喂了你"); }
          else if (act === "clean") { s.cleanliness = clamp(s.cleanliness + 14); s.wastes = []; this.logEvent(AI_NAME + "远程帮你清了缸"); }
          else if (act === "play") { s.happiness = clamp(s.happiness + 8); this.logEvent(AI_NAME + "远程陪你玩了一圈"); }
          else if (act === "tease" || act === "tap") { s.happiness = clamp(s.happiness + 3); this.logEvent(AI_NAME + "远程逗了你"); }
          else if (act === "scare") { s.happiness = clamp(s.happiness - 5); this.logEvent(AI_NAME + "居然吓你！"); }
          else if (act === "threaten") { s.happiness = clamp(s.happiness - 2); this.logEvent(AI_NAME + "威胁了你…"); }
          this.save();
        }
      });
      console.log("[" + PLUGIN_NAME + "] ready");
    }

    buildUI() {
      if (document.getElementById("pkPanel")) return;
      const wrap = document.createElement("div");
      wrap.id = "pkPanel";
      wrap.className = "pk-panel hidden";
      wrap.innerHTML = `
        <div class="pk-top">
          <button class="pk-back" id="pkBack" type="button" aria-label="返回">←</button>
          <div>
            <div class="pk-title">小克总</div>
            <div class="pk-sub">你的粉色触手小祖宗 · 要养的哦</div>
          </div>
          <button class="pk-rename" id="pkRename" type="button">改名</button>
        </div>
        <div class="pk-body">
          <div class="pk-stats">
            <div class="pk-stat"><div class="pk-stat-head"><span class="ic">🍖</span>饱食</div><div class="pk-meter full"><i id="pkFull"></i></div></div>
            <div class="pk-stat"><div class="pk-stat-head"><span class="ic">🫧</span>清洁</div><div class="pk-meter clean"><i id="pkClean"></i></div></div>
            <div class="pk-stat"><div class="pk-stat-head"><span class="ic">💗</span>开心</div><div class="pk-meter happy"><i id="pkHappy"></i></div></div>
          </div>
          <div class="pk-tank" id="pkTank">
            <div class="pk-light"></div>
            <div class="pk-status" id="pkStatus">IDLE</div>
            <div class="pk-bubbles"><span></span><span></span><span></span><span></span><span></span></div>
            <div class="pk-plants"><span class="pk-plant a"></span><span class="pk-plant b"></span><span class="pk-plant c"></span></div>
            <div class="pk-food-layer" id="pkFood"></div>
            <div class="pk-waste-layer" id="pkWaste"></div>
            <div class="pk-bubble" id="pkBubble"></div>
            <div class="pk-pet" id="pkPet" title="戳一下">
              <div class="pk-pet-inner">
                <div class="pk-glow"></div>
                <svg class="pk-body-svg" viewBox="0 0 120 120" aria-label="小克总">
                  <!-- 触手（后层）：粗短卷钩，带吸盘，粉嫩肉感 -->
                  <g fill="#ff9ec7">
                    <!-- 左下卷 -->
                    <path class="pk-tentacle t1" d="M40 76 Q28 84 22 96 Q26 100 32 94 Q38 88 42 80 Z"/>
                    <!-- 左中卷 -->
                    <path class="pk-tentacle t2" d="M48 80 Q42 92 38 102 Q44 104 48 96 Q52 88 52 80 Z"/>
                    <!-- 中下卷 -->
                    <path class="pk-tentacle t3" d="M58 82 Q56 94 58 104 Q64 104 64 96 Q64 88 62 82 Z"/>
                    <!-- 右中卷 -->
                    <path class="pk-tentacle t4" d="M68 80 Q74 92 78 102 Q82 100 78 92 Q74 84 70 78 Z"/>
                    <!-- 右下卷 -->
                    <path class="pk-tentacle t5" d="M76 76 Q86 84 92 94 Q94 88 88 82 Q82 76 78 74 Z"/>
                  </g>
                  <!-- 触手吸盘（内侧白点）-->
                  <g fill="#fff" opacity=".65">
                    <circle cx="30" cy="88" r="2.2"/><circle cx="34" cy="92" r="1.6"/>
                    <circle cx="44" cy="94" r="2.2"/><circle cx="48" cy="98" r="1.6"/>
                    <circle cx="60" cy="96" r="2.2"/><circle cx="60" cy="100" r="1.6"/>
                    <circle cx="72" cy="94" r="2.2"/><circle cx="76" cy="98" r="1.6"/>
                    <circle cx="84" cy="86" r="2.2"/><circle cx="88" cy="90" r="1.6"/>
                  </g>
                  <!-- 圆胖身体（更圆更肉）-->
                  <ellipse cx="60" cy="58" rx="36" ry="32" fill="#ffb8d9"/>
                  <ellipse cx="60" cy="52" rx="32" ry="24" fill="#ffd4e8" opacity=".65"/>
                  <!-- 顶部高光 -->
                  <ellipse cx="52" cy="44" rx="14" ry="10" fill="#fff" opacity=".35"/>
                  <!-- 小翅膀耳鳍（更圆润）-->
                  <path d="M26 46 Q12 38 10 28 Q22 32 30 40 Z" fill="#ff9ec7"/>
                  <path d="M94 46 Q108 38 110 28 Q98 32 90 40 Z" fill="#ff9ec7"/>
                  <!-- 大眼睛（水润红瞳）-->
                  <g class="pk-eye">
                    <ellipse cx="48" cy="56" rx="8" ry="9.5" fill="#fff"/>
                    <circle cx="49" cy="58" r="4.5" fill="#c73e5f"/>
                    <circle cx="49" cy="58" r="2.5" fill="#8b1a3a"/>
                    <circle cx="50.5" cy="55.5" r="2" fill="#fff"/>
                    <circle cx="47.5" cy="60" r="1" fill="#fff" opacity=".7"/>
                  </g>
                  <g class="pk-eye">
                    <ellipse cx="72" cy="56" rx="8" ry="9.5" fill="#fff"/>
                    <circle cx="71" cy="58" r="4.5" fill="#c73e5f"/>
                    <circle cx="71" cy="58" r="2.5" fill="#8b1a3a"/>
                    <circle cx="72.5" cy="55.5" r="2" fill="#fff"/>
                    <circle cx="69.5" cy="60" r="1" fill="#fff" opacity=".7"/>
                  </g>
                  <!-- 腮红 -->
                  <ellipse cx="40" cy="64" rx="5" ry="3.5" fill="#ff8ab0" opacity=".5"/>
                  <ellipse cx="80" cy="64" rx="5" ry="3.5" fill="#ff8ab0" opacity=".5"/>
                  <!-- 小嘴（微笑）-->
                  <path id="pkMouth" d="M54 70 Q60 76 66 70" stroke="#c73e5f" stroke-width="2.6" fill="none" stroke-linecap="round"/>
                  <!-- 呆毛小触手（更卷）-->
                  <path class="pk-tentacle" d="M58 28 Q54 16 60 10 Q66 16 62 28 Q60 32 58 28 Z" fill="#ff9ec7"/>
                </svg>
              </div>
            </div>
            <div class="pk-stones"></div>
          </div>
          <div class="pk-nameplate"><span id="pkName">小克总</span><span class="tag">· 克系血统 · 粉色限定</span></div>
          <div class="pk-say" id="pkSay">我在这里，等你叫我。</div>
          <div class="pk-actions">
            <button class="pk-act" data-act="feed" type="button"><span class="ic">🍖</span><span class="lb">投喂</span></button>
            <button class="pk-act" data-act="clean" type="button"><span class="ic">🧹</span><span class="lb">清理</span></button>
            <button class="pk-act" data-act="play" type="button"><span class="ic">🎾</span><span class="lb">玩耍</span></button>
            <button class="pk-act" data-act="tease" type="button"><span class="ic">👆</span><span class="lb">逗弄</span></button>
            <button class="pk-act" data-act="scare" type="button"><span class="ic">👻</span><span class="lb">吓唬</span></button>
            <button class="pk-act" data-act="tap" type="button"><span class="ic">🪟</span><span class="lb">敲缸</span></button>
            <button class="pk-act" data-act="threaten" type="button"><span class="ic">😤</span><span class="lb">威胁</span></button>
            <button class="pk-act" data-act="tell" type="button"><span class="ic">💌</span><span class="lb">告诉${esc(AI_NAME)}</span></button>
          </div>
          <div class="pk-log-title">📜 成长记录</div>
          <div class="pk-log" id="pkLog"></div>
        </div>
      `;
      document.body.appendChild(wrap);

      document.getElementById("pkBack").addEventListener("click", () => this.close());
      document.getElementById("pkRename").addEventListener("click", () => this.rename());
      document.getElementById("pkPet").addEventListener("click", () => this.doAction("tease"));
      wrap.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", () => this.doAction(b.dataset.act)));
      this.render();
    }

    bindMenuEntry() {
      const menu = document.querySelector(".menu-list");
      if (!menu) { setTimeout(() => this.bindMenuEntry(), 800); return; }
      if (menu.querySelector('[data-menu="pet"]')) return;
      const btn = document.createElement("button");
      btn.className = "menu-item";
      btn.type = "button";
      btn.dataset.menu = "pet";
      btn.innerHTML = `<span class="menu-ic">🐙</span><span class="menu-copy"><span class="menu-name">小克总</span><span class="menu-sub">粉色触手 · 要养的</span></span><span class="menu-chev">›</span>`;
      const anchor = menu.querySelector('[data-menu="abebei"]');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      else menu.appendChild(btn);
      btn.addEventListener("click", (e) => { e.stopPropagation(); this.open(); }, true);
    }

    open() {
      this.applyOffline(); this.save();
      document.getElementById("pkPanel").classList.remove("hidden");
      this.render();
      if (!this._clock) this._clock = setInterval(() => this.tick(), 15000);
    }
    close() {
      document.getElementById("pkPanel").classList.add("hidden");
      if (this._clock) { clearInterval(this._clock); this._clock = null; }
    }
    tick() {
      const s = this.st;
      // 在线也会饿/脏（慢速）
      s.fullness = clamp(s.fullness - 0.02);
      s.happiness = clamp(s.happiness - 0.01);
      if (Date.now() >= s.next_waste_at && s.wastes.length < 6) {
        s.wastes.push({ id: "w" + Date.now(), x: rand(15, 85), bottom: rand(6, 20), ts: Date.now() });
        s.cleanliness = clamp(s.cleanliness - 10);
        s.happiness = clamp(s.happiness - 3);
        s.next_waste_at = nextWaste(Date.now());
        this.logEvent("拉了便便…");
        this.say(randPick(["咕噜…(拉了)", "嗯…没忍住(便便+1)", "🫣 帮我清理一下嘛"]));
        this.tellAI("你的小克总拉便便了，缸里该清理啦。");
      }
      this.render();
      this.save();
    }

    /* ── 渲染 ── */
    render() {
      const s = this.st;
      document.getElementById("pkFull").style.width = s.fullness + "%";
      document.getElementById("pkClean").style.width = s.cleanliness + "%";
      document.getElementById("pkHappy").style.width = s.happiness + "%";
      document.getElementById("pkName").textContent = s.name;
      const tank = document.getElementById("pkTank");
      tank.classList.toggle("murky", s.cleanliness < 52 || s.wastes.length >= 2);
      const pet = document.getElementById("pkPet");
      pet.classList.toggle("hungry", s.fullness < 34);
      // 位置
      pet.style.left = s.x + "%";
      pet.style.bottom = s.y + "%";
      // 便便层
      const wl = document.getElementById("pkWaste");
      wl.innerHTML = s.wastes.map(w =>
        `<button class="pk-waste" data-w="${esc(w.id)}" style="--x:${w.x.toFixed(1)}%;--bottom:${w.bottom.toFixed(1)}%" title="点我清理"></button>`).join("");
      wl.querySelectorAll(".pk-waste").forEach(b => b.addEventListener("click", () => this.cleanOne(b.dataset.w)));
      // 状态字
      const st = document.getElementById("pkStatus");
      st.textContent = s.fullness < 34 ? "HUNGRY" : s.cleanliness < 48 ? "DIRTY" : s.happiness > 74 ? "HAPPY" : "IDLE";
      // 日志
      const log = document.getElementById("pkLog");
      log.innerHTML = (s.events || []).slice(-8).reverse().map(e =>
        `<div class="pk-log-item"><span class="t">${hhmm(e.ts)}</span>${esc(e.text)}</div>`).join("")
        || '<div class="pk-log-item"><span class="t">--:--</span>还没有记录，快摸摸它</div>';
    }

    say(text, ms = 3200) {
      const b = document.getElementById("pkBubble");
      b.textContent = text;
      b.classList.add("show");
      document.getElementById("pkSay").textContent = text;
      clearTimeout(this._sayT);
      this._sayT = setTimeout(() => b.classList.remove("show"), ms);
    }
    logEvent(text) {
      this.st.events.push({ text, ts: Date.now() });
      if (this.st.events.length > 60) this.st.events = this.st.events.slice(-40);
      this.save();
    }
    async moveTo(x, y) {
      this.st.x = x; this.st.y = y;
      const pet = document.getElementById("pkPet");
      pet.style.left = x + "%"; pet.style.bottom = y + "%";
      await sleep(950);
    }

    /* ── 互动（AionsHome 同款七动作）── */
    async doAction(act) {
      if (this.busy && act !== "clean") return;
      const s = this.st;
      switch (act) {
        case "feed": return this.feed();
        case "clean": {
          if (!s.wastes.length) { this.say("缸里干干净净～✨"); return; }
          this.cleanOne(null); return;
        }
        case "play":
          this.busy = true;
          this.say("玩！我要玩！！");
          for (let i = 0; i < 4; i++) { await this.moveTo(rand(15, 85), rand(20, 60)); }
          s.happiness = clamp(s.happiness + 8); s.fullness = clamp(s.fullness - 2);
          this.pet.classList.add("happy"); setTimeout(() => this.pet.classList.remove("happy"), 1100);
          this.logEvent("玩得很开心 (+8 开心)");
          this.tellAI("你陪小克总玩了一圈，它开心得触手都翘起来了。");
          this.render(); this.save(); this.busy = false; return;
        case "tease":
          s.happiness = clamp(s.happiness + 4);
          this.say(randPick(["戳、戳我干嘛啦～", "触手卷走你的手指！", "嘿嘿痒痒的"]));
          this.logEvent("被你逗了"); this.render(); this.save(); return;
        case "scare":
          this.pet.classList.add("scared");
          setTimeout(() => this.pet.classList.remove("scared"), 1000);
          s.happiness = clamp(s.happiness - 5);
          this.say(randPick(["呀！！(触手炸毛)", "你、你吓死克了…", "(躲进缸角画圈圈)"]));
          this.logEvent("被你吓到了 (-5 开心)"); this.render(); this.save(); return;
        case "tap":
          this.say(randPick(["咚、咚的…好吵！", "(贴着缸壁看你)", "敲吧敲吧，缸会裂哦(才怪)"]));
          s.happiness = clamp(s.happiness + 1);
          this.logEvent("你敲了敲缸"); this.render(); this.save(); return;
        case "threaten":
          this.say(randPick(["呜…我乖，我超乖的", "不要把我炖了嘛🥺", "(触手抱成球装死)"]));
          s.happiness = clamp(s.happiness - 2);
          this.logEvent("你威胁了它一下"); this.render(); this.save(); return;
        case "tell": {
          const mood = s.fullness < 34 ? "有点饿" : s.cleanliness < 48 ? "缸有点脏" : s.happiness > 74 ? "超级开心" : "状态不错";
          this.tellAI(`小克总近况：饱食${Math.round(s.fullness)}、清洁${Math.round(s.cleanliness)}、开心${Math.round(s.happiness)}（${mood}）。`);
          this.toast("已把小克总的近况告诉" + AI_NAME);
          return;
        }
      }
    }
    get pet() { return document.getElementById("pkPet"); }

    async feed() {
      if (this.busy) return;
      const s = this.st;
      if (s.fullness > 94) { this.say("我已经圆滚滚啦，等会儿再吃。"); return; }
      this.busy = true;
      this.say("开饭！我游过去吃～");
      // 撒饲料
      const fl = document.getElementById("pkFood");
      const pellets = [];
      for (let i = 0; i < 4; i++) {
        const p = document.createElement("span");
        p.className = "pk-pellet";
        p.style.left = rand(20, 80) + "%";
        p.style.bottom = rand(10, 40) + "%";
        fl.appendChild(p);
        pellets.push({ el: p, x: parseFloat(p.style.left), y: parseFloat(p.style.bottom) });
      }
      await sleep(700);
      for (const p of pellets) {
        await this.moveTo(p.x, p.y);
        p.el.classList.add("eaten");
        s.fullness = clamp(s.fullness + 7);
        s.happiness = clamp(s.happiness + 4);
        this.render();
        await sleep(260);
        p.el.remove();
      }
      s.next_waste_at = Math.min(s.next_waste_at || Infinity, nextWaste(Date.now(), true));
      this.logEvent("吃饱了 (+7 饱食)");
      if (Math.random() < 0.38) setTimeout(() => this.tick(), 3000);   // 可能马上拉
      this.say("ヾ(≧▽≦*)o 好吃！");
      this.tellAI("你喂了小克总，它吃得触手乱颤。");
      this.render(); this.save(); this.busy = false;
    }
    cleanOne(wid) {
      const s = this.st;
      if (!s.wastes.length) { this.say("缸里干干净净～✨"); return; }
      if (wid) s.wastes = s.wastes.filter(w => w.id !== wid);
      else s.wastes = [];
      s.cleanliness = clamp(s.cleanliness + (wid ? 6 : 14));
      s.happiness = clamp(s.happiness + 2);
      this.logEvent(wid ? "清理了一坨" : "把缸里清干净了");
      this.say(randPick(["舒服～泡泡浴！", "干净的小克总最可爱", "谢谢你(擦缸)"]));
      this.render(); this.save();
    }

    /* ── 通知安念（复用 /app/send，轻量系统消息）── */
    async tellAI(text) {
      const localOnly = location.hostname === "127.0.0.1" || location.hostname === "localhost";
      if (localOnly) return;
      try {
        await fetch(API_BASE + "/app/send", {
          method: "POST", headers: authJson(),
          body: JSON.stringify({ text: "🐙[小克总] " + text, meta: { source: "pet", kind: "note" } })
        });
      } catch (e) {}
    }
    rename() {
      const name = prompt("给小克总起个名字：", this.st.name);
      if (name && name.trim()) {
        this.st.name = name.trim().slice(0, 8);
        this.save(); this.render();
        this.tellAI(`小克总改名叫「${this.st.name}」了。`);
      }
    }
    toast(msg) {
      const t = document.createElement("div");
      t.style.cssText = "position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:9400;background:rgba(20,16,10,.85);color:#fff;font-size:12.5px;padding:9px 16px;border-radius:99px;";
      t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
    }
  }

  function randPick(a) { return a[Math.floor(Math.random() * a.length)]; }

  const instance = new Pet();
  window.PetPlugin = instance;
  function boot() { instance.init(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
