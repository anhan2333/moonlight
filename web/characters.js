/* ════════════ 角色卡管理(自包含,不依赖 index.html 改动)════════════
   - 运行时往「系统」菜单插入「角色卡」入口
   - 全屏面板:列出/编辑/新增/设默认角色卡
   - 数据:relay /app/characters/*(api_loop 与其他大脑读取默认卡当 persona)
*/
(function () {
  'use strict';
  if (window.__moonCharactersInit) return;
  window.__moonCharactersInit = true;

  const CSS = `
  #charsPanel .char-card{background:rgba(189,160,111,.06);border:1px solid rgba(189,160,111,.15);border-radius:12px;padding:12px;margin-bottom:8px;}
  #charsPanel .char-card .cn{font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px;}
  #charsPanel .char-card .cn .def{font-size:10px;background:rgba(189,160,111,.2);color:#bda06f;padding:2px 8px;border-radius:99px;}
  #charsPanel .char-card .cp{font-size:11px;opacity:.55;margin-top:4px;max-height:34px;overflow:hidden;line-height:1.5;}
  #charsPanel .char-card .ct{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;}
  #charsPanel .char-card .ct .chip{font-size:10px;padding:3px 10px;border-radius:99px;background:rgba(138,155,110,.15);color:#8a9b6e;border:1px solid rgba(138,155,110,.25);}
  #charsPanel .char-card .ca{display:flex;gap:6px;margin-top:8px;}
  #charsPanel .char-card .ca button{font-size:11px;padding:5px 12px;border:1px solid rgba(189,160,111,.3);border-radius:6px;background:none;color:#bda06f;cursor:pointer;}
  #charsPanel .char-card .ca button.danger{border-color:rgba(192,83,63,.3);color:#c0533f;}
  #charsPanel .char-editor textarea{width:100%;min-height:220px;border:1px solid rgba(189,160,111,.25);border-radius:10px;
    background:var(--field-bg,#faf8f4);color:var(--text,#2a2622);font-size:12px;line-height:1.7;padding:10px;resize:vertical;outline:none;font-family:inherit;}
  #charsPanel .char-editor input{width:100%;padding:10px 12px;border:1px solid rgba(189,160,111,.25);border-radius:10px;
    background:var(--field-bg,#faf8f4);color:var(--text,#2a2622);font-size:13px;margin-bottom:8px;outline:none;}
  #charsPanel .char-editor .row{display:flex;gap:8px;align-items:center;margin-top:8px;}
  #charsPanel .char-editor .row label{font-size:12px;opacity:.7;display:flex;align-items:center;gap:5px;}
  #charsPanel .char-editor .row button{flex:1;padding:10px;border:none;border-radius:10px;
    background:linear-gradient(135deg,#c19a56,#a86b6b);color:#fff;font-size:13px;cursor:pointer;}
  #charsPanel .char-editor .row .cancel{background:none;border:1px solid rgba(189,160,111,.3);color:#bda06f;}
  #charsPanel .char-editor .sec{font-size:12px;font-weight:600;color:#bda06f;margin:12px 0 6px;letter-spacing:.5px;}
  #charsPanel .tag-item{border:1px solid rgba(189,160,111,.18);border-radius:10px;padding:9px;margin-bottom:7px;background:rgba(189,160,111,.04);}
  #charsPanel .tag-item .tag-head{display:flex;gap:7px;align-items:center;}
  #charsPanel .tag-item .tag-head input{margin-bottom:0;flex:1;font-weight:600;}
  #charsPanel .tag-item .tag-head button{flex:none;border:1px solid rgba(192,83,63,.3);background:none;color:#c0533f;
    font-size:11px;padding:6px 10px;border-radius:8px;cursor:pointer;}
  #charsPanel .tag-item textarea{width:100%;min-height:64px;margin-top:7px;font-size:11.5px;}
  #charsPanel .tag-add{width:100%;border:1px dashed rgba(189,160,111,.4);background:none;color:#bda06f;
    font-size:12px;padding:9px;border-radius:10px;cursor:pointer;}
  #charsPanel .char-tip{font-size:11px;opacity:.6;margin-bottom:10px;line-height:1.6;}
  `;

  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
  function headers() { return Object.assign({}, authHeaders(), { 'Content-Type': 'application/json' }); }

  let editingId = 0;
  let editingTags = [];   // [{name, content}]

  function tagEditorHtml() {
    let html = '<div id="tagList">';
    editingTags.forEach((t, i) => {
      html += `<div class="tag-item" data-i="${i}">
        <div class="tag-head">
          <input class="tag-name" value="${esc(t.name || '')}" placeholder="标签名(如:情感过滤器)">
          <button type="button" onclick="removeTag(${i})">✕</button>
        </div>
        <textarea class="tag-content" placeholder="标签内容(世界书条目)…">${esc(t.content || '')}</textarea>
      </div>`;
    });
    return html + '</div><button type="button" class="tag-add" onclick="addTag()">＋ 添加标签 / 世界书条目</button>';
  }
  window.addTag = function () {
    editingTags.push({ name: '', content: '' });
    refreshTagEditor();
  };
  window.removeTag = function (i) {
    editingTags.splice(i, 1);
    refreshTagEditor();
  };
  function collectTags() {
    const items = [...document.querySelectorAll('#tagEditorHost .tag-item')];
    return items.map(it => ({
      name: (it.querySelector('.tag-name') || {}).value || '',
      content: (it.querySelector('.tag-content') || {}).value || ''
    })).filter(t => (t.name + t.content).trim());
  }
  function refreshTagEditor() {
    const host = document.getElementById('tagEditorHost');
    if (host) host.innerHTML = tagEditorHtml();
  }

  function panelHtml() {
    return `
    <div class="side-panel-backdrop" onclick="closeCharactersPanel()"></div>
    <div class="side-panel-content">
      <div class="side-panel-head">
        <button class="side-panel-close" onclick="closeCharactersPanel()" aria-label="close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        <h2 class="side-panel-title">角色卡</h2>
        <p class="side-panel-sub">安念的人格设定 · 默认卡会注入给电脑大脑</p>
      </div>
      <div class="side-panel-body" id="charsBody">
        <div class="panel-loading">加载中…</div>
      </div>
    </div>`;
  }

  async function loadList() {
    const box = document.getElementById('charsBody');
    if (!box) return;
    try {
      const r = await fetch(API_BASE + '/app/characters/list', { headers: authHeaders() });
      const d = await r.json();
      const cards = d.cards || [];
      let html = '<div class="char-tip">这里存的是「安念是谁」。默认角色卡会作为人格设定注入给电脑端大脑(标签/世界书一起生效);手机安念的人设在手机 Operit 里。</div>';
      html += `<div class="char-editor" id="charEditor" style="display:none;">
        <input id="charName" placeholder="角色卡名称(如:安念)">
        <textarea id="charPersona" placeholder="人格设定全文…(身份、语气、规则、边界)"></textarea>
        <div class="sec">🏷 标签 · 世界书</div>
        <div id="tagEditorHost"></div>
        <div class="row">
          <label><input type="checkbox" id="charDefault"> 设为默认</label>
          <button onclick="saveCharacter()">保存</button>
          <button class="cancel" onclick="closeCharEditor()">取消</button>
        </div>
      </div>`;
      if (!cards.length) html += '<div class="panel-loading">还没有角色卡,点下方新增</div>';
      cards.forEach(c => {
        const chips = (c.tags || []).map(t => `<span class="chip">${esc(t.name || '标签')}</span>`).join('');
        html += `<div class="char-card">
          <div class="cn">${esc(c.name)}${c.is_default ? '<span class="def">默认</span>' : ''}</div>
          <div class="cp">${esc((c.persona || '').slice(0, 90))}</div>
          ${chips ? `<div class="ct">${chips}</div>` : ''}
          <div class="ca">
            <button onclick="editCharacter(${c.id})">编辑</button>
            ${c.is_default ? '' : `<button onclick="setDefaultCharacter(${c.id})">设为默认</button>`}
            <button class="danger" onclick="delCharacter(${c.id})">删除</button>
          </div></div>`;
      });
      html += `<div class="char-card" style="text-align:center;">
        <div class="ca" style="justify-content:center;"><button onclick="editCharacter(0)" style="border:none;background:rgba(189,160,111,.12);padding:8px 18px;border-radius:99px;font-size:12px;">＋ 新增角色卡</button></div>
      </div>`;
      box.innerHTML = html;
    } catch (e) {
      box.innerHTML = '<div class="panel-loading">加载失败</div>';
    }
  }

  window.openCharactersPanel = async function () {
    let p = document.getElementById('charsPanel');
    if (!p) {
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);
      p = h(`<div class="side-panel hidden" id="charsPanel" aria-hidden="true">${panelHtml()}</div>`);
      document.body.appendChild(p);
    }
    p.classList.remove('hidden');
    p.setAttribute('aria-hidden', 'false');
    editingId = 0;
    await loadList();
  };
  window.closeCharactersPanel = function () {
    const p = document.getElementById('charsPanel');
    if (p) { p.classList.add('hidden'); p.setAttribute('aria-hidden', 'true'); }
  };
  window.editCharacter = function (id) {
    editingId = id || 0;
    const ed = document.getElementById('charEditor');
    if (!ed) return;
    if (id) {
      fetch(API_BASE + '/app/characters/list', { headers: authHeaders() })
        .then(r => r.json()).then(d => {
          const c = (d.cards || []).find(x => x.id === id);
          if (!c) return;
          document.getElementById('charName').value = c.name;
          document.getElementById('charPersona').value = c.persona || '';
          document.getElementById('charDefault').checked = !!c.is_default;
          editingTags = (c.tags || []).slice();
          document.getElementById('tagEditorHost').innerHTML = tagEditorHtml();
          ed.style.display = 'block';
          ed.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    } else {
      document.getElementById('charName').value = '';
      document.getElementById('charPersona').value = '';
      document.getElementById('charDefault').checked = false;
      editingTags = [];
      document.getElementById('tagEditorHost').innerHTML = tagEditorHtml();
      ed.style.display = 'block';
      ed.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  window.closeCharEditor = function () {
    const ed = document.getElementById('charEditor');
    if (ed) ed.style.display = 'none';
  };
  window.saveCharacter = async function () {
    const name = (document.getElementById('charName') || {}).value || '';
    const persona = (document.getElementById('charPersona') || {}).value || '';
    const is_def = (document.getElementById('charDefault') || {}).checked;
    if (!name.trim()) { alert('名称必填'); return; }
    try {
      await fetch(API_BASE + '/app/characters/save', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ id: editingId || undefined, name: name.trim(), persona, is_default: is_def, tags: collectTags() })
      });
      closeCharEditor();
      await loadList();
      if (window.showToast) showToast('角色卡已保存');
    } catch (e) { alert('保存失败'); }
  };
  window.setDefaultCharacter = async function (id) {
    try {
      const r = await fetch(API_BASE + '/app/characters/list', { headers: authHeaders() });
      const d = await r.json();
      const c = (d.cards || []).find(x => x.id === id);
      if (!c) return;
      await fetch(API_BASE + '/app/characters/save', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ id: c.id, name: c.name, persona: c.persona, is_default: true })
      });
      await loadList();
      if (window.showToast) showToast('已设为默认');
    } catch (e) {}
  };
  window.delCharacter = async function (id) {
    if (!confirm('删除这张角色卡?')) return;
    try {
      await fetch(API_BASE + '/app/characters/delete/' + id, { method: 'POST', headers: authHeaders() });
      await loadList();
    } catch (e) {}
  };

  // 菜单注入:在「模型配置」菜单项后面插「角色卡」
  function injectMenu() {
    if (document.querySelector('[data-menu="characters"]')) return;
    const modelsBtn = document.querySelector('[data-menu="models"]');
    if (!modelsBtn) return;
    const item = h(`<button class="menu-item" type="button" data-menu="characters"><span class="menu-ic">🎭</span><span class="menu-copy"><span class="menu-name">角色卡</span><span class="menu-sub">安念的人格设定</span></span><span class="menu-chev">→</span></button>`);
    modelsBtn.insertAdjacentElement('afterend', item);
    item.addEventListener('click', (e) => {
      e.preventDefault();
      openCharactersPanel();
    });
  }

  // 个人信息页入口:像「用户资料」一样,资料区下面放「安念的角色卡」快捷卡
  function injectProfile() {
    if (document.getElementById('charProfileEntry')) return;
    const scroll = document.getElementById('profileScroll');
    if (!scroll) return;
    const identity = scroll.querySelector('.profile-identity');
    const card = h(`<div class="char-profile-entry" id="charProfileEntry" style="margin:14px 18px 0;padding:13px 16px;border:1px solid rgba(189,160,111,.2);border-radius:14px;background:rgba(189,160,111,.05);cursor:pointer;display:flex;align-items:center;gap:12px;">
      <span style="font-size:20px;">🎭</span>
      <span style="flex:1;min-width:0;">
        <span style="display:block;font-size:14px;font-weight:600;color:var(--text,#2a2622);">安念的角色卡</span>
        <span style="display:block;font-size:11px;opacity:.55;margin-top:2px;">人格设定 · 标签世界书(日常 / 工作窗口)</span>
      </span>
      <span style="color:rgba(189,160,111,.7);font-size:16px;">→</span>
    </div>`);
    card.addEventListener('click', () => openCharactersPanel());
    if (identity && identity.parentElement === scroll) identity.insertAdjacentElement('afterend', card);
    else scroll.insertBefore(card, scroll.firstChild);
  }
  // profile 面板是动态打开的,监听插入
  const profileObserver = new MutationObserver(() => {
    if (!document.getElementById('charProfileEntry') && document.getElementById('profileScroll')) injectProfile();
  });
  document.body ? profileObserver.observe(document.body, { childList: true, subtree: false }) : document.addEventListener('DOMContentLoaded', () => profileObserver.observe(document.body, { childList: true, subtree: false }));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { injectMenu(); injectProfile(); });
  } else {
    injectMenu(); injectProfile();
  }
  setTimeout(() => { injectMenu(); injectProfile(); }, 1500);   // 菜单/资料页可能是运行时渲染的,补一次
})();
