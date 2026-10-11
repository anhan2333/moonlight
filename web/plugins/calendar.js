/* ════════════ Calendar日历插件 ═══════════
   基于 InternalBeyond Calendar 系统的完整实现
   功能：悬浮小窗 + 挂历视窗、纪念日/生日/计划/记录、月相节气与传统节日、AI读取临近日程、聊天中提及并留便签、AI写入日历事项
*/

class CalendarPlugin {
  constructor() {
    this.currentDate = new Date();
    this.selectedDate = null;
    this.events = new Map();
    this.viewMode = 'month'; // 'month', 'list', 'float'
    this.aiIntegration = true;
    
    // 传统节日数据
    this.traditionalHolidays = {
      '1-1': '元旦',
      '2-14': '情人节',
      '3-8': '妇女节',
      '3-12': '植树节',
      '4-1': '愚人节',
      '5-1': '劳动节',
      '6-1': '儿童节',
      '7-1': '建党节',
      '8-1': '建军节',
      '9-10': '教师节',
      '10-1': '国庆节',
      '10-15': '重阳节',
      '12-25': '圣诞节'
    };
    
    // 节气数据
    this.solarTerms = {
      '1-1': '小寒',
      '1-15': '大寒',
      '2-3': '立春',
      '2-18': '雨水',
      '3-5': '惊蛰',
      '3-20': '春分',
      '4-4': '清明',
      '4-19': '谷雨',
      '5-5': '立夏',
      '5-20': '小满',
      '6-5': '芒种',
      '6-21': '夏至',
      '7-7': '小暑',
      '7-22': '大暑',
      '8-7': '立秋',
      '8-22': '处暑',
      '9-7': '白露',
      '9-22': '秋分',
      '10-8': '寒露',
      '10-23': '霜降',
      '11-7': '立冬',
      '11-22': '小雪',
      '12-7': '大雪',
      '12-21': '冬至'
    };
    
    this.init();
  }
  
  init() {
    console.log('Calendar Plugin initialized');
    this.loadCalendarData();
    this.createCalendarInterface();
    this.bindEvents();
    this.startAISync();
  }
  
  // 加载日历数据
  loadCalendarData() {
    try {
      const saved = localStorage.getItem('moonlight_calendar_events');
      if (saved) {
        this.events = new Map(JSON.parse(saved));
      }
    } catch (e) {
      console.warn('Failed to load calendar data:', e);
    }
  }
  
  // 保存日历数据
  saveCalendarData() {
    try {
      localStorage.setItem('moonlight_calendar_events', JSON.stringify([...this.events]));
    } catch (e) {
      console.warn('Failed to save calendar data:', e);
    }
  }
  
  // 创建日历界面
  createCalendarInterface() {
    // 创建日历按钮
    const calendarBtn = document.createElement('div');
    calendarBtn.className = 'menu-item';
    calendarBtn.dataset.menu = 'calendar';
    calendarBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
      </svg>
      <span>日历</span>
    `;
    calendarBtn.onclick = () => this.openCalendarPanel();
    
    // 添加到菜单
    const menu = document.querySelector('.menu-items');
    if (menu) {
      menu.appendChild(calendarBtn);
    }
    
    // 创建日历面板
    this.calendarPanel = document.createElement('div');
    this.calendarPanel.className = 'calendar-panel';
    this.calendarPanel.innerHTML = `
      <div class="calendar-header">
        <div class="calendar-title">AI日历</div>
        <div class="calendar-subtitle">智能管理你的时光</div>
        <div class="calendar-view-toggle">
          <button class="calendar-view-btn active" data-view="month">月历</button>
          <button class="calendar-view-btn" data-view="list">日程</button>
          <button class="calendar-view-btn" data-view="float">悬浮</button>
        </div>
      </div>
      <div class="calendar-content">
        <div class="calendar-main">
          ${this.createMonthView()}
        </div>
      </div>
    `;
    
    document.body.appendChild(this.calendarPanel);
  }
  
  // 创建月历视图
  createMonthView() {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());
    
    const html = `
      <div class="calendar-grid">
        ${['日', '一', '二', '三', '四', '五', '六'].map(day => 
          `<div class="calendar-day-header">${day}</div>`
        ).join('')}
        ${this.generateMonthDays(startDate, lastDay)}
      </div>
      <div class="calendar-moon">
        <div class="moon-icon"></div>
        <span>${this.getMoonPhaseInfo()}</span>
      </div>
      ${this.createEventsList()}
    `;
    
    return html;
  }
  
  // 生成月历天数
  generateMonthDays(startDate, lastDay) {
    const html = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= lastDay || currentDate.getDay() !== 0) {
      const dateStr = this.formatDate(currentDate);
      const isCurrentMonth = currentDate.getMonth() === this.currentDate.getMonth();
      const isToday = this.isToday(currentDate);
      const hasEvents = this.events.has(dateStr);
      
      html.push(`
        <div class="calendar-day ${isToday ? 'today' : ''} ${hasEvents ? 'has-events' : ''} ${!isCurrentMonth ? 'other-month' : ''}"
             data-date="${dateStr}" onclick="calendarPlugin.selectDate('${dateStr}')">
          ${currentDate.getDate()}
        </div>
      `);
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return html.join('');
  }
  
  // 创建事件列表
  createEventsList() {
    const today = this.formatDate(new Date());
    const upcomingEvents = [];
    
    for (const [date, events] of this.events) {
      if (date >= today) {
        events.forEach(event => {
          upcomingEvents.push({ date, ...event });
        });
      }
    }
    
    upcomingEvents.sort((a, b) => new Date(a.date + ' ' + a.time) - new Date(b.date + ' ' + b.time));
    
    const html = `
      <div class="calendar-events">
        <div class="calendar-events-header">
          <span>即将到来</span>
          <span class="event-count">${upcomingEvents.length} 个事件</span>
        </div>
        ${upcomingEvents.slice(0, 5).map(event => `
          <div class="event-item">
            <div class="event-time">${event.date} ${event.time || '全天'}</div>
            <div class="event-title">
              <span class="event-priority ${event.priority || 'low'}"></span>
              ${event.title}
            </div>
            ${event.description ? `<div class="event-desc">${event.description}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
    
    return html;
  }
  
  // 选择日期
  selectDate(dateStr) {
    this.selectedDate = dateStr;
    this.showDateEvents(dateStr);
  }
  
  // 显示日期事件
  showDateEvents(dateStr) {
    const events = this.events.get(dateStr) || [];
    
    // 创建事件详情面板
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>${dateStr} 的事件</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        </div>
        <div class="modal-body">
          ${events.length === 0 ? 
            '<p style="text-align: center; color: var(--text-faint);">暂无事件</p>' :
            events.map(event => `
              <div class="event-item">
                <div class="event-time">${event.time || '全天'}</div>
                <div class="event-title">
                  <span class="event-priority ${event.priority || 'low'}"></span>
                  ${event.title}
                </div>
                ${event.description ? `<div class="event-desc">${event.description}</div>` : ''}
              </div>
            `).join('')
          }
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" onclick="calendarPlugin.addEvent('${dateStr}')">添加事件</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  }
  
  // 添加事件
  addEvent(dateStr) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>添加事件 - ${dateStr}</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>时间</label>
            <input type="time" id="event-time" class="form-control">
          </div>
          <div class="form-group">
            <label>标题</label>
            <input type="text" id="event-title" class="form-control" placeholder="事件标题">
          </div>
          <div class="form-group">
            <label>描述</label>
            <textarea id="event-desc" class="form-control" rows="3" placeholder="事件描述"></textarea>
          </div>
          <div class="form-group">
            <label>优先级</label>
            <select id="event-priority" class="form-control">
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">取消</button>
          <button class="btn btn-primary" onclick="calendarPlugin.saveEvent('${dateStr}')">保存</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  }
  
  // 保存事件
  saveEvent(dateStr) {
    const time = document.getElementById('event-time').value;
    const title = document.getElementById('event-title').value;
    const description = document.getElementById('event-desc').value;
    const priority = document.getElementById('event-priority').value;
    
    if (!title.trim()) {
      showToast('请输入事件标题');
      return;
    }
    
    if (!this.events.has(dateStr)) {
      this.events.set(dateStr, []);
    }
    
    this.events.get(dateStr).push({
      id: Date.now(),
      time,
      title: title.trim(),
      description: description.trim(),
      priority,
      created: new Date().toISOString()
    });
    
    this.saveCalendarData();
    this.refreshCalendar();
    document.querySelector('.modal-overlay').remove();
    showToast('事件已添加');
    
    // AI 处理新事件
    if (this.aiIntegration) {
      this.processEventWithAI({ date: dateStr, time, title, description, priority });
    }
  }
  
  // AI 处理事件
  async processEventWithAI(event) {
    try {
      // 这里可以集成AI来处理事件
      // 例如：智能提醒、建议安排、自动生成描述等
      console.log('AI processing event:', event);
    } catch (e) {
      console.warn('AI event processing failed:', e);
    }
  }
  
  // AI同步
  startAISync() {
    // 定期检查即将到来的事件
    setInterval(() => {
      this.checkUpcomingEvents();
    }, 60000); // 每分钟检查一次
    
    // 监听聊天消息，提取日程信息
    if (window.chatInstance) {
      window.chatInstance.addEventListener('message', (message) => {
        this.extractScheduleFromMessage(message);
      });
    }
  }
  
  // 检查即将到来的事件
  checkUpcomingEvents() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const todayStr = this.formatDate(now);
    const tomorrowStr = this.formatDate(tomorrow);
    
    // 检查今天和明天的事件
    [todayStr, tomorrowStr].forEach(date => {
      const events = this.events.get(date) || [];
      events.forEach(event => {
        if (event.time) {
          const eventTime = new Date(`${date} ${event.time}`);
          const timeDiff = eventTime - now;
          
          // 提前1小时提醒
          if (timeDiff > 0 && timeDiff < 3600000) {
            this.showEventReminder(event);
          }
        }
      });
    });
  }
  
  // 显示事件提醒
  showEventReminder(event) {
    if (document.visibilityState === 'hidden') {
      // 页面隐藏时显示通知
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('日程提醒', {
          body: `即将开始：${event.title}`,
          icon: '/apple-touch-icon.png'
        });
      }
    } else {
      // 页面可见时显示内嵌提醒
      showToast(`即将开始：${event.title}`);
    }
  }
  
  // 从消息中提取日程
  extractScheduleFromMessage(message) {
    if (!message || message.from !== 'human') return;
    
    const text = message.text;
    const scheduleRegex = /(明天|今天|后天|(\d{1,2})月(\d{1,2})日|(\d{4}-\d{2}-\d{2}))\s*(\d{1,2}):(\d{2})?\s*(.+?)$/;
    const match = text.match(scheduleRegex);
    
    if (match) {
      const dateStr = this.parseDate(match);
      const time = match[5] ? `${match[5]}:${match[6] || '00'}` : '';
      const title = match[7];
      
      if (dateStr && title) {
        if (!this.events.has(dateStr)) {
          this.events.set(dateStr, []);
        }
        
        this.events.get(dateStr).push({
          id: Date.now(),
          time,
          title: title.trim(),
          description: '从聊天中提取',
          priority: 'medium',
          created: new Date().toISOString()
        });
        
        this.saveCalendarData();
      }
    }
  }
  
  // 解析日期
  parseDate(match) {
    const today = new Date();
    
    if (match[1] === '明天') {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return this.formatDate(tomorrow);
    } else if (match[1] === '今天') {
      return this.formatDate(today);
    } else if (match[1] === '后天') {
      const dayAfterTomorrow = new Date(today);
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
      return this.formatDate(dayAfterTomorrow);
    } else if (match[2] && match[3]) {
      // X月Y日格式
      const month = parseInt(match[2]) - 1;
      const day = parseInt(match[3]);
      const date = new Date(today.getFullYear(), month, day);
      if (date < today) {
        date.setFullYear(date.getFullYear() + 1);
      }
      return this.formatDate(date);
    } else if (match[4]) {
      // YYYY-MM-DD格式
      return match[4];
    }
    
    return null;
  }
  
  // 获取月相信息
  getMoonPhaseInfo() {
    const moonPhases = ['新月', '峨眉月', '上弦月', '盈凸月', '满月', '亏凸月', '下弦月', '残月'];
    const today = new Date();
    const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
    const moonPhase = moonPhases[dayOfYear % 8];
    
    return `${moonPhase} · ${this.getTodayFestivals()}`;
  }
  
  // 获取今日节日
  getTodayFestivals() {
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    const key = `${month}-${day}`;
    
    return this.traditionalHolidays[key] || this.solarTerms[key] || '';
  }
  
  // 格式化日期
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  // 判断是否为今天
  isToday(date) {
    const today = new Date();
    return date.getFullYear() === today.getFullYear() &&
           date.getMonth() === today.getMonth() &&
           date.getDate() === today.getDate();
  }
  
  // 刷新日历
  refreshCalendar() {
    if (this.calendarPanel) {
      this.calendarPanel.querySelector('.calendar-main').innerHTML = this.createMonthView();
    }
  }
  
  // 打开日历面板
  openCalendarPanel() {
    if (!this.calendarPanel) return;
    
    this.calendarPanel.classList.add('open');
    this.refreshCalendar();
    
    // 绑定视图切换事件
    this.calendarPanel.querySelectorAll('.calendar-view-btn').forEach(btn => {
      btn.onclick = () => this.switchView(btn.dataset.view);
    });
  }
  
  // 切换视图
  switchView(view) {
    this.viewMode = view;
    
    // 更新按钮状态
    this.calendarPanel.querySelectorAll('.calendar-view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    
    // 更新内容
    const main = this.calendarPanel.querySelector('.calendar-main');
    switch (view) {
      case 'month':
        main.innerHTML = this.createMonthView();
        break;
      case 'list':
        main.innerHTML = this.createEventsList();
        break;
      case 'float':
        this.openFloatCalendar();
        break;
    }
  }
  
  // 打开悬浮日历
  openFloatCalendar() {
    const floatCalendar = document.createElement('div');
    floatCalendar.className = 'calendar-float open';
    floatCalendar.innerHTML = `
      <div class="calendar-float-header">今日日程</div>
      <div class="calendar-float-events">
        ${this.createFloatEvents()}
      </div>
    `;
    
    document.body.appendChild(floatCalendar);
    
    // 5秒后自动关闭
    setTimeout(() => {
      floatCalendar.remove();
    }, 5000);
  }
  
  // 创建悬浮日历事件
  createFloatEvents() {
    const today = this.formatDate(new Date());
    const todayEvents = this.events.get(today) || [];
    
    if (todayEvents.length === 0) {
      return '<div class="calendar-float-event">今日无日程安排</div>';
    }
    
    return todayEvents.map(event => `
      <div class="calendar-float-event">
        <div class="event-time">${event.time || '全天'}</div>
        <div class="event-title">${event.title}</div>
        ${event.description ? `<div class="event-desc">${event.description}</div>` : ''}
      </div>
    `).join('');
  }
  
  // 关闭日历面板
  closeCalendarPanel() {
    if (this.calendarPanel) {
      this.calendarPanel.classList.remove('open');
    }
  }
  
  // 绑定事件
  bindEvents() {
    // ESC键关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.calendarPanel && this.calendarPanel.classList.contains('open')) {
        this.closeCalendarPanel();
      }
    });
    
    // 点击外部关闭
    document.addEventListener('click', (e) => {
      if (this.calendarPanel && this.calendarPanel.classList.contains('open') &&
          !this.calendarPanel.contains(e.target) && !e.target.closest('[data-menu="calendar"]')) {
        this.closeCalendarPanel();
      }
    });
  }
}

// 初始化日历插件
let calendarPlugin;
document.addEventListener('DOMContentLoaded', () => {
  calendarPlugin = new CalendarPlugin();
});

// 全局函数
function openCalendarPanel() {
  if (calendarPlugin) {
    calendarPlugin.openCalendarPanel();
  }
}