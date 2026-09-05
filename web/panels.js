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

/* ---- 书信 Letters ---- */
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
      body: JSON.stringify({ text: text })
    });
    const d = await r.json();
    if (box) box.innerHTML = '<div class="panel-loading">信已寄出，等安念回信…</div>';
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
    const r = await fetch(API_BASE + '/app/circle/list', { headers: authHeaders() });
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
    const r = await fetch(API_BASE + '/app/backup/export', { headers: authHeaders() });
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
    return fetch(API_BASE + '/app/backup/import', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: text
    });
  }).then(() => alert('导入完成')).catch(() => alert('导入失败'));
  inputEl.value = '';
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
}
function toggleCtx(checked){
  try {
    window.ctxEnabled = !!checked;
    localStorage.setItem('moon_ctx', checked ? '1' : '0');
  } catch(e){}
}