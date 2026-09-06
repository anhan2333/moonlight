/* ═══ 配色主题切换（修复空壳按钮）═══ */
(function(){
  function applyColorTheme(name){
    try{ localStorage.setItem('moon_color', name); }catch(e){}
    const root = document.documentElement;
    // 月光主题: gold=慕夏夜(默认) rose=玫瑰哥特Day green=鼠尾草夜 blue=珍珠蓝(harbor)
    if (name === 'blue') root.setAttribute('data-theme', 'harbor');
    else if (name === 'pink') root.setAttribute('data-theme', 'pink');
    else if (name === 'gold') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', name);
    document.querySelectorAll('.theme-chip').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === name);
    });
  }
  // 初始化: 恢复保存的主题
  const saved = (()=>{ try{ return localStorage.getItem('moon_color') || 'gold'; }catch(e){ return 'gold'; } })();
  applyColorTheme(saved);
  // 点击监听（事件委托，随时可点）
  document.addEventListener('click', e => {
    const chip = e.target.closest('.theme-chip');
    if (!chip) return;
    applyColorTheme(chip.dataset.theme);
    try{ showToast && showToast('配色已切换'); }catch(_){}
  });
})();
