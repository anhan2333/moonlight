/* ═══ 月光快捷上栏（Operit风）═══ */
(function(){
  var MAP = {
    memory:  function(){ var p=document.getElementById('memSkyPanel'); if(p){p.classList.remove('hidden');} },
    tools:   function(){ var p=document.getElementById('toyPanel'); if(p){p.classList.remove('hidden');} },
    plugins: function(){ if(typeof openPluginPanel==='function') openPluginPanel(); else { var p=document.getElementById('pluginPanel'); if(p)p.classList.remove('hidden'); } },
    window:  function(){ var mp=document.querySelector('.menu-panel'); if(mp){mp.classList.add('open');} setTimeout(function(){ var x=document.getElementById('moonWinPanelMenu'); if(x)x.scrollIntoView({behavior:'smooth',block:'center'}); },380); },
    voice:   function(){ if(typeof openVoicePanel==='function') openVoicePanel(); else { var p=document.getElementById('voicePanel'); if(p)p.classList.remove('hidden'); } }
  };
  document.addEventListener('click', function(e){
    var chip = e.target.closest('.mt-chip');
    if (!chip) return;
    var fn = MAP[chip.dataset.t];
    if (fn) fn();
  });
})();
