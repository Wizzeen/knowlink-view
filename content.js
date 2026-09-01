// ==================== Edge PDF URL 捕获 + 诊断 ====================
// Edge 的 PDF 查看器在加载 PDF 后可能通过多种方式移除/隐藏文件路径参数，
// 导致后续无法获取真实文件地址。在 document_start 阶段拦截并记录所有相关信息。
var __KNOWLINK_CAPTURED_URL__ = null;
var __KNOWLINK_DIAG__ = {
  initialHref: null,
  replaceStateCalls: [],
  pushStateCalls: [],
  locationChange: null,
  domReadyHref: null
};

(function() {
  var href = window.location.href;
  __KNOWLINK_DIAG__.initialHref = href;
  console.log('[KnowLink 📋 诊断] document_start 时 window.location.href =', href);
  console.log('[KnowLink 📋 诊断]   - 含 ? :', href.indexOf('?') > -1);
  console.log('[KnowLink 📋 诊断]   - 含 # :', href.indexOf('#') > -1);
  console.log('[KnowLink 📋 诊断]   - protocol:', window.location.protocol);
  console.log('[KnowLink 📋 诊断]   - hostname:', window.location.hostname);
  console.log('[KnowLink 📋 诊断]   - pathname:', window.location.pathname);
  console.log('[KnowLink 📋 诊断]   - search  :', window.location.search);
  console.log('[KnowLink 📋 诊断]   - hash    :', window.location.hash);
  console.log('[KnowLink 📋 诊断]   - document.URL:', document.URL);

  // 立即捕获：如果当前 URL 已有文件参数，先保存
  if (href.indexOf('?') > -1 || href.indexOf('#') > -1) {
    __KNOWLINK_CAPTURED_URL__ = href;
    console.log('[KnowLink 📋 诊断] ✅ document_start 时 URL 自带参数，已捕获:', href);
  }

  // 拦截 history.replaceState
  var _origReplaceState = history.replaceState;
  history.replaceState = function(state, title, url) {
    var beforeHref = window.location.href;
    __KNOWLINK_DIAG__.replaceStateCalls.push({before: beforeHref, url: url, title: title});
    console.log('[KnowLink 📋 诊断] 🔄 history.replaceState 被调用');
    console.log('[KnowLink 📋 诊断]   调用前 URL:', beforeHref);
    console.log('[KnowLink 📋 诊断]   新 URL     :', url);
    if (__KNOWLINK_CAPTURED_URL__ === null && (beforeHref.indexOf('?') > -1 || beforeHref.indexOf('#') > -1)) {
      __KNOWLINK_CAPTURED_URL__ = beforeHref;
      console.log('[KnowLink 📋 诊断] ✅ replaceState 前捕获 URL:', beforeHref);
    }
    return _origReplaceState.apply(this, arguments);
  };

  // 拦截 history.pushState
  var _origPushState = history.pushState;
  history.pushState = function(state, title, url) {
    var beforeHref = window.location.href;
    __KNOWLINK_DIAG__.pushStateCalls.push({before: beforeHref, url: url, title: title});
    console.log('[KnowLink 📋 诊断] ➕ history.pushState 被调用, URL:', url);
    if (__KNOWLINK_CAPTURED_URL__ === null && (beforeHref.indexOf('?') > -1 || beforeHref.indexOf('#') > -1)) {
      __KNOWLINK_CAPTURED_URL__ = beforeHref;
      console.log('[KnowLink 📋 诊断] ✅ pushState 前捕获 URL:', beforeHref);
    }
    return _origPushState.apply(this, arguments);
  };
})();

// 在 DOM 就绪后记录 URL 变化
document.addEventListener('DOMContentLoaded', function() {
  __KNOWLINK_DIAG__.domReadyHref = window.location.href;
  console.log('[KnowLink 📋 诊断] DOMContentLoaded 时 URL =', window.location.href);
  console.log('[KnowLink 📋 诊断]   captured URL =', __KNOWLINK_CAPTURED_URL__);
  console.log('[KnowLink 📋 诊断]   replaceState 调用次数:', __KNOWLINK_DIAG__.replaceStateCalls.length);
  console.log('[KnowLink 📋 诊断]   pushState 调用次数:', __KNOWLINK_DIAG__.pushStateCalls.length);
  if (__KNOWLINK_DIAG__.replaceStateCalls.length > 0) {
    console.log('[KnowLink 📋 诊断]   replaceState 详情:', JSON.stringify(__KNOWLINK_DIAG__.replaceStateCalls));
  }
});

// ==================== KB 名称缓存 ====================
var cachedKBName = 'KnowLink';

function refreshKBName() {
  chrome.storage.local.get(['knowledgeBases', 'activeKnowledgeBaseId'], function(result) {
    var kbs = result.knowledgeBases || [];
    var activeId = result.activeKnowledgeBaseId;
    var activeKB = kbs.find(function(kb) { return kb.id === activeId; });
    if (activeKB) {
      cachedKBName = activeKB.name;
    } else if (kbs.length > 0) {
      cachedKBName = kbs[0].name;
    } else {
      cachedKBName = 'KnowLink';
    }
  });
}
refreshKBName();

// 监听知识库切换，实时更新按钮文本
try {
  chrome.storage.onChanged.addListener(function(changes, areaName) {
    if (areaName === 'local' && (changes.knowledgeBases || changes.activeKnowledgeBaseId)) {
      refreshKBName();
    }
  });
} catch(e) { /* storage.onChanged 不可用时忽略 */ }

// ==================== PDF URL 智能提取 ====================
/** 在 PDF 查看器页面中，window.location.href 可能不含文件参数。
 *  此函数尝试从 DOM 中的 embed/iframe/object 元素读取 src，获取完整 PDF URL */
function getRealPdfUrl() {
  console.log('[KnowLink 📋 getRealPdfUrl] ====== 开始提取真实 PDF URL ======');

  // 输出诊断信息
  console.log('[KnowLink 📋 getRealPdfUrl] __KNOWLINK_CAPTURED_URL__:', __KNOWLINK_CAPTURED_URL__);
  console.log('[KnowLink 📋 getRealPdfUrl] 诊断记录:', JSON.stringify(__KNOWLINK_DIAG__, null, 2));

  // ★ 优先使用从 history.replaceState 拦截到的原始 URL
  if (__KNOWLINK_CAPTURED_URL__) {
    console.log('[KnowLink 📋 getRealPdfUrl] 尝试从 captured URL 提取:', __KNOWLINK_CAPTURED_URL__);
    var captured = _extractFromUrl(__KNOWLINK_CAPTURED_URL__);
    if (captured) {
      console.log('[KnowLink 📋 getRealPdfUrl] ✅ captured URL 提取成功:', captured);
      return captured;
    }
    if (__KNOWLINK_CAPTURED_URL__.startsWith('http://') ||
        __KNOWLINK_CAPTURED_URL__.startsWith('https://') ||
        __KNOWLINK_CAPTURED_URL__.startsWith('file:///')) {
      console.log('[KnowLink 📋 getRealPdfUrl] ✅ captured URL 本身就是真实地址');
      return __KNOWLINK_CAPTURED_URL__;
    }
    console.log('[KnowLink 📋 getRealPdfUrl] ❌ captured URL 无法提取有效地址');
  }

  var href = window.location.href;
  console.log('[KnowLink 📋 getRealPdfUrl] window.location.href:', href);

  // 如果 URL 已有查询参数或 hash（非裸 URL），直接返回
  if (href.indexOf('?') > -1 || href.indexOf('#') > -1) {
    console.log('[KnowLink 📋 getRealPdfUrl] ✅ URL 自带参数，直接返回');
    return href;
  }

  // 如果不是浏览器扩展/内部页面 URL，直接返回
  if (!href.startsWith('chrome-extension://') && !href.startsWith('edge-extension://')
      && !href.startsWith('chrome://') && !href.startsWith('edge://')) {
    console.log('[KnowLink 📋 getRealPdfUrl] ✅ 非扩展 URL，直接返回');
    return href;
  }

  console.log('[KnowLink 📋 getRealPdfUrl] 检测到扩展/内部页面 URL，开始 DOM 探测...');

  // === DOM 结构诊断 dump ===
  try {
    console.log('[KnowLink 📋 getRealPdfUrl] --- DOM 结构诊断 ---');
    console.log('[KnowLink 📋 getRealPdfUrl] document.title:', document.title);
    console.log('[KnowLink 📋 getRealPdfUrl] document.body 存在:', !!document.body);

    // 列出所有 embed 元素
    var allEmbedsDiag = document.querySelectorAll('embed');
    console.log('[KnowLink 📋 getRealPdfUrl] <embed> 元素数量:', allEmbedsDiag.length);
    for (var ed = 0; ed < allEmbedsDiag.length; ed++) {
      var embDiag = allEmbedsDiag[ed];
      console.log('[KnowLink 📋 getRealPdfUrl]   embed[' + ed + ']:', {
        src: embDiag.src,
        type: embDiag.type,
        id: embDiag.id,
        className: embDiag.className,
        width: embDiag.width,
        height: embDiag.height
      });
    }

    // 列出所有 iframe 元素
    var allIframesDiag = document.querySelectorAll('iframe');
    console.log('[KnowLink 📋 getRealPdfUrl] <iframe> 元素数量:', allIframesDiag.length);
    for (var id2 = 0; id2 < allIframesDiag.length; id2++) {
      console.log('[KnowLink 📋 getRealPdfUrl]   iframe[' + id2 + ']:', {
        src: allIframesDiag[id2].src,
        id: allIframesDiag[id2].id
      });
    }

    // 列出所有 object 元素
    var allObjsDiag = document.querySelectorAll('object');
    console.log('[KnowLink 📋 getRealPdfUrl] <object> 元素数量:', allObjsDiag.length);
    for (var od = 0; od < allObjsDiag.length; od++) {
      console.log('[KnowLink 📋 getRealPdfUrl]   object[' + od + ']:', {
        data: allObjsDiag[od].data,
        type: allObjsDiag[od].type,
        id: allObjsDiag[od].id
      });
    }

    // 检查是否有 <pdf-viewer> 等自定义元素
    var pdfViewerEl = document.querySelector('pdf-viewer');
    console.log('[KnowLink 📋 getRealPdfUrl] <pdf-viewer> 存在:', !!pdfViewerEl);

    // 尝试查找所有可能包含 PDF URL 的属性 (data-url, data-src 等)
    var dataUrlEls = document.querySelectorAll('[data-url], [data-src], [data-file], [data-pdf]');
    console.log('[KnowLink 📋 getRealPdfUrl] 含 data-url/src/file/pdf 属性的元素:', dataUrlEls.length);
    for (var du = 0; du < Math.min(dataUrlEls.length, 5); du++) {
      var el = dataUrlEls[du];
      console.log('[KnowLink 📋 getRealPdfUrl]   element[' + du + '] tag=' + el.tagName,
        'data-url=' + el.getAttribute('data-url'),
        'data-src=' + el.getAttribute('data-src'),
        'data-file=' + el.getAttribute('data-file'));
    }

    console.log('[KnowLink 📋 getRealPdfUrl] --- DOM 诊断结束 ---');
  } catch(diagErr) {
    console.error('[KnowLink 📋 getRealPdfUrl] DOM 诊断出错:', diagErr);
  }

  // 策略1：查找 <embed type="application/pdf"> 的 src 属性（Chrome PDF 查看器）
  console.log('[KnowLink 📋 策略1] 查找 embed[type="application/pdf"]...');
  var embed = document.querySelector('embed[type="application/pdf"]');
  console.log('[KnowLink 📋 策略1] embed 找到:', !!embed, embed ? 'src=' + embed.src : '');
  if (embed && embed.src) {
    var extracted = _extractFromUrl(embed.src);
    console.log('[KnowLink 📋 策略1] _extractFromUrl 结果:', extracted);
    if (extracted) return extracted;
    if (embed.src.startsWith('file://') || embed.src.startsWith('http://') || embed.src.startsWith('https://')) {
      console.log('[KnowLink 📋 策略1] ✅ embed.src 直接就是有效 URL');
      return embed.src;
    }
  }

  // 策略1b：遍历所有 embed（不限制 type）
  console.log('[KnowLink 📋 策略1b] 遍历所有 <embed>...');
  var allEmbeds = document.querySelectorAll('embed');
  for (var e = 0; e < allEmbeds.length; e++) {
    var emb = allEmbeds[e];
    if (emb.src && !(emb.type && emb.type.indexOf('application/pdf') === 0)) {
      console.log('[KnowLink 📋 策略1b] embed[' + e + '] src=' + emb.src + ' type=' + emb.type);
      var extracted = _extractFromUrl(emb.src);
      if (extracted) { console.log('[KnowLink 📋 策略1b] ✅ 提取成功:', extracted); return extracted; }
      if (emb.src.startsWith('file://') || emb.src.startsWith('http://') || emb.src.startsWith('https://')) {
        console.log('[KnowLink 📋 策略1b] ✅ 直接有效:', emb.src);
        return emb.src;
      }
    }
  }

  // 策略2：查找 <iframe> 中含 PDF 路径的 src
  console.log('[KnowLink 📋 策略2] 查找 <iframe>...');
  var iframes = document.querySelectorAll('iframe');
  for (var j = 0; j < iframes.length; j++) {
    var src = iframes[j].src;
    if (!src) continue;
    console.log('[KnowLink 📋 策略2] iframe[' + j + '] src=' + src);
    var extracted = _extractFromUrl(src);
    if (extracted) { console.log('[KnowLink 📋 策略2] ✅ 提取成功:', extracted); return extracted; }
    if (src.startsWith('file://') || src.startsWith('http://') || src.startsWith('https://')) {
      console.log('[KnowLink 📋 策略2] ✅ 直接有效:', src);
      return src;
    }
  }

  // 策略3：查找 <object type="application/pdf"> 的 data 属性
  console.log('[KnowLink 📋 策略3] 查找 object[type="application/pdf"]...');
  var obj = document.querySelector('object[type="application/pdf"]');
  console.log('[KnowLink 📋 策略3] object 找到:', !!obj, obj ? 'data=' + obj.data : '');
  if (obj && obj.data) {
    var extracted = _extractFromUrl(obj.data);
    if (extracted) { console.log('[KnowLink 📋 策略3] ✅ 提取成功:', extracted); return extracted; }
    if (obj.data.startsWith('file://') || obj.data.startsWith('http://') || obj.data.startsWith('https://')) {
      console.log('[KnowLink 📋 策略3] ✅ 直接有效:', obj.data);
      return obj.data;
    }
  }

  // 策略3b：遍历所有 <object> 元素
  console.log('[KnowLink 📋 策略3b] 遍历所有 <object>...');
  var allObjs = document.querySelectorAll('object');
  for (var o = 0; o < allObjs.length; o++) {
    if (allObjs[o].data) {
      console.log('[KnowLink 📋 策略3b] object[' + o + '] data=' + allObjs[o].data);
      var extracted = _extractFromUrl(allObjs[o].data);
      if (extracted) { console.log('[KnowLink 📋 策略3b] ✅ 提取成功:', extracted); return extracted; }
      if (allObjs[o].data.startsWith('file://') || allObjs[o].data.startsWith('http://') || allObjs[o].data.startsWith('https://')) {
        console.log('[KnowLink 📋 策略3b] ✅ 直接有效:', allObjs[o].data);
        return allObjs[o].data;
      }
    }
  }

  // 策略4：尝试 document.URL
  console.log('[KnowLink 📋 策略4] document.URL =', document.URL);
  try {
    var docUrl = document.URL;
    if (docUrl && docUrl !== href) {
      console.log('[KnowLink 📋 策略4] document.URL 与 window.location.href 不同，尝试提取');
      var extracted = _extractFromUrl(docUrl);
      if (extracted) { console.log('[KnowLink 📋 策略4] ✅ 提取成功:', extracted); return extracted; }
    }
  } catch (e) { console.log('[KnowLink 📋 策略4] 出错:', e); }

  // 策略5：搜索页面文本中的 URL
  console.log('[KnowLink 📋 策略5] 搜索页面文本中的 PDF URL...');
  try {
    var bodyText = document.body ? document.body.innerText : '';
    console.log('[KnowLink 📋 策略5] body.innerText 长度:', bodyText.length);
    if (bodyText.length > 0 && bodyText.length < 10000) {
      var urlMatch = bodyText.match(/((?:file|https?):\/\/[^\s]+\.pdf[^\s]*)/i);
      if (urlMatch && urlMatch[1]) {
        console.log('[KnowLink 📋 策略5] ✅ 页面文本中找到 URL:', urlMatch[1]);
        try {
          var candidate = decodeURIComponent(urlMatch[1]);
          return encodeURI(candidate);
        } catch(e2) { return urlMatch[1]; }
      }
      console.log('[KnowLink 📋 策略5] 未找到 PDF URL 匹配');
    }
  } catch (e) { console.log('[KnowLink 📋 策略5] 出错:', e); }

  // 策略6（新增）：检查 window.name（某些查看器存储原始 URL）
  console.log('[KnowLink 📋 策略6] window.name =', window.name);
  if (window.name && (window.name.startsWith('file://') || window.name.startsWith('http'))) {
    console.log('[KnowLink 📋 策略6] ✅ window.name 是有效地址');
    return window.name;
  }

  // 策略7（新增）：检查 performance.getEntriesByType('navigation')
  console.log('[KnowLink 📋 策略7] 检查 performance navigation entries...');
  try {
    var navEntries = performance.getEntriesByType('navigation');
    console.log('[KnowLink 📋 策略7] navigation entries 数量:', navEntries.length);
    for (var ne = 0; ne < navEntries.length; ne++) {
      console.log('[KnowLink 📋 策略7]   entry[' + ne + ']:', {
        name: navEntries[ne].name,
        type: navEntries[ne].type,
        redirectCount: navEntries[ne].redirectCount
      });
    }
  } catch(e7) { console.log('[KnowLink 📋 策略7] 出错:', e7); }

  // 策略8（新增）：尝试通过 chrome.runtime 查询 background 中的缓存
  // (在 sendMessage 回调中处理，这里只标记)

  // 策略9（新增）：检查 sessionStorage / localStorage 中是否有存储的文件路径
  console.log('[KnowLink 📋 策略9] 检查 sessionStorage / localStorage...');
  try {
    var storageKeys = ['pdfUrl', 'pdfSrc', 'fileUrl', 'filePath', 'originalUrl', 'documentUrl',
                       'pdfjs.url', 'pdfjs.file', 'viewerUrl', 'src'];
    // sessionStorage
    for (var sk = 0; sk < storageKeys.length; sk++) {
      var val = sessionStorage.getItem(storageKeys[sk]);
      if (val) console.log('[KnowLink 📋 策略9] sessionStorage.' + storageKeys[sk] + ' =', val.substring(0, 100));
    }
    // localStorage
    for (var lk = 0; lk < storageKeys.length; lk++) {
      var lval = localStorage.getItem(storageKeys[lk]);
      if (lval) console.log('[KnowLink 📋 策略9] localStorage.' + storageKeys[lk] + ' =', lval.substring(0, 100));
    }
    // 列出所有 sessionStorage 键
    console.log('[KnowLink 📋 策略9] sessionStorage 键数:', sessionStorage.length);
    for (var ssk = 0; ssk < Math.min(sessionStorage.length, 10); ssk++) {
      var skey = sessionStorage.key(ssk);
      console.log('[KnowLink 📋 策略9]   sessionStorage[' + skey + '] =', (sessionStorage.getItem(skey) || '').substring(0, 80));
    }
    // 列出所有 localStorage 键（仅 PDF viewer 相关）
    console.log('[KnowLink 📋 策略9] localStorage 键数:', localStorage.length);
    for (var lsk = 0; lsk < Math.min(localStorage.length, 10); lsk++) {
      var lkey = localStorage.key(lsk);
      var lval2 = localStorage.getItem(lkey);
      if (lval2 && lval2.length < 500) {
        console.log('[KnowLink 📋 策略9]   localStorage[' + lkey + '] =', lval2.substring(0, 120));
      }
    }
  } catch(se) { console.log('[KnowLink 📋 策略9] storage 检查出错:', se); }

  console.log('[KnowLink 📋 getRealPdfUrl] ❌ 所有策略均失败，返回裸 URL:', href);
  return href;
}

/** 从 URL 中提取 file/url/src 等命名参数的值 */
function _extractFromUrl(urlStr) {
  try {
    var u = new URL(urlStr);
    var paramNames = ['src', 'file', 'url', 'originalUrl', 'source', 'pdf', 'href', 'path', 'filename'];
    for (var i = 0; i < paramNames.length; i++) {
      var val = u.searchParams.get(paramNames[i]);
      if (val && (val.startsWith('file://') || val.startsWith('http://') || val.startsWith('https://'))) {
        try { return decodeURIComponent(val); } catch (e) { return val; }
      }
    }
    // 也检查原始查询字符串（无 key=value 形式）
    var s = u.search;
    if (s && s.length > 1) {
      var raw = s.substring(1);
      try { raw = decodeURIComponent(raw); } catch (e) {}
      if (raw.startsWith('file://') || raw.startsWith('http://') || raw.startsWith('https://')) {
        return raw;
      }
    }
  } catch (e) {}
  return null;
}

// ==================== 浮动按钮 ====================
var floatingBtn = null;

function createBtn(x, y, text) {
  if (floatingBtn) floatingBtn.remove();

  floatingBtn = document.createElement('button');
  floatingBtn.innerText = '💡 收集到「' + cachedKBName + '」';

  // 边界检测：防止按钮溢出屏幕
  var btnWidth = 180, btnHeight = 34;
  var maxX = window.innerWidth - btnWidth - 8;
  var maxY = window.innerHeight - btnHeight - 8;
  var adjustedX = Math.min(x, maxX);
  var adjustedY = Math.min(y + 10, maxY);

  floatingBtn.style.cssText = `
    position: fixed;
    top: ${adjustedY}px;
    left: ${adjustedX}px;
    z-index: 2147483647;
    padding: 6px 12px;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.15);
    font-size: 13px;
    transition: background 0.15s;
    white-space: nowrap;
  `;

  floatingBtn.addEventListener('mouseenter', function() {
    floatingBtn.style.background = '#2563eb';
  });
  floatingBtn.addEventListener('mouseleave', function() {
    floatingBtn.style.background = '#3b82f6';
  });

  floatingBtn.addEventListener('click', function(e) {
    e.stopPropagation();

    chrome.runtime.sendMessage({
      type: 'NEW_KNOWLEDGE',
      data: {
        text: text,
        source: document.title,
        url: getRealPdfUrl(),
        timestamp: Date.now()
      }
    }, function(response) {
      if (chrome.runtime.lastError) {
        // 静默失败，按钮自动消失
        console.log('[KnowLink] 发送失败:', chrome.runtime.lastError.message);
      }
      if (floatingBtn) {
        floatingBtn.innerText = '✅ 已收集';
        floatingBtn.style.background = '#10b981';
        floatingBtn.style.cursor = 'default';
        floatingBtn.style.pointerEvents = 'none';
        setTimeout(function() {
          if (floatingBtn) {
            floatingBtn.remove();
            floatingBtn = null;
          }
        }, 1000);
      }
    });
  });

  // 挂载到 documentElement 而非 body，避免 body 样式干扰
  var parent = document.body || document.documentElement;
  parent.appendChild(floatingBtn);
}

function clearFloatingBtn() {
  if (floatingBtn) {
    floatingBtn.remove();
    floatingBtn = null;
  }
}

document.addEventListener('mouseup', function(e) {
  var selection = window.getSelection();
  var text = selection.toString().trim();

  if (text.length > 0) {
    createBtn(e.clientX, e.clientY, text);
  } else {
    clearFloatingBtn();
  }
});

document.addEventListener('mousedown', function() {
  clearFloatingBtn();
});
