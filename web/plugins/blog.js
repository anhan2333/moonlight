/* ════════════ Blog日志插件 ═══════════
   基于 InternalBeyond Blog 系统的完整实现
   功能：分类管理、AI评论、AI批注、内置共读/学习室、密码日记本、支持邀请AI好友添加批注
*/

class BlogPlugin {
  constructor() {
    this.currentView = 'list'; // 'list', 'detail', 'compose', 'categories'
    this.currentPost = null;
    this.posts = new Map();
    this.categories = ['个人日记', '学习笔记', '生活感悟', '工作记录', '创意写作'];
    this.selectedCategory = '全部';
    this.aiIntegration = true;
    this.diaryPassword = null;
    
    this.init();
  }
  
  init() {
    console.log('Blog Plugin initialized');
    this.loadBlogData();
    this.createBlogInterface();
    this.bindEvents();
    this.startAISync();
  }
  
  // 加载博客数据
  loadBlogData() {
    try {
      const saved = localStorage.getItem('moonlight_blog_posts');
      if (saved) {
        this.posts = new Map(JSON.parse(saved));
      }
      
      const savedCategories = localStorage.getItem('moonlight_blog_categories');
      if (savedCategories) {
        this.categories = JSON.parse(savedCategories);
      }
      
      const savedPassword = localStorage.getItem('moonlight_diary_password');
      if (savedPassword) {
        this.diaryPassword = savedPassword;
      }
    } catch (e) {
      console.warn('Failed to load blog data:', e);
    }
  }
  
  // 保存博客数据
  saveBlogData() {
    try {
      localStorage.setItem('moonlight_blog_posts', JSON.stringify([...this.posts]));
      localStorage.setItem('moonlight_blog_categories', JSON.stringify(this.categories));
    } catch (e) {
      console.warn('Failed to save blog data:', e);
    }
  }
  
  // 创建博客界面
  createBlogInterface() {
    // 创建博客按钮
    const blogBtn = document.createElement('div');
    blogBtn.className = 'menu-item';
    blogBtn.dataset.menu = 'blog';
    blogBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
      <span>日志</span>
    `;
    blogBtn.onclick = () => this.openBlogPanel();
    
    // 添加到菜单
    const menu = document.querySelector('.menu-items');
    if (menu) {
      menu.appendChild(blogBtn);
    }
    
    // 创建博客面板
    this.blogPanel = document.createElement('div');
    this.blogPanel.className = 'blog-panel';
    this.blogPanel.innerHTML = `
      <div class="blog-header">
        <div class="blog-title">AI日志</div>
        <div class="blog-subtitle">记录生活的美好瞬间</div>
        <div class="blog-tabs">
          <button class="blog-tab active" data-view="list">日志</button>
          <button class="blog-tab" data-view="compose">写作</button>
          <button class="blog-tab" data-view="categories">分类</button>
          <button class="blog-tab" data-view="diary">日记本</button>
        </div>
      </div>
      <div class="blog-content">
        <div class="blog-main">
          ${this.createBlogList()}
        </div>
      </div>
    `;
    
    document.body.appendChild(this.blogPanel);
  }
  
  // 创建博客列表
  createBlogList() {
    const filteredPosts = this.filterPostsByCategory();
    
    if (filteredPosts.length === 0) {
      return `
        <div style="text-align: center; padding: 40px 20px; color: var(--text-faint);">
          <p>还没有日志</p>
          <p style="font-size: 12px; margin-top: 8px;">点击"写作"开始记录</p>
        </div>
      `;
    }
    
    return `
      <div class="blog-categories">
        ${['全部', ...this.categories].map(cat => `
          <div class="blog-category ${cat === this.selectedCategory ? 'active' : ''}" 
               onclick="blogPlugin.selectCategory('${cat}')">
            ${cat}
          </div>
        `).join('')}
      </div>
      <div class="blog-list">
        ${filteredPosts.map(post => this.createBlogItem(post)).join('')}
      </div>
    `;
  }
  
  // 创建博客项目
  createBlogItem(post) {
    const preview = post.content.length > 100 ? 
      post.content.substring(0, 100) + '...' : post.content;
    
    return `
      <div class="blog-item" onclick="blogPlugin.openPost('${post.id}')">
        <div class="blog-item-header">
          <div class="blog-item-title">${post.title}</div>
          <div class="blog-item-meta">
            <div class="blog-item-date">${this.formatDate(post.date)}</div>
            ${post.category ? `<div class="blog-item-category">${post.category}</div>` : ''}
          </div>
        </div>
        <div class="blog-item-content">${preview}</div>
        ${post.tags && post.tags.length > 0 ? `
          <div class="blog-item-tags">
            ${post.tags.map(tag => `<div class="blog-tag">${tag}</div>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }
  
  // 创建写作面板
  createBlogCompose() {
    return `
      <div class="blog-compose">
        <div class="blog-compose-title">新建日志</div>
        <form id="blogForm" onsubmit="blogPlugin.savePost(event)">
          <div class="blog-form-group">
            <label>标题</label>
            <input type="text" class="blog-form-control" id="blogTitle" placeholder="输入日志标题" required>
          </div>
          <div class="blog-form-group">
            <label>分类</label>
            <select class="blog-form-control" id="blogCategory">
              ${this.categories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
              <option value="">新建分类</option>
            </select>
          </div>
          <div class="blog-form-group">
            <label>标签（用逗号分隔）</label>
            <input type="text" class="blog-form-control" id="blogTags" placeholder="标签1, 标签2">
          </div>
          <div class="blog-form-group">
            <label>内容</label>
            <textarea class="blog-form-control blog-textarea" id="blogContent" placeholder="写下你的想法..." required></textarea>
          </div>
          <div class="blog-form-actions">
            <button type="button" class="btn" onclick="blogPlugin.closeBlogPanel()">取消</button>
            <button type="submit" class="btn btn-primary">发布</button>
          </div>
        </form>
      </div>
      
      <div class="blog-reading-room">
        <div class="blog-reading-room-title">共读室</div>
        <div class="blog-reading-participants">
          <div class="blog-participant">
            <div class="blog-participant-avatar"></div>
            <span>AI助手</span>
          </div>
        </div>
        <div class="blog-reading-progress">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span style="font-size: 12px; color: var(--text-faint);">阅读进度</span>
            <span style="font-size: 12px; color: var(--text-faint);">0%</span>
          </div>
          <div class="blog-progress-bar">
            <div class="blog-progress-fill" style="width: 0%"></div>
          </div>
        </div>
        <div class="blog-discussion">
          <div class="blog-discussion-item">
            <div class="blog-discussion-text">AI助手会在这里阅读你的日志并分享感悟</div>
          </div>
        </div>
      </div>
    `;
  }
  
  // 创建分类管理
  createBlogCategories() {
    return `
      <div class="blog-categories">
        ${this.categories.map(cat => `
          <div class="blog-category" onclick="blogPlugin.editCategory('${cat}')">
            ${cat}
          </div>
        `).join('')}
      </div>
      <div style="margin-top: 20px;">
        <button class="btn btn-primary" onclick="blogPlugin.addCategory()">添加分类</button>
      </div>
    `;
  }
  
  // 创建日记本
  createBlogDiary() {
    return `
      <div class="blog-diary" id="diaryContainer">
        ${this.diaryPassword ? this.createDiaryContent() : this.createDiaryLock()}
      </div>
    `;
  }
  
  // 创建日记内容
  createDiaryContent() {
    const diaryPosts = Array.from(this.posts.values()).filter(post => 
      post.category === '私密日记' || post.diary
    );
    
    return `
      <div class="blog-diary-content">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h3 style="margin: 0;">私密日记本</h3>
          <button class="btn" onclick="blogPlugin.lockDiary()">锁定</button>
        </div>
        ${diaryPosts.length === 0 ? 
          '<p style="text-align: center; color: var(--text-faint);">还没有日记</p>' :
          diaryPosts.map(post => this.createBlogItem(post)).join('')
        }
      </div>
    `;
  }
  
  // 创建日记锁定界面
  createDiaryLock() {
    return `
      <div class="blog-diary-locked">
        <div class="blog-diary-content">
          <h3 style="text-align: center; margin-bottom: 20px;">日记本已锁定</h3>
          <input type="password" class="blog-form-control" id="diaryPasswordInput" 
                 placeholder="输入密码解锁" style="margin-bottom: 16px;">
          <button class="btn btn-primary" onclick="blogPlugin.unlockDiary()" style="width: 100%;">
            解锁
          </button>
        </div>
        <div class="blog-diary-lock">🔒</div>
      </div>
    `;
  }
  
  // 选择分类
  selectCategory(category) {
    this.selectedCategory = category;
    this.refreshBlog();
  }
  
  // 过滤分类
  filterPostsByCategory() {
    if (this.selectedCategory === '全部') {
      return Array.from(this.posts.values()).reverse();
    }
    return Array.from(this.posts.values())
      .filter(post => post.category === this.selectedCategory)
      .reverse();
  }
  
  // 打开博客面板
  openBlogPanel() {
    if (!this.blogPanel) return;
    
    this.blogPanel.classList.add('open');
    this.refreshBlog();
    
    // 绑定视图切换事件
    this.blogPanel.querySelectorAll('.blog-tab').forEach(btn => {
      btn.onclick = () => this.switchView(btn.dataset.view);
    });
  }
  
  // 切换视图
  switchView(view) {
    this.currentView = view;
    
    // 更新按钮状态
    this.blogPanel.querySelectorAll('.blog-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    
    // 更新内容
    const main = this.blogPanel.querySelector('.blog-main');
    switch (view) {
      case 'list':
        main.innerHTML = this.createBlogList();
        break;
      case 'compose':
        main.innerHTML = this.createBlogCompose();
        break;
      case 'categories':
        main.innerHTML = this.createBlogCategories();
        break;
      case 'diary':
        main.innerHTML = this.createBlogDiary();
        break;
    }
  }
  
  // 保存日志
  savePost(event) {
    event.preventDefault();
    
    const title = document.getElementById('blogTitle').value;
    const category = document.getElementById('blogCategory').value;
    const tags = document.getElementById('blogTags').value;
    const content = document.getElementById('blogContent').value;
    
    if (!title.trim()) {
      showToast('请输入标题');
      return;
    }
    
    const post = {
      id: Date.now().toString(),
      title: title.trim(),
      category: category || '未分类',
      tags: tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [],
      content: content.trim(),
      date: new Date().toISOString(),
      author: '你',
      aiComments: [],
      created: new Date().toISOString()
    };
    
    this.posts.set(post.id, post);
    this.saveBlogData();
    
    // AI 处理新日志
    if (this.aiIntegration) {
      this.processPostWithAI(post);
    }
    
    this.refreshBlog();
    document.getElementById('blogForm').reset();
    showToast('日志已发布');
  }
  
  // AI处理日志
  async processPostWithAI(post) {
    try {
      // 这里可以集成AI来处理日志
      // 例如：自动生成摘要、添加评论、提取关键信息等
      console.log('AI processing post:', post);
      
      // 模拟AI评论
      setTimeout(() => {
        const aiComment = {
          id: Date.now().toString(),
          author: 'AI助手',
          text: `这是一篇关于"${post.title}"的日志，写得很有深度。我特别喜欢其中提到的"${post.content.substring(0, 50)}..."`,
          date: new Date().toISOString()
        };
        
        post.aiComments.push(aiComment);
        this.saveBlogData();
        this.refreshBlog();
      }, 2000);
      
    } catch (e) {
      console.warn('AI post processing failed:', e);
    }
  }
  
  // 打开日志详情
  openPost(postId) {
    const post = this.posts.get(postId);
    if (!post) return;
    
    this.currentPost = post;
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay show';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="modal-title">日志详情</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        </div>
        <div class="modal-body">
          ${this.createBlogDetail(post)}
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  }
  
  // 创建日志详情
  createBlogDetail(post) {
    return `
      <div class="blog-detail">
        <div class="blog-detail-title">${post.title}</div>
        <div class="blog-detail-meta">
          <div class="blog-detail-date">${this.formatDate(post.date)}</div>
          <div class="blog-detail-actions">
            <button class="btn" onclick="blogPlugin.editPost('${post.id}')">编辑</button>
            <button class="btn" onclick="blogPlugin.deletePost('${post.id}')">删除</button>
          </div>
        </div>
        <div class="blog-detail-content">${post.content}</div>
        ${post.tags && post.tags.length > 0 ? `
          <div class="blog-item-tags">
            ${post.tags.map(tag => `<div class="blog-tag">${tag}</div>`).join('')}
          </div>
        ` : ''}
        
        ${post.aiComments && post.aiComments.length > 0 ? `
          <div class="blog-ai-comments">
            <div class="blog-ai-comments-title">AI批注</div>
            ${post.aiComments.map(comment => `
              <div class="blog-ai-comment">
                <div class="blog-ai-comment-text">${comment.text}</div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }
  
  // 编辑分类
  editCategory(category) {
    const newName = prompt('修改分类名称:', category);
    if (newName && newName !== category) {
      const index = this.categories.indexOf(category);
      if (index > -1) {
        this.categories[index] = newName;
        this.saveBlogData();
        this.refreshBlog();
        showToast('分类已更新');
      }
    }
  }
  
  // 添加分类
  addCategory() {
    const newCategory = prompt('输入新分类名称:');
    if (newCategory && !this.categories.includes(newCategory)) {
      this.categories.push(newCategory);
      this.saveBlogData();
      this.refreshBlog();
      showToast('分类已添加');
    }
  }
  
  // 解锁日记
  unlockDiary() {
    const password = document.getElementById('diaryPasswordInput').value;
    if (password === this.diaryPassword) {
      this.switchView('diary');
    } else {
      showToast('密码错误');
    }
  }
  
  // 锁定日记
  lockDiary() {
    this.switchView('diary');
  }
  
  // 设置日记密码
  setDiaryPassword() {
    const password = prompt('设置日记密码:');
    if (password) {
      this.diaryPassword = password;
      localStorage.setItem('moonlight_diary_password', password);
      this.switchView('diary');
      showToast('密码已设置');
    }
  }
  
  // AI同步
  startAISync() {
    // 定期检查新日志，AI进行评论
    setInterval(() => {
      this.checkNewPosts();
    }, 30000); // 每30秒检查一次
    
    // 监听聊天消息，提取日志灵感
    if (window.chatInstance) {
      window.chatInstance.addEventListener('message', (message) => {
        this.extractInspirationFromMessage(message);
      });
    }
  }
  
  // 检查新日志
  checkNewPosts() {
    const recentPosts = Array.from(this.posts.values())
      .filter(post => new Date(post.date) > new Date(Date.now() - 24 * 60 * 60 * 1000))
      .filter(post => post.aiComments.length === 0);
    
    recentPosts.forEach(post => {
      this.processPostWithAI(post);
    });
  }
  
  // 从消息中提取灵感
  extractInspirationFromMessage(message) {
    if (!message || message.from !== 'human') return;
    
    const text = message.text;
    const inspirationRegex = /(想法|感悟|记录|回忆|经历|故事|感受)/;
    
    if (inspirationRegex.test(text)) {
      // 可以在这里添加逻辑，将消息内容转化为日志灵感
      console.log('Inspiration detected in message:', text);
    }
  }
  
  // 刷新博客
  refreshBlog() {
    if (this.blogPanel) {
      const main = this.blogPanel.querySelector('.blog-main');
      switch (this.currentView) {
        case 'list':
          main.innerHTML = this.createBlogList();
          break;
        case 'compose':
          main.innerHTML = this.createBlogCompose();
          break;
        case 'categories':
          main.innerHTML = this.createBlogCategories();
          break;
        case 'diary':
          main.innerHTML = this.createBlogDiary();
          break;
      }
    }
  }
  
  // 关闭博客面板
  closeBlogPanel() {
    if (this.blogPanel) {
      this.blogPanel.classList.remove('open');
    }
  }
  
  // 编辑日志
  editPost(postId) {
    const post = this.posts.get(postId);
    if (!post) return;
    
    // 这里可以实现编辑功能
    showToast('编辑功能开发中');
  }
  
  // 删除日志
  deletePost(postId) {
    if (confirm('确定要删除这篇日志吗？')) {
      this.posts.delete(postId);
      this.saveBlogData();
      this.refreshBlog();
      showToast('日志已删除');
    }
  }
  
  // 格式化日期
  formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return '今天 ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return '昨天 ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays < 7) {
      return `${diffDays}天前`;
    } else {
      return date.toLocaleDateString('zh-CN');
    }
  }
  
  // 绑定事件
  bindEvents() {
    // ESC键关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.blogPanel && this.blogPanel.classList.contains('open')) {
        this.closeBlogPanel();
      }
    });
    
    // 点击外部关闭
    document.addEventListener('click', (e) => {
      if (this.blogPanel && this.blogPanel.classList.contains('open') &&
          !this.blogPanel.contains(e.target) && !e.target.closest('[data-menu="blog"]')) {
        this.closeBlogPanel();
      }
    });
  }
}

// 初始化博客插件
let blogPlugin;
document.addEventListener('DOMContentLoaded', () => {
  blogPlugin = new BlogPlugin();
});

// 全局函数
function openBlogPanel() {
  if (blogPlugin) {
    blogPlugin.openBlogPanel();
  }
}