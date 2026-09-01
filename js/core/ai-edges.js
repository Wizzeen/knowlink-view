// ====================================================================
//  KnowLink 知识星系 — AI 连线管理器 (ai-edges.js)
//  管理 AI 连线的 CRUD、双向去重、孤边清理、ID 映射
//  依赖 AIStore 进行持久化
// ====================================================================

(function () {
  'use strict';

  var _edges = [];

  // ==================== 初始化（从 AIStore 加载） ====================
  function init() {
    _edges = window.AIStore.getEdges();
  }

  // ==================== 查询 ====================
  function getAll() {
    return _edges.slice();
  }

  // ==================== 单条添加（双向去重） ====================
  function addEdge(fromId, toId, strength, reason) {
    if (fromId === toId) return false;

    var exists = _edges.some(function (e) {
      return (e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId);
    });
    if (exists) return false;

    _edges.push({
      id: 'ai-' + fromId + '-' + toId + '-' + Date.now(),
      from: fromId, to: toId,
      strength: Math.min(100, Math.max(0, strength || 50)),
      reason: 'ai-inferred',
      narrative: '🤖 AI 发现的深层关联',
      visualStrength: (strength || 50) / 100,
      aiReason: reason || 'ai-inferred',
      bidirectional: true
    });

    _persist();
    return true;
  }

  // ==================== 批量添加 ====================
  function addEdges(edges) {
    if (!Array.isArray(edges)) return 0;
    var added = 0;
    var self = this;
    edges.forEach(function (e) {
      if (addEdge(e.from, e.to, e.strength, e.reason)) added++;
    });
    return added;
  }

  // ==================== 删除 ====================
  function removeAll() {
    _edges = [];
    _persist();
  }

  function removeEdge(fromId, toId) {
    _edges = _edges.filter(function (e) {
      return !((e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId));
    });
    _persist();
  }

  // 清理引用指定知识点的所有连线（孤边清理）
  function removeForPoint(kpId) {
    if (!kpId) return 0;
    var before = _edges.length;
    _edges = _edges.filter(function (e) {
      return e.from !== kpId && e.to !== kpId;
    });
    var removed = before - _edges.length;
    if (removed > 0) {
      _persist();
      console.log('[AIEdges] 孤边清理: 移除引用 ' + kpId + ' 的 ' + removed + ' 条连线');
    }
    return removed;
  }

  function _persist() {
    window.AIStore.saveEdges(_edges.slice());
  }

  // ==================== ID 映射（下标 → 稳定 ID） ====================
  function mapToIds(edges, knowledgePoints) {
    var result = [];
    edges.forEach(function (e) {
      var fromId, toId;
      if (typeof e.from === 'number' && e.from < knowledgePoints.length) {
        fromId = knowledgePoints[e.from].id || ('_idx_' + e.from);
      } else {
        fromId = e.from;
      }
      if (typeof e.to === 'number' && e.to < knowledgePoints.length) {
        toId = knowledgePoints[e.to].id || ('_idx_' + e.to);
      } else {
        toId = e.to;
      }
      result.push({
        from: fromId, to: toId,
        strength: e.strength,
        reason: e.reason || 'ai-inferred'
      });
    });
    return result;
  }

  // ==================== 导出 ====================
  window.AIEdges = {
    init: init,
    getAll: getAll,
    addEdge: addEdge,
    addEdges: addEdges,
    removeAll: removeAll,
    removeEdge: removeEdge,
    removeForPoint: removeForPoint,
    mapToIds: mapToIds
  };

})();
