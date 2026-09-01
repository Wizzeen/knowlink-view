// ====================================================================
//  KnowLink 知识库 — 侧边栏逻辑 (sidepanel.js)
//  纯列表视图，管理知识点的收集、查看、搜索、导入/导出
// ====================================================================

// ---- Windows 任务栏适配 ----
// Chrome 侧边栏在 Windows 最大化时，100vh 会延伸到任务栏后面，导致底部内容被遮挡。
// 用屏幕可用高度算出需要扣除的高度，写入 CSS 变量 --taskbar-inset（见 sidepanel.html 的 body height）。
function applyTaskbarInset() {
  var inset = 0;
  try {
    if (/Windows/i.test(navigator.userAgent)) {
      var taskbar = window.screen.height - window.screen.availHeight; // 底部任务栏高度
      if (taskbar > 0) {
        // 只有窗口贴住屏幕底部（最大化/拖到贴底）时才扣除，避免普通窗口底部留白
        var top = (window.screenTop != null) ? window.screenTop : (window.screenY || 0);
        var overlap = (top + window.outerHeight) - window.screen.availHeight;
        if (overlap > 0) inset = Math.min(taskbar, overlap);
      }
    }
  } catch (e) { inset = 0; }
  document.documentElement.style.setProperty('--taskbar-inset', inset + 'px');
}
window.addEventListener('load', applyTaskbarInset);
window.addEventListener('resize', applyTaskbarInset);
applyTaskbarInset();

// ---- i18n 初始化 + 语言切换 ----
if (window.I18n) {
  window.I18n.init();
  var btnLang = document.getElementById('btn-lang');
  if (btnLang) {
    btnLang.addEventListener('click', function() {
      window.I18n.toggleLocale().then(function() {
        // 语言切换后刷新动态文案
        loadKnowledgeBases();
        loadRecentPdfsInSidepanel();
        if (window.AIWormhole && typeof window.AIWormhole.getConfig === 'function') {
          checkOnboarding();
        }
      });
    });
  }
}

// ---- 主题切换（obsidian 简洁 / space 深空） ----
var _currentTheme = 'obsidian';
function applyTheme(name) {
  _currentTheme = name;
  document.documentElement.setAttribute('data-theme', name);
  if (typeof setKnowlinkTheme === 'function') setKnowlinkTheme(name);
  try {
    chrome.storage.local.set({ knowlinkTheme: name });
  } catch (e) {}
}
var btnTheme = document.getElementById('btn-theme');
if (btnTheme) {
  btnTheme.addEventListener('click', function() {
    applyTheme(_currentTheme === 'obsidian' ? 'space' : 'obsidian');
  });
}
// 恢复持久化主题
try {
  chrome.storage.local.get(['knowlinkTheme'], function(result) {
    if (result.knowlinkTheme === 'space' || result.knowlinkTheme === 'obsidian') {
      applyTheme(result.knowlinkTheme);
    }
  });
} catch (e) {}

// ---- PDF.js Worker 初始化 (从内联脚本移出，解决CSP报错) ----
try {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
  }
} catch (e) { /* file:// 或非扩展环境，忽略 */ }

// ---- DOM 引用 ----
var listEl        = document.getElementById('knowledge-list');
var emptyState    = document.getElementById('empty-state');
var clearBtn      = document.getElementById('clear-btn');
var searchInput   = document.getElementById('search-input');
var btnExport     = document.getElementById('btn-export');
var btnImport     = document.getElementById('btn-import');
var fileInput     = document.getElementById('import-file');

// 最近 PDF
var recentPdfsListSp = document.getElementById('recent-pdfs-list-sp');
var btnRefreshPdfsSp = document.getElementById('btn-refresh-pdfs-sp');

// KB UI
var kbSelector  = document.getElementById('kb-selector');
var btnNewKB    = document.getElementById('btn-new-kb');
var btnRenameKB = document.getElementById('btn-rename-kb');
var btnDeleteKB   = document.getElementById('btn-delete-kb');
var btnFullscreen  = document.getElementById('btn-fullscreen');
var btnSettings    = document.getElementById('btn-settings');
var settingsPanel  = document.getElementById('settings-panel');

// ---- 全局状态 ----
var knowledgeBases        = [];
var activeKnowledgeBaseId = 'kb_default';
var knowledgePoints       = [];
var sourceColorMap        = {};
var filterText            = '';
var maxItems              = 200;

// 变化报告状态
var currentReport = null;  // 当前管线分析结果

// ==================== 设置管理 ====================
function loadSettings(callback) {
  try {
    chrome.storage.local.get(['knowlinkSettings'], function(result) {
      var settings = result.knowlinkSettings || {};
      maxItems = settings.maxItems || 200;
      if (callback) callback();
    });
  } catch (e) {
    if (callback) callback();
  }
}

// ==================== 知识库工具函数 ====================
function getActiveKBName() {
  var kb = knowledgeBases.find(function(k) { return k.id === activeKnowledgeBaseId; });
  return kb ? kb.name : '知识库';
}

function getActiveKB() {
  return knowledgeBases.find(function(k) { return k.id === activeKnowledgeBaseId; });
}

function saveKnowledgeBases(callback) {
  // KBStore 已管理持久化，此处仅刷新本地缓存
  knowledgeBases = self.KBStore.getKBs();
  knowledgePoints = self.KBStore.getPoints();
  if (callback) callback();
}

// ==================== 知识库 CRUD ====================
function renderKBSelector() {
  if (!kbSelector) return;
  kbSelector.innerHTML = '';
  knowledgeBases.forEach(function(kb) {
    var opt = document.createElement('option');
    opt.value = kb.id;
    opt.textContent = kb.name;
    if (kb.id === activeKnowledgeBaseId) opt.selected = true;
    kbSelector.appendChild(opt);
  });
  if (btnDeleteKB) btnDeleteKB.style.display = knowledgeBases.length > 1 ? '' : 'none';
  updateClearBtnText();
}

function updateClearBtnText() {
  if (clearBtn) clearBtn.textContent = '🗑️ 清空「' + getActiveKBName() + '」';
}

function switchKnowledgeBase(kbId) {
  if (kbId === activeKnowledgeBaseId) return;
  activeKnowledgeBaseId = kbId;
  filterText = '';
  if (searchInput) searchInput.value = '';
  self.KBStore.setActiveKB(kbId).then(function() {
    loadKnowledgeBases();
  });
}

function createKnowledgeBase(name) {
  self.KBStore.createKB(name).then(function() {
    activeKnowledgeBaseId = self.KBStore.getActiveKBId();
    loadKnowledgeBases();
  }).catch(function(err) {
    alert(window.I18n ? window.I18n.t('alert.create.fail', {msg: err.message}) : ('创建失败：' + err.message));
  });
}

function renameKnowledgeBase(kbId, newName) {
  self.KBStore.renameKB(kbId, newName).then(function() {
    loadKnowledgeBases();
  }).catch(function(err) {
    alert(window.I18n ? window.I18n.t('alert.rename.fail', {msg: err.message}) : ('重命名失败：' + err.message));
  });
}

function deleteKnowledgeBase(kbId) {
  var kbs = self.KBStore.getKBs();
  if (kbs.length <= 1) { alert(window.I18n ? window.I18n.t('alert.keep.one') : '至少需要保留一个知识库。'); return; }
  var kb = kbs.find(function(k) { return k.id === kbId; });
  if (!confirm(window.I18n ? window.I18n.t('confirm.delete.kb', {name: kb ? kb.name : ''}) : ('确定要删除知识库「' + (kb ? kb.name : '') + '」吗？'))) return;
  self.KBStore.deleteKB(kbId).then(function(result) {
    if (result.newActiveId) activeKnowledgeBaseId = result.newActiveId;
    loadKnowledgeBases();
  }).catch(function(err) {
    console.error('删除失败:', err);
  });
}

// KB UI 事件
if (kbSelector) {
  kbSelector.addEventListener('change', function() {
    if (this.value !== activeKnowledgeBaseId) switchKnowledgeBase(this.value);
  });
}
if (btnNewKB) {
  btnNewKB.addEventListener('click', function() {
    var name = prompt(window.I18n ? window.I18n.t('prompt.new.kb') : '请输入新知识库名称：', window.I18n ? window.I18n.t('prompt.new.kb.default') : '新知识库');
    if (name && name.trim()) createKnowledgeBase(name.trim());
  });
}
if (btnRenameKB) {
  btnRenameKB.addEventListener('click', function() {
    var kb = getActiveKB();
    if (!kb) return;
    var newName = prompt(window.I18n ? window.I18n.t('prompt.rename.kb') : '重命名知识库：', kb.name);
    if (newName && newName.trim() && newName.trim() !== kb.name) {
      renameKnowledgeBase(activeKnowledgeBaseId, newName.trim());
    }
  });
}
if (btnDeleteKB) {
  btnDeleteKB.addEventListener('click', function() { deleteKnowledgeBase(activeKnowledgeBaseId); });
}

// ==================== 数据加载 ====================
function loadKnowledgeBases(callback) {
  try {
    // 从统一数据层读取
    knowledgeBases = self.KBStore.getKBs();
    activeKnowledgeBaseId = self.KBStore.getActiveKBId();
    knowledgePoints = self.KBStore.getPoints();

    renderKBSelector();
    updateStatusBadge();
    updateClearBtnText();
    renderList();

    if (callback) callback();
  } catch (e) { console.error('[Sidepanel] loadKnowledgeBases 异常:', e); }
}

function loadData() { loadKnowledgeBases(); }

// ==================== 状态徽章 ====================
function updateStatusBadge() {
  var badge = document.getElementById('status-badge');
  if (!badge) return;
  var kbName = getActiveKBName();
  if (knowledgePoints.length) {
    badge.textContent = window.I18n
      ? window.I18n.t('status.count', {name: kbName, count: knowledgePoints.length, max: maxItems})
      : ('📂 ' + kbName + ' · ✅ ' + knowledgePoints.length + ' / ' + maxItems);
    badge.style.color = '#10b981';
  } else {
    badge.textContent = '📂 ' + kbName + ' · ' + (window.I18n ? window.I18n.t('status.void') : '空');
    badge.style.color = '#6b7280';
  }
}

// ==================== 列表渲染 ====================

function renderList() {
  listEl.innerHTML = '';
  if (!knowledgePoints.length) {
    emptyState.hidden = false;
    emptyState.innerHTML = '<div style="text-align:center;padding:20px;">'
      + '<div style="font-size:32px;margin-bottom:8px;">📄</div>'
      + '<div>' + (window.I18n ? window.I18n.t('empty.kb.detail', {name: escapeHtml(getActiveKBName())}) : ('知识库「' + escapeHtml(getActiveKBName()) + '」中还没有知识点')) + '</div>'
      + '<div style="font-size:12px;color:#6b7280;">' + (window.I18n ? window.I18n.t('empty.kb.hint') : '选中网页文字后点击浮动按钮收集') + '</div>'
      + '</div>';
    return;
  }
  emptyState.hidden = true;
  assignSourceColors(knowledgePoints, sourceColorMap);

  var filtered = knowledgePoints;
  var ft = filterText.toLowerCase().trim();
  if (ft) {
    filtered = knowledgePoints.filter(function(p) {
      return (p.text || '').toLowerCase().includes(ft) ||
             (p.source || '').toLowerCase().includes(ft) ||
             (p.url || '').toLowerCase().includes(ft);
    });
    if (!filtered.length) {
      emptyState.hidden = false;
      emptyState.innerHTML = '<div style="text-align:center;padding:20px;color:#6b7280;">' + (window.I18n ? window.I18n.t('empty.search') : '🔍 未找到匹配的知识点') + '</div>';
    }
  }

  filtered.forEach(function(p) {
    var idx = knowledgePoints.indexOf(p);
    var li = document.createElement('li');
    li.className = 'card';
    li.dataset.index = idx;
    li.dataset.url   = p.url || '';
    li.dataset.text  = p.text || '';
    li.dataset.page  = p.page || '0';
    li.dataset.title = p.title || '';

    var color = sourceColorMap[p.url] || '#7c3aed';
    var isWeb = p.url && (p.url.startsWith('http://') || p.url.startsWith('https://'));
    var safeText   = escapeHtml(p.text);
    var safeSource = escapeHtml(p.source);

    var timeStr = '';
    if (p.timestamp) {
      var d = new Date(p.timestamp);
      timeStr = ' · ' + d.toLocaleDateString(window.I18n && window.I18n.getLocale() === 'en' ? 'en-US' : 'zh-CN');
    }

    var metaHtml = isWeb
      ? '<span class="meta"><span class="source-dot" style="background:' + color + ';color:' + color + ';"></span>' + (window.I18n ? window.I18n.t('source.web', {source: safeSource, time: timeStr}) : ('🔗 ' + safeSource + timeStr + '（点击追溯）')) + '</span>'
      : '<span class="meta"><span class="source-dot" style="background:' + color + ';color:' + color + ';"></span>' + (window.I18n ? window.I18n.t('source.file', {source: safeSource, time: timeStr}) : ('📄 ' + safeSource + timeStr)) + '</span>';

    li.innerHTML = '<div style="line-height:1.5;font-weight:500;padding-right:20px;">' + safeText + '</div>' + metaHtml;

    var delBtn = document.createElement('span');
    delBtn.className = 'card-delete';
    delBtn.innerHTML = '&times;';
    delBtn.title = window.I18n ? window.I18n.t('delete.point') : '删除此知识点';
    delBtn.addEventListener('click', function(e) {
      e.stopPropagation(); e.preventDefault();
      deleteKnowledgePoint(idx);
    });
    li.appendChild(delBtn);

    listEl.appendChild(li);
  });
}

// ==================== 单条删除 ====================
function deleteKnowledgePoint(index) {
  if (index < 0 || index >= knowledgePoints.length) return;
  var point = knowledgePoints[index];
  var preview = (point.text || '').substring(0, 20);
  if (!confirm(window.I18n ? window.I18n.t('confirm.delete.point', {preview: preview}) : ('确定要删除这个知识点吗？\n\n"' + preview + '..."'))) return;

  // 记录稳定 ID 用于孤边清理
  var deletedId = point.id || '';

  self.KBStore.removePoint(point.id).then(function() {
    loadData();

    // 清理该知识点的所有 AI 连线（孤边清理）
    if (deletedId && window.AIWormhole) {
      if (typeof window.AIWormhole.removeEdgesForPoint === 'function') {
        var removed = window.AIWormhole.removeEdgesForPoint(deletedId);
        if (removed > 0) console.log('[Sidepanel] 已清理 ' + removed + ' 条孤边');
      } else {
        // 降级：遍历删除
        var edges = window.AIWormhole.getAIEdges ? window.AIWormhole.getAIEdges() : [];
        edges.forEach(function(e) {
          if (e.from === deletedId || e.to === deletedId) {
            if (typeof window.AIWormhole.removeAIEdge === 'function') {
              window.AIWormhole.removeAIEdge(e.from, e.to);
            }
          }
        });
      }
    }

    // 通知网络视图刷新
    try {
      chrome.runtime.sendMessage({ type: 'REFRESH_KNOWLEDGE', kbId: activeKnowledgeBaseId });
    } catch (e) {}
  });
}

// ==================== 卡片点击 — 追溯来源 ====================
if (listEl) listEl.addEventListener('click', function(e) {
  if (e.target.closest('.card-delete')) return;
  var card = e.target.closest('.card');
  if (!card) return;
  var url  = card.dataset.url || '';
  var text = card.dataset.text || '';
  var page = parseInt(card.dataset.page || '0', 10) || 0;
  var title = card.dataset.title || '';
  navigateToSource(url, text, page, title);
});

// ==================== 导航函数 ====================
// resolveRealUrl / navigateToSource 已移至 utils.js 共享

// ==================== 消息 / 清空 ====================
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.type === 'REFRESH_KNOWLEDGE' || message.type === 'NEW_KNOWLEDGE') {
    if (message.kbId && message.kbId !== activeKnowledgeBaseId) {
      try { sendResponse({status:'success'}); } catch(e) {}
      return false;
    }
    loadData();
    try { sendResponse({status:'success'}); } catch(e) {}
    return false;
  }
  if (message.type === 'KB_STORE_CHANGED') {
    loadData();
    try { sendResponse({status:'success'}); } catch(e) {}
    return false;
  }
  if (message.type === 'DUPLICATE_KNOWLEDGE') {
    try { sendResponse({status:'success'}); } catch(e) {}
    return false;
  }
});

if (clearBtn) clearBtn.addEventListener('click', function() {
  var kbName = getActiveKBName();
  if (!confirm(window.I18n ? window.I18n.t('confirm.clear.kb', {name: kbName, count: knowledgePoints.length}) : ('确定要清空知识库「' + kbName + '」中的所有 ' + knowledgePoints.length + ' 条知识点吗？'))) return;

  // 清空所有 AI 连线（因为所有知识点都被删除了）
  if (window.AIWormhole && typeof window.AIWormhole.removeAIEdges === 'function') {
    window.AIWormhole.removeAIEdges();
    console.log('[Sidepanel] 已清空所有 AI 连线');
  }

  self.KBStore.clearPoints().then(function() {
    loadData();
    try {
      chrome.runtime.sendMessage({ type: 'REFRESH_KNOWLEDGE', kbId: activeKnowledgeBaseId });
    } catch (e) {}
  });
});

// ==================== 导出/导入 ====================
if (btnExport) {
  btnExport.addEventListener('click', function() {
    if (!knowledgePoints.length) { alert(window.I18n ? window.I18n.t('alert.export.empty', {name: getActiveKBName()}) : ('知识库「' + getActiveKBName() + '」中无内容。')); return; }
    var data = JSON.stringify(knowledgePoints, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'knowlink-' + getActiveKBName() + '-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

if (btnImport && fileInput) {
  btnImport.addEventListener('click', function() { fileInput.click(); });
  fileInput.addEventListener('change', function() {
    var file = fileInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var imported = JSON.parse(e.target.result);
        if (!Array.isArray(imported)) { alert(window.I18n ? window.I18n.t('alert.import.format') : '格式错误：需要 JSON 数组。'); return; }
        // 校验每个条目
        var validItems = [];
        var skipped = 0;
        for (var ii = 0; ii < imported.length; ii++) {
          var item = imported[ii];
          var itemText = item.text || item.title || '';
          if (!itemText || !itemText.trim()) { skipped++; continue; }
          if (itemText.length > 5000) { itemText = itemText.substring(0, 5000); }
          if (item.url && typeof item.url !== 'string') { item.url = ''; }
          if (item.url && item.url.length > 2000) { item.url = item.url.substring(0, 2000); }
          // 确保 text 字段非空
          item.text = item.text || item.title || '';
          validItems.push(item);
        }
        if (!validItems.length) { alert(window.I18n ? window.I18n.t('alert.import.invalid') : '导入失败：所有条目无效（缺少 text/url 字段）。'); return; }
        var msg = window.I18n ? window.I18n.t('import.summary', {total: imported.length, valid: validItems.length}) : ('共 ' + imported.length + ' 条，有效 ' + validItems.length + ' 条');
        if (skipped > 0) msg += window.I18n ? window.I18n.t('import.skipped', {count: skipped}) : ('（跳过 ' + skipped + ' 条无效）');
        var mode = confirm(window.I18n ? window.I18n.t('import.mode', {summary: msg}) : (msg + '\n\n点击"确定"合并，点击"取消"替换。'));
        if (mode) {
          validItems.reverse().forEach(function(item) { knowledgePoints.unshift(item); });
        } else { knowledgePoints = validItems; }
        saveKnowledgeBases(function() { loadData(); });
      } catch (err) { alert(window.I18n ? window.I18n.t('alert.import.parse', {msg: err.message}) : ('解析失败：' + err.message)); }
    };
    reader.readAsText(file);
    fileInput.value = '';
  });
}

// ==================== 设置面板（搜索 / 导入导出） ====================
function toggleSettingsPanel(force) {
  if (!settingsPanel) return;
  var isShowing = settingsPanel.classList.contains('show');
  var shouldShow = (typeof force === 'boolean') ? force : !isShowing;
  if (shouldShow) {
    settingsPanel.classList.add('show');
    if (btnSettings) btnSettings.classList.add('active');
    // 打开时聚焦搜索框
    if (searchInput) setTimeout(function() { searchInput.focus(); }, 50);
  } else {
    settingsPanel.classList.remove('show');
    if (btnSettings) btnSettings.classList.remove('active');
  }
}

if (btnSettings) {
  btnSettings.addEventListener('click', function(e) {
    e.stopPropagation();
    toggleSettingsPanel();
  });
}

// 点击面板外部关闭
document.addEventListener('click', function(e) {
  if (!settingsPanel || !settingsPanel.classList.contains('show')) return;
  if (settingsPanel.contains(e.target) || (btnSettings && btnSettings.contains(e.target))) return;
  toggleSettingsPanel(false);
});

// Escape 关闭设置面板
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && settingsPanel && settingsPanel.classList.contains('show')) {
    toggleSettingsPanel(false);
  }
});

// ==================== 搜索 ====================
if (searchInput) {
  searchInput.addEventListener('input', function() {
    filterText = searchInput.value;
    renderList();
  });
  searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      searchInput.value = ''; filterText = '';
      renderList();
    }
  });
}

// ==================== 最近 PDF 列表 ====================
function formatTimeAgoSp(ts) {
  var diff = Date.now() - ts;
  var I = window.I18n;
  if (diff < 60000) return I ? I.t('time.just.now') : '刚刚';
  if (diff < 3600000) return I ? I.t('time.minutes.ago', {n: Math.floor(diff / 60000)}) : (Math.floor(diff / 60000) + ' 分钟前');
  if (diff < 86400000) return I ? I.t('time.hours.ago', {n: Math.floor(diff / 3600000)}) : (Math.floor(diff / 3600000) + ' 小时前');
  var d = new Date(ts);
  return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

function getFileNameSp(url) {
  try {
    var name = url.split('/').pop().split('?')[0].split('#')[0];
    return decodeURIComponent(name);
  } catch(e) { return url.split('/').pop(); }
}

function loadRecentPdfsInSidepanel() {
  if (!recentPdfsListSp) return;
  chrome.runtime.sendMessage({ type: 'GET_TODAY_PDFS' }, function(response) {
    var pdfs = (response && response.pdfs) ? response.pdfs : [];
    if (pdfs.length === 0) {
      recentPdfsListSp.innerHTML = '<li class="sp-empty">' + (window.I18n ? window.I18n.t('recent.pdfs.empty.sp') : '📭 今天还没有打开过 PDF') + '</li>';
      return;
    }
    var html = '';
    for (var i = 0; i < Math.min(pdfs.length, 10); i++) {
      var pdf = pdfs[i];
      var cleanUrl = pdf.cleanUrl || pdf.url || '';
      var name = getFileNameSp(cleanUrl);
      var timeStr = pdf.time || formatTimeAgoSp(pdf.lastVisitTime);
      html += '<li data-url="' + escapeHtml(cleanUrl) + '" title="' + escapeHtml(cleanUrl) + '">' +
        '<span class="sp-pdf-icon">📄</span>' +
        '<span class="sp-pdf-name">' + escapeHtml(name) + '</span>' +
        '<span class="sp-pdf-time">' + escapeHtml(timeStr) + '</span></li>';
    }
    recentPdfsListSp.innerHTML = html;
    var items = recentPdfsListSp.querySelectorAll('li[data-url]');
    for (var j = 0; j < items.length; j++) {
      items[j].addEventListener('click', function() {
        var targetUrl = this.getAttribute('data-url');
        if (targetUrl) {
          chrome.tabs.create({ url: targetUrl });
        }
      });
    }
  });
}

if (btnRefreshPdfsSp) {
  btnRefreshPdfsSp.addEventListener('click', function() {
    chrome.runtime.sendMessage({ type: 'REFRESH_PDF_HISTORY_CACHE' }, function() { loadRecentPdfsInSidepanel(); });
  });
}

// 全屏按钮：在新标签页中打开知识星系
if (btnFullscreen) {
  btnFullscreen.addEventListener('click', function() {
    chrome.tabs.create({ url: chrome.runtime.getURL('network.html') });
  });
}

// ==================== AI 引擎逻辑 ====================

// ---- DOM 引用 ----
var whDropzone      = document.getElementById('wh-dropzone');
var whFileInput     = document.getElementById('wh-file-input');
var whProgress      = document.getElementById('wh-progress');
var whProgressFill  = document.getElementById('wh-progress-fill');
var whProgressText  = document.getElementById('wh-progress-text');
var whResults       = document.getElementById('wh-results');
var whEmptyWarning  = document.getElementById('wh-empty-warning');
var whStatusDot     = document.getElementById('wh-status-dot');
var whOnboarding    = document.getElementById('wh-onboarding');
var whSettingsPanel = document.getElementById('wh-settings-panel');

var btnWhSettings       = document.getElementById('btn-wh-settings');
var btnWhOnboardingSetup = document.getElementById('btn-wh-onboarding-setup');
var btnWhTest           = document.getElementById('btn-wh-test');
var btnWhSaveConfig     = document.getElementById('btn-wh-save-config');
var selectWhFile        = document.getElementById('wh-select-file');
var analyzeCurrent      = document.getElementById('wh-analyze-current');

var whProviderSelect  = document.getElementById('wh-settings-provider');
var whApiKeyInput     = document.getElementById('wh-settings-apikey');
var whEndpointInput   = document.getElementById('wh-settings-endpoint');
var whModelInput      = document.getElementById('wh-settings-model');
var whTestStatus      = document.getElementById('wh-test-status');

// 变化报告 DOM 引用
var crReport      = document.getElementById('wh-change-report');
var crTitle       = document.getElementById('cr-report-title');
var crSub         = document.getElementById('cr-report-sub');
var crEngine      = document.getElementById('cr-report-engine');
var crSummary     = document.getElementById('cr-summary');
var crActions     = document.getElementById('cr-actions');

var crSectionNew       = document.getElementById('cr-section-new');
var crSectionConns     = document.getElementById('cr-section-connections');
var crSectionDups      = document.getElementById('cr-section-duplicates');
var crToggleNew        = document.getElementById('cr-toggle-new');
var crToggleConns      = document.getElementById('cr-toggle-connections');
var crToggleDups       = document.getElementById('cr-toggle-duplicates');
var crCountNew         = document.getElementById('cr-count-new');
var crCountConns       = document.getElementById('cr-count-connections');
var crCountDups        = document.getElementById('cr-count-duplicates');
var crBodyNew          = document.getElementById('cr-body-new');
var crBodyConns        = document.getElementById('cr-body-connections');
var crBodyDups         = document.getElementById('cr-body-duplicates');

var crBtnApplyAll = document.getElementById('cr-btn-apply-all');
var crBtnApplyNew = document.getElementById('cr-btn-apply-new');

// ---- 状态 ----
var whIsProcessing = false;

// 漏洞6: 首次引导
function checkOnboarding() {
  if (window.AIWormhole && typeof window.AIWormhole.getConfig === 'function') {
    var config = window.AIWormhole.getConfig();
    if (!config.apiKey && !config.enabled) {
      // 首次使用，显示引导
      if (whOnboarding) whOnboarding.style.display = '';
    } else {
      if (whOnboarding) whOnboarding.style.display = 'none';
    }
  }
}

// ---- 设置面板 ----
if (btnWhSettings) {
  btnWhSettings.addEventListener('click', function() {
    var panel = whSettingsPanel;
    if (panel) {
      var isShowing = panel.classList.contains('show');
      if (isShowing) {
        panel.classList.remove('show');
      } else {
        // 加载当前配置
        if (window.AIWormhole && typeof window.AIWormhole.getConfig === 'function') {
          var config = window.AIWormhole.getConfig();
          if (whProviderSelect) whProviderSelect.value = config.provider || '';
          if (whApiKeyInput) whApiKeyInput.value = config.apiKey || '';
          if (whEndpointInput) whEndpointInput.value = config.endpoint || '';
          if (whModelInput) whModelInput.value = config.model || '';
        }
        panel.classList.add('show');
      }
    }
  });
}

if (btnWhOnboardingSetup) {
  btnWhOnboardingSetup.addEventListener('click', function() {
    if (whOnboarding) whOnboarding.style.display = 'none';
    if (whSettingsPanel) whSettingsPanel.classList.add('show');
  });
}

// Provider 切换自动填充
if (whProviderSelect) {
  whProviderSelect.addEventListener('change', function() {
    var provider = this.value;
    if (window.AIWormhole && window.AIWormhole.PROVIDER_PRESETS) {
      var preset = window.AIWormhole.PROVIDER_PRESETS[provider];
      if (preset && whEndpointInput) whEndpointInput.value = preset.endpoint || '';
      if (preset && whModelInput) whModelInput.value = preset.model || '';
    }
    if (!provider) {
      if (whEndpointInput) whEndpointInput.value = '';
      if (whModelInput) whModelInput.value = '';
    }
  });
}

// 测试连接
if (btnWhTest) {
  btnWhTest.addEventListener('click', function() {
    // 先临时保存配置
    var tempConfig = {
      provider: whProviderSelect ? whProviderSelect.value : '',
      apiKey: whApiKeyInput ? whApiKeyInput.value.trim() : '',
      endpoint: whEndpointInput ? whEndpointInput.value.trim() : '',
      model: whModelInput ? whModelInput.value.trim() : ''
    };

    if (!tempConfig.apiKey) {
      if (whTestStatus) { whTestStatus.className = 'fail'; whTestStatus.textContent = window.I18n ? window.I18n.t('wormhole.test.no.key') : '❌ 请先输入 API Key'; }
      return;
    }

    if (whTestStatus) { whTestStatus.className = ''; whTestStatus.textContent = window.I18n ? window.I18n.t('wormhole.testing') : '⏳ 正在测试连接...'; whTestStatus.style.display = 'block'; }

    if (window.AIWormhole && typeof window.AIWormhole.saveConfig === 'function') {
      window.AIWormhole.saveConfig(tempConfig).then(function() {
        return window.AIWormhole.testConnection();
      }).then(function() {
        if (whTestStatus) { whTestStatus.className = 'success'; whTestStatus.textContent = window.I18n ? window.I18n.t('wormhole.test.success') : '✅ 连接成功！API可用'; }
        if (whStatusDot) { whStatusDot.className = 'wh-status ready'; }
      }).catch(function(err) {
        if (whTestStatus) { whTestStatus.className = 'fail'; whTestStatus.textContent = window.I18n ? window.I18n.t('wormhole.test.fail', {msg: err.message}) : ('❌ 连接失败: ' + err.message); }
      });
    }
  });
}

// 保存配置
if (btnWhSaveConfig) {
  btnWhSaveConfig.addEventListener('click', function() {
    var config = {
      provider: whProviderSelect ? whProviderSelect.value : '',
      apiKey: whApiKeyInput ? whApiKeyInput.value.trim() : '',
      endpoint: whEndpointInput ? whEndpointInput.value.trim() : '',
      model: whModelInput ? whModelInput.value.trim() : ''
    };

    if (window.AIWormhole && typeof window.AIWormhole.saveConfig === 'function') {
      window.AIWormhole.saveConfig(config).then(function() {
        if (whSettingsPanel) whSettingsPanel.classList.remove('show');
        if (whOnboarding) whOnboarding.style.display = 'none';
        if (whStatusDot) whStatusDot.className = 'wh-status ready';
      });
    }
  });
}

// ---- 文件选择 ----
if (selectWhFile && whFileInput) {
  selectWhFile.addEventListener('click', function(e) {
    e.stopPropagation();
    whFileInput.click();
  });
}

if (whFileInput) {
  whFileInput.addEventListener('change', function() {
    var file = whFileInput.files[0];
    if (file) handlePDFFile(file);
    whFileInput.value = '';
  });
}

// ---- 拖放 (漏洞2: 异步处理不阻塞UI) ----
if (whDropzone) {
  whDropzone.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.stopPropagation();
    whDropzone.classList.add('dragover');
  });

  whDropzone.addEventListener('dragleave', function(e) {
    e.preventDefault();
    e.stopPropagation();
    whDropzone.classList.remove('dragover');
  });

  whDropzone.addEventListener('drop', function(e) {
    e.preventDefault();
    e.stopPropagation();
    whDropzone.classList.remove('dragover');

    var files = e.dataTransfer.files;
    if (files.length > 0) {
      var file = files[0];
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        handlePDFFile(file);
      } else {
        showWormholeWarning(window.I18n ? window.I18n.t('wormhole.warn.pdf.only') : '⚠️ 仅支持 PDF 文件，请拖入 .pdf 文件');
      }
    }
  });

  // 点击空白区域也触发文件选择
  whDropzone.addEventListener('click', function(e) {
    if (e.target === whDropzone || e.target.classList.contains('wh-drop-icon') || e.target.classList.contains('wh-drop-text')) {
      if (whFileInput) whFileInput.click();
    }
  });
}

// ---- 分析当前打开的PDF ----
if (analyzeCurrent) {
  analyzeCurrent.addEventListener('click', function(e) {
    e.stopPropagation();
    analyzeCurrentPDF();
  });
}

function analyzeCurrentPDF() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    var tab = tabs[0];
    if (!tab) { showWormholeWarning(window.I18n ? window.I18n.t('wormhole.warn.no.tab') : '无法获取当前标签页'); return; }

    var url = tab.url || '';

    // 检查是否是PDF
    if (url.toLowerCase().endsWith('.pdf') || url.indexOf('pdf') !== -1 || url.startsWith('file:///')) {
      // file:// 协议无法从扩展页fetch，提示用户拖入
      if (url.startsWith('file:///')) {
        showWormholeWarning(window.I18n ? window.I18n.t('wormhole.warn.local.pdf') : '⚠️ 本地PDF无法直接读取，请将PDF文件拖入此面板进行分析');
        return;
      }

      // 直接 fetch PDF URL，用 PDF.js 解析
      showWormholeProgress(window.I18n ? window.I18n.t('wormhole.downloading') : '正在下载PDF...', 5);
      fetch(url, { credentials: 'include' })
        .then(function(resp) {
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          return resp.arrayBuffer();
        })
        .then(function(arrayBuffer) {
          if (typeof pdfjsLib !== 'undefined') {
            extractTextWithPDFJS(arrayBuffer, tab.title || url.split('/').pop() || 'document.pdf', url);
          } else {
            showWormholeWarning(window.I18n ? window.I18n.t('wormhole.warn.pdfjs.missing') : '❌ PDF解析库未加载，请刷新页面后重试。');
          }
        })
        .catch(function(err) {
          console.error('[Wormhole] 下载PDF失败:', err);
          showWormholeWarning(window.I18n ? window.I18n.t('wormhole.warn.fetch.fail', {msg: err.message}) : ('❌ 无法获取PDF文件: ' + err.message + '<br><span style="font-size:10px;">请尝试将PDF文件拖入此面板</span>'));
        });
    } else {
      showWormholeWarning(window.I18n ? window.I18n.t('wormhole.warn.not.pdf') : '当前标签页不是PDF文件');
    }
  });
}

// ---- PDF文件处理 ----
function handlePDFFile(file) {
  var reader = new FileReader();
  reader.onload = function(e) {
    var arrayBuffer = e.target.result;

    // 使用PDF.js提取文本 (如果可用)
    if (typeof pdfjsLib !== 'undefined') {
      extractTextWithPDFJS(arrayBuffer, file.name);
    } else {
      showWormholeWarning(window.I18n ? window.I18n.t('wormhole.warn.pdfjs.missing') : '❌ PDF解析库未加载，请刷新页面后重试。');
    }
  };
  reader.onerror = function() {
    showWormholeWarning(window.I18n ? window.I18n.t('wormhole.warn.read.fail') : '❌ 无法读取文件，请检查文件是否损坏');
  };
  reader.readAsArrayBuffer(file);
}

// 全局页文本映射（供回查知识点页码使用）
var _currentPageTextMap = null;

function extractTextWithPDFJS(arrayBuffer, fileName, pdfUrl) {
  // pdfUrl 可选：从当前标签页fetch时传入真实URL，拖拽文件时用文件名
  var displayName = pdfUrl || fileName;

  // 动态加载PDF.js (如果还没加载)
  if (typeof pdfjsLib === 'undefined') {
    showWormholeWarning(window.I18n ? window.I18n.t('wormhole.warn.pdfjs.missing') : '❌ PDF解析库未加载，请刷新页面后重试。');
    return;
  }

  showWormholeProgress(window.I18n ? window.I18n.t('wormhole.extracting') : '正在提取PDF文本...', 10);

  pdfjsLib.getDocument({ data: arrayBuffer }).promise.then(function(pdf) {
    var numPages = pdf.numPages;
    var pages = [];
    for (var i = 1; i <= numPages; i++) {
      pages.push(i);
    }

    var textParts = [];
    // 保留每页的文本映射 { pageNum: pageText }
    var pageTextMap = {};
    var completed = 0;

    // 顺序提取每页（避免并发过多）
    function extractNext(idx) {
      if (idx >= pages.length) {
        // 全部完成
        var fullText = textParts.join('\n');
        // 存储页文本映射供后续回查
        _currentPageTextMap = pageTextMap;
        processPDFText(fullText, displayName, fileName);
        return;
      }

      var pageNum = pages[idx];
      pdf.getPage(pageNum).then(function(page) {
        return page.getTextContent();
      }).then(function(textContent) {
        var pageText = textContent.items.map(function(item) { return item.str; }).join(' ');
        textParts.push(pageText);
        pageTextMap[pageNum] = pageText;
        completed++;
        var pct = 10 + Math.floor((completed / numPages) * 40);
        showWormholeProgress(window.I18n ? window.I18n.t('wormhole.extracting.page', {done: completed, total: numPages}) : ('提取第 ' + completed + '/' + numPages + ' 页...'), pct);
        extractNext(idx + 1);
      }).catch(function() {
        completed++;
        extractNext(idx + 1);
      });
    }

    extractNext(0);
  }).catch(function(err) {
    console.error('[Wormhole] PDF.js提取失败:', err);
    showWormholeWarning(window.I18n ? window.I18n.t('wormhole.warn.parse.fail', {msg: err.message}) : ('❌ PDF解析失败: ' + err.message));
  });
}

// ---- 在页文本映射中查找知识点首次出现的页码 ----
function findPageForPoint(pointText) {
  if (!_currentPageTextMap || !pointText) return 0;
  // 对文本进行归一化处理
  var searchText = pointText.replace(/\s+/g, ' ').trim().toLowerCase();
  if (searchText.length < 3) return 0;

  var pageNums = Object.keys(_currentPageTextMap).map(Number).sort(function(a, b) { return a - b; });
  for (var i = 0; i < pageNums.length; i++) {
    var pageNum = pageNums[i];
    var pageText = (_currentPageTextMap[pageNum] || '').replace(/\s+/g, ' ').trim().toLowerCase();
    // 模糊匹配：查找知识点文本（或前几个关键词）是否出现在该页
    var keywords = searchText.split(/[\s,;，。；、:：]+/).filter(function(k) { return k.length >= 2; });
    if (keywords.length === 0) continue;
    // 使用前3个关键词进行匹配（足够唯一识别）
    var searchKeys = keywords.slice(0, Math.min(3, keywords.length)).join(' ');
    if (pageText.indexOf(searchKeys) !== -1) {
      return pageNum;
    }
  }
  return 0; // 未找到 → 默认第0页
}

// ---- 核心处理 ----
function processPDFText(text, pdfUrl, pdfName) {
  hideWormholeWarning();

  // 漏洞1: 文本校验
  if (!text || text.trim().length < 50) {
    var charCount = text ? text.trim().length : 0;
    if (charCount === 0) {
      showWormholeWarning(window.I18n ? window.I18n.t('wormhole.warn.scanned') : '📷 此PDF可能是扫描件/图片型PDF，无法提取文本层。\n建议使用OCR工具转换后再试。');
    } else {
      showWormholeWarning(window.I18n ? window.I18n.t('wormhole.warn.short.text', {count: charCount}) : ('⚠️ 提取到的文本过少（仅' + charCount + '字符），分析结果可能不准确。'));
    }
    // 仍然尝试分析（用户可以看到警告）
    if (charCount === 0) return;
  }

  showWormholeProgress('⚡ Agent分析启动...', 5);

  if (window.AIWormhole && typeof window.AIWormhole.analyzePDFWithCompare === 'function') {
    // 加载当前KB的知识点用于比对
    var existingPoints = knowledgePoints || [];

    window.AIWormhole.analyzePDFWithCompare(text, pdfUrl, existingPoints)
      .then(function(result) {
        hideWormholeProgress();
        if (result.error && result.emptyText) {
          showWormholeWarning(result.error);
          return;
        }
        if (result.error) {
          showWormholeWarning(result.error);
        }

        // 存储管线结果，渲染变化报告
        currentReport = {
          pdfName: pdfName || pdfUrl,
          pdfUrl: pdfUrl,
          result: result
        };
        renderChangeReport(currentReport);

        if (whStatusDot) whStatusDot.className = 'wh-status ready';
      })
      .catch(function(err) {
        hideWormholeProgress();
        showWormholeWarning('❌ Agent分析失败: ' + err.message);
        if (whStatusDot) whStatusDot.className = 'wh-status error';
      });
  } else if (window.AIWormhole && typeof window.AIWormhole.summarizePDF === 'function') {
    // 降级：使用旧版 summarizePDF（无管线比对）
    window.AIWormhole.summarizePDF(text, pdfUrl)
      .then(function(result) {
        hideWormholeProgress();
        if (result.error && result.emptyText) {
          showWormholeWarning(result.error);
          return;
        }
        if (result.error) {
          showWormholeWarning(result.error);
        }
        addWormholeResultCard(pdfName || pdfUrl, result, pdfUrl);
        if (whStatusDot) whStatusDot.className = 'wh-status ready';
      })
      .catch(function(err) {
        hideWormholeProgress();
        showWormholeWarning('❌ 分析失败: ' + err.message);
        if (whStatusDot) whStatusDot.className = 'wh-status error';
      });
  } else {
    hideWormholeProgress();
    showWormholeWarning('AI引擎未初始化，请刷新页面后重试');
  }
}

// ---- UI助手 ----
function showWormholeProgress(text, percent) {
  whIsProcessing = true;
  if (whProgress) whProgress.style.display = 'block';
  if (whProgressText) whProgressText.textContent = text;
  if (whProgressFill) whProgressFill.style.width = (percent || 0) + '%';
  if (whStatusDot) whStatusDot.className = 'wh-status busy';
}

function hideWormholeProgress() {
  whIsProcessing = false;
  if (whProgress) whProgress.style.display = 'none';
  if (whProgressFill) whProgressFill.style.width = '0%';
}

function showWormholeWarning(msg) {
  hideWormholeProgress();
  if (whEmptyWarning) {
    whEmptyWarning.style.display = 'block';
    whEmptyWarning.textContent = msg;
    // 5秒后自动隐藏
    setTimeout(function() {
      if (whEmptyWarning) whEmptyWarning.style.display = 'none';
    }, 8000);
  }
  if (whStatusDot) whStatusDot.className = 'wh-status error';
  setTimeout(function() {
    if (whStatusDot && whStatusDot.className === 'wh-status error') {
      whStatusDot.className = 'wh-status ready';
    }
  }, 5000);
}

function hideWormholeWarning() {
  if (whEmptyWarning) whEmptyWarning.style.display = 'none';
}

function addWormholeResultCard(pdfName, result, pdfSourceUrl) {
  if (!whResults) return;
  // pdfSourceUrl: 实际的PDF源URL，用于点击知识点后追溯来源
  var sourceUrl = pdfSourceUrl || '';

  var timeStr = (result.timestamp ? new Date(result.timestamp) : new Date()).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  // 关键词标签
  var keywordsHtml = '';
  if (result.keywords && result.keywords.length > 0) {
    keywordsHtml = '<div class="wh-card-keywords">' +
      result.keywords.slice(0, 8).map(function(k) { return '<span>' + escapeHtml(k) + '</span>'; }).join('') +
      '</div>';
  }

  // 知识点列表
  var pointsHtml = '';
  if (result.knowledgePoints && result.knowledgePoints.length > 0) {
    pointsHtml = '<div class="wh-card-points">' +
      '<div class="wh-card-section-title">🧠 提取的知识点 (' + result.knowledgePoints.length + '个)</div>' +
      result.knowledgePoints.map(function(p) {
        var confIcon = p.confidence === 'high' ? '🟢' : (p.confidence === 'low' ? '🔴' : '🟡');
        return '<div class="wh-point-item">' +
          '<span class="wh-point-title">' + confIcon + ' ' + escapeHtml(p.title) + '</span>' +
          '<span class="wh-point-detail">' + escapeHtml(p.detail || '') + '</span>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  // 关系网络（始终折叠，以知识点为重心，点击展开）
  var relationsHtml = '';
  var relationsCollapsed = true;
  if (result.relations && result.relations.length > 0) {
    relationsHtml = '<div class="wh-card-relations' + (relationsCollapsed ? ' collapsed' : '') + '">' +
      '<div class="wh-card-section-title wh-rel-toggle" style="cursor:pointer;">' +
        '<span class="wh-rel-toggle-icon">' + (relationsCollapsed ? '▶' : '▼') + '</span> ' +
        '🔗 知识关系 (' + result.relations.length + '条)' +
      '</div>' +
      '<div class="wh-relations-body" style="' + (relationsCollapsed ? 'display:none;' : '') + '">' +
      result.relations.map(function(r) {
        var typeLabel = r.type === '因果' ? '→' : (r.type === '并列' ? '⇔' : (r.type === '层级' ? '⊃' : '—'));
        return '<div class="wh-relation-item">' +
          '<span class="wh-rel-from">' + escapeHtml(r.from) + '</span>' +
          '<span class="wh-rel-type">' + typeLabel + ' ' + escapeHtml(r.type) + '</span>' +
          '<span class="wh-rel-to">' + escapeHtml(r.to) + '</span>' +
          (r.desc ? '<span class="wh-rel-desc">' + escapeHtml(r.desc) + '</span>' : '') +
        '</div>';
      }).join('') +
      '</div></div>';
  }

  var summaryPreview = (result.summary || '').substring(0, 100);
  var hasMore = (result.summary || '').length > 100;

  var card = document.createElement('div');
  card.className = 'wh-result-card';
  card.innerHTML =
    '<div class="wh-card-header">' +
      '<span class="wh-card-file">📄 ' + escapeHtml(pdfName) + '</span>' +
      '<span class="wh-card-engine">☁️ ' + (result.provider || 'API') + ' · ' + timeStr + '</span>' +
    '</div>' +
    '<div class="wh-card-summary' + (hasMore ? '' : '') + '" title="点击展开/折叠">📝 ' + escapeHtml(result.summary || '无摘要') + '</div>' +
    keywordsHtml +
    pointsHtml +
    relationsHtml +
    '<div class="wh-card-actions">' +
      '<button class="wh-connect-btn">🔗 添加到知识库</button>' +
      '<button class="wh-delete" title="删除此结果">🗑️</button>' +
    '</div>';

  // 摘要展开/折叠
  var summaryEl = card.querySelector('.wh-card-summary');
  if (hasMore) {
    summaryEl.addEventListener('click', function() {
      summaryEl.classList.toggle('expanded');
      if (summaryEl.classList.contains('expanded')) {
        summaryEl.textContent = '📝 ' + (result.summary || '无摘要');
      } else {
        summaryEl.textContent = '📝 ' + (result.summary || '').substring(0, 100) + '…';
      }
    });
  }

  // 关系网络展开/折叠
  var relToggle = card.querySelector('.wh-rel-toggle');
  var relBody = card.querySelector('.wh-relations-body');
  if (relToggle && relBody) {
    relToggle.addEventListener('click', function() {
      var wrapper = relToggle.closest('.wh-card-relations');
      var isCollapsed = wrapper.classList.contains('collapsed');
      if (isCollapsed) {
        wrapper.classList.remove('collapsed');
        relBody.style.display = '';
        relToggle.querySelector('.wh-rel-toggle-icon').textContent = '▼';
      } else {
        wrapper.classList.add('collapsed');
        relBody.style.display = 'none';
        relToggle.querySelector('.wh-rel-toggle-icon').textContent = '▶';
      }
    });
  }

  // 添加到知识库按钮
  var connectBtn = card.querySelector('.wh-connect-btn');
  connectBtn.addEventListener('click', function() {
    if (result.knowledgePoints && result.knowledgePoints.length > 0) {
      addKnowledgePointsToBase(result.knowledgePoints, pdfName, sourceUrl);
    } else {
      alert('没有可添加的知识点。');
    }
  });

  // 删除按钮
  var deleteBtn = card.querySelector('.wh-delete');
  deleteBtn.addEventListener('click', function() {
    card.style.opacity = '0';
    card.style.transform = 'translateX(20px)';
    card.style.transition = 'all 0.3s ease';
    setTimeout(function() { card.remove(); }, 300);
    if (window.AIWormhole && typeof window.AIWormhole.clearResults === 'function') {
      window.AIWormhole.clearResults(pdfName);
    }
  });

  // 插入到结果列表顶部
  whResults.insertBefore(card, whResults.firstChild);

  // 限制最多保留5张卡片
  var cards = whResults.querySelectorAll('.wh-result-card');
  if (cards.length > 5) {
    cards[cards.length - 1].remove();
  }
}

// 将AI提取的知识点添加到知识库
function addKnowledgePointsToBase(knowledgePoints, sourceName, pdfUrl) {
  if (!knowledgePoints || !knowledgePoints.length) return;

  var existing = self.KBStore.getPoints();
  var addedCount = 0;
  var dupCount = 0;
  var resolvedUrl = pdfUrl || '';
  var activeKB = self.KBStore.getActiveKB();

  // 语义去重
  var toAdd = [];
  if (typeof semanticDedupBatch === 'function') {
    var batchResult = semanticDedupBatch(knowledgePoints, existing, 0.75);
    toAdd = batchResult.unique;
    dupCount = batchResult.duplicates.length;
    if (dupCount > 0) {
      console.log('[Sidepanel] 语义去重跳过 ' + dupCount + ' 个重复项');
      batchResult.duplicates.forEach(function(d) {
        console.log('  - \"' + (d.candidate.title || d.candidate.text || '') + '\" ≈ #' + d.matchedId + ' (' + d.confidence + '%)');
      });
    }
  } else {
    // 降级：精确 title 匹配
    knowledgePoints.forEach(function(pt) {
      var dup = existing.some(function(e) {
        return (e.id && pt.id && e.id === pt.id) ||
               (e.title || '').trim() === (pt.title || '').trim();
      });
      if (!dup) { toAdd.push(pt); } else { dupCount++; }
    });
  }

  // 逐个添加到 KBStore（内部处理持久化）
  var addNext = function(i) {
    if (i >= toAdd.length) {
      // 全部完成，刷新 UI
      loadKnowledgeBases();
      var msg = addedCount > 0
        ? '✅ 已添加 ' + addedCount + ' 个知识点到知识库「' + (activeKB ? activeKB.name : '') + '」（跳过 ' + dupCount + ' 个重复项）'
        : '⚠️ 所有知识点已存在，无新增';
      showWormholeWarning(msg);
      setTimeout(function() { hideWormholeWarning(); }, 3000);
      return;
    }
    var pt = toAdd[i];
    if (!pt.id) pt.id = 'kp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    var pointData = {
      id: pt.id,
      text: pt.title || pt.text || '',
      title: pt.title || pt.text || '',
      detail: pt.detail || '',
      confidence: pt.confidence || 'medium',
      url: resolvedUrl,
      source: sourceName || 'AI提取',
      timestamp: Date.now(),
      // 回查知识点首次出现的页码
      page: findPageForPoint(pt.title || pt.text || '')
    };
    self.KBStore.addPoint(pointData).then(function(r) {
      if (r.added) addedCount++;
      addNext(i + 1);
    });
  };
  addNext(0);
}

// ==================== 变化报告 UI ====================
function renderChangeReport(reportData) {
  if (!crReport) return;
  var result = reportData.result;
  var rep = result.report || {};
  var pdfName = reportData.pdfName;

  // 标题
  if (crTitle) crTitle.textContent = '📋 「' + pdfName + '」变化报告';
  if (crSub) crSub.textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (crEngine) crEngine.textContent = '☁️ ' + (result.provider || 'API');

  var newPoints = result.newPoints || [];
  var cons = rep.newConnections || [];
  var dups = rep.duplicates || [];
  var maybes = rep.maybeDuplicates || [];
  var allDups = dups.concat(maybes);

  // 计数
  if (crCountNew) crCountNew.textContent = '(' + newPoints.length + ')';
  if (crCountConns) crCountConns.textContent = '(' + cons.length + ')';
  if (crCountDups) crCountDups.textContent = '(' + allDups.length + ')';

  // 新知识点列表
  if (crBodyNew) {
    if (newPoints.length > 0) {
      crBodyNew.innerHTML = newPoints.map(function(p, i) {
        return '<label class="cr-item" data-idx="' + i + '">' +
          '<input type="checkbox" class="cr-item-checkbox" checked data-type="new" data-idx="' + i + '" />' +
          '<div class="cr-item-content">' +
            '<div class="cr-item-title">' + escapeHtml(p.title) + '</div>' +
            (p.detail ? '<div class="cr-item-detail">' + escapeHtml(p.detail) + '</div>' : '') +
            '<div class="cr-item-meta">' +
              '<span>' + (p.confidence === 'high' ? '🟢 高置信' : p.confidence === 'low' ? '🔴 低置信' : '🟡 中置信') + '</span>' +
            '</div>' +
          '</div>' +
        '</label>';
      }).join('');
    } else {
      crBodyNew.innerHTML = '<div class="cr-empty">没有新知识点</div>';
    }
  }

  // 发现关联 (新知识点 ↔ 已有知识点)
  if (crBodyConns) {
    if (cons.length > 0) {
      crBodyConns.innerHTML = cons.map(function(c, i) {
        var simPct = c.similarity || 50;
        var simNorm = simPct / 100; // similarity 已经是百分比
        var cls = simPct >= 75 ? 'high' : (simPct >= 60 ? 'medium' : 'low');
        return '<label class="cr-pair" data-idx="' + i + '">' +
          '<input type="checkbox" class="cr-pair-checkbox" checked data-type="connection" data-idx="' + i + '" />' +
          '<span class="cr-pair-from">' + escapeHtml(c.fromText || c.fromTitle || '') + '</span>' +
          '<span class="cr-pair-arrow">→</span>' +
          '<span class="cr-pair-to">' + escapeHtml(c.toText || c.toTitle || '') + '</span>' +
          '<div class="cr-similarity-bar-wrap">' +
            '<div class="cr-similarity-bar"><div class="cr-similarity-fill ' + cls + '" style="width:' + simNorm * 100 + '%"></div></div>' +
            '<span class="cr-similarity-text">' + simPct + '%</span>' +
          '</div>' +
          (c.reason ? '<div class="cr-pair-reason">' + escapeHtml(c.reason) + '</div>' : '') +
        '</label>';
      }).join('');
    } else {
      crBodyConns.innerHTML = '<div class="cr-empty">未发现新的知识关联</div>';
    }
  }

  // 可能重复
  if (crBodyDups) {
    if (allDups.length > 0) {
      var dupCount = dups.length; // 前 dupCount 个是高置信重复
      crBodyDups.innerHTML = allDups.map(function(d, i) {
        var simPct = d.similarity || 50;
        var simNorm = simPct / 100;
        var cls = simPct >= 75 ? 'high' : 'medium';
        var isDup = i < dupCount;  // 前 dupCount 个来自 duplicates 数组
        var label = isDup ? '🔴 重复' : '🟡 疑似重复';
        return '<div class="cr-pair" data-idx="' + i + '" data-dup-type="' + (isDup ? 'duplicate' : 'maybe') + '">' +
          '<span class="cr-pair-from">🆕 ' + escapeHtml(d.newText || d.newId || '') + '</span>' +
          '<span class="cr-pair-arrow">≈</span>' +
          '<span class="cr-pair-to">📚 ' + escapeHtml(d.existingText || d.existingId || '') + '</span>' +
          '<div class="cr-similarity-bar-wrap">' +
            '<div class="cr-similarity-bar"><div class="cr-similarity-fill ' + cls + '" style="width:' + simNorm * 100 + '%"></div></div>' +
            '<span class="cr-similarity-text">' + simPct + '%</span>' +
            '<span style="font-size:9px;color:#6b7a90;margin-left:4px;">' + label + '</span>' +
          '</div>' +
          '<div class="cr-dup-actions">' +
            '<button class="cr-dup-btn merge" data-action="merge" data-idx="' + i + '">合并</button>' +
            '<button class="cr-dup-btn ignore" data-action="ignore" data-idx="' + i + '">忽略</button>' +
          '</div>' +
        '</div>';
      }).join('');
    } else {
      crBodyDups.innerHTML = '<div class="cr-empty">未检测到重复知识点</div>';
    }
  }

  // 成功摘要（无变化时展示）
  if (crSummary) {
    if (newPoints.length === 0 && cons.length === 0 && allDups.length === 0) {
      crSummary.style.display = 'block';
      crSummary.innerHTML = '<div class="cr-summary-icon">✨</div>' +
        '<div class="cr-summary-text">知识库已覆盖此 PDF 的全部知识点<br>无需更新</div>' +
        '<div class="cr-summary-stats">' +
          '<div class="cr-summary-stat">📊 现有知识点 <strong>' + (knowledgePoints.length || 0) + '</strong></div>' +
        '</div>';
      if (crActions) crActions.style.display = 'none';
    } else {
      crSummary.style.display = 'none';
      if (crActions) crActions.style.display = '';
    }
  }

  // 显示报告
  if (crReport) crReport.classList.add('show');

  // 绑定 toggle / checkbox / 合并忽略 / 操作按钮
  bindChangeReportEvents();

  // 将结果也同步保存到结果缓存（用于网络视图追踪）
  if (window.AIWormhole && typeof window.AIWormhole.getResults === 'function') {
    // 通过内部方法添加结果卡片外观（简化版）
    addWormholeResultCard(pdfName, result, reportData.pdfUrl);
  }
}

// 重置/隐藏变化报告
function hideChangeReport() {
  if (crReport) crReport.classList.remove('show');
  currentReport = null;
}

// 折叠切换
function bindChangeReportEvents() {
  // toggle 折叠
  var toggles = [
    { btn: crToggleNew, section: crSectionNew },
    { btn: crToggleConns, section: crSectionConns },
    { btn: crToggleDups, section: crSectionDups }
  ];
  toggles.forEach(function(t) {
    if (!t.btn || !t.section) return;
    var newBtn = t.btn.cloneNode(true);
    t.btn.parentNode.replaceChild(newBtn, t.btn);
    if (t.btn === crToggleNew) crToggleNew = newBtn;
    if (t.btn === crToggleConns) crToggleConns = newBtn;
    if (t.btn === crToggleDups) crToggleDups = newBtn;
    newBtn.addEventListener('click', function() {
      t.section.classList.toggle('collapsed');
    });
  });

  // 新知识点 checkbox 联动
  if (crBodyNew) {
    crBodyNew.querySelectorAll('.cr-item-checkbox').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var item = cb.closest('.cr-item');
        if (item) item.classList.toggle('deselected', !cb.checked);
      });
    });
  }

  // 关联 checkbox 联动
  if (crBodyConns) {
    crBodyConns.querySelectorAll('.cr-pair-checkbox').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var item = cb.closest('.cr-pair');
        if (item) item.style.opacity = cb.checked ? '1' : '0.4';
      });
    });
  }

  // 重复项：合并/忽略按钮
  if (crBodyDups) {
    crBodyDups.querySelectorAll('.cr-dup-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var action = btn.getAttribute('data-action');
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var pair = btn.closest('.cr-pair');
        if (action === 'merge' && pair) {
          pair.style.background = 'rgba(16,185,129,0.1)';
          pair.style.borderLeft = '3px solid #10b981';
          pair.setAttribute('data-dup-resolved', 'merge');
          pair.querySelectorAll('.cr-dup-btn').forEach(function(b) { b.disabled = true; b.style.opacity = '0.4'; });
        } else if (action === 'ignore' && pair) {
          pair.style.opacity = '0.35';
          pair.style.background = 'rgba(100,100,180,0.05)';
          pair.setAttribute('data-dup-resolved', 'ignore');
          pair.querySelectorAll('.cr-dup-btn').forEach(function(b) { b.disabled = true; b.style.opacity = '0.4'; });
        }
      });
    });
  }

  // 操作按钮
  if (crBtnApplyAll) {
    var newBtn = crBtnApplyAll.cloneNode(true);
    crBtnApplyAll.parentNode.replaceChild(newBtn, crBtnApplyAll);
    crBtnApplyAll = newBtn;
    crBtnApplyAll.addEventListener('click', function() { applyReportChanges('all'); });
  }
  if (crBtnApplyNew) {
    var newBtn2 = crBtnApplyNew.cloneNode(true);
    crBtnApplyNew.parentNode.replaceChild(newBtn2, crBtnApplyNew);
    crBtnApplyNew = newBtn2;
    crBtnApplyNew.addEventListener('click', function() { applyReportChanges('newOnly'); });
  }
}

// 应用变化报告
function applyReportChanges(mode) {
  if (!currentReport) return;
  var result = currentReport.result;
  var rep = result.report || {};
  var newPoints = result.newPoints || [];
  var cons = rep.newConnections || [];
  var dups = rep.duplicates || [];
  var maybes = rep.maybeDuplicates || [];
  var allDups = dups.concat(maybes);
  var sourceName = currentReport.pdfName || 'AI提取';
  var pdfUrl = currentReport.pdfUrl || '';

  // 收集选中的新知识点
  var selectedNewIds = [];
  if (mode === 'all' && crBodyNew) {
    crBodyNew.querySelectorAll('.cr-item-checkbox').forEach(function(cb) {
      if (cb.checked) selectedNewIds.push(parseInt(cb.getAttribute('data-idx'), 10));
    });
  } else if (mode === 'newOnly') {
    for (var i = 0; i < newPoints.length; i++) selectedNewIds.push(i);
  }

  // 收集选中的关联
  var selectedConnIds = [];
  if (mode === 'all' && crBodyConns) {
    crBodyConns.querySelectorAll('.cr-pair-checkbox').forEach(function(cb) {
      if (cb.checked) selectedConnIds.push(parseInt(cb.getAttribute('data-idx'), 10));
    });
  } else if (mode === 'newOnly') {
    // 仅添加新知识点模式：不添加 AI 连线
  }

  // 收集标记为合并的重复项
  var mergedDupIds = [];
  if (mode === 'all' && crBodyDups) {
    crBodyDups.querySelectorAll('.cr-pair[data-dup-resolved="merge"]').forEach(function(pair) {
      mergedDupIds.push(parseInt(pair.getAttribute('data-idx'), 10));
    });
  }

  // Phase 1: 添加新知识点到 storage
  var pointsToAdd = selectedNewIds.map(function(i) { return newPoints[i]; }).filter(Boolean);
  var filteredNewPoints = pointsToAdd;

  // Phase 2: 合并重复项（用新知识点信息增强已有知识点）
  var mergeInfos = mergedDupIds.map(function(i) {
    var d = allDups[i];
    if (!d) return null;
    return { newId: d.newId, existingId: d.existingId, newText: d.newText, existingText: d.existingText, similarity: d.similarity };
  }).filter(Boolean);

  // Phase 3: 添加 AI 连线
  var edgesToAdd = selectedConnIds.map(function(i) {
    var c = cons[i];
    if (!c) return null;
    return { from: c.fromId, to: c.toId, strength: (c.similarity || 50) / 100, reason: 'AI关联发现 (' + (c.fromText || '') + ' → ' + (c.toText || '') + ')' };
  }).filter(Boolean);

  // 执行存储写入
  saveReportChanges(filteredNewPoints, edgesToAdd, mergeInfos, sourceName, pdfUrl);
}

// 写入变化到存储
function saveReportChanges(newPoints, aiEdges, mergeInfos, sourceName, pdfUrl) {
  var existing = self.KBStore.getPoints();
  var activeKB = self.KBStore.getActiveKB();
  var activeId = self.KBStore.getActiveKBId();
  var addedCount = 0;
  var resolvedUrl = pdfUrl || '';

  // 步骤 1：添加新知识点（带去重检查）
  var addPromises = newPoints.map(function(pt) {
    var dup = existing.some(function(e) {
      return (e.id && pt.id && e.id === pt.id) ||
             (e.title || '').trim() === (pt.title || '').trim();
    });
    if (dup) return Promise.resolve({ added: false });
    if (!pt.id) pt.id = 'kp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    return self.KBStore.addPoint({
      id: pt.id,
      text: pt.title,
      title: pt.title,
      detail: pt.detail || '',
      confidence: pt.confidence || 'medium',
      url: resolvedUrl,
      source: sourceName || 'AI提取',
      timestamp: Date.now(),
      page: findPageForPoint(pt.title || '')
    }).then(function(r) {
      if (r.added) addedCount++;
      return r;
    });
  });

  // 步骤 2：合并重复项（更新已有知识点的 detail）
  var mergePromises = mergeInfos.map(function(m) {
    var existingPt = existing.find(function(e) { return e.id === m.existingId; });
    if (!existingPt) return Promise.resolve(null);
    var newPt = (currentReport && currentReport.result && currentReport.result.newPoints || [])
      .find(function(p) { return p.id === m.newId; });
    if (!newPt || !newPt.detail) return Promise.resolve(null);
    var existingDetail = existingPt.detail || '';
    if (existingDetail.indexOf(newPt.detail) !== -1) return Promise.resolve(null);
    var mergedDetail = existingDetail ? existingDetail + ' | ' + newPt.detail : newPt.detail;
    return self.KBStore.updatePoint(m.existingId, { detail: mergedDetail });
  });

  // 步骤 3：写入 AI 连线
  if (window.AIWormhole && typeof window.AIWormhole.addAIEdges === 'function' && aiEdges.length > 0) {
    window.AIWormhole.addAIEdges(aiEdges);
  }

  // 等待所有变更完成
  Promise.all(addPromises.concat(mergePromises)).then(function() {
    // 刷新侧边栏UI
    loadKnowledgeBases();

    // 生成成功摘要
    var parts = [];
    if (addedCount > 0) parts.push('+' + addedCount + ' 知识点');
    if (aiEdges.length > 0) parts.push(aiEdges.length + ' 条关联');
    if (mergeInfos.length > 0) parts.push(mergeInfos.length + ' 个合并');
    var msg = parts.length > 0 ? '✅ 已应用：' + parts.join('，') : '✅ 已确认，无需变更';
    showWormholeWarning(msg);
    setTimeout(function() { hideWormholeWarning(); }, 4000);

    // 隐藏报告，保留紧凑结果卡片
    hideChangeReport();

    // 发送刷新消息通知所有视图
    try {
      chrome.runtime.sendMessage({ type: 'REFRESH_KNOWLEDGE', kbId: activeId });
    } catch (e) {}
  });
}

function findAndShowConnections(keywords) {
  // 使用当前知识库的知识点查找关联
  if (!knowledgePoints || !knowledgePoints.length) {
    alert('知识库为空，请先收集一些知识点。');
    return;
  }

  showWormholeProgress('正在查找关联知识点...', 10);

  if (window.AIWormhole && typeof window.AIWormhole.findConnections === 'function') {
    window.AIWormhole.findConnections(knowledgePoints, {
      threshold: window.AIWormhole.DEFAULT_THRESHOLD || 0.4,
      maxEdges: window.AIWormhole.MAX_AI_EDGES || 35
    }).then(function(edges) {
      hideWormholeProgress();
      if (edges.length === 0) {
        showWormholeWarning('未找到高关联度的知识点连接。可以尝试在知识星系页面调整阈值。');
      } else {
        // 打开全屏星系查看连接
        var count = edges.length;
        if (confirm('找到 ' + count + ' 个关联知识点。\n\n是否打开知识星系页面查看虫洞连接？')) {
          chrome.tabs.create({ url: chrome.runtime.getURL('network.html') }, function(newTab) {
            // 在新页面加载后添加连线
            // 连线会通过AIWormhole持久化存储自动同步
            if (window.AIWormhole && typeof window.AIWormhole.addAIEdges === 'function') {
              window.AIWormhole.addAIEdges(edges);
            }
          });
        }
      }
    }).catch(function(err) {
      hideWormholeProgress();
      showWormholeWarning('关联分析失败: ' + err.message);
    });
  }
}

// ---- AI进度监听 ----
if (window.AIWormhole && typeof window.AIWormhole.onProgress === 'function') {
  window.AIWormhole.onProgress(function(data) {
    if (whIsProcessing && whProgressFill) {
      whProgressFill.style.width = (data.percent || 0) + '%';
      if (whProgressText) {
        var stageText = data.stage || '';
        if (stageText === 'starting') whProgressText.textContent = '正在启动分析...';
        else if (stageText === 'extracting') whProgressText.textContent = '🔍 提取知识点 (Token估算: ' + (data.tokenEstimate || '?') + ')...';
        else if (stageText === 'local') whProgressText.textContent = '💻 本地引擎分析中...';
        else if (stageText === 'cloud') whProgressText.textContent = '☁️ 云端API分析中...';
        else if (stageText === 'comparing') whProgressText.textContent = '🔗 与现有知识库比对中...';
        else if (stageText === 'report') whProgressText.textContent = '📋 生成变化报告...';
        else if (stageText === 'connecting') whProgressText.textContent = '🗺️ 查找知识关联...';
        else if (stageText === 'done') whProgressText.textContent = '✅ 分析完成';
      }
    }
  });
}

if (window.AIWormhole && typeof window.AIWormhole.onResult === 'function') {
  window.AIWormhole.onResult(function(data) {
    console.log('[Sidepanel] AI结果已更新:', data.pdfUrl);
  });
}

// ---- 启动时检查 ----
function initWormhole() {
  checkOnboarding();
  // 加载已有结果
  if (window.AIWormhole && typeof window.AIWormhole.getResults === 'function') {
    var results = window.AIWormhole.getResults();
    var urls = Object.keys(results);
    if (urls.length > 0) {
      urls.slice(-3).forEach(function(url) {
        var r = results[url];
        var name = url || '未知文档';
        addWormholeResultCard(name, r);
      });
    }
  }

  // 监听AIWormhole配置变化
  if (window.AIWormhole && typeof window.AIWormhole.onConfigChange === 'function') {
    window.AIWormhole.onConfigChange(function(config) {
      checkOnboarding();
      if (whStatusDot) {
        whStatusDot.className = config.enabled ? 'wh-status ready' : 'wh-status ready';
      }
    });
  }
}

// ==================== 启动 ====================
self.KBStore.init().then(function() {
  loadSettings(function() {
    loadKnowledgeBases();
    loadRecentPdfsInSidepanel();
    initWormhole();
  });
});
