/* ════════════ 月光悬浮球（照Operit SiriBall渲染算法移植到Canvas）════════════
   6层渲染：粒子后方+3层音波+底部光晕+4色blob旋转+中心核心+玻璃高光
   可拖动、点按聊天、双击展开面板 */
(function(){
  var COLORS = { main:'#0A84FF', a1:'#BF5AF2', a2:'#FF375F', a3:'#00D4FF' };
  var BALL_SIZE = 52;      // 球直径
  var CANVAS_MULT = 3;     // canvas是球的3倍大（容纳音波扩散）
  var state = { x: window.innerWidth - 80, y: window.innerHeight * 0.35, dragging:false, dx:0, dy:0, pressing:false, rotation:0, breathe:1, mode:'ball' };

  function todayPhase(){
    var syn = 29.53058867, known = Date.UTC(2000,0,6,18,14);
    var now = new Date();
    var days = (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - known)/86400000;
    return (((days%syn)+syn)%syn)/syn;
  }

  function createBall(){
    if (document.getElementById('moonFloatBall')) return;
    var c = document.createElement('canvas');
    c.id = 'moonFloatBall';
    var size = BALL_SIZE * CANVAS_MULT;
    c.width = size * (window.devicePixelRatio||1);
    c.height = size * (window.devicePixelRatio||1);
    c.style.cssText = 'position:fixed;z-index:350;width:'+size+'px;height:'+size+'px;'+
      'left:'+(state.x - size/2)+'px;top:'+(state.y - size/2)+'px;'+
      'pointer-events:auto;cursor:grab;touch-action:none;'+
      'filter:drop-shadow(0 4px 14px rgba(0,0,0,.35));';
    document.body.appendChild(c);
    var ctx = c.getContext('2d');
    ctx.scale(window.devicePixelRatio||1, window.devicePixelRatio||1);

    // 拖动/点击
    var moved = false, startX=0, startY=0;
    c.addEventListener('pointerdown', function(e){
      state.dragging = true; state.pressing = true; moved = false;
      startX = e.clientX - state.x; startY = e.clientY - state.y;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', function(e){
      if (!state.dragging) return;
      var nx = e.clientX - startX, ny = e.clientY - startY;
      if (Math.abs(nx - state.x) > 4 || Math.abs(ny - state.y) > 4) moved = true;
      state.x = Math.max(30, Math.min(window.innerWidth-30, nx));
      state.y = Math.max(30, Math.min(window.innerHeight-30, ny));
      c.style.left = (state.x - size/2)+'px';
      c.style.top = (state.y - size/2)+'px';
    });
    c.addEventListener('pointerup', function(e){
      state.dragging = false; state.pressing = false;
      if (!moved){
        // 点击：展开/收起小聊天窗（照Operit FloatingChatWindow）
        if (window.MoonBallChat) window.MoonBallChat.toggle();
      }
    });

    // 渲染循环
    function blob(cx, cy, radius, angle, distance, color, s, alpha){
      var rad = angle * Math.PI / 180;
      var bx = cx + distance * Math.cos(rad);
      var by = cy + distance * Math.sin(rad);
      var rr = radius * s;
      var g = ctx.createRadialGradient(bx, by, 0, bx, by, rr);
      g.addColorStop(0, color.replace(')', ','+ (0.8*alpha) +')').replace('rgb','rgba'));
      g.addColorStop(0.5, color.replace(')', ','+ (0.5*alpha) +')').replace('rgb','rgba'));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, rr, 0, Math.PI*2); ctx.fill();
    }
    function hexA(hex, a){
      var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
      return 'rgba('+r+','+g+','+b+','+a+')';
    }

    function draw(t){
      var half = size/2, cx = half, cy = half;
      ctx.clearRect(0, 0, size, size);
      var pressScale = state.pressing ? 0.85 : 1.0;
      var baseR = (BALL_SIZE/2) * pressScale * (CANVAS_MULT/3) * 2.2;
      var breathe = 1 + Math.sin(t/900)*0.05;
      state.rotation = (t/50) % 360;

      // 1. 三层音波扩散
      for (var i=0;i<3;i++){
        var phase = ((t/1400)+i/3)%1;
        var rr = baseR * (1 + phase*1.1);
        var alpha = (1-phase)*0.22;
        var col = [COLORS.main, COLORS.a1, COLORS.a3][i];
        var g = ctx.createRadialGradient(cx,cy,rr*0.6, cx,cy,rr);
        g.addColorStop(0,'rgba(0,0,0,0)');
        g.addColorStop(0.7, hexA(col, alpha));
        g.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx,cy,rr,0,Math.PI*2); ctx.fill();
      }

      // 2. 底部光晕
      var gg = ctx.createRadialGradient(cx,cy,0,cx,cy,baseR*0.75*breathe);
      gg.addColorStop(0, hexA(COLORS.main, 0.3));
      gg.addColorStop(0.6, hexA(COLORS.a1, 0.2));
      gg.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(cx,cy,baseR*0.75*breathe,0,Math.PI*2); ctx.fill();

      // 3. 四色blob（慢速旋转）
      blob(cx,cy,baseR, state.rotation, baseR*0.2*breathe, 'rgb(10,132,255)', 0.7, 1);
      blob(cx,cy,baseR, state.rotation+90, baseR*0.25*breathe, 'rgb(191,90,242)', 0.65, 1);
      blob(cx,cy,baseR, state.rotation+180, baseR*0.22*breathe, 'rgb(255,55,95)', 0.6, 1);
      blob(cx,cy,baseR, state.rotation+270, baseR*0.23*breathe, 'rgb(0,212,255)', 0.68, 1);

      // 4. 中心明亮核心
      var core = ctx.createRadialGradient(cx,cy,0,cx,cy,baseR*0.65*breathe);
      core.addColorStop(0,'rgba(255,255,255,0.7)');
      core.addColorStop(0.4, hexA(COLORS.main, 0.6));
      core.addColorStop(0.8, hexA(COLORS.a1, 0.5));
      core.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(cx,cy,baseR*0.65*breathe,0,Math.PI*2); ctx.fill();

      // 5. 玻璃高光
      var hx = cx - baseR*0.25, hy = cy - baseR*0.25;
      var hl = ctx.createRadialGradient(hx,hy,0,hx,hy,baseR*0.35);
      hl.addColorStop(0,'rgba(255,255,255,0.5)');
      hl.addColorStop(0.6,'rgba(255,255,255,0.25)');
      hl.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = hl;
      ctx.beginPath(); ctx.arc(hx,hy,baseR*0.35,0,Math.PI*2); ctx.fill();

      // 6. 中心月相小图（月光的灵魂）
      var phase = todayPhase();
      var mr = baseR * 0.34;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx,cy,mr,0,Math.PI*2); ctx.clip();
      var mg = ctx.createRadialGradient(cx-mr*0.3, cy-mr*0.3, 0, cx, cy, mr);
      mg.addColorStop(0,'#fff6e0'); mg.addColorStop(0.55,'#e4d3ad'); mg.addColorStop(1,'#9b7c50');
      ctx.fillStyle = mg;
      ctx.beginPath(); ctx.arc(cx,cy,mr,0,Math.PI*2); ctx.fill();
      // 阴影
      var cosV = Math.cos(2*Math.PI*phase);
      var shx = cx + (1-phase*2)*mr*0.9;
      ctx.fillStyle = 'rgba(10,8,6,0.85)';
      ctx.beginPath(); ctx.arc(shx, cy, mr*1.05, 0, Math.PI*2); ctx.fill();
      ctx.restore();

      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createBall);
  else createBall();
})();