// 导入共享工具 + 统一NLP引擎 + 去重引擎 + 统一数据层
try { importScripts('js/core/utils.js'); } catch(e) { console.warn('[KnowLink BG] 工具函数加载失败:', e.message); }
try { importScripts('js/core/nlp-engine.js'); } catch(e) { console.warn('[KnowLink BG] NLP引擎加载失败:', e.message); }
try { importScripts('js/core/ai-dedup.js'); } catch(e) { console.warn('[KnowLink BG] 去重引擎加载失败，使用精确匹配降级:', e.message); }
try { importScripts('js/core/kb-store.js'); } catch(e) { console.warn('[KnowLink BG] KB数据层加载失败:', e.message); }

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('sidePanel setup failed:', error));

chrome.action.onClicked.addListener((tab) => {
  if (tab?.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch((error) => {
      console.error('sidePanel open failed:', error);
    });
  }
});

// ==================== 常量 ====================
var EDGE_MIGRATION_DONE_KEY = 'edgeMigrationDone';

// 向后兼容别名（已在 kb-store.js 中定义）
var DEFAULT_KB_ID = self.KBStore ? self.KBStore.DEFAULT_KB_ID : 'kb_default';
var DEFAULT_KB_NAME = self.KBStore ? self.KBStore.DEFAULT_KB_NAME : '默认知识库';
function generateKpId() { return self.KBStore ? self.KBStore.generateKpId() : ('kp-' + Date.now().toString(36)); }
function ensureKpId(point) { return self.KBStore ? self.KBStore.ensureKpId(point) : point; }

// ==================== 标签页原始 URL 缓存 ====================
// Edge 打开 PDF 时，先将标签页 URL 设为 file:///C:/doc.pdf，
// 然后重定向到 chrome-extension://.../edge_pdf/index.html（并可能剥离参数）。
// 我们缓存重定向前的真实文件 URL，在收集知识点时恢复。
var tabOriginalUrlCache = {};  // { tabId: { url: string, timestamp: number } }

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  // 只在 URL 变化或有 status 变化时处理
  if (changeInfo.url) {
    var newUrl = changeInfo.url;
    console.log('[KnowLink BG 📋 tabs.onUpdated] tab#' + tabId + ' URL 变化:', newUrl.substring(0, 120));

    // 如果是真实 URL（file:/// 或 http(s)://），缓存为"原始地址"
    if (newUrl.startsWith('file:///') || newUrl.startsWith('http://') || newUrl.startsWith('https://')) {
      tabOriginalUrlCache[tabId] = { url: newUrl, timestamp: Date.now() };
      console.log('[KnowLink BG 📋 tabs.onUpdated] ✅ 缓存原始 URL for tab#' + tabId + ':', newUrl.substring(0, 80));
    }
    // 如果是 PDF 查看器 URL，不更新缓存（保留之前的真实 URL）
    else if (isBareViewerUrl(newUrl) || newUrl.indexOf('/edge_pdf/') > -1 || newUrl.indexOf('/pdfjs/') > -1) {
      console.log('[KnowLink BG 📋 tabs.onUpdated] 检测到 PDF 查看器 URL，保留缓存:', tabOriginalUrlCache[tabId] ? tabOriginalUrlCache[tabId].url.substring(0, 80) : '(无缓存)');
    }
  } else if (changeInfo.status === 'loading') {
    // URL 不可用（可能缺乏 tabs 权限），尝试从 tab 对象获取
    var tabUrl = tab?.url || '';
    if (tabUrl) {
      console.log('[KnowLink BG 📋 tabs.onUpdated] tab#' + tabId + ' status=loading, tab.url=', tabUrl.substring(0, 120));
      if (tabUrl.startsWith('file:///') || tabUrl.startsWith('http://') || tabUrl.startsWith('https://')) {
        tabOriginalUrlCache[tabId] = { url: tabUrl, timestamp: Date.now() };
        console.log('[KnowLink BG 📋 tabs.onUpdated] ✅ 从 tab.url 缓存原始 URL for tab#' + tabId);
      }
    } else {
      console.log('[KnowLink BG 📋 tabs.onUpdated] tab#' + tabId + ' status=' + changeInfo.status + ' (无 URL 数据 — 可能需要 tabs 权限)');
    }
  }
});

chrome.tabs.onRemoved.addListener(function(tabId) {
  if (tabOriginalUrlCache[tabId]) {
    console.log('[KnowLink BG 📋] 清理 tab#' + tabId + ' 缓存:', tabOriginalUrlCache[tabId].url);
    delete tabOriginalUrlCache[tabId];
  }
});

// ==================== 工具函数 ====================

/** 从标签页 URL 中提取真实 URL（处理 PDF 查看器等扩展页面的 URL）
 *  提取成功返回真实 URL，提取失败返回原始 URL（绝不返回 null，避免丢失地址） */
function extractRealUrl(tabUrl) {
  console.log('[KnowLink BG 📋 extractRealUrl] 输入 URL:', tabUrl);
  if (!tabUrl) {
    console.log('[KnowLink BG 📋 extractRealUrl] URL 为空，返回 null');
    return null;
  }

  // 1. HTTP/HTTPS → 原样返回
  if (tabUrl.startsWith('http://') || tabUrl.startsWith('https://')) {
    console.log('[KnowLink BG 📋 extractRealUrl] ✅ HTTP/HTTPS，直接返回');
    return tabUrl;
  }

  // 2. file:/// → 原样返回
  if (tabUrl.startsWith('file:///')) {
    console.log('[KnowLink BG 📋 extractRealUrl] ✅ file:///，直接返回');
    return tabUrl;
  }

  // 3. Chrome/Edge PDF 查看器扩展 URL → 提取原始文件/URL
  if (tabUrl.startsWith('chrome-extension://') || tabUrl.startsWith('edge-extension://') ||
      tabUrl.startsWith('chrome://') || tabUrl.startsWith('edge://')) {
    console.log('[KnowLink BG 📋 extractRealUrl] 检测到扩展/内部 URL，开始提取参数...');
    try {
      var urlObj = new URL(tabUrl);
      console.log('[KnowLink BG 📋 extractRealUrl] URL 解析成功');
      console.log('[KnowLink BG 📋 extractRealUrl]   - protocol:', urlObj.protocol);
      console.log('[KnowLink BG 📋 extractRealUrl]   - hostname:', urlObj.hostname);
      console.log('[KnowLink BG 📋 extractRealUrl]   - pathname:', urlObj.pathname);
      console.log('[KnowLink BG 📋 extractRealUrl]   - search  :', urlObj.search);
      console.log('[KnowLink BG 📋 extractRealUrl]   - hash    :', urlObj.hash);

      // 策略1：尝试命名参数 (key=value 形式)
      var paramNames = ['src', 'file', 'url', 'originalUrl', 'source', 'pdf', 'href', 'path', 'filename'];
      console.log('[KnowLink BG 📋 extractRealUrl] 策略1: 尝试命名参数', JSON.stringify(paramNames));
      for (var i = 0; i < paramNames.length; i++) {
        var val = urlObj.searchParams.get(paramNames[i]);
        if (val && val.length > 0) {
          console.log('[KnowLink BG 📋 extractRealUrl]   参数 [' + paramNames[i] + '] =', val.substring(0, 100));
          try {
            var d = decodeURIComponent(val);
            if (d.startsWith('file://') || d.startsWith('http://') || d.startsWith('https://')) {
              console.log('[KnowLink BG 📋 extractRealUrl] ✅ 策略1 成功，解码为:', d);
              return d;
            }
            console.log('[KnowLink BG 📋 extractRealUrl]   解码后不匹配模式，仍返回原始值');
            return val;
          } catch (e2) {
            console.log('[KnowLink BG 📋 extractRealUrl]   解码失败，返回原始值');
            return val;
          }
        }
      }

      // 策略2：原始查询字符串
      var searchStr = urlObj.search || '';
      console.log('[KnowLink BG 📋 extractRealUrl] 策略2: 检查原始查询字符串');
      if (searchStr.length > 1) {
        var rawParam = searchStr.substring(1);
        var decodedParam = rawParam;
        try { decodedParam = decodeURIComponent(rawParam); } catch (e2) { /* 解码失败用原始值 */ }
        console.log('[KnowLink BG 📋 extractRealUrl]   原始 query:', rawParam.substring(0, 100));
        console.log('[KnowLink BG 📋 extractRealUrl]   解码 query:', decodedParam.substring(0, 100));
        if (decodedParam.startsWith('file://') || decodedParam.startsWith('http://') || decodedParam.startsWith('https://')) {
          console.log('[KnowLink BG 📋 extractRealUrl] ✅ 策略2 成功（解码）');
          return decodedParam;
        }
        if (rawParam.startsWith('file://') || rawParam.startsWith('http://') || rawParam.startsWith('https://')) {
          console.log('[KnowLink BG 📋 extractRealUrl] ✅ 策略2 成功（原始）');
          return rawParam;
        }
        var colonIdx = decodedParam.indexOf('%3A%2F%2F');
        if (colonIdx < 0) colonIdx = decodedParam.indexOf('://');
        if (colonIdx > 0 && colonIdx < 20) {
          console.log('[KnowLink BG 📋 extractRealUrl] ✅ 策略2 成功（冒号检测）');
          return decodedParam;
        }
      } else {
        console.log('[KnowLink BG 📋 extractRealUrl]   URL 无 search 部分');
      }

      // 策略3：hash 参数
      var hash = urlObj.hash || '';
      console.log('[KnowLink BG 📋 extractRealUrl] 策略3: 检查 hash');
      if (hash.length > 1) {
        var hashParam = hash.substring(1);
        try { hashParam = decodeURIComponent(hashParam); } catch (e2) { /* 忽略 */ }
        console.log('[KnowLink BG 📋 extractRealUrl]   hash 内容:', hashParam.substring(0, 100));
        if (hashParam.startsWith('file://') || hashParam.startsWith('http://') || hashParam.startsWith('https://')) {
          console.log('[KnowLink BG 📋 extractRealUrl] ✅ 策略3 成功');
          return hashParam;
        }
      } else {
        console.log('[KnowLink BG 📋 extractRealUrl]   URL 无 hash 部分');
      }
    } catch (e) {
      console.error('[KnowLink BG 📋 extractRealUrl] URL 解析失败:', e);
    }
    console.warn('[KnowLink BG 📋 extractRealUrl] ❌ 所有策略失败，返回原始 URL:', tabUrl);
    return tabUrl;
  }

  // 4. 其他未知 scheme → 原样返回
  console.log('[KnowLink BG 📋 extractRealUrl] 未知 scheme，原样返回');
  return tabUrl;
}

/** 判断是否为裸 PDF 查看器 URL（无查询参数和 hash，无法提取真实地址） */
function isBareViewerUrl(url) {
  if (!url) return false;
  return (url.startsWith('chrome-extension://') || url.startsWith('edge-extension://') ||
          url.startsWith('extension://') || url.startsWith('chrome://') || url.startsWith('edge://'))
    && url.indexOf('?') === -1 && url.indexOf('#') === -1;
}

/** URL 标准化：去掉片段、尾部斜杠、www 前缀，统一 https */
function normalizeUrl(raw) {
  if (!raw) return '';
  try {
    var u = new URL(raw);
    var host = u.hostname.replace(/^www\./, '');
    var path = u.pathname.replace(/\/$/, '');
    return 'https://' + host + path;
  } catch (e) {
    return raw.trim().toLowerCase();
  }
}

// ==================== 历史记录 PDF URL 解析器 ====================
// Edge 打开 PDF 时，先导航到 file:/// 或 https://...pdf，然后重定向到内部查看器。
// 原始 URL 会被记录在浏览器历史中。我们利用 chrome.history API 检索当天记录。

/** 判断 URL 是否为 PDF 文件（基于扩展名或常见模式） */
function isPdfUrl(url) {
  if (!url) return false;
  var lower = url.toLowerCase();
  // 扩展名匹配
  if (lower.endsWith('.pdf')) return true;
  // URL 中包含 pdf 且不是查看器页面
  if (lower.indexOf('.pdf?') > -1 || lower.indexOf('.pdf#') > -1) return true;
  // Content-Type 近似判断（仅对 http/https 有效，此处做保守匹配）
  return false;
}

/** 获取当天零点的时间戳 */
function getTodayStartMs() {
  var now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

/**
 * 从浏览器历史记录中搜索今天打开过的 PDF 文件
 * @param {Function} callback - callback(resultsArray)
 */
function searchTodayPdfs(callback) {
  var todayStart = getTodayStartMs();
  console.log('[KnowLink BG 📋 history] 搜索今天的历史记录，起始时间:', new Date(todayStart).toISOString());

  chrome.history.search({
    text: '',
    startTime: todayStart,
    maxResults: 200
  }, function(historyItems) {
    if (chrome.runtime.lastError) {
      console.error('[KnowLink BG 📋 history] 历史搜索失败:', chrome.runtime.lastError.message);
      callback([]);
      return;
    }
    console.log('[KnowLink BG 📋 history] 历史搜索结果:', historyItems.length, '条');

    // 筛选出 PDF 相关的 URL
    var pdfItems = [];
    for (var i = 0; i < historyItems.length; i++) {
      var item = historyItems[i];
      if (isPdfUrl(item.url)) {
        // 排除扩展/内部页面 URL
        if (!item.url.startsWith('chrome-extension://') &&
            !item.url.startsWith('edge-extension://') &&
            !item.url.startsWith('chrome://') &&
            !item.url.startsWith('edge://')) {
          pdfItems.push({
            url: item.url,
            title: item.title || '',
            lastVisitTime: item.lastVisitTime,
            visitCount: item.visitCount || 0
          });
        }
      }
    }

    // 去重：按规范化 URL（去掉 #page=N 等 hash 片段）分组，保留最近访问的一条
    var seen = {};
    for (var i = 0; i < pdfItems.length; i++) {
      var item = pdfItems[i];
      // 规范化 URL：去掉 hash 片段（如 #page=5），保留基础 URL
      var baseUrl = item.url.split('#')[0].split('?')[0];
      if (!seen[baseUrl] || item.lastVisitTime > seen[baseUrl].lastVisitTime) {
        seen[baseUrl] = item;
      }
    }
    // 重建排序列表，附上格式化的时间
    var deduped = [];
    var baseUrls = Object.keys(seen);
    for (var k = 0; k < baseUrls.length; k++) {
      var it = seen[baseUrls[k]];
      var d = new Date(it.lastVisitTime);
      it.time = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
      it.cleanUrl = baseUrls[k];
      deduped.push(it);
    }
    deduped.sort(function(a, b) { return b.lastVisitTime - a.lastVisitTime; });
    pdfItems = deduped;

    console.log('[KnowLink BG 📋 history] 去重后 PDF 文件:', pdfItems.length, '个');
    for (var j = 0; j < Math.min(pdfItems.length, 5); j++) {
      console.log('[KnowLink BG 📋 history]   [' + j + ']', pdfItems[j].title || '(无标题)', '→', pdfItems[j].url.substring(0, 100));
    }

    callback(pdfItems);
  });
}

/**
 * 给定一个 tabId，从历史记录中匹配最可能的原始 PDF URL
 * 策略：找到 tab 创建/导航时间前后 30 秒内最近访问的 PDF URL
 * @param {number} tabId
 * @param {Function} callback - callback(resolvedUrl | null)
 */
function resolvePdfFromHistory(tabId, callback) {
  console.log('[KnowLink BG 📋 history] resolvePdfFromHistory for tab#' + tabId);

  // 先获取 tab 信息以确定时间窗口
  chrome.tabs.get(tabId, function(tab) {
    if (chrome.runtime.lastError || !tab) {
      console.warn('[KnowLink BG 📋 history] 无法获取 tab 信息:', chrome.runtime.lastError?.message);
      // 回退：直接返回今天最近的一个 PDF
      searchTodayPdfs(function(pdfs) {
        callback(pdfs.length > 0 ? pdfs[0].url : null);
      });
      return;
    }

    console.log('[KnowLink BG 📋 history] tab 信息 - url:', tab.url, 'title:', tab.title);

    searchTodayPdfs(function(pdfs) {
      if (pdfs.length === 0) {
        console.warn('[KnowLink BG 📋 history] 今天没有浏览过 PDF 文件');
        callback(null);
        return;
      }

      // 策略1：通过 tab.title 匹配（PDF 标题通常就是文件名）
      if (tab.title) {
        var cleanTitle = tab.title.replace(' - Microsoft Edge', '').replace(' - Edge', '').trim();
        console.log('[KnowLink BG 📋 history] 策略1: 标题匹配，cleanTitle="' + cleanTitle + '"');
        for (var i = 0; i < pdfs.length; i++) {
          // 从 URL 中提取文件名
          var fileName = pdfs[i].url.split('/').pop().split('?')[0].split('#')[0];
          try { fileName = decodeURIComponent(fileName); } catch(e) {}
          // 去掉 .pdf 后缀后比较
          var nameNoExt = fileName.replace(/\.pdf$/i, '');
          console.log('[KnowLink BG 📋 history]   比较: "' + nameNoExt + '" vs "' + cleanTitle + '"');
          if (cleanTitle && nameNoExt && (
              cleanTitle.toLowerCase().indexOf(nameNoExt.toLowerCase()) > -1 ||
              nameNoExt.toLowerCase().indexOf(cleanTitle.toLowerCase()) > -1)) {
            console.log('[KnowLink BG 📋 history] ✅ 策略1 标题匹配成功:', pdfs[i].url);
            callback(pdfs[i].url);
            return;
          }
        }
      }

      // 策略2：通过 tab.url 中的文件名片段匹配
      if (tab.url) {
        var tabUrlParts = tab.url.split('/');
        var tabLastPart = tabUrlParts[tabUrlParts.length - 1].split('?')[0].split('#')[0];
        try { tabLastPart = decodeURIComponent(tabLastPart); } catch(e) {}
        console.log('[KnowLink BG 📋 history] 策略2: URL 片段匹配，lastPart="' + tabLastPart + '"');
        for (var j = 0; j < pdfs.length; j++) {
          var pdfName = pdfs[j].url.split('/').pop().split('?')[0].split('#')[0];
          try { pdfName = decodeURIComponent(pdfName); } catch(e) {}
          if (tabLastPart && pdfName && pdfName.toLowerCase().indexOf(tabLastPart.toLowerCase()) > -1) {
            console.log('[KnowLink BG 📋 history] ✅ 策略2 URL 片段匹配成功:', pdfs[j].url);
            callback(pdfs[j].url);
            return;
          }
        }
      }

      // 策略3：返回今天最近访问的一个 PDF，记录为"猜测"
      console.log('[KnowLink BG 📋 history] 策略3: 返回最近访问的 PDF（最佳猜测）:', pdfs[0].url);
      callback(pdfs[0].url);
    });
  });
}

// 全局缓存：避免频繁搜索历史（5秒内复用）
var _pdfHistoryCache = { data: null, timestamp: 0, ttl: 5000 };

function getCachedTodayPdfs(callback) {
  var now = Date.now();
  if (_pdfHistoryCache.data && (now - _pdfHistoryCache.timestamp) < _pdfHistoryCache.ttl) {
    console.log('[KnowLink BG 📋 history] 使用缓存，年龄:', (now - _pdfHistoryCache.timestamp), 'ms');
    callback(_pdfHistoryCache.data);
    return;
  }
  searchTodayPdfs(function(results) {
    _pdfHistoryCache.data = results;
    _pdfHistoryCache.timestamp = Date.now();
    callback(results);
  });
}

// 设置已由 KBStore 管理
// ==================== 知识库迁移（已由 KBStore.init 处理） ====================

// ==================== 边引用迁移：下标 → 稳定 ID ====================
function migrateEdgesToIds(callback) {
  chrome.storage.local.get([EDGE_MIGRATION_DONE_KEY, 'aiEdges'], function(result) {
    if (result[EDGE_MIGRATION_DONE_KEY]) {
      console.log('[KnowLink BG] 边迁移已完成，跳过');
      if (callback) callback();
      return;
    }

    var aiEdges = result.aiEdges || [];
    var kbs = self.KBStore.getKBs();
    if (!aiEdges.length) {
      // 无边数据，标记完成
      chrome.storage.local.set({ edgeMigrationDone: true });
      console.log('[KnowLink BG] 无边数据，跳过边迁移');
      if (callback) callback();
      return;
    }

    // 收集所有知识点 ID（按顺序）
    var allPoints = [];
    kbs.forEach(function(kb) {
      var pts = kb.knowledgePoints || [];
      allPoints = allPoints.concat(pts);
    });

    if (!allPoints.length) {
      chrome.storage.local.set({ edgeMigrationDone: true, aiEdges: [] });
      console.log('[KnowLink BG] 知识库为空，清空旧边');
      if (callback) callback();
      return;
    }

    console.log('[KnowLink BG] 开始边迁移：' + aiEdges.length + ' 条边，' + allPoints.length + ' 个知识点');

    // 确保所有知识点有 ID
    var updatedKBs = false;
    kbs.forEach(function(kb) {
      (kb.knowledgePoints || []).forEach(function(p) {
        if (!p.id) { ensureKpId(p); updatedKBs = true; }
      });
    });

    // 重建 allPoints（可能已补 ID）
    allPoints = [];
    kbs.forEach(function(kb) {
      allPoints = allPoints.concat(kb.knowledgePoints || []);
    });

    // 迁移边：from/to 从数组下标转为稳定 ID
    var migrated = 0;
    var orphaned = 0;
    var newEdges = [];
    aiEdges.forEach(function(edge) {
      var fromIdx = edge.from;
      var toIdx = edge.to;
      if (typeof fromIdx === 'number' && typeof toIdx === 'number' &&
          fromIdx < allPoints.length && toIdx < allPoints.length) {
        edge.from = allPoints[fromIdx].id;
        edge.to = allPoints[toIdx].id;
        newEdges.push(edge);
        migrated++;
      } else if (typeof fromIdx === 'string' && typeof toIdx === 'string') {
        // 已经是 ID 格式，保留
        newEdges.push(edge);
      } else {
        orphaned++;
      }
    });

    console.log('[KnowLink BG] 边迁移结果：' + migrated + ' 条迁移，' + orphaned + ' 条孤立（已丢弃），' + newEdges.length + ' 条保留');

    var setData = { edgeMigrationDone: true, aiEdges: newEdges };
    if (updatedKBs) setData.knowledgeBases = kbs;

    chrome.storage.local.set(setData, function() {
      if (chrome.runtime.lastError) {
        console.error('[KnowLink BG] 边迁移失败:', chrome.runtime.lastError);
      } else {
        console.log('[KnowLink BG] 边迁移完成');
      }
      if (callback) callback();
    });
  });
}

// ==================== 获取活跃知识库 ID ====================
function getActiveKBId(callback) {
  callback(self.KBStore.getActiveKBId());
}

// ==================== 知识点存储中枢（委托给 KBStore） ====================
function saveKnowledge(data, kbId, callback) {
  // 兼容旧调用（无 kbId）
  if (!kbId && typeof kbId !== 'string') {
    getActiveKBId(function(activeId) {
      saveKnowledge(data, activeId, callback);
    });
    return;
  }

  // 确保有稳定 ID
  ensureKpId(data);

  // 语义去重（使用 ai-dedup.js 共享引擎）
  var existingPoints = self.KBStore.getPoints(kbId);
  if (typeof semanticDedup === 'function') {
    var dedupResult = semanticDedup(data, existingPoints, 0.75);
    if (dedupResult.isDuplicate) {
      console.log('[KnowLink BG] 语义去重命中 (confidence=' + dedupResult.confidence + '%)');
      chrome.runtime.sendMessage({
        type: 'DUPLICATE_KNOWLEDGE',
        kbId: kbId
      }).catch(function() {});
      if (callback) callback();
      return;
    }
  }

  // 委托给 KBStore（内部处理精确实体去重 + 持久化 + 广播）
  self.KBStore.addPoint(data, kbId).then(function() {
    if (callback) callback();
  }).catch(function(err) {
    console.error('[KnowLink BG] KBStore.addPoint 失败:', err);
    if (callback) callback();
  });
}

// ==================== 消息路由 ====================
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  // --- 消息大小校验 ---
  if (message.type === 'NEW_KNOWLEDGE' && message.data) {
    var text = message.data.text || '';
    if (text.length > 5000) { sendResponse({ success: false, error: '知识点文本过长 (max 5000 字符)' }); return; }
    var url = message.data.url || '';
    if (url.length > 2000) { sendResponse({ success: false, error: 'URL 过长 (max 2000 字符)' }); return; }
  }
  // --- 收集知识点 ---
  if (message.type === 'NEW_KNOWLEDGE' && message.data) {
    console.log('[KnowLink BG 📋] ====== 收到 NEW_KNOWLEDGE ======');
    console.log('[KnowLink BG 📋] 知识点文本:', (message.data.text || '').substring(0, 50));
    console.log('[KnowLink BG 📋] 知识点 title:', message.data.source);
    var rawUrl = message.data.url || '';
    console.log('[KnowLink BG 📋] content.js 传来的 URL:', rawUrl);
    console.log('[KnowLink BG 📋] isBareViewerUrl(rawUrl):', isBareViewerUrl(rawUrl));
    console.log('[KnowLink BG 📋] sender.tab 存在:', !!(sender && sender.tab));
    if (sender && sender.tab) {
      console.log('[KnowLink BG 📋] sender.tab.url:', sender.tab.url);
      console.log('[KnowLink BG 📋] sender.tab.id:', sender.tab.id);
      console.log('[KnowLink BG 📋] sender.tab.title:', sender.tab.title);
    }

    // content.js 在 PDF 查看器页面中 window.location.href 可能不含文档参数，
    // 此时用 sender.tab.url（标签页地址栏的真实 URL，含完整查询参数）
    if (isBareViewerUrl(rawUrl) && sender && sender.tab && sender.tab.url) {
      console.log('[KnowLink BG 📋] rawUrl 是裸 URL，改用 sender.tab.url:', sender.tab.url);
      console.log('[KnowLink BG 📋] sender.tab.url 裸?', isBareViewerUrl(sender.tab.url));
      rawUrl = sender.tab.url;
    }

    // ★ 如果仍是裸 viewer URL，检查 tabOriginalUrlCache
    if (isBareViewerUrl(rawUrl) && sender && sender.tab
        && typeof sender.tab.id === 'number' && sender.tab.id >= 0) {
      var nkcache = tabOriginalUrlCache[sender.tab.id];
      if (nkcache && nkcache.url && (nkcache.url.startsWith('file:///') || nkcache.url.startsWith('http://') || nkcache.url.startsWith('https://'))) {
        var nkAge = Date.now() - nkcache.timestamp;
        if (nkAge < 30000) {
          console.log('[KnowLink BG 📋] ✅ NEW_KNOWLEDGE 命中缓存! 原始 URL:', nkcache.url, '(缓存年龄: ' + nkAge + 'ms)');
          rawUrl = nkcache.url;
        }
      }
    }

    // 内部处理函数：提取真实 URL 并保存
    function _processAndSave(finalUrl) {
      console.log('[KnowLink BG 📋] _processAndSave 入参:', finalUrl);
      console.log('[KnowLink BG 📋] isBareViewerUrl(finalUrl):', isBareViewerUrl(finalUrl));
      var realUrl = extractRealUrl(finalUrl);
      console.log('[KnowLink BG 📋] extractRealUrl 返回:', realUrl);
      if (realUrl && realUrl !== finalUrl) {
        console.log('[KnowLink BG 📋] ✅ URL 转换成功: ' + finalUrl.substring(0, 50) + ' → ' + realUrl.substring(0, 80));
        message.data.url = realUrl;
        _doSave(message.data);
      } else if (isBareViewerUrl(finalUrl)) {
        // ★ 最终回退：利用历史记录查找原始 PDF URL
        console.warn('[KnowLink BG 📋] ❌ 无法提取真实 URL，尝试历史记录回退...');
        var histTabId = (sender && sender.tab && typeof sender.tab.id === 'number' && sender.tab.id >= 0)
          ? sender.tab.id : -1;

        resolvePdfFromHistory(histTabId, function(resolvedUrl) {
          if (resolvedUrl) {
            console.log('[KnowLink BG 📋] ✅ 历史记录回退成功! 原始 PDF URL:', resolvedUrl);
            message.data.url = resolvedUrl;
          } else {
            console.warn('[KnowLink BG 📋] ❌ 历史记录也未找到，保留 viewer URL 供恢复');
            if (sender && sender.tab && sender.tab.title) {
              message.data.source = sender.tab.title
                .replace(' - Microsoft Edge', '')
                .replace(' - Edge', '');
            }
          }
          _doSave(message.data);
        });
      } else if (!finalUrl) {
        console.warn('[KnowLink BG 📋] URL 为空');
        message.data.url = '';
        _doSave(message.data);
      } else {
        console.log('[KnowLink BG 📋] 保留 finalUrl（非查看器 URL）');
        _doSave(message.data);
      }
    }

    // 实际保存函数（从 _processAndSave 中抽取）
    function _doSave(data) {
      getActiveKBId(function(kbId) {
        saveKnowledge(data, kbId, function() {
          try { sendResponse({ status: 'success' }); } catch (e) {}
        });
      });
    }

    // 如果 sender.tab.url 仍是裸 URL，尝试 chrome.tabs.get 获取完整标签页信息
    if (isBareViewerUrl(rawUrl) && sender && sender.tab
        && typeof sender.tab.id === 'number' && sender.tab.id >= 0) {
      console.log('[KnowLink BG 📋] 尝试 chrome.tabs.get(' + sender.tab.id + ')...');
      chrome.tabs.get(sender.tab.id, function(tab) {
        if (chrome.runtime.lastError) {
          console.warn('[KnowLink BG 📋] chrome.tabs.get 失败:', chrome.runtime.lastError.message);
          _processAndSave(rawUrl);
          return;
        }
        console.log('[KnowLink BG 📋] chrome.tabs.get 返回 tab.url:', tab ? tab.url : 'null');
        if (tab && tab.url && tab.url !== rawUrl && tab.url.indexOf('?') > -1) {
          console.log('[KnowLink BG 📋] ✅ chrome.tabs.get 获取到完整标签页 URL');
          _processAndSave(tab.url);
        } else {
          console.log('[KnowLink BG 📋] chrome.tabs.get URL 与 rawUrl 相同或无参数');
          _processAndSave(rawUrl);
        }
      });
    } else {
      console.log('[KnowLink BG 📋] 不需要 chrome.tabs.get，直接处理');
      _processAndSave(rawUrl);
    }
    return true; // 异步响应
  }

  // --- 设置相关 ---
  if (message.type === 'GET_SETTINGS') {
    var settings = self.KBStore.getSettings();
    try { sendResponse({ maxItems: settings.maxItems }); } catch (e) {}
    return false;
  }

  if (message.type === 'UPDATE_SETTINGS' && message.settings) {
    self.KBStore.updateSettings(message.settings).then(function() {
      try { sendResponse({ status: 'success' }); } catch (e) {}
    });
    return true;
  }

  // --- 知识库 CRUD（委托给 KBStore） ---
  if (message.type === 'GET_KNOWLEDGE_BASES') {
    try {
      sendResponse({
        knowledgeBases: self.KBStore.getKBs(),
        activeKnowledgeBaseId: self.KBStore.getActiveKBId()
      });
    } catch (e) {}
    return false;
  }

  if (message.type === 'CREATE_KNOWLEDGE_BASE') {
    var name = (message.name || '').trim();
    if (!name) {
      try { sendResponse({ status: 'error', message: '知识库名称不能为空' }); } catch (e) {}
      return false;
    }
    self.KBStore.createKB(name).then(function() {
      try { sendResponse({ status: 'success', kb: { id: self.KBStore.getActiveKBId(), name: name } }); } catch (e) {}
    }).catch(function(err) {
      try { sendResponse({ status: 'error', message: err.message }); } catch (e) {}
    });
    return true;
  }

  if (message.type === 'DELETE_KNOWLEDGE_BASE') {
    var kbId = message.kbId;
    if (!kbId) {
      try { sendResponse({ status: 'error', message: '缺少知识库 ID' }); } catch (e) {}
      return false;
    }
    self.KBStore.deleteKB(kbId).then(function(result) {
      // Phase 6b: 清理孤边（清理引用已删除知识点的 AI 连线）
      if (result.deletedPointIds && result.deletedPointIds.length > 0) {
        chrome.storage.local.get(['aiEdges'], function(edgeResult) {
          var edges = edgeResult.aiEdges || [];
          var deletedSet = {};
          result.deletedPointIds.forEach(function(id) { deletedSet[id] = true; });
          var before = edges.length;
          edges = edges.filter(function(e) {
            return !deletedSet[e.from] && !deletedSet[e.to];
          });
          var removed = before - edges.length;
          if (removed > 0) {
            chrome.storage.local.set({ aiEdges: edges }, function() {
              console.log('[KnowLink BG] 孤边清理: 移除 ' + removed + ' 条连线 (KB: ' + kbId + ')');
              try { chrome.runtime.sendMessage({ type: 'AI_EDGES_UPDATED', count: edges.length }); } catch (e) {}
            });
          }
        });
      }
      try { sendResponse({ status: 'success', newActiveId: result.newActiveId }); } catch (e) {}
    }).catch(function(err) {
      try { sendResponse({ status: 'error', message: err.message }); } catch (e) {}
    });
    return true;
  }

  if (message.type === 'RENAME_KNOWLEDGE_BASE') {
    var kbId = message.kbId;
    var newName = (message.name || '').trim();
    if (!kbId || !newName) {
      try { sendResponse({ status: 'error', message: '参数不完整' }); } catch (e) {}
      return false;
    }
    self.KBStore.renameKB(kbId, newName).then(function() {
      try { sendResponse({ status: 'success' }); } catch (e) {}
    }).catch(function(err) {
      try { sendResponse({ status: 'error', message: err.message }); } catch (e) {}
    });
    return true;
  }

  if (message.type === 'SET_ACTIVE_KNOWLEDGE_BASE') {
    var kbId = message.kbId;
    if (!kbId) {
      try { sendResponse({ status: 'error', message: '缺少知识库 ID' }); } catch (e) {}
      return false;
    }
    self.KBStore.setActiveKB(kbId).then(function() {
      try { sendResponse({ status: 'success' }); } catch (e) {}
    }).catch(function(err) {
      try { sendResponse({ status: 'error', message: err.message }); } catch (e) {}
    });
    return true;
  }

  if (message.type === 'GET_ACTIVE_KB_INFO') {
    var activeKB = self.KBStore.getActiveKB();
    try {
      sendResponse({
        kbId: self.KBStore.getActiveKBId(),
        kbName: activeKB ? activeKB.name : self.KBStore.DEFAULT_KB_NAME
      });
    } catch (e) {}
    return false;
  }

  // ==================== 历史记录 PDF 相关 ====================

  // 获取今天浏览过的所有 PDF 文件列表
  if (message.type === 'GET_TODAY_PDFS') {
    getCachedTodayPdfs(function(pdfs) {
      try { sendResponse({ pdfs: pdfs }); } catch (e) {}
    });
    return true;
  }

  // 通过历史记录解析当前 tab 的真实 PDF URL
  if (message.type === 'RESOLVE_PDF_FROM_HISTORY') {
    var targetTabId = message.tabId;
    console.log('[KnowLink BG 📋] RESOLVE_PDF_FROM_HISTORY, tabId:', targetTabId);

    // 如果有明确的 tabId，用 tabId 解析
    if (typeof targetTabId === 'number' && targetTabId >= 0) {
      resolvePdfFromHistory(targetTabId, function(resolvedUrl) {
        console.log('[KnowLink BG 📋] 解析结果:', resolvedUrl);
        try { sendResponse({ url: resolvedUrl }); } catch (e) {}
      });
    } else {
      // 无有效 tabId：返回最近访问的 PDF 列表供 UI 选择
      getCachedTodayPdfs(function(pdfs) {
        try { sendResponse({ pdfs: pdfs }); } catch (e) {}
      });
    }
    return true;
  }

  // 刷新历史缓存（在标签页更新时由 content.js 调用）
  if (message.type === 'REFRESH_PDF_HISTORY_CACHE') {
    _pdfHistoryCache.timestamp = 0; // 强制下次重新搜索
    try { sendResponse({ status: 'ok' }); } catch (e) {}
    return false;
  }
});

// ==================== 右键菜单 ====================
chrome.runtime.onInstalled.addListener(function() {
  chrome.contextMenus.create({
    id: 'knowlink-collect-menu',
    title: '💡 收集到 KnowLink 侧边栏',
    contexts: ['selection']
  });

  // 启动时初始化 KBStore（含迁移）
  self.KBStore.init();
});

chrome.contextMenus.onClicked.addListener(function(info, tab) {
  if (info.menuItemId !== 'knowlink-collect-menu') return;

  var selectedText = (info.selectionText || '').trim();
  if (!selectedText) return;

  var sourceUrl = tab?.url || '';
  var sourceName = tab?.title || 'PDF / 未知文档';

  console.log('[KnowLink BG 📋 右键菜单] ====== 右键菜单收集 ======');
  console.log('[KnowLink BG 📋 右键菜单] tab.url:', sourceUrl);
  console.log('[KnowLink BG 📋 右键菜单] tab.id:', tab?.id);
  console.log('[KnowLink BG 📋 右键菜单] tab.title:', tab?.title);
  console.log('[KnowLink BG 📋 右键菜单] info.pageUrl:', info.pageUrl);
  console.log('[KnowLink BG 📋 右键菜单] info.frameUrl:', info.frameUrl);
  console.log('[KnowLink BG 📋 右键菜单] info.linkUrl:', info.linkUrl);
  console.log('[KnowLink BG 📋 右键菜单] info.srcUrl:', info.srcUrl);
  console.log('[KnowLink BG 📋 右键菜单] isBareViewerUrl:', isBareViewerUrl(sourceUrl));

  sourceName = sourceName
    .replace(' - Microsoft Edge', '')
    .replace(' - Edge', '');

  // 内部处理函数：提取真实 URL 并保存
  function _saveWithUrl(finalUrl) {
    console.log('[KnowLink BG 📋 右键菜单] _saveWithUrl 入参:', finalUrl);
    var realUrl = extractRealUrl(finalUrl);
    if (realUrl && realUrl !== finalUrl) {
      console.log('[KnowLink BG 📋 右键菜单] ✅ URL 转换: ' + finalUrl.substring(0, 50) + ' → ' + realUrl.substring(0, 80));
      finalUrl = realUrl;
    } else if (isBareViewerUrl(finalUrl)) {
      console.warn('[KnowLink BG 📋 右键菜单] ❌ 无法提取真实 URL，尝试历史记录回退...');
      // 历史回退是异步的，但右键菜单需要同步处理
      // 这里先用一个标记，异步解析后更新存储
      var ctxSelectedText = selectedText;
      var ctxSourceName = sourceName;
      var ctxTabId = (tab && tab.id >= 0) ? tab.id : -1;

      resolvePdfFromHistory(ctxTabId, function(resolvedUrl) {
        if (resolvedUrl) {
          console.log('[KnowLink BG 📋 右键菜单] ✅ 历史回退成功:', resolvedUrl);
          finalUrl = resolvedUrl;
        } else {
          console.warn('[KnowLink BG 📋 右键菜单] 历史也未找到，保留原始 URL');
        }
        getActiveKBId(function(kbId) {
          saveKnowledge({
            text: ctxSelectedText,
            source: ctxSourceName,
            url: finalUrl,
            timestamp: Date.now()
          }, kbId);
        });
      });
      return; // 异步处理，提前返回
    } else if (!finalUrl) {
      finalUrl = '';
    }

    getActiveKBId(function(kbId) {
      saveKnowledge({
        text: selectedText,
        source: sourceName,
        url: finalUrl,
        timestamp: Date.now()
      }, kbId);
    });
  }

  // tab.id === -1 表示这是 Edge 内部页面（PDF 查看器），tabs API 不可用
  if (tab && tab.id >= 0) {
    console.log('[KnowLink BG 📋 右键菜单] tab.id 有效，进入正常提取流程');

    // ★ 优先检查缓存
    var cached = tabOriginalUrlCache[tab.id];
    if (cached && cached.url && (cached.url.startsWith('file:///') || cached.url.startsWith('http://') || cached.url.startsWith('https://'))) {
      var cacheAge = Date.now() - cached.timestamp;
      if (cacheAge < 30000) {
        console.log('[KnowLink BG 📋 右键菜单] ✅ 命中缓存! 原始 URL:', cached.url, '(年龄: ' + cacheAge + 'ms)');
        _saveWithUrl(cached.url);
        return;
      }
      console.log('[KnowLink BG 📋 右键菜单] 缓存过期 (年龄: ' + cacheAge + 'ms)');
    }

    // 正常流程：尝试 chrome.tabs.get
    chrome.tabs.get(tab.id, function(fullTab) {
      if (chrome.runtime.lastError) {
        console.warn('[KnowLink BG 📋 右键菜单] chrome.tabs.get 失败:', chrome.runtime.lastError.message);
        _saveWithUrl(sourceUrl);
        return;
      }
      console.log('[KnowLink BG 📋 右键菜单] chrome.tabs.get 返回:', fullTab?.url);
      if (fullTab && fullTab.url && fullTab.url !== sourceUrl && fullTab.url.indexOf('?') > -1) {
        console.log('[KnowLink BG 📋 右键菜单] chrome.tabs.get 获取到带参数 URL');
        _saveWithUrl(fullTab.url);
      } else {
        _saveWithUrl(sourceUrl);
      }
    });
  } else {
    // tab.id === -1：Edge 内部页面，无法使用 tabs API
    console.warn('[KnowLink BG 📋 右键菜单] ⚠️ tab.id = -1 (Edge 内部页面)，尝试替代策略...');

    // 策略 A：检查 info.frameUrl 是否包含真实文件路径
    if (info.frameUrl && info.frameUrl !== sourceUrl) {
      console.log('[KnowLink BG 📋 右键菜单] 策略A: info.frameUrl 与 tab.url 不同!');
      console.log('[KnowLink BG 📋 右键菜单]   frameUrl:', info.frameUrl);
      var frameExtracted = extractRealUrl(info.frameUrl);
      if (frameExtracted && (frameExtracted.startsWith('file:///') || frameExtracted.startsWith('http://') || frameExtracted.startsWith('https://'))) {
        console.log('[KnowLink BG 📋 右键菜单] ✅ 从 frameUrl 提取成功:', frameExtracted);
        _saveWithUrl(frameExtracted);
        return;
      }
    }

    // 策略 B：尝试 chrome.tabs.query 查找活动标签页（可能拿到不同数据）
    console.log('[KnowLink BG 📋 右键菜单] 策略B: chrome.tabs.query 查找活动标签页...');
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (!chrome.runtime.lastError && tabs && tabs.length > 0) {
        var activeTab = tabs[0];
        console.log('[KnowLink BG 📋 右键菜单]   query 返回 tab.id:', activeTab.id, 'url:', activeTab.url);
        // chrome.tabs.query 返回的可能也有 id=-1，但值得一试
        if (activeTab.url && activeTab.url !== sourceUrl) {
          console.log('[KnowLink BG 📋 右键菜单]   query URL ≠ menu URL!');
          var qExtracted = extractRealUrl(activeTab.url);
          if (qExtracted && (qExtracted.startsWith('file:///') || qExtracted.startsWith('http://') || qExtracted.startsWith('https://'))) {
            console.log('[KnowLink BG 📋 右键菜单] ✅ 策略B 提取成功:', qExtracted);
            _saveWithUrl(qExtracted);
            return;
          }
        }
      }
      console.warn('[KnowLink BG 📋 右键菜单] ❌ 所有替代策略失败，只能存储裸 URL');
      console.log('[KnowLink BG 📋 右键菜单]   备用的 sourceName/title:', sourceName);
      _saveWithUrl(sourceUrl);
    });
  }
});

// ==================== 启动 ====================
// KBStore.init() 处理迁移 + 加载，然后执行边迁移
self.KBStore.init().then(function() {
  migrateEdgesToIds();
});
