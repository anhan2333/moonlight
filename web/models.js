async function openModelsPanel(){
  const p = document.getElementById('modelsPanel');
  if (!p) return;
  p.classList.remove('hidden');
  p.setAttribute('aria-hidden', 'false');
  await loadModels();
}

function closeModelsPanel(){
  const p = document.getElementById('modelsPanel');
  if (!p) return;
  p.classList.add('hidden');
  p.setAttribute('aria-hidden', 'true');
}

async function loadModels(){
  const cfgBox = document.getElementById('modelsConfigList');
  const bindBox = document.getElementById('modelsBindList');
  if (!cfgBox || !bindBox) return;
  cfgBox.innerHTML = '<div class="panel-loading">加载中…</div>';
  try {
    const r = await fetch(API_BASE + '/app/models/list', { headers: authHeaders() });
    const data = await r.json();
    window._modelsData = data;
    // 渲染模型配置列表
    if (!data.configs || !data.configs.length){
      cfgBox.innerHTML = '<div class="panel-loading">还没有模型配置，下面添加一个</div>';
    } else {
      let html = '';
      data.configs.forEach(c => {
        const def = c.is_default ? ' ⭐' : '';
        html += '<div class="model-card" id="mc_' + c.id + '">' +
          '<div class="model-name">' + c.name + def + '</div>' +
          '<div class="model-info">' + (c.model || '') + '</div>' +
          '<div class="model-info" style="font-size:11px;opacity:.5;">' + (c.endpoint || '') + '</div>' +
          '<div class="model-actions">' +
          '<button onclick="editModel(' + c.id + ')">编辑</button>' +
          (c.is_default ? '' : '<button onclick="setDefaultModel(' + c.id + ')">设为默认</button>') +
          '<button class="danger" onclick="delModel(' + c.id + ')">删</button>' +
          '</div></div>';
      });
      cfgBox.innerHTML = html;
    }
    // 渲染功能绑定列表
    const labels = data.labels || {};
    const binds = data.bindings || {};
    let bhtml = '';
    Object.keys(labels).forEach(func => {
      const curId = binds[func] || 0;
      const opts = '<option value="0">默认配置</option>' + (data.configs||[]).map(c =>
        '<option value="' + c.id + '"' + (c.id === curId ? ' selected' : '') + '>' + c.name + '</option>'
      ).join('');
      bhtml += '<div class="bind-row">' +
        '<span class="bind-label">' + labels[func] + '</span>' +
        '<select class="bind-select" data-func="' + func + '" onchange="bindModel(\'' + func + '\', this.value)">' + opts + '</select>' +
      '</div>';
    });
    bindBox.innerHTML = bhtml;
  } catch(e){
    cfgBox.innerHTML = '<div class="panel-loading">加载失败</div>';
  }
}


async function editModel(id){
  const data = window._modelsData || {configs:[]};
  const c = (data.configs||[]).find(x => x.id === id);
  if (!c) return;
  const old = document.getElementById('modelEditOverlay'); if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'modelEditOverlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;';
  const box = document.createElement('div');
  box.style.cssText = 'width:min(94vw,520px);max-height:85vh;overflow-y:auto;background:var(--bg,#0a0806);border:1px solid var(--hairline);border-radius:18px;padding:16px;';
  const esc = s => (s||'').replace(/"/g, '"');
  box.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
    '<strong style="color:var(--text);font-size:16px;">编辑：' + c.name + '</strong>' +
    '<button data-close="1" style="background:none;border:none;color:var(--text-soft);font-size:24px;cursor:pointer;">×</button></div>' +
    '<label style="font-size:11px;opacity:.6;display:block;margin:8px 0 4px;">名称</label>' +
    '<input id="emName" value="' + esc(c.name) + '" style="width:100%;padding:10px 12px;border:1px solid var(--field-line);border-radius:10px;background:var(--field-bg);color:var(--text);font-size:14px;">' +
    '<label style="font-size:11px;opacity:.6;display:block;margin:8px 0 4px;">API端点</label>' +
    '<input id="emEndpoint" value="' + esc(c.endpoint) + '" style="width:100%;padding:10px 12px;border:1px solid var(--field-line);border-radius:10px;background:var(--field-bg);color:var(--text);font-size:14px;">' +
    '<label style="font-size:11px;opacity:.6;display:block;margin:8px 0 4px;">API密钥</label>' +
    '<input id="emKey" type="password" value="' + esc(c.api_key) + '" style="width:100%;padding:10px 12px;border:1px solid var(--field-line);border-radius:10px;background:var(--field-bg);color:var(--text);font-size:14px;">' +
    '<label style="font-size:11px;opacity:.6;display:block;margin:8px 0 4px;">模型名</label>' +
    '<input id="emModel" value="' + esc(c.model) + '" style="width:100%;padding:10px 12px;border:1px solid var(--field-line);border-radius:10px;background:var(--field-bg);color:var(--text);font-size:14px;">' +
    '<div style="display:flex;gap:8px;margin-top:14px;">' +
    '<button onclick="saveModelEdit(' + c.id + ')" style="flex:1;padding:11px;border:none;border-radius:10px;background:linear-gradient(135deg,#c19a56,#a86b6b);color:#fff;font-size:14px;cursor:pointer;">保存修改</button>' +
    '<button onclick="testModelById(' + c.id + ')" style="flex:1;padding:11px;border:1px solid var(--accent);border-radius:10px;background:none;color:var(--accent);font-size:14px;cursor:pointer;">测试连接</button>' +
    '</div><div id="emTestResult" style="margin-top:8px;font-size:12px;"></div>';
  ov.appendChild(box);
  document.body.appendChild(ov);
  ov.addEventListener('click', function(e){ if (e.target === ov || (e.target.dataset && e.target.dataset.close)) ov.remove(); });
}

async function saveModelEdit(id){
  const name = document.getElementById('emName').value.trim();
  const endpoint = document.getElementById('emEndpoint').value.trim();
  const api_key = document.getElementById('emKey').value.trim();
  const model = document.getElementById('emModel').value.trim();
  if (!name || !endpoint || !model){ alert('名称/端点/模型名必填'); return; }
  try {
    await fetch(API_BASE + '/app/models/update/' + id, {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify({ name: name, endpoint: endpoint, api_key: api_key, model: model })
    });
    document.getElementById('modelEditOverlay').remove();
    await loadModels();
    if (window.showToast) showToast('已保存');
  } catch(e){ alert('保存失败'); }
}

async function testModelById(id){
  const data = window._modelsData || {configs:[]};
  const c = (data.configs||[]).find(x => x.id === id);
  if (!c) return;
  const box = document.getElementById('emTestResult');
  box.innerHTML = '测试中…';
  try {
    const r = await fetch(API_BASE + '/app/settings/test_model', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify({ endpoint: c.endpoint, api_key: c.api_key, model: c.model })
    });
    const d = await r.json();
    box.innerHTML = d.ok
      ? '<span style="color:#8a9b6e;">✓ 连接成功：' + (d.reply || 'ok') + '</span>'
      : '<span style="color:#c0533f;">✗ 失败：' + (d.error || '未知') + '</span>';
  } catch(e){ box.innerHTML = '<span style="color:#c0533f;">✗ 网络错误</span>'; }
}

async function addModel(){
  const name = (document.getElementById('mName')||{}).value || '';
  const endpoint = (document.getElementById('mEndpoint')||{}).value || '';
  const apiKey = (document.getElementById('mApiKey')||{}).value || '';
  const model = (document.getElementById('mModel')||{}).value || '';
  const isDefault = document.getElementById('mDefault') ? document.getElementById('mDefault').checked : false;
  if (!name || !endpoint || !model){ alert('名称/端点/模型名必填'); return; }
  try {
    await fetch(API_BASE + '/app/models/add', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify({ name, endpoint, api_key: apiKey, model, is_default: isDefault })
    });
    document.getElementById('mName').value='';
    document.getElementById('mEndpoint').value='';
    document.getElementById('mApiKey').value='';
    document.getElementById('mModel').value='';
    await loadModels();
  } catch(e){ alert('添加失败'); }
}

async function setDefaultModel(id){
  try {
    await fetch(API_BASE + '/app/models/update/' + id, {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify({ is_default: 1 })
    });
    await loadModels();
  } catch(e){}
}

async function delModel(id){
  if (!confirm('删除这个模型配置？相关功能会回退到默认。')) return;
  try {
    await fetch(API_BASE + '/app/models/' + id, { method: 'DELETE', headers: authHeaders() });
    await loadModels();
  } catch(e){}
}

async function bindModel(func, configId){
  try {
    await fetch(API_BASE + '/app/models/bind', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify({ func, config_id: parseInt(configId) })
    });
  } catch(e){}
}

async function testModel(){
  const box = document.getElementById('mTestResult');
  if (!box) return;
  box.innerHTML = '<div class="panel-loading">测试中…</div>';
  try {
    const r = await fetch(API_BASE + '/app/models/resolve?func=chat', { headers: authHeaders() });
    const data = await r.json();
    if (data.config){
      box.innerHTML = '<div class="model-test-ok">✓ 对话功能当前绑定：' + data.config.name + '（' + data.config.model + '）</div>';
    } else {
      box.innerHTML = '<div class="model-test-err">未找到配置</div>';
    }
  } catch(e){
    box.innerHTML = '<div class="model-test-err">测试失败</div>';
  }
}

async function saveDrawConfig(){
  const g = id => (document.getElementById(id)||{}).value || '';
  try {
    await fetch(API_BASE + '/app/config/set', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify({
        draw_endpoint: g('drawEndpoint'),
        draw_api_key: g('drawApiKey'),
        draw_model: g('drawModel')
      })
    });
    alert('生图配置已保存');
  } catch(e){ alert('保存失败'); }
}
