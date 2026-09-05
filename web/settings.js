/* ════════════ 设置面板（通用设置+通用配置+语音配置）════════════ */
async function openSettingsPanel(){
  const p = document.getElementById('settingsPanel');
  if (!p) return;
  p.classList.remove('hidden');
  p.setAttribute('aria-hidden','false');
  try {
    document.getElementById('setName').value = localStorage.getItem('moon_name') || '';
    document.getElementById('setWelcome').value = localStorage.getItem('moon_welcome') || '';
  } catch(e){}
}

function closeSettingsPanel(){
  const p = document.getElementById('settingsPanel');
  if (!p) return;
  p.classList.add('hidden');
  p.setAttribute('aria-hidden','true');
}

function saveSettings(){
  try {
    const name = (document.getElementById('setName')||{}).value || '';
    const welcome = (document.getElementById('setWelcome')||{}).value || '';
    if (name) localStorage.setItem('moon_name', name);
    if (welcome) localStorage.setItem('moon_welcome', welcome);
    alert('设置已保存（浏览器本地）');
  } catch(e){ alert('保存失败'); }
}

/* ---- 通用配置（key-value，宝宝自己填） ---- */
async function loadGeneralConfig(){
  const box = document.getElementById('gcList');
  if (!box) return;
  try {
    const r = await fetch(API_BASE + '/app/config/get', { headers: authHeaders() });
    const data = await r.json();
    const cfg = data.config || {};
    const keys = ['draw_endpoint','draw_api_key','draw_model','notify_target'];
    let html = '';
    keys.forEach(k => {
      html += '<div class="gc-row"><label>' + k + '</label>' +
        '<input id="gc_' + k + '" value="' + (cfg[k]||'').replace(/"/g,'"') + '" placeholder="待填写"></div>';
    });
    box.innerHTML = html;
  } catch(e){
    box.innerHTML = '<div class="panel-loading">加载失败</div>';
  }
}

async function saveGeneralConfig(){
  const body = {};
  ['draw_endpoint','draw_api_key','draw_model','notify_target'].forEach(k => {
    const el = document.getElementById('gc_' + k);
    if (el && el.value.trim()) body[k] = el.value.trim();
  });
  if (!Object.keys(body).length){ alert('没有填写任何内容'); return; }
  try {
    await fetch(API_BASE + '/app/config/set', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify(body)
    });
    alert('通用配置已保存');
  } catch(e){ alert('保存失败'); }
}

/* ---- 语音配置 ---- */
async function loadVoiceConfig(){
  try {
    const r = await fetch(API_BASE + '/app/voice/config', { headers: authHeaders() });
    const cfg = (await r.json()).config || {};
    const map = { 'vc_tts_key':'tts_api_key', 'vc_tts_voice':'tts_voice_id', 'vc_stt_key':'stt_api_key', 'vc_stt_model':'stt_model' };
    Object.keys(map).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = cfg[map[id]] || '';
    });
  } catch(e){}
}

async function saveVoiceConfig(){
  const body = {};
  const map = { 'vc_tts_key':'tts_api_key', 'vc_tts_voice':'tts_voice_id', 'vc_stt_key':'stt_api_key', 'vc_stt_model':'stt_model' };
  Object.keys(map).forEach(id => {
    const el = document.getElementById(id);
    if (el && el.value.trim()) body[map[id]] = el.value.trim();
  });
  if (!Object.keys(body).length){ alert('没有修改'); return; }
  try {
    await fetch(API_BASE + '/app/voice/config', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify(body)
    });
    alert('语音配置已保存');
  } catch(e){ alert('保存失败'); }
}
