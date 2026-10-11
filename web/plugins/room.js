/* ════════════ Room像素艺术互动房间插件 ═══════════
   基于 InternalBeyond Room 系统的完整实现
   功能：Sui主持人对话、Tea氛围系统、Story分支叙事、Tarot塔罗、Wardrobe服装、Sleep睡眠、Pet宠物
*/

class RoomPlugin {
  constructor() {
    this.modules = {
      sui: new SuiModule(),
      tea: new TeaModule(),
      story: new StoryModule(),
      tarot: new TarotModule(),
      wardrobe: new WardrobeModule(),
      sleep: new SleepModule(),
      pet: new PetModule()
    };
    
    this.currentModule = 'sui';
    this.roomState = {
      background: 'default',
      lighting: 'warm',
      music: 'ambient',
      temperature: 22
    };
    
    this.init();
  }
  
  init() {
    console.log('Room Plugin initialized');
    this.createRoomInterface();
    this.loadRoomData();
    this.bindEvents();
  }
  
  // 创建房间界面
  createRoomInterface() {
    // 创建房间按钮
    const roomBtn = document.createElement('div');
    roomBtn.className = 'room-btn';
    roomBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 12h18m-9-9v18"></path>
        <rect x="3" y="3" width="18" height="18" rx="2"></rect>
      </svg>
      <span>房间</span>
    `;
    roomBtn.onclick = () => this.openRoomPanel();
    
    // 添加到主界面
    const mainContainer = document.querySelector('.main-container');
    if (mainContainer) {
      mainContainer.appendChild(roomBtn);
    }
  }
  
  // 打开房间面板
  openRoomPanel() {
    const panel = document.createElement('div');
    panel.id = 'room-panel';
    panel.className = 'room-panel';
    panel.innerHTML = `
      <div class="room-panel-header">
        <h2>像素艺术互动房间</h2>
        <button class="room-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
      <div class="room-panel-content">
        <div class="room-controls">
          <div class="room-background">
            <label>背景:</label>
            <select id="room-background" onchange="roomPlugin.changeBackground(this.value)">
              <option value="default">默认</option>
              <option value="garden">花园</option>
              <option value="library">图书馆</option>
              <option value="cafe">咖啡馆</option>
              <option value="beach">海滩</option>
            </select>
          </div>
          <div class="room-lighting">
            <label>灯光:</label>
            <select id="room-lighting" onchange="roomPlugin.changeLighting(this.value)">
              <option value="warm">温暖</option>
              <option value="cool">清凉</option>
              <option value="dim">昏暗</option>
              <option value="bright">明亮</option>
            </select>
          </div>
          <div class="room-music">
            <label>音乐:</label>
            <select id="room-music" onchange="roomPlugin.changeMusic(this.value)">
              <option value="ambient">环境音</option>
              <option value="classical">古典</option>
              <option value="jazz">爵士</option>
              <option value="nature">自然</option>
            </select>
          </div>
        </div>
        
        <div class="room-modules">
          <div class="room-module-tabs">
            <button class="room-module-tab active" data-module="sui">Sui</button>
            <button class="room-module-tab" data-module="tea">Tea</button>
            <button class="room-module-tab" data-module="story">Story</button>
            <button class="room-module-tab" data-module="tarot">Tarot</button>
            <button class="room-module-tab" data-module="wardrobe">Wardrobe</button>
            <button class="room-module-tab" data-module="sleep">Sleep</button>
            <button class="room-module-tab" data-module="pet">Pet</button>
          </div>
          <div class="room-module-content">
            <div class="room-module-pane active" id="sui-pane">
              ${this.modules.sui.render()}
            </div>
            <div class="room-module-pane" id="tea-pane">
              ${this.modules.tea.render()}
            </div>
            <div class="room-module-pane" id="story-pane">
              ${this.modules.story.render()}
            </div>
            <div class="room-module-pane" id="tarot-pane">
              ${this.modules.tarot.render()}
            </div>
            <div class="room-module-pane" id="wardrobe-pane">
              ${this.modules.wardrobe.render()}
            </div>
            <div class="room-module-pane" id="sleep-pane">
              ${this.modules.sleep.render()}
            </div>
            <div class="room-module-pane" id="pet-pane">
              ${this.modules.pet.render()}
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(panel);
    this.bindRoomPanelEvents();
  }
  
  // 切换模块
  switchModule(moduleName) {
    this.currentModule = moduleName;
    
    // 更新标签状态
    document.querySelectorAll('.room-module-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.module === moduleName);
    });
    
    // 更新内容显示
    document.querySelectorAll('.room-module-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `${moduleName}-pane`);
    });
    
    // 加载模块数据
    this.modules[moduleName].load();
  }
  
  // 改变背景
  changeBackground(background) {
    this.roomState.background = background;
    this.updateRoomBackground();
  }
  
  // 改变灯光
  changeLighting(lighting) {
    this.roomState.lighting = lighting;
    this.updateRoomLighting();
  }
  
  // 改变音乐
  changeMusic(music) {
    this.roomState.music = music;
    this.updateRoomMusic();
  }
  
  // 更新房间背景
  updateRoomBackground() {
    const roomCanvas = document.getElementById('room-canvas');
    if (!roomCanvas) return;
    
    const ctx = roomCanvas.getContext('2d');
    
    // 根据背景类型绘制不同的背景
    switch (this.roomState.background) {
      case 'garden':
        this.drawGardenBackground(ctx, roomCanvas);
        break;
      case 'library':
        this.drawLibraryBackground(ctx, roomCanvas);
        break;
      case 'cafe':
        this.drawCafeBackground(ctx, roomCanvas);
        break;
      case 'beach':
        this.drawBeachBackground(ctx, roomCanvas);
        break;
      default:
        this.drawDefaultBackground(ctx, roomCanvas);
    }
  }
  
  // 绘制默认背景
  drawDefaultBackground(ctx, canvas) {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#87CEEB');
    gradient.addColorStop(1, '#98FB98');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 绘制简单的房屋
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(100, 150, 200, 150);
    
    // 屋顶
    ctx.fillStyle = '#CD853F';
    ctx.beginPath();
    ctx.moveTo(80, 150);
    ctx.lineTo(200, 80);
    ctx.lineTo(320, 150);
    ctx.closePath();
    ctx.fill();
    
    // 门
    ctx.fillStyle = '#654321';
    ctx.fillRect(180, 220, 40, 80);
    
    // 窗户
    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(120, 170, 40, 40);
    ctx.fillRect(240, 170, 40, 40);
  }
  
  // 绘制花园背景
  drawGardenBackground(ctx, canvas) {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#87CEEB');
    gradient.addColorStop(1, '#90EE90');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 绘制花朵
    for (let i = 0; i < 10; i++) {
      const x = Math.random() * canvas.width;
      const y = 200 + Math.random() * 200;
      this.drawFlower(ctx, x, y);
    }
  }
  
  // 绘制花朵
  drawFlower(ctx, x, y) {
    // 茎
    ctx.strokeStyle = '#228B22';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 50);
    ctx.stroke();
    
    // 花瓣
    ctx.fillStyle = '#FF69B4';
    for (let i = 0; i < 5; i++) {
      const angle = (i * Math.PI * 2) / 5;
      const petalX = x + Math.cos(angle) * 15;
      const petalY = y + Math.sin(angle) * 15;
      ctx.beginPath();
      ctx.arc(petalX, petalY, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // 花心
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // 绘制图书馆背景
  drawLibraryBackground(ctx, canvas) {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#8B4513');
    gradient.addColorStop(1, '#D2691E');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 绘制书架
    ctx.fillStyle = '#654321';
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(i * 80, 50, 60, 300);
    }
    
    // 绘制书
    for (let i = 0; i < 15; i++) {
      const x = (i % 5) * 80 + 5;
      const y = 55 + Math.floor(i / 5) * 60;
      ctx.fillStyle = ['#FF0000', '#0000FF', '#008000', '#FFA500', '#800080'][i % 5];
      ctx.fillRect(x, y, 50, 50);
    }
  }
  
  // 绘制咖啡馆背景
  drawCafeBackground(ctx, canvas) {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#F5DEB3');
    gradient.addColorStop(1, '#DEB887');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 绘制咖啡桌
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(100, 200, 200, 100);
    
    // 绘制咖啡杯
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(150, 170, 40, 30);
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(145, 175, 50, 20);
    
    // 绘制蛋糕
    ctx.fillStyle = '#FFB6C1';
    ctx.fillRect(220, 170, 40, 30);
    ctx.fillStyle = '#FF69B4';
    ctx.fillRect(220, 160, 40, 10);
  }
  
  // 绘制海滩背景
  drawBeachBackground(ctx, canvas) {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#87CEEB');
    gradient.addColorStop(0.5, '#F0E68C');
    gradient.addColorStop(1, '#F4A460');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 绘制太阳
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(350, 80, 40, 0, Math.PI * 2);
    ctx.fill();
    
    // 绘制海鸥
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const x = 100 + i * 100;
      const y = 50 + i * 20;
      this.drawSeagull(ctx, x, y);
    }
    
    // 绘制棕榈树
    this.drawPalmTree(ctx, 50, 250);
  }
  
  // 绘制海鸥
  drawSeagull(ctx, x, y) {
    ctx.beginPath();
    ctx.moveTo(x - 15, y);
    ctx.quadraticCurveTo(x, y - 10, x + 15, y);
    ctx.stroke();
  }
  
  // 绘制棕榈树
  drawPalmTree(ctx, x, y) {
    // 树干
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(x - 10, y, 20, 100);
    
    // 叶子
    ctx.strokeStyle = '#228B22';
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI * 2) / 6;
      const leafX = x + Math.cos(angle) * 40;
      const leafY = y + Math.sin(angle) * 40;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(angle) * 20, y + Math.sin(angle) * 20, leafX, leafY);
      ctx.stroke();
    }
  }
  
  // 更新房间灯光
  updateRoomLighting() {
    const roomCanvas = document.getElementById('room-canvas');
    if (!roomCanvas) return;
    
    // 根据灯光类型调整整体色调
    const ctx = roomCanvas.getContext('2d');
    const overlay = ctx.createImageData(roomCanvas.width, roomCanvas.height);
    
    switch (this.roomState.lighting) {
      case 'warm':
        // 添加暖色调覆盖
        for (let i = 0; i < overlay.data.length; i += 4) {
          overlay.data[i] = Math.min(255, overlay.data[i] + 20);     // R
          overlay.data[i + 1] = Math.min(255, overlay.data[i + 1] + 10); // G
          overlay.data[i + 2] = Math.max(0, overlay.data[i + 2] - 10);  // B
        }
        break;
      case 'cool':
        // 添加冷色调覆盖
        for (let i = 0; i < overlay.data.length; i += 4) {
          overlay.data[i] = Math.max(0, overlay.data[i] - 10);     // R
          overlay.data[i + 1] = Math.min(255, overlay.data[i + 1] + 10); // G
          overlay.data[i + 2] = Math.min(255, overlay.data[i + 2] + 20); // B
        }
        break;
      case 'dim':
        // 降低亮度
        for (let i = 0; i < overlay.data.length; i += 4) {
          overlay.data[i] = overlay.data[i] * 0.5;     // R
          overlay.data[i + 1] = overlay.data[i + 1] * 0.5; // G
          overlay.data[i + 2] = overlay.data[i + 2] * 0.5; // B
        }
        break;
      case 'bright':
        // 提高亮度
        for (let i = 0; i < overlay.data.length; i += 4) {
          overlay.data[i] = Math.min(255, overlay.data[i] * 1.2);     // R
          overlay.data[i + 1] = Math.min(255, overlay.data[i + 1] * 1.2); // G
          overlay.data[i + 2] = Math.min(255, overlay.data[i + 2] * 1.2); // B
        }
        break;
    }
    
    ctx.putImageData(overlay, 0, 0);
  }
  
  // 更新房间音乐
  updateRoomMusic() {
    // 这里可以添加音乐播放逻辑
    console.log('Playing music:', this.roomState.music);
  }
  
  // 加载房间数据
  async loadRoomData() {
    try {
      const response = await fetch(`${API_BASE}/app/room/state`, {
        headers: authHeaders()
      });
      const data = await response.json();
      
      if (data.state) {
        this.roomState = data.state;
        this.updateRoomControls();
      }
    } catch (error) {
      console.error('Failed to load room data:', error);
    }
  }
  
  // 更新房间控件
  updateRoomControls() {
    const backgroundSelect = document.getElementById('room-background');
    const lightingSelect = document.getElementById('room-lighting');
    const musicSelect = document.getElementById('room-music');
    
    if (backgroundSelect) backgroundSelect.value = this.roomState.background;
    if (lightingSelect) lightingSelect.value = this.roomState.lighting;
    if (musicSelect) musicSelect.value = this.roomState.music;
  }
  
  // 绑定事件
  bindEvents() {
    // 监听标签切换
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('room-module-tab')) {
        const module = e.target.dataset.module;
        this.switchModule(module);
      }
    });
  }
  
  // 绑定房间面板事件
  bindRoomPanelEvents() {
    // 面板关闭事件
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('room-close')) {
        e.target.parentElement.parentElement.remove();
      }
    });
  }
  
  // 保存房间状态
  async saveRoomState() {
    try {
      await fetch(`${API_BASE}/app/room/state`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ state: this.roomState })
      });
    } catch (error) {
      console.error('Failed to save room state:', error);
    }
  }
}

// Sui模块 - 主持人对话
class SuiModule {
  constructor() {
    this.dialogues = [];
    this.currentDialogue = null;
    this.responses = [];
  }
  
  render() {
    return `
      <div class="sui-module">
        <h3>Sui 主持人对话</h3>
        <div class="sui-interface">
          <div class="sui-avatar">
            <div class="sui-avatar-image">🎭</div>
            <div class="sui-avatar-name">Sui</div>
          </div>
          <div class="sui-dialogue">
            <div class="sui-messages">
              ${this.renderMessages()}
            </div>
            <div class="sui-input">
              <input type="text" placeholder="输入你的消息..." id="sui-input">
              <button onclick="suiModule.sendMessage()">发送</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  
  renderMessages() {
    return this.dialogues.map(msg => `
      <div class="sui-message ${msg.type}">
        <div class="sui-message-content">${msg.content}</div>
        <div class="sui-message-time">${new Date(msg.timestamp).toLocaleTimeString()}</div>
      </div>
    `).join('');
  }
  
  load() {
    // 加载对话历史
    this.loadDialogueHistory();
  }
  
  async loadDialogueHistory() {
    try {
      const response = await fetch(`${API_BASE}/app/sui/dialogues`, {
        headers: authHeaders()
      });
      const data = await response.json();
      
      this.dialogues = data.dialogues || [];
      this.updateMessages();
    } catch (error) {
      console.error('Failed to load dialogue history:', error);
    }
  }
  
  async sendMessage() {
    const input = document.getElementById('sui-input');
    const content = input.value.trim();
    
    if (!content) return;
    
    // 添加用户消息
    this.dialogues.push({
      type: 'user',
      content: content,
      timestamp: new Date().toISOString()
    });
    
    // 获取Sui回复
    const response = await this.getSuiResponse(content);
    
    this.dialogues.push(response);
    this.updateMessages();
    input.value = '';
  }
  
  async getSuiResponse(message) {
    try {
      const response = await fetch(`${API_BASE}/app/sui/response`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message })
      });
      
      const data = await response.json();
      return {
        type: 'sui',
        content: data.response,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        type: 'sui',
        content: '抱歉，我暂时无法回复。',
        timestamp: new Date().toISOString()
      };
    }
  }
  
  updateMessages() {
    const messagesContainer = document.querySelector('.sui-messages');
    if (messagesContainer) {
      messagesContainer.innerHTML = this.renderMessages();
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }
}

// Tea模块 - 氛围系统
class TeaModule {
  constructor() {
    this.teaMoments = [];
    this.currentMood = 'calm';
    this.moodColors = {
      calm: '#87CEEB',
      energetic: '#FFD700',
      romantic: '#FF69B4',
      melancholy: '#9370DB'
    };
  }
  
  render() {
    return `
      <div class="tea-module">
        <h3>Tea 氛围系统</h3>
        <div class="tea-interface">
          <div class="tea-mood-selector">
            <div class="tea-mood-option ${this.currentMood === 'calm' ? 'active' : ''}" 
                 data-mood="calm" onclick="teaModule.selectMood('calm')">
              <div class="tea-mood-icon">☕</div>
              <div class="tea-mood-name">平静</div>
            </div>
            <div class="tea-mood-option ${this.currentMood === 'energetic' ? 'active' : ''}" 
                 data-mood="energetic" onclick="teaModule.selectMood('energetic')">
              <div class="tea-mood-icon">⚡</div>
              <div class="tea-mood-name">活力</div>
            </div>
            <div class="tea-mood-option ${this.currentMood === 'romantic' ? 'active' : ''}" 
                 data-mood="romantic" onclick="teaModule.selectMood('romantic')">
              <div class="tea-mood-icon">💕</div>
              <div class="tea-mood-name">浪漫</div>
            </div>
            <div class="tea-mood-option ${this.currentMood === 'melancholy' ? 'active' : ''}" 
                 data-mood="melancholy" onclick="teaModule.selectMood('melancholy')">
              <div class="tea-mood-icon">🌙</div>
              <div class="tea-mood-name">忧郁</div>
            </div>
          </div>
          <div class="tea-moments">
            <h4>茶歇时刻</h4>
            <div class="tea-moments-list">
              ${this.renderMoments()}
            </div>
            <div class="tea-moment-input">
              <input type="text" placeholder="记录一个茶歇时刻..." id="tea-input">
              <button onclick="teaModule.addMoment()">添加</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  
  renderMoments() {
    return this.teaMoments.map(moment => `
      <div class="tea-moment">
        <div class="tea-moment-content">${moment.content}</div>
        <div class="tea-moment-time">${new Date(moment.timestamp).toLocaleString()}</div>
        <div class="tea-mood-tag">${this.getMoodLabel(moment.mood)}</div>
      </div>
    `).join('');
  }
  
  getMoodLabel(mood) {
    const labels = {
      calm: '平静',
      energetic: '活力',
      romantic: '浪漫',
      melancholy: '忧郁'
    };
    return labels[mood] || '未知';
  }
  
  selectMood(mood) {
    this.currentMood = mood;
    this.updateMoodSelector();
    this.updateRoomMood();
  }
  
  updateMoodSelector() {
    document.querySelectorAll('.tea-mood-option').forEach(option => {
      const mood = option.dataset.mood;
      option.classList.toggle('active', mood === this.currentMood);
    });
  }
  
  updateRoomMood() {
    // 更新房间氛围
    const roomCanvas = document.getElementById('room-canvas');
    if (roomCanvas) {
      const ctx = roomCanvas.getContext('2d');
      
      // 添加氛围覆盖层
      const overlay = ctx.createImageData(roomCanvas.width, roomCanvas.height);
      const color = this.moodColors[this.currentMood];
      
      for (let i = 0; i < overlay.data.length; i += 4) {
        overlay.data[i] = parseInt(color.substr(1, 2), 16);     // R
        overlay.data[i + 1] = parseInt(color.substr(3, 2), 16); // G
        overlay.data[i + 2] = parseInt(color.substr(5, 2), 16); // B
        overlay.data[i + 3] = 50; // Alpha
      }
      
      ctx.putImageData(overlay, 0, 0);
    }
  }
  
  async addMoment() {
    const input = document.getElementById('tea-input');
    const content = input.value.trim();
    
    if (!content) return;
    
    const moment = {
      content: content,
      mood: this.currentMood,
      timestamp: new Date().toISOString()
    };
    
    this.teaMoments.push(moment);
    this.updateMoments();
    input.value = '';
    
    // 保存到服务器
    await this.saveMoment(moment);
  }
  
  async saveMoment(moment) {
    try {
      await fetch(`${API_BASE}/app/tea/moments`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(moment)
      });
    } catch (error) {
      console.error('Failed to save tea moment:', error);
    }
  }
  
  updateMoments() {
    const momentsContainer = document.querySelector('.tea-moments-list');
    if (momentsContainer) {
      momentsContainer.innerHTML = this.renderMoments();
    }
  }
  
  load() {
    // 加载茶歇时刻
    this.loadTeaMoments();
  }
  
  async loadTeaMoments() {
    try {
      const response = await fetch(`${API_BASE}/app/tea/moments`, {
        headers: authHeaders()
      });
      const data = await response.json();
      
      this.teaMoments = data.moments || [];
      this.updateMoments();
    } catch (error) {
      console.error('Failed to load tea moments:', error);
    }
  }
}

// 其他模块的简化版本
class StoryModule {
  constructor() {
    this.stories = [];
    this.currentStory = null;
  }
  
  render() {
    return `
      <div class="story-module">
        <h3>Story 分支叙事</h3>
        <div class="story-interface">
          <div class="story-selector">
            ${this.renderStorySelector()}
          </div>
          <div class="story-content">
            ${this.renderCurrentStory()}
          </div>
        </div>
      </div>
    `;
  }
  
  renderStorySelector() {
    return this.stories.map(story => `
      <div class="story-option" onclick="storyModule.selectStory('${story.id}')">
        ${story.title}
      </div>
    `).join('');
  }
  
  renderCurrentStory() {
    if (!this.currentStory) {
      return '<p>选择一个故事开始阅读</p>';
    }
    
    return `
      <div class="story-text">${this.currentStory.content}</div>
      <div class="story-choices">
        ${this.renderChoices()}
      </div>
    `;
  }
  
  renderChoices() {
    if (!this.currentStory || !this.currentStory.choices) {
      return '';
    }
    
    return this.currentStory.choices.map(choice => `
      <button class="story-choice" onclick="storyModule.makeChoice('${choice.id}')">
        ${choice.text}
      </button>
    `).join('');
  }
  
  selectStory(storyId) {
    this.currentStory = this.stories.find(s => s.id === storyId);
    this.updateStoryContent();
  }
  
  makeChoice(choiceId) {
    // 处理选择
    console.log('Choice made:', choiceId);
  }
  
  updateStoryContent() {
    const contentContainer = document.querySelector('.story-content');
    if (contentContainer) {
      contentContainer.innerHTML = this.renderCurrentStory();
    }
  }
  
  load() {
    this.loadStories();
  }
  
  async loadStories() {
    try {
      const response = await fetch(`${API_BASE}/app/stories`, {
        headers: authHeaders()
      });
      const data = await response.json();
      
      this.stories = data.stories || [];
      this.updateStorySelector();
    } catch (error) {
      console.error('Failed to load stories:', error);
    }
  }
  
  updateStorySelector() {
    const selectorContainer = document.querySelector('.story-selector');
    if (selectorContainer) {
      selectorContainer.innerHTML = this.renderStorySelector();
    }
  }
}

class TarotModule {
  constructor() {
    this.tarotDeck = [];
    this.currentReading = null;
  }
  
  render() {
    return `
      <div class="tarot-module">
        <h3>Tarot 塔罗牌</h3>
        <div class="tarot-interface">
          <div class="tarot-deck">
            <div class="tarot-card" onclick="tarotModule.drawCard()">
              <div class="tarot-card-back">🂠</div>
            </div>
          </div>
          <div class="tarot-reading">
            ${this.renderReading()}
          </div>
        </div>
      </div>
    `;
  }
  
  renderReading() {
    if (!this.currentReading) {
      return '<p>点击牌堆开始占卜</p>';
    }
    
    return `
      <div class="tarot-cards">
        ${this.currentReading.cards.map(card => `
          <div class="tarot-card">
            <div class="tarot-card-front">${card.symbol}</div>
            <div class="tarot-card-meaning">${card.meaning}</div>
          </div>
        `).join('')}
      </div>
      <div class="tarot-interpretation">
        <h4>解读</h4>
        <p>${this.currentReading.interpretation}</p>
      </div>
    `;
  }
  
  drawCard() {
    // 模拟抽牌
    const card = {
      symbol: '🂡',
      meaning: '开始',
      position: 'past'
    };
    
    this.currentReading = {
      cards: [card],
      interpretation: '这是一个新的开始。'
    };
    
    this.updateReading();
  }
  
  updateReading() {
    const readingContainer = document.querySelector('.tarot-reading');
    if (readingContainer) {
      readingContainer.innerHTML = this.renderReading();
    }
  }
  
  load() {
    this.loadTarotDeck();
  }
  
  async loadTarotDeck() {
    try {
      const response = await fetch(`${API_BASE}/app/tarot/deck`, {
        headers: authHeaders()
      });
      const data = await response.json();
      
      this.tarotDeck = data.cards || [];
    } catch (error) {
      console.error('Failed to load tarot deck:', error);
    }
  }
}

class WardrobeModule {
  constructor() {
    this.clothes = [];
    this.currentOutfit = null;
  }
  
  render() {
    return `
      <div class="wardrobe-module">
        <h3>Wardrobe 服装</h3>
        <div class="wardrobe-interface">
          <div class="wardrobe-clothes">
            ${this.renderClothes()}
          </div>
          <div class="wardrobe-outfit">
            ${this.renderOutfit()}
          </div>
        </div>
      </div>
    `;
  }
  
  renderClothes() {
    return this.clothes.map(item => `
      <div class="clothing-item" onclick="wardrobeModule.selectClothing('${item.id}')">
        <div class="clothing-icon">${item.icon}</div>
        <div class="clothing-name">${item.name}</div>
      </div>
    `).join('');
  }
  
  renderOutfit() {
    if (!this.currentOutfit) {
      return '<p>选择服装来搭配</p>';
    }
    
    return `
      <div class="outfit-display">
        ${this.currentOutfit.items.map(item => `
          <div class="outfit-item">
            <div class="outfit-icon">${item.icon}</div>
            <div class="outfit-name">${item.name}</div>
          </div>
        `).join('')}
      </div>
    `;
  }
  
  selectClothing(itemId) {
    const item = this.clothes.find(c => c.id === itemId);
    if (!item) return;
    
    if (!this.currentOutfit) {
      this.currentOutfit = { items: [item] };
    } else {
      // 检查是否已存在
      const existingIndex = this.currentOutfit.items.findIndex(i => i.id === itemId);
      if (existingIndex >= 0) {
        this.currentOutfit.items.splice(existingIndex, 1);
      } else {
        this.currentOutfit.items.push(item);
      }
    }
    
    this.updateOutfit();
  }
  
  updateOutfit() {
    const outfitContainer = document.querySelector('.wardrobe-outfit');
    if (outfitContainer) {
      outfitContainer.innerHTML = this.renderOutfit();
    }
  }
  
  load() {
    this.loadClothes();
  }
  
  async loadClothes() {
    try {
      const response = await fetch(`${API_BASE}/app/wardrobe/clothes`, {
        headers: authHeaders()
      });
      const data = await response.json();
      
      this.clothes = data.clothes || [];
      this.updateClothes();
    } catch (error) {
      console.error('Failed to load clothes:', error);
    }
  }
  
  updateClothes() {
    const clothesContainer = document.querySelector('.wardrobe-clothes');
    if (clothesContainer) {
      clothesContainer.innerHTML = this.renderClothes();
    }
  }
}

class SleepModule {
  constructor() {
    this.sleepData = [];
    this.currentSleep = null;
  }
  
  render() {
    return `
      <div class="sleep-module">
        <h3>Sleep 睡眠模式</h3>
        <div class="sleep-interface">
          <div class="sleep-controls">
            <button onclick="sleepModule.startSleep()">开始睡眠</button>
            <button onclick="sleepModule.stopSleep()">停止睡眠</button>
          </div>
          <div class="sleep-stats">
            ${this.renderSleepStats()}
          </div>
        </div>
      </div>
    `;
  }
  
  renderSleepStats() {
    if (!this.currentSleep) {
      return '<p>没有睡眠数据</p>';
    }
    
    return `
      <div class="sleep-info">
        <div class="sleep-duration">时长: ${this.currentSleep.duration}分钟</div>
        <div class="sleep-quality">质量: ${this.currentSleep.quality}%</div>
        <div class="sleep-time">时间: ${new Date(this.currentSleep.startTime).toLocaleString()}</div>
      </div>
    `;
  }
  
  startSleep() {
    this.currentSleep = {
      startTime: new Date().toISOString(),
      duration: 0,
      quality: 0
    };
    
    // 模拟睡眠
    this.simulateSleep();
  }
  
  simulateSleep() {
    let duration = 0;
    const interval = setInterval(() => {
      duration += 1;
      this.currentSleep.duration = duration;
      this.currentSleep.quality = Math.min(100, duration * 2);
      
      this.updateSleepStats();
      
      if (duration >= 30) { // 30秒模拟30分钟
        clearInterval(interval);
        this.saveSleepData();
      }
    }, 1000);
  }
  
  stopSleep() {
    if (this.currentSleep) {
      this.saveSleepData();
      this.currentSleep = null;
      this.updateSleepStats();
    }
  }
  
  updateSleepStats() {
    const statsContainer = document.querySelector('.sleep-stats');
    if (statsContainer) {
      statsContainer.innerHTML = this.renderSleepStats();
    }
  }
  
  async saveSleepData() {
    if (!this.currentSleep) return;
    
    try {
      await fetch(`${API_BASE}/app/sleep/record`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(this.currentSleep)
      });
      
      this.sleepData.push(this.currentSleep);
    } catch (error) {
      console.error('Failed to save sleep data:', error);
    }
  }
  
  load() {
    this.loadSleepData();
  }
  
  async loadSleepData() {
    try {
      const response = await fetch(`${API_BASE}/app/sleep/records`, {
        headers: authHeaders()
      });
      const data = await response.json();
      
      this.sleepData = data.records || [];
    } catch (error) {
      console.error('Failed to load sleep data:', error);
    }
  }
}

class PetModule {
  constructor() {
    this.pets = [];
    this.currentPet = null;
    this.petStates = {
      idle: '😴',
      happy: '😊',
      hungry: '🍽️',
      playing: '🎮'
    };
  }
  
  render() {
    return `
      <div class="pet-module">
        <h3>Pet 宠物</h3>
        <div class="pet-interface">
          <div class="pet-display">
            <div class="pet-avatar">
              <div class="pet-image">${this.currentPet ? this.petStates[this.currentPet.state] : '🐱'}</div>
              <div class="pet-name">${this.currentPet ? this.currentPet.name : '选择宠物'}</div>
            </div>
            <div class="pet-controls">
              <button onclick="petModule.feedPet()">喂食</button>
              <button onclick="petModule.playWithPet()">玩耍</button>
              <button onclick="petModule.petPet()">抚摸</button>
            </div>
          </div>
          <div class="pet-status">
            ${this.renderPetStatus()}
          </div>
        </div>
      </div>
    `;
  }
  
  renderPetStatus() {
    if (!this.currentPet) {
      return '<p>选择一个宠物</p>';
    }
    
    return `
      <div class="pet-info">
        <div class="pet-hunger">饥饿度: ${this.currentPet.hunger}%</div>
        <div class="pet-happiness">快乐度: ${this.currentPet.happiness}%</div>
        <div class="pet-energy">精力: ${this.currentPet.energy}%</div>
      </div>
    `;
  }
  
  selectPet(petId) {
    this.currentPet = this.pets.find(p => p.id === petId);
    this.updatePetDisplay();
  }
  
  feedPet() {
    if (!this.currentPet) return;
    
    this.currentPet.hunger = Math.max(0, this.currentPet.hunger - 20);
    this.currentPet.happiness = Math.min(100, this.currentPet.happiness + 10);
    this.updatePetStatus();
  }
  
  playWithPet() {
    if (!this.currentPet) return;
    
    this.currentPet.happiness = Math.min(100, this.currentPet.happiness + 20);
    this.currentPet.energy = Math.max(0, this.currentPet.energy - 15);
    this.currentPet.state = 'playing';
    this.updatePetDisplay();
    this.updatePetStatus();
  }
  
  petPet() {
    if (!this.currentPet) return;
    
    this.currentPet.happiness = Math.min(100, this.currentPet.happiness + 5);
    this.currentPet.state = 'happy';
    this.updatePetDisplay();
    this.updatePetStatus();
  }
  
  updatePetDisplay() {
    const avatar = document.querySelector('.pet-image');
    if (avatar && this.currentPet) {
      avatar.textContent = this.petStates[this.currentPet.state];
    }
  }
  
  updatePetStatus() {
    const statusContainer = document.querySelector('.pet-status');
    if (statusContainer) {
      statusContainer.innerHTML = this.renderPetStatus();
    }
  }
  
  load() {
    this.loadPets();
  }
  
  async loadPets() {
    try {
      const response = await fetch(`${API_BASE}/app/pets`, {
        headers: authHeaders()
      });
      const data = await response.json();
      
      this.pets = data.pets || [];
      if (this.pets.length > 0) {
        this.currentPet = this.pets[0];
        this.updatePetDisplay();
        this.updatePetStatus();
      }
    } catch (error) {
      console.error('Failed to load pets:', error);
    }
  }
}

// 初始化插件
const roomPlugin = new RoomPlugin();
window.roomPlugin = roomPlugin;

// 初始化各个模块
const suiModule = new SuiModule();
window.suiModule = suiModule;

const teaModule = new TeaModule();
window.teaModule = teaModule;

const storyModule = new StoryModule();
window.storyModule = storyModule;

const tarotModule = new TarotModule();
window.tarotModule = tarotModule;

const wardrobeModule = new WardrobeModule();
window.wardrobeModule = wardrobeModule;

const sleepModule = new SleepModule();
window.sleepModule = sleepModule;

const petModule = new PetModule();
window.petModule = petModule;