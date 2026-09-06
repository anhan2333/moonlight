/* ════════════ 窗口切换器（移植自Operit CharacterSelectorPanel）════════════
   双角色卡：日常安念(🌿) / 工作安念(⚙️)，顶部下拉切换，localStorage记住 */
(function(){
  var CARDS = [
    { id: 'daily',  name: '日常安念', avatar: '🌿', desc: '陪薇薇聊天 · 日常', color: '#8a9b6e' },
    { id: 'work',   name: '工作安念', avatar: '⚙️', desc: '项目汇报 · 施工', color: '#bda06f' },
  ];
  var KEY = 'moon_active_window';

  function getActive(){ try{ return localStorage.getItem(KEY) || 'daily'; }catch(e){ return 'daily'; } }
  function setActive(id){ try{ localStorage.setItem(KEY, id); }catch(e){} }

  // 应用当前激活卡：改标题栏名字+聊天室sender
  function applyCard(id){
    var card = CARDS.find(function(c){ return c.id === id; }) || CARDS[0];
    window.MOON_ACTIVE_CARD = card;
    // 聊天室发送时用这个身份
    try{ localStorage.setItem('moon_chatroom_sender', id === 'work' ? 'anian_work' : 'anian_daily'); }catch(e){}
    // 更新切换按钮上的显示
    var btn = document.getElementById('moonWinBtn');
    if (btn) btn.innerHTML = card.avatar + ' <span style="font-size:11px">' + card.name + '</span>';
  }

  // 下拉面板
  function togglePanel(){
    var p = document.getElementById('moonWinPanel');
    if (p){ p.remove(); return; }
    var active = getActive();
    var panel = document.createElement('div');
    panel.id = 'moonWinPanel';
    panel.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:400;'+
      'width:min(88vw,340px);background:var(--card-bg,#1a1612);border:1px solid var(--hairline,#c19a5638);'+
      'border-radius:16px;box-shadow:0 16px 40px rgba(0,0,0,.4);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);overflow:hidden;';
    var html = '<div style="padding:14px 16px 8px;display:flex;justify-content:space-between;align-items:center;">'+
      '<span style="font-size:14px;font-weight:600;color:var(--text,#f3e6cd);">选择窗口</span>'+
      '<span style="font-size:11px;opacity:.5;color:var(--text,#f3e6cd);">' + CARDS.length + ' 个</span></div>';
    CARDS.forEach(function(c){
      var active_ = c.id === active;
      html += '<div class="moon-win-item" data-id="'+c.id+'" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;'+
        (active_ ? 'background:rgba(193,154,86,.12);' : '') + 'border-top:1px solid var(--hairline,rgba(193,154,86,.15));">'+
        '<span style="font-size:22px;">'+c.avatar+'</span>'+
        '<div style="flex:1;">'+
        '<div style="font-size:14px;color:var(--text,#f3e6cd);'+(active_?'font-weight:600;':'')+'">'+c.name+(active_?' <span style="color:var(--accent,#c19a56);font-size:12px;">✓</span>':'')+'</div>'+
        '<div style="font-size:11px;opacity:.55;color:var(--text,#f3e6cd);">'+c.desc+'</div>'+
        '</div></div>';
    });
    panel.innerHTML = html;
    document.body.appendChild(panel);
    // 点击外部关闭
    setTimeout(function(){
      document.addEventListener('click', function _h(ev){
        if (!panel.contains(ev.target) && ev.target.id !== 'moonWinBtn'){
          panel.remove();
          document.removeEventListener('click', _h);
        }
      });
    }, 50);
    // 选择
    panel.querySelectorAll('.moon-win-item').forEach(function(item){
      item.addEventListener('click', function(){
        setActive(item.dataset.id);
        applyCard(item.dataset.id);
        panel.remove();
        try{ showToast && showToast('已切换到「' + CARDS.find(function(c){return c.id===item.dataset.id}).name + '」'); }catch(e){}
      });
    });
  }

  // 挂到聊天头部（菜单按钮旁）
  function mount(){
    var btn = document.createElement('button');
    btn.id = 'moonWinBtn';
    btn.title = '切换窗口（日常/工作）';
    btn.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top) + 8px);right:12px;z-index:300;'+
      'background:rgba(193,154,86,.15);border:1px solid rgba(193,154,86,.35);border-radius:99px;'+
      'padding:5px 12px;cursor:pointer;font-size:16px;display:flex;align-items:center;gap:4px;color:var(--text,#f3e6cd);';
    btn.onclick = function(e){ e.stopPropagation(); togglePanel(); };
    document.body.appendChild(btn);
    applyCard(getActive());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();