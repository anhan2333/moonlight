/* ════════════ 礼物系统 + AI生图 ════════════ */
const GIFT_DEFS = { heart:{name:'小心心',icon:'❤️',tier:1}, bouquet:{name:'花束',icon:'💐',tier:2}, firework:{name:'夏日烟火',icon:'🎆',tier:3}, meteor:{name:'流星雨',icon:'🌠',tier:4}, galaxy:{name:'银河铁道之夜',icon:'🚂',tier:5} };

async function openGiftPanel(){
  const p = document.getElementById('giftPanel');
  if (!p) return;
  p.classList.remove('hidden');
  p.setAttribute('aria-hidden','false');
  await loadGifts();
}

function closeGiftPanel(){
  const p = document.getElementById('giftPanel');
  if (!p) return;
  p.classList.add('hidden');
  p.setAttribute('aria-hidden','true');
}

async function loadGifts(){
  const box = document.getElementById('giftList');
  if (!box) return;
  try {
    const r = await fetch(API_BASE + '/app/gift/list', { headers: authHeaders() });
    const d = await r.json();
    const gifts = d.gifts || GIFT_DEFS;
    let html = '';
    Object.keys(gifts).forEach(id => {
      const g = gifts[id];
      html += '<div class="gift-item" onclick="sendGift(\'' + id + '\')">' +
        '<span class="gift-icon">' + g.icon + '</span>' +
        '<span class="gift-name">' + g.name + '</span>' +
        '<span class="gift-tier">T' + g.tier + '</span></div>';
    });
    html += '<div class="gift-draw-row">' +
      '<input id="giftDrawPrompt" type="text" placeholder="输入想画的画面，安念画给你…">' +
      '<button class="toy-connect-btn" onclick="drawGiftImg()">🎨 AI生图礼物</button></div>' +
      '<div id="giftDrawResult"></div>' +
      '<div class="gift-gallery" id="giftGallery"></div>';
    box.innerHTML = html;
    await loadGiftGallery();
  } catch(e){ box.innerHTML = '<div class="panel-loading">加载失败</div>'; }
}

async function sendGift(giftId){
  try {
    const r = await fetch(API_BASE + '/app/gift/send', {
      method:'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type':'application/json'}),
      body: JSON.stringify({ gift_id: giftId })
    });
    const d = await r.json();
    if (d.sent) playGiftEffect(d.gift);
  } catch(e){}
}

function playGiftEffect(g){
  const overlay = document.createElement('div');
  overlay.className = 'gift-overlay';
  overlay.onclick = () => overlay.remove();
  const title = document.createElement('div');
  title.className = 'gift-title';
  title.textContent = (g.icon||'') + ' ' + (g.name||'');
  overlay.appendChild(title);
  // 撒粒子
  const icons = ['❤️','✨','🌸','🌙','⭐','💛'];
  for(let i=0;i<36;i++){
    const sp = document.createElement('span');
    sp.className = 'gift-particle';
    sp.textContent = icons[i % icons.length];
    sp.style.left = (Math.random()*100) + '%';
    sp.style.top = (40 + Math.random()*40) + '%';
    sp.style.fontSize = (12 + Math.random()*24) + 'px';
    sp.style.animationDelay = (Math.random()*1.2) + 's';
    overlay.appendChild(sp);
  }
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 3000);
}

async function drawGiftImg(){
  const prompt = (document.getElementById('giftDrawPrompt')||{}).value || '';
  const box = document.getElementById('giftDrawResult');
  if (!prompt.trim()){ box.innerHTML = '<div class="model-test-err">先输入想画的画面</div>'; return; }
  box.innerHTML = '<div class="panel-loading">安念正在画…（可能需要10-30秒）</div>';
  try {
    const r = await fetch(API_BASE + '/app/gift/draw', {
      method:'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type':'application/json'}),
      body: JSON.stringify({ prompt: prompt })
    });
    const d = await r.json();
    if (d.ok && d.image_url){
      box.innerHTML = '<img src="' + d.image_url + '" style="max-width:100%;border-radius:12px;margin-top:10px;" alt="gift">';
      await loadGiftGallery();
    } else {
      box.innerHTML = '<div class="model-test-err">' + (d.error || '生图失败，请确认已配置生图模型') + '</div>';
    }
  } catch(e){
    box.innerHTML = '<div class="model-test-err">生图失败</div>';
  }
}

async function loadGiftGallery(){
  const box = document.getElementById('giftGallery');
  if (!box) return;
  try {
    const r = await fetch(API_BASE + '/app/gift/gallery', { headers: authHeaders() });
    const d = await r.json();
    if (d.images && d.images.length){
      box.innerHTML = '<div class="gift-gallery-title">🖼 画过的礼物</div>' + d.images.map(img =>
        '<img src="' + img + '" style="max-width:32%;border-radius:8px;margin:2px;" alt="gift">'
      ).join('');
    }
  } catch(e){}
}
