// ====================================================================
//  KnowLink PDF 查看器 — Chrome 原生 PDF 阅读器（跳板）
//  使用 <embed type="application/pdf"> 触发 Chrome 内置 PDF 插件
// ====================================================================

(function() {
  'use strict';

  // ---- i18n 初始化 + 语言切换 ----
  if (window.I18n) {
    window.I18n.init();
    var btnLang = document.getElementById('btn-lang');
    if (btnLang) {
      btnLang.addEventListener('click', function() {
        window.I18n.toggleLocale().then(function() {
          updateUI();
          loadRecentPDFs();
        });
      });
    }
  }

  // ---- DOM ----
  var embedEl         = document.getElementById('pdf-embed');
  var filenameEl      = document.getElementById('filename');
  var errorOverlay    = document.getElementById('error-overlay');
  var errorUrlDisplay = document.getElementById('error-url');
  var btnOpenExternal = document.getElementById('btn-open-external');
  var btnCopyUrl      = document.getElementById('btn-copy-url');
  var btnRetry        = document.getElementById('btn-retry');
  var btnRecentPdfs   = document.getElementById('btn-recent-pdfs');
  var recentPdfsPanel = document.getElementById('recent-pdfs-panel');
  var recentPdfsList  = document.getElementById('recent-pdfs-list');
  var btnRefreshPdfs  = document.getElementById('btn-refresh-pdfs');

  // ---- 状态 ----
  var fileUrl    = null;
  var targetPage = 1;

  // ==================== URL 参数解析 ====================
  function getParams() {
    var params = new URLSearchParams(window.location.search);
    // URLSearchParams.get 已自动 decode，直接使用
    var urlParam = params.get('url');
    if (urlParam) fileUrl = urlParam;
    var fileParam = params.get('file');
    if (!fileUrl && fileParam) fileUrl = fileParam;
    // 兼容旧格式：?file:///path (未编码)
    if (!fileUrl) {
      var raw = window.location.search.substring(1);
      if (raw && (raw.startsWith('file:///') || raw.startsWith('http://') || raw.startsWith('https://'))) {
        try { fileUrl = decodeURIComponent(raw); } catch(e) { fileUrl = raw; }
      }
    }
    // 页码参数
    var pageParam = params.get('page');
    if (pageParam) targetPage = parseInt(pageParam, 10) || 1;
    console.log('[PDF Viewer] 参数解析: url=' + fileUrl + ', page=' + targetPage);
  }

  function updateUI() {
    if (!fileUrl) { filenameEl.textContent = window.I18n ? window.I18n.t('unknown.file') : '未知文件'; return; }
    var name = fileUrl.split('/').pop().split('?')[0].split('#')[0];
    try { name = decodeURIComponent(name); } catch(e) {}
    document.title = name + ' - ' + (window.I18n ? window.I18n.t('pdf.title.suffix') : 'KnowLink PDF 查看器');
    filenameEl.textContent = name;
  }

  // ==================== PDF 加载（Chrome 原生阅读器） ====================
  function loadPDF() {
    if (!fileUrl) {
      showLanding();
      return;
    }
    updateUI();
    hideError();

    // 构建带 #page=N 的 URL，Chrome 原生 PDF 阅读器自动跳页
    var embedUrl = fileUrl.split('#')[0]; // 去掉已有的 hash
    if (targetPage > 1) embedUrl += '#page=' + targetPage;

    console.log('[PDF Viewer] 加载: ' + embedUrl);
    embedEl.src = embedUrl;

    // 监听加载错误
    embedEl.onerror = function() {
      showError(window.I18n ? window.I18n.t('pdf.load.error') : '文件加载失败，请检查路径是否正确。');
    };
  }

  // ==================== 错误 / 提示 ====================
  function showLanding() {
    embedEl.style.display = 'none';
    var landing = document.getElementById('landing-msg');
    if (landing) landing.classList.remove('hidden');
  }

  function showError(msg) {
    errorOverlay.classList.remove('hidden');
    if (errorUrlDisplay) errorUrlDisplay.textContent = msg || (fileUrl || (window.I18n ? window.I18n.t('unknown.file') : '未知文件'));
  }

  function hideError() {
    errorOverlay.classList.add('hidden');
    embedEl.style.display = '';
    var landing = document.getElementById('landing-msg');
    if (landing) landing.classList.add('hidden');
  }

  // ==================== 最近 PDF ====================
  function loadRecentPDFs() {
    if (!recentPdfsList) return;
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      recentPdfsList.innerHTML = '<li class="empty-hint">' + (window.I18n ? window.I18n.t('recent.pdfs.unavailable') : '扩展环境不可用') + '</li>';
      return;
    }
    chrome.runtime.sendMessage({ type: 'GET_TODAY_PDFS' }, function(response) {
      if (chrome.runtime.lastError) {
        recentPdfsList.innerHTML = '<li class="empty-hint">' + (window.I18n ? window.I18n.t('recent.pdfs.fetch.fail') : '无法获取') + '</li>';
        return;
      }
      var pdfs = (response && response.pdfs) ? response.pdfs : [];
      if (!pdfs.length) {
        recentPdfsList.innerHTML = '<li class="empty-hint">' + (window.I18n ? window.I18n.t('recent.pdfs.empty') : '今天还没有打开过 PDF') + '</li>';
        return;
      }
      recentPdfsList.innerHTML = pdfs.map(function(p) {
        var cleanUrl = p.cleanUrl || p.url || '';
        var name = cleanUrl.split('/').pop().split('?')[0];
        try { name = decodeURIComponent(name); } catch(e) {}
        var timeStr = p.time || '';
        return '<li data-url="' + escapeHtml(cleanUrl) + '">'
          + '<span class="pdf-icon">📄</span>'
          + '<div class="pdf-info">'
          + '<div class="pdf-name">' + escapeHtml(name) + '</div>'
          + '<div class="pdf-path">' + escapeHtml(cleanUrl) + '</div>'
          + '</div>'
          + '<span class="pdf-time">' + escapeHtml(timeStr) + '</span>'
          + '</li>';
      }).join('');

      // 点击直接打开 Chrome 原生 PDF 阅读器
      recentPdfsList.querySelectorAll('li[data-url]').forEach(function(li) {
        li.addEventListener('click', function() {
          var url = li.dataset.url;
          if (url) {
            chrome.tabs.create({ url: url });
          }
          recentPdfsPanel.classList.remove('show');
        });
      });
    });
  }

  function toggleRecentPdfs(e) {
    e.stopPropagation();
    var show = !recentPdfsPanel.classList.contains('show');
    if (show) loadRecentPDFs();
    recentPdfsPanel.classList.toggle('show');
  }

  document.addEventListener('click', function(e) {
    if (!recentPdfsPanel.classList.contains('show')) return;
    if (!recentPdfsPanel.contains(e.target) && e.target !== btnRecentPdfs) {
      recentPdfsPanel.classList.remove('show');
    }
  });

  // ==================== 工具栏操作 ====================
  function openExternal() {
    if (!fileUrl) {
      alert(window.I18n ? window.I18n.t('pdf.open.none') : '没有可打开的文件。请先从最近 PDF 列表中选择一个文件。');
      return;
    }
    var url = fileUrl;
    if (targetPage > 1) url += '#page=' + targetPage;
    // 尝试用 chrome.tabs.create 打开，添加错误处理
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: url }, function(tab) {
        if (chrome.runtime.lastError) {
          console.warn('[PDF Viewer] chrome.tabs.create 失败:', chrome.runtime.lastError.message);
          // 降级：用 window.open 尝试
          var w = window.open(url, '_blank');
          if (!w) alert(window.I18n ? window.I18n.t('pdf.open.fail', {url: url}) : ('无法打开文件，请手动复制路径后在浏览器中打开。\n\n' + url));
        }
      });
    } else {
      var w = window.open(url, '_blank');
      if (!w) alert(window.I18n ? window.I18n.t('pdf.open.fail', {url: url}) : ('无法打开文件，请手动复制路径后在浏览器中打开。\n\n' + url));
    }
  }

  function copyUrl() {
    if (!fileUrl) return;
    navigator.clipboard.writeText(fileUrl).then(function() {
      var orig = btnCopyUrl.textContent;
      btnCopyUrl.textContent = window.I18n ? window.I18n.t('pdf.copied') : '✅ 已复制';
      setTimeout(function() { btnCopyUrl.textContent = orig; }, 1500);
    }).catch(function() {
      alert(window.I18n ? window.I18n.t('pdf.copy.fail', {url: fileUrl}) : ('复制失败，请手动复制：\n' + fileUrl));
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ==================== 事件绑定 ====================
  if (btnRecentPdfs)  btnRecentPdfs.addEventListener('click', toggleRecentPdfs);
  if (btnRefreshPdfs) btnRefreshPdfs.addEventListener('click', function(e) { e.stopPropagation(); loadRecentPDFs(); });
  if (btnOpenExternal) btnOpenExternal.addEventListener('click', openExternal);
  if (btnCopyUrl)      btnCopyUrl.addEventListener('click', copyUrl);
  if (btnRetry)        btnRetry.addEventListener('click', function() { hideError(); loadPDF(); });

  // ==================== 启动 ====================
  getParams();
  loadPDF();
  if (!fileUrl) loadRecentPDFs();
})();
