async function loadVoiceConfig(){
  const box = document.getElementById('voiceConfigBox');
  if (!box) return;
  try {
    const r = await fetch(API_BASE + '/app/voice/config', { headers: authHeaders() });
    const d = await r.json();
    const c = d.config || {};
    const f = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    f('vTtsApi', c.tts_api_url); f('vTtsKey', c.tts_api_key); f('vTtsVoice', c.tts_voice_id);
    f('vSttApi', c.stt_api_url); f('vSttKey', c.stt_api_key); f('vSttModel', c.stt_model);
  } catch(e){}
}
async function saveVoiceConfig(){
  const g = id => (document.getElementById(id)||{}).value || '';
  const body = {
    tts_api_url: g('vTtsApi'), tts_api_key: g('vTtsKey'), tts_voice_id: g('vTtsVoice'),
    stt_api_url: g('vSttApi'), stt_api_key: g('vSttKey'), stt_model: g('vSttModel')
  };
  try {
    await fetch(API_BASE + '/app/voice/config', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify(body)
    });
    alert('语音配置已保存');
  } catch(e){ alert('保存失败'); }
}
