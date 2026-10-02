/* ════════════ 底部导航栏（照Heather：首页/日常/记忆/设置）════════════
   固定在输入框下方，点击切换面板，不再被键盘挤飞 */
(function(){
  var TABS = [
    { id:'chat',    icon:'💬', label:'聊天' },
    { id:'memsky',  icon:'🌌', label:'记忆' },
    { id:'plugin',icon:'🧩', label:'插件' },
    { id:'models',  icon:'🤖', label:'模型' },
    { id:'settings',icon:'⚙️', label:'设置' },
  ];
  var KEY = 'moon_bottom_tab';

  function css(){
    var s = document.createElement('style');
    s.textContent = [
      '#moonBottomNav{position:fixed;left:0;right:0;bottom:0;z-index:300;',
      'display:flex;justify-content:space-around;align-items:stretch;',
      'background:var(--card-bg,rgba(26,22,18,.92));',
      'border-top:1px solid var(--hairline,rgba(193,154,86,.25));',
      'backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);',
      'padding:6px 4px calc(6px + env(safe-area-inset-bottom,0px));}',
      '#moonBottomNav .mbn-item{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;',
      'background:none;border:none;cursor:pointer;padding:4px 0;opacity:.55;transition:opacity .15s;}',
      '#moonBottomNav .mbn-item.active{opacity:1;}',
      '#moonBottomNav .mbn-item .ic{font-size:20px;line-height:1;}',
      '#moonBottomNav .mbn-item .lb{font-size:10px;color:var(--text,#f3e6cd);}',
      '#moonBottomNav .mbn-item.active .lb{color:var(--accent,#c19a56);font-weight:600;}',
      /* 聊天页为导航栏腾出空间 */
      'body.has-bottom-nav .composer{bottom:64px !important;}',
      'body.has-bottom-nav .scroll{padding-bottom:150px !important;}',
    ].join('');
    document.head.appendChild(s);
  }

  window.openPluginPanelFixed = openPluginPanelFixed;
  function openPluginPanelFixed(){
    var p = document.getElementById('pluginPanel');
    if (p){ p.classList.remove('hidden'); p.setAttribute('aria-hidden','false'); }
  }
  function openPanel(id){
    // 聊天 = 关掉所有面板回聊天
    if (id === 'chat'){
      document.querySelectorAll('.side-panel:not(.hidden)').forEach(function(p){
        var c = p.querySelector('.side-panel-close'); if (c) c.click();
      });
      return;
    }
    // 先关已开的
    document.querySelectorAll('.side-panel:not(.hidden)').forEach(function(p){
      var c = p.querySelector('.side-panel-close'); if (c) c.click();
    });
    if (id === 'plugin'){ setTimeout(openPluginPanelFixed, 80); return; }
    var fn = { memsky:'openMemSkyPanel', models:'openModelsPanel', settings:'openSettingsPanel' }[id];
    if (fn){ setTimeout(function(){ if (typeof window[fn] === 'function') window[fn](); }, 80); }
  }

  function mark(id){
    document.querySelectorAll('#moonBottomNav .mbn-item').forEach(function(b){
      b.classList.toggle('active', b.dataset.tab === id);
    });
    try{ localStorage.setItem(KEY, id); }catch(e){}
  }

  function mount(){
    if (document.getElementById('moonBottomNav')) return;
    css();
    var nav = document.createElement('nav');
    nav.id = 'moonBottomNav';
    TABS.forEach(function(t){
      var b = document.createElement('button');
      b.className = 'mbn-item';
      b.dataset.tab = t.id;
      b.innerHTML = '<span class="ic">'+t.icon+'</span><span class="lb">'+t.label+'</span>';
      b.addEventListener('click', function(){
        mark(t.id);
        openPanel(t.id);
      });
      nav.appendChild(b);
    });
    document.body.appendChild(nav);
    document.body.classList.add('has-bottom-nav');
    var last = 'chat';
    try{ last = localStorage.getItem(KEY) || 'chat'; }catch(e){}
    mark(last);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();