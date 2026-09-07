/* ════════════ 插件运行时（兼容Operit toolpkg的 u.UI 声明树）════════════
   Operit插件UI = JS函数(pluginCtx) 返回 u.UI.* 声明树 → 宿主渲染
   月光实现同名宿主：useState/useEffect + UI.Column/Row/Text/Button... */
(function(){
  window.MoonlightPluginRuntime = { render: render };

  function render(container, plugin){
    // 解析toolpkg里引用的相对require：都注入同一ctx即可（本实现共享存储）
    var ctx = buildCtx(plugin);
    var fn = new Function('exports', 'ToolPkg', plugin.code + '\n;return typeof registerToolPkg==="function"?registerToolPkg:null;');
    var routes = [];
    var regApi = {
      registerUiRoute: function(r){ routes.push(r); return true; },
      registerNavigationEntry: function(){ return true; },
      registerTool: function(){ return true; }
    };
    try {
      // main.js通过 exports.registerToolPkg 导出
      var exportsObj = {};
      var getReg = fn.call(exportsObj, exportsObj, regApi);
      if (getReg) getReg();
    } catch(e){
      container.innerHTML = '<div style="color:#c0533f;padding:10px;">插件加载失败：' + e.message + '</div>';
      return;
    }
    if (!routes.length){
      container.innerHTML = '<div style="padding:10px;opacity:.6;">此插件没有注册UI界面（纯工具型）。</div>';
      return;
    }
    // 加载对应UI文件（toolpkg里 screen: dist/ui/...js），月光约定：导入时把ui文件存进 plugin.ui_code
    var route = routes[0];
    var uiCode = plugin.ui_code || '';
    if (!uiCode){
      container.innerHTML = '<div style="padding:10px;opacity:.6;">插件界面文件未随包导入（缺少 dist/ui/*.ui.js）。重新导入完整toolpkg即可。</div>';
      return;
    }
    // 执行UI函数：new Function('ctx', uiCode + '; return ' + fnName)(ctx)
    try {
      var m = uiCode.match(/exports\.default\s*=\s*(\w+)/) || uiCode.match(/exports\.default=(\w+)/);
      var fname = m ? m[1] : null;
      if (!fname){
        // minified: function u(...) 已被 export default u 引用——直接找最后一个 function 声明名
        var m2 = uiCode.match(/function (\w+)\((\w+)\)\{const/);
        fname = m2 ? m2[1] : null;
        if (!fname){ container.innerHTML = '<div style="padding:10px;">未找到UI函数入口</div>'; return; }
      }
      var uiFn = new Function('require', uiCode + '\n;return ' + fname + ';')(fakeRequire(ctx, plugin));
      var tree = uiFn(ctx);
      container.innerHTML = '';
      container.appendChild(renderTree(tree));
    } catch(e){
      container.innerHTML = '<div style="color:#c0533f;padding:10px;">UI渲染失败：' + e.message + '</div>';
    }
  }

  function fakeRequire(ctx, plugin){
    return function(path){
      // 返回共享ctx，插件shared模块都基于存储API——月光用同一套ctx兼容
      return ctx;
    };
  }

  function buildCtx(plugin){
    var listeners = [];
    var ctx = {
      UI: null, // 下面赋值
      useState: function(key, init){
        var store = ctx._state || (ctx._state = {});
        if (!(key in store)) store[key] = init;
        return [store[key], function(v){ store[key] = (typeof v === 'function') ? v(store[key]) : v; rerender(); }];
      },
      useEffect: function(fn){ try{ fn(); }catch(e){} },
      useMemo: function(fn){ return fn(); },
      toast: function(msg){ if (window.showToast) showToast(msg); },
      storage: {
        get: function(k){ try{ return localStorage.getItem('moonplug_'+k); }catch(e){ return null; } },
        set: function(k,v){ try{ localStorage.setItem('moonplug_'+k, v); }catch(e){} }
      }
    };
    ctx.UI = makeUI(ctx);
    ctx._rerender = function(){ listeners.forEach(function(f){ f(); }); };
    function rerender(){ if (ctx._onUpdate) ctx._onUpdate(); }
    // useState setter触发重渲染
    var origSet = ctx.useState;
    return ctx;
  }

  // UI声明树 → DOM
  function makeUI(ctx){
    var U = {};
    function el(tag){
      return function(props){
        var children = Array.prototype.slice.call(arguments, 1).flat();
        props = props || {};
        var d = document.createElement(tag);
        if (props.style){ Object.keys(props.style||{}).forEach(function(k){ try{ d.style[k] = props.style[k]; }catch(e){} }); }
        for (var k in props){
          if (k === 'style' || k === 'key' || k === 'fillMaxWidth' || k === 'spacing' || k === 'padding' || k === 'weight' || k === 'verticalAlignment' || k === 'horizontalAlignment') continue;
          if (k === 'onClick' || k === 'onTap'){ d.addEventListener('click', props[k]); continue; }
          if (k === 'text'){ d.textContent = props[k]; continue; }
          if (k === 'value'){ d.value = props[k]; continue; }
          if (/^on/.test(k)){ d.addEventListener(k.slice(2).toLowerCase(), props[k]); continue; }
        }
        if (props.fillMaxWidth) d.style.width = '100%';
        if (props.padding){
          var pd = props.padding;
          if (typeof pd === 'number') d.style.padding = pd+'px';
          else { d.style.paddingTop=(pd.vertical||0)+'px'; d.style.paddingBottom=(pd.vertical||0)+'px'; d.style.paddingLeft=(pd.horizontal||0)+'px'; d.style.paddingRight=(pd.horizontal||0)+'px'; }
        }
        if (props.spacing){ d.style.gap = props.spacing+'px'; }
        children.forEach(function(ch){
          if (ch == null) return;
          if (typeof ch === 'string' || typeof ch === 'number') d.appendChild(document.createTextNode(String(ch)));
          else if (ch.nodeType) d.appendChild(ch);
        });
        return d;
      };
    }
    U.Column = function(props){ var d = el('div').apply(null, arguments); d.style.display='flex'; d.style.flexDirection='column'; return d; };
    U.Row = function(props){ var d = el('div').apply(null, arguments); d.style.display='flex'; d.style.flexDirection='row'; d.style.alignItems='center'; return d; };
    U.Box = el('div');
    U.Text = function(props){ var a=[{}].concat([].slice.call(arguments,1)); var d = el('span').apply(null, a); if (props&&props.text!=null) d.textContent = props.text; d.style.fontSize='14px'; d.style.color='var(--text,#f3e6cd)'; return d; };
    U.Button = function(props){ var a=[{}].concat([].slice.call(arguments,1)); var d = el('button').apply(null, a); d.style.padding='8px 14px'; d.style.borderRadius='10px'; d.style.border='1px solid var(--accent,#bda06f)'; d.style.background='var(--accent,#bda06f)'; d.style.color='#fff'; return d; };
    U.TextButton = U.Button;
    U.OutlinedButton = function(props){ var d = U.Button.apply(null, arguments); d.style.background='none'; d.style.color='var(--accent,#bda06f)'; return d; };
    U.TextField = function(props){ var inp = document.createElement('input'); inp.value = props.value||''; inp.placeholder = props.label||props.placeholder||''; inp.style.cssText='width:100%;padding:9px 12px;border:1px solid var(--field-line);border-radius:10px;background:var(--field-bg);color:var(--text);font-size:14px;'; if (props.onChange) inp.addEventListener('input', function(e){ props.onChange(e.target.value); }); return inp; };
    U.Switch = function(props){ var s = document.createElement('input'); s.type='checkbox'; s.checked = !!props.checked; if (props.onChange) s.addEventListener('change', function(e){ props.onChange(e.target.checked); }); var w = document.createElement('label'); w.appendChild(s); return w; };
    U.Card = function(props){ var d = U.Column.apply(null, arguments); d.style.border='1px solid var(--card-line)'; d.style.borderRadius='12px'; d.style.padding='12px'; d.style.background='var(--card-bg)'; return d; };
    U.Surface = U.Card;
    U.HorizontalDivider = function(){ var d = document.createElement('hr'); d.style.cssText='border:none;border-top:1px solid var(--hairline);width:100%;'; return d; };
    U.LazyColumn = U.Column; U.LazyRow = U.Row;
    U.LinearProgressIndicator = function(props){ var w=document.createElement('div'); w.style.cssText='height:4px;background:rgba(0,0,0,.25);border-radius:2px;overflow:hidden;'; var i=document.createElement('i'); i.style.cssText='display:block;height:100%;background:var(--accent);width:'+Math.round((props.progress||0)*100)+'%;'; w.appendChild(i); return w; };
    U.Icon = function(){ return document.createElement('span'); };
    U.IconButton = function(props){ var d = el('button').apply(null, arguments); d.style.cssText='background:none;border:none;font-size:18px;cursor:pointer;'; return d; };
    U.Image = function(){ return document.createElement('img'); };
    return U;
  }

  function renderTree(node){
    if (node == null) return document.createTextNode('');
    if (typeof node === 'string' || typeof node === 'number') return document.createTextNode(String(node));
    if (node.nodeType) return node;
    return document.createTextNode('');
  }
})();
