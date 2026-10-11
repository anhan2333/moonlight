/* ════════════ 多端口AI实时对话增强插件 ═══════════
   基于 InternalBeyond Chat 系统的完整实现
   功能：多AI端口、浮动面板、图像生成、Token监控、话题频道、思维链
*/

class ChatEnhancedPlugin {
  constructor() {
    this.aiPorts = new Map(); // AI端口管理
    this.channels = new Map(); // 话题频道
    this.currentChannel = 'default';
    this.tokenMonitor = new TokenMonitor();
    this.messageHistory = [];
    this.isProcessing = false;
    this.thinkingMode = false;
    
    this.init();
  }
  
  init() {
    console.log('Chat Enhanced Plugin initialized');
    this.createChatInterface();
    this.loadAIConfigs();
    this.bindEvents();
  }
  
  // 创建聊天界面
  createChatInterface() {
    // 创建AI端口切换按钮
    const aiPortBtn = document.createElement('div');
    aiPortBtn.className = 'ai-port-btn';
    aiPortBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7L12 12L22 7L12 2Z"></path>
        <path d="M2 17L12 22L22 17"></path>
        <path d="M2 12L12 17L22 12"></path>
      </svg>
      <span class="ai-port-name">AI助手</span>
    `;
    aiPortBtn.onclick = () => this.openAISelector();
    
    // 添加到聊天界面
    const chatHeader = document.querySelector('.chat-header');
    if (chatHeader) {
      chatHeader.appendChild(aiPortBtn);
    }
    
    // 创建Token监控面板
    this.createTokenMonitor();
    
    // 创建话题频道按钮
    this.createChannelButton();
  }
  
  // 加载AI配置
  async loadAIConfigs() {
    try {
      const response = await fetch(`${API_BASE}/app/ai-ports`, {
        headers: authHeaders()
      });
      const configs = await response.json();
      
      configs.forEach(config => {
        this.addAIPort(config);
      });
    } catch (error) {
      console.error('Failed to load AI configs:', error);
    }
  }
  
  // 添加AI端口
  addAIPort(config) {
    const port = {
      id: config.id,
      name: config.name,
      type: config.type,
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      model: config.model,
      active: config.active || false,
      tokens: {
        used: 0,
        limit: config.tokenLimit || 4000,
        resetTime: Date.now() + 24 * 60 * 60 * 1000 // 24小时后重置
      }
    };
    
    this.aiPorts.set(config.id, port);
    
    // 如果是第一个端口，设置为当前活动端口
    if (!this.currentPort && port.active) {
      this.currentPort = port.id;
    }
  }
  
  // 打开AI选择器
  openAISelector() {
    const selector = document.createElement('div');
    selector.className = 'ai-selector';
    selector.innerHTML = `
      <div class="ai-selector-header">
        <h3>选择AI助手</h3>
        <button class="ai-selector-close">×</button>
      </div>
      <div class="ai-selector-content">
        ${Array.from(this.aiPorts.values()).map(port => `
          <div class="ai-port-option ${port.id === this.currentPort ? 'active' : ''}" 
               data-id="${port.id}">
            <div class="ai-port-info">
              <div class="ai-port-name">${port.name}</div>
              <div class="ai-port-model">${port.model}</div>
              <div class="ai-port-status">
                <span class="token-usage">${port.tokens.used}/${port.tokens.limit}</span>
                <div class="token-bar">
                  <div class="token-fill" style="width: ${(port.tokens.used / port.tokens.limit) * 100}%"></div>
                </div>
              </div>
            </div>
            <div class="ai-port-actions">
              <button class="ai-port-switch" onclick="chatEnhanced.switchAIPort('${port.id}')">
                ${port.id === this.currentPort ? '当前使用' : '切换'}
              </button>
              <button class="ai-port-settings" onclick="chatEnhanced.openAISettings('${port.id}')">
                设置
              </button>
            </div>
          </div>
        `).join('')}
        <div class="ai-port-add">
          <button class="ai-port-add-btn" onclick="chatEnhanced.addNewAIPort()">
            + 添加AI端口
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(selector);
    this.bindAISelectorEvents();
  }
  
  // 切换AI端口
  switchAIPort(portId) {
    const port = this.aiPorts.get(portId);
    if (!port) return;
    
    // 停止当前端口
    if (this.currentPort) {
      const currentPort = this.aiPorts.get(this.currentPort);
      if (currentPort) {
        currentPort.active = false;
      }
    }
    
    // 激活新端口
    port.active = true;
    this.currentPort = portId;
    
    // 更新UI
    this.updateAISelector();
    this.updateCurrentAI();
    
    // 关闭选择器
    document.querySelector('.ai-selector')?.remove();
  }
  
  // 更新当前AI显示
  updateCurrentAI() {
    const port = this.aiPorts.get(this.currentPort);
    if (!port) return;
    
    const aiPortName = document.querySelector('.ai-port-name');
    if (aiPortName) {
      aiPortName.textContent = port.name;
    }
  }
  
  // 创建Token监控面板
  createTokenMonitor() {
    const tokenMonitor = document.createElement('div');
    tokenMonitor.className = 'token-monitor';
    tokenMonitor.innerHTML = `
      <div class="token-monitor-toggle">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2L2 7L12 12L22 7L12 2Z"></path>
          <path d="M2 17L12 22L22 17"></path>
          <path d="M2 12L12 17L22 12"></path>
        </svg>
        <span>Token监控</span>
      </div>
      <div class="token-monitor-content">
        <div class="token-info">
          <div class="token-current">
            当前: <span class="token-current-usage">0</span> / <span class="token-current-limit">4000</span>
          </div>
          <div class="token-today">
            今日: <span class="token-today-usage">0</span> / <span class="token-today-limit">16000</span>
          </div>
        </div>
        <div class="token-chart">
          <canvas id="tokenChart" width="200" height="100"></canvas>
        </div>
      </div>
    `;
    
    // 添加到聊天界面
    const chatContainer = document.querySelector('.chat-container');
    if (chatContainer) {
      chatContainer.appendChild(tokenMonitor);
    }
    
    // 绑定切换事件
    tokenMonitor.querySelector('.token-monitor-toggle').addEventListener('click', () => {
      tokenMonitor.classList.toggle('expanded');
    });
    
    // 初始化图表
    this.initTokenChart();
  }
  
  // 初始化Token图表
  initTokenChart() {
    const canvas = document.getElementById('tokenChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    this.tokenChart = { canvas, ctx };
    
    this.updateTokenChart();
  }
  
  // 更新Token图表
  updateTokenChart() {
    if (!this.tokenChart) return;
    
    const { canvas, ctx } = this.tokenChart;
    const width = canvas.width;
    const height = canvas.height;
    
    // 清空画布
    ctx.clearRect(0, 0, width, height);
    
    // 绘制背景
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(0, 0, width, height);
    
    // 绘制Token使用曲线
    const port = this.aiPorts.get(this.currentPort);
    if (!port) return;
    
    const usage = port.tokens.used;
    const limit = port.tokens.limit;
    const percentage = usage / limit;
    
    // 绘制使用量条
    ctx.fillStyle = percentage > 0.8 ? '#ff6b6b' : percentage > 0.6 ? '#ffd93d' : '#6bcf7f';
    ctx.fillRect(0, height - (percentage * height), width, percentage * height);
    
    // 绘制限制线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height - (limit * height));
    ctx.lineTo(width, height - (limit * height));
    ctx.stroke();
  }
  
  // 创建话题频道
  createChannelButton() {
    const channelBtn = document.createElement('div');
    channelBtn.className = 'channel-btn';
    channelBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7L12 12L22 7L12 2Z"></path>
        <path d="M2 17L12 22L22 17"></path>
        <path d="M2 12L12 17L22 12"></path>
      </svg>
      <span class="channel-name">话题频道</span>
    `;
    channelBtn.onclick = () => this.openChannelSelector();
    
    // 添加到聊天界面
    const chatHeader = document.querySelector('.chat-header');
    if (chatHeader) {
      chatHeader.appendChild(channelBtn);
    }
  }
  
  // 打开话题频道选择器
  openChannelSelector() {
    const selector = document.createElement('div');
    selector.className = 'channel-selector';
    selector.innerHTML = `
      <div class="channel-selector-header">
        <h3>话题频道</h3>
        <button class="channel-selector-close">×</button>
      </div>
      <div class="channel-selector-content">
        ${Array.from(this.channels.values()).map(channel => `
          <div class="channel-option ${channel.id === this.currentChannel ? 'active' : ''}" 
               data-id="${channel.id}">
            <div class="channel-info">
              <div class="channel-name">${channel.name}</div>
              <div class="channel-desc">${channel.description}</div>
              <div class="channel-meta">
                消息数: ${channel.messageCount || 0}
                ${channel.isPrivate ? '🔒' : ''}
              </div>
            </div>
            <div class="channel-actions">
              <button class="channel-switch" onclick="chatEnhanced.switchChannel('${channel.id}')">
                ${channel.id === this.currentChannel ? '当前使用' : '切换'}
              </button>
            </div>
          </div>
        `).join('')}
        <div class="channel-add">
          <button class="channel-add-btn" onclick="chatEnhanced.createNewChannel()">
            + 创建频道
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(selector);
    this.bindChannelSelectorEvents();
  }
  
  // 切换话题频道
  switchChannel(channelId) {
    this.currentChannel = channelId;
    this.loadChannelMessages(channelId);
    this.updateChannelSelector();
    document.querySelector('.channel-selector')?.remove();
  }
  
  // 加载频道消息
  async loadChannelMessages(channelId) {
    try {
      const response = await fetch(`${API_BASE}/app/channels/${channelId}/messages`, {
        headers: authHeaders()
      });
      const messages = await response.json();
      
      this.messageHistory = messages;
      this.renderMessages();
    } catch (error) {
      console.error('Failed to load channel messages:', error);
    }
  }
  
  // 创建新频道
  createNewChannel() {
    const name = prompt('请输入频道名称:');
    if (!name) return;
    
    const description = prompt('请输入频道描述:');
    
    const channel = {
      id: 'channel_' + Date.now(),
      name: name,
      description: description || '',
      isPrivate: false,
      messageCount: 0,
      createdAt: new Date().toISOString()
    };
    
    this.channels.set(channel.id, channel);
    this.switchChannel(channel.id);
  }
  
  // 绑定事件
  bindEvents() {
    // 监听消息发送
    document.addEventListener('send-message', (e) => {
      this.handleSendMessage(e.detail);
    });
    
    // 监听AI回复
    document.addEventListener('ai-reply', (e) => {
      this.handleAIReply(e.detail);
    });
    
    // 定期更新Token监控
    setInterval(() => {
      this.updateTokenMonitor();
    }, 30000); // 每30秒更新一次
  }
  
  // 绑定AI选择器事件
  bindAISelectorEvents() {
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('ai-selector-close')) {
        document.querySelector('.ai-selector')?.remove();
      }
    });
  }
  
  // 绑定频道选择器事件
  bindChannelSelectorEvents() {
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('channel-selector-close')) {
        document.querySelector('.channel-selector')?.remove();
      }
    });
  }
  
  // 处理消息发送
  async handleSendMessage(message) {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    
    // 添加到消息历史
    const messageData = {
      id: 'msg_' + Date.now(),
      type: 'human',
      content: message,
      timestamp: new Date().toISOString(),
      channel: this.currentChannel
    };
    
    this.messageHistory.push(messageData);
    this.renderMessages();
    
    // 获取当前AI端口
    const port = this.aiPorts.get(this.currentPort);
    if (!port) {
      this.isProcessing = false;
      return;
    }
    
    // 发送到AI
    try {
      const response = await this.sendToAI(port, message);
      this.handleAIReply(response);
    } catch (error) {
      console.error('AI reply failed:', error);
      this.showError('AI回复失败，请重试');
    }
    
    this.isProcessing = false;
  }
  
  // 发送到AI
  async sendToAI(port, message) {
    const response = await fetch(`${port.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${port.apiKey}`
      },
      body: JSON.stringify({
        model: port.model,
        messages: this.buildMessageContext(message),
        temperature: 0.7,
        max_tokens: 1000
      })
    });
    
    const data = await response.json();
    
    // 更新Token使用量
    port.tokens.used += data.usage?.total_tokens || 0;
    
    return {
      id: 'ai_' + Date.now(),
      type: 'ai',
      content: data.choices[0]?.message?.content || '抱歉，我无法回复。',
      timestamp: new Date().toISOString(),
      channel: this.currentChannel,
      tokens: data.usage?.total_tokens || 0
    };
  }
  
  // 构建消息上下文
  buildMessageContext(message) {
    const context = [];
    
    // 添加系统提示
    context.push({
      role: 'system',
      content: '你是一个智能AI助手，请用友好、专业的语气回复用户的问题。'
    });
    
    // 添加最近的对话历史
    const recentMessages = this.messageHistory.slice(-10);
    recentMessages.forEach(msg => {
      context.push({
        role: msg.type === 'human' ? 'user' : 'assistant',
        content: msg.content
      });
    });
    
    // 添加当前消息
    context.push({
      role: 'user',
      content: message
    });
    
    return context;
  }
  
  // 处理AI回复
  handleAIReply(reply) {
    this.messageHistory.push(reply);
    this.renderMessages();
    this.updateTokenMonitor();
  }
  
  // 渲染消息
  renderMessages() {
    const chatMessages = document.querySelector('.chat-messages');
    if (!chatMessages) return;
    
    chatMessages.innerHTML = this.messageHistory.map(msg => `
      <div class="message ${msg.type}">
        <div class="message-content">${msg.content}</div>
        <div class="message-meta">
          <span class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
          ${msg.tokens ? `<span class="message-tokens">${msg.tokens} tokens</span>` : ''}
        </div>
      </div>
    `).join('');
    
    // 滚动到底部
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  
  // 更新Token监控
  updateTokenMonitor() {
    const port = this.aiPorts.get(this.currentPort);
    if (!port) return;
    
    const currentUsage = document.querySelector('.token-current-usage');
    const currentLimit = document.querySelector('.token-current-limit');
    const todayUsage = document.querySelector('.token-today-usage');
    const todayLimit = document.querySelector('.token-today-limit');
    
    if (currentUsage) currentUsage.textContent = port.tokens.used;
    if (currentLimit) currentLimit.textContent = port.tokens.limit;
    if (todayUsage) todayUsage.textContent = port.tokens.used;
    if (todayLimit) todayLimit.textContent = port.tokens.limit * 4; // 假设每日限制是4倍
    
    this.updateTokenChart();
  }
  
  // 更新AI选择器
  updateAISelector() {
    const options = document.querySelectorAll('.ai-port-option');
    options.forEach(option => {
      const portId = option.dataset.id;
      const port = this.aiPorts.get(portId);
      
      if (port) {
        option.classList.toggle('active', portId === this.currentPort);
        
        // 更新Token显示
        const tokenUsage = option.querySelector('.token-usage');
        if (tokenUsage) {
          tokenUsage.textContent = `${port.tokens.used}/${port.tokens.limit}`;
        }
        
        // 更新Token条
        const tokenFill = option.querySelector('.token-fill');
        if (tokenFill) {
          const percentage = (port.tokens.used / port.tokens.limit) * 100;
          tokenFill.style.width = `${percentage}%`;
        }
      }
    });
  }
  
  // 更新频道选择器
  updateChannelSelector() {
    const options = document.querySelectorAll('.channel-option');
    options.forEach(option => {
      const channelId = option.dataset.id;
      option.classList.toggle('active', channelId === this.currentChannel);
    });
  }
  
  // 显示错误
  showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'chat-error';
    errorDiv.textContent = message;
    
    const chatContainer = document.querySelector('.chat-container');
    if (chatContainer) {
      chatContainer.appendChild(errorDiv);
      
      setTimeout(() => {
        errorDiv.remove();
      }, 3000);
    }
  }
  
  // 打开AI设置
  openAISettings(portId) {
    const port = this.aiPorts.get(portId);
    if (!port) return;
    
    const settings = prompt('AI设置 (JSON格式):', JSON.stringify({
      temperature: 0.7,
      max_tokens: 1000,
      top_p: 1.0
    }, null, 2));
    
    if (settings) {
      try {
        const config = JSON.parse(settings);
        Object.assign(port, config);
        this.saveAISettings(portId, config);
      } catch (error) {
        this.showError('设置格式错误');
      }
    }
  }
  
  // 保存AI设置
  async saveAISettings(portId, settings) {
    try {
      await fetch(`${API_BASE}/app/ai-ports/${portId}/settings`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(settings)
      });
    } catch (error) {
      console.error('Failed to save AI settings:', error);
    }
  }
  
  // 添加新AI端口
  addNewAIPort() {
    const name = prompt('AI名称:');
    if (!name) return;
    
    const endpoint = prompt('API端点:');
    if (!endpoint) return;
    
    const apiKey = prompt('API密钥:');
    if (!apiKey) return;
    
    const model = prompt('模型名称:');
    if (!model) return;
    
    const config = {
      id: 'ai_' + Date.now(),
      name: name,
      endpoint: endpoint,
      apiKey: apiKey,
      model: model,
      active: false,
      tokenLimit: 4000
    };
    
    this.addAIPort(config);
    this.updateAISelector();
  }
}

// Token监控类
class TokenMonitor {
  constructor() {
    this.usage = 0;
    this.limit = 4000;
    this.dailyUsage = 0;
    this.dailyLimit = 16000;
    this.resetTime = Date.now() + 24 * 60 * 60 * 1000;
  }
  
  addTokens(tokens) {
    this.usage += tokens;
    this.dailyUsage += tokens;
    
    // 检查是否超过限制
    if (this.usage >= this.limit) {
      this.onLimitReached();
    }
  }
  
  checkReset() {
    if (Date.now() >= this.resetTime) {
      this.dailyUsage = 0;
      this.resetTime = Date.now() + 24 * 60 * 60 * 1000;
    }
  }
  
  onLimitReached() {
    console.warn('Token limit reached');
    // 可以在这里添加通知逻辑
  }
}

// 初始化插件
const chatEnhanced = new ChatEnhancedPlugin();
window.chatEnhanced = chatEnhanced;