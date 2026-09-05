/* ════════════ 聊天室（群聊·工作窗口汇报共享）════════════ */
let chatroomLastId = 0;
let chatroomTimer = null;

async function openChatroomPanel(){
  const p = document.getElementById('chatroomPanel');
  if (!p) return;
  p.classList.remove('hidden');
  p.setAttribute('aria-hidden', 'false');
  await loadChatroom();
  if (chatroomTimer) clearInterval(chatroomTimer);
  chatroomTimer = setInterval(loadChatroom, 5000);
}

function closeChatroomPanel(){
  const p = document.getElementById('chatroomPanel');
  if (!p) return;
  p.classList.add('hidden');
  p.setAttribute('aria-hidden', 'true');
  if (chatroomTimer){ clearInterval(chatroomTimer); chatroomTimer = null; }
}

async function loadChatroom(){
  const box = document.getElementById('chatroomMsgs');
  if (!box) return;
  try {
    const r = await fetch(API_BASE + '/app/chatroom/messages?limit=60&after_id=' + chatroomLastId, { headers: authHeaders() });
    const data = await r.json();
    if (data.messages && data.messages.length){
      if (chatroomLastId === 0) box.innerHTML = '';
      data.messages.forEach(m => renderChatroomMsg(box, m));
      chatroomLastId = data.messages[data.messages.length-1].id;
      box.scrollTop = box.scrollHeight;
    } else if (chatroomLastId === 0){
      box.innerHTML = '<div class="panel-loading">聊天室是空的，说点什么吧</div>';
    }
  } catch(e){
    if (chatroomLastId === 0) box.innerHTML = '<div class="panel-loading">加载失败</div>';
  }
}

function renderChatroomMsg(box, m){
  const div = document.createElement('div');
  div.className = 'chatroom-msg chatroom-' + m.sender;
  const color = m.sender === 'weiwei' ? '#c17355' : (m.sender === 'anian_work' ? '#bda06f' : '#8a9a5b');
  const avatar = m.sender === 'weiwei' ? '🌙' : (m.sender === 'anian_work' ? '⚙️' : '🌿');
  const name = m.sender_name || m.sender;
  const t = document.createElement('div');
  t.className = 'chatroom-text';
  t.textContent = m.text;
  const head = document.createElement('div');
  head.className = 'chatroom-head';
  const nm = document.createElement('span');
  nm.style.color = color;
  nm.textContent = name;
  const tm = document.createElement('span');
  tm.className = 'chatroom-time';
  tm.textContent = m.created_at || '';
  head.appendChild(nm); head.appendChild(tm);
  const body = document.createElement('div');
  body.className = 'chatroom-body';
  body.appendChild(head); body.appendChild(t);
  const av = document.createElement('div');
  av.className = 'chatroom-avatar';
  av.style.borderColor = color;
  av.textContent = avatar;
  div.appendChild(av); div.appendChild(body);
  box.appendChild(div);
}

async function sendChatroom(){
  const inp = document.getElementById('chatroomInput');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;
  try {
    await fetch(API_BASE + '/app/chatroom/send', {
      method: 'POST',
      headers: Object.assign({}, authHeaders(), {'Content-Type': 'application/json'}),
      body: JSON.stringify({ sender: 'weiwei', text: text })
    });
    inp.value = '';
    await loadChatroom();
  } catch(e){}
}
