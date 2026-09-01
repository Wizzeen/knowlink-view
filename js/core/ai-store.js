// ====================================================================
//  KnowLink 知识星系 — AI 持久化层 (ai-store.js)
//  统一管理 chrome.storage：配置、分析结果、AI 连线
// ====================================================================

(function () {
  'use strict';

  var STORAGE_KEY_CONFIG  = 'aiConfig';
  var STORAGE_KEY_RESULTS = 'aiResults';
  var STORAGE_KEY_EDGES   = 'aiEdges';
  var MAX_RESULTS         = 20;

  // ==================== 内部状态 ====================
  var _config  = null;
  var _results = {};      // { [normalizedUrl]: {summary, keywords, ...} }
  var _edges   = [];      // 持久化AI连线
  var _configListeners = [];

  // 默认配置（从 ai-config.js 读取）
  var _aiCfg = (window.AIConfig && window.AIConfig.DEFAULT_CONFIG)
    ? window.AIConfig.DEFAULT_CONFIG
    : { provider: 'custom', apiKey: '', endpoint: '', model: '', enabled: false };

  var DEFAULT_CONFIG = {
    provider: _aiCfg.provider,
    apiKey: _aiCfg.apiKey,
    endpoint: _aiCfg.endpoint,
    model: _aiCfg.model,
    enabled: _aiCfg.enabled
  };

  var PROVIDER_PRESETS = (window.AIConfig && window.AIConfig.PROVIDER_PRESETS)
    ? window.AIConfig.PROVIDER_PRESETS
    : {};

  // ==================== 初始化（从 chrome.storage 加载） ====================
  function init() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([STORAGE_KEY_CONFIG, STORAGE_KEY_RESULTS, STORAGE_KEY_EDGES], function (data) {
          _config  = data[STORAGE_KEY_CONFIG]  || JSON.parse(JSON.stringify(DEFAULT_CONFIG));
          _results = data[STORAGE_KEY_RESULTS] || {};
          _edges   = data[STORAGE_KEY_EDGES]   || [];
          resolve();
        });
      } catch (e) {
        _config  = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        _results = {};
        _edges   = [];
        resolve();
      }
    });
  }

  // ==================== 配置 ====================
  function getConfig() {
    return JSON.parse(JSON.stringify(_config));
  }

  function saveConfig(newConfig) {
    return new Promise(function (resolve) {
      _config = Object.assign({}, _config, newConfig);
      if (_config.provider && PROVIDER_PRESETS[_config.provider]) {
        var preset = PROVIDER_PRESETS[_config.provider];
        if (!_config.endpoint) _config.endpoint = preset.endpoint;
        if (!_config.model) _config.model = preset.model;
      }
      _config.enabled = !!(_config.apiKey && _config.endpoint);

      var saveObj = {};
      saveObj[STORAGE_KEY_CONFIG] = _config;
      chrome.storage.local.set(saveObj, function () {
        // 通知所有配置监听器
        _configListeners.forEach(function (cb) {
          try { cb(_config); } catch (e) {}
        });
        resolve();
      });
    });
  }

  function onConfigChange(callback) {
    if (typeof callback !== 'function') return function () {};
    _configListeners.push(callback);
    return function () {
      _configListeners = _configListeners.filter(function (f) { return f !== callback; });
    };
  }

  // ==================== 分析结果（带自动裁剪） ====================
  function getResults(pdfUrl) {
    if (pdfUrl) {
      return _results[pdfUrl] || null;
    }
    return JSON.parse(JSON.stringify(_results));
  }

  function saveResult(normalizedUrl, data) {
    _results[normalizedUrl] = data;

    // 超出上限时自动裁剪最旧的条目
    var urls = Object.keys(_results);
    if (urls.length > MAX_RESULTS) {
      urls.sort(function (a, b) {
        var ta = (_results[a] && _results[a].timestamp) || 0;
        var tb = (_results[b] && _results[b].timestamp) || 0;
        return ta - tb;
      });
      var toRemove = urls.slice(0, urls.length - MAX_RESULTS);
      toRemove.forEach(function (url) { delete _results[url]; });
      console.log('[AIStore] 结果缓存已裁剪，移除 ' + toRemove.length + ' 条旧记录（保留 ' + MAX_RESULTS + ' 条）');
    }

    var saveObj = {};
    saveObj[STORAGE_KEY_RESULTS] = _results;
    try {
      chrome.storage.local.set(saveObj, function () {
        try {
          chrome.runtime.sendMessage({ type: 'AI_RESULT_UPDATED', pdfUrl: normalizedUrl });
        } catch (e) {}
      });
    } catch (e) {}
  }

  function clearResults(pdfUrl) {
    if (pdfUrl) {
      delete _results[pdfUrl];
    } else {
      _results = {};
    }
    try {
      var saveObj = {};
      saveObj[STORAGE_KEY_RESULTS] = _results;
      chrome.storage.local.set(saveObj);
    } catch (e) {}
  }

  function pruneOldResults(keepN) {
    keepN = keepN || MAX_RESULTS;
    var urls = Object.keys(_results);
    if (urls.length <= keepN) return 0;

    urls.sort(function (a, b) {
      var ta = (_results[a] && _results[a].timestamp) || 0;
      var tb = (_results[b] && _results[b].timestamp) || 0;
      return ta - tb;
    });
    var toRemove = urls.slice(0, urls.length - keepN);
    toRemove.forEach(function (url) { delete _results[url]; });

    var saveObj = {};
    saveObj[STORAGE_KEY_RESULTS] = _results;
    try { chrome.storage.local.set(saveObj); } catch (e) {}

    console.log('[AIStore] 手动清理: 移除 ' + toRemove.length + ' 条旧结果');
    return toRemove.length;
  }

  // ==================== AI 连线持久化 ====================
  function getEdges() {
    return _edges.slice();
  }

  function saveEdges(edges) {
    _edges = edges;
    var saveObj = {};
    saveObj[STORAGE_KEY_EDGES] = _edges;
    try {
      chrome.storage.local.set(saveObj, function () {
        try {
          chrome.runtime.sendMessage({ type: 'AI_EDGES_UPDATED', count: _edges.length });
        } catch (e) {}
      });
    } catch (e) {}
  }

  // ==================== 导出 ====================
  window.AIStore = {
    init: init,
    getConfig: getConfig,
    saveConfig: saveConfig,
    onConfigChange: onConfigChange,
    getResults: getResults,
    saveResult: saveResult,
    clearResults: clearResults,
    pruneOldResults: pruneOldResults,
    getEdges: getEdges,
    saveEdges: saveEdges,
    // 常量
    PROVIDER_PRESETS: PROVIDER_PRESETS
  };

})();
