/* ════════════ Love基金监控 ════════════ */
async function openFundPanel(){
  const p = document.getElementById('fundPanel');
  if (!p) return;
  p.classList.remove('hidden');
  p.setAttribute('aria-hidden', 'false');
  await loadFundOverview();
}

function closeFundPanel(){
  const p = document.getElementById('fundPanel');
  if (!p) return;
  p.classList.add('hidden');
  p.setAttribute('aria-hidden', 'true');
}

async function loadFundOverview(){
  const box = document.getElementById('fundList');
  if (!box) return;
  box.innerHTML = '<div class="panel-loading">拉取净值中…</div>';
  try {
    const r = await fetch(API_BASE + '/app/fund/overview', { headers: authHeaders() });
    const data = await r.json();
    if (!data.holdings || !data.holdings.length){
      box.innerHTML = '<div class="panel-loading">暂无持仓，下面添加</div>';
      return;
    }
    let html = '';
    data.holdings.forEach(h => {
      const up = (h.day_pct||0) >= 0;
      const color = up ? '#c05640' : '#5a8a5a';
      const arrow = up ? '↑' : '↓';
      const profitHtml = (h.shares && h.cost) ? (
        '<div class="fund-profit" style="color:' + ((h.profit||0)>=0 ? '#c05640' : '#5a8a5a') + '">' +
        ((h.profit||0)>=0 ? '+' : '') + (h.profit||0).toFixed(2) + '元 (' + (h.profit_pct||0).toFixed(2) + '%)</div>'
      ) : '';
      html += '<div class="fund-card">' +
        '<div class="fund-name">' + (h.name || h.code) + ' <span class="fund-code">' + h.code + '</span></div>' +
        '<div class="fund-nav">¥ ' + (h.nav||0).toFixed(4) + ' <span style="color:' + color + '">' + arrow + ' ' + Math.abs(h.day_pct||0).toFixed(2) + '%</span></div>' +
        '<div class="fund-date">净值日期 ' + (h.date || '-') + (h.note ? ' · ' + h.note : '') + '</div>' +
        profitHtml +
        '<button class="fund-del" onclick="delFund(' + h.id + ')">删除</button>' +
      '</div>';
    });
    const tp = data.total_profit || 0;
    html = '<div class="fund-total" style="color:' + (tp>=0 ? '#c05640' : '#5a8a5a') + '">合计盈亏：' + (tp>=0?'+':'') + tp.toFixed(2) + ' 元</div>' + html;
    box.innerHTML = html;
  } catch(e){
    box.innerHTML = '<div class="panel-loading">加载失败：网络或后端未启动</div>';
  }
}

async function addFund(){
  const code = (document.getElementById('fundCodeInput')||{}).value || '';
  const shares = parseFloat((document.getElementById('fundSharesInput')||{}).value || '0');
  const cost = parseFloat((document.getElementById('fundCostInput')||{}).value || '0');
  const note = (document.getElementById('fundNoteInput')||{}).value || '';
  if (!code.trim()) { alert('请填基金代码'); return; }
  try {
    await fetch(API_BASE + '/app/fund/holdings', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify({ code: code.trim(), shares, cost, note })
    });
    document.getElementById('fundCodeInput').value = '';
    await loadFundOverview();
  } catch(e){ alert('添加失败'); }
}

async function delFund(id){
  if (!confirm('删除这个持仓？')) return;
  try {
    await fetch(API_BASE + '/app/fund/holdings/' + id, { method: 'DELETE', headers: authHeaders() });
    await loadFundOverview();
  } catch(e){}
}

async function searchFund(){
  const k = (document.getElementById('fundSearchInput')||{}).value || '';
  const box = document.getElementById('fundSearchResult');
  if (!k.trim()){ box.innerHTML = ''; return; }
  try {
    const r = await fetch(API_BASE + '/app/fund/search?k=' + encodeURIComponent(k), { headers: authHeaders() });
    const data = await r.json();
    if (data.results && data.results.length){
      box.innerHTML = data.results.map(x => '<div class="fund-search-item" onclick="pickFund(\'' + x.code + '\', \'' + (x.name||'').replace(/'/g,'') + '\')">' + x.code + ' · ' + x.name + '</div>').join('');
    } else { box.innerHTML = '<div class="fund-search-item">没有找到</div>'; }
  } catch(e){ box.innerHTML = ''; }
}

function pickFund(code, name){
  document.getElementById('fundCodeInput').value = code;
  document.getElementById('fundSearchResult').innerHTML = '<div class="fund-search-item">已选：' + name + '</div>';
}
