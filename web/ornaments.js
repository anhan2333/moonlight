/* ════════════ 月光装饰挂载（修复v0.7空壳：写了没挂）════════════
   慕夏装饰：圆章(双人头像)+旋转月相+藤蔓+马赛克角饰 —— 移植自kimi-manor */
(function(){
  // 月光配色
  var GOLD = '#bda06f', ROSE = '#c17355', GLOW = 'rgba(212,154,86,.35)';

  // ---- 圆章：16放射刻度+内环+双人头像位 ----
  function medallion(size){
    var lines = '';
    for (var i = 0; i < 16; i++){
      var ang = (i/16)*Math.PI*2;
      var r1 = 22, r2 = (i%2===0)?32:28;
      lines += '<line x1="'+(40+Math.cos(ang)*r1).toFixed(1)+'" y1="'+(40+Math.sin(ang)*r1).toFixed(1)+'" x2="'+(40+Math.cos(ang)*r2).toFixed(1)+'" y2="'+(40+Math.sin(ang)*r2).toFixed(1)+'" stroke="currentColor" stroke-width="0.5"/>';
    }
    return '<svg viewBox="0 0 80 80" width="'+size+'" height="'+size+'" style="color:'+GOLD+'" aria-hidden="true">'+
      '<circle cx="40" cy="40" r="18" fill="none" stroke="currentColor" stroke-width="0.6"/>'+
      '<circle cx="40" cy="40" r="14" fill="'+ROSE+'" opacity="0.15"/>'+ lines +
      '<circle cx="40" cy="40" r="3" fill="'+ROSE+'"/></svg>';
  }
  // ---- 藤蔓：波浪+花蕾+斜叶 ----
  function vine(){
    return '<svg viewBox="0 0 300 24" width="100%" style="color:'+GOLD+';display:block" aria-hidden="true" preserveAspectRatio="xMidYMid meet">'+
      '<path d="M10 12 Q30 4 50 12 Q70 20 90 12 Q110 4 130 12 Q150 20 170 12 Q190 4 210 12 Q230 20 250 12 Q270 4 290 12" fill="none" stroke="currentColor" stroke-width="0.6"/>'+
      '<g fill="'+ROSE+'" opacity="0.8"><circle cx="50" cy="12" r="2"/><circle cx="150" cy="12" r="2.5"/><circle cx="250" cy="12" r="2"/></g>'+
      '<g stroke="currentColor" fill="none" stroke-width="0.4" opacity="0.6">'+
      '<ellipse cx="90" cy="12" rx="2" ry="5" transform="rotate(20 90 12)"/>'+
      '<ellipse cx="210" cy="12" rx="2" ry="5" transform="rotate(-20 210 12)"/></g></svg>';
  }
  // ---- 马赛克角饰：6x6三态拜占庭 ----
  function mosaic(size){
    var sq = '';
    for (var r = 0; r < 6; r++) for (var q = 0; q < 6; q++){
      var d = (r+q)%3;
      var fill = d===0 ? 'currentColor' : (d===1 ? ROSE : 'none');
      var op = d===0 ? 0.15 : (d===1 ? 0.3 : 0.6);
      sq += '<rect x="'+(q*10)+'" y="'+(r*10)+'" width="9" height="9" fill="'+fill+'" stroke="currentColor" stroke-width="0.3" opacity="'+op+'"/>';
    }
    return '<svg viewBox="0 0 60 60" width="'+size+'" height="'+size+'" style="color:'+GOLD+'" aria-hidden="true">'+sq+'</svg>';
  }
  // ---- 月相盘：双弧算法+金色渐变+光晕（kimi-manor版）----
  function moonPhase(phase, size){
    var r = 12, cx = 12, cy = 12;
    var cosVal = Math.cos(2*Math.PI*phase);
    var rx = Math.abs(cosVal)*r;
    var isWaxing = phase < 0.5;
    var sweepOuter = isWaxing ? 0 : 1;
    var sweepInner = ((cosVal >= 0) === isWaxing) ? 1 : 0;
    var shadow = 'M '+cx+','+(cy-r)+' A '+r+','+r+' 0 0 '+sweepOuter+' '+cx+','+(cy+r)+' A '+rx+','+r+' 0 0 '+sweepInner+' '+cx+','+(cy-r)+' Z';
    var uid = 'mp'+Math.floor(Math.random()*9999);
    return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" aria-hidden="true" style="display:inline-block;filter:drop-shadow(0 0 8px '+GLOW+') drop-shadow(0 0 14px rgba(212,154,86,.18))">'+
      '<defs><radialGradient id="'+uid+'a" cx="38%" cy="36%" r="70%">'+
      '<stop offset="0%" stop-color="#fff6e0"/><stop offset="55%" stop-color="#e4d3ad"/><stop offset="100%" stop-color="#9b7c50"/>'+
      '</radialGradient><radialGradient id="'+uid+'b" cx="65%" cy="68%" r="38%">'+
      '<stop offset="0%" stop-color="rgba(120,90,50,0.18)"/><stop offset="100%" stop-color="rgba(120,90,50,0)"/>'+
      '</radialGradient></defs>'+
      '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="url(#'+uid+'a)"/>'+
      '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="url(#'+uid+'b)"/>'+
      '<path d="'+shadow+'" fill="rgba(14,8,4,0.94)"/></svg>';
  }
  // ---- 今天月相计算 ----
  function todayPhase(){
    var known = Date.UTC(2026, 7, 31) / 86400000; // 满月锚点 2026-08-31
    var now = Date.now() / 86400000;
    var p = ((now - known) / 29.53) % 1;
    return p < 0 ? p + 1 : p;
  }

  window.MOON_ORNAMENTS = { medallion: medallion, vine: vine, mosaic: mosaic, moonPhase: moonPhase };

  // ---- 自动挂载 ----
  function mount(){
    try{
      // 1) 聊天页角饰（左右上角）
      if (!document.getElementById('moonCornerTL')){
        var tl = document.createElement('div');
        tl.id = 'moonCornerTL'; tl.className = 'moon-corner moon-corner-tl';
        document.body.appendChild(tl);
        var tr = document.createElement('div');
        tr.id = 'moonCornerTR'; tr.className = 'moon-corner moon-corner-tr';
        document.body.appendChild(tr);
      }
      document.getElementById('moonCornerTL').innerHTML = mosaic(40);
      document.getElementById('moonCornerTR').innerHTML = mosaic(40);

      // 2) 菜单 hero：圆章（内嵌双人头像）+旋转月相+藤蔓
      var hero = document.querySelector('.menu-hero') || document.querySelector('[class*="menu"] .hero');
      if (hero && !document.getElementById('moonMedWrap')){
        var wrap = document.createElement('div');
        wrap.id = 'moonMedWrap';
        wrap.style.cssText = 'position:relative;width:120px;height:120px;margin:0 auto 6px;';
        wrap.innerHTML = medallion(120) +
          '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:0;">'+
          '<span class="moon-av">安</span><span class="moon-av moon-av-b">薇</span></div>';
        hero.insertBefore(wrap, hero.firstChild);

        var moon = document.createElement('div');
        moon.id = 'moonPhaseSpin';
        moon.className = 'moon-spin';
        moon.title = '今天的月相';
        wrap.parentNode.insertBefore(moon, wrap.nextSibling);
        var ph = document.createElement('div');
        ph.className = 'moon-vine-wrap';
        ph.innerHTML = vine();
        hero.appendChild(ph);
      }
      var spin = document.getElementById('moonPhaseSpin');
      if (spin) spin.innerHTML = moonPhase(todayPhase(), 44);

      // 3) 菜单底部藤蔓
      var menuFoot = document.querySelector('.menu-panel') || document.querySelector('[id*="menu"]');
      if (menuFoot && !document.getElementById('moonFootVine')){
        var fv = document.createElement('div');
        fv.id = 'moonFootVine';
        fv.style.cssText = 'padding:8px 30px;opacity:.75;';
        fv.innerHTML = vine();
        menuFoot.appendChild(fv);
      }
    }catch(e){ /* 装饰失败不影响功能 */ }
  }
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', mount);
  } else { mount(); }
  // 主题切换后重绘月相颜色兼容
  window.addEventListener('load', mount);
})();