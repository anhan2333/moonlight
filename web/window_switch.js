/* ════════════ 窗口切换器v2（照Operit：菜单内置面板+会话隔离）════════════
   - 每个窗口独立的会话（localStorage按window隔离消息）
   - 菜单里内置"窗口"卡片面板（不遮挡），非悬浮窗
   - 右上角小圆点按钮，点击打开菜单并定位到面板 */
(function(){
  var CARDS = [
    { id: 'daily', name: '日常安念', avatar: '🌿', desc: '陪薇薇 · 日常聊天', color: '#8a9b6e' },
    { id: 'work',  name: '工作安念', avatar: '⚙️', desc: '项目 · 施工汇报', color: '#bda06f' },
  ];
  var KEY = 'moon_active_window';

  function getActive(){ try{ return localStorage.getItem(KEY) || 'daily'; }catch(e){ return 'daily'; } }
  function setActive(id){ try{ localStorage.setItem(KEY, id); }catch(e){} }

  function applyCard(id, skipReload){
    var card = CARDS.find(function(c){ return c.id === id; }) || CARDS[0];
    window.MOON_ACTIVE_CARD = card;
    try{ localStorage.setItem('moon_chatroom_sender', id === 'work' ? 'anian_work' : 'anian_daily'); }catch(e){}
    var btn = document.getElementById('moonWinBtn');
    if (btn) btn.textContent = card.avatar;
    if (!skipReload){
      try{ window.dispatchEvent(new CustomEvent('moonwindowchange', {detail:{card:card}})); }catch(e){}
    }
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
    panel.innerHTML = html;
    menu.parentNode.insertBefore(panel, menu);
    panel.querySelectorAll('.moon-win-item').forEach(function(item){
      item.addEventListener('click', function(){
        setActive(item.dataset.id);
        applyCard(item.dataset.id);
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
    applyCard(getActive(), true);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ mountFloatBtn(); setTimeout(mountInMenu, 300); });
  } else {
    mountFloatBtn(); setTimeout(mountInMenu, 300);
  }
})();