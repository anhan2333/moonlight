/* ════════════ 悬浮球小窗（照Operit FloatingChatWindow）════════════
   点球→展开小聊天窗：消息列表+输入框+发送（走/app/send）→再点球收起 */
(function(){
  var open = false;
  var win = null;

  function createWin(){
    win = document.createElement('div');
    win.id = 'moonBallWin';
    win.style.cssText = 'position:fixed;z-index:340;width:min(88vw,340px);height:min(60vh,440px);'+
      'left:'+(window.innerWidth-360)+'px;top:'+(window.innerHeight*0.3)+'px;'+
      'background:var(--card-bg,rgba(26,22,18,.95));border:1px solid var(--hairline,rgba(193,154,86,.35));'+
      'border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,.55);'+
      'backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);display:flex;flex-direction:column;overflow:hidden;';
    win.innerHTML =
      '<div style="padding:10px 14px;border-bottom:1px solid var(--hairline,rgba(193,154,86,.2));display:flex;align-items:center;justify-content:space-between;">'+
        '<span style="font-style:italic;font-size:14px;letter-spacing:1px;color:var(--accent,#c19a56);">安念 · 小窗</span>'+
        '<button id="mbwClose" style="background:none;border:none;color:var(--text-soft);font-size:20px;cursor:pointer;">×</button>'+
      '</div>'+
      '<div id="mbwMsgs" style="flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px;"></div>'+
      '<div style="padding:8px 10px;border-top:1px solid var(--hairline,rgba(193,154,86,.2));display:flex;gap:8px;">'+
        '<input id="mbwInput" placeholder="说点什么…" style="flex:1;padding:9px 12px;border:1px solid var(--field-line,rgba(193,154,86,.25));border-radius:12px;background:var(--field-bg,rgba(26,22,18,.8));color:var(--text,#f3e6cd);font-size:14px;">'+
        '<button id="mbwSend" style="padding:8px 14px;border:none;border-radius:12px;background:linear-gradient(135deg,#c19a56,#a86b6b);color:#fff;font-size:13px;cursor:pointer;">发</button>'+
      '</div>';
    document.body.appendChild(win);
    // 可拖动（标题栏）
    var bar = win.firstChild;
    var sx=0, sy=0, ox=0, oy=0, drag=false;
    bar.addEventListener('pointerdown', function(e){ drag=true; sx=e.clientX-win.offsetLeft; sy=e.clientY-win.offsetTop; bar.setPointerCapture(e.pointerId); });
    bar.addEventListener('pointermove', function(e){ if(drag){ win.style.left=(e.clientX-sx)+'px'; win.style.top=(e.clientY-sy)+'px'; } });
    bar.addEventListener('pointerup', function(){ drag=false; });
    win.querySelector('#mbwClose').onclick = function(){ close(); };
    win.querySelector('#mbwSend').onclick = send;
    win.querySelector('#mbwInput').addEventListener('keydown', function(e){ if(e.key==='Enter') send(); });
    loadMsgs();
  }

  function loadMsgs(){
    var box = win.querySelector('#mbwMsgs');
    var secret = localStorage.getItem('companion_secret') || '';
    fetch('/app/history?limit=30', { headers: { 'Authorization': 'Bearer ' + secret } })
      .then(function(r){ return r.json(); })
      .then(function(d){
        (d.messages||[]).slice(-20).forEach(function(m){
          var b = document.createElement('div');
          var mine = (m.direction === 'human');
          b.style.cssText = 'max-width:80%;padding:8px 12px;border-radius:14px;font-size:13px;line-height:1.5;'+
            (mine ? 'align-self:flex-end;background:rgba(193,154,86,.18);color:var(--text,#f3e6cd);'
                  : 'align-self:flex-start;background:rgba(255,255,255,.06);color:var(--text,#f3e6cd);');
          b.textContent = m.text || '';
          box.appendChild(b);
        });
        box.scrollTop = box.scrollHeight;
      }).catch(function(){});
  }

  function send(){
    var inp = win.querySelector('#mbwInput');
    var text = inp.value.trim(); if (!text) return;
    inp.value = '';
    var secret = localStorage.getItem('companion_secret') || '';
    var box = win.querySelector('#mbwMsgs');
    var b = document.createElement('div');
    b.style.cssText = 'align-self:flex-end;max-width:80%;padding:8px 12px;border-radius:14px;background:rgba(193,154,86,.18);font-size:13px;';
    b.textContent = text; box.appendChild(b); box.scrollTop = box.scrollHeight;
    fetch('/app/send', {
      method: 'POST',
      headers: Object.assign({ 'Authorization': 'Bearer ' + secret }, {'Content-Type': 'application/json'}),
      body: JSON.stringify({ text: text })
    }).catch(function(){});
  }

  function close(){ if (win){ win.remove(); win = null; } open = false; }

  function toggle(){
    if (open){ close(); } else { createWin(); open = true; }
  }

  // 暴露给悬浮球调用
  window.MoonBallChat = { toggle: toggle, close: close };
})();
