/* ════════════ AI长期记忆系统增强插件 ═══════════
   基于 InternalBeyond Memory 系统的完整实现
   功能：情感坐标、重要性评分、自然衰减、星图可视化、时间轴展示
*/

class MemoryEnhancedPlugin {
  constructor() {
    this.memories = [];
    this.emotionalCoords = new Map(); // 情感坐标：效价/唤醒度
    this.importanceScores = new Map(); // 重要性评分
    this.decayRates = new Map(); // 自然衰减率
    this.topMemories = []; // 置顶记忆（最多7条）
    this.visibilityLevels = ['private', 'ai_only', 'friends', 'public']; // 四种可见性级别
    
    this.init();
  }
  
  init() {
    console.log('Memory Enhanced Plugin initialized');
    this.loadMemories();
    this.createMemoryInterface();
    this.bindEvents();
  }
  
  // 加载记忆数据
  async loadMemories() {
    try {
      const response = await fetch(`${API_BASE}/app/memory/list`, {
        headers: authHeaders()
      });
      const data = await response.json();
      
      if (data.memories) {
        this.memories = data.memories;
        this.processMemories();
        this.renderMemoryGalaxy();
      }
    } catch (error) {
      console.error('Failed to load memories:', error);
    }
  }
  
  // 处理记忆数据
  processMemories() {
    this.memories.forEach(memory => {
      // 计算情感坐标
      if (memory.emotion) {
        this.emotionalCoords.set(memory.id, {
          valence: memory.emotion.valence || 0.5, // 效价：-1到1
          arousal: memory.emotion.arousal || 0.5  // 唤醒度：0到1
        });
      }
      
      // 计算重要性评分
      if (memory.importance) {
        this.importanceScores.set(memory.id, memory.importance);
      } else {
        // 自动计算重要性：基于长度、新鲜度、互动次数
        const importance = this.calculateImportance(memory);
        this.importanceScores.set(memory.id, importance);
      }
      
      // 计算衰减率
      const decayRate = this.calculateDecayRate(memory);
      this.decayRates.set(memory.id, decayRate);
      
      // 更新置顶记忆
      this.updateTopMemories(memory);
    });
  }
  
  // 计算重要性评分
  calculateImportance(memory) {
    const age = Date.now() - new Date(memory.createdAt).getTime();
    const daysSinceCreation = age / (1000 * 60 * 60 * 24);
    
    // 基础重要性
    let importance = 0.5;
    
    // 长度影响
    const lengthFactor = Math.min(memory.content.length / 500, 1) * 0.3;
    importance += lengthFactor;
    
    // 新鲜度影响（最近7天更高）
    if (daysSinceCreation < 7) {
      importance += 0.2;
    } else if (daysSinceCreation < 30) {
      importance += 0.1;
    }
    
    // 互动次数影响
    if (memory.interactions) {
      const interactionFactor = Math.min(memory.interactions.length * 0.05, 0.2);
      importance += interactionFactor;
    }
    
    return Math.min(importance, 1);
  }
  
  // 计算衰减率
  calculateDecayRate(memory) {
    const age = Date.now() - new Date(memory.createdAt).getTime();
    const daysSinceCreation = age / (1000 * 60 * 60 * 24);
    
    // 基础衰减率
    let decayRate = 0.01; // 每天衰减1%
    
    // 重要性高的记忆衰减更慢
    const importance = this.importanceScores.get(memory.id) || 0.5;
    decayRate *= (1 - importance * 0.5);
    
    // 互动过的记忆衰减更慢
    if (memory.interactions && memory.interactions.length > 0) {
      decayRate *= 0.7;
    }
    
    return decayRate;
  }
  
  // 更新置顶记忆
  updateTopMemories(memory) {
    const importance = this.importanceScores.get(memory.id) || 0;
    
    // 移除现有置顶记忆
    this.topMemories = this.topMemories.filter(m => m.id !== memory.id);
    
    // 添加到置顶列表（按重要性排序）
    this.topMemories.push({
      id: memory.id,
      content: memory.content,
      importance: importance,
      createdAt: memory.createdAt
    });
    
    // 保持最多7条
    this.topMemories.sort((a, b) => b.importance - a.importance);
    this.topMemories = this.topMemories.slice(0, 7);
  }
  
  // 创建记忆界面
  createMemoryInterface() {
    // 创建记忆管理按钮
    const memoryBtn = document.createElement('div');
    memoryBtn.className = 'memory-enhanced-btn';
    memoryBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7L12 12L22 7L12 2Z"></path>
        <path d="M2 17L12 22L22 17"></path>
        <path d="M2 12L12 17L22 12"></path>
      </svg>
      <span>记忆增强</span>
    `;
    memoryBtn.onclick = () => this.openMemoryPanel();
    
    // 添加到主界面
    const mainContainer = document.querySelector('.main-container');
    if (mainContainer) {
      mainContainer.appendChild(memoryBtn);
    }
  }
  
  // 打开记忆面板
  openMemoryPanel() {
    const panel = document.createElement('div');
    panel.id = 'memory-enhanced-panel';
    panel.className = 'memory-panel';
    panel.innerHTML = `
      <div class="memory-panel-header">
        <h2>记忆银河</h2>
        <button class="memory-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
      <div class="memory-panel-content">
        <div class="memory-tabs">
          <button class="memory-tab active" data-tab="galaxy">星图</button>
          <button class="memory-tab" data-tab="timeline">时间轴</button>
          <button class="memory-tab" data-tab="top">置顶</button>
          <button class="memory-tab" data-tab="create">创建</button>
        </div>
        <div class="memory-tab-content">
          <div class="memory-tab-pane active" id="galaxy-pane">
            ${this.renderGalaxyView()}
          </div>
          <div class="memory-tab-pane" id="timeline-pane">
            ${this.renderTimelineView()}
          </div>
          <div class="memory-tab-pane" id="top-pane">
            ${this.renderTopMemories()}
          </div>
          <div class="memory-tab-pane" id="create-pane">
            ${this.renderCreateMemory()}
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(panel);
    this.bindMemoryPanelEvents();
  }
  
  // 渲染星图视图
  renderGalaxyView() {
    return `
      <div class="galaxy-container">
        <div class="galaxy-canvas" id="galaxy-canvas">
          <!-- 星图将通过Canvas渲染 -->
        </div>
        <div class="galaxy-controls">
          <button class="galaxy-control" onclick="memoryPlugin.zoomGalaxy(1.2)">放大</button>
          <button class="galaxy-control" onclick="memoryPlugin.zoomGalaxy(0.8)">缩小</button>
          <button class="galaxy-control" onclick="memoryPlugin.resetGalaxy()">重置</button>
        </div>
      </div>
    `;
  }
  
  // 渲染时间轴视图
  renderTimelineView() {
    const sortedMemories = [...this.memories].sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );
    
    return `
      <div class="timeline-container">
        <div class="timeline">
          ${sortedMemories.map(memory => `
            <div class="memory-timeline-item" data-id="${memory.id}">
              <div class="memory-timeline-date">${new Date(memory.createdAt).toLocaleDateString()}</div>
              <div class="memory-timeline-content">${memory.content.substring(0, 100)}...</div>
              <div class="memory-timeline-emotion">
                情感: ${this.getEmotionLabel(memory.id)}
              </div>
              <div class="memory-timeline-importance">
                重要性: ${this.getImportanceLabel(memory.id)}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  // 渲染置顶记忆
  renderTopMemories() {
    return `
      <div class="top-memories">
        <h3>置顶记忆</h3>
        <div class="top-memories-list">
          ${this.topMemories.map(memory => {
            const fullMemory = this.memories.find(m => m.id === memory.id);
            return `
              <div class="top-memory-item">
                <div class="top-memory-content">${fullMemory.content}</div>
                <div class="top-memory-meta">
                  重要性: ${(memory.importance * 100).toFixed(0)}%
                  <button class="remove-top" onclick="memoryPlugin.removeFromTop('${memory.id}')">移除</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }
  
  // 渲染创建记忆界面
  renderCreateMemory() {
    return `
      <div class="create-memory-form">
        <h3>创建新记忆</h3>
        <textarea id="memory-content" placeholder="记录你的想法..." rows="6"></textarea>
        <div class="memory-options">
          <div class="memory-option">
            <label>情感效价:</label>
            <input type="range" id="memory-valence" min="-1" max="1" step="0.1" value="0">
            <span id="valence-value">0</span>
          </div>
          <div class="memory-option">
            <label>情感唤醒度:</label>
            <input type="range" id="memory-arousal" min="0" max="1" step="0.1" value="0.5">
            <span id="arousal-value">0.5</span>
          </div>
          <div class="memory-option">
            <label>可见性:</label>
            <select id="memory-visibility">
              <option value="private">仅自己</option>
              <option value="ai_only">仅AI</option>
              <option value="friends">好友</option>
              <option value="public">公开</option>
            </select>
          </div>
        </div>
        <button class="memory-create-btn" onclick="memoryPlugin.createMemory()">创建记忆</button>
      </div>
    `;
  }
  
  // 创建记忆
  async createMemory() {
    const content = document.getElementById('memory-content').value.trim();
    if (!content) return;
    
    const valence = parseFloat(document.getElementById('memory-valence').value);
    const arousal = parseFloat(document.getElementById('memory-arousal').value);
    const visibility = document.getElementById('memory-visibility').value;
    
    try {
      const response = await fetch(`${API_BASE}/app/memory/create`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          content,
          emotion: { valence, arousal },
          visibility,
          importance: 0.5
        })
      });
      
      const result = await response.json();
      if (result.success) {
        // 重新加载记忆
        this.loadMemories();
        // 切换到星图视图
        this.switchMemoryTab('galaxy');
      }
    } catch (error) {
      console.error('Failed to create memory:', error);
    }
  }
  
  // 更新情感坐标
  updateMemoryEmotion(memoryId, valence, arousal) {
    this.emotionalCoords.set(memoryId, { valence, arousal });
    this.renderGalaxy();
  }
  
  // 获取情感标签
  getEmotionLabel(memoryId) {
    const emotion = this.emotionalCoords.get(memoryId);
    if (!emotion) return '中性';
    
    const { valence, arousal } = emotion;
    if (valence > 0.3 && arousal > 0.7) return '兴奋';
    if (valence > 0.3 && arousal < 0.3) return '愉悦';
    if (valence < -0.3 && arousal > 0.7) return '愤怒';
    if (valence < -0.3 && arousal < 0.3) return '悲伤';
    return '中性';
  }
  
  // 获取重要性标签
  getImportanceLabel(memoryId) {
    const importance = this.importanceScores.get(memoryId) || 0;
    return (importance * 100).toFixed(0) + '%';
  }
  
  // 从置顶移除
  removeFromTop(memoryId) {
    this.topMemories = this.topMemories.filter(m => m.id !== memoryId);
    this.renderTopMemories();
  }
  
  // 绑定事件
  bindEvents() {
    // 监听标签切换
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('memory-tab')) {
        const tab = e.target.dataset.tab;
        this.switchMemoryTab(tab);
      }
    });
    
    // 监听情感滑块变化
    document.addEventListener('input', (e) => {
      if (e.target.id === 'memory-valence') {
        document.getElementById('valence-value').textContent = e.target.value;
      }
      if (e.target.id === 'memory-arousal') {
        document.getElementById('arousal-value').textContent = e.target.value;
      }
    });
  }
  
  // 绑定记忆面板事件
  bindMemoryPanelEvents() {
    // 面板关闭事件
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('memory-close')) {
        e.target.parentElement.parentElement.remove();
      }
    });
  }
  
  // 切换记忆标签
  switchMemoryTab(tab) {
    // 更新标签状态
    document.querySelectorAll('.memory-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    
    // 更新内容显示
    document.querySelectorAll('.memory-tab-pane').forEach(p => p.classList.remove('active'));
    document.getElementById(`${tab}-pane`).classList.add('active');
    
    // 渲染相应视图
    if (tab === 'galaxy') {
      this.renderGalaxy();
    } else if (tab === 'timeline') {
      this.renderTimeline();
    } else if (tab === 'top') {
      this.renderTopMemories();
    }
  }
  
  // 渲染星图
  renderGalaxy() {
    const canvas = document.getElementById('galaxy-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    // 清空画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 绘制背景
    const gradient = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, 0,
      canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) / 2
    );
    gradient.addColorStop(0, 'rgba(25, 25, 112, 0.8)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.9)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 绘制记忆星点
    this.memories.forEach((memory, index) => {
      const emotion = this.emotionalCoords.get(memory.id);
      const importance = this.importanceScores.get(memory.id) || 0;
      
      if (emotion) {
        // 将情感坐标转换为画布坐标
        const x = (emotion.valence + 1) * canvas.width / 2;
        const y = (1 - emotion.arousal) * canvas.height / 2;
        
        // 根据重要性设置星星大小
        const size = 3 + importance * 10;
        
        // 设置颜色
        const hue = (emotion.valence + 1) * 180; // 从红色到蓝色
        const saturation = emotion.arousal * 100;
        const lightness = 50 + importance * 30;
        
        ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
        ctx.shadowBlur = 10 + importance * 20;
        ctx.shadowColor = ctx.fillStyle;
        
        // 绘制星星
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
        
        // 绘制星星光芒
        if (importance > 0.7) {
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x - size * 2, y);
          ctx.lineTo(x + size * 2, y);
          ctx.moveTo(x, y - size * 2);
          ctx.lineTo(x, y + size * 2);
          ctx.stroke();
        }
        
        // 绘制记忆标签
        if (importance > 0.5) {
          ctx.fillStyle = 'white';
          ctx.font = '10px Arial';
          ctx.fillText(memory.content.substring(0, 10), x + size + 5, y);
        }
      }
    });
    
    // 绘制坐标轴
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // X轴（效价）
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    // Y轴（唤醒度）
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();
    
    // 绘制轴标签
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '12px Arial';
    ctx.fillText('效价', canvas.width - 30, canvas.height / 2 - 10);
    ctx.fillText('唤醒度', canvas.width / 2 + 10, 20);
  }
  
  // 渲染时间轴
  renderTimeline() {
    const timelineContainer = document.getElementById('timeline-pane');
    if (!timelineContainer) return;
    
    timelineContainer.innerHTML = this.renderTimelineView();
  }
  
  // 缩放星图
  zoomGalaxy(factor) {
    const canvas = document.getElementById('galaxy-canvas');
    if (!canvas) return;
    
    const currentWidth = canvas.width;
    const currentHeight = canvas.height;
    
    canvas.width = currentWidth * factor;
    canvas.height = currentHeight * factor;
    
    this.renderGalaxy();
  }
  
  // 重置星图
  resetGalaxy() {
    const canvas = document.getElementById('galaxy-canvas');
    if (!canvas) return;
    
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    this.renderGalaxy();
  }
  
  // 渲染记忆银河（用于galaxy.html）
  renderMemoryGalaxy() {
    // 扩展现有galaxy.html的功能
    if (window.galaxyInitialized) {
      window.galaxyEnhanced = true;
      window.memoryPlugin = this;
    }
  }
}

// 初始化插件
const memoryPlugin = new MemoryEnhancedPlugin();
window.memoryPlugin = memoryPlugin;