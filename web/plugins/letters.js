/* ═══════════ 书信插件(真后端版) ═══════════
   信件存后端 SQLite(/app/letters/*),不再用 localStorage 假数据。
   AI 来信:安念回复带 <ws_letter>标题|正文</ws_letter> → 前端检测后 POST /app/letters/ai_send 入库。
*/
(function(){
"use strict";
const AI = () => (window.CONFIG && window.CONFIG.AI_NAME) || "安念";
function hdrs(json){
  const s = localStorage.getItem("companion_secret") || "";
  const h = { "Authorization": "Bearer " + s };
  return json ? Object.assign(h, {"Content-Type":"application/json"}) : h;
}
function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

async function api(path, opts){
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}

/* ── 面板开关 ── */
function openLettersPanel(){
  const p = document.getElementById("lettersPanel");
  if (!p) return;
  p.classList.remove("hidden");
  p.setAttribute("aria-hidden","false");
  loadLetters();
}
function closeLettersPanel(){
  const p = document.getElementById("lettersPanel");
  if (!p) return;
  p.classList.add("hidden");
  p.setAttribute("aria-hidden","true");
}
window.openLettersPanel = openLettersPanel;
window.closeLettersPanel = closeLettersPanel;

/* ── 收件箱 ── */
async function loadLetters(){
  const box = document.getElementById("lettersList");
  if (!box) return;
  box.innerHTML = '<div class="panel-loading">加载中…</div>';
  try{
    const d = await api("/app/letters/inbox", { headers: hdrs() });
    const ls = d.letters || [];
    if (!ls.length){
      box.innerHTML = '<div class="panel-loading" style="padding:32px 0;text-align:center;">📭 还没有信<br><span style="font-size:12px;opacity:.7">给' + esc(AI()) + '写一封,或者等 TA 写给你</span></div>';
      return;
    }
    box.innerHTML = ls.map(l => {
      const mine = l.to_name === AI() || l.status === "sent";
      const who = mine ? "你 → " + esc(l.to_name || AI()) : esc(AI()) + " → 你";
      const when = (l.created_at || "").replace("T", " ").slice(0, 16);
      const body = esc(l.content || "");
      const preview = body.length > 60 ? body.slice(0, 60) + "…" : body;
      return '<div class="letter-row" data-lid="' + l.id + '" style="padding:12px 14px;border:1px solid var(--card-line,#e5dcc8);border-radius:12px;margin-bottom:10px;background:var(--card-bg,#fff);cursor:pointer;">'
        + '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-soft,#998);margin-bottom:6px;">'
        + '<span>' + (mine ? "✒️ " : "💌 ") + who + '</span><span>' + esc(when) + '</span></div>'
        + '<div style="font-size:14px;line-height:1.6;color:var(--text,#3a3025);white-space:pre-wrap;word-break:break-word;">' + preview + '</div>'
        + (l.status === "unread" ? '<div style="margin-top:6px;font-size:11px;color:#c17;">● 未读</div>' : "")
        + '</div>';
    }).join("");
    // 点开看全文
    box.querySelectorAll(".letter-row").forEach(el => {
      el.addEventListener("click", () => {
        const id = el.dataset.lid;
        const l = ls.find(x => String(x.id) === String(id));
        if (!l) return;
        const mine = l.to_name === AI() || l.status === "sent";
        alert((mine ? "你写给 " + (l.to_name || AI()) : AI() + " 写给你") + "\n\n" + (l.content || ""));
        if (l.status === "unread"){
          api("/app/letters/read/" + l.id, { method: "POST", headers: hdrs() }).then(loadLetters).catch(()=>{});
        }
      });
    });
  }catch(e){
    box.innerHTML = '<div class="panel-loading">加载失败:' + esc(e.message || e) + '</div>';
  }
}

/* ── 寄信(你 → AI) ── */
async function sendLetter(){
  const inp = document.getElementById("letterInput");
  if (!inp) return;
  const content = (inp.value || "").trim();
  if (!content) return;
  inp.value = "";
  try{
    await api("/app/letters/send", { method: "POST", headers: hdrs(true), body: JSON.stringify({ content: content, to_name: AI() }) });
    // 同步一条进聊天,让安念知道有信(她会在聊天里回,并可选择回信到信件库)
    try{
      await api("/app/send", { method: "POST", headers: hdrs(true), body: JSON.stringify({ text: "✉️ [书信] " + content, meta: { source: "letters" } }) });
    }catch(_){}
    loadLetters();
  }catch(e){
    alert("寄信失败:" + (e.message || e));
  }
}
window.sendLetter = sendLetter;

/* ── AI 来信入库:<ws_letter>标题|正文</ws_letter> ── */
const _seenLetterMsg = new Set();
async function ingestAiLetter(text, msgId){
  const m = /<ws_letter>([\s\S]*?)<\/ws_letter>/i.exec(String(text || ""));
  if (!m) return false;
  if (msgId != null && _seenLetterMsg.has(msgId)) return true;
  if (msgId != null) _seenLetterMsg.add(msgId);
  const inner = m[1];
  const body = inner.includes("|") ? inner.slice(inner.indexOf("|") + 1) : inner;
  try{
    await api("/app/letters/ai_send", { method: "POST", headers: hdrs(true), body: JSON.stringify({ content: body.trim() }) });
    const p = document.getElementById("lettersPanel");
    if (p && !p.classList.contains("hidden")) loadLetters();
  }catch(_){}
  return true;
}
window.__lettersIngest = ingestAiLetter;

// 聊天里 AI 回复来了 → 检查有没有信
window.addEventListener("ml-ai-reply", (e) => {
  const d = (e && e.detail) || {};
  ingestAiLetter(d.text, d.id);
});
})();
