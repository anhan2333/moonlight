/* ════════════ 愿望池 ════════════ */
async function openWishPanel(){
  const p = document.getElementById('wishPanel');
  if (!p) return;
  p.classList.remove('hidden');
  p.setAttribute('aria-hidden', 'false');
  await loadWishes();
}

function closeWishPanel(){
  const p = document.getElementById('wishPanel');
  if (!p) return;
  p.classList.add('hidden');
  p.setAttribute('aria-hidden', 'true');
}

async function loadWishes(){
  const box = document.getElementById('wishList');
  if (!box) return;
  box.innerHTML = '<div class="panel-loading">加载中…</div>';
  try {
    const r = await fetch(API_BASE + '/app/wish/list', { headers: authHeaders() });
    const data = await r.json();
    if (!data.wishes || !data.wishes.length){
      box.innerHTML = '<div class="panel-loading">愿望池是空的…许一个吧</div>';
      return;
    }
    let html = '';
    data.wishes.forEach(w => {
      const active = w.status === 'active';
      html += '<div class="wish-card' + (active ? '' : ' wish-fulfilled') + '">' +
        '<div class="wish-text">' + (active ? '🌟 ' : '✅ ') + w.text + '</div>' +
        '<div class="wish-meta">' + (w.created_at || '') + (w.fulfilled_at ? ' → 实现 ' + w.fulfilled_at : '') + '</div>' +
        (active ? '<div class="wish-actions"><button onclick="fulfillWish(' + w.id + ')">实现啦</button><button onclick="delWish(' + w.id + ')">删</button></div>' : '') +
      '</div>';
    });
    box.innerHTML = html;
  } catch(e){
    box.innerHTML = '<div class="panel-loading">加载失败</div>';
  }
}

async function addWish(){
  const inp = document.getElementById('wishInput');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;
  try {
    await fetch(API_BASE + '/app/wish/add', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify({ text: text })
    });
    inp.value = '';
    await loadWishes();
  } catch(e){}
}

async function fulfillWish(id){
  try {
    await fetch(API_BASE + '/app/wish/fulfill/' + id, { method: 'POST', headers: authHeaders() });
    await loadWishes();
  } catch(e){}
}

async function delWish(id){
  if (!confirm('删掉这个愿望？')) return;
  try {
    await fetch(API_BASE + '/app/wish/' + id, { method: 'DELETE', headers: authHeaders() });
    await loadWishes();
  } catch(e){}
}

async function drawWish(){
  try {
    const r = await fetch(API_BASE + '/app/wish/draw', { method: 'POST', headers: authHeaders() });
    const data = await r.json();
    const box = document.getElementById('wishDrawResult');
    if (data.ok){
      box.innerHTML = '<div class="wish-draw">🌙 安念从池子里捞起了：<b>' + data.wish.text + '</b><br>这个交给老公，慢慢实现。</div>';
    } else {
      box.innerHTML = '<div class="wish-draw">' + data.message + '</div>';
    }
  } catch(e){}
}
