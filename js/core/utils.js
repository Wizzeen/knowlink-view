// ====================================================================
//  KnowLink 知识星系 — 共享工具函数 (utils.js)
//  供 sidepanel.js、galaxy-engine.js、network.js 共用
// ====================================================================

var SOURCE_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#f97316', '#eab308',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'
];

// ---- HTML 转义 ----
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- 为知识点分配来源颜色 ----
function assignSourceColors(points, colorMap) {
  if (!colorMap) return;
  for (var k in colorMap) { if (colorMap.hasOwnProperty(k)) delete colorMap[k]; }
  var ci = 0;
  points.forEach(function(p) {
    if (!colorMap[p.url]) colorMap[p.url] = SOURCE_COLORS[ci++ % SOURCE_COLORS.length];
  });
}

// ---- URL 归一化（两套语义，勿混用） ----
// 用于精确实体去重：去协议前缀、去 query/hash、小写
function normalizeUrlForDedup(url) {
  if (!url) return '';
  return url.replace(/^(file:\/\/\/|https?:\/\/|chrome-extension:\/\/[^/]+\/\?)/i, '')
    .split('?')[0].split('#')[0].toLowerCase();
}

// 用于 AI 结果缓存 key：解码 + 提取文件参数 + 取文件名
function normalizeUrlForCacheKey(url) {
  if (!url) return '';
  try {
    var stripped = url.replace(/^(file:\/\/\/|https?:\/\/|chrome-extension:\/\/[^/]+\/\?)/i, '');
    try { stripped = decodeURIComponent(stripped); } catch (e) {}
    var match = stripped.match(/(?:file=|url=|src=|pdf=)([^&?#]+)/i);
    if (match) stripped = match[1];
    try { stripped = decodeURIComponent(stripped); } catch (e) {}
    return stripped.split('/').pop().split('\\').pop().split('?')[0].split('#')[0].toLowerCase();
  } catch (e) {
    return url.toLowerCase();
  }
}

// ---- 解析真实 URL（从各种包装格式中提取原始链接） ----
function resolveRealUrl(url) {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file:///')) return url;

  try {
    var normalized = url;
    if (url.startsWith('extension://')) normalized = 'chrome-' + url;
    var u = new URL(normalized);

    var paramNames = ['src', 'file', 'url', 'originalUrl', 'source', 'pdf', 'href', 'path', 'filename'];
    for (var i = 0; i < paramNames.length; i++) {
      var val = u.searchParams.get(paramNames[i]);
      if (val && val.length > 0) {
        try { var d = decodeURIComponent(val); if (d.startsWith('file://') || d.startsWith('http')) return d; } catch (e2) {}
        if (val.startsWith('file://') || val.startsWith('http')) return val;
      }
    }

    var s = u.search || '';
    if (s.length > 1) {
      var raw = s.substring(1);
      var decoded = raw;
      try { decoded = decodeURIComponent(raw); } catch (e2) {}
      if (decoded.startsWith('file://') || decoded.startsWith('http')) return decoded;
      if (raw.startsWith('file://') || raw.startsWith('http')) return raw;
    }

    var hash = u.hash || '';
    if (hash.length > 1) {
      var h = hash.substring(1);
      try { h = decodeURIComponent(h); } catch (e2) {}
      if (h.startsWith('file://') || h.startsWith('http')) return h;
    }
  } catch (e) {}

  return url;
}

// ---- 导航到知识点的原始来源 ----
// 支持 PDF 页码跳转 + 搜索高亮
function navigateToSource(url, text, page, searchText) {
  if (!url || url === '本地 PDF 文档') {
    alert('该知识点来自本地 PDF，无法自动跳转。\n\n💡 请直接打开该 PDF 文件后重新收集该知识点。');
    return;
  }

  var resolved = resolveRealUrl(url);
  var safeText = (text || '').substring(0, 120).trim();
  var searchQuery = searchText || '';
  var pageNum = page || 0;

  // 判断是否为 PDF 文件
  var isPdf = resolved.toLowerCase().indexOf('.pdf') > -1 ||
              resolved.startsWith('file:///') && resolved.toLowerCase().indexOf('.pdf') > -1;

  if (!resolved.startsWith('http://') && !resolved.startsWith('https://') && !resolved.startsWith('file:///')) {
    chrome.tabs.query({}, function(tabs) {
      var strippedBase = resolved.split('#')[0].split('?')[0];
      var found = tabs.find(function(t) {
        if (!t.url) return false;
        return t.url === resolved || (t.url.split('#')[0].split('?')[0] === strippedBase);
      });
      if (found) {
        chrome.tabs.update(found.id, { active: true });
        chrome.windows.update(found.windowId, { focused: true });
      } else {
        chrome.runtime.sendMessage({ type: 'GET_TODAY_PDFS' }, function(response) {
          var pdfs = (response && response.pdfs) ? response.pdfs : [];
          if (pdfs.length > 0) {
            var bestMatch = pdfs[0];
            var targetUrl = bestMatch.url;
            if (pageNum > 0) targetUrl += '#page=' + pageNum;
            chrome.tabs.create({ url: targetUrl });
          } else {
            alert('无法定位原始文件。\n\n💡 请直接打开该文件后重新收集该知识点。');
          }
        });
      }
    });
    return;
  }

  // PDF 文件：直接使用 Chrome 原生 PDF 阅读器，通过 #page=N 跳页
  if (resolved.startsWith('file:///') || isPdf) {
    var targetUrl = resolved;
    if (pageNum > 0) targetUrl += '#page=' + pageNum;
    chrome.tabs.create({ url: targetUrl });
    return;
  }

  // 普通网页：使用 Text Fragment 高亮
  var targetUrl = resolved;
  if (safeText) {
    targetUrl = resolved.split('#')[0] + '#:~:text=' + encodeURIComponent(safeText);
  }

  chrome.tabs.query({}, function(tabs) {
    var base = resolved.split('#')[0].split('?')[0];
    var existing = tabs.find(function(t) {
      if (!t.url) return false;
      return t.url.split('#')[0].split('?')[0] === base;
    });
    if (existing) {
      chrome.tabs.update(existing.id, { active: true, url: targetUrl });
      chrome.windows.update(existing.windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: targetUrl });
    }
  });
}

// 构建 PDF 查看器 URL（带页码+搜索参数）
function buildPdfViewerUrl(pdfUrl, pageNum, searchQuery) {
  var viewerBase = chrome.runtime.getURL('pdf-viewer.html');
  var params = [];
  if (pdfUrl.startsWith('file:///')) {
    params.push('file=' + encodeURIComponent(pdfUrl));
  } else {
    params.push('url=' + encodeURIComponent(pdfUrl));
  }
  if (pageNum && pageNum > 0) {
    params.push('page=' + pageNum);
  }
  if (searchQuery) {
    params.push('search=' + encodeURIComponent(searchQuery));
  }
  return viewerBase + '?' + params.join('&');
}
