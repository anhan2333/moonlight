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
        html += '<div class="model-card">' +
          '<div class="model-name">' + c.name + def + '</div>' +
          '<div class="model-info">' + (c.model || '') + ' · ' + (c.endpoint || '') + '</div>' +
          '<div class="model-actions">' +
          (c.is_default ? '' : '<button onclick="setDefaultModel(' + c.id + ')">设为默认</button>') +
          '<button onclick="delModel(' + c.id + ')">删</button>' +
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
