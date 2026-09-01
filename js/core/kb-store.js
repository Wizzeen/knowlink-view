// ====================================================================
//  KnowLink 知识星系 — 统一知识库数据层 (kb-store.js)
//  所有 KB CRUD 的唯一数据源，同时支持主线程 (<script> → self.KBStore)
//  和 Service Worker (importScripts → self.KBStore)
//
//  替代分散在 background.js / sidepanel.js / network.js 中的 15+ 处
//  chrome.storage.local.get/set 调用
// ====================================================================

(function () {
  'use strict';

  // ==================== 常量 ====================
  var STORAGE_KEY_KBS      = 'knowledgeBases';
  var STORAGE_KEY_ACTIVE   = 'activeKnowledgeBaseId';
  var STORAGE_KEY_SETTINGS = 'knowlinkSettings';
  var STORAGE_KEY_POINTS   = 'knowledgePoints';  // 旧版（迁移用）
  var DEFAULT_KB_ID        = 'kb_default';
  var DEFAULT_KB_NAME      = '默认知识库';
  var DEFAULT_MAX_ITEMS    = 200;

  // ==================== 内部状态 ====================
  var _kbs           = [];       // KB[]
  var _activeKBId    = null;     // string
  var _settings      = { maxItems: DEFAULT_MAX_ITEMS };
  var _initialized   = false;
  var _listeners     = [];       // onChange callbacks

  // KB 结构: { id, name, createdAt, updatedAt, knowledgePoints: Point[] }
  // Point 结构: { id, text, url, source, timestamp, ... }

  // ==================== ID 工具 ====================
  function _generateKpId() {
    var ts = Date.now().toString(36);
    var rnd = Math.random().toString(36).substring(2, 6);
    return 'kp-' + ts + '-' + rnd;
  }

  function _ensureKpId(point) {
    if (!point.id) point.id = _generateKpId();
    return point;
  }

  // ==================== 初始化（加载 + 迁移） ====================
  function init() {
    if (_initialized) return Promise.resolve();

    return new Promise(function (resolve) {
      var keys = [STORAGE_KEY_KBS, STORAGE_KEY_ACTIVE, STORAGE_KEY_SETTINGS, STORAGE_KEY_POINTS];
      chrome.storage.local.get(keys, function (result) {
        var settings = result[STORAGE_KEY_SETTINGS] || {};
        _settings.maxItems = settings.maxItems || DEFAULT_MAX_ITEMS;

        var legacyPoints = result[STORAGE_KEY_POINTS] || [];
        var kbs = result[STORAGE_KEY_KBS] || [];
        var activeId = result[STORAGE_KEY_ACTIVE] || null;

        // 迁移：旧版 knowledgePoints → knowledgeBases
        if (legacyPoints.length > 0 && kbs.length === 0) {
          console.log('[KBStore] 开始旧数据迁移，共 ' + legacyPoints.length + ' 条');
          kbs = [{
            id: DEFAULT_KB_ID,
            name: DEFAULT_KB_NAME,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            knowledgePoints: legacyPoints
          }];
          activeId = DEFAULT_KB_ID;

          var setData = {};
          setData[STORAGE_KEY_KBS] = kbs;
          setData[STORAGE_KEY_ACTIVE] = activeId;
          chrome.storage.local.set(setData, function () {
            chrome.storage.local.remove(STORAGE_KEY_POINTS, function () {
              console.log('[KBStore] 迁移完成，旧 key 已清理');
            });
          });
        }

        // 确保至少有一个 KB
        if (!kbs.length) {
          kbs = [{
            id: DEFAULT_KB_ID,
            name: DEFAULT_KB_NAME,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            knowledgePoints: []
          }];
          activeId = DEFAULT_KB_ID;
        }

        // 确保 activeId 有效
        if (!activeId || !kbs.find(function (k) { return k.id === activeId; })) {
          activeId = kbs[0].id;
        }

        _kbs = kbs;
        _activeKBId = activeId;
        _initialized = true;

        console.log('[KBStore] 已初始化: ' + _kbs.length + ' 个知识库, 活跃: ' + _activeKBId);
        resolve();
      });
    });
  }

  // ==================== 查询 ====================
  function getKBs() {
    return _kbs.map(function (k) { return JSON.parse(JSON.stringify(k)); });
  }

  function getActiveKBId() {
    return _activeKBId;
  }

  function getActiveKB() {
    var kb = _kbs.find(function (k) { return k.id === _activeKBId; });
    return kb ? JSON.parse(JSON.stringify(kb)) : null;
  }

  function getPoints(kbId) {
    kbId = kbId || _activeKBId;
    var kb = _kbs.find(function (k) { return k.id === kbId; });
    return kb ? (kb.knowledgePoints || []).slice() : [];
  }

  function getSettings() {
    return JSON.parse(JSON.stringify(_settings));
  }

  // ==================== KB CRUD ====================
  function createKB(name) {
    return new Promise(function (resolve, reject) {
      if (!name || !name.trim()) {
        reject(new Error('知识库名称不能为空'));
        return;
      }
      var newKB = {
        id: 'kb_' + Date.now(),
        name: name.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        knowledgePoints: []
      };
      _kbs.push(newKB);
      _activeKBId = newKB.id;
      _persist(resolve, reject);
    });
  }

  function renameKB(kbId, newName) {
    return new Promise(function (resolve, reject) {
      if (!kbId || !newName || !newName.trim()) {
        reject(new Error('参数不完整'));
        return;
      }
      var kb = _kbs.find(function (k) { return k.id === kbId; });
      if (!kb) {
        reject(new Error('未找到该知识库'));
        return;
      }
      kb.name = newName.trim();
      kb.updatedAt = Date.now();
      _persist(resolve, reject);
    });
  }

  function deleteKB(kbId) {
    return new Promise(function (resolve, reject) {
      if (_kbs.length <= 1) {
        reject(new Error('至少需要保留一个知识库'));
        return;
      }
      var deletedKB = _kbs.find(function (k) { return k.id === kbId; });
      if (!deletedKB) {
        reject(new Error('未找到该知识库'));
        return;
      }

      // 收集被删除知识点的 ID
      var deletedPointIds = (deletedKB.knowledgePoints || [])
        .map(function (p) { return p.id; })
        .filter(function (id) { return !!id; });

      _kbs = _kbs.filter(function (k) { return k.id !== kbId; });

      // 如果删除的是当前活跃 KB，切换到第一个
      var newActiveId = _activeKBId;
      if (_activeKBId === kbId) {
        newActiveId = _kbs.length > 0 ? _kbs[0].id : DEFAULT_KB_ID;
        _activeKBId = newActiveId;
      }

      _persist(function () {
        resolve({ newActiveId: newActiveId, deletedPointIds: deletedPointIds });
      }, reject);
    });
  }

  function setActiveKB(kbId) {
    return new Promise(function (resolve, reject) {
      var kb = _kbs.find(function (k) { return k.id === kbId; });
      if (!kb) {
        reject(new Error('未找到该知识库'));
        return;
      }
      _activeKBId = kbId;
      _persist(resolve, reject);
    });
  }

  // ==================== Point CRUD ====================
  // 简单去重：检查 id 或完全相同的 text+url
  function _isExactDuplicate(point, existingPoints) {
    var normUrl = _normalizeUrl(point.url);
    return existingPoints.some(function (p) {
      if (p.id && point.id && p.id === point.id) return true;
      if (p.text === point.text && _normalizeUrl(p.url) === normUrl) return true;
      return false;
    });
  }

  function _normalizeUrl(url) {
    // 统一实现：utils.js 的 normalizeUrlForDedup（background 需先加载 utils.js）
    if (typeof normalizeUrlForDedup === 'function') return normalizeUrlForDedup(url);
    if (!url) return '';
    return url.replace(/^(file:\/\/\/|https?:\/\/|chrome-extension:\/\/[^/]+\/\?)/i, '')
      .split('?')[0].split('#')[0].toLowerCase();
  }

  function addPoint(point, kbId) {
    kbId = kbId || _activeKBId;
    return new Promise(function (resolve, reject) {
      var kb = _kbs.find(function (k) { return k.id === kbId; });
      if (!kb) {
        reject(new Error('知识库不存在: ' + kbId));
        return;
      }

      _ensureKpId(point);
      var points = kb.knowledgePoints || [];

      // 精确实体去重
      if (_isExactDuplicate(point, points)) {
        console.log('[KBStore] 精确定义重复，已跳过 (id=' + point.id + ')');
        resolve({ added: false, isDuplicate: true });
        return;
      }

      points.unshift(point);
      kb.knowledgePoints = points;
      kb.updatedAt = Date.now();

      // 容量限制
      var maxItems = _settings.maxItems || DEFAULT_MAX_ITEMS;
      if (points.length > maxItems) {
        var removed = points.splice(maxItems);
        console.log('[KBStore] 容量超限，已裁剪 ' + removed.length + ' 条旧知识点');
      }

      _persist(function () {
        console.log('[KBStore] 已添加知识点到「' + kb.name + '」，共 ' + points.length + ' 条');
        resolve({ added: true, isDuplicate: false });
      }, reject);
    });
  }

  function replacePoints(points, kbId) {
    kbId = kbId || _activeKBId;
    return new Promise(function (resolve, reject) {
      var kb = _kbs.find(function (k) { return k.id === kbId; });
      if (!kb) {
        reject(new Error('知识库不存在: ' + kbId));
        return;
      }
      points.forEach(function (p) { _ensureKpId(p); });
      kb.knowledgePoints = points.slice();
      kb.updatedAt = Date.now();
      _persist(resolve, reject);
    });
  }

  function removePoint(pointId, kbId) {
    kbId = kbId || _activeKBId;
    return new Promise(function (resolve, reject) {
      var kb = _kbs.find(function (k) { return k.id === kbId; });
      if (!kb) {
        reject(new Error('知识库不存在: ' + kbId));
        return;
      }
      var before = (kb.knowledgePoints || []).length;
      kb.knowledgePoints = (kb.knowledgePoints || []).filter(function (p) { return p.id !== pointId; });
      kb.updatedAt = Date.now();

      if (kb.knowledgePoints.length === before) {
        resolve({ removed: 0 });
        return;
      }
      _persist(function () {
        resolve({ removed: before - kb.knowledgePoints.length });
      }, reject);
    });
  }

  function updatePoint(pointId, updates, kbId) {
    kbId = kbId || _activeKBId;
    return new Promise(function (resolve, reject) {
      var kb = _kbs.find(function (k) { return k.id === kbId; });
      if (!kb) {
        reject(new Error('知识库不存在: ' + kbId));
        return;
      }
      var points = kb.knowledgePoints || [];
      var pt = points.find(function (p) { return p.id === pointId; });
      if (!pt) {
        resolve({ updated: false });
        return;
      }
      Object.keys(updates).forEach(function (key) {
        pt[key] = updates[key];
      });
      kb.updatedAt = Date.now();
      _persist(function () {
        resolve({ updated: true });
      }, reject);
    });
  }

  function clearPoints(kbId) {
    kbId = kbId || _activeKBId;
    return new Promise(function (resolve, reject) {
      var kb = _kbs.find(function (k) { return k.id === kbId; });
      if (!kb) {
        reject(new Error('知识库不存在: ' + kbId));
        return;
      }
      kb.knowledgePoints = [];
      kb.updatedAt = Date.now();
      _persist(resolve, reject);
    });
  }

  // ==================== Settings ====================
  function updateSettings(newSettings) {
    return new Promise(function (resolve, reject) {
      _settings = Object.assign({}, _settings, newSettings);
      var setData = {};
      setData[STORAGE_KEY_SETTINGS] = _settings;
      chrome.storage.local.set(setData, function () {
        console.log('[KBStore] 设置已更新: maxItems=' + _settings.maxItems);
        resolve();
      });
    });
  }

  // ==================== 持久化 + 广播 ====================
  function _persist(resolve, reject) {
    var setData = {};
    setData[STORAGE_KEY_KBS] = _kbs;
    setData[STORAGE_KEY_ACTIVE] = _activeKBId;
    chrome.storage.local.set(setData, function () {
      if (chrome.runtime.lastError) {
        console.error('[KBStore] 存储失败:', chrome.runtime.lastError);
        if (reject) reject(chrome.runtime.lastError);
      } else {
        // 广播变更（同步到其他视图）
        var activeKB = _kbs.find(function (k) { return k.id === _activeKBId; });
        try {
          chrome.runtime.sendMessage({
            type: 'KB_STORE_CHANGED',
            kbCount: _kbs.length,
            activeKBId: _activeKBId,
            pointCount: activeKB ? (activeKB.knowledgePoints || []).length : 0
          });
        } catch (e) { /* 接收方未打开，忽略 */ }

        // 通知本地监听器
        _listeners.forEach(function (cb) {
          try { cb(); } catch (e) {}
        });

        if (resolve) resolve();
      }
    });
  }

  // ==================== 变更订阅 ====================
  function onChange(callback) {
    if (typeof callback !== 'function') return function () {};
    _listeners.push(callback);
    return function () {
      _listeners = _listeners.filter(function (f) { return f !== callback; });
    };
  }

  // ==================== 导出 ====================
  self.KBStore = {
    init: init,
    getKBs: getKBs,
    getActiveKBId: getActiveKBId,
    getActiveKB: getActiveKB,
    getPoints: getPoints,
    getSettings: getSettings,

    createKB: createKB,
    renameKB: renameKB,
    deleteKB: deleteKB,
    setActiveKB: setActiveKB,

    addPoint: addPoint,
    removePoint: removePoint,
    updatePoint: updatePoint,
    replacePoints: replacePoints,
    clearPoints: clearPoints,
    updateSettings: updateSettings,

    onChange: onChange,

    // 工具函数
    ensureKpId: _ensureKpId,
    generateKpId: _generateKpId,

    // 常量
    DEFAULT_KB_ID: DEFAULT_KB_ID,
    DEFAULT_KB_NAME: DEFAULT_KB_NAME
  };

})();
