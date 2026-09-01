// ====================================================================
//  KnowLink 知识星系 — AI Worker (ai-worker.js)
//  在独立线程中执行TF-IDF/TextRank计算，避免主线程阻塞 (漏洞2)
//  无DOM访问，无chrome API，纯计算
//  NLP 实现统一在 nlp-engine.js，Worker 通过 importScripts 加载
// ====================================================================

importScripts('nlp-engine.js');
// self.NLP 现在可用

(function () {
  'use strict';

  // ==================== 常量 ====================
  var MAX_AI_EDGES = 35;  // AI 连线上限（与 ai-wormhole.js 保持一致）

  // ==================== 消息处理 ====================
  self.onmessage = function (e) {
    var msg = e.data;
    var id = msg.id;
    var type = msg.type;
    var data = msg.data;

    try {
      if (type === 'summarize') {
        handleSummarize(id, data);
      } else if (type === 'findConnections') {
        handleFindConnections(id, data);
      } else if (type === 'compare') {
        handleCompare(id, data);
      } else if (type === 'dedupCheck') {
        handleDedupCheck(id, data);
      } else {
        postError(id, 'Unknown type: ' + type);
      }
    } catch (err) {
      postError(id, err.message);
    }
  };

  function postProgress(percent, stage) {
    self.postMessage({ type: 'progress', percent: percent, stage: stage || '' });
  }

  function postResult(id, data) {
    self.postMessage({ type: 'result', id: id, data: data });
  }

  function postError(id, message) {
    self.postMessage({ type: 'error', id: id, message: message });
  }

  // ==================== 摘要处理 ====================
  function handleSummarize(id, data) {
    var text = data.text || '';
    var maxLength = data.maxLength || 200;

    postProgress(10, 'tokenizing');
    postProgress(25, 'tfidf');
    postProgress(50, 'textrank');

    var result = self.NLP.summarize(text, maxLength);

    postProgress(85, 'knowledge-points');
    postProgress(100, 'done');

    postResult(id, result);
  }

  // ==================== 关联查找 ====================
  function handleFindConnections(id, data) {
    var points = data.points || [];
    var threshold = data.threshold || 0.4;
    var maxEdges = data.maxEdges || MAX_AI_EDGES;

    if (points.length < 2) {
      postResult(id, []);
      return;
    }

    postProgress(5, 'extracting keywords');
    postProgress(20, 'computing similarity');

    // 统一实现：self.NLP.findConnections（含进度回调）
    var result = self.NLP.findConnections(points, threshold, maxEdges, function (percent, stage) {
      postProgress(percent, stage);
    });

    postProgress(95, 'sorting');
    postProgress(100, 'done');
    postResult(id, result);
  }

  // ==================== 比对引擎：语义去重 + 新关联 + 矛盾检测 ====================
  function handleCompare(id, data) {
    var newPoints = data.newPoints || [];
    var existingPoints = data.existingPoints || [];
    var dupThreshold = data.dupThreshold || 0.75;
    var maybeThreshold = data.maybeThreshold || 0.6;
    var connectThreshold = data.connectThreshold || 0.4;

    if (!newPoints.length) {
      postResult(id, { duplicates: [], maybeDuplicates: [], newConnections: [], contradictions: [] });
      return;
    }

    postProgress(10, 'extracting new keywords');
    postProgress(25, 'loading existing');
    postProgress(30, 'comparing ' + newPoints.length + ' vs ' + existingPoints.length);

    // 统一实现：self.NLP.comparePoints（含 MAX_AI_EDGES 上限）
    var result = self.NLP.comparePoints(newPoints, existingPoints, {
      dupThreshold: dupThreshold,
      maybeThreshold: maybeThreshold,
      connectThreshold: connectThreshold,
      maxConnections: MAX_AI_EDGES
    });

    postProgress(95, 'finalizing');
    postResult(id, result);
  }

  // ==================== 去重检查（单点） ====================
  function handleDedupCheck(id, data) {
    var candidate = data.candidate || {};
    var existing = data.existing || [];
    var threshold = data.threshold || 0.75;

    if (!candidate.text && !candidate.title) {
      postResult(id, { isDuplicate: false, confidence: 0, matchedId: null });
      return;
    }

    // 统一实现：self.NLP.dedupCheck
    postResult(id, self.NLP.dedupCheck(candidate, existing, threshold));
  }

  // ==================== 就绪信号 ====================
  self.postMessage({ type: 'ready' });

})();
