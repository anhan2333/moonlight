/* ════════════ 角色卡选择器（照Operit：点peerName弹出卡片面板）════════════
   卡片列表：安涵小窝(群组·三人) / 日常安念 / 工作安念
   点击切换 activeApiSession 并重载 */
(function(){
  var CARDS = [
    { id: 'group',   name: '安涵小窝', avatar: '🏡', sub: '群组 · 薇薇+日常+工作', color: '#c17355' },
    { id: 'daily',   name: '日常安念', avatar: '🌿', sub: '单人 · 陪薇薇聊天', color: '#8a9b6e' },
    { id: 'work',    name: '工作安念', avatar: '⚙️', sub: '单人 · 项目施工汇报', color: '#bda06f' },
  ];
  var KEY = 'moon_active_window';

  function getActive(){ try{ return localStorage.getItem(KEY) || 'daily'; }catch(e){ return 'daily'; } }

  function showPanel(){
    var old = document.getElementById('moonCardPanel');
    if (old){ old.remove(); return; }
    var active = getActive();
    var p = document.createElement('div');
    p.id = 'moonCardPanel';
    p.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:420;'+
      'width:min(90vw,360px);max-height:70vh;overflow-y:auto;'+
      'background:var(--card-bg,rgba(26,22,18,.92));border:1px solid var(--hairline,rgba(193,154,86,.3));'+
      'border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.5);'+
      'backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);padding:6px;';
    var html = '<div style="padding:12px 14px 6px;display:flex;justify-content:space-between;align-items:center;">'+
      '<span style="font-size:15px;font-weight:600;color:var(--text,#f3e6cd);">选择角色 / 窗口</span>'+
      '<span style="font-size:11px;opacity:.5;color:var(--text,#f3e6cd);">'+CARDS.length+'</span></div>';
    CARDS.forEach(function(c){
      var isA = c.id === active;
      html += '<div class="moon-card-item" data-id="'+c.id+'" style="display:flex;align-items:center;gap:12px;padding:13px 14px;margin:4px;'+
        'border-radius:14px;cursor:pointer;'+
        (isA ? 'background:rgba(193,154,86,.15);border:1px solid rgba(193,154,86,.35);' : 'border:1px solid transparent;')+'">'+
        '<span style="width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font-size:22px;'+
        'background:radial-gradient(circle at 36% 30%, rgba(193,154,86,.25), rgba(0,0,0,.3));border:1px solid '+c.color+';">'+c.avatar+'</span>'+
        '<div style="flex:1;min-width:0;">'+
        '<div style="font-size:15px;color:var(--text,#f3e6cd);'+(isA?'font-weight:600;':'')+'">'+c.name+(isA?' <span style="color:var(--accent,#c19a56);font-size:12px;">✓</span>':'')+'</div>'+
        '<div style="font-size:11px;opacity:.55;color:var(--text,#f3e6cd);">'+c.sub+'</div>'+
        '</div></div>';
    });
    p.innerHTML = html;
    document.body.appendChild(p);
    setTimeout(function(){
      document.addEventListener('click', function _h(ev){
        if (!p.contains(ev.target)){
          p.remove();
          document.removeEventListener('click', _h);
        }
      });
    }, 60);
    p.querySelectorAll('.moon-card-item').forEach(function(item){
      item.addEventListener('click', function(){
        var id = item.dataset.id;
        try{ localStorage.setItem(KEY, id); }catch(e){}
        try{
          localStorage.setItem('companion_session_pick', id);
          if (typeof activateSession === 'function') activateSession(id);
        }catch(e){}
        p.remove();
        setTimeout(function(){ location.reload(); }, 300);
      });
    });
  }

  function mount(){
    // 点击聊天顶栏的 peerName（安念名字）弹卡
    var pn = document.getElementById('peerName');
    if (pn && !pn.dataset.cardBound){
      pn.dataset.cardBound = '1';
      pn.style.cursor = 'pointer';
      pn.title = '点击切换角色/窗口';
      pn.addEventListener('click', function(e){ e.stopPropagation(); showPanel(); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  window.addEventListener('load', mount);
})();