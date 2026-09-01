// ====================================================================
//  KnowLink 知识星系 — 星系引擎入口 (knowlink-engine.js)
//  由 sidepanel.js 和 network.html 共同加载
//  职责：AI 连线管理 API (window.KnowLinkAI)、模块编排
//  图计算/布局 → knowlink-layout.js
//  Canvas 2D 渲染  → knowlink-renderer.js
// ====================================================================

// ====================================================================
//  AI 双链拓展接口 (window.KnowLinkAI) — 增强版
//  集成AIWormhole持久化存储 + 连接密度控制 + 相关性过滤 (漏洞5)
// ====================================================================
window.KnowLinkAI = (function () {
  var _aiEdges = [];
  var _listeners = [];

  // 漏洞5: 连接密度控制
  var _connectionThreshold = 0.4;  // 默认相关性阈值
  var _maxVisibleEdges    = 35;    // 绝对上限
  var _showAllAIEdges     = true;  // 是否显示AI连线

  function _normalize() {
    // 从AIWormhole同步持久化连线
    if (window.AIWormhole && typeof window.AIWormhole.getAIEdges === 'function') {
      var persisted = window.AIWormhole.getAIEdges();
      // 合并: 保留本地有而持久化没有的（可能是刚添加的），覆盖持久化有的
      // 修复: 用规范化 key（from/to 排序）去重，替代双向 key + 引用去重的脆弱模式
      function keyOf(e) {
        var a = String(e.from), b = String(e.to);
        return a < b ? a + '|' + b : b + '|' + a;
      }
      var merged = {};
      persisted.forEach(function(e) { merged[keyOf(e)] = e; });
      _aiEdges.forEach(function(e) { merged[keyOf(e)] = e; }); // 本地优先覆盖
      _aiEdges = Object.keys(merged).map(function(k) { return merged[k]; });
    }
  }

  function _notify() {
    if (typeof getGraphData !== 'function') return;
    var d = getGraphData();
    _listeners.forEach(function(cb) { try { cb(d); } catch(e) { console.error(e); } });
  }

  function getGraphData() {
    var gn = (typeof graphNodes !== 'undefined') ? graphNodes : [];
    var ge = (typeof graphEdges !== 'undefined') ? graphEdges : [];
    var kp = (typeof knowledgePoints !== 'undefined') ? knowledgePoints : [];

    // 将数组下标解析为稳定 ID
    function resolveId(idx) {
      if (typeof idx === 'number' && idx < kp.length) {
        return kp[idx].id || ('_idx_' + idx);
      }
      return idx; // 可能已经是字符串 ID
    }

    return {
      nodes: gn.map(function(n) { return { id: n.id, label: n.fullText, source: n.source, url: n.url }; }),
      nativeEdges: ge.map(function(e) { return { from: resolveId(e.from), to: resolveId(e.to), strength:e.strength, reason:e.reason, bidirectional:true }; }),
      aiEdges: _aiEdges.map(function(e) { return { from:e.from, to:e.to, strength:e.strength, reason:e.aiReason||'ai-inferred', bidirectional:true }; }),
      allEdges: ge.concat(_aiEdges).map(function(e) {
        return { from: resolveId(e.from), to: resolveId(e.to), strength:e.strength, reason: e.reason || e.aiReason || 'ai-inferred' };
      })
    };
  }

  function _rereder() {
    if (typeof renderGraph === 'function') renderGraph();
  }

  return {
    // ---- 基本连线操作（使用稳定 ID）----
    addEdge: function(fromId, toId, strength, reason) {
      reason = reason || 'ai-inferred';
      if (!fromId || !toId || fromId === toId) return false;
      // 去重检查（使用稳定 ID）
      var gn = (typeof graphEdges !== 'undefined') ? graphEdges : [];
      var dup = gn.concat(_aiEdges).some(function(e) {
        return (e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId);
      });
      if (dup) return false;
      var edge = {
        id: 'ai-' + fromId + '-' + toId + '-' + Date.now(), from: fromId, to: toId,
        strength: Math.min(100, Math.max(0, strength)),
        reason: 'ai-inferred',
        narrative: '🤖 AI 发现的深层关联',
        visualStrength: strength / 100,
        aiReason: reason, bidirectional: true
      };
      _aiEdges.push(edge);

      // 同步到AIWormhole持久化
      if (window.AIWormhole && typeof window.AIWormhole.addAIEdge === 'function') {
        window.AIWormhole.addAIEdge(fromId, toId, strength, reason);
      }

      _rereder();
      _notify();
      return true;
    },

    addEdges: function(edges) {
      if (!Array.isArray(edges)) return 0;
      var self = this;
      var added = 0;
      edges.forEach(function(e) { if (self.addEdge(e.from, e.to, e.strength, e.reason || 'ai-inferred')) added++; });
      return added;
    },

    removeAIEdges: function() {
      _aiEdges = [];
      if (window.AIWormhole && typeof window.AIWormhole.removeAIEdges === 'function') {
        window.AIWormhole.removeAIEdges();
      }
      _rereder();
      _notify();
    },

    removeAIEdge: function(fromId, toId) {
      _aiEdges = _aiEdges.filter(function(e) {
        return !((e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId));
      });
      if (window.AIWormhole && typeof window.AIWormhole.removeAIEdge === 'function') {
        window.AIWormhole.removeAIEdge(fromId, toId);
      }
      _rereder();
      _notify();
    },

    // 清理引用指定知识点的所有 AI 连线（孤边清理）
    removeEdgesForPoint: function(kpId) {
      if (!kpId) return 0;
      var removedCount = 0;
      _aiEdges = _aiEdges.filter(function(e) {
        if (e.from === kpId || e.to === kpId) {
          removedCount++;
          return false;
        }
        return true;
      });
      if (removedCount > 0) {
        // 同步到持久化存储
        if (window.AIWormhole && typeof window.AIWormhole.removeAIEdges === 'function') {
          // 逐个删除命中的连线
          // AIWormhole 没有批量 removeByPoint，用内部方法清理
          var remaining = _aiEdges.slice();
          window.AIWormhole.removeAIEdges();
          remaining.forEach(function(e) {
            window.AIWormhole.addAIEdge(e.from, e.to, e.strength, e.aiReason || e.reason);
          });
        }
        console.log('[KnowLinkAI] 清理知识点 ' + kpId + ' 的孤边: ' + removedCount + ' 条');
        _rereder();
        _notify();
      }
      return removedCount;
    },

    // ---- 连接密度控制 (漏洞5) ----
    setConnectionThreshold: function(threshold) {
      _connectionThreshold = Math.max(0, Math.min(1, threshold));
      _rereder();
    },

    getConnectionThreshold: function() {
      return _connectionThreshold;
    },

    setMaxVisibleEdges: function(max) {
      _maxVisibleEdges = Math.max(0, Math.min(50, max));
      _rereder();
    },

    getMaxVisibleEdges: function() {
      return _maxVisibleEdges;
    },

    setShowAIEdges: function(show) {
      _showAllAIEdges = !!show;
      _rereder();
    },

    getShowAIEdges: function() {
      return _showAllAIEdges;
    },

    // 获取过滤后的AI连线 (漏洞5: 阈值过滤 + 上限截断)
    getFilteredAIEdges: function() {
      if (!_showAllAIEdges) return [];

      var filtered = _aiEdges.filter(function(e) {
        return (e.visualStrength || e.strength / 100) >= _connectionThreshold;
      });

      // 按strength降序
      filtered.sort(function(a, b) { return b.strength - a.strength; });

      // 绝对上限
      if (filtered.length > _maxVisibleEdges) {
        filtered = filtered.slice(0, _maxVisibleEdges);
      }

      return filtered;
    },

    // 获取连接统计 (用于UI显示)
    getConnectionStats: function() {
      var total = _aiEdges.length;
      var visible = this.getFilteredAIEdges().length;
      var byStrength = { high: 0, medium: 0, low: 0 };
      _aiEdges.forEach(function(e) {
        var s = e.strength;
        if (s >= 70) byStrength.high++;
        else if (s >= 40) byStrength.medium++;
        else byStrength.low++;
      });
      return {
        total: total,
        visible: visible,
        threshold: _connectionThreshold,
        maxVisible: _maxVisibleEdges,
        showAll: _showAllAIEdges,
        byStrength: byStrength,
        warning: visible > 30 ? '连接过多（' + visible + '条），建议提高阈值' : null
      };
    },

    // ---- 数据接口 ----
    getGraphData: getGraphData,

    getKnowledgePoints: function() {
      var kp = (typeof knowledgePoints !== 'undefined') ? knowledgePoints : [];
      return kp.map(function(p) { return Object.assign({}, p); });
    },

    onGraphChange: function(cb) {
      if (typeof cb !== 'function') return function() {};
      _listeners.push(cb);
      return function() { _listeners = _listeners.filter(function(f) { return f !== cb; }); };
    },

    refresh: function() {
      _normalize(); // 同步持久化连线
      if (typeof buildGraph === 'function') buildGraph();
      _rereder();
    },

    // 初始化: 从AIWormhole恢复持久化连线
    initFromWormhole: function() {
      if (window.AIWormhole && typeof window.AIWormhole.getAIEdges === 'function') {
        var persisted = window.AIWormhole.getAIEdges();
        if (persisted.length > 0) {
          // 去重合并
          var existing = {};
          _aiEdges.forEach(function(e) { existing[e.from + '-' + e.to] = true; existing[e.to + '-' + e.from] = true; });
          persisted.forEach(function(e) {
            if (!existing[e.from + '-' + e.to] && !existing[e.to + '-' + e.from]) {
              _aiEdges.push(e);
            }
          });
          _rereder();
        }
      }
    },

    _normalize: function() {
      _normalize();
    },

    _getAIEdges: function() {
      // 返回过滤后的AI连线（给渲染器使用）
      return this.getFilteredAIEdges();
    },

    _getAllAIEdges: function() {
      return _aiEdges.slice();
    }
  };
})();

// resolveRealUrl / navigateToSource 已移至 utils.js 共享
