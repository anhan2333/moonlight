/* ════════════ 面板函数补全（v0.14~v0.17 IB移植遗留的空壳修复）════════════
   书信/日历/星图/塔罗/朋友圈/茶歇/日记/备份/眼睛 的关闭与核心功能 */

function _mlPanel(id){
  return document.getElementById(id);
}
function _mlOpen(id){
  const p = _mlPanel(id);
  if (!p) return;
  p.classList.remove('hidden');
  p.setAttribute('aria-hidden','false');
}
function _mlClose(id){
  const p = _mlPanel(id);
  if (!p) return;
  p.classList.add('hidden');
  p.setAttribute('aria-hidden','true');
}
function openLettersPanel(){ _mlOpen('lettersPanel'); loadLetters(); }
function openCalendarPanel(){ _mlOpen('calendarPanel'); }
function openTarotPanel(){ _mlOpen('tarotPanel'); }
function openCirclePanel(){ _mlOpen('circlePanel'); }
function openTeaPanel(){ _mlOpen('teaPanel'); }
function openDiaryPanel(){ _mlOpen('diaryPanel'); try{ _loadDiary(''); }catch(e){} }
function openGiftPanel(){
  const p = _mlPanel('giftPanel'); if (p){ _mlOpen('giftPanel'); }
  else if (typeof window.openPluginPanel === 'function'){}
}
function openWishPanel(){ _mlOpen('wishPanel'); }


/* ---- 书信 Letters ---- */
async function loadLetters(){
  const box = document.getElementById('lettersList') || document.getElementById('letterList');
  if (!box) return;
  const localOnly = typeof USE_MOCK !== 'undefined' && USE_MOCK;
  if (localOnly){ box.innerHTML = '<div class="panel-loading">（本地预览）书信存在服务器上。</div>'; return; }
  try {
    const r = await fetch(API_BASE + '/app/letters/inbox', { headers: authHeaders() });
    const d = await r.json();
    const arr = d.letters || [];
    if (!arr.length){ box.innerHTML = '<div class="panel-loading">还没有信。在上面写一句，寄给安念吧。</div>'; return; }
    box.innerHTML = arr.map(function(L){
      const who = (L.to_name === '安念') ? '你 → 安念' : '安念 → 你';
      const when = (L.created_at || '').replace('T',' ').slice(0,16);
      const txt = (L.content || '').replace(/</g,'&lt;');
      return '<div class="fund-card" style="margin-bottom:10px;"><div class="fund-name" style="font-size:12px;opacity:.6;">'+who+' · '+when+'</div><div style="margin-top:5px;font-size:14px;line-height:1.6;">'+txt+'</div></div>';
    }).join('');
  } catch(e){ box.innerHTML = '<div class="panel-loading">加载失败，返回再进一次</div>'; }
}
function closeLettersPanel(){ _mlClose('lettersPanel'); }
async function sendLetter(){
  const inp = document.getElementById('letterInput') || document.getElementById('lettersInput');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;
  const box = document.getElementById('lettersList') || document.getElementById('letterList');
  try {
    const r = await fetch(API_BASE + '/app/letters/send', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify({ content: text })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    loadLetters();
    inp.value = '';
  } catch(e){
    if (box) box.innerHTML = '<div class="panel-loading">寄信失败</div>';
  }
}

/* ---- 日历 Calendar ---- */
function closeCalendarPanel(){ _mlClose('calendarPanel'); }
async function addCalendarEvent(){
  const t = document.getElementById('calTitle');
  const d = document.getElementById('calDate');
  if (!t || !t.value.trim()) return;
  try {
    await fetch(API_BASE + '/app/calendar/add', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify({ title: t.value.trim(), date: (d||{}).value || '' })
    });
    t.value = '';
    if (d) d.value = '';
    _loadCalendar();
  } catch(e){}
}
async function _loadCalendar(){
  const box = document.getElementById('calendarList');
  if (!box) return;
  try {
    const r = await fetch(API_BASE + '/app/calendar/list', { headers: authHeaders() });
    const d = await r.json();
    if (d.events && d.events.length){
      box.innerHTML = d.events.map(e => '<div class="fund-card"><div class="fund-name">' + (e.title||'') + '</div><div class="fund-date">' + (e.date||'') + '</div></div>').join('');
    } else {
      box.innerHTML = '<div class="panel-loading">还没有事件</div>';
    }
  } catch(e){
    box.innerHTML = '<div class="panel-loading">加载失败</div>';
  }
}

/* ---- 星图 Memory Sky ---- */
/* ---- 星图 Memory Sky · 打开(iframe 记忆银河) ---- */
function openMemSkyPanel(){
  const p = document.getElementById('memSkyPanel');
  if (!p) return;
  p.classList.remove('hidden');
  p.setAttribute('aria-hidden', 'false');
  const frame = document.getElementById('galaxyFrame');
  if (frame && !frame.src){
    frame.src = 'galaxy.html?token=' + encodeURIComponent(secret || '');
    frame.addEventListener('load', () => {
      frame.style.display = 'block';
      const loading = document.getElementById('galaxyLoading');
      if (loading) loading.style.display = 'none';
    }, { once: true });
  }
}
function closeMemSkyPanel(){ _mlClose('memSkyPanel'); }

/* ---- 塔罗 Tarot ---- */
function closeTarotPanel(){ _mlClose('tarotPanel'); }
async function drawTarot(spread){
  const box = document.getElementById('tarotResult');
  if (!box) return;
  box.innerHTML = '<div class="panel-loading">洗牌中…</div>';
  try {
    const r = await fetch(API_BASE + '/app/tarot/draw', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify({ spread: spread || 'single' })
    });
    const d = await r.json();
    if (d.cards && d.cards.length){
      let html = '';
      d.cards.forEach(c => {
        const rev = c.reversed ? '（逆位）' : '';
        html += '<div class="fund-card"><div class="fund-name">' + (c.name_cn || c.name || c.title || '牌') + rev + '</div><div class="fund-date">' + (c.position || '') + ' ' + (c.meaning || c.desc || '') + '</div></div>';
      });
      box.innerHTML = html;
    } else if (d.error){
      box.innerHTML = '<div class="panel-loading">' + d.error + '</div>';
    } else {
      box.innerHTML = '<div class="panel-loading">' + (d.summary || JSON.stringify(d).substring(0,200)) + '</div>';
    }
  } catch(e){
    box.innerHTML = '<div class="panel-loading">抽牌失败</div>';
  }
}

/* ---- 朋友圈 Circle ---- */
function closeCirclePanel(){ _mlClose('circlePanel'); }
async function postCircle(){
  const inp = document.getElementById('circleInput');
  if (!inp || !inp.value.trim()) return;
  try {
    await fetch(API_BASE + '/app/circle/post', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify({ text: inp.value.trim() })
    });
    inp.value = '';
    _loadCircle();
  } catch(e){}
}
async function _loadCircle(){
  const box = document.getElementById('circleFeed');
  if (!box) return;
  try {
    const r = await fetch(API_BASE + '/app/circle/feed', { headers: authHeaders() });
    const d = await r.json();
    const posts = d.posts || d.feed || [];
    if (posts.length){
      box.innerHTML = posts.map(p => '<div class="fund-card"><div class="fund-text">' + (p.text||p.content||'') + '</div><div class="fund-date">' + (p.author||'') + ' · ' + (p.created_at||'') + '</div></div>').join('');
    } else {
      box.innerHTML = '<div class="panel-loading">还没有动态</div>';
    }
  } catch(e){
    box.innerHTML = '<div class="panel-loading">加载失败</div>';
  }
}

/* ---- 茶歇 Tea ---- */
function closeTeaPanel(){ _mlClose('teaPanel'); }
async function randomTea(){
  const box = document.getElementById('teaResult');
  if (!box) return;
  box.innerHTML = '<div class="panel-loading">安念正在挑茶…</div>';
  try {
    const r = await fetch(API_BASE + '/app/tea/random', { headers: authHeaders() });
    const d = await r.json();
    if (d.description){
      box.innerHTML = '<div class="fund-card"><div class="fund-text">' + d.description + '</div></div>';
    } else if (d.tea){
      box.innerHTML = '<div class="fund-card"><div class="fund-name">' + d.tea + ' + ' + (d.snack||'') + '</div></div>';
    }
  } catch(e){
    box.innerHTML = '<div class="panel-loading">泡茶失败</div>';
  }
}

/* ---- 日记 Diary ---- */
function closeDiaryPanel(){ _mlClose('diaryPanel'); }
function diaryTab(dtype){
  document.querySelectorAll('.diary-tab').forEach(t => t.classList.toggle('active', (t.dataset.dtype||'') === (dtype||'')));
  _loadDiary(dtype);
}
async function _loadDiary(dtype){
  const box = document.getElementById('diaryList');
  if (!box) return;
  try {
    const r = await fetch(API_BASE + '/app/diary/list' + (dtype ? '?type=' + encodeURIComponent(dtype) : ''), { headers: authHeaders() });
    const d = await r.json();
    const entries = d.entries || d.diaries || [];
    if (entries.length){
      box.innerHTML = entries.slice(0,20).map(e => '<div class="fund-card"><div class="fund-name">' + (e.title||'无题') + '</div><div class="fund-date">' + (e.created_at||'') + '</div></div>').join('');
    } else {
      box.innerHTML = '<div class="panel-loading">还没有日记，导入角色日记数据试试</div>';
    }
  } catch(e){
    box.innerHTML = '<div class="panel-loading">加载失败</div>';
  }
}
async function importDiaryData(file){
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const entries = Array.isArray(data) ? data : (data.entries || []);
    await fetch(API_BASE + '/app/diary/import', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify(entries)
    });
    _loadDiary('');
  } catch(e){
    alert('导入失败：' + (e.message || '格式错误'));
  }
}

/* ---- 备份 Backup ---- */
function closeBackupPanel(){ _mlClose('backupPanel'); }
async function exportBackup(){
  try {
    const r = await fetch(API_BASE + '/app/backup', { headers: authHeaders() });
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'moonlight_backup_' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch(e){
    alert('导出失败');
  }
}
function importBackup(inputEl){
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;
  file.text().then(text => {
    return fetch(API_BASE + '/app/restore', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: text
    });
  }).then(() => alert('导入完成')).catch(() => alert('导入失败'));
  inputEl.value = '';
}

/* ---- 聊天记录导出（只读导出，绝不碰库） ---- */
async function exportChat(mode){
  try {
    const r = await fetch(API_BASE + '/app/export/messages?mode=' + mode, { headers: authHeaders() });
    if (!r.ok) throw new Error('export ' + r.status);
    const blob = await r.blob();
    const cd = r.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/);
    const fname = m ? decodeURIComponent(m[1]) : ('moonlight-chat-' + mode + '.txt');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    a.click();
    URL.revokeObjectURL(url);
    const msgEl = document.getElementById('backupMsg');
    if (msgEl) msgEl.textContent = '已导出：' + fname;
  } catch(e){
    alert('导出失败');
  }
}

/* ---- 眼睛 Eye ---- */
function closeEyePanel(){ _mlClose('eyePanel'); }

/* ---- 其它 ---- */
function closeAllPanels(){
  document.querySelectorAll('.side-panel').forEach(p => {
    p.classList.add('hidden');
    p.setAttribute('aria-hidden','true');
  });
  stopCamera();
  // 新增：语音通话面板关闭 = 挂断，清理通话增强（InternalBeyond 同款收尾）
  try{
    if (typeof vcStopDuration === 'function') vcStopDuration();
    if (typeof vcStopSpeak === 'function') vcStopSpeak(true);
    if (typeof window.__vcCallSummary === 'function') window.__vcCallSummary('');   // 关面板也生成通话记录
  }catch(e){}
}
function toggleCtx(checked){
  try {
    window.ctxEnabled = !!checked;
    localStorage.setItem('moon_ctx', checked ? '1' : '0');
  } catch(e){}
}
async function loadMemSky(){
  const canvas = document.getElementById('memSkyCanvas');
  const list = document.getElementById('memSkyList');
  if (!canvas) return;
  canvas.innerHTML = '<div style="padding:20px;text-align:center;opacity:.5;font-size:12px;">星图加载中…</div>';
  try {
    const r = await fetch(API_BASE + '/app/memories/sky', { headers: authHeaders() });
    const d = await r.json();
    const mems = d.memories || [];
    // 星空：随机布点，importance高更亮更大
    canvas.innerHTML = '';
    mems.forEach(function(m, i){
      const star = document.createElement('div');
      const size = 6 + (m.importance||5) * 1.2;
      const x = m.x != null ? m.x * 100 : (i * 37 % 100);
      const y = m.y != null ? m.y * 100 : (i * 53 % 80 + 10);
      star.style.cssText = 'position:absolute;width:'+size+'px;height:'+size+'px;border-radius:50%;'+
        'left:'+x+'%;top:'+y+'%;'+
        'background:radial-gradient(circle,#fff6e0,rgba(189,160,111,.6));'+
        'box-shadow:0 0 '+(size)+'px rgba(212,154,86,.8);cursor:pointer;'+
        'animation:twinkle 3s '+(i%5)*0.6+'s ease-in-out infinite alternate;';
      star.title = (m.content||'').slice(0,60);
      star.onclick = function(){
        list.innerHTML = '<div class="fund-card" style="margin-top:10px;"><div class="fund-name">记忆 #'+m.id+'</div><div style="font-size:12px;opacity:.7;line-height:1.6;white-space:pre-wrap;">'+(m.content||'').slice(0,200)+'</div></div>';
      };
      canvas.appendChild(star);
    });
    if (!mems.length){
      canvas.innerHTML = '<div style="padding:20px;text-align:center;opacity:.5;font-size:12px;">星空还是空的，存一条记忆吧</div>';
    }
    // twinkle动画
    if (!document.getElementById('twinkleStyle')){
      const st = document.createElement('style'); st.id='twinkleStyle';
      st.textContent = '@keyframes twinkle{from{opacity:.5;transform:scale(.9)}to{opacity:1;transform:scale(1.1)}}';
      document.head.appendChild(st);
    }
  } catch(e){
    canvas.innerHTML = '<div style="padding:20px;text-align:center;opacity:.5;">星图加载失败</div>';
  }
}
