// ====================================================================
//  KnowLink 知识星系 — AI AI 关联引擎 (ai-wormhole.js)
//  核心编排器：Worker管理 + 降级调度 + 公开API
//  委托给：CloudAdapter（云端API）、AIStore（持久化）、AIEdges（连线）、self.NLP（本地引擎）
// ====================================================================

(function () {
  'use strict';

  // ==================== 常量 ====================
  var DEFAULT_THRESHOLD  = 0.4;
  var MAX_AI_EDGES       = 35;

  // ==================== 内部状态 ====================
  var _listeners  = { progress: [], result: [], configChange: [] };
  var _worker     = null;
  var _workerReady = false;
  var _pendingWorkerCallbacks = {};

  // ==================== 初始化 ====================
  function init() {
    return window.AIStore.init().then(function () {
      window.AIEdges.init();
      _initWorker();
    });
  }

  // ==================== Web Worker ====================
  function _initWorker() {
    try {
      var workerUrl = chrome.runtime.getURL('js/core/ai-worker.js');
      _worker = new Worker(workerUrl);
      _worker.onmessage = function (e) {
        var msg = e.data;
        if (msg.type === 'ready') {
          _workerReady = true;
          Object.keys(_pendingWorkerCallbacks).forEach(function (id) {
            var cb = _pendingWorkerCallbacks[id];
            delete _pendingWorkerCallbacks[id];
            _sendToWorker(cb.type, cb.data, cb.resolve, cb.reject);
          });
        } else if (msg.type === 'progress') {
          _notify('progress', msg);
        } else if (msg.type === 'result') {
          var cb = _pendingWorkerCallbacks[msg.id];
          if (cb) {
            delete _pendingWorkerCallbacks[msg.id];
            cb.resolve(msg.data);
          }
        } else if (msg.type === 'error') {
          var cbErr = _pendingWorkerCallbacks[msg.id];
          if (cbErr) {
            delete _pendingWorkerCallbacks[msg.id];
            cbErr.reject(new Error(msg.message));
          }
        }
      };
      _worker.onerror = function (err) {
        console.error('[AIWormhole] Worker error:', err);
        _workerReady = false;
      };
    } catch (e) {
      console.warn('[AIWormhole] Worker 不可用，使用主线程降级方案:', e.message);
      _worker = null;
      _workerReady = false;
    }
  }

  var _workerMsgId = 0;
  function _sendToWorker(type, data, resolve, reject) {
    if (_worker && _workerReady) {
      var id = 'w' + (++_workerMsgId);
      _pendingWorkerCallbacks[id] = { type: type, data: data, resolve: resolve, reject: reject };
      _worker.postMessage({ id: id, type: type, data: data });
    } else if (_worker && !_workerReady) {
      var idPending = 'w' + (++_workerMsgId);
      _pendingWorkerCallbacks[idPending] = { type: type, data: data, resolve: resolve, reject: reject };
    } else {
      _fallbackProcess(type, data, resolve, reject);
    }
  }

  // ==================== 降级处理 ====================
  function _fallbackProcess(type, data, resolve, reject) {
    console.log('[AIWormhole] 使用主线程降级处理:', type);
    try {
      if (type === 'summarize') {
        var result = _localSummarizeSync(data.text, data.maxLength || 200);
        _notify('progress', { percent: 100 });
        resolve(result);
      } else if (type === 'findConnections') {
        var edges = _localFindConnectionsSync(data.points, data.threshold || DEFAULT_THRESHOLD, data.maxEdges || MAX_AI_EDGES);
        _notify('progress', { percent: 100 });
        resolve(edges);
      } else if (type === 'compare') {
        var compareResult = _localCompareSync(data);
        _notify('progress', { percent: 100 });
        resolve(compareResult);
      } else if (type === 'dedupCheck') {
        var dedupResult = _localDedupCheckSync(data);
        _notify('progress', { percent: 100 });
        resolve(dedupResult);
      } else {
        reject(new Error('Unknown worker type: ' + type));
      }
    } catch (e) {
      reject(e);
    }
  }

  // ---- 主线程降级实现（委托给 self.NLP） ----
  function _localSummarizeSync(text, maxLength) {
    var result = self.NLP.summarize(text, maxLength || 200);
    return {
      summary: result.summary,
      keywords: result.keywords,
      knowledgePoints: result.knowledgePoints,
      relations: result.relations,
      wordCount: text.length
    };
  }

  function _localFindConnectionsSync(points, threshold, maxEdges) {
    // 统一实现：self.NLP.findConnections（消除与 ai-worker 的重复）
    return self.NLP.findConnections(points, threshold, maxEdges);
  }

  function _localCompareSync(data) {
    var newPoints = data.newPoints || [];
    var existingPoints = data.existingPoints || [];
    // 统一实现：self.NLP.comparePoints（含 MAX_AI_EDGES 上限，消除与 ai-worker 的重复）
    return self.NLP.comparePoints(newPoints, existingPoints, {
      dupThreshold: data.dupThreshold || 0.75,
      maybeThreshold: data.maybeThreshold || 0.6,
      connectThreshold: data.connectThreshold || 0.4,
      maxConnections: MAX_AI_EDGES
    });
  }

  function _localDedupCheckSync(data) {
    var candidate = data.candidate || {};
    var existing = data.existing || [];
    // 统一实现：self.NLP.dedupCheck（消除与 ai-dedup / ai-worker 的重复）
    return self.NLP.dedupCheck(candidate, existing, data.threshold || 0.75);
  }

  // ==================== PDF URL 归一化 ====================
  function normalizePdfUrl(url) {
    // 统一实现：utils.js 的 normalizeUrlForCacheKey
    if (typeof normalizeUrlForCacheKey === 'function') return normalizeUrlForCacheKey(url);
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

  // ==================== 配置管理（委托给 AIStore） ====================
  function getConfig() {
    return window.AIStore.getConfig();
  }

  function saveConfig(newConfig) {
    return window.AIStore.saveConfig(newConfig);
  }

  function testConnection() {
    return window.CloudAdapter.testConnection(window.AIStore.getConfig());
  }

  // ==================== summarizePDF — 智能摘要管线 ====================
  function summarizePDF(text, pdfUrl, options) {
    options = options || {};
    var forceEngine = options.forceEngine || null;
    var normalizedUrl = normalizePdfUrl(pdfUrl);

    if (!text || text.trim().length < 50) {
      return Promise.resolve({
        summary: '',
        keywords: [],
        knowledgePoints: [],
        relations: [],
        wordCount: text ? text.trim().length : 0,
        engine: 'none',
        error: text && text.trim().length > 0
          ? '⚠️ 提取到的文本过少（仅' + text.trim().length + '字符），分析结果可能不准确。'
          : '📷 此PDF可能是扫描件/图片型PDF，无法提取文本层。建议使用OCR工具转换后再试。',
        emptyText: true
      });
    }

    _notify('progress', { percent: 0, stage: 'starting' });

    var config = window.AIStore.getConfig();
    if (!config.enabled) {
      _notify('progress', { percent: 100, stage: 'done' });
      return Promise.resolve({
        summary: '',
        keywords: [],
        knowledgePoints: [],
        relations: [],
        wordCount: text.length,
        engine: 'none',
        error: '☁️ 请先配置云端 API，内置引擎已移除。\n\n点击侧边栏 ⚙️ 设置按钮进行配置。'
      });
    }

    _notify('progress', { percent: 10, stage: 'cloud', tokenEstimate: window.CloudAdapter.estimateTokens(text) });
    return window.CloudAdapter.summarize(text, config, function (p) { _notify('progress', p); })
      .then(function (result) {
        var data = {
          summary: result.summary,
          keywords: result.keywords || [],
          knowledgePoints: result.knowledgePoints || [],
          relations: result.relations || [],
          wordCount: text.length,
          engine: 'cloud',
          provider: config.provider,
          timestamp: Date.now()
        };
        window.AIStore.saveResult(normalizedUrl, data);
        _notify('progress', { percent: 100, stage: 'done' });
        _notify('result', { pdfUrl: normalizedUrl, data: data });
        return data;
      }).catch(function (err) {
        console.error('[AIWormhole] 云端API失败:', err.message);
        _notify('progress', { percent: 100, stage: 'done' });
        return {
          summary: '',
          keywords: [],
          knowledgePoints: [],
          relations: [],
          wordCount: text.length,
          engine: 'none',
          error: '☁️ API 请求失败: ' + (err.message || '未知错误') + '\n\n请检查网络连接和 API Key 配置。'
        };
      });
  }

  function _summarizeLocal(text, normalizedUrl) {
    return new Promise(function (resolve) {
      _notify('progress', { percent: 5, stage: 'local' });
      _sendToWorker('summarize', { text: text, maxLength: 200 }, function (result) {
        var data = {
          summary: result.summary,
          keywords: result.keywords || [],
          knowledgePoints: result.knowledgePoints || [],
          relations: result.relations || [],
          wordCount: text.length,
          engine: 'local',
          provider: 'built-in',
          timestamp: Date.now()
        };
        window.AIStore.saveResult(normalizedUrl, data);
        _notify('progress', { percent: 100, stage: 'done' });
        _notify('result', { pdfUrl: normalizedUrl, data: data });
        resolve(data);
      }, function (err) {
        console.warn('[AIWormhole] Worker失败，降级主线程:', err.message);
        try {
          var fallbackResult = _localSummarizeSync(text, 200);
          var data = {
            summary: fallbackResult.summary,
            keywords: fallbackResult.keywords || [],
            knowledgePoints: fallbackResult.knowledgePoints || [],
            relations: fallbackResult.relations || [],
            wordCount: text.length,
            engine: 'local',
            provider: 'built-in (fallback)',
            timestamp: Date.now()
          };
          window.AIStore.saveResult(normalizedUrl, data);
          _notify('progress', { percent: 100, stage: 'done' });
          _notify('result', { pdfUrl: normalizedUrl, data: data });
          resolve(data);
        } catch (e2) {
          resolve({
            summary: '处理失败，请重试',
            keywords: [],
            knowledgePoints: [],
            relations: [],
            wordCount: text.length,
            engine: 'none',
            error: e2.message,
            timestamp: Date.now()
          });
        }
      });
    });
  }

  // ==================== findConnections — 关联发现管线 ====================
  function findConnections(knowledgePoints, options) {
    options = options || {};
    var threshold = options.threshold !== undefined ? options.threshold : DEFAULT_THRESHOLD;
    var maxEdges  = options.maxEdges  || MAX_AI_EDGES;

    if (!knowledgePoints || knowledgePoints.length < 2) {
      return Promise.resolve([]);
    }

    var config = window.AIStore.getConfig();
    if (!config.enabled) {
      return Promise.resolve([]);
    }

    return window.CloudAdapter.findConnections(knowledgePoints, config, threshold, maxEdges)
      .catch(function (err) {
        console.error('[AIWormhole] 云端关联分析失败:', err.message);
        return [];
      });
  }

  function _localFindConnections(knowledgePoints, threshold, maxEdges) {
    return new Promise(function (resolve) {
      _notify('progress', { percent: 0, stage: 'connecting' });
      _sendToWorker('findConnections', { points: knowledgePoints, threshold: threshold, maxEdges: maxEdges }, function (edges) {
        var idEdges = window.AIEdges.mapToIds(edges, knowledgePoints);
        idEdges.forEach(function (e) {
          e.narrative = '🤖 AI 发现的深层关联';
          e.visualStrength = e.strength / 100;
          e.bidirectional = true;
          e.aiReason = e.reason || 'ai-inferred';
        });
        _notify('progress', { percent: 100, stage: 'done' });
        resolve(idEdges);
      }, function (err) {
        console.warn('[AIWormhole] Worker关联分析失败，降级主线程:', err.message);
        try {
          var fallbackEdges = _localFindConnectionsSync(knowledgePoints, threshold, maxEdges);
          var idFallback = window.AIEdges.mapToIds(fallbackEdges, knowledgePoints);
          idFallback.forEach(function (e) {
            e.narrative = '🤖 AI 发现的深层关联';
            e.visualStrength = e.strength / 100;
            e.bidirectional = true;
            e.aiReason = e.reason || 'ai-inferred';
          });
          resolve(idFallback);
        } catch (e2) {
          resolve([]);
        }
      });
    });
  }

  // ==================== Agent 管线：分析 + 自动比对 ====================
  function analyzePDFWithCompare(text, pdfUrl, existingKBPoints, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
      _notify('progress', { percent: 0, stage: 'extracting' });

      summarizePDF(text, pdfUrl, { forceEngine: options.forceEngine }).then(function (result) {
        if (result.error && result.emptyText) {
          resolve({ error: result.error, emptyText: true });
          return;
        }

        var newPoints = result.knowledgePoints || [];
        if (!newPoints.length) {
          resolve({
            summary: result.summary,
            keywords: result.keywords,
            newPoints: [],
            relations: result.relations,
            engine: result.engine,
            report: { duplicates: [], maybeDuplicates: [], newConnections: [], contradictions: [] }
          });
          return;
        }

        _notify('progress', { percent: 40, stage: 'comparing' });

        newPoints.forEach(function(p) {
          if (!p.id) p.id = 'kp_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
        });

        compareWithKB(newPoints, existingKBPoints || [], {
          dupThreshold: options.dupThreshold,
          maybeThreshold: options.maybeThreshold,
          connectThreshold: options.connectThreshold
        }).then(function (report) {
          _notify('progress', { percent: 90, stage: 'report' });
          resolve({
            summary: result.summary,
            keywords: result.keywords,
            newPoints: newPoints,
            relations: result.relations,
            engine: result.engine,
            report: report
          });
        }).catch(function (err) {
          console.warn('[AIWormhole] 比对失败，仅返回提取结果:', err.message);
          resolve({
            summary: result.summary,
            keywords: result.keywords,
            newPoints: newPoints,
            relations: result.relations,
            engine: result.engine,
            report: { duplicates: [], maybeDuplicates: [], newConnections: [], contradictions: [], error: err.message }
          });
        });
      }).catch(function (err) {
        reject(err);
      });
    });
  }

  // ==================== 结果存取（委托给 AIStore） ====================
  function getResults(pdfUrl) {
    return window.AIStore.getResults(pdfUrl);
  }

  function clearResults(pdfUrl) {
    window.AIStore.clearResults(pdfUrl);
  }

  function pruneOldResults(keepN) {
    return window.AIStore.pruneOldResults(keepN);
  }

  // ==================== AI连线管理（委托给 AIEdges） ====================
  function getAIEdges() {
    return window.AIEdges.getAll();
  }

  function addAIEdge(fromId, toId, strength, reason) {
    return window.AIEdges.addEdge(fromId, toId, strength, reason);
  }

  function addAIEdges(edges) {
    return window.AIEdges.addEdges(edges);
  }

  function removeAIEdges() {
    window.AIEdges.removeAll();
  }

  function removeAIEdge(fromId, toId) {
    window.AIEdges.removeEdge(fromId, toId);
  }

  function removeEdgesForPoint(kpId) {
    return window.AIEdges.removeForPoint(kpId);
  }

  // ==================== 事件系统 ====================
  function _notify(event, data) {
    (_listeners[event] || []).forEach(function (cb) {
      try { cb(data); } catch (e) { console.error('[AIWormhole] listener error:', e); }
    });
  }

  function onProgress(callback) {
    if (typeof callback !== 'function') return function () {};
    _listeners.progress.push(callback);
    return function () { _listeners.progress = _listeners.progress.filter(function (f) { return f !== callback; }); };
  }

  function onResult(callback) {
    if (typeof callback !== 'function') return function () {};
    _listeners.result.push(callback);
    return function () { _listeners.result = _listeners.result.filter(function (f) { return f !== callback; }); };
  }

  function onConfigChange(callback) {
    if (typeof callback !== 'function') return function () {};
    // 同时注册到 AIStore 的持久化配置变更
    var unsub = window.AIStore.onConfigChange(callback);
    _listeners.configChange.push(callback);
    return function () {
      unsub();
      _listeners.configChange = _listeners.configChange.filter(function (f) { return f !== callback; });
    };
  }

  // ==================== 比对 + 去重公共API ====================
  function compareWithKB(newPoints, existingPoints, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
      _notify('progress', { percent: 0, stage: 'comparing' });
      _sendToWorker('compare', {
        newPoints: newPoints,
        existingPoints: existingPoints,
        dupThreshold: options.dupThreshold,
        maybeThreshold: options.maybeThreshold,
        connectThreshold: options.connectThreshold
      }, function (result) {
        _notify('progress', { percent: 100, stage: 'done' });
        resolve(result);
      }, function (err) {
        reject(err);
      });
    });
  }

  function dedupCheck(candidate, existing, threshold) {
    return new Promise(function (resolve, reject) {
      _sendToWorker('dedupCheck', {
        candidate: candidate,
        existing: existing,
        threshold: threshold
      }, function (result) {
        resolve(result);
      }, function (err) {
        reject(err);
      });
    });
  }

  // ==================== 暴露全局API（保持不变） ====================
  window.AIWormhole = {
    init: init,
    getConfig: getConfig,
    saveConfig: saveConfig,
    testConnection: testConnection,
    summarizePDF: summarizePDF,
    findConnections: findConnections,
    analyzePDFWithCompare: analyzePDFWithCompare,
    compareWithKB: compareWithKB,
    dedupCheck: dedupCheck,
    getResults: getResults,
    clearResults: clearResults,
    pruneOldResults: pruneOldResults,
    getAIEdges: getAIEdges,
    addAIEdge: addAIEdge,
    addAIEdges: addAIEdges,
    removeAIEdges: removeAIEdges,
    removeEdgesForPoint: removeEdgesForPoint,
    removeAIEdge: removeAIEdge,
    onProgress: onProgress,
    onResult: onResult,
    onConfigChange: onConfigChange,
    normalizePdfUrl: normalizePdfUrl,
    estimateTokens: window.CloudAdapter.estimateTokens,
    // 常量
    DEFAULT_THRESHOLD: DEFAULT_THRESHOLD,
    MAX_AI_EDGES: MAX_AI_EDGES,
    PROVIDER_PRESETS: window.AIStore.PROVIDER_PRESETS
  };

  // 自动初始化
  init().then(function () {
    var config = window.AIStore.getConfig();
    console.log('[AIWormhole] 引擎已就绪。云端API:', config.enabled ? '已配置 (' + config.provider + ')' : '未配置，请在设置中配置 API Key');
  });

})();
