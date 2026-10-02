/* ═══ 用户资料面板（Operit风：编辑/预览/字符计数/保存）═══ */
function profileTab(t){
  document.querySelectorAll('.ptab').forEach(b => b.classList.toggle('active', b.dataset.ptab === t));
  const ed = document.getElementById('profileEdit');
  const pv = document.getElementById('profilePreview');
  if (t === 'preview'){
    pv.textContent = ed.value || '（还没有内容）';
    pv.classList.remove('hidden');
    ed.classList.add('hidden');
  } else {
    pv.classList.add('hidden');
    ed.classList.remove('hidden');
  }
}
async function saveProfile(){
  const v = document.getElementById('profileEdit').value;
  try{
    localStorage.setItem('moon_profile', v);
    await fetch(API_BASE + '/app/config/set', {
      method:'POST', headers: Object.assign({}, authHeaders(), {'Content-Type':'application/json'}),
      body: JSON.stringify({ user_profile: v })
    });
    alert('用户资料已保存（' + v.length + ' 字符）');
  }catch(e){ alert('保存失败'); }
}
(function(){
  document.addEventListener('input', function(e){
    if (e.target.id === 'profileEdit'){
      document.getElementById('profileCount').textContent = e.target.value.length;
    }
  });
  // 打开设置面板时自动加载
  const origOpen = window.openSettingsPanel;
  window.openSettingsPanel = async function(){
    if (origOpen) origOpen();
    try{
      const local = localStorage.getItem('moon_profile') || '';
      document.getElementById('profileEdit').value = local;
      document.getElementById('profileCount').textContent = local.length;
      const r = await fetch(API_BASE + '/app/config/get', { headers: authHeaders() });
      const d = await r.json();
      const remote = (d.config||{}).user_profile || '';
      if (remote && !local){ document.getElementById('profileEdit').value = remote; document.getElementById('profileCount').textContent = remote.length; }
    }catch(e){}
  };
})();
