/* ════════════ 窗口切换器v3（会话真隔离）════════════
   核心思路：每个窗口 = 一个独立 session_id（daily/work）。
   切换时改 activeApiSession → 历史查询自动带上 session_id 过滤，
   消息发送也带同个 session_id → 日常/工作两窗口消息完全隔离。 */
(function(){
  var CARDS = [
    { id: 'daily', name: '日常安念', avatar: '🌿', desc: '陪薇薇 · 日常聊天', color: '#8a9b6e' },
    { id: 'work',  name: '工作安念', avatar: '⚙️', desc: '项目 · 施工汇报', color: '#bda06f' },
  ];
  var KEY = 'moon_active_window';
  function getActive(){ try{ return localStorage.getItem(KEY) || 'daily'; }catch(e){ return 'daily'; } }
  function setActive(id){ try{ localStorage.setItem(KEY, id); }catch(e){} }

  function applyCard(id){
    var card = CARDS.find(function(c){ return c.id === id; }) || CARDS[0];
    window.MOON_ACTIVE_CARD = card;
    try{ localStorage.setItem('moon_chatroom_sender', id === 'work' ? 'anian_work' : 'anian_daily'); }catch(e){}
    var btn = document.getElementById('moonWinBtn');
    if (btn) btn.textContent = card.avatar;
  }

  function mountInMenu(){
    var menu = document.querySelector('.menu-list') || document.querySelector('.menu-scroll');
    if (!menu || document.getElementById('moonWinPanelMenu')) return;
    var panel = document.createElement('div');
    panel.id = 'moonWinPanelMenu';
    panel.style.cssText = 'margin:0 0 14px;padding:12px;border:1px solid var(--hairline,rgba(193,154,86,.2));'+
      'border-radius:14px;background:var(--card-bg,rgba(26,22,18,.5));';
    var active = getActive();
    var html = '<div style="font-size:12px;letter-spacing:2px;color:var(--accent,#bda06f);margin-bottom:10px;font-style:italic;">WINDOWS · 窗口</div>';
    CARDS.forEach(function(c){
      var isA = c.id === active;
      html += '<div class="moon-win-item" data-id="'+c.id+'" style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;cursor:pointer;'+
        (isA ? 'background:rgba(193,154,86,.15);border:1px solid rgba(193,154,86,.3);' : 'border:1px solid transparent;')+'margin-bottom:6px;">'+
        '<span style="font-size:20px;">'+c.avatar+'</span>'+
        '<div style="flex:1;">'+
        '<div style="font-size:14px;color:var(--text,#f3e6cd);'+(isA?'font-weight:600;':'')+'">'+c.name+(isA?' <span style="color:var(--accent,#bda06f);font-size:12px;">✓ 当前</span>':'')+'</div>'+
        '<div style="font-size:11px;opacity:.55;color:var(--text,#f3e6cd);">'+c.desc+'</div>'+
        '</div></div>';
    });
    html += '<div style="font-size:10px;opacity:.4;color:var(--text,#f3e6cd);margin-top:4px;">两个窗口的消息互相隔离，各有各的聊天记录</div>';
    panel.innerHTML = html;
    menu.parentNode.insertBefore(panel, menu);
    panel.querySelectorAll('.moon-win-item').forEach(function(item){
      item.addEventListener('click', function(){
        var id = item.dataset.id;
        if (id === getActive()) return; // 点当前的不动
        setActive(id);
        applyCard(id);
        // 切换 activeApiSession 让历史/发送都走对应会话
        try{
          localStorage.setItem('companion_session_pick', id);
          if (typeof activateSession === 'function') activateSession(id);
        }catch(e){}
        var mp = document.querySelector('.menu-panel');
        if (mp) mp.classList.remove('open');
        setTimeout(function(){ location.reload(); }, 350);
      });
    });
  }

  function mountFloatBtn(){
    if (document.getElementById('moonWinBtn')) return;
    var btn = document.createElement('button');
    btn.id = 'moonWinBtn';
    btn.title = '当前窗口 · 点开菜单切换';
    btn.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top) + 62px);right:10px;z-index:290;'+
      'width:34px;height:34px;border-radius:50%;background:rgba(193,154,86,.2);'+
      'border:1px solid rgba(193,154,86,.4);cursor:pointer;font-size:15px;display:grid;place-items:center;';
    btn.onclick = function(){
      var mp = document.querySelector('.menu-panel');
      if (mp){ mp.classList.add('open'); }
      setTimeout(function(){
        var p = document.getElementById('moonWinPanelMenu');
        if (p) p.scrollIntoView({behavior:'smooth', block:'center'});
      }, 400);
    };
    document.body.appendChild(btn);
    applyCard(getActive());
  }

  // 启动时：把后端 session 同步为当前窗口ID（让 history/send 自动过滤）
  function syncBackendSession(){
    var id = getActive();
    try{ localStorage.setItem('companion_session_pick', id); }catch(e){}
    // activateSession 在主script定义；等它可用后调用
    var tries = 0;
    (function wait(){
      if (typeof activateSession === 'function'){
        activateSession(id);
      } else if (++tries < 50){
        setTimeout(wait, 200);
      }
    })();
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ mountFloatBtn(); setTimeout(mountInMenu, 300); syncBackendSession(); });
  } else {
    mountFloatBtn(); setTimeout(mountInMenu, 300); syncBackendSession();
  }
})();