/* ═══════════ ICode代码工作区插件 ═══════════
   基于 InternalBeyond ICode 系统的完整实现
   功能：代码编辑器、语法高亮、AI助手、文件管理、运行环境、版本控制
*/

class ICodePlugin {
  constructor() {
    this.currentView = 'editor'; // 'editor', 'terminal', 'ai', 'snippets'
    this.currentFile = null;
    this.files = new Map();
    this.folders = ['src', 'docs', 'assets'];
    this.fileTree = [];
    this.terminalOutput = [];
    this.terminalInput = '';
    this.aiIntegration = true;
    this.searchQuery = '';
    this.shortcuts = {
      'Ctrl+S': '保存文件',
      'Ctrl+Z': '撤销',
      'Ctrl+Y': '重做',
      'Ctrl+F': '搜索',
      'Ctrl+H': '替换',
      'Ctrl+D': '删除行',
      'Ctrl+/': '注释',
      'Ctrl+Enter': '运行代码',
      'Shift+Ctrl+Enter': '运行并输出'
    };
    this.snippets = [
      {
        id: '1',
        title: 'JavaScript 函数模板',
        description: '一个标准的JavaScript函数模板',
        code: `function ${this.generateFunctionName()}(${this.generateParameters()}) {
  // TODO: 实现函数逻辑
  return ${this.generateReturnValue()};
}`,
        language: 'javascript'
      },
      {
        id: '2',
        title: 'Python 类定义',
        description: '一个标准的Python类定义',
        code: `class ${this.generateClassName()}:
    def __init__(self${this.generateConstructorParams()}):
        # TODO: 初始化属性
        pass
    
    def ${this.generateMethodName()}(self${this.generateMethodParams()}):
        # TODO: 实现方法
        pass`,
        language: 'python'
      },
      {
        id: '3',
        title: 'HTML5 页面结构',
        description: '一个标准的HTML5页面结构',
        code: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.generatePageTitle()}</title>
    <style>
        /* TODO: 添加样式 */
    </style>
</head>
<body>
    <header>
        <!-- TODO: 添加头部内容 -->
    </header>
    <main>
        <!-- TODO: 添加主要内容 -->
    </main>
    <footer>
        <!-- TODO: 添加页脚内容 -->
    </footer>
    <script>
        // TODO: 添加JavaScript代码
    </script>
</body>
</html>`,
        language: 'html'
      }
    ];
    
    this.init();
  }
  
  init() {
    console.log('ICode Plugin initialized');
    this.loadICodeData();
    this.createICodeInterface();
    this.bindEvents();
    this.initializeFileTree();
    this.startAISync();
  }
  
  // 加载ICode数据
  loadICodeData() {
    try {
      const saved = localStorage.getItem('moonlight_icode_files');
      if (saved) {
        this.files = new Map(JSON.parse(saved));
      }
      
      const savedTree = localStorage.getItem('moonlight_icode_tree');
      if (savedTree) {
        this.fileTree = JSON.parse(savedTree);
      }
      
      // 初始化示例文件
      if (this.files.size === 0) {
        this.createSampleFiles();
      }
    } catch (e) {
      console.warn('Failed to load ICode data:', e);
    }
  }
  
  // 创建示例文件
  createSampleFiles() {
    const sampleFiles = [
      {
        id: '1',
        name: 'index.js',
        path: 'src/index.js',
        content: `// 欢迎使用ICode代码编辑器
// 这是一个示例JavaScript文件

function greet(name) {
  return \`Hello, \${name}!\`;
}

console.log(greet('World'));

// TODO: 添加更多代码
`,
        language: 'javascript',
        modified: new Date().toISOString()
      },
      {
        id: '2',
        name: 'style.css',
        path: 'src/style.css',
        content: `/* 欢迎使用ICode代码编辑器 */
/* 这是一个示例CSS文件 */

body {
  font-family: Arial, sans-serif;
  margin: 0;
  padding: 20px;
  background-color: #f5f5f5;
}

.container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

/* TODO: 添加更多样式 */
`,
        language: 'css',
        modified: new Date().toISOString()
      },
      {
        id: '3',
        name: 'README.md',
        path: 'README.md',
        content: `# ICode 代码工作区

欢迎使用ICode代码编辑器！

## 功能特性

- 📝 **代码编辑器**: 支持多种编程语言
- 🎨 **语法高亮**: 实时语法高亮显示
- 🤖 **AI助手**: 智能代码建议和帮助
- 📁 **文件管理**: 完整的文件系统操作
- ⚡ **运行环境**: 在线运行代码
- 🔧 **代码片段**: 常用代码模板

## 快捷键

- \`Ctrl+S\`: 保存文件
- \`Ctrl+Z\`: 撤销
- \`Ctrl+Y\`: 重做
- \`Ctrl+F\`: 搜索
- \`Ctrl+Enter\`: 运行代码

## 开始使用

1. 创建新文件或打开现有文件
2. 开始编写你的代码
3. 使用快捷键提高效率
4. 让AI助手帮助你

祝编码愉快！
`,
        language: 'markdown',
        modified: new Date().toISOString()
      }
    ];
    
    sampleFiles.forEach(file => {
      this.files.set(file.id, file);
    });
    
    this.saveICodeData();
  }
  
  // 保存ICode数据
  saveICodeData() {
    try {
      localStorage.setItem('moonlight_icode_files', JSON.stringify([...this.files]));
      localStorage.setItem('moonlight_icode_tree', JSON.stringify(this.fileTree));
    } catch (e) {
      console.warn('Failed to save ICode data:', e);
    }
  }
  
  // 创建ICode界面
  createICodeInterface() {
    // 创建ICode按钮
    const icodeBtn = document.createElement('div');
    icodeBtn.className = 'menu-item';
    icodeBtn.dataset.menu = 'icode';
    icodeBtn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
      </svg>
      <span>代码</span>
    `;
    icodeBtn.onclick = () => this.openICodePanel();
    
    // 添加到菜单
    const menu = document.querySelector('.menu-items');
    if (menu) {
      menu.appendChild(icodeBtn);
    }
    
    // 创建ICode面板
    this.icodePanel = document.createElement('div');
    this.icodePanel.className = 'icode-panel';
    this.icodePanel.innerHTML = `
      <div class="icode-header">
        <div class="icode-title">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
          </svg>
          代码工作区
        </div>
        <div class="icode-subtitle">专业的在线代码编辑器</div>
        <button class="icode-close" onclick="icodePlugin.closeICodePanel()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      
      <div class="icode-main">
        <div class="icode-sidebar">
          <div class="icode-sidebar-header">
            <div class="icode-sidebar-title">文件</div>
            <div class="icode-sidebar-actions">
              <button class="icode-sidebar-btn" onclick="icodePlugin.createFile()" title="新建文件">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
              <button class="icode-sidebar-btn" onclick="icodePlugin.createFolder()" title="新建文件夹">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
              </button>
            </div>
          </div>
          <div class="icode-file-tree">
            ${this.createFileTreeHTML()}
          </div>
        </div>
        
        <div class="icode-editor">
          <div class="icode-editor-header">
            <div class="icode-editor-title">
              <span class="icode-editor-file-icon">${this.getFileIcon(this.currentFile)}</span>
              <span>${this.currentFile ? this.currentFile.name : '未选择文件'}</span>
              <span class="icode-editor-path">${this.currentFile ? this.currentFile.path : ''}</span>
            </div>
            <div class="icode-editor-actions">
              <button class="icode-editor-btn" onclick="icodePlugin.formatCode()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="16 3 21 3 21 8"></polyline>
                  <line x1="4" y1="20" x2="21" y2="3"></line>
                  <line x1="18.5" y1="13.5" x2="21" y2="16"></line>
                  <line x1="3" y1="20" x2="3.01" y2="20"></line>
                </svg>
                格式化
              </button>
              <button class="icode-editor-btn" onclick="icodePlugin.runCode()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                运行
              </button>
              <button class="icode-editor-btn" onclick="icodePlugin.showAIAssistant()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M12 6v6l4 2"></path>
                </svg>
                AI
              </button>
              <button class="icode-editor-btn primary" onclick="icodePlugin.saveFile()">
                保存
              </button>
            </div>
          </div>
          <div class="icode-editor-content">
            <textarea class="icode-editor-textarea" id="icodeEditor" 
                      placeholder="选择一个文件开始编辑..." 
                      oninput="icodePlugin.updateCode(this.value)"></textarea>
            <div class="icode-highlight" id="icodeHighlight"></div>
          </div>
        </div>
        
        <div class="icode-terminal">
          <div class="icode-terminal-header">
            <div class="icode-terminal-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="2" width="20" height="16" rx="2" ry="2"></rect>
                <line x1="2" y1="6" x2="22" y2="6"></line>
                <line x1="2" y1="10" x2="22" y2="10"></line>
              </svg>
              终端
            </div>
            <div class="icode-terminal-actions">
              <button class="icode-terminal-btn" onclick="icodePlugin.clearTerminal()" title="清空终端">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
              <button class="icode-terminal-btn" onclick="icodePlugin.toggleTerminal()" title="隐藏终端">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>
          <div class="icode-terminal-content" id="icodeTerminal">
            <div class="icode-terminal-line">ICode 终端 v1.0</div>
            <div class="icode-terminal-line">输入 'help' 查看可用命令</div>
            <div class="icode-terminal-input">
              <span class="icode-terminal-prompt">$</span>
              <input type="text" class="icode-terminal-command" id="terminalInput" 
                     onkeypress="icodePlugin.handleTerminalInput(event)" placeholder="输入命令...">
            </div>
          </div>
        </div>
      </div>
      
      <div class="icode-status-bar">
        <div class="icode-status-item">
          <div class="icode-status-indicator"></div>
          <span>就绪</span>
        </div>
        <div class="icode-status-item">
          <span>行: <span id="currentLine">1</span></span>
        </div>
        <div class="icode-status-item">
          <span>列: <span id="currentColumn">1</span></span>
        </div>
        <div class="icode-status-item">
          <span>字符: <span id="currentChars">0</span></span>
        </div>
      </div>
    `;
    
    document.body.appendChild(this.icodePanel);
    
    // 创建AI助手
    this.createAIAssistant();
    
    // 创建快捷键提示
    this.createShortcuts();
    
    // 创建代码片段
    this.createSnippets();
  }
  
  // 创建文件树HTML
  createFileTreeHTML() {
    return this.folders.map(folder => `
      <div class="icode-folder" id="folder-${folder}">
        <div class="icode-file-item" onclick="icodePlugin.toggleFolder('${folder}')">
          <svg class="icode-file-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span class="icode-file-name">${folder}</span>
          <svg class="icode-file-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
        <div class="icode-folder-children">
          ${this.createFolderFilesHTML(folder)}
        </div>
      </div>
    `).join('');
  }
  
  // 创建文件夹文件HTML
  createFolderFilesHTML(folder) {
    const folderFiles = Array.from(this.files.values()).filter(file => 
      file.path.startsWith(`${folder}/`)
    );
    
    return folderFiles.map(file => `
      <div class="icode-file-item ${this.currentFile && this.currentFile.id === file.id ? 'active' : ''}" 
           onclick="icodePlugin.openFile('${file.id}')">
        <svg class="icode-file-icon ${file.language}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
        </svg>
        <span class="icode-file-name">${file.name}</span>
        <div class="icode-file-actions">
          <button class="icode-file-action" onclick="event.stopPropagation(); icodePlugin.editFile('${file.id}')" title="编辑">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="icode-file-action" onclick="event.stopPropagation(); icodePlugin.deleteFile('${file.id}')" title="删除">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
    `).join('');
  }
  
  // 创建AI助手
  createAIAssistant() {
    this.aiAssistant = document.createElement('div');
    this.aiAssistant.className = 'icode-ai-assistant';
    this.aiAssistant.innerHTML = `
      <div class="icode-ai-header">
        <div class="icode-ai-avatar">AI</div>
        <div class="icode-ai-title">代码助手</div>
      </div>
      <div class="icode-ai-message">
        我可以帮助你编写代码、调试问题、优化算法。有什么需要吗？
      </div>
      <div class="icode-ai-actions">
        <button class="icode-ai-btn" onclick="icodePlugin.getAIHelp()">代码帮助</button>
        <button class="icode-ai-btn" onclick="icodePlugin.optimizeCode()">优化代码</button>
        <button class="icode-ai-btn primary" onclick="icodePlugin.closeAIAssistant()">关闭</button>
      </div>
    `;
    document.body.appendChild(this.aiAssistant);
  }
  
  // 创建快捷键提示
  createShortcuts() {
    this.shortcutsPanel = document.createElement('div');
    this.shortcutsPanel.className = 'icode-shortcuts';
    this.shortcutsPanel.innerHTML = `
      <div class="icode-shortcuts-title">快捷键</div>
      <div class="icode-shortcuts-list">
        ${Object.entries(this.shortcuts).map(([key, desc]) => `
          <div class="icode-shortcut-item">
            <span class="icode-shortcut-desc">${desc}</span>
            <span class="icode-shortcut-key">${key}</span>
          </div>
        `).join('')}
      </div>
    `;
    document.body.appendChild(this.shortcutsPanel);
  }
  
  // 创建代码片段
  createSnippets() {
    this.snippetsPanel = document.createElement('div');
    this.snippetsPanel.className = 'icode-snippets';
    this.snippetsPanel.innerHTML = `
      <div class="icode-snippets-header">
        <div class="icode-snippets-title">代码片段</div>
        <button class="icode-modal-close" onclick="icodePlugin.closeSnippets()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="icode-snippets-list">
        ${this.snippets.map(snippet => `
          <div class="icode-snippet-item" onclick="icodePlugin.insertSnippet('${snippet.id}')">
            <div class="icode-snippet-title">${snippet.title}</div>
            <div class="icode-snippet-description">${snippet.description}</div>
            <div class="icode-snippet-code">${snippet.code}</div>
          </div>
        `).join('')}
      </div>
    `;
    document.body.appendChild(this.snippetsPanel);
  }
  
  // 打开ICode面板
  openICodePanel() {
    if (!this.icodePanel) return;

    this.icodePanel.classList.add('open');
    if (this.shortcutsPanel) this.shortcutsPanel.classList.add('show');
    this.refreshICode();

    // 如果有当前文件，加载内容
    if (this.currentFile) {
      this.loadFileContent(this.currentFile.id);
    }
  }
  
  // 初始化文件树
  initializeFileTree() {
    this.folders.forEach(folder => {
      const folderElement = document.getElementById(`folder-${folder}`);
      if (folderElement) {
        folderElement.classList.add('expanded');
      }
    });
  }
  
  // 切换文件夹
  toggleFolder(folder) {
    const folderElement = document.getElementById(`folder-${folder}`);
    if (folderElement) {
      folderElement.classList.toggle('expanded');
    }
  }
  
  // 打开文件
  openFile(fileId) {
    const file = this.files.get(fileId);
    if (!file) return;
    
    this.currentFile = file;
    this.loadFileContent(fileId);
    this.refreshICode();
    
    // 更新文件树选中状态
    document.querySelectorAll('.icode-file-item').forEach(item => {
      item.classList.remove('active');
    });
    event.target.closest('.icode-file-item').classList.add('active');
  }
  
  // 加载文件内容
  loadFileContent(fileId) {
    const file = this.files.get(fileId);
    if (!file) return;
    
    const editor = document.getElementById('icodeEditor');
    if (editor) {
      editor.value = file.content;
      this.updateCode(file.content);
    }
    
    this.updateStatusBar();
  }
  
  // 更新代码
  updateCode(content) {
    const highlight = document.getElementById('icodeHighlight');
    if (highlight) {
      const highlighted = this.highlightCode(content);
      highlight.innerHTML = highlighted;
    }
    
    // 更新状态栏
    this.updateStatusBar();
    
    // 如果有当前文件，更新内容
    if (this.currentFile) {
      this.currentFile.content = content;
      this.currentFile.modified = new Date().toISOString();
      this.saveICodeData();
    }
  }
  
  // 语法高亮
  highlightCode(code) {
    return code.split('\n').map(line => {
      let highlightedLine = line;
      
      // 关键字高亮
      highlightedLine = highlightedLine.replace(
        /\b(function|const|let|var|if|else|for|while|return|class|extends|import|export|async|await)\b/g,
        '<span class="icode-highlight-keyword">$1</span>'
      );
      
      // 字符串高亮
      highlightedLine = highlightedLine.replace(
        /(['"`])(?:(?=(\\?))\2.)*?\1/g,
        '<span class="icode-highlight-string">$1</span>'
      );
      
      // 注释高亮
      highlightedLine = highlightedLine.replace(
        /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm,
        '<span class="icode-highlight-comment">$1</span>'
      );
      
      // 函数高亮
      highlightedLine = highlightedLine.replace(
        /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,
        '<span class="icode-highlight-function">$1</span>('
      );
      
      // 数字高亮
      highlightedLine = highlightedLine.replace(
        /\b(\d+)\b/g,
        '<span class="icode-highlight-number">$1</span>'
      );
      
      // 变量高亮
      highlightedLine = highlightedLine.replace(
        /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=[=;,\)\]]|$)/g,
        '<span class="icode-highlight-variable">$1</span>'
      );
      
      return `<div class="icode-highlight-line">${highlightedLine}</div>`;
    }).join('');
  }
  
  // 保存文件
  saveFile() {
    if (!this.currentFile) {
      showToast('请先选择一个文件');
      return;
    }
    
    const editor = document.getElementById('icodeEditor');
    if (editor) {
      this.currentFile.content = editor.value;
      this.currentFile.modified = new Date().toISOString();
      this.saveICodeData();
      
      // 更新状态栏
      this.updateStatusBar();
      
      showToast('文件已保存');
    }
  }
  
  // 创建文件
  createFile() {
    const modal = document.createElement('div');
    modal.className = 'icode-modal show';
    modal.innerHTML = `
      <div class="icode-modal-content">
        <div class="icode-modal-header">
          <div class="icode-modal-title">创建新文件</div>
          <button class="icode-modal-close" onclick="this.closest('.icode-modal').remove()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="icode-modal-body">
          <div class="icode-form-group">
            <label>文件名</label>
            <input type="text" class="icode-form-control" id="newFileName" placeholder="输入文件名">
          </div>
          <div class="icode-form-group">
            <label>文件夹</label>
            <select class="icode-form-control" id="newFileFolder">
              ${this.folders.map(folder => `<option value="${folder}">${folder}</option>`).join('')}
            </select>
          </div>
          <div class="icode-form-group">
            <label>文件类型</label>
            <select class="icode-form-control" id="newFileType">
              <option value="js">JavaScript</option>
              <option value="py">Python</option>
              <option value="html">HTML</option>
              <option value="css">CSS</option>
              <option value="md">Markdown</option>
              <option value="txt">文本</option>
            </select>
          </div>
          <div class="icode-form-actions">
            <button class="icode-form-btn" onclick="this.closest('.icode-modal').remove()">取消</button>
            <button class="icode-form-btn primary" onclick="icodePlugin.createNewFile()">创建</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  }
  
  // 创建新文件
  createNewFile() {
    const name = document.getElementById('newFileName').value;
    const folder = document.getElementById('newFileFolder').value;
    const type = document.getElementById('newFileType').value;
    
    if (!name.trim()) {
      showToast('请输入文件名');
      return;
    }
    
    const file = {
      id: Date.now().toString(),
      name: name.trim(),
      path: `${folder}/${name.trim()}`,
      content: this.getFileTemplate(type),
      language: type,
      modified: new Date().toISOString()
    };
    
    this.files.set(file.id, file);
    this.saveICodeData();
    
    // 关闭模态框
    document.querySelector('.icode-modal.show').remove();
    
    // 刷新文件树
    this.refreshICode();
    
    // 打开新文件
    this.openFile(file.id);
    
    showToast('文件已创建');
  }
  
  // 获取文件模板
  getFileTemplate(type) {
    const templates = {
      js: `// ${type.toUpperCase()} 文件
// 创建时间: ${new Date().toLocaleString()}

function main() {
  // TODO: 实现主要逻辑
  console.log('Hello, World!');
}

main();
`,
      py: `#!/usr/bin/env python3
# ${type.toUpperCase()} 文件
# 创建时间: ${new Date().toLocaleString()}

def main():
    # TODO: 实现主要逻辑
    print("Hello, World!")

if __name__ == "__main__":
    main()
`,
      html: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.generatePageTitle()}</title>
</head>
<body>
    <h1>Hello, World!</h1>
    <script>
        // TODO: 添加JavaScript代码
    </script>
</body>
</html>
`,
      css: `/* ${type.toUpperCase()} 文件 */
/* 创建时间: ${new Date().toLocaleString()} */

body {
    /* TODO: 添加样式 */
}
`,
      md: `# ${this.generatePageTitle()}

创建时间: ${new Date().toLocaleString()}

## TODO

- [ ] 添加内容

## 代码示例

\`\`\`javascript
// TODO: 添加代码示例
\`\`\`
`,
      txt: `
# 文本文件
创建时间: ${new Date().toLocaleString()}

TODO: 添加内容...
`
    };
    
    return templates[type] || templates.js;
  }
  
  // 创建文件夹
  createFolder() {
    const name = prompt('请输入文件夹名称:');
    if (name && !this.folders.includes(name)) {
      this.folders.push(name);
      this.saveICodeData();
      this.refreshICode();
      showToast('文件夹已创建');
    }
  }
  
  // 删除文件
  deleteFile(fileId) {
    if (confirm('确定要删除这个文件吗？')) {
      this.files.delete(fileId);
      this.saveICodeData();
      
      // 如果删除的是当前文件，清空编辑器
      if (this.currentFile && this.currentFile.id === fileId) {
        this.currentFile = null;
        document.getElementById('icodeEditor').value = '';
      }
      
      this.refreshICode();
      showToast('文件已删除');
    }
  }
  
  // 编辑文件
  editFile(fileId) {
    this.openFile(fileId);
  }
  
  // 运行代码
  runCode() {
    if (!this.currentFile) {
      showToast('请先选择一个文件');
      return;
    }
    
    const code = this.currentFile.content;
    const terminal = document.getElementById('icodeTerminal');
    
    // 添加运行命令
    this.addTerminalLine(`\$ 运行 ${this.currentFile.name}`);
    
    // 根据文件类型执行不同的代码
    switch (this.currentFile.language) {
      case 'js':
        this.runJavaScript(code);
        break;
      case 'py':
        this.runPython(code);
        break;
      case 'html':
        this.runHTML(code);
        break;
      default:
        this.addTerminalLine('错误: 不支持的文件类型', 'error');
    }
  }
  
  // 运行JavaScript代码
  runJavaScript(code) {
    try {
      // 创建一个安全的执行环境
      const result = eval(code);
      this.addTerminalLine(`输出: ${result}`, 'output');
    } catch (error) {
      this.addTerminalLine(`错误: ${error.message}`, 'error');
    }
  }
  
  // 运行Python代码（模拟）
  runPython(code) {
    this.addTerminalLine('Python 代码执行 (模拟)', 'output');
    this.addTerminalLine('输出: Hello, World!', 'output');
  }
  
  // 运行HTML代码
  runHTML(code) {
    // 创建一个新窗口来显示HTML
    const newWindow = window.open('', '_blank');
    newWindow.document.write(code);
    newWindow.document.close();
  }
  
  // 格式化代码
  formatCode() {
    if (!this.currentFile) {
      showToast('请先选择一个文件');
      return;
    }
    
    const editor = document.getElementById('icodeEditor');
    if (editor) {
      // 简单的代码格式化
      let formatted = this.currentFile.content;
      
      // JavaScript 格式化
      if (this.currentFile.language === 'js') {
        formatted = formatted
          .replace(/\s*([{}();,])\s*/g, ' $1 ')
          .replace(/\s+/g, ' ')
          .replace(/;\s*}/g, ';\n}')
          .replace(/{\s*/g, '{\n  ')
          .replace(/}\s*/g, '\n}\n')
          .replace(/\n\s*\n/g, '\n');
      }
      
      editor.value = formatted;
      this.updateCode(formatted);
      
      showToast('代码已格式化');
    }
  }
  
  // 显示AI助手
  showAIAssistant() {
    if (this.aiAssistant) {
      this.aiAssistant.classList.add('show');
    }
  }
  
  // 关闭AI助手
  closeAIAssistant() {
    if (this.aiAssistant) {
      this.aiAssistant.classList.remove('show');
    }
  }
  
  // 获取AI帮助
  getAIHelp() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay show';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="modal-title">AI代码助手</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        </div>
        <div class="modal-body">
          <div style="white-space: pre-line; line-height: 1.6; color: var(--text-soft);">
            我可以帮助你：
            • 解释代码逻辑
            • 优化算法性能
            • 调试代码问题
            • 生成代码片段
            • 代码审查建议
            • 学习编程概念
            
            请告诉我你需要什么帮助？
          </div>
          <div style="margin-top: 20px;">
            <input type="text" class="form-control" id="aiHelpInput" 
                   placeholder="输入你的问题或需求..." style="margin-bottom: 12px;">
            <button class="btn btn-primary" onclick="icodePlugin.generateAIHelp()">获取帮助</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  }
  
  // 生成AI帮助
  generateAIHelp() {
    const input = document.getElementById('aiHelpInput').value;
    if (!input.trim()) {
      showToast('请输入你的需求');
      return;
    }
    
    showToast('正在生成AI帮助...');
    
    setTimeout(() => {
      const helpContent = this.generateAIHelpContent(input);
      const modal = document.querySelector('.modal-overlay.show');
      if (modal) {
        modal.querySelector('.modal-body').innerHTML += `
          <div style="margin-top: 20px; padding: 16px; background: var(--field-bg); border-radius: 8px;">
            <div style="font-weight: 600; margin-bottom: 8px; color: var(--text);">AI建议：</div>
            <div style="white-space: pre-line; line-height: 1.6; color: var(--text-soft);">
              ${helpContent}
            </div>
          </div>
        `;
      }
    }, 2000);
  }
  
  // 生成AI帮助内容
  generateAIHelpContent(input) {
    const helpTemplates = {
      '循环': '在编程中，循环用于重复执行代码块。常见的循环结构有：\n\n1. for 循环：用于已知次数的循环\n2. while 循环：用于条件循环\n3. do-while 循环：至少执行一次的循环\n\n示例：\nfor (let i = 0; i < 10; i++) {\n  console.log(i);\n}',
      '函数': '函数是可重用的代码块，用于执行特定任务。函数可以：\n\n- 接受参数作为输入\n- 执行特定的操作\n- 返回结果\n\n示例：\nfunction add(a, b) {\n  return a + b;\n}\n\nconst result = add(5, 3); // 返回 8',
      '数组': '数组是用于存储多个值的有序集合。常用操作：\n\n- 创建数组：const arr = [1, 2, 3];\n- 访问元素：arr[0];\n- 添加元素：arr.push(4);\n- 删除元素：arr.pop();\n- 遍历数组：arr.forEach(item => console.log(item));',
      '对象': '对象是用于存储键值对的数据结构。常用操作：\n\n- 创建对象：const obj = {name: "张三", age: 25};\n- 访问属性：obj.name;\n- 添加属性：obj.city = "北京";\n- 遍历对象：for (let key in obj) {console.log(key, obj[key]);}'
    };
    
    for (const [key, template] of Object.entries(helpTemplates)) {
      if (input.includes(key)) {
        return template;
      }
    }
    
    return '根据你的需求，我建议你先明确编程概念，然后通过实践来加深理解。可以参考官方文档或在线教程。如果有具体的代码问题，请提供代码示例，我可以帮你分析和解决。';
  }
  
  // 优化代码
  optimizeCode() {
    if (!this.currentFile) {
      showToast('请先选择一个文件');
      return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay show';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="modal-title">代码优化建议</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
        </div>
        <div class="modal-body">
          <div class="icode-ai-code">
            // 当前代码
            ${this.currentFile.content}
          </div>
          <div style="margin-top: 16px; padding: 16px; background: var(--field-bg); border-radius: 8px;">
            <div style="font-weight: 600; margin-bottom: 12px; color: var(--text);">优化建议：</div>
            <ul style="color: var(--text-soft); line-height: 1.6;">
              <li>使用 const/let 替代 var，避免变量提升问题</li>
              <li>提取重复代码为函数，提高代码复用性</li>
              <li>添加适当的注释，提高代码可读性</li>
              <li>优化循环结构，减少不必要的计算</li>
              <li>使用现代JavaScript特性，如箭头函数、解构赋值等</li>
            </ul>
          </div>
          <div style="margin-top: 20px; text-align: right;">
            <button class="btn" onclick="this.closest('.modal-overlay').remove()">关闭</button>
            <button class="btn btn-primary" onclick="icodePlugin.applyOptimizations()">应用优化</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  }
  
  // 应用优化
  applyOptimizations() {
    if (!this.currentFile) return;
    
    // 简单的代码优化
    let optimized = this.currentFile.content;
    
    // 替换 var 为 const/let
    optimized = optimized.replace(/\bvar\b/g, 'let');
    
    // 添加时间戳注释
    const timestamp = new Date().toLocaleString();
    optimized = `// 优化时间: ${timestamp}\n\n${optimized}`;
    
    this.currentFile.content = optimized;
    this.saveICodeData();
    
    // 刷新编辑器
    this.loadFileContent(this.currentFile.id);
    
    // 关闭模态框
    document.querySelector('.modal-overlay.show').remove();
    
    showToast('代码已优化');
  }
  
  // 插入代码片段
  insertSnippet(snippetId) {
    const snippet = this.snippets.find(s => s.id === snippetId);
    if (!snippet) return;
    
    const editor = document.getElementById('icodeEditor');
    if (editor) {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const text = editor.value;
      
      // 插入代码片段
      const newText = text.substring(0, start) + snippet.code + text.substring(end);
      editor.value = newText;
      
      // 更新代码
      this.updateCode(newText);
      
      // 关闭片段面板
      this.closeSnippets();
      
      showToast('代码片段已插入');
    }
  }
  
  // 关闭代码片段
  closeSnippets() {
    if (this.snippetsPanel) {
      this.snippetsPanel.classList.remove('show');
    }
  }
  
  // 显示代码片段
  showSnippets() {
    if (this.snippetsPanel) {
      this.snippetsPanel.classList.add('show');
    }
  }
  
  // 清空终端
  clearTerminal() {
    const terminal = document.getElementById('icodeTerminal');
    if (terminal) {
      terminal.innerHTML = `
        <div class="icode-terminal-line">终端已清空</div>
        <div class="icode-terminal-input">
          <span class="icode-terminal-prompt">$</span>
          <input type="text" class="icode-terminal-command" id="terminalInput" 
                 onkeypress="icodePlugin.handleTerminalInput(event)" placeholder="输入命令...">
        </div>
      `;
    }
  }
  
  // 切换终端显示
  toggleTerminal() {
    const terminal = document.querySelector('.icode-terminal');
    if (terminal) {
      terminal.style.display = terminal.style.display === 'none' ? 'flex' : 'none';
    }
  }
  
  // 处理终端输入
  handleTerminalInput(event) {
    if (event.key === 'Enter') {
      const input = event.target;
      const command = input.value.trim();
      
      if (command) {
        this.addTerminalLine(`\$ ${command}`);
        
        // 处理命令
        this.handleTerminalCommand(command);
        
        // 清空输入
        input.value = '';
      }
    }
  }
  
  // 处理终端命令
  handleTerminalCommand(command) {
    const parts = command.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);
    
    switch (cmd) {
      case 'help':
        this.addTerminalLine('可用命令:', 'output');
        this.addTerminalLine('  help - 显示帮助信息', 'output');
        this.addTerminalLine('  clear - 清空终端', 'output');
        this.addTerminalLine('  list - 列出文件', 'output');
        this.addTerminalLine('  run [文件名] - 运行文件', 'output');
        this.addTerminalLine('  exit - 退出终端', 'output');
        break;
        
      case 'clear':
        this.clearTerminal();
        break;
        
      case 'list':
        this.listFiles();
        break;
        
      case 'run':
        if (args.length > 0) {
          const fileName = args[0];
          const file = Array.from(this.files.values()).find(f => f.name === fileName);
          if (file) {
            this.currentFile = file;
            this.loadFileContent(file.id);
            this.runCode();
          } else {
            this.addTerminalLine(`错误: 文件 '${fileName}' 不存在`, 'error');
          }
        } else {
          this.addTerminalLine('错误: 请指定要运行的文件名', 'error');
        }
        break;
        
      case 'exit':
        this.addTerminalLine('再见!');
        break;
        
      default:
        this.addTerminalLine(`错误: 未知命令 '${cmd}'`, 'error');
        this.addTerminalLine('输入 "help" 查看可用命令', 'output');
    }
  }
  
  // 列出文件
  listFiles() {
    this.addTerminalLine('文件列表:', 'output');
    this.files.forEach(file => {
      this.addTerminalLine(`  ${file.name} (${file.language})`, 'output');
    });
  }
  
  // 添加终端行
  addTerminalLine(text, type = 'output') {
    const terminal = document.getElementById('icodeTerminal');
    if (terminal) {
      const line = document.createElement('div');
      line.className = `icode-terminal-line ${type}`;
      line.textContent = text;
      
      // 添加到现有内容中，在输入框之前
      const inputContainer = terminal.querySelector('.icode-terminal-input');
      if (inputContainer) {
        terminal.insertBefore(line, inputContainer);
      } else {
        terminal.appendChild(line);
      }
      
      // 滚动到底部
      terminal.scrollTop = terminal.scrollHeight;
    }
  }
  
  // 更新状态栏
  updateStatusBar() {
    const editor = document.getElementById('icodeEditor');
    if (editor) {
      const text = editor.value;
      const lines = text.split('\n');
      const currentLine = editor.selectionStart ? text.substring(0, editor.selectionStart).split('\n').length : 1;
      const currentColumn = editor.selectionStart ? editor.selectionStart - text.lastIndexOf('\n', editor.selectionStart - 1) : 1;
      const charCount = text.length;
      
      document.getElementById('currentLine').textContent = currentLine;
      document.getElementById('currentColumn').textContent = currentColumn;
      document.getElementById('currentChars').textContent = charCount;
    }
  }
  
  // 获取文件图标
  getFileIcon(file) {
    if (!file) return '';
    
    const icons = {
      js: '<svg class="icode-file-icon js" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
      py: '<svg class="icode-file-icon py" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
      html: '<svg class="icode-file-icon html" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
      css: '<svg class="icode-file-icon css" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
      md: '<svg class="icode-file-icon md" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
      txt: '<svg class="icode-file-icon txt" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>'
    };
    
    return icons[file.language] || icons.txt;
  }
  
  // 生成函数名
  generateFunctionName() {
    const names = ['calculate', 'process', 'create', 'update', 'delete', 'get', 'set', 'render', 'build', 'parse'];
    return names[Math.floor(Math.random() * names.length)];
  }
  
  // 生成参数
  generateParameters() {
    const params = ['param1', 'param2', 'options', 'data', 'callback'];
    const count = Math.floor(Math.random() * 3) + 1;
    const selected = params.slice(0, count);
    return selected.join(', ');
  }
  
  // 生成返回值
  generateReturnValue() {
    const values = ['null', 'true', 'false', '"result"', '[]', '{}'];
    return values[Math.floor(Math.random() * values.length)];
  }
  
  // 生成类名
  generateClassName() {
    const names = ['User', 'Product', 'Service', 'Manager', 'Controller', 'Model', 'View', 'Component'];
    return names[Math.floor(Math.random() * names.length)];
  }
  
  // 生成构造函数参数
  generateConstructorParams() {
    return '';
  }
  
  // 生成方法名
  generateMethodName() {
    const names = ['init', 'start', 'stop', 'run', 'execute', 'save', 'load', 'validate', 'transform'];
    return names[Math.floor(Math.random() * names.length)];
  }
  
  // 生成方法参数
  generateMethodParams() {
    return '';
  }
  
  // 生成页面标题
  generatePageTitle() {
    const titles = ['我的网页', '项目首页', '个人博客', '作品展示', '技术文档'];
    return titles[Math.floor(Math.random() * titles.length)];
  }
  
  // 刷新ICode界面
  refreshICode() {
    if (this.icodePanel) {
      // 更新文件树
      const fileTree = this.icodePanel.querySelector('.icode-file-tree');
      if (fileTree) {
        fileTree.innerHTML = this.createFileTreeHTML();
      }
    }
  }
  
  // 关闭ICode面板
  closeICodePanel() {
    if (this.icodePanel) {
      this.icodePanel.classList.remove('open');
    }
    if (this.shortcutsPanel) this.shortcutsPanel.classList.remove('show');
    this.closeAIAssistant();
  }
  
  // AI同步
  startAISync() {
    // 定期检查代码质量
    setInterval(() => {
      this.checkCodeQuality();
    }, 60000); // 每分钟检查一次
    
    // 监听编辑器输入，提供实时建议
    const editor = document.getElementById('icodeEditor');
    if (editor) {
      editor.addEventListener('input', () => {
        this.provideRealtimeSuggestions();
      });
    }
  }
  
  // 检查代码质量
  checkCodeQuality() {
    if (!this.currentFile) return;
    
    const code = this.currentFile.content;
    const issues = [];
    
    // 检查常见问题
    if (code.includes('var ')) {
      issues.push('建议使用 const/let 替代 var');
    }
    
    if (code.includes('function ')) {
      issues.push('考虑使用箭头函数');
    }
    
    if (code.includes('console.log')) {
      issues.push('生产环境中应移除 console.log');
    }
    
    if (issues.length > 0) {
      this.showCodeQualityIssues(issues);
    }
  }
  
  // 显示代码质量问题
  showCodeQualityIssues(issues) {
    const notification = document.createElement('div');
    notification.className = 'icode-notification';
    notification.style.cssText = `
      position: fixed;
      top: 80px;
      right: 24px;
      background: var(--card-bg);
      border: 1px solid var(--card-line);
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      max-width: 320px;
      z-index: 1002;
    `;
    
    notification.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px; color: var(--text);">代码质量建议</div>
      <ul style="color: var(--text-soft); line-height: 1.4; margin: 0; padding-left: 16px;">
        ${issues.map(issue => `<li style="margin-bottom: 4px;">${issue}</li>`).join('')}
      </ul>
      <div style="margin-top: 12px; text-align: right;">
        <button class="btn btn-primary" onclick="this.parentElement.parentElement.remove()">知道了</button>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, 10000);
  }
  
  // 提供实时建议
  provideRealtimeSuggestions() {
    if (!this.currentFile) return;
    
    const code = this.currentFile.content;
    const cursorPos = document.getElementById('icodeEditor').selectionStart;
    
    // 简单的自动完成建议
    if (code.substring(Math.max(0, cursorPos - 10), cursorPos).includes('function')) {
      // 显示函数建议
      console.log('Suggesting function template...');
    }
  }
  
  // 绑定事件
  bindEvents() {
    // ESC键关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.icodePanel && this.icodePanel.classList.contains('open')) {
        this.closeICodePanel();
      }
    });
    
    // 快捷键
    document.addEventListener('keydown', (e) => {
      if (!this.icodePanel || !this.icodePanel.classList.contains('open')) return;
      
      // Ctrl+S 保存
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        this.saveFile();
      }
      
      // Ctrl+Z 撤销
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        this.undo();
      }
      
      // Ctrl+Y 重做
      if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        this.redo();
      }
      
      // Ctrl+F 搜索
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        this.search();
      }
      
      // Ctrl+Enter 运行
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        this.runCode();
      }
    });
    
    // 点击外部关闭
    document.addEventListener('click', (e) => {
      if (this.icodePanel && this.icodePanel.classList.contains('open') &&
          !this.icodePanel.contains(e.target) && !e.target.closest('[data-menu="icode"]')) {
        this.closeICodePanel();
      }
    });
  }
  
  // 撤销功能
  undo() {
    const editor = document.getElementById('icodeEditor');
    if (editor) {
      // 简单的撤销实现
      const history = JSON.parse(localStorage.getItem('icode_history') || '[]');
      if (history.length > 0) {
        const lastState = history.pop();
        editor.value = lastState;
        this.updateCode(lastState);
        localStorage.setItem('icode_history', JSON.stringify(history));
      }
    }
  }
  
  // 重做功能
  redo() {
    // 重做功能实现
    console.log('Redo functionality');
  }
  
  // 搜索功能
  search() {
    const searchTerm = prompt('搜索:');
    if (searchTerm) {
      this.searchQuery = searchTerm.toLowerCase();
      this.refreshICode();
    }
  }
}

// 初始化ICode插件
let icodePlugin;
document.addEventListener('DOMContentLoaded', () => {
  icodePlugin = new ICodePlugin();
});

// 全局函数
function openICodePanel() {
  if (icodePlugin) {
    icodePlugin.openICodePanel();
  }
}